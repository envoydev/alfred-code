---
name: ionic
description: "Load before building or editing an Ionic or Capacitor app - ionic.config.json, capacitor.config.*, IonRouterOutlet. Not for web Angular with no native shell."
---

# Ionic / Capacitor Conventions

An Ionic app is an Angular app in a native (Capacitor) shell: the framework rules live in `angular-conventions` and the language baseline in `typescript` - load both. This skill is the Ionic/Capacitor-specific layer of house policy. In-app navigation and the page lifecycle are owned here in `references/navigation-and-lifecycle.md`; broader Ionic UI mechanics (component APIs, theming) are fetched live via the documentation server or the Ionic docs, not vendored. Per-plugin install/config is fetched live (the documentation server or the plugin's README); the durable plugin-sourcing and typed-service-wrapping guidance is here in this skill. Cutting a release - the build, signing, store submission, OTA, and release CI - is `capacitor-release`. Security-hardening the native surface - Keychain/Keystore secret storage, permission least-privilege, cleartext and WebView lockdown, deep-link input trust - is `ionic-security`. Version floors, the per-major deltas that bite, and the Ionic + Capacitor upgrade paths live in `references/versions.md`.

## When to use

Load before building or editing an Ionic/Capacitor mobile or hybrid app - anywhere `ionic.config.json` or `capacitor.config.*` lives.

Covers Ionic Angular UI (standalone + signals, IonRouterOutlet, page-caching view lifecycle, CSS-variable theming), the Capacitor lifecycle and platform guards, the Angular zone boundary around plugin listeners, runtime permissions, and plugin sourcing (official -> Capawesome -> capacitor-community) + typed-service wrapping. Targets the current Ionic and Capacitor majors - resolve the installed major before the first import rather than assuming one.

Do NOT load for plain web Angular with no native shell.

## Components and structure
- Standalone components + signals, OnPush, new control flow - same as `angular-conventions`. Ionic components (`IonContent`, `IonList`, ...) are standalone imports, not a shared module.
- Theme through Ionic CSS variables and `color` / `mode`, not hardcoded colors; keep design tokens in one place. Respect the system light/dark setting.
- Handle safe-area / edge-to-edge insets with the CSS `env(safe-area-inset-*)` variables (Ionic's `--ion-safe-area-*`), never fixed padding - Capacitor 8 draws content under the status and navigation bars by default (it dropped `adjustMarginsForEdgeToEdge` for a System Bars core plugin plus these CSS variables), so pad it back with the insets; the System Bars plugin API is fetched live.
- Dark mode is a palette you opt into, not per-component overrides: import Ionic's dark palette and choose the strategy - follow the OS (system) or an app toggle (the ion-palette-dark class on the root). Theme off the palette's CSS variables; never hand-roll dark colours per component. The v8 import files and the step-token split are in `references/versions.md`.
- Respect the OS accessibility settings: Ionic scales type to the device Dynamic Type / font-size setting by default (the `--ion-dynamic-font` token) - size with relative units and check large-text layouts, never fixed `px` that clips. Keep touch targets >= 44px and give every interactive control an accessible name.
- Keep page components thin: data + state in services/stores, presentation in the page.
- Import Ionic UI components and `provideIonicAngular()` from the standalone entry point the installed Ionic major documents - resolve it via the documentation server against the workspace's own `@ionic/angular` major before the first import, never from recall. The entry point moved between majors and the wrong one silently defeats tree-shaking; the per-major paths are in `references/versions.md`.

## Form controls - the modern syntax
- Label and validation live on the control, not slotted into `IonItem`: `IonInput` / `IonTextarea` / `IonSelect` carry `label`, `labelPlacement`, `fill` (`outline` / `solid`), `helperText`, `errorText`, and `counter` directly. Ionic 8 removed the legacy `IonItem`-wrapped form pattern and the `legacy` property - never author it or paste it from an old sample.
- The control's `label` (or an `[aria-label]` when it is visually labelled elsewhere) IS its accessible name - a field with neither fails the a11y gate. Build forms with typed reactive `FormGroup`s and surface validation through one shared `errorText` path, not a per-field `@if` error wall. That holds even where `angular-conventions` prefers Signal Forms (v21+): Ionic's controls are documented and tested against the reactive-forms path, so Signal Forms waits on Ionic surfaces until Ionic documents support for the installed major - check the Ionic docs via the documentation server before assuming, never recall.

## Overlays - modal, popover, toast, alert, action-sheet, loading
- Prefer the inline component with `[isOpen]` bound to a signal and `(didDismiss)` handled over the imperative `*Controller` - overlay state stays in the component and tears down cleanly. Reach for the controller only for a genuinely fire-and-forget prompt.
- Always read the dismissal: handle the backdrop tap, the hardware back, and the returned `role` on `didDismiss` - an overlay whose result you never read is a dropped user decision. Per-overlay component options are fetched live.

## Change detection and zoneless
- OnPush everywhere except the shell: never put OnPush on a component that hosts `IonRouterOutlet` or `IonNav`. It stops lifecycle hooks such as `ngOnInit` from firing and breaks async rendering (Ionic's own docs). Keep those shell components eagerly checked - `ChangeDetectionStrategy.Default`, renamed `Eager` in Angular 22, where OnPush became the framework default so the shell now opts out explicitly; apply OnPush only to leaf pages and presentational components.
- Zoneless is gated by the Ionic major, not the Angular one - check the installed major before deciding, and keep state flowing through signals either way, which is what makes the answer stop mattering to your own code. The per-major rule (Ionic 8 keeps Zone.js as a peer dependency and is not zoneless-compatible whatever Angular runs underneath; Ionic 9 ships official support) is in `references/versions.md`.

## Navigation
- Route with the Angular router inside an `IonRouterOutlet`; lazy-load every feature route via `loadComponent` / `loadChildren`. Tabs use `IonTabs` with their own outlet.
- Don't mix Ionic's imperative nav controllers with the Angular router in one app - pick the router and stay with it.
- Don't add `withViewTransitions()` to the router: `IonRouterOutlet` owns the page-stack transitions, and the two animation systems fight - double or broken transitions.

## Ionic page lifecycle
- Ionic caches pages in the DOM, so `ngOnInit` / `ngOnDestroy` fire only on create/pop, not on every revisit - route refresh-on-entry work onto `ionViewWillEnter`, deferred heavy work onto `ionViewDidEnter`. The full hook schedule and which hook owns which work are in `references/navigation-and-lifecycle.md`.
- Control navigation with Angular route guards (`CanActivate` / `CanDeactivate`) - they replaced the old `ionViewCanEnter` / `ionViewCanLeave`. Guards yes, route resolvers no for refresh-on-entry data: a cached page's revisit re-activates nothing, so a resolver never re-runs - that data belongs on `ionViewWillEnter`.

## Large lists
- Ionic's own virtual-scroll component was removed in v7 - for long lists use Angular CDK virtual scroll (`CdkVirtualScrollViewport` with `*cdkVirtualFor`) inside `IonContent`: set `[scrollY]="false"` on the `IonContent` and add the ion-content-scroll-host class to the viewport so Ionic's pull-to-refresh and infinite scroll keep working. CDK handles fixed-height rows well; variable-height rows can jank.

## Platform detection - pick the right check for the question
Gate native calls on `Capacitor.isNativePlatform()`, branch the OS with `Capacitor.getPlatform()`, read capabilities through Ionic's `Platform` in components - which call answers which question is `references/native-seam.md`.

## Capacitor lifecycle
- Plugin lifecycle is asymmetric: register listeners (`App.addListener('appStateChange', ...)`, `'backButton'`, `'appUrlOpen'`, `'resume'`, `'pause'`) once at app start, capture the returned handle, and remove it on teardown - a leaked native listener survives the Angular component that created it. Wrap registration in an app-level service whose `ngOnDestroy` (or `DestroyRef`) calls `removeAllListeners()`.
- The `App` plugin's `addListener` is async (returns a `Promise<PluginListenerHandle>`); await the handle before you rely on the listener being live, and store it for removal.
- Own pause/resume, hardware back, and deep links (`appUrlOpen`) in that one service, not scattered across pages. On resume, re-read any state that may have gone stale in the background (auth token, geolocation) rather than trusting the pre-pause snapshot.

## The Angular zone boundary - wrap every listener callback
Capacitor plugin listener callbacks fire outside Angular's `NgZone`, so any state they mutate escapes change detection and the UI silently goes stale - the single most common Angular+Capacitor bug. Wrap the body of every listener callback that touches template-bound state - `appStateChange`, `backButton`, `appUrlOpen`, `networkStatusChange`, the push events - in `NgZone.run()`; inject `NgZone` rather than reaching for `setTimeout` or `ApplicationRef.tick()`. Under zoneless (Ionic 9 on Angular 21+) the zone is a no-op and the signal write alone repaints - the wrap is harmless there, but the state must be a signal either way. Registration and teardown follow the lifecycle rule above: register in the app-level service, capture the handle, remove on destroy.

Broken - the template never updates:
```typescript
this.handle = await Network.addListener('networkStatusChange', (status) => {
  this.online.set(status.connected);          // runs outside the zone
});
```

Correct - run the mutation inside the zone:
```typescript
private zone = inject(NgZone);
this.handle = await Network.addListener('networkStatusChange', (status) => {
  this.zone.run(() => this.online.set(status.connected));
});
```

The same wrap is what makes the deep-link `Router.navigateByUrl` mapping and the push-tap routing actually repaint - both run inside a listener callback.

### Android hardware back button
Own the `backButton` listener in that same app-level service and branch on `canGoBack` - pop when there is history, exit only when there is none. Never call `App.exitApp()` unconditionally; it closes the app mid-stack.
```typescript
App.addListener('backButton', ({ canGoBack }) =>
  this.zone.run(() => (canGoBack ? this.location.back() : App.exitApp())));
```

## The native seam - one typed service owns it
- Call a plugin only through a typed Angular service, never the plugin API scattered across components. That service is the single owner of the whole seam: the permission check, the web-fallback branch, the listener lifecycle, and error mapping - a denied permission or a missing capability is a `Result` the UI renders, not an unhandled throw.
- Source in preference order: official `@capacitor/*`, then Capawesome (`@capawesome/capacitor-*`), then `@capacitor-community/*`, then a vetted community package - never an unmaintained one-off. Confirm the plugin's latest major matches your Capacitor major before adopting it.
- `checkPermissions()` before `requestPermissions()`, request at the point of use behind an affordance that explains why, and handle every terminal state including the partial ones. The iOS prompt is one-shot, so a denial you triggered before the user understood the value is permanent.
- Every native call needs a defined web path so the PWA and `ionic serve` still run - a real web implementation, a degraded stand-in, or an explicit typed 'unavailable' the UI renders as a disabled affordance. A silent no-op is the one outcome to avoid: it looks like a bug.
- Unit-test the wrapping service with the plugin mocked, never the device - a jsdom test that 'exercises' the native path is exercising your mock.

**Read `references/native-seam.md` before adopting a plugin, wiring a permission cycle, writing a web fallback, or planning device/E2E smoke** - it carries the vetting checklist, the full permission cycle, the three fallback shapes in preference order, and the UNVERIFIED reporting rule for native flows no device E2E suite covers. The push / deep-link / offline-sync service shapes are `references/native-features.md`.

## Prove it

Before any done word, run the web build (`ionic build`, or the workspace's `ng build`) and `npx cap sync` (copy, then update the native projects), and quote both result lines; then run the changed native flow on a device or simulator and quote what it showed. A native flow with no device run is reported UNVERIFIED, the flow named - never inferred from a jsdom test.
