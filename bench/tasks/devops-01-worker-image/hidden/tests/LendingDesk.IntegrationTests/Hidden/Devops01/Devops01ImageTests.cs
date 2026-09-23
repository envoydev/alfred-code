using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using LendingDesk.Data;
using LendingDesk.Data.Outbox;
using LendingDesk.Domain.Events;
using LendingDesk.Domain.Items;
using LendingDesk.Domain.Loans;
using LendingDesk.Domain.Members;
using LendingDesk.Domain.Notices;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LendingDesk.IntegrationTests.Hidden.Devops01;

/// <summary>The worker image, built from the repository root with src/LendingDesk.Worker/Dockerfile.</summary>
public sealed partial class Devops01ImageTests(Devops01ImageFixture image) : IClassFixture<Devops01ImageFixture>
{
    private const string FailedCycle = "Worker cycle failed";

    [Fact]
    public async Task The_final_stage_is_the_plain_dotnet_10_runtime_image_without_sdk_or_aspnet()
    {
        image.RequireImage();

        var pull = await DockerCli.RunAsync(TimeSpan.FromMinutes(10), "pull", "mcr.microsoft.com/dotnet/runtime:10.0");
        Assert.True(pull.ExitCode == 0, $"docker pull mcr.microsoft.com/dotnet/runtime:10.0 failed: {pull.Tail}");
        using var baseImage = JsonDocument.Parse((await DockerCli.RunAsync(TimeSpan.FromMinutes(1), "image", "inspect", "mcr.microsoft.com/dotnet/runtime:10.0")).Output);
        var baseLayers = Layers(baseImage.RootElement[0]);
        var layers = Layers(image.Image);
        Assert.True(
            layers.Count > baseLayers.Count && layers.Take(baseLayers.Count).SequenceEqual(baseLayers),
            "The image's base layers are not mcr.microsoft.com/dotnet/runtime:10.0's.");

        var runtimes = await RunInImageAsync("dotnet", "--list-runtimes");
        Assert.Equal(0, runtimes.ExitCode);
        var names = runtimes.Output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        Assert.NotEmpty(names);
        Assert.All(names, line => Assert.StartsWith("Microsoft.NETCore.App 10.", line, StringComparison.Ordinal));

        var sdks = await RunInImageAsync("dotnet", "--list-sdks");
        Assert.Equal(string.Empty, sdks.Output.Trim());
    }

    [Fact]
    public async Task The_image_holds_the_release_publish_output_in_app_and_no_source_or_sdk()
    {
        image.RequireImage();
        var container = image.Name("export");
        var create = await DockerCli.RunAsync(TimeSpan.FromMinutes(1), "create", "--name", container, "--label", image.Label, image.Tag);
        Assert.True(create.ExitCode == 0, $"docker create failed: {create.Tail}");
        try
        {
            var (paths, files) = await DockerCli.ExportAsync(container, "app/LendingDesk.Worker.dll");

            foreach (var published in new[]
            {
                "app/LendingDesk.Worker.dll",
                "app/LendingDesk.Worker.deps.json",
                "app/LendingDesk.Worker.runtimeconfig.json",
                "app/LendingDesk.Data.dll",
                "app/LendingDesk.Domain.dll",
            })
            {
                Assert.Contains(published, paths);
            }

            var source = paths.Where(p => SourceFile().IsMatch(p)).ToList();
            Assert.True(source.Count == 0, "Source or build files in the image: " + string.Join(", ", source.Take(20)));
            var sdk = paths.Where(p => p.StartsWith("usr/share/dotnet/sdk", StringComparison.Ordinal) || p.Contains("/obj/", StringComparison.Ordinal)).ToList();
            Assert.True(sdk.Count == 0, "SDK or intermediate build output in the image: " + string.Join(", ", sdk.Take(20)));

            Assert.True(files.TryGetValue("app/LendingDesk.Worker.dll", out var worker), "app/LendingDesk.Worker.dll could not be read.");
            Assert.True(AssemblyBuild.IsOptimized(worker), "app/LendingDesk.Worker.dll is a Debug build, not a Release publish.");
        }
        finally
        {
            await Devops01ImageFixture.RemoveAsync(container);
        }
    }

    [Fact]
    public async Task It_runs_as_the_non_root_user_the_base_image_ships()
    {
        image.RequireImage();
        var appUid = image.Image.GetProperty("Config").GetProperty("Env").EnumerateArray()
            .Select(e => e.GetString()!)
            .Where(e => e.StartsWith("APP_UID=", StringComparison.Ordinal))
            .Select(e => e["APP_UID=".Length..])
            .SingleOrDefault();
        Assert.False(string.IsNullOrEmpty(appUid), "The image does not carry the base image's APP_UID.");

        var id = await RunInImageAsync("id", "-u");

        Assert.Equal(0, id.ExitCode);
        Assert.Equal(appUid, id.Output.Trim());
        Assert.NotEqual("0", id.Output.Trim());
    }

    [Fact]
    public void It_works_in_app_starts_the_worker_dll_and_exposes_no_port()
    {
        image.RequireImage();
        var config = image.Image.GetProperty("Config");

        Assert.Equal("/app", config.GetProperty("WorkingDir").GetString());
        Assert.True(config.TryGetProperty("Entrypoint", out var entrypoint) && entrypoint.ValueKind == JsonValueKind.Array, "The image has no entry point.");
        Assert.Equal(["dotnet", "LendingDesk.Worker.dll"], entrypoint.EnumerateArray().Select(e => e.GetString()));
        var exposed = config.TryGetProperty("ExposedPorts", out var ports) && ports.ValueKind == JsonValueKind.Object
            ? ports.EnumerateObject().Select(p => p.Name).ToList()
            : [];
        Assert.Empty(exposed);
    }

    [Fact]
    public async Task Pointed_at_a_migrated_database_it_handles_the_outbox_and_sends_reminders_on_the_configured_poll()
    {
        image.RequireImage();
        var (fromTests, fromContainer) = await image.CreateDatabaseAsync("worker_ok");
        await using (var db = NewDb(fromTests))
        {
            await db.Database.MigrateAsync();
        }

        var now = DateTimeOffset.UtcNow;
        var today = DateOnly.FromDateTime(now.UtcDateTime);
        var confirmed = await SeedLoanAsync(fromTests, today, today.AddDays(7), now);
        var overdue = await SeedLoanAsync(fromTests, today.AddDays(-6), today.AddDays(-3), now);
        await EnqueueAsync(fromTests, EventTypes.LoanCreated, new LoanCreated(confirmed.Id, confirmed.MemberId, confirmed.ItemId, confirmed.StartDate, confirmed.DueDate), now);

        var container = await image.StartWorkerAsync(
            "migrated",
            "--network", image.Network,
            "-e", $"ConnectionStrings__Lending={fromContainer}",
            "-e", "Worker__PollSeconds=1");
        try
        {
            await WaitForAsync(
                TimeSpan.FromSeconds(90),
                async () => await PendingOutboxAsync(fromTests) == 0
                    && (await NoticesAsync(fromTests, confirmed.Id)).Contains(NoticeKind.Confirmation)
                    && (await NoticesAsync(fromTests, overdue.Id)).Contains(NoticeKind.Overdue),
                container,
                "the outbox to be handled and the overdue reminder to be sent");

            await using (var db = NewDb(fromTests))
            {
                Assert.All(await db.OutboxMessages.ToListAsync(), m =>
                {
                    Assert.NotNull(m.ProcessedAt);
                    Assert.Null(m.LastError);
                });
            }

            // Worker__PollSeconds=1: a new message is picked up well inside the 10 s default.
            for (var round = 0; round < 5; round++)
            {
                await EnqueueAsync(fromTests, EventTypes.LoanReturned, new LoanReturned(confirmed.Id, confirmed.MemberId, DateTimeOffset.UtcNow), DateTimeOffset.UtcNow);
                var clock = Stopwatch.StartNew();
                await WaitForAsync(TimeSpan.FromSeconds(30), async () => await PendingOutboxAsync(fromTests) == 0, container, "a later outbox message to be handled");
                Assert.True(clock.Elapsed < TimeSpan.FromSeconds(7), $"A message took {clock.Elapsed.TotalSeconds:F1} s to be handled with Worker__PollSeconds=1.");
            }

            Assert.Contains(NoticeKind.ReturnReceipt, await NoticesAsync(fromTests, confirmed.Id));
            Assert.True(await Devops01ImageFixture.IsRunningAsync(container), "The worker exited: " + await Devops01ImageFixture.LogsAsync(container));
        }
        finally
        {
            await Devops01ImageFixture.RemoveAsync(container);
        }
    }

    [Fact]
    public async Task Pointed_at_an_empty_database_it_runs_no_migrations_and_logs_failed_cycles()
    {
        image.RequireImage();
        var (fromTests, fromContainer) = await image.CreateDatabaseAsync("worker_empty");

        var container = await image.StartWorkerAsync(
            "empty",
            "--network", image.Network,
            "-e", $"ConnectionStrings__Lending={fromContainer}",
            "-e", "Worker__PollSeconds=1");
        try
        {
            await WaitForAsync(
                TimeSpan.FromSeconds(60),
                async () => await TableCountAsync(fromTests) > 0 || Count(await Devops01ImageFixture.LogsAsync(container), FailedCycle) >= 2,
                container,
                "two failed cycles");

            Assert.Equal(0, await TableCountAsync(fromTests));
            Assert.True(await Devops01ImageFixture.IsRunningAsync(container), "The worker exited: " + await Devops01ImageFixture.LogsAsync(container));
        }
        finally
        {
            await Devops01ImageFixture.RemoveAsync(container);
        }
    }

    [Fact]
    public async Task With_no_database_reachable_it_keeps_running_and_logs_the_failed_cycles()
    {
        image.RequireImage();

        var container = await image.StartWorkerAsync(
            "nodb",
            "--network", "none",
            "-e", "ConnectionStrings__Lending=Host=lendingdb.invalid;Port=5432;Database=lending;Username=lending;Password=lending;Timeout=3",
            "-e", "Worker__PollSeconds=1");
        try
        {
            await WaitForAsync(
                TimeSpan.FromSeconds(60),
                async () => Count(await Devops01ImageFixture.LogsAsync(container), FailedCycle) >= 3 || !await Devops01ImageFixture.IsRunningAsync(container),
                container,
                "three failed cycles");

            Assert.True(await Devops01ImageFixture.IsRunningAsync(container), "The worker exited: " + await Devops01ImageFixture.LogsAsync(container));
            Assert.True(Count(await Devops01ImageFixture.LogsAsync(container), FailedCycle) >= 3, "The failed cycles were not logged.");
        }
        finally
        {
            await Devops01ImageFixture.RemoveAsync(container);
        }
    }

    [GeneratedRegex(@"(\.cs|\.csproj|\.slnx?|/Directory\.Build\.props|/global\.json|^global\.json|^Directory\.Build\.props)$", RegexOptions.IgnoreCase)]
    private static partial Regex SourceFile();

    private static List<string> Layers(JsonElement inspected) =>
        [.. inspected.GetProperty("RootFS").GetProperty("Layers").EnumerateArray().Select(l => l.GetString()!)];

    private async Task<DockerResult> RunInImageAsync(string entrypoint, params string[] args) =>
        await DockerCli.RunAsync(TimeSpan.FromMinutes(2), ["run", "--rm", "--label", image.Label, "--network", "none", "--entrypoint", entrypoint, image.Tag, .. args]);

    private static int Count(string text, string what)
    {
        var count = 0;
        for (var at = text.IndexOf(what, StringComparison.Ordinal); at >= 0; at = text.IndexOf(what, at + what.Length, StringComparison.Ordinal))
        {
            count++;
        }

        return count;
    }

    private static async Task WaitForAsync(TimeSpan timeout, Func<Task<bool>> condition, string container, string what)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (!await condition())
        {
            if (DateTime.UtcNow > deadline)
            {
                Assert.Fail($"Waited {timeout.TotalSeconds} s for {what}. Worker logs:\n{await Devops01ImageFixture.LogsAsync(container)}");
            }

            await Task.Delay(200);
        }
    }

    private static LendingDbContext NewDb(string connectionString) =>
        new(new DbContextOptionsBuilder<LendingDbContext>().UseNpgsql(connectionString).Options);

    private static async Task<Loan> SeedLoanAsync(string connectionString, DateOnly start, DateOnly due, DateTimeOffset now)
    {
        await using var db = NewDb(connectionString);
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var loan = new Loan
        {
            Member = new Member { Name = $"Member {suffix}", Email = $"{suffix}@example.com", CreatedAt = now },
            Item = new Item { Name = $"Item {suffix}", Category = "Tools", Sku = $"SKU-{suffix}".ToUpperInvariant(), TotalStock = 1, CreatedAt = now },
            StartDate = start,
            DueDate = due,
            CreatedAt = now,
        };
        db.Loans.Add(loan);
        await db.SaveChangesAsync();
        return loan;
    }

    private static async Task EnqueueAsync<T>(string connectionString, string type, T payload, DateTimeOffset at)
    {
        await using var db = NewDb(connectionString);
        db.Enqueue(type, payload, at);
        await db.SaveChangesAsync();
    }

    private static async Task<int> PendingOutboxAsync(string connectionString)
    {
        await using var db = NewDb(connectionString);
        return await db.OutboxMessages.CountAsync(m => m.ProcessedAt == null);
    }

    private static async Task<List<NoticeKind>> NoticesAsync(string connectionString, int loanId)
    {
        await using var db = NewDb(connectionString);
        return await db.Notices.Where(n => n.LoanId == loanId).Select(n => n.Kind).ToListAsync();
    }

    private static async Task<long> TableCountAsync(string connectionString)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'", connection);
        return (long)(await command.ExecuteScalarAsync())!;
    }
}
