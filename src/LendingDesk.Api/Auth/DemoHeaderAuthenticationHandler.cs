using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace LendingDesk.Api.Auth;

/// <summary>
/// Demo sign-in: the caller names itself in <c>X-Demo-User</c> and its role in <c>X-Demo-Role</c>.
/// There is no identity provider behind it - it exists so the roles and policies can be exercised.
/// </summary>
internal sealed class DemoHeaderAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "DemoHeader";
    public const string UserHeader = "X-Demo-User";
    public const string RoleHeader = "X-Demo-Role";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var user = Request.Headers[UserHeader].ToString();
        var role = Request.Headers[RoleHeader].ToString();
        if (string.IsNullOrWhiteSpace(user) || string.IsNullOrWhiteSpace(role))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        if (!Roles.All.Contains(role))
        {
            return Task.FromResult(AuthenticateResult.Fail($"Unknown role '{role}'."));
        }

        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.Name, user), new Claim(ClaimTypes.Role, role)],
            SchemeName);
        var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
