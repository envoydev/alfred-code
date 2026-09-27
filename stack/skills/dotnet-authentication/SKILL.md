---
name: dotnet-authentication
description: "Load before standing up a sign-in flow, wiring JWT bearer, cookies or OpenID Connect, adding ASP.NET Identity, writing an authorization policy or handler, or protecting an endpoint - ASP.NET Core authentication (who the caller is) and authorization (what they may do). Floors at .NET 8 / C# 12. Do NOT load for the OWASP hardening sweep, secret placement, or crypto primitives - the .NET application-security and cryptography skills own those."
---

# ASP.NET Core authentication and authorization

Two questions, never one: **authentication** establishes who the caller is (a `ClaimsPrincipal`), **authorization** decides what that principal may do - `UseAuthentication()` then `UseAuthorization()`, in that order. A 401 is no identity; a 403 is a known identity told no. Baseline .NET 8 / C# 12; the .NET Framework 4.8 OWIN / Identity 2.x stack is `references/net-framework-48.md`.

**Each rule below is one line; `references/auth-in-full.md` carries it with its reason and worked code - read it before registering a scheme, minting a token, or writing an authorization handler.**

## Schemes
- Pick by the surface: a stateless REST API - JWT bearer; a server-rendered app - cookies; delegated sign-on - OpenID Connect with an external provider. Never a hand-rolled user store - ASP.NET Identity (`MapIdentityApi<TUser>()` on .NET 8+ where its defaults fit).
- **JWT:** every validation flag on - issuer, audience, lifetime, signing key - with a small `ClockSkew` (30s, never the default 5 minutes); never a flag turned off to make a test pass. Mint from explicit claims on `JsonWebTokenHandler` - the family .NET 8+ `AddJwtBearer` validates with (an event cast to `JwtSecurityToken` breaks); timestamps from an injected `TimeProvider`. Symmetric HMAC only when one service issues and validates, asymmetric (RSA / ECDSA) once a second party verifies; short-lived access tokens with a refresh token; the key from configuration, never source.
- **Cookies:** `AddCookie()` for a browser-navigated app, `SecurePolicy = CookieSecurePolicy.Always` in production, an explicit expiration, your own `LoginPath` / `AccessDeniedPath`.
- **OIDC:** a cookie scheme for the session plus the OIDC handler for the challenge, the authorization code flow (`response_type=code`, never implicit), the client secret treated as a secret.
- **API keys** only for service or webhook callers that cannot do a handshake: store a hash (`SHA256.HashData`), compare with `CryptographicOperations.FixedTimeEquals`, and set a `ClaimsPrincipal` from a handler or middleware.

## Authorization
- Named policies (`AddAuthorizationBuilder().AddPolicy(...)`), never role strings scattered as `[Authorize(Roles = ...)]`; a rule beyond a claim check is a requirement plus a singleton handler; a rule about a specific entity is resource-based (`IAuthorizationService.AuthorizeAsync(user, resource, policy)`).
- Attach the policy where routes group (`MapGroup(...).RequireAuthorization("CanPublish")`); read the caller from the injected `ClaimsPrincipal` (`FindFirstValue` null means unauthenticated), never a hand-trusted header.
- Secrets placement is the .NET application-security skill's where installed; without it, the signing key and client secret come from configuration or a secret store, never a tracked file. The broader threat model is the skill covering OWASP-mapped hardening.

## Prove the wiring

Before any done word, quote three results: a protected endpoint's 401 with no token and 403 with a token failing the policy; a valid token's 200 with the expected claim read; and the integration test that pins all three.
