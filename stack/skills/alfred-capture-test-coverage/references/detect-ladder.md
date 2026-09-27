# DETECT - the coverage tooling per surface

Read at step 2, before the first coverage command: find what the project already uses - never pick or install one.

- **.NET** - coverlet via `dotnet test --collect:"XPlat Code Coverage"` (or the msbuild `/p:CollectCoverage=true` form the repo already wires) -> cobertura XML.
- **Angular** - `ng test` with the coverage flag of the builder `angular.json` names (`--coverage` under `@angular/build:unit-test`, the Vitest default for new workspaces; `--code-coverage` under the older Karma builder - confirm an unfamiliar builder's flag via the documentation server, never from recall) -> the `coverage/` output (lcov + summary).
- **Plain JS/TS** - the ladder: a `package.json` test script -> a runner config file -> a test runner in devDependencies; use the first rung that answers, with its coverage flag.
- **Any other stack** - the project's own test script or runner config, with the coverage flag that runner documents (confirm it via the documentation server, never from recall).
