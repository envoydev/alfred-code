# Aspire integration testing

Container-backed, end-to-end tests that boot the real Aspire AppHost in-process and drive it over HTTP. Load it from SKILL.md when a test needs the whole orchestrated graph - API, database, cache - not a substituted collaborator. The AppHost wiring itself (`AddProject`/`AddPostgres`/`WithReference`/`WaitFor`, ServiceDefaults) belongs to the skill covering Aspire orchestration; this is only the test harness on top of it.

## Contents

- Packages
- Disable config file-watching before any test runs
- The fixture: IAsyncLifetime + DistributedApplicationTestingBuilder
- Discover endpoints dynamically, never hard-code them
- One AppHost, two modes
- Reset the database between tests with Respawn
- Tips

## Packages

```xml
<PackageReference Include="Aspire.Hosting.Testing" />
<PackageReference Include="xunit" />
<PackageReference Include="xunit.runner.visualstudio" />
<PackageReference Include="Microsoft.NET.Test.Sdk" />
<PackageReference Include="Npgsql" />      <!-- the Respawn reset below opens a real connection -->
<PackageReference Include="Respawn" />
```

Versions live in `Directory.Packages.props` (central package management), never on the reference.

## Disable config file-watching before any test runs

Each Aspire test starts an `IHost`, and the default host builder watches config files for reload. Across a suite this exhausts the Linux inotify watch limit and hosts start failing to launch. Kill it once, process-wide, with a module initializer - it runs before the first fixture, so nothing has to remember to call it:

```csharp
using System.Runtime.CompilerServices;

internal static class TestEnvironmentInitializer
{
    [ModuleInitializer]
    internal static void Initialize()
    {
        // Prevents file-descriptor / inotify exhaustion on Linux CI.
        Environment.SetEnvironmentVariable(
            "DOTNET_HOSTBUILDER__RELOADCONFIGONCHANGE", "false");
    }
}
```

## The fixture: IAsyncLifetime + DistributedApplicationTestingBuilder

Build the AppHost in-process, start it, and wait for the resource to report healthy before any test touches it - never `Task.Delay` a guessed interval. Share one instance across a collection so the app boots once, not per test.

```csharp
using Aspire.Hosting;
using Aspire.Hosting.Testing;

public sealed class AspireAppFixture : IAsyncLifetime
{
    private DistributedApplication? _app;

    public DistributedApplication App => _app
        ?? throw new InvalidOperationException("App not initialized");

    public async Task InitializeAsync()
    {
        var builder = await DistributedApplicationTestingBuilder
            .CreateAsync<Projects.YourApp_AppHost>([
                "App:UseVolumes=false",
                "App:UseFakeExternalServices=true"
            ]);

        _app = await builder.BuildAsync();

        using var startCts = new CancellationTokenSource(TimeSpan.FromMinutes(10));
        await _app.StartAsync(startCts.Token);

        using var healthCts = new CancellationTokenSource(TimeSpan.FromMinutes(5));
        await _app.ResourceNotifications
            .WaitForResourceHealthyAsync("api", healthCts.Token);
    }

    public async Task DisposeAsync()
    {
        if (_app is not null) await _app.DisposeAsync();
    }
}

[CollectionDefinition("aspire")]
public sealed class AspireCollection : ICollectionFixture<AspireAppFixture> { }

[Collection("aspire")]
public sealed class ApiTests(AspireAppFixture fixture)
{
    [Fact]
    public async Task Root_Returns_200()
    {
        var client = fixture.App.CreateHttpClient("api");
        var response = await client.GetAsync("/");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
```

## Discover endpoints dynamically, never hard-code them

Aspire binds `127.0.0.1:0`, so ports are assigned at runtime and parallel suites cannot collide. Resolve the address from the app, not from a literal `localhost:5000`:

```csharp
var baseUri = fixture.App.GetEndpoint("api", "https");
using var client = new HttpClient { BaseAddress = baseUri };
```

For a database or cache, pull the connection string the same way rather than assuming a fixed port:

```csharp
var connectionString = await fixture.App
    .GetConnectionStringAsync("appdb");
```

## One AppHost, two modes

Design the AppHost to default to production-like behavior and let the fixture override only what a test needs different - clean database, fake externals. Bind a config object in the AppHost and branch on it:

```csharp
public sealed class AppHostConfiguration
{
    public bool UseVolumes { get; set; } = true;
    public bool UseFakeExternalServices { get; set; } = false;
}

var config = builder.Configuration.GetSection("App")
    .Get<AppHostConfiguration>() ?? new AppHostConfiguration();

var postgres = builder.AddPostgres("postgres");
if (config.UseVolumes) postgres.WithDataVolume();   // off in tests -> clean slate
var db = postgres.AddDatabase("appdb");

builder.AddProject<Projects.YourApp_Api>("api")
    .WithReference(db)
    .WithEnvironment("ExternalServices__UseFakes",
        config.UseFakeExternalServices.ToString());
```

The fixture flips these through the args array passed to `CreateAsync` (`"App:UseVolumes=false"`, `"App:UseFakeExternalServices=true"`). Keep volumes on for F5 so data persists; off for tests so each run starts clean.

## Reset the database between tests with Respawn

Volumes-off gives a clean start per run, but a shared fixture leaks state between tests within that run. Respawn deletes all data while keeping the schema, so each test starts from a known-empty database without a full rebuild:

```csharp
using Npgsql;
using Respawn;
using Respawn.Graph;

// in InitializeAsync, after the app reports healthy:
_connectionString = await _app.GetConnectionStringAsync("appdb");
await using (var connection = new NpgsqlConnection(_connectionString))
{
    await connection.OpenAsync();
    // Postgres needs an OPEN DbConnection here - the connection-string overload is SQL Server only
    _respawner = await Respawner.CreateAsync(connection, new RespawnerOptions
    {
        DbAdapter = DbAdapter.Postgres,
        TablesToIgnore = new Table[] { "__EFMigrationsHistory" }
    });
}

public async Task ResetAsync()
{
    await using var connection = new NpgsqlConnection(_connectionString!);
    await connection.OpenAsync();
    await _respawner!.ResetAsync(connection);
}
```

Call `ResetAsync()` from the test class constructor for per-test fresh state, or from a class-level `IAsyncLifetime`.

## Tips

| Problem | Fix |
|---|---|
| Tests time out at startup | Await `StartAsync` then `WaitForResourceHealthyAsync`; don't assume ready |
| Flaky on timing | Poll health, never `Task.Delay` a guessed interval |
| Port conflicts | Let Aspire assign dynamic ports; share the fixture via a collection |
| State leaks between tests | Respawn reset, or volumes-off plus fresh schema |
| Endpoint not found | Resource names in tests must match the AppHost `AddProject`/`AddPostgres` names |

A single database or service in Docker that does not need the Aspire orchestrator belongs to `references/testcontainers.md` instead.
