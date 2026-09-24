# Building the native seam - sourcing, permissions, fallbacks, tests

The full rules behind the seam bullets in `SKILL.md`. Open this file before adopting a plugin,
wiring a permission cycle, writing a web fallback, or planning device/E2E smoke. The three
cross-cutting features that are each built as one of these services - push notifications, deep
links, offline-first sync - have their own shapes in `native-features.md`.

## Contents

- Capacitor plugins - sourcing
- Wrapping - the typed-service contract
- Permissions - check, explain, request, handle the no
- Native-vs-web fallbacks - degrade, never crash
- Testing the native seams

## Capacitor plugins - sourcing

Preference order when you need a plugin:

1. **Official** `@capacitor/*` core plugins first (Camera, Geolocation, Preferences, Filesystem, ...).
2. **Capawesome** `@capawesome/capacitor-*` (github.com/capawesome-team/capacitor-plugins) - well-maintained, tracks the current Capacitor major.
3. **capacitor-community** `@capacitor-community/*` (the capacitor-community org) for community-maintained needs.
4. Vetted community / CapGo only if nothing above fits - never an unmaintained one-off npm package.

Before adopting any third-party plugin: confirm its latest major matches your Capacitor version,
check recent releases / commits (maintenance), and verify iOS / Android / web platform support.
Per-plugin install and config is fetched live - context7 or the plugin's own README, since it drifts
per release; the durable sourcing and typed-wrapping policy is here.

## Wrapping - the typed-service contract

- Call a plugin only through a typed Angular service - never the plugin API scattered across
  components. The service is the single owner of the whole native seam: the permission check, the
  web-fallback branch, the listener lifecycle, and error mapping (a denied permission or missing
  capability is a `Result` the UI renders, not an unhandled throw).
- The cross-cutting native features nearly every production app hits - push notifications, deep
  links / universal links, offline-first sync - are each built as one of these services; their house
  shapes (token lifecycle, URL-to-route mapping, queue-and-drain) live in `native-features.md`.

## Permissions - check, explain, request, handle the no

Run the full cycle, in order, for any permission-gated API (camera, geolocation, notifications, contacts):

- Check first with the plugin's `checkPermissions()`; only call `requestPermissions()` when the status is `'prompt'` / `'prompt-with-rationale'`. Never request blind on app start.
- Request at the point of use, right after a UI affordance that explains why - the OS prompt is one-shot on iOS, so a denial you triggered before the user understood the value is effectively permanent.
- Handle every terminal state explicitly: `'granted'`, `'denied'`, and the partial states that matter (iOS `'limited'` photo access, coarse-vs-fine location). A denial is a `Result` the UI renders (a disabled control plus a deep-link to system settings via the App plugin), never an unhandled throw.
- Re-check on resume - the user may have changed the grant in system settings while backgrounded.

## Native-vs-web fallbacks - degrade, never crash

- Every native call needs a defined web path so the PWA and `ionic serve` dev build still run.
- Three fallback shapes, in order of preference: (1) a real web implementation when the plugin ships web support (Capacitor's official plugins mostly do - Camera falls back to file input, Preferences to localStorage); (2) a degraded-but-functional stand-in (share via the Web Share API, or copy-link when even that is absent); (3) an explicit, typed 'unavailable' result the UI can render as a disabled affordance. Prefer the highest one the plugin and target support - a silent no-op is the one outcome to avoid, because it looks like a bug.
- Feature-detect, don't assume: gate on `Capacitor.isPluginAvailable('Camera')` and the platform, not on a try/catch that swallows everything.

## Testing the native seams

- Unit-test the wrapping service, not the device: with the plugin mocked (the workspace runner's spy - `vi.fn()`, `jest.fn()`, or `jasmine.createSpyObj`, per `angular-testing`), assert the web-fallback branch and the permission-denied path return the typed `Result` the UI renders. These run in jsdom with no device or emulator.
- Do not try to drive real native plugin behavior in a jsdom unit test - the bridge is not there, so a test that 'exercises' the native path is only exercising your mock. Keep those tests honest about that boundary.
- Reserve a device E2E suite (Appium or WebdriverIO against a device or simulator - heavy, it needs Xcode / the Android SDK + Java) for true smoke of the few native-critical flows (push tap -> route, deep-link cold start, an offline-then-reconnect drain). Smoke the handful that would silently break in production, not the whole surface; with no such suite in the project, list those flows as UNVERIFIED in the report instead of faking them in jsdom.
