using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Npgsql;

namespace LendingDesk.IntegrationTests.Hidden.Devops02;

internal static class RepoRoot
{
    public static string Path { get; } = Find();

    public static string File(string relative) => System.IO.Path.Combine(Path, relative);

    private static string Find()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (System.IO.File.Exists(System.IO.Path.Combine(dir.FullName, "LendingDesk.slnx")))
            {
                return dir.FullName;
            }
        }

        throw new InvalidOperationException("The repository root (LendingDesk.slnx) was not found above " + AppContext.BaseDirectory);
    }
}

internal sealed record CommandResult(int ExitCode, string Output, string Error)
{
    public string All => Output + Error;

    public string Tail => All.Length > 6000 ? All[^6000..] : All;
}

/// <summary>
/// One compose project of the repository's own compose file, under a unique name and on free host ports, so a
/// run never meets another's containers. Disposing it takes the project down with its volumes and built images.
/// </summary>
internal sealed class ComposeProject : IAsyncDisposable
{
    public static readonly TimeSpan BuildTimeout = TimeSpan.FromMinutes(20);
    public static readonly TimeSpan CommandTimeout = TimeSpan.FromMinutes(5);

    private ComposeProject(string name, int apiPort, int dbPort)
    {
        Name = name;
        ApiPort = apiPort;
        DbPort = dbPort;
    }

    public string Name { get; }

    public int ApiPort { get; }

    public int DbPort { get; }

    public static ComposeProject Create()
    {
        var apiPort = FreePort();
        var dbPort = FreePort();
        while (dbPort == apiPort)
        {
            dbPort = FreePort();
        }

        return new ComposeProject($"devops02-{Guid.NewGuid().ToString("N")[..10]}", apiPort, dbPort);
    }

    /// <summary>Runs `docker compose -p &lt;this project&gt; ...` from the repository root with this project's ports.</summary>
    public Task<CommandResult> RunAsync(TimeSpan timeout, params string[] args) =>
        DockerAsync(timeout, ["compose", "-p", Name, .. args], new Dictionary<string, string>
        {
            ["LENDING_API_PORT"] = ApiPort.ToString(CultureInfo.InvariantCulture),
            ["LENDING_DB_PORT"] = DbPort.ToString(CultureInfo.InvariantCulture),
        });

    public static async Task<CommandResult> DockerAsync(TimeSpan timeout, IReadOnlyList<string> args, IReadOnlyDictionary<string, string>? environment = null)
    {
        var start = new ProcessStartInfo("docker")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            WorkingDirectory = RepoRoot.Path,
        };
        foreach (var arg in args)
        {
            start.ArgumentList.Add(arg);
        }

        start.Environment.Remove("COMPOSE_PROJECT_NAME");
        foreach (var (name, value) in environment ?? new Dictionary<string, string>())
        {
            start.Environment[name] = value;
        }

        using var process = Process.Start(start) ?? throw new InvalidOperationException("docker did not start.");
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        using var cancel = new CancellationTokenSource(timeout);
        try
        {
            await process.WaitForExitAsync(cancel.Token);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            throw new TimeoutException($"docker {string.Join(' ', args)} did not finish within {timeout}.");
        }

        return new CommandResult(process.ExitCode, await output, await error);
    }

    public async Task<JsonElement> ConfigAsync()
    {
        var config = await RunAsync(CommandTimeout, "config", "--format", "json");
        Assert.True(config.ExitCode == 0, $"docker compose config failed:\n{config.Tail}");
        using var document = JsonDocument.Parse(config.Output);
        return document.RootElement.Clone();
    }

    /// <summary>The services whose build uses the given Dockerfile, relative to the repository root.</summary>
    public static List<string> ServicesBuiltFrom(JsonElement config, string dockerfile)
    {
        var wanted = System.IO.Path.GetFullPath(RepoRoot.File(dockerfile));
        var found = new List<string>();
        foreach (var service in config.GetProperty("services").EnumerateObject())
        {
            if (!service.Value.TryGetProperty("build", out var build) || build.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var context = build.TryGetProperty("context", out var c) ? c.GetString() ?? RepoRoot.Path : RepoRoot.Path;
            var file = build.TryGetProperty("dockerfile", out var d) ? d.GetString() ?? "Dockerfile" : "Dockerfile";
            if (string.Equals(System.IO.Path.GetFullPath(System.IO.Path.Combine(context, file)), wanted, StringComparison.Ordinal))
            {
                found.Add(service.Name);
            }
        }

        return found;
    }

    public HttpClient StaffClient()
    {
        var client = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{ApiPort}"), Timeout = TimeSpan.FromSeconds(20) };
        client.DefaultRequestHeaders.Add("X-Demo-User", "desk");
        client.DefaultRequestHeaders.Add("X-Demo-Role", "staff");
        return client;
    }

    /// <summary>Waits until the API answers an authenticated read with 200 - the schema is there by then.</summary>
    public static async Task WaitForApiAsync(HttpClient api, TimeSpan within)
    {
        var watch = Stopwatch.StartNew();
        var last = "no answer";
        while (watch.Elapsed < within)
        {
            try
            {
                using var response = await api.GetAsync("/api/items");
                if (response.StatusCode == HttpStatusCode.OK)
                {
                    return;
                }

                last = $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}";
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
            {
                last = ex.Message;
            }

            await Task.Delay(1000);
        }

        Assert.Fail($"GET /api/items never answered 200 within {within}; last: {last}");
    }

    /// <summary>The database the stack runs, reached on its published port with the credentials the IDE run uses.</summary>
    public NpgsqlConnection Database()
    {
        using var settings = JsonDocument.Parse(System.IO.File.ReadAllText(RepoRoot.File("src/LendingDesk.Api/appsettings.Development.json")));
        var connection = settings.RootElement.GetProperty("ConnectionStrings").GetProperty("Lending").GetString();
        // No pooling: a restart of the stack leaves every pooled connection dead.
        var builder = new NpgsqlConnectionStringBuilder(connection) { Host = "127.0.0.1", Port = DbPort, Pooling = false };
        return new NpgsqlConnection(builder.ConnectionString);
    }

    public async ValueTask DisposeAsync()
    {
        await RunAsync(CommandTimeout, "down", "--volumes", "--rmi", "local", "--remove-orphans");
    }

    private static int FreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            return ((IPEndPoint)listener.LocalEndpoint).Port;
        }
        finally
        {
            listener.Stop();
        }
    }
}
