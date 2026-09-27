---
name: ionic
description: "Ionic / Capacitor mobile + hybrid app conventions. Load before building or editing an Ionic/Capacitor app - anywhere ionic.config.json or capacitor.config.* lives. Covers Ionic Angular UI (standalone + signals, IonRouterOutlet, page-caching view lifecycle, CSS-variable theming), the Capacitor lifecycle and platform guards, the Angular zone boundary around plugin listeners, runtime permissions, and plugin sourcing (official -> Capawesome -> capacitor-community) + typed-service wrapping. Targets the current Ionic and Capacitor majors - resolve the installed major before the first import rather than assuming one. The Angular framework conventions and the TypeScript baseline apply underneath. Do NOT load for plain web Angular with no native shell."
---

# Ionic / Capacitor Conventions

An Ionic app is an Angular app in a native (Capacitor) shell: the framework rules are `angular-conventions` and the language baseline `typescript` - load both. This is the Ionic/Capacitor layer. Navigation and the page lifecycle: `references/navigation-and-lifecycle.md`; version floors and upgrade paths: `references/versions.md`; component APIs and per-plugin config are fetched live (the documentation server, the plugin README). Releases are `capacitor-release`; hardening the native surface is `ionic-security`.

**Each rule below is one line; `references/ionic-in-full.md` carries it with its reason and worked code - read it before a new page, a form, a plugin listener, or platform-specific code.**

## Components, forms, overlays
- Standalone components with signals, OnPush and the new control flow; Ionic components as standalone imports from the entry point the installed `@ionic/angular` major documents - resolve it via the documentation server first (`references/versions.md` has the per-major paths).
- Theme through Ionic CSS variables and `color` / `mode`; safe areas through `env(safe-area-inset-*)` / `--ion-safe-area-*` (Capacitor 8 draws edge to edge); dark mode by opting into Ionic's palette, never per-component overrides; relative units that honor Dynamic Type; touch targets >= 44px with an accessible name. Pages stay thin.
- Form controls carry `label`, `labelPlacement`, `fill`, `helperText`, `errorText` themselves - never the removed `IonItem`-wrapped legacy pattern; typed reactive `FormGroup`s with one shared `errorText` path (Signal Forms waits until Ionic documents them for the installed major).
- Overlays inline with `[isOpen]` on a signal and `(didDismiss)` read - backdrop, hardware back and the returned `role` included; a `*Controller` only for fire-and-forget prompts.

## Change detection and navigation
- Never OnPush on a component hosting `IonRouterOutlet` or `IonNav` (lifecycle hooks stop firing) - keep that shell eagerly checked (`Default`, `Eager` from Angular 22); OnPush on leaf pages. Zoneless is gated by the Ionic major (Ionic 8 keeps Zone.js) - state in signals either way.
- The Angular router inside `IonRouterOutlet`, every feature route lazy, `IonTabs` with its own outlet; never Ionic's imperative nav controllers beside the router, never `withViewTransitions()`.
- Pages are cached: refresh-on-entry work on `ionViewWillEnter`, heavy deferred work on `ionViewDidEnter`; route guards yes, resolvers no for refresh-on-entry data.
- Long lists use CDK virtual scroll inside `IonContent` (`[scrollY]="false"`, the viewport carrying the ion-content-scroll-host class).

## Platform and the native seam
- `Capacitor.isNativePlatform()` gates native code; `Capacitor.getPlatform()` only for genuinely OS-specific behavior; Ionic's `Platform` inside components. Resolve it once in a typed service exposing signals.
- Register `App` listeners (`appStateChange`, `backButton`, `appUrlOpen`, `resume`, `pause`) once in an app-level service, await and keep the handle, `removeAllListeners()` on destroy; re-read stale state on resume.
- Every listener callback that touches template-bound state runs inside `NgZone.run()` - Capacitor callbacks fire outside the zone and the UI silently goes stale (under zoneless the signal write alone repaints).
- The Android back button pops when `canGoBack`, exits only when not - never an unconditional `App.exitApp()`.
- A plugin is called only through a typed Angular service that owns the permission check, the web fallback, the listener lifecycle and error mapping (a denial is a `Result`, never a throw). Source official `@capacitor/*`, then Capawesome, then `@capacitor-community/*`; `checkPermissions()` before `requestPermissions()`, at the point of use; every native call has a defined web path, never a silent no-op; unit-test the service with the plugin mocked. Read `references/native-seam.md` before adopting a plugin or wiring a permission cycle; push, deep-link and offline-sync shapes are `references/native-features.md`.
