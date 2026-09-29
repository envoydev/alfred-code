using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Npgsql;

namespace LendingDesk.IntegrationTests.Hidden.Devops02;

/// <summary>
/// Hidden acceptance tests for devops-02: `docker compose up --build` runs the database, the migrations, the API and
/// the worker from a cold start and again after a restart, nothing in Development, and `up -d db` still starts the
/// database alone. Services are found by the Dockerfile they build from, never by the name a solution gives them.
/// </summary>
public sealed class Devops02ComposeTests
{
    private const string ApiDockerfile = "src/LendingDesk.Api/Dockerfile";
    private const string WorkerDockerfile = "src/LendingDesk.Worker/Dockerfile";
    private static readonly TimeSpan ApiWait = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan NoticeWait = TimeSpan.FromSeconds(90);
    private static readonly string[] EnvironmentNames = ["ASPNETCORE_ENVIRONMENT", "DOTNET_ENVIRONMENT"];

    [Fact]
    public async Task The_whole_app_starts_cold_serves_the_api_runs_the_worker_and_survives_a_restart()
    {
        await using var stack = ComposeProject.Create();
        var config = await stack.ConfigAsync();
        var worker = Assert.Single(ComposeProject.ServicesBuiltFrom(config, WorkerDockerfile));

        var up = await stack.RunAsync(ComposeProject.BuildTimeout, "up", "--detach", "--build");
        Assert.True(up.ExitCode == 0, $"docker compose up --build failed on an empty volume:\n{up.Tail}");
        using var api = stack.StaffClient();
        await ComposeProject.WaitForApiAsync(api, ApiWait);

        var openApi = await api.GetAsync("/openapi/v1.json");
        Assert.True(openApi.StatusCode != HttpStatusCode.OK, "The API serves its OpenAPI document, which it maps in Development only.");
        var first = await LendAsync(api);
        await WaitForConfirmationAsync(stack, first);
        await AssertNoFailedCycleAsync(stack, worker);
        await AssertRunsAsNonRootAsync(stack, worker);

        var down = await stack.RunAsync(ComposeProject.CommandTimeout, "down");
        Assert.True(down.ExitCode == 0, $"docker compose down failed:\n{down.Tail}");
        var again = await stack.RunAsync(ComposeProject.BuildTimeout, "up", "--detach");
        Assert.True(again.ExitCode == 0, $"docker compose up failed on the kept volume:\n{again.Tail}");
        await ComposeProject.WaitForApiAsync(api, ApiWait);

        Assert.Equal(HttpStatusCode.OK, (await api.GetAsync($"/api/loans/{first}")).StatusCode);
        var second = await LendAsync(api);
        await WaitForConfirmationAsync(stack, second);
        await AssertNoFailedCycleAsync(stack, worker);
    }

    [Fact]
    public async Task The_api_and_the_worker_are_built_from_their_dockerfiles_and_nothing_runs_in_development()
    {
        await using var stack = ComposeProject.Create();
        var config = await stack.ConfigAsync();
        var services = config.GetProperty("services");

        var api = ComposeProject.ServicesBuiltFrom(config, ApiDockerfile);
        Assert.Contains(api, name => Publishes(services.GetProperty(name), stack.ApiPort));
        Assert.Single(ComposeProject.ServicesBuiltFrom(config, WorkerDockerfile));
        foreach (var service in services.EnumerateObject())
        {
            if (!service.Value.TryGetProperty("environment", out var environment) || environment.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            foreach (var name in EnvironmentNames)
            {
                var value = environment.TryGetProperty(name, out var v) ? v.GetString() : null;
                Assert.False(
                    string.Equals(value, "Development", StringComparison.OrdinalIgnoreCase),
                    $"Service '{service.Name}' runs with {name}=Development.");
            }
        }
    }

    [Fact]
    public async Task Up_db_alone_still_starts_only_the_database()
    {
        await using var stack = ComposeProject.Create();

        var up = await stack.RunAsync(ComposeProject.CommandTimeout, "up", "--detach", "db");
        Assert.True(up.ExitCode == 0, $"docker compose up -d db failed:\n{up.Tail}");
        var ps = await stack.RunAsync(ComposeProject.CommandTimeout, "ps", "--all", "--format", "json");

        Assert.Equal(["db"], ServicesIn(ps.Output));
    }

    private static bool Publishes(JsonElement service, int hostPort)
    {
        if (!service.TryGetProperty("ports", out var ports))
        {
            return false;
        }

        return ports.EnumerateArray().Any(p =>
            p.TryGetProperty("target", out var target) && target.GetInt32() == 8080
            && p.TryGetProperty("published", out var published)
            && published.ToString() == hostPort.ToString(System.Globalization.CultureInfo.InvariantCulture));
    }

    /// <summary>`compose ps --format json` prints one object per line on newer releases and an array on older ones.</summary>
    private static List<string> ServicesIn(string json)
    {
        var text = json.Trim();
        var rows = text.StartsWith('[')
            ? JsonDocument.Parse(text).RootElement.EnumerateArray().Select(e => e.Clone()).ToList()
            : text.Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(l => JsonDocument.Parse(l).RootElement.Clone()).ToList();
        return rows.Select(r => r.GetProperty("Service").GetString()!).Distinct().Order().ToList();
    }

    private static async Task<int> LendAsync(HttpClient api)
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var member = await PostAsync(api, "/api/members", new { name = $"Member {suffix}", email = $"m{suffix}@example.com" });
        var item = await PostAsync(api, "/api/items", new { name = $"Item {suffix}", category = "Tools", sku = $"DV-{suffix}".ToUpperInvariant(), totalStock = 2 });
        var tomorrow = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1);
        return await PostAsync(api, "/api/loans", new { itemId = item, memberId = member, startDate = tomorrow, dueDate = tomorrow.AddDays(7) });
    }

    private static async Task<int> PostAsync(HttpClient api, string url, object body)
    {
        var response = await api.PostAsJsonAsync(url, body);
        Assert.True(response.StatusCode == HttpStatusCode.Created, $"POST {url} answered {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        using var created = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return created.RootElement.GetProperty("id").GetInt32();
    }

    /// <summary>The worker turns the loan's created event into a Confirmation notice.</summary>
    private static async Task WaitForConfirmationAsync(ComposeProject stack, int loanId)
    {
        var watch = Stopwatch.StartNew();
        while (watch.Elapsed < NoticeWait)
        {
            await using var connection = stack.Database();
            await connection.OpenAsync();
            await using var count = new NpgsqlCommand("""SELECT count(*) FROM "Notices" WHERE "LoanId" = @loan AND "Kind" = 'Confirmation'""", connection);
            count.Parameters.AddWithValue("loan", loanId);
            if ((long)(await count.ExecuteScalarAsync())! == 1)
            {
                return;
            }

            await Task.Delay(1000);
        }

        Assert.Fail($"The worker sent no Confirmation notice for loan {loanId} within {NoticeWait}.");
    }

    private static async Task AssertNoFailedCycleAsync(ComposeProject stack, string worker)
    {
        var logs = await stack.RunAsync(ComposeProject.CommandTimeout, "logs", "--no-color", worker);

        Assert.True(logs.ExitCode == 0, $"docker compose logs {worker} failed:\n{logs.Tail}");
        Assert.False(logs.All.Contains("Worker cycle failed", StringComparison.Ordinal), $"The worker logged a failed cycle:\n{logs.Tail}");
    }

    /// <summary>The user the worker's container runs as, from its image and run settings: set, and not root.</summary>
    private static async Task AssertRunsAsNonRootAsync(ComposeProject stack, string worker)
    {
        var id = (await stack.RunAsync(ComposeProject.CommandTimeout, "ps", "--quiet", worker)).Output.Trim();
        Assert.False(string.IsNullOrEmpty(id), $"No running container for service '{worker}'.");
        var inspect = await ComposeProject.DockerAsync(ComposeProject.CommandTimeout, ["inspect", "--format", "{{.Config.User}}", id]);

        Assert.True(inspect.ExitCode == 0, $"docker inspect failed:\n{inspect.Tail}");
        var user = inspect.Output.Trim().Split(':')[0];
        Assert.False(user is "" or "root" or "0", $"The worker container runs as '{inspect.Output.Trim()}'.");
    }
}
