# OWASP A06-A10 applied to .NET - the detail

The per-category detail the skill body summarizes in one bullet each. Open the category you are reviewing; the body carries the obligation, this file carries the mechanics.

## Contents
1. A06 - Vulnerable and outdated components
2. A07 - Identification and authentication failures
3. A08 - Software and data integrity failures
4. A09 - Security logging and monitoring failures
5. A10 - Server-side request forgery (SSRF)

---

## A06 - Vulnerable and outdated components

Most of the code in a service is other people's, and that code has its own published vulnerabilities.

- **Audit dependencies in CI, not by hand.** The gate is NuGet Audit, which runs on every restore: raise its high and critical codes to errors (`<WarningsAsErrors>$(WarningsAsErrors);NU1903;NU1904</WarningsAsErrors>`) and the restore fails when a known-bad package (direct or pulled in beneath one) is present. Set `NuGetAuditMode` `all` below net10.0 - the default there audits direct references only, and transitive coverage matters because the flaw is usually two levels down. `dotnet list package --vulnerable --include-transitive` is the report a human reads; it exits 0 on a finding, so a CI step built on it never goes red. To keep a new advisory from blocking unrelated fixes, the NuGet docs' pattern raises the codes only in a dedicated audit pipeline (an MSBuild condition on a property the pipeline passes to `dotnet restore`).
- **Patch on a schedule, not on incident.** Keep packages current and the runtime supported - a framework past end-of-life stops getting security fixes entirely.
- **Pin and verify.** Lock files plus package source mapping (a nuget.config `packageSourceMapping` section) stop a dependency-confusion swap, where a malicious public package shadows an internal one:

```xml
<packageSourceMapping>
  <packageSource key="nuget.org"><package pattern="*" /></packageSource>
  <packageSource key="internal"><package pattern="Contoso.*" /></packageSource>
</packageSourceMapping>
```

## A07 - Identification and authentication failures

How tokens, cookies, and sessions are actually issued and validated belongs to the skill covering .NET authentication. The security obligations that sit on top of that machinery are these, and they hold with or without it:

- **Validate tokens completely.** Signature, issuer, audience, and expiry all checked; clock skew kept tight. Writing that configuration belongs to the authentication skill; the requirement that none of those validations is switched off is here.
- **Harden cookies.** Session cookies are `HttpOnly`, `Secure`, and `SameSite` - that combination is what blunts session theft and CSRF.
- **Defend the credential flows.** Lockout or throttling on repeated failures, no enumeration (the response for an unknown user matches the one for a wrong password), and password rules that lean on length over forced complexity.

## A08 - Software and data integrity failures

This category is where insecure deserialization lives - the moment untrusted bytes are turned back into objects that can carry behavior.

- **Never deserialize untrusted input with a type-permissive formatter.** `BinaryFormatter` is unsafe by design - a crafted payload reaches gadget chains during deserialization and executes. Calling it became a compile error in .NET 7, the methods throw by default at runtime from .NET 8, and the in-box implementation was removed in .NET 9 (a legacy-compat package is the only way back). On the .NET 8 floor the type is present but throws, so any working call had to opt back in deliberately - treat that opt-in as the vulnerability and delete it. Use System.Text.Json with a known, constrained set of types; do not enable polymorphic deserialization over data you did not produce, and bind to concrete DTOs rather than `object` or `dynamic`.
- **Verify what you load.** Check integrity (a signature or hash) on plugins, updates, and serialized state before trusting them, and pull build dependencies only from sources you control.
- **Treat the supply chain as in-scope.** A compromised build step or unverified artifact is an integrity failure even when your own code is clean.

## A09 - Security logging and monitoring failures

You cannot respond to what you never recorded, and you cannot trust logs that leak what they were meant to protect.

- **Log the security-relevant events.** Authentication success and failure, authorization denials, and high-value actions, each carrying a correlation/trace id so a single request can be reconstructed end to end. The observability wiring - Serilog, the correlation id, structured fields - belongs to the skill covering the ASP.NET Core cross-cutting baseline; this skill says which events are worth logging, and the list stands whatever sink you have.
- **Never log a secret or PII.** Passwords, tokens, keys, full card or account numbers, and identifying data stay out of logs - redact or omit them at the source, because a log aggregator is a far softer target than the database.
- **Make logs actionable.** Alert on the patterns that signal an attack (a spike of authorization denials, repeated login failures from one source); a log nobody watches is not monitoring.

## A10 - Server-side request forgery (SSRF)

When the server fetches a URL the user influenced, the attacker can aim that fetch at the internal network - cloud metadata endpoints, internal admin panels, anything the server can reach but the user cannot.

- **Allowlist outbound destinations.** Any URL built from user input (webhooks, image fetches, link previews) is validated against an allowlist of permitted hosts or schemes before the request goes out; an allowlist is the control, a denylist of bad hosts is not.
- **Block the internal ranges.** Reject loopback, link-local, private, and cloud-metadata addresses, and resolve-then-check so a DNS name cannot rebind to an internal IP after validation.
- **Constrain the client itself.** A dedicated `HttpClient` with redirects disabled and a tight timeout stops a 302 from bouncing an allowlisted host to an internal one.
