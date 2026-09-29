---
name: ionic-security
description: "Load when hardening or reviewing the security of an Ionic or Capacitor feature - 'is it safe to store the token like this', 'lock the app behind Face ID'."
---

# Ionic / Capacitor mobile security

An Ionic app is an Angular app running in a native WebView with a bridge to native code. It inherits **every** web risk (see the skill covering Angular web hardening - XSS, CSP, token storage, CSRF) **plus** a native attack surface the browser does not have: on-device storage an attacker with the device can read, deep links other apps can fire, native permissions, and the WebView container itself. This is the native map. Assume the device may be lost, rooted, or shared, and that another app on it is hostile.

## When to use

Load when hardening or reviewing an Ionic/Capacitor feature - 'is it safe to store the token like this', 'lock the app behind Face ID', 'review our deep links' - or when a security audit sweeps the mobile stack. Targets Capacitor 6+.

Covers Keychain / Keystore secret storage (never localStorage or Preferences), deep links as untrusted input, least-privilege native permissions, release-build WebView settings, navigation allowlisting, screen-capture and backgrounding, plugin trust, pinning and biometric gating.

Do NOT load for non-security work.

## Secret and token storage

- Capacitor `Preferences`, `localStorage`, and IndexedDB are **plaintext** on the device - never store tokens, keys, or PII in them. Use a secure-storage plugin backed by the iOS **Keychain** and Android **Keystore** (a Keychain / secure-storage plugin); the encryption key lives in the Keystore/Keychain, not in JS.
- On the web fallback there is no Keychain - degrade explicitly (a shorter-lived in-memory token, or refuse the sensitive path), never silently fall back to plaintext.
- Clear the secure store on logout, and do not log token values.

## Deep links, custom schemes, universal links

- A deep link - a custom scheme (`myapp://`) or an App / Universal Link - is **attacker-reachable input**. Validate every parameter before it routes, authenticates, or performs an action; never auto-run a state-changing operation from a deep link without a confirmation step.

```typescript
App.addListener('appUrlOpen', ({ url }) => {
  const path = new URL(url).pathname;   // parse - never route the raw string
  const allowed = /^\/(orders|profile)(\/[\w-]+)?$/.test(path);
  this.zone.run(() => this.router.navigateByUrl(allowed ? path : '/home'));
});
```
- Custom schemes can be registered by other apps on the device (scheme hijacking) - prefer verified **App Links (Android) / Universal Links (iOS)** for anything sensitive, since they are domain-bound.

## Native permissions

- Least privilege is the security control here: request only the permissions the feature actually needs - every extra grant widens the native attack surface, and an over-broad manifest is itself a review finding. The point-of-use request cycle and terminal-state handling (`denied`, iOS `limited`, coarse-vs-fine location) are `ionic`'s operational ground; the security review checks the requested set is minimal, not that the prompts are wired.

## Network and transport

- Disable **cleartext traffic** in release: iOS App Transport Security (no `NSAllowsArbitraryLoads`), Android `networkSecurityConfig` (no `cleartextTrafficPermitted`). No `http://` endpoints.
- Consider **certificate pinning** for a high-value API, accepting the rotation/operational cost; a pinned cert that cannot be rotated is its own outage risk.

Android enforces the cleartext ban in `res/xml/network_security_config.xml`, referenced from the manifest's `android:networkSecurityConfig`:
```xml
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
</network-security-config>
```

## WebView hardening

- Turn **off** WebView debugging in release (`webContentsDebuggingEnabled` false) - a debuggable WebView is a remote inspector into the running app.
- `server.url` / live-reload must **never** ship in a release build - it points the app at a dev machine over http. Release ships the bundled assets.
- `allowNavigation` is an allowlist - keep it tight; do not load arbitrary external URLs into the app WebView. Open external links in the system browser (the `Browser` plugin), not in-app, so untrusted content never runs in the app's WebView context.

## Data at rest and on screen

- Android: set `FLAG_SECURE` on screens showing secrets - it blocks screenshots and the recents-thumbnail capture. iOS: obscure or blank the UI on backgrounding so the app-switcher snapshot does not leak sensitive data.
- Keep sensitive data out of the WebView cache and out of native/JS logs.

## Plugin trust

- A Capacitor plugin runs **native code** with the app's full privileges - a malicious or vulnerable one is a native compromise, not a sandboxed one. Audit any third-party plugin before adding it: check the source and maintenance status, review the native permissions it requests, and pin the version so a later supply-chain push cannot swap the code under you. Sourcing preference and typed-service wrapping are `ionic`'s ground.

## Defense-in-depth, not controls

- Jailbreak / root detection and biometric gating raise the bar but are bypassable on a determined attacker's own device - treat them as friction, never as the security boundary. Biometric auth gates **access to** a secret held in the Keychain; it is not itself the secret, and it does not replace server-side authorization.

## Build and distribution

- Signing and store/OTA integrity is `capacitor-release`'s ground - it owns the signed-HTTPS + integrity-check control on the live-update channel; a security review confirms the release is signed, cleartext/debug flags are off, and that OTA control is actually in place.

## Review output

Prove the two release flags mechanically before either one becomes a row - a flag you did not grep is reported UNVERIFIED, never assumed off:

```bash
grep -rn 'cleartextTrafficPermitted' android/app/src/main/res/       # expect ="false"; no file at all is itself the finding
grep -rn 'webContentsDebuggingEnabled\|server' capacitor.config.*    # expect no debugging flag true, no server.url outside a dev-only config
```

Report findings as `surface | risk | fix`, ordered by risk - e.g. `Preferences token store | anyone with the device reads the session token | move to the Keychain/Keystore plugin, biometric-gate the read`. Findings on the web layer inside the WebView route to the skill covering Angular web hardening (XSS, CSP, token storage, CSRF), on the API side to the skill covering ASP.NET / .NET hardening - name the route by what it covers, do not restate its content here; when no installed skill matches, keep the finding in this report tagged with its surface and mark it UNVERIFIED for that stack.
