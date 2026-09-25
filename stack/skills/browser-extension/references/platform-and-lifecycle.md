# Platform state, cross-browser matrix, lifecycle detail

Loaded from the `browser-extension` skill when picking targets, debugging worker termination, or handling per-browser divergence. Dates verified as of mid-2026 - the platform moves fast; re-check the primary sources when a date is load-bearing.

## MV2 endgame (Chrome)

- Stable-channel disabling began Oct 2024; MV2 stopped running for ordinary stable users with Chrome 138 (Jul 2025).
- Enterprise `ExtensionManifestV2Availability` exemption ended with Chrome 139.
- Chrome 150 (stable Jun 30, 2026) removed the first developer re-enable flag; Chrome 151 (stable Jul 28, 2026) removes the last.
- Aug 31, 2026: the Web Store removes remaining MV2 extensions and stops serving their updates (installed copies on old Chromes linger, frozen).

## Cross-browser matrix

| Target | Background | Blocking webRequest | Notes |
|---|---|---|---|
| Chrome / Edge (Chromium) | service worker | no - declarativeNetRequest only (blocking survives solely for policy-installed enterprise) | Edge Add-ons takes the same build |
| Firefox | event page (non-persistent), NOT a service worker | YES - kept in MV2 and MV3 | supports both manifest versions indefinitely; the full-power target for ad-blocker-class filtering |
| Safari | converted Web Extension | no | `xcrun safari-web-extension-converter` generates an Xcode container app; App Store distribution; dev testing needs 'Allow Unsigned Extensions' (resets on Safari quit); the converter's unsupported-key warnings are incomplete - budget real fix-up time |

- Declare both `background.service_worker` (Chrome) and `background.scripts` (Firefox) - Chrome 121+ ignores the extra keys, Firefox 121+ starts the event page regardless.
- Namespace: under MV3 every async `chrome.*` method returns a promise when no callback is passed (complete since Chrome 122; event listeners still take callbacks), and Firefox's `browser.*` is promise-based. webextension-polyfill gives one promise-based `browser.*` everywhere (no-op on Firefox). Chrome ships a native `browser` namespace from 148, but the polyfill stays the safe floor for older versions.
- If the extension's core is blocking network filtering, Firefox is the only full-power target - plan the Chrome build around declarativeNetRequest limits from day one.

## Service worker lifecycle

- Termination after ~30s idle; every event and extension API call (even `storage.local.get`) resets the timer (Chrome 110+); the old 5-minute hard cap is gone. Active WebSocket messages and debugger sessions extend life (116+). Prompt-showing APIs (`identity.launchWebAuthFlow`, `permissions.request`, `desktopCapture.chooseDesktopMedia`) hold strong keep-alives.
- Never keep the worker alive artificially - design for cold starts instead: cheap top-level (synchronous listener registration, lazy imports), all state in storage.
- Wake-from-sleep edge case: timers may fire while async extension API calls are not guaranteed to complete or reset the timer - treat alarm/timer callbacks as best-effort and idempotent.

## Storage quotas

| Store | Quota | Notes |
|---|---|---|
| storage.local | ~10 MB (5 MB before Chrome 114) | `unlimitedStorage` raises it; unencrypted |
| storage.sync | ~100 KB total, 8 KB/item | unencrypted; sync conflicts possible |
| storage.session | ~10 MB (1 MB before Chrome 112) | in-memory; not exposed to content scripts by default; the token home |
| IndexedDB | large | via extension pages or an offscreen document - not the SW's Web Storage (unavailable) |

## Offscreen documents

`chrome.offscreen.createDocument()` with a declared reason (AUDIO_PLAYBACK, DOM_PARSER, CLIPBOARD, WORKERS, LOCAL_STORAGE...; multiple reasons since 115). Static HTML, one at a time, torn down when idle, `chrome.runtime` messaging only. The escape hatch for DOM/audio/clipboard/canvas work the service worker cannot do.

## Contexts inventory

Background SW (event router, no DOM), content scripts (page DOM, isolated world), popup, options page, side panel (`chrome.sidePanel`, 114+), devtools pages, offscreen documents. Every context speaks the one typed message contract from the skill body.
