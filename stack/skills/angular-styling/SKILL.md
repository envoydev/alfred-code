---
name: angular-styling
description: "Load when writing or editing CSS or SCSS in an Angular workspace. Angular CSS and styling conventions for any Angular app, Material or not - component-scoped styles and the ViewEncapsulation choice, :host and :host-context, ::ng-deep discouraged and the sanctioned ways out, design tokens as CSS custom properties, mobile-first responsive with container queries and fluid type, where global vs component styles belong, utility-first vs scoped SCSS, and accessibility-affecting styling (focus-visible, prefers-reduced-motion, contrast). Also styling ion-* shadow-DOM components in an Ionic app. Targets Angular 17+. Do NOT load for React, Vue, Svelte or plain non-Angular CSS, or for Material component theme-token work (the Angular Material skill)."
---

# Angular styling

This is the general CSS layer for an Angular app - the rules for how stylesheets are scoped, where they live, and which modern CSS to reach for. It holds whether or not the app uses Material. The framework itself (signals, change detection, templates, `NgOptimizedImage`, the `@angular/animations` stance) is `angular-conventions`; load it alongside. Anything Material-specific - the `mat.theme` API, the `--mat-sys-*` system tokens, density, and styling Material components - belongs to the skill covering the Angular Material component library and is not restated here; with none installed, treat Material internals as third-party and use the global-rule fallback in the `::ng-deep` section below. This file is opinion, not reference: it states the choices the team has settled on. For any CSS feature's exact browser support, check MDN or web.dev rather than memory. **Above these general conventions, a project's own config (its stylelint/Prettier setup, `.editorconfig`) and its `<docs-path>/code-style/CODE-STYLE.md` are higher priority: where a project diverges, follow the project.**

Floor is Angular 17+. Reach forward to newer idioms but adopt only what the installed version ships, and flag a forward API with a version tag.

## Component styles are scoped by default - keep them that way

A component's `styles` or `styleUrls` are scoped to that component by `ViewEncapsulation.Emulated`, the default. Angular stamps a unique attribute (`_ngcontent-*`) onto the component's host and template elements and rewrites every selector in the stylesheet to match it, so the rules cannot leak out and repaint a sibling. This is the right default; do not change it to reach into something. The encapsulation only stops styles leaking *out* - global styles defined in `styles.css` still flow *in* and match elements inside an emulated component, which is exactly how a theme reaches the whole tree.

The other modes - `None` (every selector goes global), `ShadowDom` (real isolation, but a global theme stops at the boundary), and v21's experimental isolated variant - each trade that model away; the mode-by-mode comparison is `references/encapsulation-modes.md` - read it before changing `encapsulation` on any component. And do not lean on encapsulation as a specificity weapon: Angular itself does not 100% guarantee a component's styles win over outside styles even in `Emulated` or `ShadowDom`.

## :host and :host-context

- `:host` styles the component's own host element from inside its stylesheet - the one selector that legitimately targets the element the component is mounted on. Use `:host(.is-active)` to react to a class on the host, and set host-level layout (`display`, `padding`) here rather than wrapping the template in an extra div.
- `:host-context(selector)` matches when any ancestor up the tree matches `selector` - the clean way to theme a component off a `.dark` or `.rtl` class set high in the document, without a global override. It works under `Emulated` (the compiler emulates it) but not under `ShadowDom`. Prefer a CSS custom property contract over `:host-context` when the variation is a value rather than a structural switch.

## ::ng-deep is discouraged - the three sanctioned ways out

Angular's docs state the team **strongly discourages new use of `::ng-deep`**; it survives only for backwards compatibility and is slated to go. It pierces encapsulation to style a child's internals, and that override shatters the moment the child's markup changes. Never reach for it - or its dead aliases `/deep/` and `>>>` - in new code. When you genuinely must style something outside your component's scope, pick one of these instead, in order of preference:

1. **A CSS custom property as a theming contract.** The child exposes a variable (`--card-padding`, `--badge-color`) and reads it internally; the parent sets it. Custom properties pierce encapsulation by design and cross shadow boundaries, so this is the only override that survives a child refactor. This is the default answer.

```scss
/* child stylesheet - reads the contract, with a fallback */
:host { padding: var(--card-padding, 1rem); }

/* parent stylesheet - sets it; no piercing needed */
app-order-card { --card-padding: 0.5rem; }
```
2. **A global stylesheet rule** in `styles.css` (or a layered global file) targeting a stable, documented class on the child. Global styles legitimately flow into emulated components - no piercing needed. Keep the selector specific so it does not over-reach.
3. **`ViewEncapsulation.None` on a small leaf** whose entire job is to emit global styles (a typography or print stylesheet host). Its selectors go global, so scope them under a single root class to avoid collisions. Use this last and only for a component that is meant to be global.

If a third-party component gives you none of these, a global rule scoped under a wrapper class is the honest fallback - not `::ng-deep`.

## Ionic surfaces are real shadow DOM - the ways out change

`ion-*` components are web components with genuine shadow DOM, not Angular's emulated encapsulation, so on them the model above inverts:

- Way out #2 - a global rule targeting a class inside the component - **silently does nothing**: real shadow DOM blocks inbound global styles, and nothing errors. Style an Ionic component only through what it publishes: its CSS custom properties (per-component ones like `--background`, and the `--ion-*` theme variables) and its `::part()` selectors - both cross the shadow boundary by design. Which parts and variables a component exposes is its Ionic docs page; fetch it live rather than guessing.
- Keep the app's own token system for your own components, but know that `ion-*` components read only Ionic's variables - route theme values into `--ion-*` tokens or they never reach the UI kit. Dark mode on Ionic surfaces is the Ionic dark palette and its ion-palette-dark class strategy, owned by the skill covering the Ionic/Capacitor layer - not a hand-rolled `[data-theme]` re-bind, and with no such skill installed use the Ionic palette class rather than inventing a parallel theme.

## Design tokens as CSS custom properties

**Defining a token.** Beyond Material's `--mat-sys-*` tokens (owned by the skill covering the Angular Material component library), define the app's own design tokens as CSS custom properties on `:root` - spacing scale, radii, semantic colors, z-index layers, font stacks. Reference them everywhere (`gap: var(--space-3)`) so a value changes in one place and tokens cross every encapsulation boundary for free. Use Sass variables only for build-time constants that never vary at runtime (a breakpoint map consumed by a mixin); anything a theme can change at runtime is a CSS custom property, not a Sass `$variable`.

**Theming a token.** Light/dark and brand variants are a second token block under a `[data-theme="dark"]` or `.dark` selector, or driven by the prefers-color-scheme media feature, re-binding the same names - never a forked stylesheet. A variant that adds a new name instead of re-binding an existing one is the fork arriving by another route.

## Responsive strategy: mobile-first, container queries, fluid type

- Write **mobile-first**: base rules target the small viewport, min-width media queries layer on larger-screen overrides. Never start desktop and claw back down with max-width.
- Reach for **container queries** when a component must adapt to the space it is dropped into rather than the viewport - a card that goes two-column inside a wide sidebar but one-column in a narrow one. Declare `container-type: inline-size` on the wrapper and size children with `@container`. This is the modern default for component-level responsiveness; viewport media queries are for page-level layout. Container queries are broadly supported now, but confirm the floor against the project's browser targets.
- Use **fluid type and spacing** with `clamp(min, preferred, max)` so a heading scales smoothly between breakpoints instead of snapping. Pair `clamp()` with relative units (`rem`) so it respects the user's root font size.
- Reach for the **`:has()`** relational selector to style a parent from a descendant's state (a field group that flags when it contains an invalid input). It is widely supported; check the target floor before relying on it.

## Global vs component styles - where each belongs

- `styles.css` / `styles.scss` (the global entry) holds exactly: CSS resets and normalize, the `:root` token block, base element typography, font-face declarations, and broad utilities. It is the only place a global selector belongs.
- Everything visual and local to a component lives in that component's own scoped stylesheet, beside the class. Do not push a component's look into the global sheet to dodge specificity - that is how a global stylesheet rots into an unmaintainable override pile.
- Use **cascade layers** (`@layer reset, base, tokens, utilities, components`) in the global sheet to make precedence explicit and stop a specificity arms race - a later layer always wins regardless of selector specificity. Layers are widely supported; this is the recommended way to order global concerns. Never `!important` to win a fight encapsulation or a cascade layer should have settled - fix the layer order or the token instead.

## Utility-first vs scoped SCSS - the house decision

The house default is **scoped component SCSS plus the CSS-custom-property token system above** - it keeps the look beside the component, leans on Angular's encapsulation, and avoids markup cluttered with dozens of classes. Adopt utility-first (Tailwind) only when a team explicitly opts in for a design-system-driven app where consistency-by-constraint outweighs the template noise; do not mix both ad hoc. For a project that did opt in, the Angular-official install path and how utilities coexist with emulated component styles are `references/tailwind.md`.

## Accessibility-affecting styling

- **Focus must always be visible.** Never blanket `outline: none`. Style focus with `:focus-visible` so a visible ring shows for keyboard users without flashing on every mouse click, and make it meet contrast against its background. If you remove the default outline, replace it in the same rule.
- **Respect the prefers-reduced-motion media feature.** Wrap non-essential transitions and animations so they are reduced or removed under `@media (prefers-reduced-motion: reduce)`. This includes route View Transitions (`withViewTransitions()`, from `angular-conventions`): disable or soften the `::view-transition-*` animations under the query rather than shipping motion to users who opted out.
- **Meet contrast.** Text clears WCAG AA - 4.5:1 normal, 3:1 large; do not encode a foreground/background pair that fails it. Non-text UI (focus rings, control borders) needs 3:1.
- **Do not convey state by color alone** in CSS - pair a color change with an icon, weight, underline, or text so it survives color-blindness and forced-colors mode.
- **Prove it, do not eyeball it.** Read the computed contrast ratio of the foreground/background pair you changed and quote it against the 4.5:1 / 3:1 bar. Then run the workspace's stylelint and quote its exit line. A CSS change with no measured ratio and no lint result is unverified, however careful the diff looks.
- **The rest of WCAG 2.2 AA** - 24px pointer targets, focus never hidden under a sticky bar, no keyboard trap, no redundant entry, drag alternatives - is `references/accessibility.md`, numbered by criterion. Load it before shipping a new screen, a sticky header or footer, an overlay, or a dense toolbar.
