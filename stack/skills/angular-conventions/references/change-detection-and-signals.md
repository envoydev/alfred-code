# Change detection and signals - the mechanics behind the rules

`SKILL.md` states the rules: signals as the state primitive, `OnPush` on every component, zoneless where the installed version and every framework layer allow it, no decorator queries or host bindings, no animations DSL. This file holds the worked detail those rules point at.

## The computed-reads-a-plain-field bug
The rule is `SKILL.md`'s (Signals are the default state primitive). The bug and its fix side by side - the view stays stale until some unrelated change happens to trigger change detection:

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
When to drop `zone.js` is `SKILL.md`'s (Change detection is always OnPush). The order: turn zoneless on in development first, so code that silently leaned on the zone surfaces - without a zone, `setTimeout`, `setInterval` and bare promise callbacks no longer trigger a render - then remove `zone.js` from the polyfills.

## Animations without the DSL
The rule is `SKILL.md`'s (Templates carry no logic). The binding detail: `animate.enter` / `animate.leave` take a class string (space-separated classes) or an array of them. Angular removes the enter classes when the animation completes, and removes a leaving element only after its longest animation or transition ends. The event-binding form (`(animate.leave)="onLeave($event)"`) runs a function instead, and on leave that function must call `event.animationComplete()` - otherwise the element lingers until Angular's timeout removes it.
