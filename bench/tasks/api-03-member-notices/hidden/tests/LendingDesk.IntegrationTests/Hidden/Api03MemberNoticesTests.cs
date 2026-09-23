using System.Net;
using LendingDesk.Api.Contracts;
using LendingDesk.Domain.Notices;
using LendingDesk.IntegrationTests.Infrastructure;

namespace LendingDesk.IntegrationTests.Hidden.Api03;

/// <summary>Hidden acceptance tests for api-03: GET /api/members/{memberId}/notices.</summary>
[Collection(DatabaseGroup.Name)]
public sealed class Api03MemberNoticesTests(PostgresFixture postgres) : IAsyncLifetime
{
    private static readonly DateTimeOffset T0 = new(2026, 3, 10, 9, 0, 0, TimeSpan.Zero);

    private LendingApiFactory _api = null!;
    private HttpClient _staff = null!;
    private MemberDto _member = null!;
    private MemberDto _other = null!;
    private List<NoticeEntry> _expected = null!;

    public async Task InitializeAsync()
    {
        _api = await LendingApiFactory.StartAsync(postgres);
        _staff = _api.ClientAs("staff");

        _member = await CreateMemberAsync("Notice Reader", "notice.reader@example.com");
        _other = await CreateMemberAsync("Somebody Else", "somebody.else@example.com");
        var (l1, i1) = await LendAsync(_member.Id, "Cordless drill", 7);
        var (l2, i2) = await LendAsync(_member.Id, "Step ladder", 3);
        var (l3, i3) = await LendAsync(_member.Id, "Tile cutter", 4);
        var (l4, i4) = await LendAsync(_member.Id, "Pressure washer", 5);
        var (otherLoan, _) = await LendAsync(_other.Id, "Hedge trimmer", 6);
        Assert.Equal(HttpStatusCode.OK, (await _staff.PostAsync($"/api/loans/{l1}/return", null)).StatusCode);

        // Inserted one at a time so ids follow this order, which deliberately disagrees with sentAt and has ties.
        _expected = [];
        await AddAsync(l1, i1, NoticeKind.Confirmation, T0);
        await AddAsync(l2, i2, NoticeKind.Confirmation, T0.AddHours(1));
        await AddAsync(l1, i1, NoticeKind.DueSoon, T0.AddDays(5));
        await AddAsync(l3, i3, NoticeKind.Confirmation, T0.AddHours(1));
        await AddAsync(otherLoan, null, NoticeKind.Confirmation, T0.AddHours(1));
        await AddAsync(l1, i1, NoticeKind.ReturnReceipt, T0.AddDays(6));
        await AddAsync(l2, i2, NoticeKind.DueSoon, T0.AddDays(2));
        await AddAsync(l4, i4, NoticeKind.Confirmation, T0.AddHours(1));
        await AddAsync(l2, i2, NoticeKind.Overdue, T0.AddDays(4));
        await AddAsync(l3, i3, NoticeKind.DueSoon, T0.AddDays(3));
        await AddAsync(otherLoan, null, NoticeKind.DueSoon, T0.AddDays(10));
        await AddAsync(l3, i3, NoticeKind.Overdue, T0.AddDays(4));
        await AddAsync(l4, i4, NoticeKind.DueSoon, T0.AddDays(2));
        await AddAsync(l1, i1, NoticeKind.Overdue, T0.AddDays(5));
        await AddAsync(l4, i4, NoticeKind.Overdue, T0.AddDays(7));
        _expected = [.. _expected.OrderByDescending(n => n.SentAt).ThenByDescending(n => n.Id)];
        Assert.Equal(13, _expected.Count);
    }

    public async Task DisposeAsync() => await _api.DisposeAsync();

    [Fact]
    public async Task Staff_see_every_notice_about_the_member_s_loans_newest_first_with_ties_by_id()
    {
        var page = await GetPageAsync(_staff, $"/api/members/{_member.Id}/notices?pageSize=50");

        Assert.Equal(_expected, page.Items);
        Assert.Equal(1, page.Page);
        Assert.Equal(50, page.PageSize);
        Assert.Equal(13, page.TotalCount);
    }

    [Fact]
    public async Task Admins_see_the_list_too()
    {
        var page = await GetPageAsync(_api.ClientAs("admin"), $"/api/members/{_member.Id}/notices?pageSize=50");

        Assert.Equal(_expected, page.Items);
    }

    [Fact]
    public async Task The_page_size_defaults_to_ten_and_the_last_page_holds_the_rest()
    {
        var first = await GetPageAsync(_staff, $"/api/members/{_member.Id}/notices");
        var second = await GetPageAsync(_staff, $"/api/members/{_member.Id}/notices?page=2");

        Assert.Equal(_expected.Take(10), first.Items);
        Assert.Equal(1, first.Page);
        Assert.Equal(10, first.PageSize);
        Assert.Equal(13, first.TotalCount);
        Assert.Equal(_expected.Skip(10), second.Items);
        Assert.Equal(2, second.Page);
        Assert.Equal(10, second.PageSize);
        Assert.Equal(13, second.TotalCount);
    }

    [Fact]
    public async Task Paging_through_never_skips_or_repeats_an_entry()
    {
        var seen = new List<NoticeEntry>();
        for (var number = 1; number <= 4; number++)
        {
            var page = await GetPageAsync(_staff, $"/api/members/{_member.Id}/notices?page={number}&pageSize=4");
            Assert.Equal(13, page.TotalCount);
            Assert.Equal(number, page.Page);
            Assert.Equal(4, page.PageSize);
            seen.AddRange(page.Items);
        }

        Assert.Equal(_expected, seen);
    }

    [Fact]
    public async Task The_same_request_gives_the_same_order_every_time()
    {
        var first = await GetPageAsync(_staff, $"/api/members/{_member.Id}/notices?pageSize=50");
        var second = await GetPageAsync(_staff, $"/api/members/{_member.Id}/notices?pageSize=50");

        Assert.Equal(_expected, first.Items);
        Assert.Equal(first.Items, second.Items);
    }

    [Fact]
    public async Task A_page_past_the_end_is_an_empty_page()
    {
        var page = await GetPageAsync(_staff, $"/api/members/{_member.Id}/notices?page=3");

        Assert.Empty(page.Items);
        Assert.Equal(3, page.Page);
        Assert.Equal(10, page.PageSize);
        Assert.Equal(13, page.TotalCount);
    }

    [Theory]
    [InlineData("DueSoon")]
    [InlineData("Overdue")]
    [InlineData("Confirmation")]
    [InlineData("ReturnReceipt")]
    public async Task The_kind_filter_narrows_the_items_and_the_total(string kind)
    {
        var expected = _expected.Where(n => n.Kind == kind).ToList();

        var page = await GetPageAsync(_staff, $"/api/members/{_member.Id}/notices?kind={kind}&pageSize=50");

        Assert.Equal(expected, page.Items);
        Assert.Equal(expected.Count, page.TotalCount);
    }

    [Fact]
    public async Task The_kind_filter_pages_over_the_filtered_list()
    {
        var overdue = _expected.Where(n => n.Kind == "Overdue").ToList();

        var first = await GetPageAsync(_staff, $"/api/members/{_member.Id}/notices?kind=Overdue&pageSize=3");
        var second = await GetPageAsync(_staff, $"/api/members/{_member.Id}/notices?kind=Overdue&pageSize=3&page=2");

        Assert.Equal(overdue.Take(3), first.Items);
        Assert.Equal(overdue.Skip(3), second.Items);
        Assert.Equal(4, first.TotalCount);
        Assert.Equal(4, second.TotalCount);
    }

    [Fact]
    public async Task A_value_that_is_not_a_notice_kind_is_rejected_like_an_unknown_loan_status()
    {
        var response = await _staff.GetAsync($"/api/members/{_member.Id}/notices?kind=Reminder");
        var reference = await _staff.GetAsync("/api/loans?status=Reminder");

        Assert.Equal(HttpStatusCode.BadRequest, reference.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var expected = await reference.ReadAsync<Problem>();
        var problem = await response.ReadAsync<Problem>();
        Assert.Equal(expected.Status, problem.Status);
        Assert.Equal(expected.Title, problem.Title);
        Assert.Equal(expected.Code, problem.Code);
        Assert.NotNull(problem.Errors);
        Assert.Contains(problem.Errors.Keys, key => string.Equals(key, "kind", StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [InlineData("pageSize=51", "PageSize")]
    [InlineData("pageSize=0", "PageSize")]
    [InlineData("page=0", "Page")]
    [InlineData("page=-1", "Page")]
    public async Task An_out_of_range_page_or_page_size_gets_the_list_validation_error(string query, string field)
    {
        var response = await _staff.GetAsync($"/api/members/{_member.Id}/notices?{query}");
        var reference = await _staff.GetAsync("/api/members?pageSize=500");

        Assert.Equal(HttpStatusCode.BadRequest, reference.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var expected = await reference.ReadAsync<Problem>();
        var problem = await response.ReadAsync<Problem>();
        Assert.Equal(expected.Status, problem.Status);
        Assert.Equal(expected.Title, problem.Title);
        Assert.Equal(expected.Code, problem.Code);
        Assert.NotNull(problem.Errors);
        Assert.Contains("PageSize", expected.Errors!.Keys);
        Assert.Contains(field, problem.Errors.Keys);
    }

    [Fact]
    public async Task A_member_with_no_notices_gets_an_empty_list()
    {
        var quiet = await CreateMemberAsync("Quiet Member", "quiet.member@example.com");

        var page = await GetPageAsync(_staff, $"/api/members/{quiet.Id}/notices");

        Assert.Empty(page.Items);
        Assert.Equal(0, page.TotalCount);
        Assert.Equal(1, page.Page);
        Assert.Equal(10, page.PageSize);
    }

    [Fact]
    public async Task An_unknown_member_gets_the_same_404_as_the_member_loans_list()
    {
        var response = await _staff.GetAsync("/api/members/999999/notices");
        var reference = await _staff.GetAsync("/api/members/999999/loans");

        Assert.Equal(HttpStatusCode.NotFound, reference.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        AssertSameError(await reference.ReadAsync<Problem>(), await response.ReadAsync<Problem>());
    }

    [Fact]
    public async Task Members_get_the_overdue_report_s_403_whichever_member_they_ask_about()
    {
        var asMember = _api.ClientAs("member", _member.Email);
        var reference = await asMember.GetAsync("/api/reports/overdue");
        Assert.Equal(HttpStatusCode.Forbidden, reference.StatusCode);
        var expected = await reference.ReadAsync<Problem>();

        foreach (var memberId in new[] { _member.Id, _other.Id })
        {
            var response = await asMember.GetAsync($"/api/members/{memberId}/notices");

            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
            AssertSameError(expected, await response.ReadAsync<Problem>());
        }
    }

    private static void AssertSameError(Problem expected, Problem actual)
    {
        Assert.Equal(expected.Status, actual.Status);
        Assert.Equal(expected.Title, actual.Title);
        Assert.Equal(expected.Code, actual.Code);
        Assert.Equal(expected.Detail, actual.Detail);
    }

    private static async Task<PagedResult<NoticeEntry>> GetPageAsync(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.ReadAsync<PagedResult<NoticeEntry>>();
    }

    private async Task AddAsync(int loanId, string? itemName, NoticeKind kind, DateTimeOffset sentAt)
    {
        var id = await _api.WithDbAsync(async db =>
        {
            var notice = new Notice { LoanId = loanId, Kind = kind, SentAt = sentAt };
            db.Notices.Add(notice);
            await db.SaveChangesAsync();
            return notice.Id;
        });
        if (itemName is not null)
        {
            _expected.Add(new NoticeEntry(id, loanId, itemName, kind.ToString(), sentAt));
        }
    }

    private async Task<MemberDto> CreateMemberAsync(string name, string email)
    {
        var response = await _staff.PostJsonAsync("/api/members", new { name, email });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<MemberDto>();
    }

    private async Task<(int LoanId, string ItemName)> LendAsync(int memberId, string itemName, int days)
    {
        var sku = $"NTC-{Guid.NewGuid().ToString("N")[..10].ToUpperInvariant()}";
        var item = await _staff.PostJsonAsync("/api/items", new { name = itemName, category = "Tools", sku, totalStock = 1 });
        Assert.Equal(HttpStatusCode.Created, item.StatusCode);
        var itemId = (await item.ReadAsync<ItemDto>()).Id;
        var loan = await _staff.PostJsonAsync("/api/loans", new
        {
            itemId,
            memberId,
            startDate = _api.Clock.Today,
            dueDate = _api.Clock.Today.AddDays(days),
        });
        Assert.Equal(HttpStatusCode.Created, loan.StatusCode);
        return ((await loan.ReadAsync<LoanDto>()).Id, itemName);
    }

    /// <summary>One entry as the endpoint writes it; <c>kind</c> is read as text to check it is the kind's name.</summary>
    private sealed record NoticeEntry(long Id, int LoanId, string ItemName, string Kind, DateTimeOffset SentAt);
}
