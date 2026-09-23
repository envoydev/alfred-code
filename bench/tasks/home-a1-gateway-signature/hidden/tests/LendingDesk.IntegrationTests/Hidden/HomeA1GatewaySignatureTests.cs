using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LendingDesk.IntegrationTests.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;

namespace LendingDesk.IntegrationTests.Hidden.HomeA1;

[Collection(DatabaseGroup.Name)]
public sealed class HomeA1GatewaySignatureTests(PostgresFixture postgres) : IAsyncLifetime
{
    private const string Key = "gateway-shared-key-7f3a9c";
    private const string SignatureHeader = "X-Demo-Signature";

    /// <summary>The API as it runs today: no gateway key.</summary>
    private LendingApiFactory _open = null!;

    /// <summary>The same API behind the gateway: <c>Auth:GatewayKey</c> set.</summary>
    private WebApplicationFactory<Program> _gated = null!;

    public async Task InitializeAsync()
    {
        _open = await LendingApiFactory.StartAsync(postgres);
        _gated = WithKey(Key);
    }

    public async Task DisposeAsync()
    {
        await _gated.DisposeAsync();
        await _open.DisposeAsync();
    }

    private WebApplicationFactory<Program> WithKey(string key) =>
        _open.WithWebHostBuilder(builder => builder.UseSetting("Auth:GatewayKey", key));

    private static string Sign(string key, string text, bool upperCase = false)
    {
        var mac = HMACSHA256.HashData(Encoding.UTF8.GetBytes(key), Encoding.UTF8.GetBytes(text));
        return upperCase ? Convert.ToHexString(mac) : Convert.ToHexStringLower(mac);
    }

    private static string Signature(string user, string role, bool upperCase = false) => Sign(Key, user + "\n" + role, upperCase);

    private static HttpClient Client(WebApplicationFactory<Program> factory, string? user, string? role, string? signature)
    {
        var client = factory.CreateClient();
        if (user is not null)
        {
            client.DefaultRequestHeaders.Add("X-Demo-User", user);
        }

        if (role is not null)
        {
            client.DefaultRequestHeaders.Add("X-Demo-Role", role);
        }

        if (signature is not null)
        {
            client.DefaultRequestHeaders.TryAddWithoutValidation(SignatureHeader, signature);
        }

        return client;
    }

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private static Task<HttpResponseMessage> CreateMemberAsync(HttpClient client) =>
        client.PostAsJsonAsync("/api/members", new { name = "Signed Member", email = $"{Guid.NewGuid():N}@example.com" }, LendingApiFactory.Json);

    /// <summary>Asserts the response is the same answer, status and body (bar the trace id), as the reference.</summary>
    private static async Task AssertSameAnswerAsync(HttpResponseMessage expected, HttpResponseMessage actual)
    {
        Assert.Equal(expected.StatusCode, actual.StatusCode);
        var expectedBody = await JsonAsync(expected);
        var actualBody = await JsonAsync(actual);
        var expectedNames = expectedBody.EnumerateObject().Select(p => p.Name).ToHashSet(StringComparer.Ordinal);
        var actualNames = actualBody.EnumerateObject().Select(p => p.Name).ToHashSet(StringComparer.Ordinal);
        Assert.Equal(expectedNames, actualNames);
        foreach (var property in expectedBody.EnumerateObject().Where(p => p.Name != "traceId"))
        {
            Assert.Equal(property.Value.ToString(), actualBody.GetProperty(property.Name).ToString());
        }
    }

    public static TheoryData<string> BadSignatures() => new()
    {
        "missing",
        "empty",
        "other key",
        "signed for another role",
        "signed for another user",
        "no line feed",
        "garbage",
        "truncated",
    };

    private static string? BadSignature(string kind, string user, string role) => kind switch
    {
        "missing" => null,
        "empty" => string.Empty,
        "other key" => Sign("some-other-key", user + "\n" + role),
        "signed for another role" => Signature(user, role == "admin" ? "member" : "admin"),
        "signed for another user" => Signature("someone-else", role),
        "no line feed" => Sign(Key, user + role),
        "garbage" => "not-a-signature",
        "truncated" => Signature(user, role)[..^2],
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };

    [Fact]
    public async Task A_correctly_signed_request_goes_through()
    {
        var staff = Client(_gated, "desk-7", "staff", Signature("desk-7", "staff"));

        var list = await staff.GetAsync("/api/members");
        var created = await CreateMemberAsync(staff);

        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
    }

    [Fact]
    public async Task An_upper_case_hex_signature_is_accepted()
    {
        var admin = Client(_gated, "Ada Lovelace", "admin", Signature("Ada Lovelace", "admin", upperCase: true));

        var created = await CreateMemberAsync(admin);
        var id = (await JsonAsync(created)).GetProperty("id").GetInt32();
        var suspended = await admin.PostAsync($"/api/members/{id}/suspend", null);

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(HttpStatusCode.OK, suspended.StatusCode);
    }

    [Theory]
    [MemberData(nameof(BadSignatures))]
    public async Task A_missing_or_wrong_signature_is_answered_like_a_request_with_no_identity(string kind)
    {
        var anonymous = _open.CreateClient();

        var readReference = await anonymous.GetAsync("/api/members");
        var read = await Client(_gated, "desk-7", "staff", BadSignature(kind, "desk-7", "staff")).GetAsync("/api/members");
        var staffWorkReference = await CreateMemberAsync(anonymous);
        var staffWork = await CreateMemberAsync(Client(_gated, "desk-7", "staff", BadSignature(kind, "desk-7", "staff")));
        var memberAtStaffWork = await CreateMemberAsync(Client(_gated, "reader-1", "member", BadSignature(kind, "reader-1", "member")));
        var adminWorkReference = await anonymous.PostAsync("/api/members/1/suspend", null);
        var adminWork = await Client(_gated, "boss", "admin", BadSignature(kind, "boss", "admin")).PostAsync("/api/members/1/suspend", null);

        Assert.Equal(HttpStatusCode.Unauthorized, readReference.StatusCode);
        await AssertSameAnswerAsync(readReference, read);
        await AssertSameAnswerAsync(staffWorkReference, staffWork);
        await AssertSameAnswerAsync(staffWorkReference, memberAtStaffWork);
        await AssertSameAnswerAsync(adminWorkReference, adminWork);
        Assert.Equal(0, await _open.WithDbAsync(db => db.Members.CountAsync()));
    }

    [Fact]
    public async Task A_request_with_no_identity_headers_is_still_unauthenticated_behind_the_gateway()
    {
        var reference = await _open.CreateClient().GetAsync("/api/items");
        var response = await _gated.CreateClient().GetAsync("/api/items");

        Assert.Equal(HttpStatusCode.Unauthorized, reference.StatusCode);
        await AssertSameAnswerAsync(reference, response);
    }

    [Fact]
    public async Task A_signed_member_is_still_refused_staff_work()
    {
        var member = Client(_gated, "reader-1", "member", Signature("reader-1", "member"));

        var read = await member.GetAsync("/api/items");
        var staffWork = await CreateMemberAsync(member);

        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, staffWork.StatusCode);
        Assert.Equal("forbidden", (await JsonAsync(staffWork)).GetProperty("code").GetString());
    }

    [Fact]
    public async Task A_signed_unknown_role_is_refused_the_way_it_is_today()
    {
        var today = await Client(_open, "desk-7", "librarian", null).GetAsync("/api/items");
        var signed = await Client(_gated, "desk-7", "librarian", Signature("desk-7", "librarian")).GetAsync("/api/items");

        Assert.NotEqual(HttpStatusCode.OK, today.StatusCode);
        await AssertSameAnswerAsync(today, signed);
    }

    [Fact]
    public async Task Without_a_key_the_headers_are_trusted_and_a_signature_is_ignored()
    {
        var unsigned = await CreateMemberAsync(Client(_open, "desk-7", "staff", null));
        var wronglySigned = await CreateMemberAsync(Client(_open, "desk-7", "staff", "not-a-signature"));
        var otherKey = await CreateMemberAsync(Client(_open, "desk-7", "staff", Sign("some-other-key", "desk-7\nstaff")));

        Assert.Equal(HttpStatusCode.Created, unsigned.StatusCode);
        Assert.Equal(HttpStatusCode.Created, wronglySigned.StatusCode);
        Assert.Equal(HttpStatusCode.Created, otherKey.StatusCode);
    }

    [Fact]
    public async Task An_empty_key_changes_nothing()
    {
        await using var emptyKey = WithKey(string.Empty);

        var unsigned = await CreateMemberAsync(Client(emptyKey, "desk-7", "staff", null));
        var wronglySigned = await CreateMemberAsync(Client(emptyKey, "desk-7", "staff", "not-a-signature"));
        var memberAtStaffWork = await CreateMemberAsync(Client(emptyKey, "reader-1", "member", null));

        Assert.Equal(HttpStatusCode.Created, unsigned.StatusCode);
        Assert.Equal(HttpStatusCode.Created, wronglySigned.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, memberAtStaffWork.StatusCode);
    }
}
