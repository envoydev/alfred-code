using LendingDesk.Data;
using LendingDesk.IntegrationTests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace LendingDesk.IntegrationTests.Hidden.Data01;

/// <summary>
/// Walks a database through the expand, backfill and contract migrations one at a time, and plays the
/// statements today's code sends (insert naming IsRetired, retire by setting IsRetired, read IsRetired)
/// between the steps.
/// </summary>
[Collection(DatabaseGroup.Name)]
public sealed class Data01MigrationTests(PostgresFixture postgres) : IAsyncLifetime
{
    private static readonly DateTimeOffset T0 = new(2026, 1, 5, 10, 0, 0, TimeSpan.Zero);

    private static readonly string[] ExpectedMigrations =
    [
        "InitialCreate",
        "AddLoans",
        "AddItemCondition",
        "AddMemberStatus",
        "AddOutbox",
        "AddNotices",
        "AddItemRetiredAt",
        "BackfillItemRetiredAt",
        "DropItemIsRetired",
    ];

    private string _connectionString = null!;

    public async Task InitializeAsync() => _connectionString = await postgres.CreateDatabaseAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Exactly_three_migrations_follow_AddNotices_in_the_stated_order()
    {
        await using var db = NewDb();

        Assert.Equal(ExpectedMigrations, db.Database.GetMigrations().Select(NameOf));

        await db.Database.MigrateAsync();
        Assert.Equal(ExpectedMigrations, (await db.Database.GetAppliedMigrationsAsync()).Select(NameOf));
    }

    [Fact]
    public async Task Expand_adds_a_nullable_timestamptz_RetiredAt_and_changes_no_data()
    {
        await MigrateToAsync("AddNotices");
        var inUse = await InsertOldWayAsync("D01-A", T0);
        var retired = await InsertOldWayAsync("D01-B", T0.AddDays(1));
        await RetireOldWayAsync(retired);
        var rowsBefore = await ItemRowsAsync();
        var isRetiredBefore = await ColumnAsync("IsRetired");

        await MigrateToAsync("AddItemRetiredAt");

        await AssertNullableTimestamptzRetiredAtAsync();
        Assert.Equal(isRetiredBefore, await ColumnAsync("IsRetired"));
        Assert.Equal(rowsBefore, await ItemRowsAsync());
        var retiredAt = await RetiredAtAsync();
        Assert.Null(retiredAt[inUse]);
        Assert.Null(retiredAt[retired]);
    }

    [Fact]
    public async Task Todays_code_keeps_working_after_expand_and_after_backfill()
    {
        await MigrateToAsync("AddNotices");
        var a = await InsertOldWayAsync("D01-A", T0);

        await MigrateToAsync("AddItemRetiredAt");
        var b = await InsertOldWayAsync("D01-B", T0.AddDays(1));
        await RetireOldWayAsync(a);
        Assert.Equal(new Dictionary<int, bool> { [a] = true, [b] = false }, await IsRetiredAsync());
        Assert.Equal([b], await ActiveIdsOldWayAsync());

        await MigrateToAsync("BackfillItemRetiredAt");
        var c = await InsertOldWayAsync("D01-C", T0.AddDays(2));
        await RetireOldWayAsync(b);
        Assert.Equal(new Dictionary<int, bool> { [a] = true, [b] = true, [c] = false }, await IsRetiredAsync());
        Assert.Equal([c], await ActiveIdsOldWayAsync());
    }

    [Fact]
    public async Task Backfill_dates_retired_items_by_CreatedAt_and_changes_no_schema()
    {
        await MigrateToAsync("AddNotices");
        var inUse = await InsertOldWayAsync("D01-A", T0);
        var retiredBeforeExpand = await InsertOldWayAsync("D01-B", T0.AddDays(1));
        await RetireOldWayAsync(retiredBeforeExpand);

        await MigrateToAsync("AddItemRetiredAt");
        var retiredAfterExpand = await InsertOldWayAsync("D01-C", T0.AddDays(2));
        await RetireOldWayAsync(retiredAfterExpand);
        var alreadyDated = await InsertOldWayAsync("D01-D", T0.AddDays(3));
        await RetireOldWayAsync(alreadyDated);
        var datedAt = T0.AddDays(10);
        await SetRetiredAtAsync(alreadyDated, datedAt);
        var inUseAfterExpand = await InsertOldWayAsync("D01-E", T0.AddDays(4));
        var schemaBefore = await ItemsSchemaAsync();

        await MigrateToAsync("BackfillItemRetiredAt");

        Assert.Equal(schemaBefore, await ItemsSchemaAsync());
        var retiredAt = await RetiredAtAsync();
        Assert.Null(retiredAt[inUse]);
        Assert.Equal(T0.AddDays(1), retiredAt[retiredBeforeExpand]);
        Assert.Equal(T0.AddDays(2), retiredAt[retiredAfterExpand]);
        Assert.Equal(datedAt, retiredAt[alreadyDated]);
        Assert.Null(retiredAt[inUseAfterExpand]);
        Assert.Equal(
            new Dictionary<int, bool>
            {
                [inUse] = false,
                [retiredBeforeExpand] = true,
                [retiredAfterExpand] = true,
                [alreadyDated] = true,
                [inUseAfterExpand] = false,
            },
            await IsRetiredAsync());
    }

    [Fact]
    public async Task Contract_dates_late_retirements_adds_the_check_and_drops_IsRetired()
    {
        await MigrateToAsync("AddNotices");
        var inUse = await InsertOldWayAsync("D01-A", T0);
        var retiredEarly = await InsertOldWayAsync("D01-B", T0.AddDays(1));
        await RetireOldWayAsync(retiredEarly);
        await MigrateToAsync("AddItemRetiredAt");
        await MigrateToAsync("BackfillItemRetiredAt");

        // The version still running keeps retiring the old way after the backfill ran.
        var retiredLate = await InsertOldWayAsync("D01-C", T0.AddDays(2));
        await RetireOldWayAsync(retiredLate);
        var alreadyDated = await InsertOldWayAsync("D01-D", T0.AddDays(3));
        await RetireOldWayAsync(alreadyDated);
        var datedAt = T0.AddDays(10);
        await SetRetiredAtAsync(alreadyDated, datedAt);
        var createdLate = await InsertOldWayAsync("D01-E", T0.AddDays(4));

        await using (var db = NewDb())
        {
            await db.Database.MigrateAsync();
            Assert.Equal(ExpectedMigrations, (await db.Database.GetAppliedMigrationsAsync()).Select(NameOf));
        }

        Assert.Null(await ColumnAsync("IsRetired"));
        await AssertNullableTimestamptzRetiredAtAsync();
        var retiredAt = await RetiredAtAsync();
        Assert.Null(retiredAt[inUse]);
        Assert.Equal(T0.AddDays(1), retiredAt[retiredEarly]);
        Assert.Equal(T0.AddDays(2), retiredAt[retiredLate]);
        Assert.Equal(datedAt, retiredAt[alreadyDated]);
        Assert.Null(retiredAt[createdLate]);
        Assert.Contains("CK_Items_RetiredAt", await CheckConstraintsAsync());
    }

    [Fact]
    public async Task CK_Items_RetiredAt_allows_null_or_a_time_not_earlier_than_CreatedAt()
    {
        await using (var db = NewDb())
        {
            await db.Database.MigrateAsync();
        }

        var id = await ScalarAsync<int>(
            """
            INSERT INTO "Items" ("Category", "CreatedAt", "Name", "Sku", "TotalStock")
            VALUES ('Tools', @createdAt, 'Check item', 'D01-CHECK', 1) RETURNING "Id"
            """,
            ("createdAt", T0));

        var early = await Assert.ThrowsAsync<PostgresException>(() => SetRetiredAtAsync(id, T0.AddSeconds(-1)));
        Assert.Equal(PostgresErrorCodes.CheckViolation, early.SqlState);
        Assert.Equal("CK_Items_RetiredAt", early.ConstraintName);

        await SetRetiredAtAsync(id, T0);
        await SetRetiredAtAsync(id, T0.AddDays(1));
        await SetRetiredAtAsync(id, null);

        var insertEarly = await Assert.ThrowsAsync<PostgresException>(() => ScalarAsync<int>(
            """
            INSERT INTO "Items" ("Category", "CreatedAt", "Name", "Sku", "TotalStock", "RetiredAt")
            VALUES ('Tools', @createdAt, 'Early item', 'D01-EARLY', 1, @retiredAt) RETURNING "Id"
            """,
            ("createdAt", T0),
            ("retiredAt", T0.AddMinutes(-5))));
        Assert.Equal(PostgresErrorCodes.CheckViolation, insertEarly.SqlState);
        Assert.Equal("CK_Items_RetiredAt", insertEarly.ConstraintName);
    }

    /// <summary>RetiredAt is a nullable timestamptz with no default other than NULL.</summary>
    private async Task AssertNullableTimestamptzRetiredAtAsync()
    {
        var column = await ColumnAsync("RetiredAt");
        Assert.True(column is not null, "Items has no RetiredAt column.");
        Assert.Equal("timestamp with time zone", column.Value.Type);
        Assert.Equal("YES", column.Value.Nullable);
        Assert.True(
            column.Value.Default is null || column.Value.Default.StartsWith("NULL", StringComparison.OrdinalIgnoreCase),
            $"RetiredAt has a default: {column.Value.Default}");
    }

    private static string NameOf(string migrationId) => migrationId[(migrationId.IndexOf('_', StringComparison.Ordinal) + 1)..];

    private LendingDbContext NewDb() =>
        new(new DbContextOptionsBuilder<LendingDbContext>().UseNpgsql(_connectionString).Options);

    private async Task MigrateToAsync(string name)
    {
        await using var db = NewDb();
        var matches = db.Database.GetMigrations().Where(m => NameOf(m) == name).ToList();
        Assert.True(matches.Count == 1, $"Expected exactly one migration named {name}; found: {string.Join(", ", db.Database.GetMigrations())}");
        await db.GetService<IMigrator>().MigrateAsync(matches[0]);
    }

    /// <summary>The insert today's code sends: it names IsRetired and never RetiredAt.</summary>
    private Task<int> InsertOldWayAsync(string sku, DateTimeOffset createdAt) =>
        ScalarAsync<int>(
            """
            INSERT INTO "Items" ("Category", "CreatedAt", "IsRetired", "Name", "Sku", "TotalStock")
            VALUES ('Tools', @createdAt, FALSE, @name, @sku, 1) RETURNING "Id"
            """,
            ("createdAt", createdAt),
            ("name", $"Item {sku}"),
            ("sku", sku));

    /// <summary>How today's code retires an item: it sets IsRetired and nothing else.</summary>
    private async Task RetireOldWayAsync(int id) =>
        Assert.Equal(1, await ExecuteAsync("""UPDATE "Items" SET "IsRetired" = @isRetired WHERE "Id" = @id""", ("isRetired", true), ("id", id)));

    /// <summary>The default item list of today's code: items whose IsRetired is false.</summary>
    private async Task<List<int>> ActiveIdsOldWayAsync()
    {
        var ids = new List<int>();
        await using var connection = await OpenAsync();
        await using var command = new NpgsqlCommand("""SELECT i."Id" FROM "Items" AS i WHERE NOT (i."IsRetired") ORDER BY i."Name", i."Id" """, connection);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            ids.Add(reader.GetInt32(0));
        }

        return ids;
    }

    private async Task<Dictionary<int, bool>> IsRetiredAsync()
    {
        var result = new Dictionary<int, bool>();
        await using var connection = await OpenAsync();
        await using var command = new NpgsqlCommand("""SELECT "Id", "IsRetired" FROM "Items" """, connection);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            result[reader.GetInt32(0)] = reader.GetBoolean(1);
        }

        return result;
    }

    private async Task<Dictionary<int, DateTimeOffset?>> RetiredAtAsync()
    {
        var result = new Dictionary<int, DateTimeOffset?>();
        await using var connection = await OpenAsync();
        await using var command = new NpgsqlCommand("""SELECT "Id", "RetiredAt" FROM "Items" """, connection);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            result[reader.GetInt32(0)] = reader.IsDBNull(1) ? null : reader.GetFieldValue<DateTimeOffset>(1);
        }

        return result;
    }

    private Task<int> SetRetiredAtAsync(int id, DateTimeOffset? at) =>
        ExecuteAsync(
            """UPDATE "Items" SET "RetiredAt" = @at WHERE "Id" = @id""",
            ("at", at.HasValue ? (object)at.Value : DBNull.Value),
            ("id", id));

    /// <summary>Every item row, every column but RetiredAt, rendered as text.</summary>
    private async Task<List<string>> ItemRowsAsync()
    {
        var rows = new List<string>();
        await using var connection = await OpenAsync();
        await using var command = new NpgsqlCommand(
            """SELECT concat_ws('|', "Id", "Name", "Category", "Sku", "TotalStock", "IsRetired", "CreatedAt", "Condition") FROM "Items" ORDER BY "Id" """,
            connection);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(reader.GetString(0));
        }

        return rows;
    }

    /// <summary>The type, nullability and default of one Items column, or null when the column does not exist.</summary>
    private async Task<(string Type, string Nullable, string? Default)?> ColumnAsync(string column)
    {
        await using var connection = await OpenAsync();
        await using var command = new NpgsqlCommand(
            """
            SELECT data_type, is_nullable, column_default FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'Items' AND column_name = @column
            """,
            connection);
        command.Parameters.AddWithValue("column", column);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return null;
        }

        return (reader.GetString(0), reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetString(2));
    }

    /// <summary>Columns, constraints, indexes and triggers of the Items table.</summary>
    private async Task<List<string>> ItemsSchemaAsync()
    {
        var schema = new List<string>();
        await using var connection = await OpenAsync();
        await using var command = new NpgsqlCommand(
            """
            SELECT 'column ' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
            FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Items'
            UNION ALL
            SELECT 'constraint ' || conname || ' ' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = '"Items"'::regclass
            UNION ALL
            SELECT 'index ' || indexname || ' ' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Items'
            UNION ALL
            SELECT 'trigger ' || tgname FROM pg_trigger WHERE tgrelid = '"Items"'::regclass AND NOT tgisinternal
            ORDER BY 1
            """,
            connection);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            schema.Add(reader.GetString(0));
        }

        return schema;
    }

    private async Task<List<string>> CheckConstraintsAsync()
    {
        var names = new List<string>();
        await using var connection = await OpenAsync();
        await using var command = new NpgsqlCommand(
            """SELECT conname FROM pg_constraint WHERE conrelid = '"Items"'::regclass AND contype = 'c'""",
            connection);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            names.Add(reader.GetString(0));
        }

        return names;
    }

    private async Task<NpgsqlConnection> OpenAsync()
    {
        var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        return connection;
    }

    private async Task<int> ExecuteAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = await OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        return await command.ExecuteNonQueryAsync();
    }

    private async Task<T> ScalarAsync<T>(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = await OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        return (T)(await command.ExecuteScalarAsync())!;
    }
}
