# Upgrade Playbooks - stack sequencing + the runtime-break catalog

## .NET sequencing (foundation-first)

`global.json` SDK pin, then `<TargetFramework>` across EVERY project (sweep for stragglers and multi-target `<TargetFrameworks>`; a mixed-TFM solution is its own bug class), then `Microsoft.Extensions.*` and the EF Core provider in lockstep to the runtime's major line (a lagging package is a runtime MissingMethodException/assembly-load failure no compiler catches; under Central Package Management that is one edit in `Directory.Packages.props`), then the code edits. Load the skills covering EF schema migrations and the .NET solution build spine, when your skill list has them, for the safe upgrade-and-rollback workflow (a trimmed install carries neither - then the workflow below IS the playbook). .NET Upgrade Assistant / try-convert own the auto-applied half - plan the hand edits, not what the engine does.

## Angular sequencing

Angular does not support skipping majors - a v15->v18 plan steps v15->16->17->18 with `ng update @angular/core @angular/cli` at each step. The peer matrix (`@angular/cli` + `core` + `@angular/material` + `zone.js` + `typescript` + `rxjs` and the Node engine) is a precondition - a version outside a major's supported range fails at install before any code runs. Load the Angular conventions skill, when your skill list has them, for the house conventions the upgraded code must land in. Version-bound migrations run inside `ng update`; the opt-in ones - control flow, standalone, and whatever else the current Angular migrations reference lists (fetch that roster at PLAN time - the library-docs MCP where the project kept it, the vendor's page otherwise - never from recall) - run as `ng generate @angular/core:<migration>` after the bump. A deprecation no schematic covers (a removed RxJS operator, a retired module API) is a planned hand edit; a hand edit of something a schematic covers is a finding against the plan. Load the Angular conventions skill for the resulting code, whichever of them your skill list has; do not reach for the .NET playbook on an Angular bump.

## Package majors (either stack)

Same workflow, narrower surface: the package's own changelog/migration guide is the breaking surface (fetched through the library-docs MCP where the project kept it, the vendor's page otherwise); cross it against located usage; a transitive-peer conflict discovered at install time is a sequencing input, not a surprise to push through.

## The runtime-break catalog - what to hunt beyond the compiler

Runtime-not-compile-time is the whole game: the break that fails the build is the easy half. Hunt the behavioral breaks that compile clean and fail in production:

- A changed System.Text.Json default (camelCase, enum-as-string).
- A tightened nullable-reference annotation surfacing null it used to hide.
- A shifted IConfiguration/options binding.
- An EF Core query flipping from server- to client-evaluation, or now throwing.
- A changed HttpClient/SocketsHttpHandler default.
- An untriaged deprecation - today's `[Obsolete]`/deprecation warning is tomorrow's compile error; a plan that leaves the warning set unmapped schedules the break.
- Package lag on .NET - a `Microsoft.Extensions.*` or EF Core provider below the runtime's major line is a load-time failure the compiler never sees.

An upgrade enumerated only from compile errors ships these to production - the plan names the runtime checks per stage, and VERIFY runs them.
