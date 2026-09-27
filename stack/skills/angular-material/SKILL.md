---
name: angular-material
description: "Load when building UI with @angular/material or @angular/cdk - importing component modules, theming with mat.theme or the --mat-sys-* tokens, dark mode or density, restyling one Material component, reaching for a CDK primitive (virtual scroll, overlay, drag and drop, focus trap), or writing harness tests. Angular Material and CDK conventions for @angular/material 17+ - the library specifically, not generic Material Design 3 or @material/web. Not for general Angular CSS such as :host or ::ng-deep (the Angular styling skill), and skip for PrimeNG, Spartan UI, Ionic, or apps not using Angular Material."
---

# Angular Material and CDK

This is the component-library layer: `@angular/material` (the Material 3 components) sitting on top of `@angular/cdk` (the unstyled behavior primitives). The framework itself - signals, change detection, standalone components, the testing setup - is the Angular conventions skill's and the language the TypeScript one's; load both alongside this where the install has them, and without them treat this file as Material-only and say so. The general CSS/styling layer that holds Material or not - `ViewEncapsulation`, `:host`, the `::ng-deep` ways out, the app's own design tokens, responsive strategy - is `angular-styling`; this skill owns only the Material-specific `mat.theme` and `--mat-sys-*` token work.

Floor is `@angular/material` 17+ - standalone components are the default there. The single-mixin M3 theming API this skill teaches (`mat.theme`, the `--mat-sys-*` system tokens, the `mat.<component>-overrides` mixins) needs v19+; on v17-v18 read `references/versions.md` first. The post-v19 deltas that bite - the v20 `matButton` and raw-token renames, the v21 FocusTrap break, Angular Aria, Popover-based overlays - live in `references/versions.md`; check it when the workspace is past v19.

## Import what you use, nothing more

Each Material component ships as its own NgModule. Import them directly into the standalone component that renders them:

```ts
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  // ...
})
export class ToolbarComponent {}
```

Do not create a shared module that re-exports every Material module and import that everywhere. The barrel is the single most common Angular Material mistake: it pulls dozens of components the component never touches into the dependency graph, defeats tree-shaking, and inflates the bundle. One import line per component the template actually uses - the cost of being explicit is a few lines; the payoff is a lean build.

## Theme through the M3 API, never hand-edited internals

Define the theme once in Sass with `mat.theme`, driving color, typography, and density from the system input map:

```scss
@use '@angular/material' as mat;

html {
  color-scheme: light dark; // mat.theme emits light-dark() values; this follows the OS setting
  @include mat.theme((
    color: (
      primary: mat.$azure-palette,
      tertiary: mat.$blue-palette,
    ),
    typography: Roboto,
    density: 0,
  ));
}
```

`mat.theme` emits CSS custom properties (the `--mat-sys-*` system tokens). Read those tokens when a component needs a themed color - `color: var(--mat-sys-primary)` - so the value tracks the active theme automatically.

Two rules hold the theming together:

- Never reach into a component's internal DOM with a `.mat-*` selector to repaint it (`.mat-mdc-button { background: #1976d2; }`). Those class names are private implementation detail. The override breaks the moment dark mode, a density change, or a Material version bump moves the markup, and it silently ignores the theme system. Style through the system tokens or the component's documented theming mixins instead.
- Keep exactly one theme definition and switch modes with the CSS color-scheme property, never a second theme. `mat.theme` emits its color tokens as `light-dark()` pairs, so `color-scheme: light dark` on `html` follows the OS preference and `color-scheme: dark` under a `.dark` class serves a user toggle - with no color-scheme set, the light values always win. Do not re-emit the theme or fork the stylesheet per mode.

Density and typography are part of the same call, not separate hacks - set `density: -2` for a compact table view rather than overriding heights component by component.

When the system tokens are not enough and one component needs a specific change, use its overrides mixin - `mat.<component>-overrides` (`mat.button-overrides`, `mat.card-overrides`, ...) - inside the selector you want it scoped to. This is the sanctioned, upgrade-safe form of 'documented theming mixins': it writes the component's own tokens, so it survives a version bump where a `.mat-mdc-*` selector would shatter.

```scss
.checkout-cta {
  @include mat.button-overrides((
    container-color: var(--mat-sys-tertiary),
    label-text-color: var(--mat-sys-on-tertiary),
  ));
}
```

Bind the overrides mixin or a `--mat-sys-*` system token - never a raw per-component custom property by hand. (v20 renamed those raw properties; the rename and its migration schematic are in `references/versions.md`.)

Prove a theming change instead of eyeballing it: build the app (`ng build`, or the workspace's own build script) and confirm the Sass compiles with no unknown-mixin or undefined-variable error, then read the themed element's computed `--mat-sys-*` value in the browser and quote both results. A theme that compiles but resolves the wrong token is the failure this section exists to prevent.

## Reach for CDK primitives before hand-rolling

The CDK packages the behaviors that are deceptively hard to get right - the edge cases, keyboard handling, and accessibility you would otherwise reimplement and ship with bugs. Prefer the primitive over a bespoke version every time:

- Long lists: `CdkVirtualScrollViewport` with `*cdkVirtualFor` recycles DOM nodes so a 10,000-row list renders a screenful. No manual scroll math, no windowing library.
- Floating UI: the `Overlay` service positions menus, tooltips, popovers, and custom dropdowns against a connected element, handling viewport flipping and scroll repositioning. This is also what Material's own menu and select build on.
- Drag and drop: `cdkDrag` and `cdkDropList` give reorderable lists and cross-container transfers with the pointer and keyboard handling already done.
- Clipboard: `cdkCopyToClipboard` copies a string on click without touching the Clipboard API directly.
- Accessibility: `FocusTrap` (`cdkTrapFocus`) keeps keyboard focus inside a dialog or panel, and `LiveAnnouncer` pushes polite messages to screen readers for state changes the user cannot see. Use `FocusKeyManager` / `ListKeyManager` for arrow-key navigation inside a custom listbox or menu. Prefer the `cdkTrapFocus` directive over programmatic construction - v21 broke the programmatic constructors (see `references/versions.md`).

A hand-written overlay, virtual scroller, or focus trap is almost always missing a case the CDK already handles - that is the reason to default to the primitive.

## Test through harnesses, not DOM internals

Drive every Material component in tests through its component test harness, loaded via a `HarnessLoader`:

```ts
const loader = TestbedHarnessEnvironment.loader(fixture);
const select = await loader.getHarness(MatSelectHarness);
await select.open();
await select.clickOptions({ text: 'Berlin' });
expect(await select.getValueText()).toBe('Berlin');
```

Harnesses (`MatSelectHarness`, `MatInputHarness`, `MatButtonHarness`, ...) are maintained by the Angular team and expose a stable, intent-level API - open the select, click the option, read the value - independent of the internal markup. Query the harness; never assert against `.mat-mdc-*` classes or the component's private DOM, because those tests shatter on the next Material release. The broader testing discipline (TestBed setup, fixtures, async handling) lives in `angular-testing`; this is only the Material-specific harness rule.

