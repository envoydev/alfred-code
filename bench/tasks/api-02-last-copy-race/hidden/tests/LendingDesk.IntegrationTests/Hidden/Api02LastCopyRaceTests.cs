using System.Net;
using System.Text.Json;
using LendingDesk.Api.Contracts;
using LendingDesk.Data.Outbox;
using LendingDesk.Domain.Events;
using LendingDesk.IntegrationTests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace LendingDesk.IntegrationTests.Hidden.Api02;

/// <summary>Hidden acceptance tests for api-02: simultaneous loans never oversell an item's copies.</summary>
[Collection(DatabaseGroup.Name)]
public sealed class Api02LastCopyRaceTests(PostgresFixture postgres) : IAsyncLifetime
{
    // Each scenario is repeated on fresh items so a race that slips through once is still caught.
    private const int Rounds = 5;
    private const int Burst = 10;

    private LendingApiFactory _api = null!;
    private HttpClient _staff = null!;

    public async Task InitializeAsync()
    {
        _api = await LendingApiFactory.StartAsync(postgres);
        _staff = _api.ClientAs("staff");

        // Warm the pipeline (routing, EF query compilation) so the bursts below really overlap.
        var memberId = await CreateMemberAsync();
        var itemId = await CreateItemAsync(stock: 1);
        var warm = await _staff.PostJsonAsync("/api/loans", LoanBody(itemId, memberId, startInDays: 0, days: 3));
        Assert.Equal(HttpStatusCode.Created, warm.StatusCode);
    }

    public async Task DisposeAsync() => await _api.DisposeAsync();

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public async Task Simultaneous_loans_for_the_same_dates_succeed_exactly_as_often_as_there_are_copies(int stock)
    {
        for (var round = 0; round < Rounds; round++)
        {
            var itemId = await CreateItemAsync(stock);
            var bodies = new List<object>();
            for (var i = 0; i < Burst; i++)
            {
                bodies.Add(LoanBody(itemId, await CreateMemberAsync(), startInDays: 1, days: 5));
            }

            var responses = await SendAllAtOnceAsync(bodies);

            var created = responses.Where(r => r.StatusCode == HttpStatusCode.Created).ToList();
            var refused = responses.Where(r => r.StatusCode != HttpStatusCode.Created).ToList();
            Assert.True(
                created.Count == stock,
                $"Round {round + 1}: {created.Count} of {Burst} simultaneous loans succeeded for an item with {stock} copies; statuses: "
                + string.Join(", ", responses.Select(r => (int)r.StatusCode)));

            // The request that arrives after the item is fully lent is the reference refusal.
            var afterwards = await _staff.PostJsonAsync("/api/loans", LoanBody(itemId, await CreateMemberAsync(), startInDays: 1, days: 5));
            Assert.Equal(HttpStatusCode.Conflict, afterwards.StatusCode);
            var reference = await afterwards.ReadAsync<Problem>();
            Assert.Equal("item_unavailable", reference.Code);

            foreach (var response in refused)
            {
                Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
                var problem = await response.ReadAsync<Problem>();
                Assert.Equal(409, problem.Status);
                Assert.Equal("item_unavailable", problem.Code);
                Assert.Equal(reference.Title, problem.Title);
                Assert.Equal(reference.Detail, problem.Detail);
            }

            var createdIds = new List<int>();
            foreach (var response in created)
            {
                createdIds.Add((await response.ReadAsync<LoanDto>()).Id);
            }

            Assert.Equal(createdIds.Order(), await LoanIdsForItemAsync(itemId));
            Assert.Equal(createdIds.Order(), await LoanCreatedEventLoanIdsForItemAsync(itemId));
        }
    }

    [Fact]
    public async Task Simultaneous_loans_of_different_items_all_succeed()
    {
        for (var round = 0; round < Rounds; round++)
        {
            var bodies = new List<object>();
            var itemIds = new List<int>();
            for (var i = 0; i < Burst; i++)
            {
                var itemId = await CreateItemAsync(stock: 1);
                itemIds.Add(itemId);
                bodies.Add(LoanBody(itemId, await CreateMemberAsync(), startInDays: 1, days: 5));
            }

            var responses = await SendAllAtOnceAsync(bodies);

            Assert.All(responses, r => Assert.Equal(HttpStatusCode.Created, r.StatusCode));
            foreach (var itemId in itemIds)
            {
                Assert.Single(await LoanIdsForItemAsync(itemId));
            }
        }
    }

    [Fact]
    public async Task Simultaneous_loans_of_one_item_for_dates_that_do_not_overlap_all_succeed()
    {
        for (var round = 0; round < Rounds; round++)
        {
            var itemId = await CreateItemAsync(stock: 1);
            var bodies = new List<object>();
            for (var i = 0; i < Burst; i++)
            {
                // Back-to-back two-day windows: day 2i to day 2i+1, so no two of them share a day.
                bodies.Add(LoanBody(itemId, await CreateMemberAsync(), startInDays: 2 * i, days: 1));
            }

            var responses = await SendAllAtOnceAsync(bodies);

            Assert.All(responses, r => Assert.Equal(HttpStatusCode.Created, r.StatusCode));
            Assert.Equal(Burst, (await LoanIdsForItemAsync(itemId)).Count);
        }
    }

    private object LoanBody(int itemId, int memberId, int startInDays, int days) => new
    {
        itemId,
        memberId,
        startDate = _api.Clock.Today.AddDays(startInDays),
        dueDate = _api.Clock.Today.AddDays(startInDays + days),
    };

    private async Task<HttpResponseMessage[]> SendAllAtOnceAsync(IReadOnlyList<object> bodies)
    {
        var clients = bodies.Select((_, i) => _api.ClientAs("staff", $"desk-{i}")).ToList();
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var sends = bodies
            .Select((body, i) => Task.Run(async () =>
            {
                await gate.Task;
                return await clients[i].PostJsonAsync("/api/loans", body);
            }))
            .ToArray();
        gate.SetResult();
        return await Task.WhenAll(sends);
    }

    private async Task<int> CreateMemberAsync()
    {
        var suffix = Guid.NewGuid().ToString("N")[..10];
        var response = await _staff.PostJsonAsync("/api/members", new { name = $"Member {suffix}", email = $"race-{suffix}@example.com" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.ReadAsync<MemberDto>()).Id;
    }

    private async Task<int> CreateItemAsync(int stock)
    {
        var suffix = Guid.NewGuid().ToString("N")[..10].ToUpperInvariant();
        var response = await _staff.PostJsonAsync("/api/items", new { name = $"Camera {suffix}", category = "Photo", sku = $"CAM-{suffix}", totalStock = stock });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.ReadAsync<ItemDto>()).Id;
    }

    private Task<List<int>> LoanIdsForItemAsync(int itemId) =>
        _api.WithDbAsync(db => db.Loans.Where(l => l.ItemId == itemId).OrderBy(l => l.Id).Select(l => l.Id).ToListAsync());

    private async Task<List<int>> LoanCreatedEventLoanIdsForItemAsync(int itemId)
    {
        var payloads = await _api.WithDbAsync(db => db.OutboxMessages.Where(o => o.Type == EventTypes.LoanCreated).Select(o => o.Payload).ToListAsync());
        return payloads
            .Select(p => JsonSerializer.Deserialize<LoanCreated>(p, OutboxExtensions.PayloadOptions)!)
            .Where(e => e.ItemId == itemId)
            .Select(e => e.LoanId)
            .Order()
            .ToList();
    }
}
