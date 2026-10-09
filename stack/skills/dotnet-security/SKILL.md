---
name: dotnet-security
description: "Use when hardening or reviewing a .NET app for vulnerabilities - OWASP Top 10 for ASP.NET Core, WPF, WinForms, console, services. Not for sign-in or crypto."
---

# .NET application security - the OWASP Top 10, applied

This is the hardening reference: how the 2021 OWASP Top 10 categories show up in an ASP.NET Core service and what to do about each. OWASP's 2025 revision reshuffles the ranks, folds SSRF into A01, and adds software-supply-chain and exceptional-conditions categories; the mitigations map either way (supply chain under A06 / A08, exceptional conditions under A04 / A05 and the .NET web error-handling skill), so the sections keep the stable 2021 numbering. It is a static checklist you read while writing or reviewing code, and it pairs with the pre-commit security review of the live diff - that review is the moving part, this is the durable map. This skill says where the controls belong in the threat model, not how they are built. Floor is .NET 8 / C# 12.

A WPF, WinForms, console or Windows-service app keeps the same categories behind other boundaries - opened files, IPC, local secrets, process starts, updates - and drops the browser-only controls; that map is `references/desktop-and-service-apps.md`.

On a .NET Framework 4.8 codebase the TLS defaults, `BinaryFormatter` (still shipping there), classic-ASP.NET security headers, and the dependency-audit prerequisites differ - those deltas are in `references/net-framework-48.md`.

The principle under all of it: treat every byte that crossed a trust boundary as hostile until you have validated it, and make the secure path the default one - a control you have to remember to add is a control you will eventually forget.

## When to use

- Maps the OWASP Top 10 to ASP.NET Core mitigations (IDOR, injection, XSS, CORS, crypto, deserialization, SSRF), reported as a findings table.
- A desktop, console or Windows-service app: read `references/desktop-and-service-apps.md` first - CORS, antiforgery, HSTS, the response headers and XSS encoding do not apply there, while deserialization of opened files, local secrets, process starts, IPC and update integrity do. Same findings table.
- Not for building sign-in or picking crypto primitives - those belong to the skills covering .NET authentication (handlers, token validation, cookie and policy configuration) and .NET crypto primitives. Where nothing in your skill list covers one, apply the obligations below and report that wiring UNVERIFIED rather than inventing it.

## A01 - Broken access control

The most common real-world failure: the user is authenticated, but the app never checks whether *this* user may touch *this* thing.

- **Default-deny.** Set a fallback authorization policy so that an endpoint with no explicit policy is still protected, not open. Forgetting an `[Authorize]` then fails closed instead of leaking the route. Anonymous endpoints opt out loudly with `AllowAnonymous`.

```csharp
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build());
```

- **Kill IDOR.** An id from the route, query string, or body is an *input*, never proof of ownership. `GET /orders/{id}` must confirm the caller owns that order before returning it - otherwise incrementing the id walks the whole table. Enforce this with resource-based authorization: a `AuthorizationHandler<TRequirement, TResource>` that loads the resource and checks the relationship, invoked via an injected `IAuthorizationService`. Role checks alone do not catch this; two users with the same role still must not read each other's rows.

```csharp
var order = await db.Orders.FindAsync(id);          // id is input, not proof of ownership
if (order is null)
{
    return TypedResults.NotFound();
}

var allowed = await authz.AuthorizeAsync(user, order, "OwnsOrder");
if (!allowed.Succeeded)
{
    return TypedResults.NotFound();                 // same role != same rows; a 403 would confirm the id exists
}
```

The status is the house one: a resource the caller may not see returns 404, never 403 - no existence disclosure; 403 only where the caller can see the resource but not the action (a caller who may read an order but not cancel it gets 403 on the cancel).

- **Check on the server, every time.** A hidden field, a disabled button, or a missing menu item is UX, not a control. The authorization decision lives on the server and runs on every request, including the ones a browser would never send.
- **Lock down CORS.** Name the exact allowed origins; never pair `AllowAnyOrigin` with `AllowCredentials` - the framework will reject the combination at runtime precisely because it defeats the same-origin protection.
- **Scope what a token can do.** Least privilege applies to tokens too: an API key or JWT scoped to read should not be accepted on a write. The policy plumbing belongs to the skill covering .NET authentication; the obligation to scope the token is here.
- **Antiforgery tokens are the CSRF control for cookie auth, not `SameSite`.** A `SameSite` cookie is a blunt backstop; the real defense for a cookie-authenticated `POST`/`PUT`/`PATCH`/`DELETE` is an antiforgery token - Razor's form tag helper injects it as a hidden field automatically, and AJAX callers read it and send it in the configured request header. Disabling it (`DisableAntiforgery()`) is safe only for endpoints that authenticate by a non-ambient credential - a bearer token, not a cookie - and never for a cookie-auth state change.

## A02 - Cryptographic failures

The category formerly called sensitive-data exposure - the failure is usually that data which should have been protected was not, or was protected with the wrong tool.

- **Algorithm and key choices belong to the skill covering .NET crypto primitives** - SHA-2 versus the broken hashes, AES-GCM for authenticated encryption, the right password KDF, and how keys are generated and rotated. Do not re-derive any of that here.
- **Encrypt in transit, no exceptions.** HTTPS everywhere, HSTS on in production via `app.UseHsts()`, and `UseHttpsRedirection()` so a plaintext request is bounced rather than served.
- **Classify before you store.** Know which fields are secret (passwords, tokens, keys) and which are merely sensitive (PII), and protect each accordingly - hashed-and-salted for credentials, encrypted-at-rest for the rest. Do not log either (see A09).
- **Keys and connection strings are not source.** Nothing secret ships in the repo or in `appsettings.json`. Use user-secrets in development and a managed vault or platform-injected environment variables in production.
- **HSTS protects browsers, not machine callers.** `UseHsts()` emits a directive a browser caches and enforces; it does nothing for an API-to-API or other non-browser consumer, so treat it as a defense-in-depth layer for browser clients, never as the transport control itself - TLS on the connection is that. Behind a reverse proxy or load balancer, order the forwarded-headers middleware before `UseHttpsRedirection()` so the app sees the client's original scheme; without it, HTTPS detection reads the proxy's plaintext hop and the redirect and secure-cookie logic misfire.

## A03 - Injection (SQL, command, LDAP) and XSS

Injection happens whenever untrusted input is concatenated into something an interpreter then parses as code. The fix is always the same shape: keep data as data.

- **Parameterize every query.** The security non-negotiable is that no user value ever lands inside the SQL text; the mechanics - EF Core `FromSqlInterpolated` vs raw `FromSqlRaw`, Dapper and ADO.NET command parameters, dynamic-SQL nuance - belong to the skills covering database security and database conventions. Any string-concatenated SQL you find is a finding.
- **The same rule covers OS commands and LDAP.** If you must shell out, pass arguments as an argument array rather than a single string the shell re-parses, and prefer a typed API over spawning a process at all.
- **Encode on output to stop XSS.** Razor HTML-encodes interpolated values by default; that default is the protection, so do not defeat it. `Html.Raw`, `MarkupString`, and `[AllowHtml]` over untrusted input reopen the hole - reserve them for content you generated or sanitized server-side. JSON written through System.Text.Json is encoded correctly; hand-built script or HTML strings are not.
- **Defense in depth at the browser.** A content-security-policy header limits what injected markup can do even if something slips through; it is a backstop, not a substitute for encoding.
- **Validate at the boundary anyway.** Strong typing and allowlist validation - FluentValidation in an endpoint or action filter, per the skill covering HTTP error handling and request validation - shrink the attack surface before any of the above runs. Validation is not a replacement for parameterization or encoding - it is the layer in front of them.

## A04 - Insecure design

Some weaknesses are not bugs in the code but gaps in the plan, and no amount of careful implementation fixes a missing control.

- **Rate-limit the abusable surfaces.** Login, token issuance, password reset, and anything expensive need throttling so they cannot be brute-forced or used to exhaust resources; the built-in rate-limiting middleware (`AddRateLimiter`) covers this.
- **Fail closed by design.** When a dependency the security decision depends on is unavailable - the authorization store, the token validator - deny rather than wave the request through.
- **Enforce business limits server-side.** Quantity caps, ownership rules, and workflow state transitions are part of the threat model; a client that can post any quantity or skip a step is a design hole, not a UI bug.
- **Bind the request to a DTO, never onto an entity.** Binding straight onto an entity is mass-assignment: a caller can over-post a field the form never exposed - an owner id, an `IsAdmin` - and have it persisted. Returning that same entity across the boundary leaks columns and invites a serialization cycle. Bind to a dedicated command/query DTO in and out and map explicitly, so no entity crosses the HTTP boundary. The binding and mapping mechanics belong to whichever skill covers your endpoint surface (minimal APIs or controller-based Web API); this is where the control sits in the threat model.

## A05 - Security misconfiguration

The framework's defaults are mostly safe; the failures come from turning them off, leaving development settings in production, or never setting the production ones.

- **Send no detail to the client on error.** Errors surface as `ProblemDetails` with developer messages and stack traces suppressed outside Development - the shape itself belongs to the skill covering HTTP error handling - the global handler, the error-to-status map, the ProblemDetails envelope; the security stake is that an unhandled exception must not leak internals, paths, or SQL.
- **Set the response security headers.** An X-Content-Type-Options of nosniff, a restrictive content-security-policy, a referrer-policy, and dropping the Server header all close small but real gaps; apply them as middleware so every response carries them.
- **Trim what you expose.** Disable Swagger/OpenAPI and detailed health-check payloads in production unless they sit behind auth, and remove sample or debug endpoints before ship.
- **Keep environments honest.** `ASPNETCORE_ENVIRONMENT` must be `Production` in production - the developer exception page, verbose logging, and relaxed settings are all gated on it, and a misset environment is itself the vulnerability.

## A06-A10 - the second half, in one bullet each

The mechanics for these five categories are `references/owasp-a06-a10.md` - open the category you are reviewing. The obligation that must hold whatever the install looks like is here:

- **A06, vulnerable and outdated components.** The CI gate is restore-time NuGet Audit raised to errors - `<WarningsAsErrors>$(WarningsAsErrors);NU1903;NU1904</WarningsAsErrors>` fails the restore on a high or critical advisory, with `NuGetAuditMode` `all` below net10.0, where the default audits direct references only. `dotnet list package --vulnerable --include-transitive` is the human-readable report and exits 0 on a finding, so it gates nothing. Packages and the runtime stay on supported versions; a lock file plus `packageSourceMapping` closes the dependency-confusion swap.
- **A07, identification and authentication failures.** Signature, issuer, audience and expiry are all validated with tight clock skew and none of them switched off; session cookies are `HttpOnly` + `Secure` + `SameSite`; credential flows carry lockout or throttling and leak no user enumeration.
- **A08, software and data integrity failures.** Never deserialize untrusted input with a type-permissive formatter - `BinaryFormatter` is unsafe by design and any working call on the .NET 8 floor is a deliberate opt-in to delete; verify a signature or hash on anything you load, and treat the build chain as in-scope.
- **A09, security logging and monitoring failures.** Log authentication success and failure, authorization denials and high-value actions with a correlation id; never log a secret or PII; alert on the attack patterns, because a log nobody watches is not monitoring.
- **A10, server-side request forgery.** Any URL built from user input is checked against an allowlist of hosts or schemes, loopback / link-local / private / cloud-metadata ranges are rejected resolve-then-check, and the fetch runs on a dedicated `HttpClient` with redirects disabled and a tight timeout.

## Review output

When this skill is used to review rather than to write, the deliverable is a findings table, not prose:

`category | surface | risk | fix` - one row per finding, ordered by risk, the category naming the A0x above. Name the route a fix belongs to by what it covers, do not restate its content here; when no installed skill matches, keep the finding in this report tagged with its surface and mark it UNVERIFIED for that wiring. State what you did NOT check as plainly as what you did - a category you never looked at is UNVERIFIED, never a pass.

When this skill is used to harden, quote the check for each category you touched: the restore failing on a seeded NU1903 advisory (A06), the `curl -I` header block (A05), the 404 on another user's id (A01).

## Do not use - dead but still tempting

- **`BinaryFormatter`** - the unsafe deserializer; see A08 above.
- **Code Access Security and APTCA** - not a security boundary on .NET (Core) and unsupported; never rely on them to sandbox anything.
- **.NET Remoting and DCOM** - legacy, unsafe transports; use a modern, authenticated transport instead.
- **Suppressing a security analyzer to ship** - a `#pragma warning disable` or suppression over a security rule is a decision to ship the vulnerability; fix the finding rather than silence it.
