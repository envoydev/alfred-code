---
name: browser-extension
description: "Use when building or shipping a browser extension - 'build a chrome extension', manifest.json / MV3, content scripts, chrome.* APIs. Not for web apps."
---

# Browser extensions - MV3 engineering that survives review and termination

Build MV3-only: Chrome stopped running MV2 for ordinary users mid-2025 and the Web Store drops the stragglers in 2026. The platform's four structural facts drive everything below: the background context is an **ephemeral service worker** (not a persistent page), blocking webRequest is gone on Chromium (declarativeNetRequest instead - Firefox keeps blocking), **remotely hosted code is banned** (everything executable ships in the reviewable package), and host permissions are runtime-grantable. Timeline dates, the cross-browser matrix, and lifecycle detail: `references/platform-and-lifecycle.md`.

## When to use

Use when building, reviewing, or shipping a browser extension - 'build a chrome extension', manifest.json / MV3 work, content scripts, extension service workers, chrome.* or browser.* APIs, popup/options/side-panel UI, Web Store or AMO publishing.

Browser-extension engineering (TypeScript/JavaScript, Manifest V3): the ephemeral service-worker model, content-script isolation and MAIN-world boundaries, typed cross-context messaging, storage tiers and quotas, least-privilege permissions, CSP-safe UI frameworks, WXT-first tooling, store review and monetization reality.

Not for regular browser web apps, Electron or VS Code extensions (Node-runtime work), or package-manager mechanics.

## Architecture non-negotiables

- **The service worker is an event router, never a state holder.** Globals vanish on termination (~30s idle; each event or extension API call resets the timer). Persist everything: `chrome.storage.session` for ephemeral state and tokens (in-memory, not exposed to content scripts by default), `chrome.storage.local` for durable data, IndexedDB via an extension page or offscreen document past ~10 MB. `localStorage` does not exist in a SW. Periodic work uses `chrome.alarms` (30s minimum) - `setInterval` dies with the worker. Register listeners synchronously at top level and lazy-import heavy modules: every event may be a cold start.
- **One typed message contract.** All contexts (SW, content scripts, popup, options, side panel, offscreen) talk through one TS module of discriminated-union message types - `runtime.sendMessage` for one-shots, `runtime.connect` ports for streams. Untyped ad-hoc messages are how extensions rot. One module, imported by every context:

  ```ts
  export type Msg =
    | { type: 'CAPTURE_TAB'; tabId: number }
    | { type: 'SAVE_NOTE'; body: string };
  export type Reply = { ok: true; id: string } | { ok: false; error: string };
  ```
- **Content scripts run in an isolated world** - shared DOM, separate JS. Touching page JS needs an explicit MAIN-world injection (`world: 'MAIN'`), and MAIN world is enemy territory: the page reads and rewrites it, so no sensitive logic and no trust in anything coming back. Injected UI mounts inside a shadow DOM so host-page CSS cannot bleed in. Prefer lazy `scripting.executeScript` injection over static `content_scripts` that run on every page load.
- **Cross-browser through the `browser.*` promise namespace** (webextension-polyfill or the toolkit's wrapper). Firefox runs background as an **event page, not a service worker** - declare both background keys in the one `background` object; each browser ignores the other's. Feature-detect at runtime instead of assuming parity.

  ```json
  "background": {
    "service_worker": "background.js",
    "type": "module",
    "scripts": ["background.js"]
  }
  ```

## Security floor

- **Least privilege wins review**: `activeTab` + optional host permissions requested at runtime beat `<all_urls>` - overbroad hosts are a top rejection and a permanent trust cost.
- **No secrets in the bundle, ever** - any user can read the package. Privileged calls go through your backend proxy; the extension holds only a session/license token, in `storage.session` (local/sync are unencrypted).
- **OAuth = authorization-code + PKCE via `identity.launchWebAuthFlow`** (it holds a strong SW keep-alive), code exchange on the backend, `state` for CSRF, no client secret shipped. `getAuthToken` only for Google-only Chrome-only cases.
- **Treat page-originated input as hostile**: validate `sender` on every `onMessage`/`onMessageExternal`, restrict `externally_connectable` to named origins, never `innerHTML` untrusted content in a content script (textContent / DOM APIs / Trusted Types) - a content script XSS runs with extension privileges.
- **Keep the default strict CSP**; genuinely-needs-eval code goes in a sandboxed page isolated from extension APIs. Every dependency ships in the reviewable bundle - minimize them and pin versions.

## Tooling and UI

Default toolkit: **WXT** (Vite-based, cross-browser Chrome/Firefox/Safari/Edge from one codebase, generated manifest, content-script HMR) - the alternatives and when they win, plus testing (Vitest + fake chrome API; Playwright persistent-context E2E) and CI publishing: `references/tooling-and-testing.md`. Keep business logic in framework-free TS modules decoupled from `chrome.*` - that is what makes it unit-testable; the general TS/JS testing practices for that unit layer (role-keyed strategy, seam stubbing, exclusion catalog) are `ts-js-testing`'s.

UI frameworks work in popup/options/side panel with one hard constraint: extension-page CSP forbids `unsafe-eval`, so **no runtime template compilation** - Vue runtime-only build with precompiled SFCs (never the full build), Angular AOT (never JIT), Svelte/React precompile anyway (verify nothing emits `Function` constructors). Keep popup bundles small - a full framework runtime inside a content script is a smell.

## Shipping

Store policies, review realities (single-purpose rule, AMO's readable-source + bundled-dependency requirements, obfuscation bans), distribution modes, and monetization (no built-in store billing - your backend + a merchant-of-record, license token checked on load): `references/store-and-distribution.md`.

Prove it before any done word: load the unpacked build, confirm the service worker registers with no error in its own console, send one message end to end and confirm the typed reply comes back, then quote both results. A manifest that parses is not an extension that runs, and the store review is the wrong place to discover the difference.
