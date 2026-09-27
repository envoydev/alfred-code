---
name: angular-conventions
description: "Load when creating or editing an Angular component, service, directive, pipe or template, refactoring to signals, or reviewing Angular code. Angular conventions from v17 up - standalone everything, signals as the default state primitive, OnPush and zoneless, block control flow, signal inputs and outputs, deferred loading, RxJS only where streams earn it, forms, routing, SSR and hydration, accessibility, harness testing, banned patterns, reward-hacking shortcuts to reject. Not for React, Vue, Svelte, Solid, plain DOM, or non-Angular TypeScript."
---

# Angular conventions

House rules for Angular, floored at v17 and reaching forward to whatever the workspace is on: a version-gated idiom names its floor, and a newer one is adopted only when the installed version ships it. The language underneath is the house TypeScript skill's - load it beside this one. Material and the CDK, the web index and the Ionic/Capacitor layer are their own skills - match them from your skill list by what they cover, skipping any this project did not install. This file is opinion, not reference: for any API surface not pinned down here, reach for the `documentation` MCP rather than memory - and never by grepping `node_modules` bundles. Version specifics: load only your workspace's delta (`references/v22.md`, `v21.md`, `v20.md`, `v19.md`); v17/v18 have none. `references/evidence.md` holds the measurements.

**Every rule below is one line; `references/conventions-in-full.md` carries each with its reason, version gate and example - read it before a new component, service, form, route or test setup.** The enforceable config is `references/angular-style.md` (angular-eslint + Prettier, the naming table). A project's own config and its `<docs-path>/code-style/CODE-STYLE.md` are higher priority - follow the project where it diverges.

## Components and templates
- Standalone only (the default from v19); `bootstrapApplication`; each component imports exactly what its template uses - no grab-bag shared module.
- v20 file names drop the type suffix (`order-list.ts`); v19 and earlier keep it - migrate organically, never mass-rename.
- One responsibility per file; selectors kebab-case with the project prefix; containers own data and state, presentational components only inputs and outputs. Style scoping is `angular-styling`.
- `ChangeDetectionStrategy.OnPush` on every component (the default from v22, where `Default` became `Eager`); an eager one only where a library requires it, cited inline.
- Signal inputs (`input()`, `input.required<T>()`), `output()`, `model()` - never mixed with `@Input` / `@Output` in one component. Drive the view with signals, never a hand-placed `markForCheck`.
- Zoneless where the installed version ships it stable (v20.2+) and every framework layer supports it - `provideZonelessChangeDetection()`; the migration order is `references/change-detection-and-signals.md`.
- Templates hold simple expressions: computation in a `computed`, never a method call; `@if` / `@for` / `@switch` with a `track` on every object `@for`; `@defer` with a chosen trigger and a `@placeholder`; `NgOptimizedImage` with the hero `priority`.
- No `@angular/animations` DSL in new code - `animate.enter` / `animate.leave` and CSS; `withViewTransitions()` for routes, never inside an Ionic `IonRouterOutlet`.

## State
- Local state is a `signal`, derived state a `computed`, reactions an `effect` - and anything a `computed` or `effect` reads is itself a signal (a plain property read there goes silently stale).
- `linkedSignal` for state that resets with its source; `resource` / `rxResource` for async work, read through `value()`, `hasValue()`, `status()`; DOM after render in `afterRenderEffect` (`references/change-detection-and-signals.md`).
- The smallest tier that holds the state - local signal, signal service, SignalStore, NgRx - climbing only when the tier below cannot express it (`references/state-tiers.md`); after refactoring shared state, run `references/click-path-audit.md`.
- Server state is a cache you do not own: `httpResource` / `resource` / `rxResource`, or TanStack Query once shared and mutated - never copied into a store; a mutation invalidates then refetches. Read `references/state-tiers.md` before wiring a server read.
- RxJS only for genuine streams; `toSignal` at the template; tear down with `takeUntilDestroyed`; never nest `subscribe` (pick `switchMap` / `concatMap` / `mergeMap` / `exhaustMap` on purpose); `map` pure, effects in `tap`; `shareReplay({ bufferSize: 1, refCount: true })`.

## Services, HTTP, routing, forms
- Singletons `providedIn: 'root'`; `inject()` in new code, one style per project; depend on an interface or a token.
- Endpoint URLs in one config; auth, retry and error normalization in functional interceptors (`withInterceptors`).
- Lazy routes with `loadComponent`; route data into `input()`s with `withComponentInputBinding()`; critical data through a thin `resolve` - not in an Ionic app, where cached pages never re-activate.
- Typed reactive forms by default (Signal Forms on v22+, experimental on v21); no field typed or defaulted `null`; validation as one layer with one shared error surface - read `references/forms-validation.md` before any non-trivial form.
- SSR (web targets only): read `references/ssr-hydration.md` before server rendering, hydration, or code that runs in the server pass.

## Accessibility, boundaries, budgets
- Every interactive element keyboard-reachable with a visible focus; semantic HTML before ARIA; custom widgets on the headless `@angular/aria` directives (stable from v22); contrast is `angular-styling`'s to state.
- Greenfield or visual work: read `references/design-quality.md` before the first screen (skip when reproducing a fixed design).
- Features depend on `shared/` and `core/`, never on one another; what two features share crosses through `core/` or a store.
- Web targets: initial bundle under 500 KB gzipped, encoded as `angular.json` budgets; Lighthouse 90+ before a production release.

## Testing
- Test practice is `angular-testing`'s - load it before writing or reviewing tests. Specs carry automated a11y checks with the matcher the workspace's runner can load (`jest-axe`, `vitest-axe`, or raw `axe-core`).
- Before calling a change done, run the workspace build and the specs covering the touched files, and quote both result lines.

## Banned patterns
- No `setTimeout` to coax change detection; no DOM mutation outside a directive (`Renderer2`, never raw `innerHTML`); no method calls in templates; no `null` form defaults; no decorator queries or `@HostBinding` / `@HostListener` in new code (`viewChild()`, the `host` object).

## Reward-hacking shortcuts to reject
The recurring ways a change fakes a green build or suite instead of earning it - reject each in review, whoever wrote it; the language-level bans live in `typescript`. The shortcut-by-shortcut table is `references/reward-hacking.md` - read it before claiming a change is done.
