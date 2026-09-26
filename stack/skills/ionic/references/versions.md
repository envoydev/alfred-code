# Ionic + Capacitor version notes

The hub (`SKILL.md`) stays version-agnostic. This file is the orientation map for the two version axes the skill spans - **Ionic Framework** (the UI toolkit) and **Capacitor** (the native runtime), which version independently and must not be conflated. It carries the floors, the per-major deltas that actually bite, and where to fetch the full migration guide - fetch the linked guide live for the exhaustive list; this is the index, not a vendored changelog.

## Ionic Framework

Floor: Ionic 7. Current: Ionic 9 (needs Angular 18-22; Ionic 8 needs Angular 16+ - the house floor is Angular 17+ either way). Prefer the 9 path.

- **Standalone entry point, per major** - Ionic 8: import UI components and `provideIonicAngular()` from `@ionic/angular/standalone`, because the bare `@ionic/angular` barrel pulls in lazy-loaded code that defeats tree-shaking. Ionic 9: standalone IS the default `@ionic/angular` entry and the lazy barrel moved to `@ionic/angular/lazy`. Resolve the path against the installed major via the documentation server before the first import, never from recall. (Hub: Components and structure.)
- **Zoneless, per major** - Ionic 8 keeps Zone.js as a peer dependency and is not zoneless-compatible whatever Angular runs underneath: keep `zone.js` in the polyfills; signals are still fine in your own layer, they just do not make Ionic's components zoneless. Ionic 9 ships official zoneless support and Angular 21+ defaults to it, so a plain field set from an async callback no longer repaints on its own - state flows through signals (or `markForCheck()`), which the hub's signals-first rules already satisfy. (Hub: Change detection and zoneless.)

- **8 -> 9** (fetch <https://ionicframework.com/docs/updating/9-0>): Angular 16 and 17 dropped (18-22 supported); official zoneless support (Hub: Change detection and zoneless); browserslist floors raised (Chrome / Edge 89, Firefox 75, Safari / iOS 16); on Angular 22's OnPush default Ionic's own components are OnPush-ready and `ng update` migrates existing components to keep their prior behavior - the `IonRouterOutlet` / `IonNav` shell stays `Eager` explicitly (Hub: Change detection and zoneless).
- **7 -> 8** (fetch <https://ionicframework.com/docs/updating/8-0>):
  - Legacy form syntax removed - `label` / `fill` / `helperText` / `errorText` / `counter` live on `IonInput` / `IonTextarea` / `IonSelect`, never slotted in `IonItem`; the `legacy` property is gone. (Hub: Form controls.)
  - Dark mode: import the dark palette via `dark.always.css` / `dark.class.css` / `dark.system.css`; palettes target `:root`, not `body`. Light defaults now import from `core.css`.
  - Step tokens split: `--ion-color-step-N` became `--ion-background-color-step-N` + `--ion-text-color-step-N`.
  - `--ion-default-dynamic-font` renamed `--ion-dynamic-font` (Dynamic Type, on by default).
  - `IonPicker` is now the inline component; the old one is `IonPickerLegacy` (deprecated). `Nav.getLength()` returns a `Promise`. `IonBackButtonDelegate` import became `IonBackButton`.
- **6 -> 7** (fetch <https://ionicframework.com/docs/updating/7-0>): Angular 16+, adopt the built-in control-flow, and the old virtual-scroll component was removed - use Angular CDK virtual scroll (Hub: Large lists).

## Capacitor

Floor: Capacitor 6 (a live v6 project is in scope). Current: Capacitor 8. Prefer the 8 path. Majors cannot be skipped - upgrade 6 -> 7 -> 8 in steps, and `npx cap migrate` automates most of each hop.

- **6 -> 7** (fetch <https://capacitorjs.com/docs/updating/7-0>): Node 20+, Xcode 16, iOS target 14, Android Studio Ladybug + JDK 21, Kotlin 1.9.25, minSdk 23 / targetSdk 35; removed `bundledWebRuntime` and `cordova.staticPlugins`.
- **7 -> 8** (fetch <https://capacitorjs.com/docs/updating/8-0>): Node 22+, Xcode 26, iOS target 15, Swift Package Manager is the default iOS dependency manager (CocoaPods via `--packagemanager CocoaPods`), Android Studio Otter + Kotlin 2.2.20, minSdk 24 / compile+target 36, edge-to-edge via the System Bars plugin + CSS `env()` (Hub: Components; `capacitor-release` owns the SPM iOS-build change).
- Support policy - which majors are still maintained, the signal for when to raise the floor: <https://capacitorjs.com/docs/main/reference/support-policy>
