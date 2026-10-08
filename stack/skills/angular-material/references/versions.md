# Angular Material / CDK version deltas (v20-v22)

`SKILL.md` floors at v17 and its theming section needs v19+; these are the version deltas that bite. Adopt each only where the installed version ships it.

- **Before v19:** the single-mixin `mat.theme` API does not exist. v17-v18 use the experimental `mat.define-theme` predecessor, so the theming section of `SKILL.md` does not apply as written - upgrade to v19+ before following it, or theme through `mat.define-theme` and say plainly that the house theming rules were not applied.

- **Button directives (v20):** the `mat-button` family is now the `matButton` attribute - bare `matButton` for text, plus `matButton="elevated" | "filled" | "outlined" | "tonal"` (the M3 `tonal` variant sits between filled and outlined). `matIconButton` gains `filled` / `tonal` too, and cards take `appearance="filled"`. Update the old `mat-raised-button` / `mat-flat-button` / `mat-stroked-button` selectors when you touch them - they are deprecated, not deleted.
- **Raw token rename (v20):** the per-component custom properties dropped the old `--mdc-*` prefix for `--mat-*` (e.g. `--mdc-outlined-card-container-shape` became `--mat-card-outlined-container-shape`). Run `ng generate @angular/material:token-rename` on upgrade - and keep binding the overrides mixin or a `--mat-sys-*` system token, never these raw properties by hand (SKILL.md's rule).
- **Reduced motion (v20):** Material honors the prefers-reduced-motion media query on its own animations - do not hand-gate motion you got from a component.
- **FocusTrap (v21, breaking):** the injector parameter became required on the `FocusTrap` / `ConfigurableFocusTrap` constructors, and `ConfigurableFocusTrapFactory.create`'s boolean argument became a config object. The `cdkTrapFocus` directive is unaffected - prefer it.
- **Angular Aria vs the CDK:** `@angular/aria` is a headless, unstyled a11y primitive set that overlaps parts of the CDK. Reach for it when you need unstyled primitives to build your own component; keep the styled Material / CDK components as the default for standard UI.
- **CDK overlays (v21):** the `Overlay` service now builds on the browser-native Popover API with per-side viewport margins; the service API you call is unchanged.
