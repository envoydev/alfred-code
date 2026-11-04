using System.Net;
using System.Text.Json;

namespace Api.Tests;

// Acceptance for the request: POST /orders/{id}/refund, allowed only to the refunds-approver role - anonymous callers
// get 401, other roles 403; a refund marks the order Refunded and returns it; refunding an order twice returns 409.
// It reads only HTTP status codes and JSON, through the test scheme's X-Test-Role header.
public sealed class RefundAcceptanceTests
{
    private const string Approver = "refunds-approver";

    [Fact]
    public async Task An_anonymous_refund_is_401()
    {
        await using var factory = new ApiFactory();
        var response = await factory.ClientAs(null).PostAsync("/orders/1/refund", null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_refund_by_a_viewer_is_403()
    {
        await using var factory = new ApiFactory();
        var response = await factory.ClientAs("viewer").PostAsync("/orders/1/refund", null);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_refund_by_an_approver_marks_the_order_Refunded_and_returns_it()
    {
        await using var factory = new ApiFactory();
        var client = factory.ClientAs(Approver);

        var response = await client.PostAsync("/orders/2/refund", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(("Refunded", 2), Read(await response.Content.ReadAsStringAsync()));
        var after = await client.GetAsync("/orders/2");
        Assert.Equal(("Refunded", 2), Read(await after.Content.ReadAsStringAsync()));
    }

    [Fact]
    public async Task Refunding_an_order_twice_is_409()
    {
        await using var factory = new ApiFactory();
        var client = factory.ClientAs(Approver);

        var first = await client.PostAsync("/orders/3/refund", null);
        var second = await client.PostAsync("/orders/3/refund", null);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    private static (string? Status, int Id) Read(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return (doc.RootElement.GetProperty("status").GetString(), doc.RootElement.GetProperty("id").GetInt32());
    }
}
