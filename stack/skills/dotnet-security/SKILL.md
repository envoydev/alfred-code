---
name: dotnet-security
description: "Use when hardening, threat-modeling or reviewing a .NET service for vulnerabilities: the OWASP Top 10 mapped to ASP.NET Core mitigations (IDOR, injection, XSS, CORS, crypto, deserialization, SSRF), reported as a findings table. Not for building sign-in or picking crypto primitives."
---

# .NET application security - the OWASP Top 10, applied

The hardening checklist: how each 2021 OWASP Top 10 category shows up in an ASP.NET Core service and what to do about it (the 2025 revision maps onto the same mitigations). It pairs with the live diff review (`/security-review`, run by the pre-commit checkpoint on an auth, crypto or data-access change). Out of scope next door: wiring sign-in and policies is the skill covering .NET authentication, and choosing a crypto primitive the skill covering .NET crypto primitives - where your skill list has neither, apply the obligations below and report the wiring UNVERIFIED rather than inventing it. Floor .NET 8 / C# 12; the .NET Framework 4.8 deltas are `references/net-framework-48.md`.

The principle: every byte that crossed a trust boundary is hostile until validated, and the secure path is the default.

**Each obligation below is one line; `references/owasp-in-full.md` carries it with its reason and worked code - read the category you are writing or reviewing.**

## A01-A05
- **A01 access control:** a fallback policy that requires an authenticated user (default-deny, `AllowAnonymous` opts out loudly); resource-based authorization on every id from the request - an id is input, never proof of ownership (IDOR); the check on the server, every request; CORS names exact origins, never `AllowAnyOrigin` with credentials; tokens scoped to what they may do; antiforgery tokens for every cookie-authenticated state change.
- **A02 cryptographic failures:** HTTPS everywhere with `UseHttpsRedirection()` and `UseHsts()` (forwarded headers first behind a proxy - HSTS guards browsers, not machine callers); classify fields as secret or sensitive and protect each; no key or connection string in the repo or `appsettings.json`.
- **A03 injection and XSS:** every query parameterized (the mechanics are the database-security skill's); OS commands take an argument array; Razor's encoding is the protection - `Html.Raw` / `MarkupString` only over content you generated or sanitized; a content-security-policy as backstop; allowlist validation at the boundary, never instead of the above.
- **A04 insecure design:** rate-limit login, token issuance, password reset and anything expensive (`AddRateLimiter`); fail closed when a security dependency is down; business limits enforced server-side. Binding straight onto an entity is mass-assignment: a caller can over-post a field the form never exposed - an owner id, an `IsAdmin` - and have it persisted. Bind a DTO in and out, map explicitly.
- **A05 misconfiguration:** no internals in an error response outside Development; the security headers (nosniff, a CSP, a referrer-policy, no Server header) as middleware; Swagger and detailed health checks off or behind auth in production; `ASPNETCORE_ENVIRONMENT` is `Production` in production.

## A06-A10

The mechanics are `references/owasp-a06-a10.md`; the obligations hold whatever is installed:

- **A06** - `dotnet list package --vulnerable --include-transitive` fails the CI build; supported versions; a lock file plus `packageSourceMapping`.
- **A07** - signature, issuer, audience and expiry all validated with tight skew; session cookies `HttpOnly` + `Secure` + `SameSite`; lockout or throttling with no user enumeration.
- **A08** - never a type-permissive deserializer over untrusted input (`BinaryFormatter` is unsafe by design); verify a signature or hash on anything loaded; the build chain is in scope.
- **A09** - log authentication and authorization outcomes and high-value actions with a correlation id, never a secret or PII, and alert on the attack patterns.
- **A10** - a user-supplied URL checked against an allowlist, private and metadata ranges rejected resolve-then-check, fetched on a dedicated `HttpClient` with redirects off and a tight timeout.

## Review output

A review delivers a findings table - `category | surface | risk | fix`, one row per finding ordered by risk. Name the route a fix belongs to by what it covers; when no installed skill matches, keep the finding in this report tagged with its surface and mark it UNVERIFIED for that wiring. A category you never looked at is UNVERIFIED, never a pass.

## Do not use

`BinaryFormatter`; Code Access Security and APTCA (no boundary on .NET); .NET Remoting and DCOM; a suppression over a security analyzer to ship - fix the finding.
