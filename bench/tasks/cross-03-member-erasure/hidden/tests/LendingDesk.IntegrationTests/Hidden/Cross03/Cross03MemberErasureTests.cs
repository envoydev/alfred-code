using System.Globalization;
using System.Net;
using LendingDesk.Api.Contracts;
using LendingDesk.IntegrationTests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LendingDesk.IntegrationTests.Hidden.Cross03;

/// <summary>
/// Hidden acceptance tests for cross-03: DELETE /api/members/{id} erases a member's name and email for good, keeps
/// their loans under 'Erased member', makes every other member route treat them as an id nobody has, and the worker
/// sends nothing more about their loans. The database is read with plain SQL and the worker runs from its own
/// Program, so no entity or worker type a solution may add is named.
/// </summary>
[Collection(DatabaseGroup.Name)]
public sealed class Cross03MemberErasureTests(PostgresFixture postgres) : IAsyncLifetime
{
    private const int NobodysId = 987654;
    private const string AdaName = "Ada Lovelace";
    private const string AdaEmail = "ada.lovelace@example.com";

    private LendingApiFactory _api = null!;
    private HttpClient _staff = null!;
    private HttpClient _admin = null!;
    private string _connectionString = null!;

    public async Task InitializeAsync()
    {
        _api = await LendingApiFactory.StartAsync(postgres);
        _staff = _api.ClientAs("staff");
        _admin = _api.ClientAs("admin");
        _connectionString = await _api.WithDbAsync(db => Task.FromResult(db.Database.GetConnectionString()!));
    }

    public async Task DisposeAsync() => await _api.DisposeAsync();

    [Fact]
    public async Task Erasing_answers_204_and_removes_the_name_and_email_from_every_column_of_the_database()
    {
        var ada = await CreateMemberAsync(AdaName, AdaEmail);
        await LendAndReturnAsync(ada.Id);

        var response = await _admin.DeleteAsync($"/api/members/{ada.Id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty(await ColumnsHoldingAsync("lovelace"));
        Assert.Empty(await ColumnsHoldingAsync(AdaEmail));
    }

    [Fact]
    public async Task The_email_is_free_again_and_any_number_of_members_can_be_erased()
    {
        var ada = await CreateMemberAsync(AdaName, AdaEmail);
        var grace = await CreateMemberAsync("Grace Hopper", "grace@example.com");
        var linus = await CreateMemberAsync("Linus Torvalds", "linus@example.org");
        Assert.Equal(HttpStatusCode.OK, (await _admin.PostAsync($"/api/members/{linus.Id}/suspend", null)).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await _admin.DeleteAsync($"/api/members/{ada.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await _admin.DeleteAsync($"/api/members/{grace.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await _admin.DeleteAsync($"/api/members/{linus.Id}")).StatusCode);
        var again = await _staff.PostJsonAsync("/api/members", new { name = "Ada Again", email = AdaEmail });

        Assert.Equal(HttpStatusCode.Created, again.StatusCode);
        Assert.NotEqual(ada.Id, (await again.ReadAsync<MemberDto>()).Id);
    }

    [Fact]
    public async Task The_loans_stay_with_their_dates_and_show_the_member_as_erased()
    {
        var ada = await CreateMemberAsync(AdaName, AdaEmail);
        var grace = await CreateMemberAsync("Grace Hopper", "grace@example.com");
        var adaLoan = await LendAndReturnAsync(ada.Id);
        var graceLoan = await LendAndReturnAsync(grace.Id);

        Assert.Equal(HttpStatusCode.NoContent, (await _admin.DeleteAsync($"/api/members/{ada.Id}")).StatusCode);
        var listed = await (await _staff.GetAsync("/api/loans?pageSize=100")).ReadAsync<PagedResult<LoanDto>>();
        var fetched = await (await _staff.GetAsync($"/api/loans/{adaLoan.Id}")).ReadAsync<LoanDto>();

        Assert.Equal(2, listed.TotalCount);
        var row = Assert.Single(listed.Items, l => l.Id == adaLoan.Id);
        Assert.Equal("Erased member", row.MemberName);
        Assert.Equal((adaLoan.StartDate, adaLoan.DueDate, adaLoan.ReturnedAt), (row.StartDate, row.DueDate, row.ReturnedAt));
        Assert.Equal("Erased member", fetched.MemberName);
        Assert.Equal(adaLoan.ReturnedAt, fetched.ReturnedAt);
        Assert.Equal("Grace Hopper", Assert.Single(listed.Items, l => l.Id == graceLoan.Id).MemberName);
    }

    [Fact]
    public async Task An_erased_member_is_not_listed_or_counted()
    {
        var ada = await CreateMemberAsync(AdaName, AdaEmail);
        var grace = await CreateMemberAsync("Grace Hopper", "grace@example.com");

        Assert.Equal(HttpStatusCode.NoContent, (await _admin.DeleteAsync($"/api/members/{ada.Id}")).StatusCode);
        var all = await (await _staff.GetAsync("/api/members")).ReadAsync<PagedResult<MemberDto>>();
        var active = await (await _staff.GetAsync("/api/members?status=Active")).ReadAsync<PagedResult<MemberDto>>();

        Assert.Equal([grace.Id], all.Items.Select(m => m.Id));
        Assert.Equal(1, all.TotalCount);
        Assert.Equal([grace.Id], active.Items.Select(m => m.Id));
        Assert.Equal(1, active.TotalCount);
    }

    [Fact]
    public async Task Every_member_route_answers_an_erased_member_like_an_id_nobody_has()
    {
        var ada = await CreateMemberAsync(AdaName, AdaEmail);
        await LendAndReturnAsync(ada.Id);
        var itemId = await CreateItemAsync();
        Assert.Equal(HttpStatusCode.NoContent, (await _admin.DeleteAsync($"/api/members/{ada.Id}")).StatusCode);

        await AssertLikeNobodyAsync(ada.Id, id => _staff.GetAsync($"/api/members/{id}"));
        await AssertLikeNobodyAsync(ada.Id, id => _staff.GetAsync($"/api/members/{id}/loans"));
        await AssertLikeNobodyAsync(ada.Id, id => _staff.PutJsonAsync($"/api/members/{id}", new { name = "Back", email = "back@example.com" }));
        await AssertLikeNobodyAsync(ada.Id, id => _admin.PostAsync($"/api/members/{id}/suspend", null));
        await AssertLikeNobodyAsync(ada.Id, id => _admin.DeleteAsync($"/api/members/{id}"));
        await AssertLikeNobodyAsync(ada.Id, id => _staff.PostJsonAsync("/api/loans", LoanBody(itemId, id)));
        Assert.Equal(1, await CountAsync("""SELECT count(*) FROM "Loans" """));
    }

    [Fact]
    public async Task A_member_with_a_loan_out_is_not_erased()
    {
        var ada = await CreateMemberAsync(AdaName, AdaEmail);
        await LendAndReturnAsync(ada.Id);
        var open = await _staff.PostJsonAsync("/api/loans", LoanBody(await CreateItemAsync(), ada.Id));
        Assert.Equal(HttpStatusCode.Created, open.StatusCode);

        var response = await _admin.DeleteAsync($"/api/members/{ada.Id}");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("member_has_open_loans", (await response.ReadAsync<Problem>()).Code);
        Assert.Equal(ada, await (await _staff.GetAsync($"/api/members/{ada.Id}")).ReadAsync<MemberDto>());
        Assert.Equal(1, await CountAsync($"""SELECT count(*) FROM "Members" WHERE "Email" = '{AdaEmail}' AND "Name" = '{AdaName}'"""));
    }

    [Fact]
    public async Task Only_admins_may_erase()
    {
        var ada = await CreateMemberAsync(AdaName, AdaEmail);

        var byStaff = await _staff.DeleteAsync($"/api/members/{ada.Id}");
        var byMember = await _api.ClientAs("member", AdaEmail).DeleteAsync($"/api/members/{ada.Id}");

        Assert.Equal(HttpStatusCode.Forbidden, byStaff.StatusCode);
        Assert.Equal("forbidden", (await byStaff.ReadAsync<Problem>()).Code);
        Assert.Equal(HttpStatusCode.Forbidden, byMember.StatusCode);
        Assert.Equal(ada, await (await _staff.GetAsync($"/api/members/{ada.Id}")).ReadAsync<MemberDto>());
    }

    [Fact]
    public async Task Events_waiting_in_the_outbox_send_nothing_about_an_erased_members_loans()
    {
        var ada = await CreateMemberAsync(AdaName, AdaEmail);
        var grace = await CreateMemberAsync("Grace Hopper", "grace@example.com");
        var adaLoan = await LendAndReturnAsync(ada.Id);
        var graceLoan = await LendAndReturnAsync(grace.Id);
        Assert.Equal(4, await CountAsync("""SELECT count(*) FROM "OutboxMessages" WHERE "ProcessedAt" IS NULL"""));

        Assert.Equal(HttpStatusCode.NoContent, (await _admin.DeleteAsync($"/api/members/{ada.Id}")).StatusCode);
        await Cross03WorkerHost.DrainOutboxAsync(_connectionString, _api.Clock);

        Assert.Equal(0, await CountAsync($"""SELECT count(*) FROM "Notices" WHERE "LoanId" = {adaLoan.Id}"""));
        Assert.Equal(2, await CountAsync($"""SELECT count(*) FROM "Notices" WHERE "LoanId" = {graceLoan.Id}"""));
        Assert.Equal(0, await CountAsync("""SELECT count(*) FROM "OutboxMessages" WHERE "ProcessedAt" IS NULL OR "LastError" IS NOT NULL OR "Attempts" > 0"""));
    }

    private static async Task AssertLikeNobodyAsync(int erasedId, Func<int, Task<HttpResponseMessage>> send)
    {
        var unknown = await send(NobodysId);
        var erased = await send(erasedId);

        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.True(erased.StatusCode == HttpStatusCode.NotFound, $"{erased.RequestMessage?.Method} {erased.RequestMessage?.RequestUri} for an erased member answered {(int)erased.StatusCode}, an unknown id answers 404");
        var expected = await unknown.ReadAsync<Problem>();
        var actual = await erased.ReadAsync<Problem>();
        var id = erasedId.ToString(CultureInfo.InvariantCulture);
        Assert.Equal(
            (expected.Title, expected.Code, expected.Detail?.Replace(NobodysId.ToString(CultureInfo.InvariantCulture), id, StringComparison.Ordinal)),
            (actual.Title, actual.Code, actual.Detail));
    }

    /// <summary>Every text-like column of every table holding <paramref name="needle"/>, ignoring case.</summary>
    private async Task<List<string>> ColumnsHoldingAsync(string needle)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        var columns = new List<(string Table, string Column)>();
        await using (var list = new NpgsqlCommand(
            """
            SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'jsonb', 'json', 'citext', 'USER-DEFINED')
            """,
            connection))
        await using (var reader = await list.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                columns.Add((reader.GetString(0), reader.GetString(1)));
            }
        }

        var holding = new List<string>();
        foreach (var (table, column) in columns)
        {
            await using var probe = new NpgsqlCommand($"""SELECT count(*) FROM "{table}" WHERE "{column}"::text ILIKE @needle""", connection);
            probe.Parameters.AddWithValue("needle", $"%{needle}%");
            if ((long)(await probe.ExecuteScalarAsync())! > 0)
            {
                holding.Add($"{table}.{column}");
            }
        }

        return holding;
    }

    private async Task<long> CountAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return (long)(await command.ExecuteScalarAsync())!;
    }

    private async Task<MemberDto> CreateMemberAsync(string name, string email)
    {
        var response = await _staff.PostJsonAsync("/api/members", new { name, email });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<MemberDto>();
    }

    private async Task<int> CreateItemAsync()
    {
        var sku = $"ER-{Guid.NewGuid().ToString("N")[..8]}".ToUpperInvariant();
        var response = await _staff.PostJsonAsync("/api/items", new { name = $"Item {sku}", category = "Tools", sku, totalStock = 3 });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.ReadAsync<ItemDto>()).Id;
    }

    /// <summary>Lends a new item to the member and takes it back an hour later, leaving both events in the outbox.</summary>
    private async Task<LoanDto> LendAndReturnAsync(int memberId)
    {
        var created = await _staff.PostJsonAsync("/api/loans", LoanBody(await CreateItemAsync(), memberId));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var loan = await created.ReadAsync<LoanDto>();
        _api.Clock.Now = _api.Clock.Now.AddHours(1);
        var returned = await _staff.PostAsync($"/api/loans/{loan.Id}/return", null);
        Assert.Equal(HttpStatusCode.OK, returned.StatusCode);
        return await returned.ReadAsync<LoanDto>();
    }

    private object LoanBody(int itemId, int memberId) => new
    {
        itemId,
        memberId,
        startDate = _api.Clock.Today,
        dueDate = _api.Clock.Today.AddDays(7),
    };
}
