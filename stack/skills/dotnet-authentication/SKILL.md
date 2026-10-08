---
name: dotnet-authentication
description: "Load before wiring ASP.NET Core sign-in, JWT bearer, cookies, OpenID Connect, Identity or authorization policies. Not for OWASP sweeps or crypto."
---

# ASP.NET Core authentication and authorization

Two questions, never one. **Authentication** answers who the caller is and hands you a `ClaimsPrincipal`. **Authorization** answers what that principal may do. The framework keeps them as separate middlewares - `UseAuthentication()` then `UseAuthorization()`, in that order - and so should your thinking. A 401 means the framework could not establish identity; a 403 means it knows who you are and the answer is still no.

Baseline is .NET 8 / C# 12. On .NET Framework 4.8 the OWIN / Katana + ASP.NET Identity 2.x auth stack is in `references/net-framework-48.md`.

## When to use

- ASP.NET Core authentication (who the caller is) and authorization (what they may do). Also fires on: standing up a sign-in flow, an authorization handler, protecting an endpoint.
- Do NOT load for the OWASP hardening sweep, secret placement, or crypto primitives - the .NET application-security and cryptography skills own those.

## Pick the scheme from the surface

The right authentication scheme is decided by what kind of client talks to the endpoint, not by preference:

- **Stateless REST API** -> JWT bearer (`Microsoft.AspNetCore.Authentication.JwtBearer`). The token carries the identity; the server keeps no session.
- **Server-rendered app** (MVC, Razor Pages, Blazor Server) -> cookie authentication. The browser already holds a cookie; use it.
- **Delegated identity / single sign-on** -> OpenID Connect, with an external provider doing the actual sign-in.
- **A service or webhook caller that cannot do a real handshake** -> an API key, the weakest credential.

The cookie + OIDC wiring and the API-key rules (hash at rest, constant-time compare) are `references/oidc-and-api-keys.md` - read it before wiring either.

Do not invent a user store. ASP.NET Identity already solves password hashing (PBKDF2 by default), account lockout, two-factor, and email confirmation - all the places a hand-rolled store quietly gets wrong. On .NET 8+, `MapIdentityApi<TUser>()` emits ready-made register / login / refresh / 2FA endpoints when those defaults fit; reach past it only when the contract genuinely differs.

## JWT bearer for APIs

Register the scheme and lock down validation:

```csharp
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = config["Jwt:Issuer"],
            ValidAudience = config["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(config["Jwt:Key"]!)),
            ClockSkew = TimeSpan.FromSeconds(30),
        };
    });
```

Every validation flag stays on. Issuer, audience, lifetime, and signing key are the four checks that make a bearer token trustworthy - turning one off to make a test or a local run pass is how an environment ships with validation disabled. Trim the default five-minute `ClockSkew` to something small; it exists for clock drift, not as a free grace period on expired tokens.

Mint tokens from explicit claims rather than dumping a whole user object in:

```csharp
var claims = new[]
{
    new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
    new Claim(ClaimTypes.Email, user.Email),
    new Claim(ClaimTypes.Role, user.Role),
};
var now = timeProvider.GetUtcNow();   // injected TimeProvider, never DateTime.Now
var handler = new JsonWebTokenHandler();   // Microsoft.IdentityModel.JsonWebTokens - the handler .NET 8+ JwtBearer validates with
string jwt = handler.CreateToken(new SecurityTokenDescriptor
{
    Issuer = config["Jwt:Issuer"],
    Audience = config["Jwt:Audience"],
    Subject = new ClaimsIdentity(claims),
    NotBefore = now.UtcDateTime,
    Expires = now.AddMinutes(15).UtcDateTime,
    SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256),
});
```

Mint on the same handler family you validate with: since .NET 8 `AddJwtBearer` validates through `JsonWebTokenHandler` by default and its events surface a `JsonWebToken`, so an `OnTokenValidated` that casts `context.SecurityToken` to `JwtSecurityToken` breaks; the legacy `JwtSecurityTokenHandler` path is reachable only by setting `UseSecurityTokenValidators = true`, which forfeits the faster default.

Symmetric `HmacSha256` is fine when one service issues and validates. The moment a second party must verify a token it did not mint, switch to asymmetric signing (RSA / ECDSA) so the verifier holds only the public key. Keep access tokens short-lived and pair them with a refresh token if sessions must outlive fifteen minutes - a long-lived access token is a long-lived liability with no way to revoke it. The signing key is a secret: it comes from configuration, never source.

## Cookies for server-rendered apps

For an app the browser navigates, `AddAuthentication().AddCookie()` is the simpler and safer default - the token never leaves the server, and the cookie is `HttpOnly` and `SameSite=Lax` by default. The `Secure` flag only follows the request scheme (the default is `SecurePolicy = SameAsRequest`, so a plain-HTTP request gets an unprotected cookie); pin `SecurePolicy = CookieSecurePolicy.Always` in production. Set a sliding or absolute expiration, and point `LoginPath` / `AccessDeniedPath` at your own pages. Reserve bearer tokens for clients that cannot hold a cookie.

## Authorization: policies, not role strings

Express access rules as named policies and apply the name. A policy is testable in isolation, composable, and changes in one place; `[Authorize(Roles = "Admin")]` sprinkled across handlers is a string match you cannot refactor.

```csharp
builder.Services.AddAuthorizationBuilder()   // fluent, .NET 7+ - on the floor
    .AddPolicy("CanPublish", p => p.RequireRole("Editor", "Admin"))
    .AddPolicy("AdultsOnly", p => p.AddRequirements(new MinimumAgeRequirement(18)));
```


When a rule needs more than a claim check - comparing a date, reading the resource being acted on, calling a service - write a requirement and a handler:

```csharp
public sealed record MinimumAgeRequirement(int Age) : IAuthorizationRequirement;

public sealed class MinimumAgeHandler(TimeProvider clock) : AuthorizationHandler<MinimumAgeRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context, MinimumAgeRequirement requirement)
    {
        var dob = context.User.FindFirst(c => c.Type == ClaimTypes.DateOfBirth)?.Value;
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);   // injected TimeProvider, never DateTime.UtcNow
        if (DateOnly.TryParseExact(dob, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var born)
            && born <= today.AddYears(-requirement.Age))   // ISO date, invariant culture; a malformed claim fails closed
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}
```

Register the handler, and the clock it takes - the host registers no `TimeProvider` (measured on .NET 10):

```csharp
builder.Services.AddSingleton<IAuthorizationHandler, MinimumAgeHandler>();
builder.Services.TryAddSingleton(TimeProvider.System);
```

For rules that depend on the specific entity (this caller may edit *this* document), call `IAuthorizationService.AuthorizeAsync(user, resource, policy)` in the endpoint or action, once the resource is loaded, rather than trying to encode the entity into a static policy.

## Protecting endpoints and reading the caller

Attach the policy where the routes are grouped:

```csharp
var admin = app.MapGroup("/admin").RequireAuthorization("CanPublish");
```

`RequireAuthorization` on a minimal API group is the chokepoint - the minimal-API endpoint skill covers how groups carry filters and metadata. Read the authenticated caller from the injected `ClaimsPrincipal`, never from a header you trust by hand:

```csharp
app.MapGet("/me", (ClaimsPrincipal user) =>
    TypedResults.Ok(new { id = user.FindFirstValue(ClaimTypes.NameIdentifier) }));
```

`FindFirstValue` returns the string or null; treat null as unauthenticated, not as a default user.

## Where secrets live

The signing key, client secret, and connection strings are secrets and must never touch a tracked file. Where they live in dev versus prod is the .NET application-security hardening skill's - reach for it where the install has one; without it, the rule here is the whole guidance: the signing key and client secret come from configuration or a secret store, never a tracked file.

The broader access-control and SSRF threat model - what an attacker does once past the front door - belongs to the skill covering OWASP-mapped .NET hardening.

## Prove the wiring

Auth that compiles is not auth that holds. Before any done word:

1. Call a protected endpoint with no token - quote the 401.
2. Call it with a token that fails the policy - quote the 403.
3. Call it with a valid token - quote the 200 and the claim the handler read.

Pin all three in an integration test so the next change cannot silently open the endpoint. Report: the 401, 403 and 200 lines. A validation flag turned off to make one of them pass is the failure this section exists to catch.

## Anti-patterns

- Magic role strings (`[Authorize(Roles = "Admin")]`) scattered in place of named, testable policies.
- Rolling your own password hashing or user store instead of ASP.NET Identity.
- Long-lived or non-expiring access tokens with no refresh-and-revoke story.
