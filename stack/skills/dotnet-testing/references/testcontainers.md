# Testcontainers integration tests (Postgres)

A single real database in Docker, without the Aspire orchestrator. Load it from SKILL.md when a data-access test needs real SQL - actual constraints, indexes, and query behavior a substituted `DbConnection` can never prove - but the system under test is just the DB, not a full app graph.

## Contents

- This vs Aspire
- Packages
- The fixture: IAsyncLifetime + PostgreSqlBuilder
- One container per suite, not per test
- Reset between tests with Respawn
- Pitfalls

## This vs Aspire

| You need... | Use |
|---|---|
| one real database in Docker, driven directly | this file |
| the whole orchestrated graph (API + DB + cache) booted and driven over HTTP | `references/aspire-integration-testing.md` |

If the test only exercises a repository or query against Postgres, do not stand up the AppHost - a bare container is faster to start and simpler to reason about.

## Packages

Use the database-specific module, not the generic `Testcontainers` builder - the module ships the image default, the wait strategy, and a typed connection string, so you write less and get the readiness check for free.

```xml
<PackageReference Include="Testcontainers.PostgreSql" />
<PackageReference Include="Npgsql" />
<PackageReference Include="Respawn" />
<PackageReference Include="xunit" />
<PackageReference Include="xunit.runner.visualstudio" />
<PackageReference Include="FluentAssertions" />   <!-- the hub's default assertion library - pin 7.x in Directory.Packages.props -->
```

Versions live in `Directory.Packages.props` (central package management), never on the reference.

## The fixture: IAsyncLifetime + PostgreSqlBuilder

Build and start the container in `InitializeAsync`, stop it in `DisposeAsync`, and expose the connection string the module hands you (dynamic host port already resolved - never hard-code 5432). The module's built-in wait strategy blocks `StartAsync` until Postgres accepts connections, so there is no `Task.Delay` guess.

```csharp
using Testcontainers.PostgreSql;

public sealed class PostgresFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .Build();

    public string ConnectionString => _container.GetConnectionString();

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await RunMigrationsAsync(connection);   // EF MigrateAsync, DbUp, or raw DDL
    }

    public Task DisposeAsync() => _container.StopAsync();
}
```

## One container per suite, not per test

A container costs 10-30s to start; a fresh one per test is the single biggest waste in an integration suite. Share one across a whole test class with a collection fixture so it boots once. `[CollectionDefinition]` binds the fixture; every `[Collection]`-tagged class reuses the same instance.

```csharp
[CollectionDefinition("postgres")]
public sealed class PostgresCollection : ICollectionFixture<PostgresFixture> { }

[Collection("postgres")]
public sealed class OrderRepositoryTests(PostgresFixture fixture)
{
    [Fact]
    public async Task GetOrder_Returns_Persisted_Row()
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using (var seed = new NpgsqlCommand(
            "INSERT INTO orders (id, customer_id, total) VALUES (1, 'CUST1', 100.00)", connection))
        {
            await seed.ExecuteNonQueryAsync();
        }

        var repo = new OrderRepository(connection);
        var order = await repo.GetOrderAsync(1);

        order.CustomerId.Should().Be("CUST1");
    }
}
```

Use `IClassFixture<PostgresFixture>` instead when only one class needs the container; reach for a collection once two or more classes should share the same boot.

## Reset between tests with Respawn

A shared container leaks rows across tests within a run. Respawn deletes all data while keeping the schema, so each test starts empty without a container rebuild - far cheaper than a fresh container and, unlike a transaction rollback, it still lets a test assert real commit behavior. Build the checkpoint once in the fixture's `InitializeAsync` (after the migrations ran) and expose a `ResetAsync()`; Postgres needs an open `DbConnection` for both calls - the connection-string overload is SQL Server only:

```csharp
using Respawn;
using Respawn.Graph;

// in PostgresFixture.InitializeAsync, after RunMigrationsAsync (field: private Respawner? _respawner;)
_respawner = await Respawner.CreateAsync(connection, new RespawnerOptions
{
    DbAdapter = DbAdapter.Postgres,
    TablesToIgnore = new Table[] { "__EFMigrationsHistory" }
});

public async Task ResetAsync()
{
    await using var connection = new NpgsqlConnection(ConnectionString);
    await connection.OpenAsync();
    await _respawner!.ResetAsync(connection);
}
```

Call it from the test class constructor (or its own `InitializeAsync`) for per-test clean state:

```csharp
[Collection("postgres")]
public sealed class OrderTests(PostgresFixture fixture) : IAsyncLifetime
{
    public Task InitializeAsync() => fixture.ResetAsync();
    public Task DisposeAsync() => Task.CompletedTask;
}
```

## Pitfalls

| Problem | Fix |
|---|---|
| Fresh container per test, suite crawls | Share one via a collection fixture; reset with Respawn |
| Port already in use | Never bind a fixed port - the module maps a dynamic one; read `GetConnectionString()` |
| Flaky startup / `Task.Delay` to wait | The module's wait strategy already blocks `StartAsync` until ready |
| Passes locally, fails in CI | Run on a Docker-enabled runner (GitHub's ubuntu-latest ships Docker) |
