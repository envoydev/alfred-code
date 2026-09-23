using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using LendingDesk.Api.Contracts;
using LendingDesk.Data;
using LendingDesk.IntegrationTests.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace LendingDesk.IntegrationTests.Hidden.Guard01;

/// <summary>Collects every log entry the API writes, whatever its category or the configured filters.</summary>
public sealed class Guard01LogCapture : ILoggerProvider
{
    private readonly ConcurrentQueue<Guard01LogEntry> _entries = new();

    public IReadOnlyList<Guard01LogEntry> Entries => [.. _entries];

    public ILogger CreateLogger(string categoryName) => new CaptureLogger(this);

    public void Dispose()
    {
    }

    private sealed class CaptureLogger(Guard01LogCapture owner) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            owner._entries.Enqueue(new Guard01LogEntry(logLevel, formatter(state, exception)));
    }
}

public sealed record Guard01LogEntry(LogLevel Level, string Message);

/// <summary>The API started the way <see cref="LendingApiFactory"/> starts it, with a log capture added.</summary>
public sealed class Guard01Api : IAsyncDisposable
{
    private readonly LendingApiFactory _root;
    private readonly WebApplicationFactory<Program> _app;

    private Guard01Api(LendingApiFactory root)
    {
        _root = root;
        _app = root.WithWebHostBuilder(builder => builder.ConfigureLogging(logging =>
        {
            logging.AddProvider(Logs);
            logging.AddFilter<Guard01LogCapture>(null, LogLevel.Trace);
        }));
    }

    public Guard01LogCapture Logs { get; } = new();

    public TestClock Clock => _root.Clock;

    public static async Task<Guard01Api> StartAsync(PostgresFixture postgres)
    {
        var api = new Guard01Api(new LendingApiFactory(await postgres.CreateDatabaseAsync()));
        await using var scope = api._app.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<LendingDbContext>().Database.MigrateAsync();
        return api;
    }

    public HttpClient ClientAs(string role, string user = "tester")
    {
        var client = _app.CreateClient();
        client.DefaultRequestHeaders.Add("X-Demo-User", user);
        client.DefaultRequestHeaders.Add("X-Demo-Role", role);
        return client;
    }

    public async Task<MemberDto> CreateMemberAsync()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var response = await ClientAs("staff").PostJsonAsync("/api/members", new { name = $"Member {suffix}", email = $"m{suffix}@example.com" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<MemberDto>();
    }

    public async Task<ItemDto> CreateItemAsync(int stock = 5)
    {
        var suffix = Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
        var response = await ClientAs("staff").PostJsonAsync("/api/items", new { name = $"Item {suffix}", category = "Tools", sku = $"SKU-{suffix}", totalStock = stock });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<ItemDto>();
    }

    /// <summary>Lends an item to the member from today, due <paramref name="dueInDays"/> days from today.</summary>
    public async Task<LoanDto> LendAsync(int memberId, int itemId, int dueInDays)
    {
        var response = await ClientAs("staff").PostJsonAsync("/api/loans", new
        {
            itemId,
            memberId,
            startDate = Clock.Today,
            dueDate = Clock.Today.AddDays(dueInDays),
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<LoanDto>();
    }

    public async Task ReturnAsync(int loanId) =>
        Assert.Equal(HttpStatusCode.OK, (await ClientAs("staff").PostAsync($"/api/loans/{loanId}/return", null)).StatusCode);

    public async Task SuspendAsync(int memberId) =>
        Assert.Equal(HttpStatusCode.OK, (await ClientAs("admin").PostAsync($"/api/members/{memberId}/suspend", null)).StatusCode);

    public async Task<MemberDto> GetMemberAsync(int memberId) =>
        await (await ClientAs("staff").GetAsync($"/api/members/{memberId}")).ReadAsync<MemberDto>();

    public static async Task<SortedSet<string>> PropertyNamesAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return new SortedSet<string>(document.RootElement.EnumerateObject().Select(p => p.Name), StringComparer.Ordinal);
    }

    public async ValueTask DisposeAsync()
    {
        await _app.DisposeAsync();
        await _root.DisposeAsync();
    }
}
