using LendingDesk.Data;
using LendingDesk.IntegrationTests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace LendingDesk.IntegrationTests.Hidden.Data02;

/// <summary>IX_Loans_DueDate_Id on Loans ("DueDate", "Id"), added by a migration of its own after the existing ones.</summary>
[Collection(DatabaseGroup.Name)]
public sealed class Data02FeedIndexTests(PostgresFixture postgres) : IAsyncLifetime
{
    private static readonly string[] ExistingMigrations =
    [
        "20260923000134_InitialCreate",
        "20260923000430_AddLoans",
        "20260923000538_AddItemCondition",
        "20260923000608_AddMemberStatus",
        "20260923000651_AddOutbox",
        "20260923001340_AddNotices",
    ];

    private string _connectionString = null!;

    public async Task InitializeAsync() => _connectionString = await postgres.CreateDatabaseAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task The_due_date_and_id_index_arrives_in_a_new_migration()
    {
        await using var db = new LendingDbContext(new DbContextOptionsBuilder<LendingDbContext>().UseNpgsql(_connectionString).Options);
        var migrations = db.Database.GetMigrations().ToList();
        Assert.Equal(ExistingMigrations, migrations.Take(ExistingMigrations.Length));
        Assert.True(migrations.Count > ExistingMigrations.Length, "No migration was added after AddNotices.");

        await db.GetService<IMigrator>().MigrateAsync(ExistingMigrations[^1]);
        Assert.Null(await IndexAsync());

        await db.Database.MigrateAsync();
        var index = await IndexAsync();
        Assert.NotNull(index);
        Assert.Equal(("Loans", "btree", "DueDate,Id", "0,0", false), index.Value);
    }

    /// <summary>Table, access method, key columns in order, per-column options (0 = ascending) and whether it is partial or on expressions.</summary>
    private async Task<(string Table, string Method, string Columns, string Options, bool PartialOrExpression)?> IndexAsync()
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            """
            SELECT t.relname,
                   am.amname,
                   array_to_string(ARRAY(
                       SELECT a.attname
                       FROM unnest(ix.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
                       JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
                       ORDER BY k.ord), ','),
                   array_to_string(ix.indoption::int2[], ','),
                   ix.indpred IS NOT NULL OR ix.indexprs IS NOT NULL
            FROM pg_class i
            JOIN pg_index ix ON ix.indexrelid = i.oid
            JOIN pg_class t ON t.oid = ix.indrelid
            JOIN pg_am am ON am.oid = i.relam
            WHERE i.relname = 'IX_Loans_DueDate_Id'
            """,
            connection);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return null;
        }

        return (reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetBoolean(4));
    }
}
