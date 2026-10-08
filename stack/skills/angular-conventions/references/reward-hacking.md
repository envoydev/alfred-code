# Reward-hacking shortcuts to reject

The Angular-specific shortcut table the skill body cites. Reject each in review, whoever wrote it; the language-level bans (`any`, `@ts-ignore`, non-null `!`) are the TypeScript conventions skill's.

| Shortcut | Instead |
|---|---|
| `xit`/`xdescribe`, an `fdescribe` that narrows the run, or deleting a failing spec | fix the defect the spec caught; delete only a genuinely obsolete spec, with the reason stated |
| Weakened assertion, or a spec rewritten to assert less than the behavior | fix the code, keep the bar (SKILL.md's Testing section) |
| Disabling an ESLint rule, loosening `strictTemplates`/`fullTemplateTypeCheck`, or `"aot": false` to clear an error | fix the type or template the compiler is pointing at |
| `$any()` or `CUSTOM_ELEMENTS_SCHEMA`/`NO_ERRORS_SCHEMA` to mute a template error | import the declarable, fix the binding type |
| Raising an `angular.json` budget or padding `allowedCommonJsDependencies` to clear a threshold | shrink the bundle honestly - defer, lazy-load, drop the dependency (`performance-budgets.md`) |
| Package downgrade to dodge a peer conflict | resolve the conflict at the current version |
| Real time, real HTTP, or `tick(99999)` to mask flaky async | fix the async handling - honest fake time for the runner (`fakeAsync` + `tick` under Karma/Jest, `vi.useFakeTimers()` under Vitest), the HTTP testing controller |
