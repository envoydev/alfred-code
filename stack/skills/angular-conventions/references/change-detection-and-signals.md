# Change detection and signals - the mechanics behind the rules

`SKILL.md` states the rules: signals as the state primitive, `OnPush` on every component, zoneless where the installed version and every framework layer allow it, no decorator queries or host bindings, no animations DSL. This file holds the worked detail those rules point at.

## The computed-reads-a-plain-field bug
Any state a `computed` or an `effect` reads must itself be a `signal`. A plain class property that feeds a derived value is the reactivity bug to hunt: the `computed` reads it once at creation and never recomputes when the property later changes, so a filter/derived view silently stops updating until some unrelated change happens to trigger change detection. If a `computed` depends on it, it is a `signal` - no exceptions; a filter field, a selected id, a search term that narrows a list all qualify.

```ts
// BUG - plain field: the computed never recomputes when filter changes
filter = '';
readonly visible = computed(() => this.items().filter((i) => i.name.includes(this.filter)));

// FIX - anything a computed reads is itself a signal
readonly filter = signal('');
readonly visible = computed(() => this.items().filter((i) => i.name.includes(this.filter())));
```

## `linkedSignal` and the resource family (v19+)
- `linkedSignal` (v19+) is writable state derived from a source that should reset when the source moves. Use its `source` and `computation` object form when a user's selection must survive a source change as long as it stays valid.
- `resource` and `rxResource` (v19+) lift async work into signals: give them a `params` signal and a `loader` that respects its `abortSignal`, then read `value()`, `hasValue()`, and `status()` instead of hand-managing loading and error booleans.
- `status()` is one of `'idle'`, `'loading'`, `'reloading'`, `'resolved'`, `'error'`, `'local'` (v19 spells them as `ResourceStatus` enum members, `ResourceStatus.Loading`). `'loading'` means the params moved and `value()` is `undefined`; `'reloading'` follows `reload()` and KEEPS the previous `value()`; `'local'` means a `.set()` / `.update()` replaced the loader's value. A spinner keyed on `status() === 'loading'` misses every reload - read `isLoading()`, true in both.
The server-state rules - which primitive, when a query library replaces them, invalidation - are in `state-tiers.md`.

## DOM work after render: `afterRenderEffect` (v19+)
Signal-driven code that must measure or touch the rendered DOM goes in `afterRenderEffect`, split by phase. The phases run in a fixed order - `earlyRead` -> `write` -> `mixedReadWrite` -> `read` - and each keeps to its job: never write the DOM in `earlyRead` or `read`, never read it in `write`, because interleaved reads and writes are the layout thrash the phases exist to prevent. Each phase receives the previous phase's return value as a signal, so a measurement taken in `earlyRead` reaches `write` without a class field. `mixedReadWrite` is the last resort for work that cannot be split. It runs on the browser only, never during a server render, and a component is not guaranteed to be hydrated when it fires.

## Queries and host bindings without decorators
Finish the move off decorators for queries and host bindings too: `viewChild()` and `contentChild()` (add `.required` when the target is guaranteed present) replace `@ViewChild` and `@ContentChild`, and the `host` metadata object replaces `@HostBinding` and `@HostListener`. The returned signals compose with `computed` and `effect`, which is why the decorator forms are banned in new code.

## Going zoneless
OnPush is the stepping stone to zoneless, not the destination. Where the installed version ships stable zoneless change detection (stable from v20.2, the default for new apps from v21) AND every framework layer in the app supports it (a layer that still requires `zone.js` keeps it - that framework's skill owns the call), drop `zone.js` from the polyfills and bootstrap with `provideZonelessChangeDetection()` alongside `provideBrowserGlobalErrorListeners()`. Without a zone, `setTimeout`, `setInterval`, and bare promise callbacks no longer trigger a render - every update must flow through a signal or `AsyncPipe`, which an all-OnPush, signal-driven codebase already satisfies. Turn it on in development first to flush out any code that silently leaned on the zone.

## Animations without the DSL
The replacement for the `@angular/animations` DSL is now concrete, not just in flux: the package is deprecated and Angular ships native `animate.enter` / `animate.leave` template bindings alongside plain CSS transitions. Prefer those in new code and plan existing DSL animations off it. For route transitions use the View Transitions API through `withViewTransitions()` - except inside an Ionic `IonRouterOutlet`, whose own stack transitions it fights (page transitions there belong to the Ionic/Capacitor skill, where the install has one).
