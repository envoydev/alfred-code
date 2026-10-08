---
name: angular-security
description: "Load when hardening or reviewing Angular web security - XSS, bypassSecurityTrust, CSP nonces, XSRF, token storage, SSR leaks. Not for non-security or mobile."
---

# Angular / web frontend security

Angular escapes interpolated values by output context by default, so the classic reflected XSS is closed out of the box. The vulnerabilities are where you leave that path, trust the client with something it should not hold, or reach a DOM sink Angular never saw. This is the client-side map. Treat every value that crossed a trust boundary - an API response, a route param, a deep link, a postMessage - as hostile until proven otherwise.

## When to use

Load when hardening or reviewing an Angular web feature for security: XSS and bypassSecurityTrust, innerHTML, CSP nonces, CSRF/XSRF, secrets in the bundle, auth-token storage, SSR leaks, open redirects, vulnerable npm packages.

Not for non-security work or the mobile native surface.

## XSS and the sanitizer bypass

- Interpolation `{{ }}` and property bindings auto-escape by context. The holes are the escape hatches: `DomSanitizer.bypassSecurityTrustHtml / Script / Style / Url / ResourceUrl` each **disable** Angular's protection for that value. Never call a `bypassSecurityTrust*` on anything that contains user input - a `bypassSecurityTrustResourceUrl` on a user-controlled iframe or `<object>` src is a full XSS, and `bypassSecurityTrustHtml` on user markup ships a script.

```ts
// VULNERABLE - user-controlled query param, sanitizer disabled for it: full XSS
readonly embedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
  this.route.snapshot.queryParams['src']);

// SAFE - bypass only a value YOU constructed; user data enters it encoded
readonly embedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
  `https://player.example.com/embed/${encodeURIComponent(this.videoId)}`);
```
- `[innerHTML]="value"` is sanitized for the HTML context, but it is still a smell on user data - prefer structural rendering. Never assign `ElementRef.nativeElement.innerHTML`, call `document.write`, or use `Renderer2` / raw DOM APIs to inject unsanitized markup; those skip Angular's sanitizer entirely.
- URL bindings (`[href]`, `[src]`) are sanitized against `javascript:` and other dangerous schemes - a `bypassSecurityTrustUrl` re-opens that hole.
- Reflected-from-the-API is still XSS: a value the API stored from another user and you render is untrusted; the escaping must hold end-to-end.

## Content-Security-Policy

- Ship a strict CSP - a nonce-based script-src with no unsafe-inline and no unsafe-eval. Angular supports a build/runtime nonce (`CSP_NONCE`) so its inline styles/scripts carry the nonce. A good CSP turns a landed XSS from code execution into a blocked console error.
- The style-src directive needs a nonce or hash for Angular component styles; do not fall back to unsafe-inline to make it work.
- Add Trusted Types where the browser supports it (the require-trusted-types-for 'script' CSP directive): it makes raw string-to-DOM-sink writes throw at the browser layer, so a stray `innerHTML` or a slipped `bypassSecurityTrust*` becomes a hard error instead of a payload. Angular's sanitizer is Trusted Types-aware, so idiomatic bindings keep working.

## CSRF

- For **cookie-authenticated** APIs, use Angular HttpClient's built-in XSRF support (`provideHttpClient(withXsrfConfiguration(...))`): it reads the `XSRF-TOKEN` cookie and sends the `X-XSRF-TOKEN` header, which the server validates. A state-changing cookie-auth endpoint with no antiforgery is a CSRF finding.
- Pure `Authorization: Bearer` APIs carry no ambient cookie, so CSRF does not apply - but then see token storage, because the token lives in JS.

## Secrets never ship to the client

- `environment.ts` is compiled **into** the bundle - anything there is world-readable. No API keys, connection strings, or signing secrets client-side. A value the browser can read is not a secret; if the front end needs one, it calls a backend-for-frontend that holds it.
- Distinguish a **publishable** key (a Stripe publishable key, a Maps browser key with referrer restrictions - legitimately client-side) from a real secret; only the former belongs in the bundle.
- Disable or restrict source maps in production, or you ship readable source and comments.

## Auth-token storage

- `localStorage` / `sessionStorage` are readable by any script on the origin - one XSS drains every token there. Prefer an `httpOnly`, `Secure`, `SameSite` cookie the JS cannot read (paired with the CSRF protection above). If a token must live in JS, minimize its lifetime and scope so a theft window is short.

## SSR / hydration (Angular SSR / Universal)

- `TransferState` embeds server-fetched data into the served HTML for the client to reuse - never place a secret, an internal field, or another user's data in it.
- SSR that reflects request input into the rendered HTML is server-side XSS - escape it on the server too.
- Server-only config and code must not leak into the client bundle; keep server providers off the browser build.

## Navigation and redirects

- **Open redirect**: never `router.navigateByUrl` / `window.location =` a URL taken from a query param without validating it against an allowlist of internal paths.

```ts
// VULNERABLE - ?returnUrl=https://evil.example walks the user off-site after login
this.router.navigateByUrl(this.route.snapshot.queryParams['returnUrl']);

// SAFE - internal paths only ('//' is protocol-relative, still an exit)
const returnUrl: string = this.route.snapshot.queryParams['returnUrl'] ?? '/';
this.router.navigateByUrl(
  returnUrl.startsWith('/') && !returnUrl.startsWith('//') ? returnUrl : '/');
```
- `target="_blank"` needs `rel="noopener"` (modern browsers mostly default it, but be explicit) or the opened page can drive `window.opener`.
- Validate route and query params before they reach a request or a DOM sink.

## Dependencies and supply chain

- Run `npm audit --omit=dev` and quote the high and critical counts; a known-CVE package version at either level is a finding. An audit you did not run is reported UNVERIFIED, never as a pass.
- Pin versions, review transitive pulls, and watch for typosquatted package names. A compromised build-time dependency runs with your build's privileges.

## Sensitive-data hygiene

- No PII or tokens in `console.log` shipped to production. No secrets rendered into the DOM. Strip debug panels and diagnostic routes from the production build.

## Review output

Report findings as `surface | risk | fix`, ordered by risk - e.g. `[innerHTML] fed through bypassSecurityTrustHtml | stored XSS runs in every viewer's session | bind the sanitized value and keep trust calls away from user-influenced input`. Findings on the server side route to the skill covering ASP.NET / .NET hardening (the OWASP-mapped server mitigations), on the native shell to the skill covering the Ionic / Capacitor native attack surface (Keychain storage, deep links, WebView lockdown) - name the route by what it covers, do not restate its content here; when no installed skill matches, keep the finding in this report tagged with its surface and mark it UNVERIFIED for that stack. A fix you applied closes with its proof - the rebuilt bundle or served header, and the spec that now fails on the old code.
