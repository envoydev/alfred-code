# HTTP, routing, and forms

The HTTP, routing and form rules `SKILL.md` points here for - read before adding an HTTP call or interceptor, a route or resolver, or a form.

- Keep endpoint URLs in one config service or environment file, never scattered as string literals.
- Cross-cutting HTTP concerns - auth headers, retry, error normalization - live in functional interceptors registered with `withInterceptors`, not in each call site.
- Typed reactive forms (`FormGroup<T>`) are the default; on v22+ prefer Signal Forms for new forms (`form()` from `@angular/forms/signals`, stable there - experimental on v21, so version-tag any use). Template-driven forms are only for trivial throwaway inputs, and no field is ever typed or defaulted as `null`.
- Lazy-load feature routes with `loadComponent` for standalone targets, falling back to `loadChildren` only where legacy modules remain.
- Bind route params and `data` straight into component `input()`s with `withComponentInputBinding()` instead of injecting `ActivatedRoute` and reading snapshots.
- Resolve a route's critical data ahead of activation with a thin `resolve` guard that delegates to a service, so the component renders without a request waterfall. Not in an Ionic app: cached pages never re-activate on revisit, so a resolver never re-runs and ships stale data - refresh on `ionViewWillEnter` there - ground the skill covering the Ionic/Capacitor layer owns, and with none installed this rule is the whole guidance.
- Validation is a layer, not a pile of one-off checks: rules declared on the model, reusable pure `ValidatorFn`s, cross-field rules on the group, async validators that debounce and cancel, ONE shared error surface - never a per-template error wall. The full strategy (Signal Forms, its API pitfalls and Standard Schema included) is `forms-validation.md`; load it before building any non-trivial form.
