using Npgsql;
using Testcontainers.PostgreSql;

namespace LendingDesk.IntegrationTests.Infrastructure;

/// <summary>One PostgreSQL container per test run; every test class gets a database of its own in it.</summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:17-alpine").Build();

    public async Task InitializeAsync() => await _container.StartAsync();

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public async Task<string> CreateDatabaseAsync()
    {
        var name = $"lending_{Guid.NewGuid():N}";
        await using var connection = new NpgsqlConnection(_container.GetConnectionString());
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"CREATE DATABASE \"{name}\"", connection);
        await command.ExecuteNonQueryAsync();
        return new NpgsqlConnectionStringBuilder(_container.GetConnectionString()) { Database = name }.ConnectionString;
    }
}

[CollectionDefinition(Name)]
public sealed class DatabaseGroup : ICollectionFixture<PostgresFixture>
{
    public const string Name = "database";
}
