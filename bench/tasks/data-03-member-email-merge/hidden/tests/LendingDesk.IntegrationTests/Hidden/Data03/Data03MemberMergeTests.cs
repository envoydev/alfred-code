using System.Net;
using LendingDesk.Data;
using LendingDesk.IntegrationTests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace LendingDesk.IntegrationTests.Hidden.Data03;

/// <summary>
/// Hidden acceptance tests for data-03: the migrations after AddNotices merge members whose emails differ only in
/// case or surrounding spaces, on a database that already holds such duplicates with loans and notices, and leave
/// the database refusing a case-only duplicate. Rows are seeded and read with plain SQL, so no entity shape a
/// solution may add is assumed.
/// </summary>
[Collection(DatabaseGroup.Name)]
public sealed class Data03MemberMergeTests(PostgresFixture postgres) : IAsyncLifetime
{
    private const string LastMigrationBeforeTask = "20260923001340_AddNotices";

    private string _connectionString = null!;

    public async Task InitializeAsync()
    {
        _connectionString = await postgres.CreateDatabaseAsync();
        await using (var db = NewDb())
        {
            await db.GetService<IMigrator>().MigrateAsync(LastMigrationBeforeTask);
        }

        await ExecuteAsync(Seed);
        await using (var db = NewDb())
        {
            await db.Database.MigrateAsync();
        }
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Each_group_of_duplicates_keeps_only_the_member_created_first()
    {
        var ids = await ColumnAsync<int>("""SELECT "Id" FROM "Members" ORDER BY "Id" """);

        // 102 is the oldest of 101-103 though not the lowest id; 104 and 105 share a CreatedAt, so the lower id stays.
        Assert.Equal([102, 104, 106, 107, 108], ids);
    }

    [Fact]
    public async Task The_kept_member_keeps_its_name_and_dates_and_inherits_a_suspension()
    {
        var ada = await MemberAsync(102);
        Assert.Equal(("Ada Lovelace", "ada@example.com", "Suspended", At(2025, 3, 1)), ada);

        var grace = await MemberAsync(104);
        Assert.Equal(("Grace Hopper", "grace@example.com", "Active", At(2025, 5, 5)), grace);
    }

    [Fact]
    public async Task Every_loan_moves_to_the_kept_member_and_is_otherwise_unchanged()
    {
        var loans = await RowsAsync(
            """SELECT "Id", "MemberId", "ItemId", "StartDate"::text, "DueDate"::text, "ReturnedAt" IS NOT NULL FROM "Loans" ORDER BY "Id" """,
            r => (r.GetInt32(0), r.GetInt32(1), r.GetInt32(2), r.GetString(3), r.GetString(4), r.GetBoolean(5)));

        Assert.Equal(
            [
                (301, 102, 201, "2025-07-01", "2025-07-10", true),
                (302, 102, 202, "2026-03-01", "2026-03-20", false),
                (303, 102, 201, "2026-02-01", "2026-02-15", false),
                (304, 102, 202, "2025-04-01", "2025-04-10", true),
                (305, 104, 201, "2026-03-05", "2026-03-19", false),
                (306, 108, 202, "2026-03-02", "2026-03-16", false),
            ],
            loans);
    }

    [Fact]
    public async Task Every_notice_stays_with_its_loan()
    {
        var notices = await RowsAsync(
            """SELECT "Id", "LoanId", "Kind" FROM "Notices" ORDER BY "Id" """,
            r => (r.GetInt64(0), r.GetInt32(1), r.GetString(2)));

        Assert.Equal(
            [
                (401L, 301, "Confirmation"),
                (402L, 301, "ReturnReceipt"),
                (403L, 302, "Confirmation"),
                (404L, 303, "Overdue"),
                (405L, 306, "Confirmation"),
            ],
            notices);
    }

    [Fact]
    public async Task Members_without_a_duplicate_only_get_their_email_normalized()
    {
        Assert.Equal(("Linus Torvalds", "linus@example.org", "Active", At(2025, 8, 8)), await MemberAsync(106));
        Assert.Equal(("Katherine Johnson", "katherine@example.com", "Suspended", At(2025, 2, 2)), await MemberAsync(107));
        Assert.Equal(("Margaret Hamilton", "margaret@example.com", "Active", At(2025, 1, 1)), await MemberAsync(108));
    }

    [Theory]
    [InlineData("GRACE@example.com")]
    [InlineData("Linus@Example.ORG")]
    [InlineData("ada@EXAMPLE.com")]
    public async Task The_database_refuses_an_email_that_differs_from_an_existing_one_only_in_case(string email)
    {
        var refused = await Assert.ThrowsAsync<PostgresException>(() => InsertMemberAsync(email));

        // Class 23 is PostgreSQL's integrity-constraint family: a unique index, a check or an exclusion constraint.
        Assert.StartsWith("23", refused.SqlState, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_database_still_takes_a_new_email()
    {
        await InsertMemberAsync("new.member@example.com");

        Assert.Equal(6, (await ColumnAsync<int>("""SELECT "Id" FROM "Members" """)).Count);
    }

    [Fact]
    public async Task The_api_still_answers_a_case_only_duplicate_with_409_duplicate()
    {
        await using var api = new LendingApiFactory(_connectionString);
        var staff = api.ClientAs("staff");

        var created = await staff.PostJsonAsync("/api/members", new { name = "Ada Again", email = "ADA@Example.com" });
        var updated = await staff.PutJsonAsync("/api/members/104", new { name = "Grace Hopper", email = " Ada@example.COM " });

        Assert.Equal(HttpStatusCode.Conflict, created.StatusCode);
        Assert.Equal("duplicate", (await created.ReadAsync<Problem>()).Code);
        Assert.Equal(HttpStatusCode.Conflict, updated.StatusCode);
        Assert.Equal("duplicate", (await updated.ReadAsync<Problem>()).Code);
    }

    [Fact]
    public async Task The_api_lists_the_moved_loans_under_the_kept_member()
    {
        await using var api = new LendingApiFactory(_connectionString);
        var staff = api.ClientAs("staff");

        var response = await staff.GetAsync("/api/members/102/loans");
        var gone = await staff.GetAsync("/api/members/101");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var loans = await response.ReadAsync<List<LoanRow>>();
        Assert.Equal([301, 302, 303, 304], loans.Select(l => l.Id).Order());
        Assert.All(loans, l => Assert.Equal("Ada Lovelace", l.MemberName));
        Assert.Equal(HttpStatusCode.NotFound, gone.StatusCode);
    }

    [Fact]
    public async Task The_migrations_run_on_an_empty_database_too()
    {
        var empty = await postgres.CreateDatabaseAsync();
        await using (var db = new LendingDbContext(new DbContextOptionsBuilder<LendingDbContext>().UseNpgsql(empty).Options))
        {
            await db.Database.MigrateAsync();
        }

        await using var connection = new NpgsqlConnection(empty);
        await connection.OpenAsync();
        await using var insert = new NpgsqlCommand(
            """INSERT INTO "Members" ("Name", "Email", "Status", "CreatedAt") VALUES ('One', 'one@example.com', 'Active', now())""",
            connection);
        await insert.ExecuteNonQueryAsync();
        await using var again = new NpgsqlCommand(
            """INSERT INTO "Members" ("Name", "Email", "Status", "CreatedAt") VALUES ('Two', 'One@Example.com', 'Active', now())""",
            connection);
        var refused = await Assert.ThrowsAsync<PostgresException>(() => again.ExecuteNonQueryAsync());
        Assert.StartsWith("23", refused.SqlState, StringComparison.Ordinal);
    }

    private sealed record LoanRow(int Id, string MemberName);

    // Ids start at 101 and the sequences are moved past them, so rows the API or a test adds later never collide.
    private const string Seed = """
        INSERT INTO "Items" ("Id", "Name", "Category", "Sku", "TotalStock", "Condition", "IsRetired", "CreatedAt") VALUES
            (201, 'Cordless drill', 'Tools', 'TL-201', 5, 'Good', false, '2025-01-01T00:00:00Z'),
            (202, 'Ladder', 'Tools', 'LD-202', 5, 'Good', false, '2025-01-01T00:00:00Z');
        INSERT INTO "Members" ("Id", "Name", "Email", "Status", "CreatedAt") VALUES
            (101, 'Ada L.', 'Ada@Example.com', 'Suspended', '2025-06-01T10:00:00Z'),
            (102, 'Ada Lovelace', ' ada@example.com', 'Active', '2025-03-01T10:00:00Z'),
            (103, 'ADA', 'ADA@EXAMPLE.COM ', 'Active', '2025-09-01T10:00:00Z'),
            (104, 'Grace Hopper', 'grace@example.com', 'Active', '2025-05-05T10:00:00Z'),
            (105, 'Grace H.', 'Grace@example.com', 'Active', '2025-05-05T10:00:00Z'),
            (106, 'Linus Torvalds', ' Linus@Example.org ', 'Active', '2025-08-08T10:00:00Z'),
            (107, 'Katherine Johnson', 'katherine@example.com', 'Suspended', '2025-02-02T10:00:00Z'),
            (108, 'Margaret Hamilton', 'margaret@example.com', 'Active', '2025-01-01T10:00:00Z');
        INSERT INTO "Loans" ("Id", "ItemId", "MemberId", "StartDate", "DueDate", "ReturnedAt", "CreatedAt") VALUES
            (301, 201, 101, '2025-07-01', '2025-07-10', '2025-07-09T12:00:00Z', '2025-07-01T09:00:00Z'),
            (302, 202, 101, '2026-03-01', '2026-03-20', NULL, '2026-03-01T09:00:00Z'),
            (303, 201, 103, '2026-02-01', '2026-02-15', NULL, '2026-02-01T09:00:00Z'),
            (304, 202, 102, '2025-04-01', '2025-04-10', '2025-04-10T12:00:00Z', '2025-04-01T09:00:00Z'),
            (305, 201, 105, '2026-03-05', '2026-03-19', NULL, '2026-03-05T09:00:00Z'),
            (306, 202, 108, '2026-03-02', '2026-03-16', NULL, '2026-03-02T09:00:00Z');
        INSERT INTO "Notices" ("Id", "LoanId", "Kind", "SentAt") VALUES
            (401, 301, 'Confirmation', '2025-07-01T09:05:00Z'),
            (402, 301, 'ReturnReceipt', '2025-07-09T12:05:00Z'),
            (403, 302, 'Confirmation', '2026-03-01T09:05:00Z'),
            (404, 303, 'Overdue', '2026-02-16T06:00:00Z'),
            (405, 306, 'Confirmation', '2026-03-02T09:05:00Z');
        SELECT setval(pg_get_serial_sequence('"Items"', 'Id'), 1000);
        SELECT setval(pg_get_serial_sequence('"Members"', 'Id'), 1000);
        SELECT setval(pg_get_serial_sequence('"Loans"', 'Id'), 1000);
        SELECT setval(pg_get_serial_sequence('"Notices"', 'Id'), 1000);
        """;

    private static DateTimeOffset At(int year, int month, int day) => new(year, month, day, 10, 0, 0, TimeSpan.Zero);

    private LendingDbContext NewDb() =>
        new(new DbContextOptionsBuilder<LendingDbContext>().UseNpgsql(_connectionString).Options);

    private async Task ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    private Task InsertMemberAsync(string email) =>
        ExecuteAsync($"""INSERT INTO "Members" ("Name", "Email", "Status", "CreatedAt") VALUES ('Imported', '{email}', 'Active', now())""");

    private async Task<(string Name, string Email, string Status, DateTimeOffset CreatedAt)> MemberAsync(int id)
    {
        var rows = await RowsAsync(
            $"""SELECT "Name", "Email", "Status", "CreatedAt" FROM "Members" WHERE "Id" = {id}""",
            r => (r.GetString(0), r.GetString(1), r.GetString(2), r.GetFieldValue<DateTimeOffset>(3)));
        return Assert.Single(rows);
    }

    private async Task<List<T>> ColumnAsync<T>(string sql) => await RowsAsync(sql, r => r.GetFieldValue<T>(0));

    private async Task<List<T>> RowsAsync<T>(string sql, Func<NpgsqlDataReader, T> read)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<T>();
        while (await reader.ReadAsync())
        {
            rows.Add(read(reader));
        }

        return rows;
    }
}
