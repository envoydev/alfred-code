---
name: angular-styling
description: "Load when writing or editing CSS or SCSS in an Angular workspace. Angular CSS and styling conventions for any Angular app, Material or not - component-scoped styles and the ViewEncapsulation choice, :host and :host-context, ::ng-deep discouraged and the sanctioned ways out, design tokens as CSS custom properties, mobile-first responsive with container queries and fluid type, where global vs component styles belong, utility-first vs scoped SCSS, and accessibility-affecting styling (focus-visible, prefers-reduced-motion, contrast). Also styling ion-* shadow-DOM components in an Ionic app. Targets Angular 17+. Do NOT load for React, Vue, Svelte or plain non-Angular CSS, or for Material component theme-token work (the Angular Material skill)."
---

# Angular styling

The general CSS layer for an Angular app, Material or not: how stylesheets are scoped, where they live, and which modern CSS to reach for. The framework itself is `angular-conventions` - load it alongside. Material specifics (`mat.theme`, `--mat-sys-*`, density) belong to the skill covering the Angular Material library; with none installed, treat Material internals as third-party and use the global-rule fallback below. This file is opinion: check a CSS feature's browser support on MDN or web.dev, never from memory. **Above these general conventions, a project's own config (its stylelint/Prettier setup, `.editorconfig`) and its `<docs-path>/code-style/CODE-STYLE.md` are higher priority: where a project diverges, follow the project.** Floor Angular 17+.

**Each rule below is one line; `references/styling-in-full.md` carries it with its reason and example - read it before overriding a child's styles, adding tokens or a theme, or a responsive layout.**

## Scoping
- Keep `ViewEncapsulation.Emulated`, the default - never change it to reach into something; read `references/encapsulation-modes.md` before touching `encapsulation`, and never lean on it as a specificity weapon.
- `:host` for the host element's own styles (`:host(.is-active)` to react to a host class); `:host-context(selector)` to theme off an ancestor class (not under `ShadowDom`) - a custom-property contract when the variation is a value.
- Never `::ng-deep`, `/deep/` or `>>>` in new code. The ways out, in order: a CSS custom property the child reads and the parent sets; a global rule on a stable, documented class of the child; `ViewEncapsulation.None` on a small leaf whose job is global styles.
- `ion-*` components are real shadow DOM: a global rule inside one silently does nothing - style them only through their CSS custom properties (`--background`, the `--ion-*` theme variables) and `::part()`; dark mode there is the Ionic palette class, owned by the Ionic/Capacitor skill.

## Tokens, responsiveness, placement
- The app's own design tokens are CSS custom properties on `:root` (spacing, radii, semantic colors, z-index, font stacks); Sass variables only for build-time constants. A theme variant re-binds the same names under `[data-theme="dark"]` / `.dark` / prefers-color-scheme - never a forked stylesheet or a new name.
- Mobile-first with min-width queries; container queries (`container-type: inline-size`, `@container`) for component-level responsiveness; fluid type with `clamp()` over `rem`; `:has()` to style a parent from a descendant's state.
- The global sheet holds only resets, the `:root` tokens, base typography, font-faces and broad utilities, ordered with cascade layers (`@layer reset, base, tokens, utilities, components`); everything local lives in the component's scoped stylesheet. Never `!important` to win a fight a layer or a token should settle.
- Scoped component SCSS plus tokens is the house default; utility-first (Tailwind) only on an explicit opt-in, never mixed ad hoc (`references/tailwind.md`).

## Accessibility-affecting styling
- Focus always visible - `:focus-visible` with contrast, never a bare `outline: none`.
- Non-essential motion (View Transitions included) reduced under `@media (prefers-reduced-motion: reduce)`.
- Text contrast WCAG AA (4.5:1, 3:1 large), non-text UI 3:1; never state by color alone.
- Prove it: quote the computed contrast ratio of the pair you changed and the stylelint exit line. The rest of WCAG 2.2 AA (target size, focus not hidden, no trap) is `references/accessibility.md` - read it before a new screen, a sticky bar, an overlay or a dense toolbar.
