using System.Diagnostics;
using System.Formats.Tar;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Text.Json;
using Npgsql;

namespace LendingDesk.IntegrationTests.Hidden.Devops01;

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

internal sealed record DockerResult(int ExitCode, string Output, string Error)
{
    public string All => Output + Error;

    public string Tail => All.Length > 4000 ? All[^4000..] : All;
}

internal static class DockerCli
{
    public static async Task<DockerResult> RunAsync(TimeSpan timeout, params string[] args)
    {
        using var process = Process.Start(Start(args)) ?? throw new InvalidOperationException("docker did not start.");
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

        return new DockerResult(process.ExitCode, await output, await error);
    }

    /// <summary>Every path in a container's filesystem, plus the bytes of the files asked for.</summary>
    public static async Task<(List<string> Paths, Dictionary<string, byte[]> Files)> ExportAsync(string container, params string[] wanted)
    {
        using var process = Process.Start(Start(["export", container])) ?? throw new InvalidOperationException("docker did not start.");
        var error = process.StandardError.ReadToEndAsync();
        var paths = new List<string>();
        var files = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        await using (var reader = new TarReader(process.StandardOutput.BaseStream))
        {
            while (await reader.GetNextEntryAsync() is { } entry)
            {
                var name = entry.Name.StartsWith("./", StringComparison.Ordinal) ? entry.Name[2..] : entry.Name;
                name = name.TrimStart('/');
                paths.Add(name);
                if (wanted.Contains(name) && entry.DataStream is { } data)
                {
                    using var copy = new MemoryStream();
                    await data.CopyToAsync(copy);
                    files[name] = copy.ToArray();
                }
            }
        }

        await process.WaitForExitAsync();
        Assert.True(process.ExitCode == 0, $"docker export failed: {await error}");
        return (paths, files);
    }

    private static ProcessStartInfo Start(IEnumerable<string> args)
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

        return start;
    }
}

internal static class AssemblyBuild
{
    /// <summary>False when the assembly's DebuggableAttribute switches JIT optimizations off, as a Debug build's does.</summary>
    public static bool IsOptimized(byte[] assembly)
    {
        using var pe = new PEReader(new MemoryStream(assembly));
        var metadata = pe.GetMetadataReader();
        foreach (var handle in metadata.GetAssemblyDefinition().GetCustomAttributes())
        {
            var attribute = metadata.GetCustomAttribute(handle);
            if (attribute.Constructor.Kind != HandleKind.MemberReference)
            {
                continue;
            }

            var constructor = metadata.GetMemberReference((MemberReferenceHandle)attribute.Constructor);
            if (constructor.Parent.Kind != HandleKind.TypeReference
                || metadata.GetString(metadata.GetTypeReference((TypeReferenceHandle)constructor.Parent).Name) != nameof(DebuggableAttribute))
            {
                continue;
            }

            // Prolog 01 00, then either (DebuggingModes) as an int32 or (bool, bool), then the named-argument count.
            var blob = metadata.GetBlobBytes(attribute.Value);
            return blob.Length switch
            {
                8 => (BitConverter.ToInt32(blob, 2) & (int)DebuggableAttribute.DebuggingModes.DisableOptimizations) == 0,
                6 => blob[3] == 0,
                _ => true,
            };
        }

        return true;
    }
}

/// <summary>
/// Builds the worker image once with the stated command (tagged with this task's id instead of
/// lendingdesk-worker, so parallel runs never share a tag), and owns every container, network and
/// image the tests start, removing them at the end whether the tests pass or fail.
/// </summary>
public sealed class Devops01ImageFixture : IAsyncLifetime
{
    private const string PostgresPassword = "devops01-hidden";
    private readonly Lock _postgresLock = new();
    private Task<string>? _postgres;

    public string Suffix { get; } = Guid.NewGuid().ToString("N")[..10];

    public string Tag => $"devops-01-worker-image-hidden:{Suffix}";

    public string Label => $"devops-01-worker-image-hidden={Suffix}";

    public string Network => $"devops-01-worker-image-net-{Suffix}";

    public const string DatabaseAlias = "devops01-db";

    internal DockerResult? Build { get; private set; }

    public JsonElement Image { get; private set; }

    public string? SetupError { get; private set; }

    public async Task InitializeAsync()
    {
        if (!File.Exists(RepoRoot.File("src/LendingDesk.Worker/Dockerfile")))
        {
            SetupError = "src/LendingDesk.Worker/Dockerfile does not exist.";
            return;
        }

        // The stated build command, plus --pull so the base layers compared later are the current ones.
        Build = await DockerCli.RunAsync(TimeSpan.FromMinutes(15), "build", "--pull", "-f", "src/LendingDesk.Worker/Dockerfile", "-t", Tag, ".");
        if (Build.ExitCode != 0)
        {
            SetupError = "docker build -f src/LendingDesk.Worker/Dockerfile . failed:\n" + Build.Tail;
            return;
        }

        var inspect = await DockerCli.RunAsync(TimeSpan.FromMinutes(1), "image", "inspect", Tag);
        using var document = JsonDocument.Parse(inspect.Output);
        Image = document.RootElement[0].Clone();
    }

    public void RequireImage() => Assert.True(SetupError is null, SetupError);

    public string Name(string role) => $"devops-01-worker-image-{role}-{Suffix}";

    /// <summary>Starts the worker image detached with the given docker run options.</summary>
    public async Task<string> StartWorkerAsync(string role, params string[] options)
    {
        var name = Name(role);
        var run = await DockerCli.RunAsync(TimeSpan.FromMinutes(2), ["run", "-d", "--name", name, "--label", Label, .. options, Tag]);
        Assert.True(run.ExitCode == 0, $"docker run failed: {run.Tail}");
        return name;
    }

    public static async Task RemoveAsync(string container) =>
        await DockerCli.RunAsync(TimeSpan.FromMinutes(1), "rm", "-f", container);

    public static async Task<string> LogsAsync(string container) =>
        (await DockerCli.RunAsync(TimeSpan.FromMinutes(1), "logs", container)).All;

    public static async Task<bool> IsRunningAsync(string container) =>
        (await DockerCli.RunAsync(TimeSpan.FromMinutes(1), "inspect", "-f", "{{.State.Running}}", container)).Output.Trim() == "true";

    /// <summary>A fresh database on a PostgreSQL container that shares a network with the worker.</summary>
    /// <returns>The connection string from the test process, and the one the worker container uses.</returns>
    public async Task<(string FromTests, string FromContainer)> CreateDatabaseAsync(string database)
    {
        var host = await PostgresAsync();
        await using (var connection = new NpgsqlConnection(host))
        {
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand($"CREATE DATABASE \"{database}\"", connection);
            await command.ExecuteNonQueryAsync();
        }

        var fromTests = new NpgsqlConnectionStringBuilder(host) { Database = database }.ConnectionString;
        var fromContainer = $"Host={DatabaseAlias};Port=5432;Database={database};Username=postgres;Password={PostgresPassword}";
        return (fromTests, fromContainer);
    }

    public async Task DisposeAsync()
    {
        var containers = await DockerCli.RunAsync(TimeSpan.FromMinutes(1), "ps", "-aq", "--filter", $"label={Label}");
        foreach (var id in containers.Output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            await DockerCli.RunAsync(TimeSpan.FromMinutes(1), "rm", "-f", id);
        }

        await DockerCli.RunAsync(TimeSpan.FromMinutes(1), "network", "rm", Network);
        await DockerCli.RunAsync(TimeSpan.FromMinutes(1), "rmi", "-f", Tag);
    }

    private Task<string> PostgresAsync()
    {
        lock (_postgresLock)
        {
            return _postgres ??= StartPostgresAsync();
        }
    }

    private async Task<string> StartPostgresAsync()
    {
        var network = await DockerCli.RunAsync(TimeSpan.FromMinutes(1), "network", "create", "--label", Label, Network);
        Assert.True(network.ExitCode == 0, $"docker network create failed: {network.Tail}");
        var name = Name("postgres");
        var run = await DockerCli.RunAsync(
            TimeSpan.FromMinutes(5),
            "run", "-d", "--name", name, "--label", Label, "--network", Network, "--network-alias", DatabaseAlias,
            "-e", $"POSTGRES_PASSWORD={PostgresPassword}", "-p", "127.0.0.1::5432", "postgres:17-alpine");
        Assert.True(run.ExitCode == 0, $"Starting PostgreSQL failed: {run.Tail}");
        var port = (await DockerCli.RunAsync(TimeSpan.FromMinutes(1), "port", name, "5432/tcp")).Output
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)[0].Trim().Split(':')[^1];
        var host = $"Host=127.0.0.1;Port={port};Database=postgres;Username=postgres;Password={PostgresPassword};Pooling=false";

        var deadline = DateTime.UtcNow.AddMinutes(1);
        while (true)
        {
            try
            {
                await using var connection = new NpgsqlConnection(host);
                await connection.OpenAsync();
                await using var command = new NpgsqlCommand("SELECT 1", connection);
                await command.ExecuteScalarAsync();
                break;
            }
            catch (Exception ex) when (ex is NpgsqlException or IOException or TimeoutException && DateTime.UtcNow < deadline)
            {
                await Task.Delay(500);
            }
        }

        return host;
    }
}
