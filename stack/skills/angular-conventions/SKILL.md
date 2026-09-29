---
name: angular-conventions
description: "Load when creating or editing an Angular component, service, directive, pipe or template, refactoring to signals, or reviewing Angular code. Not for React."
---

# Angular conventions

House rules for Angular, floored at v17 and reaching forward to whatever the workspace is actually on (v20, v21, v22): version-gated idioms name their floor inline, the rest applies from v17 up, and a newer idiom is adopted only when the installed version ships it. This file is opinion, not reference - the choices the team settled on and the divergences kept on purpose.

Load with it:

- The house TypeScript skill, beside this one - the language underneath (strict types, modules, async, error handling, lint and format); everything here is purely Angular.
- Material and the CDK, and the Ionic/Capacitor layer, are each their own skill - match them from your skill list by what they cover, and skip any this project did not install.
- Only your workspace's version delta (`references/v22.md`, `v21.md`, `v20.md`, `v19.md`: stable versus experimental, spellings and deprecations, the Node.js/TypeScript floor); on v17/v18 there is none and this file alone governs.
- For any API surface not pinned down here, reach for the `documentation` MCP rather than memory - and never by grepping `node_modules` bundles.

The measurements behind these rules are `references/evidence.md` - an audit appendix, not a run-time load.

**The enforceable config lives in `references/angular-style.md`** - the angular-eslint + Prettier flat config, the naming table, modern-vs-legacy examples. A project's own config (`eslint.config.js`, `angular.json`, `.prettierrc`, `.editorconfig`) and its `<docs-path>/code-style/CODE-STYLE.md` are higher priority - follow the project where it diverges.

## When to use

Angular conventions from v17 up - standalone everything, signals as the default state primitive, OnPush and zoneless, block control flow, signal inputs and outputs, deferred loading, RxJS only where streams earn it, forms, routing, SSR and hydration, accessibility, harness testing, banned patterns, reward-hacking shortcuts to reject.

Not for React, Vue, Svelte, Solid, plain DOM, or non-Angular TypeScript.

## Standalone is the only module model
- Every component, directive, and pipe is `standalone` - the implicit default from v19, declared explicitly before that. `NgModule` does not appear in new code; the bootstrap is `bootstrapApplication` with an `ApplicationConfig`.
- A component pulls in exactly what its template uses via `imports`. No grab-bag shared module re-exporting half the framework.
- File names follow the v20 style guide - **drop the type suffix** (`order-list.ts`, not `order-list.component.ts`; guards and interceptors hyphenate, `auth-guard.ts`). v19 and earlier keep the classic suffix so `ng update` keeps generating it - migrate organically, never mass-rename. The full naming table is `references/angular-style.md`.
- One responsibility per file; template and styles sit beside the class in the same folder, inlined only for genuinely trivial components. Style scoping and architecture (`ViewEncapsulation`, `:host`, design tokens, responsive, a11y styling) is `angular-styling`.
- Selectors are kebab-case with the project prefix - `app-order-list`, never a bare `order-list` that risks colliding with a third-party tag.
- Keep the container-versus-presentational split honest: containers own data fetching and state, presentational components take inputs and emit outputs and hold no service of their own.

## Signals are the default state primitive
- Local component state is a `signal`; anything derived is a `computed`; side effects that must react to state run in an `effect`. Reach for this before any other mechanism in new code.
- Any state a `computed` or an `effect` reads must itself be a `signal` - no exceptions. A plain class property that feeds a derived value is the reactivity bug to hunt: it is read once at creation and never again, so the derived view silently goes stale. A filter field, a selected id, a search term that narrows a list all qualify (bug and fix side by side: `references/change-detection-and-signals.md`).
- `linkedSignal` (v19+) is writable state derived from a source that should reset when the source moves; `resource` and `rxResource` (v19+) lift async work into signals - read `value()`, `hasValue()`, and `status()` instead of hand-managing loading and error booleans (object forms, the `abortSignal` rule and what each `status()` value means: same reference). DOM measured or written after render goes in `afterRenderEffect`, split by phase - the phase rules are in the same reference.

## State management: which tier, and when a store is warranted
The default is the smallest thing that holds the state: local signal -> signal service -> SignalStore -> full NgRx, climbing a tier only when the one below cannot express the need. Stores (NgRx, NGXS, a signal-based store) are a last resort for state that truly spans many unrelated features. What each tier is for is `references/state-tiers.md`; load it when shared state outgrows a local signal. After refactoring shared state at any tier, run `references/click-path-audit.md` before calling it done.

## Server state is not client state
Server data (a fetched list, a record by id) is never copied into a signal service or a store - it stays in an async read primitive that owns loading, error and freshness, and a mutation invalidates then refetches. Which primitive (`httpResource` / `resource` / `rxResource` for one screen, TanStack Query's Angular adapter once a server cache is shared and mutated) is `references/state-tiers.md` - load it before wiring any server read.

## RxJS only where a stream earns it
- Observables are for genuine streams: HTTP responses, debounced input, event buses across components. Never wrap a plain synchronous value in an observable.
- At a template-only boundary, convert with `toSignal` so the view consumes a signal and you avoid the async pipe's subscription bookkeeping.
- Always tear down. Inside a component use `takeUntilDestroyed` (v16+) or the `DestroyRef` it reads from; a manual `Subject` plus `takeUntil` is only acceptable in a class with no injection context.
- Never nest a `subscribe` inside another `subscribe`. Flatten with the higher-order operator whose semantics you actually want - `switchMap` to cancel the previous, `concatMap` to queue, `mergeMap` to run in parallel, `exhaustMap` to ignore while busy - and say why in review when it is not obvious.
- Keep `map` pure. Side effects belong in `tap`.
- Cache a shared stream with `shareReplay({ bufferSize: 1, refCount: true })` so late subscribers get the last value and the source unsubscribes when the audience empties.

## Change detection is always OnPush
- `ChangeDetectionStrategy.OnPush` on every component in new code - explicit below v22, the framework default from v22 (which renamed the old `Default` strategy `Eager` and deprecated the old name). An eagerly-checked component is a bug unless a library's own docs require it - then keep it on `Eager` (`Default` below v22) and cite the requirement inline.
- Feed components immutable data through signal inputs - `input()` and `input.required<T>()` - emit with `output()`, and bind two-way state with `model()` (v17.2+). The decorator `@Input` and `@Output` survive only in code predating 17.1; never mix the two styles in one component.
- Drive the view with signals or observables, not a hand-placed `markForCheck`. If you are reaching for `ChangeDetectorRef`, the state shape is wrong.
- OnPush is the stepping stone to zoneless, not the destination. Where the installed version ships stable zoneless change detection (v20.2+, the default for new apps from v21) AND every framework layer in the app supports it (a layer that still requires `zone.js` keeps it - that framework's skill owns the call), drop `zone.js` and bootstrap with `provideZonelessChangeDetection()` plus `provideBrowserGlobalErrorListeners()`. Every update must then flow through a signal or `AsyncPipe`; the dev-first migration order is in `references/change-detection-and-signals.md`.

## Templates carry no logic
- A template holds simple expressions only. Push any real computation into a `computed` signal; never call a method from the template, since it re-runs every change-detection pass.
- Use block control flow - `@if`, `@for`, `@switch` - in place of the old structural directives. Give every `@for` over an object collection a `track` expression keyed on a stable identity.
- Defer below-the-fold and non-critical content with `@defer`. Pick the trigger on purpose - `on viewport`, `on idle`, `on interaction` - and always supply a `@placeholder` so nothing reflows when the block resolves.
- Static images go through `NgOptimizedImage`; mark the above-the-fold hero `priority` so the LCP image preloads and its box is reserved, killing layout shift.
- No `@angular/animations` DSL in new code - it is deprecated: use the native `animate.enter` / `animate.leave` bindings and plain CSS transitions, and plan existing DSL animations off it. Route transitions use `withViewTransitions()` - except inside an Ionic `IonRouterOutlet`, whose own stack transitions it fights (page transitions there belong to the skill covering the Ionic/Capacitor layer; with none installed, keep `withViewTransitions()` off that outlet and say why inline).

## SSR and hydration
Web targets only - a Capacitor WebView has no server render, so skip this in an Ionic native app. SSR project: the rules are in `references/ssr-hydration.md` - Read it before touching server rendering, hydration, or any code that runs during the server pass (browser globals, non-deterministic output, the transfer cache).

## Services and dependency injection
- App-wide singletons declare `providedIn: 'root'` so they tree-shake when unused and need no module registration.
- Pick `inject()` or constructor injection and hold to it per project; `inject()` is the recommendation in new code because it composes cleanly in functions, guards, and base classes.
- Depend on an interface or an injection token, not a concrete class, so a feature can be tested and re-provided without editing its consumers.

## HTTP, routing, and forms
Read `references/http-routing-forms.md` before adding an HTTP call or interceptor, a route or resolver, or a form, or reviewing a change that does: endpoint config, functional interceptors, typed reactive forms versus Signal Forms, lazy routes, route-param input binding, resolvers (never in an Ionic app), and the validation layer.

## Accessibility
- Every interactive element is reachable by keyboard and shows a visible focus indicator.
- Reach for semantic HTML first - `<button>`, `<nav>`, `<main>`, `<header>` - and add ARIA only when no native element expresses the intent.
- For custom widgets (accordion, listbox, combobox, menu, tabs, and more), build on the headless `@angular/aria` directives (developer preview in v21, stable from v22): they own the keyboard, focus, and ARIA state machine; you supply the markup and styles, hung off the aria-expanded / aria-selected / aria-current attributes they manage. Check `angular.dev/guide/aria` for the current roster and never reimplement that logic.
- Text contrast meets WCAG AA - exact ratios are `angular-styling`'s to state.

On greenfield or visual work, load `references/design-quality.md` before the first screen goes in (type scale, spacing rhythm, color, motion, per-state rules), unless you are reproducing a fixed design or Figma handoff faithfully. It owns the *taste*; the mechanism is the styling skill's (CSS, tokens, responsive) and, where the project uses Material, the theming skill's.
## Feature boundaries
- Features may depend on `shared/` and `core/` but never on one another. No import from `features/billing` reaches into `features/orders`. (How barrels and deep imports are policed is `typescript`.)
- Anything two features must share crosses through a service in `core/` or a state store, never a direct component reference.

## Performance budgets
Web/PWA target only: read `references/performance-budgets.md` before a production release, a change to the `angular.json` budgets, or a change that grows the initial bundle, or reviewing one.

## Testing
- Test practice is `angular-testing`'s - load it before writing, changing, or reviewing tests; this skill keeps only the convention below.
- Bake automated accessibility checks into component specs - a11y is a convention gate here, not just a test technique. The matcher package follows the workspace's runner (`angular-testing` owns runner routing): `jest-axe` on Jest, `vitest-axe` on Vitest, raw `axe-core` (`axe.run` on the fixture element) under Karma/Jasmine - never mandate a matcher the installed runner cannot load.
- Before calling an Angular change done, run the workspace build and the specs covering the files you touched, and quote both result lines. A build that was never run is not a green build.

## Banned patterns
- No `setTimeout` poked in to coax change detection into noticing a change - it only 'works' because zone.js patches timers to trigger a render, so it papers over a broken signal/input flow and silently stops working under zoneless. Fix the flow instead.
- No direct DOM mutation outside a directive - the server has no browser DOM and a hand-mutated node is the classic hydration-mismatch error, and a raw `innerHTML` write skips Angular's sanitizer; go through `Renderer2`.
- No method calls in template expressions - they re-run on every change-detection pass; bind a `computed` instead.
- No `null` field defaults in forms - a `null` default widens the typed control to `T | null` and leaks null checks into every consumer.
- No decorator queries or host bindings in new code - `viewChild()`/`contentChild()` return signals that compose with `computed` and `effect`, and the `host` object replaces `@HostBinding`/`@HostListener`, which Angular keeps only for backwards compatibility.

## Reward-hacking shortcuts to reject
The recurring ways a change fakes a green build or suite instead of earning it - reject each in review, whoever wrote it. This is the one consolidated list to check a diff against before claiming done; the language-level bans (`any`, `@ts-ignore`, non-null `!`) live in `typescript`.

The shortcut-by-shortcut table is `references/reward-hacking.md` - read it before claiming a change is done.

