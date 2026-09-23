using System.Net;
using System.Text.Json;
using LendingDesk.Data;
using LendingDesk.IntegrationTests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace LendingDesk.IntegrationTests.Hidden.HomeP1;

[Collection(DatabaseGroup.Name)]
public sealed class HomeP1ReturnConditionTests(PostgresFixture postgres) : IAsyncLifetime
{
    /// <summary>The newest migration before this change: a database at this point already has loans.</summary>
    private const string LastMigrationBeforeTheChange = "20260923001340_AddNotices";

    private LendingApiFactory _api = null!;
    private HttpClient _staff = null!;

    public async Task InitializeAsync()
    {
        _api = await LendingApiFactory.StartAsync(postgres);
        _staff = _api.ClientAs("staff");
    }

    public async Task DisposeAsync() => await _api.DisposeAsync();

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private static HashSet<string> PropertyNames(JsonElement body) =>
        body.EnumerateObject().Select(p => p.Name).ToHashSet(StringComparer.Ordinal);

    private async Task<(int MemberId, int ItemId)> SeedAsync(string condition = "Good", int stock = 1)
    {
        var suffix = Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
        var member = await _staff.PostJsonAsync("/api/members", new { name = $"Member {suffix}", email = $"m{suffix}@example.com" });
        var item = await _staff.PostJsonAsync("/api/items", new { name = $"Item {suffix}", category = "Tools", sku = $"RC-{suffix}", totalStock = stock, condition });
        Assert.Equal(HttpStatusCode.Created, member.StatusCode);
        Assert.Equal(HttpStatusCode.Created, item.StatusCode);
        return ((await JsonAsync(member)).GetProperty("id").GetInt32(), (await JsonAsync(item)).GetProperty("id").GetInt32());
    }

    private async Task<JsonElement> LendAsync(int memberId, int itemId)
    {
        var response = await _staff.PostJsonAsync("/api/loans", new
        {
            itemId,
            memberId,
            startDate = _api.Clock.Today,
            dueDate = _api.Clock.Today.AddDays(7),
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await JsonAsync(response);
    }

    private Task<HttpResponseMessage> ReturnAsync(int loanId, object? body) =>
        body is null
            ? _staff.PostAsync($"/api/loans/{loanId}/return", null)
            : _staff.PostJsonAsync($"/api/loans/{loanId}/return", body);

    private async Task<JsonElement> ReturnOkAsync(int loanId, object? body)
    {
        var response = await ReturnAsync(loanId, body);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await JsonAsync(response);
    }

    private async Task<string?> ItemConditionAsync(int itemId) =>
        (await JsonAsync(await _staff.GetAsync($"/api/items/{itemId}"))).GetProperty("condition").GetString();

    private static void AssertRecorded(JsonElement loan, string? condition, string? note)
    {
        Assert.True(loan.TryGetProperty("returnCondition", out var returnCondition), $"No returnCondition in: {loan}");
        Assert.True(loan.TryGetProperty("returnNote", out var returnNote), $"No returnNote in: {loan}");
        if (condition is null)
        {
            Assert.Equal(JsonValueKind.Null, returnCondition.ValueKind);
        }
        else
        {
            Assert.Equal(condition, returnCondition.GetString());
        }

        if (note is null)
        {
            Assert.Equal(JsonValueKind.Null, returnNote.ValueKind);
        }
        else
        {
            Assert.Equal(note, returnNote.GetString());
        }
    }

    /// <summary>Every place the API returns this loan: by id, the loan list, and the member's loans.</summary>
    private async Task<List<JsonElement>> EveryReadOfAsync(int loanId, int memberId)
    {
        var byId = await JsonAsync(await _staff.GetAsync($"/api/loans/{loanId}"));
        var list = await JsonAsync(await _staff.GetAsync($"/api/loans?memberId={memberId}&pageSize=100"));
        var forMember = await JsonAsync(await _staff.GetAsync($"/api/members/{memberId}/loans"));
        return
        [
            byId,
            list.GetProperty("items").EnumerateArray().Single(l => l.GetProperty("id").GetInt32() == loanId),
            forMember.EnumerateArray().Single(l => l.GetProperty("id").GetInt32() == loanId),
        ];
    }

    [Fact]
    public async Task Returning_with_no_body_works_as_before_and_records_nothing()
    {
        var (memberId, itemId) = await SeedAsync(condition: "Worn");
        var loanId = (await LendAsync(memberId, itemId)).GetProperty("id").GetInt32();

        var returned = await ReturnOkAsync(loanId, body: null);

        Assert.Equal("Returned", returned.GetProperty("status").GetString());
        Assert.Equal(_api.Clock.Now, returned.GetProperty("returnedAt").GetDateTimeOffset());
        AssertRecorded(returned, condition: null, note: null);
        Assert.Equal("Worn", await ItemConditionAsync(itemId));
        Assert.All(await EveryReadOfAsync(loanId, memberId), l => AssertRecorded(l, condition: null, note: null));
    }

    [Fact]
    public async Task An_empty_body_records_nothing()
    {
        var (memberId, itemId) = await SeedAsync(condition: "Worn");
        var loanId = (await LendAsync(memberId, itemId)).GetProperty("id").GetInt32();

        var returned = await ReturnOkAsync(loanId, new { });

        Assert.Equal("Returned", returned.GetProperty("status").GetString());
        AssertRecorded(returned, condition: null, note: null);
        Assert.Equal("Worn", await ItemConditionAsync(itemId));
    }

    [Fact]
    public async Task Loans_that_are_not_returned_carry_no_condition_and_no_note()
    {
        var (memberId, itemId) = await SeedAsync();

        var created = await LendAsync(memberId, itemId);
        var loanId = created.GetProperty("id").GetInt32();

        AssertRecorded(created, condition: null, note: null);
        Assert.All(await EveryReadOfAsync(loanId, memberId), l => AssertRecorded(l, condition: null, note: null));
    }

    [Fact]
    public async Task The_condition_and_note_are_stored_on_the_loan_and_shown_wherever_it_is_returned()
    {
        var (memberId, itemId) = await SeedAsync(condition: "Good");
        var loanId = (await LendAsync(memberId, itemId)).GetProperty("id").GetInt32();

        var returned = await ReturnOkAsync(loanId, new { condition = "Worn", note = "Scratched lid" });

        Assert.Equal("Returned", returned.GetProperty("status").GetString());
        AssertRecorded(returned, condition: "Worn", note: "Scratched lid");
        Assert.All(await EveryReadOfAsync(loanId, memberId), l => AssertRecorded(l, condition: "Worn", note: "Scratched lid"));
        Assert.Equal("Worn", await ItemConditionAsync(itemId));
    }

    [Fact]
    public async Task An_item_that_comes_back_damaged_cannot_be_lent_again()
    {
        var (memberId, itemId) = await SeedAsync(condition: "Good", stock: 2);
        var loanId = (await LendAsync(memberId, itemId)).GetProperty("id").GetInt32();

        var returned = await ReturnOkAsync(loanId, new { condition = "Damaged" });

        AssertRecorded(returned, condition: "Damaged", note: null);
        Assert.Equal("Damaged", await ItemConditionAsync(itemId));
        var again = await _staff.PostJsonAsync("/api/loans", new { itemId, memberId, startDate = _api.Clock.Today, dueDate = _api.Clock.Today.AddDays(3) });
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal("item_damaged", (await JsonAsync(again)).GetProperty("code").GetString());
    }

    [Fact]
    public async Task A_good_condition_restores_a_worn_item()
    {
        var (memberId, itemId) = await SeedAsync(condition: "Worn");
        var loanId = (await LendAsync(memberId, itemId)).GetProperty("id").GetInt32();

        var returned = await ReturnOkAsync(loanId, new { condition = "Good" });

        AssertRecorded(returned, condition: "Good", note: null);
        Assert.Equal("Good", await ItemConditionAsync(itemId));
    }

    [Fact]
    public async Task A_note_without_a_condition_leaves_the_item_as_it_is()
    {
        var (memberId, itemId) = await SeedAsync(condition: "Worn");
        var loanId = (await LendAsync(memberId, itemId)).GetProperty("id").GetInt32();

        var returned = await ReturnOkAsync(loanId, new { note = "Brought back by a neighbour" });

        AssertRecorded(returned, condition: null, note: "Brought back by a neighbour");
        Assert.Equal("Worn", await ItemConditionAsync(itemId));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(" \t\n ")]
    public async Task An_empty_or_whitespace_note_counts_as_no_note(string note)
    {
        var (memberId, itemId) = await SeedAsync();
        var loanId = (await LendAsync(memberId, itemId)).GetProperty("id").GetInt32();

        var returned = await ReturnOkAsync(loanId, new { condition = "Worn", note });

        AssertRecorded(returned, condition: "Worn", note: null);
        Assert.All(await EveryReadOfAsync(loanId, memberId), l => AssertRecorded(l, condition: "Worn", note: null));
    }

    [Fact]
    public async Task A_note_of_exactly_500_characters_is_accepted()
    {
        var (memberId, itemId) = await SeedAsync();
        var loanId = (await LendAsync(memberId, itemId)).GetProperty("id").GetInt32();
        var note = new string('n', 500);

        var returned = await ReturnOkAsync(loanId, new { note });

        AssertRecorded(returned, condition: null, note: note);
        Assert.All(await EveryReadOfAsync(loanId, memberId), l => AssertRecorded(l, condition: null, note: note));
    }

    [Theory]
    [InlineData("Broken", 0)]
    [InlineData(null, 501)]
    [InlineData("Damaged", 501)]
    public async Task Invalid_input_is_answered_like_other_invalid_input_and_leaves_the_loan_unreturned(string? condition, int noteLength)
    {
        var (memberId, itemId) = await SeedAsync(condition: "Worn");
        var loanId = (await LendAsync(memberId, itemId)).GetProperty("id").GetInt32();
        var reference = await _staff.PostJsonAsync("/api/members", new { name = "", email = "not-an-email" });
        Assert.Equal(HttpStatusCode.BadRequest, reference.StatusCode);
        var expected = await JsonAsync(reference);
        object body = noteLength == 0 ? new { condition } : new { condition, note = new string('x', noteLength) };

        var response = await ReturnAsync(loanId, body);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await JsonAsync(response);
        Assert.Equal(expected.GetProperty("code").GetString(), problem.GetProperty("code").GetString());
        Assert.Equal(PropertyNames(expected), PropertyNames(problem));
        Assert.NotEmpty(problem.GetProperty("errors").EnumerateObject());

        var loan = await JsonAsync(await _staff.GetAsync($"/api/loans/{loanId}"));
        Assert.Equal("Active", loan.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, loan.GetProperty("returnedAt").ValueKind);
        AssertRecorded(loan, condition: null, note: null);
        Assert.Equal("Worn", await ItemConditionAsync(itemId));

        var returned = await ReturnOkAsync(loanId, body: null);
        Assert.Equal("Returned", returned.GetProperty("status").GetString());
    }

    [Fact]
    public async Task A_database_that_already_has_loans_upgrades_in_place_and_its_loans_have_no_condition_or_note()
    {
        var connectionString = await postgres.CreateDatabaseAsync();
        var options = new DbContextOptionsBuilder<LendingDbContext>().UseNpgsql(connectionString).Options;
        await using (var db = new LendingDbContext(options))
        {
            await db.Database.MigrateAsync(LastMigrationBeforeTheChange);
            await db.Database.ExecuteSqlRawAsync(
                """
                INSERT INTO "Members" ("Name", "Email", "CreatedAt") VALUES ('Old Member', 'old.member@example.com', TIMESTAMPTZ '2026-03-01 09:00:00+00');
                INSERT INTO "Items" ("Name", "Category", "Sku", "TotalStock", "IsRetired", "CreatedAt", "Condition") VALUES ('Old drill', 'Tools', 'OLD-DRILL', 2, false, TIMESTAMPTZ '2026-03-01 09:00:00+00', 'Good');
                INSERT INTO "Loans" ("ItemId", "MemberId", "StartDate", "DueDate", "ReturnedAt", "CreatedAt")
                SELECT i."Id", m."Id", DATE '2026-03-02', DATE '2026-03-05', TIMESTAMPTZ '2026-03-04 10:00:00+00', TIMESTAMPTZ '2026-03-02 09:00:00+00'
                FROM "Items" i, "Members" m WHERE i."Sku" = 'OLD-DRILL' AND m."Email" = 'old.member@example.com';
                INSERT INTO "Loans" ("ItemId", "MemberId", "StartDate", "DueDate", "ReturnedAt", "CreatedAt")
                SELECT i."Id", m."Id", DATE '2026-03-08', DATE '2026-03-20', NULL, TIMESTAMPTZ '2026-03-08 09:00:00+00'
                FROM "Items" i, "Members" m WHERE i."Sku" = 'OLD-DRILL' AND m."Email" = 'old.member@example.com';
                """);
        }

        await using var upgraded = new LendingApiFactory(connectionString);
        await upgraded.WithDbAsync(async db =>
        {
            await db.Database.MigrateAsync();
            return 0;
        });
        var staff = upgraded.ClientAs("staff");

        var members = await JsonAsync(await staff.GetAsync("/api/members?pageSize=100"));
        var memberId = members.GetProperty("items").EnumerateArray()
            .Single(m => m.GetProperty("email").GetString() == "old.member@example.com")
            .GetProperty("id").GetInt32();
        var loansResponse = await staff.GetAsync($"/api/members/{memberId}/loans");
        Assert.Equal(HttpStatusCode.OK, loansResponse.StatusCode);
        var loans = (await JsonAsync(loansResponse)).EnumerateArray().ToList();
        Assert.Equal(2, loans.Count);
        Assert.All(loans, l => AssertRecorded(l, condition: null, note: null));
        var listed = await JsonAsync(await staff.GetAsync("/api/loans?pageSize=100"));
        Assert.All(listed.GetProperty("items").EnumerateArray(), l => AssertRecorded(l, condition: null, note: null));

        var open = loans.Single(l => l.GetProperty("returnedAt").ValueKind == JsonValueKind.Null);
        var openId = open.GetProperty("id").GetInt32();
        var response = await staff.PostJsonAsync($"/api/loans/{openId}/return", new { condition = "Worn", note = "Old but fine" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertRecorded(await JsonAsync(response), condition: "Worn", note: "Old but fine");
        var itemId = open.GetProperty("itemId").GetInt32();
        Assert.Equal("Worn", (await JsonAsync(await staff.GetAsync($"/api/items/{itemId}"))).GetProperty("condition").GetString());
    }
}
