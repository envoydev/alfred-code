# File uploads - hardening

Treat every upload as hostile:

- **Cap the size in two places.** Kestrel's `MaxRequestBodySize` bounds the whole request; `FormOptions.MultipartBodyLengthLimit` bounds the multipart body. Set both - one without the other leaves a gap.
- **Do not trust the declared type.** The `Content-Type` header and the file extension are attacker-controlled. Sniff the real type from the leading magic bytes / file signature and reject anything not on an allowlist.
- **Do not trust the filename.** A supplied name like `../../etc/passwd` is a path-traversal attempt. Save under a server-generated name (`Guid.NewGuid()`), store the original separately if you need it for display, and never use it to build a path.
- **Keep antiforgery on.** An upload is a form post, so `UseAntiforgery()` applies. Only `.DisableAntiforgery()` on an endpoint that is genuinely not cookie/CSRF-exposed (for instance a bearer-token API), and know why before you do.

The error/`ProblemDetails` shape for a rejected upload stays with the HTTP error-handling skill; auth posture with the authentication skill.
