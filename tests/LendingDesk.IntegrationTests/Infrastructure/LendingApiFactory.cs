using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using LendingDesk.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace LendingDesk.IntegrationTests.Infrastructure;

public sealed class LendingApiFactory(string connectionString) : WebApplicationFactory<Program>
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    public TestClock Clock { get; } = new();

    public static async Task<LendingApiFactory> StartAsync(PostgresFixture postgres)
    {
        var factory = new LendingApiFactory(await postgres.CreateDatabaseAsync());
        await using var scope = factory.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<LendingDbContext>().Database.MigrateAsync();
        return factory;
    }

    public HttpClient ClientAs(string role, string user = "tester")
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Add("X-Demo-User", user);
        client.DefaultRequestHeaders.Add("X-Demo-Role", role);
        return client;
    }

    public async Task<T> WithDbAsync<T>(Func<LendingDbContext, Task<T>> query)
    {
        await using var scope = Services.CreateAsyncScope();
        return await query(scope.ServiceProvider.GetRequiredService<LendingDbContext>());
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Lending", connectionString);
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Clock);
        });
    }
}

public static class HttpExtensions
{
    public static async Task<T> ReadAsync<T>(this HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<T>(LendingApiFactory.Json))!;

    public static Task<HttpResponseMessage> PostJsonAsync<T>(this HttpClient client, string url, T body) =>
        client.PostAsJsonAsync(url, body, LendingApiFactory.Json);

    public static Task<HttpResponseMessage> PutJsonAsync<T>(this HttpClient client, string url, T body) =>
        client.PutAsJsonAsync(url, body, LendingApiFactory.Json);
}

public sealed record Problem(int Status, string Title, string? Detail, string Code, string TraceId, Dictionary<string, string[]>? Errors);
