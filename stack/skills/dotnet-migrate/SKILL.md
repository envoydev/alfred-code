---
name: dotnet-migrate
description: "Use when running an EF Core migration, raising a target framework or SDK, or updating NuGet packages - migrate, upgrade, update packages. Safe playbook: preview the SQL, confirm the first apply, keep a rollback, one change per step. A breaking framework major goes to the version-upgrade flow. Not for adding a new package or laying out a solution - that is the .NET solution and package setup skill."
---

# Safe migration workflow (.NET)

Migrations are where a working codebase quietly acquires risk: a column drop that loses data, a framework bump that breaks at runtime not compile time, a transitive package that shifts behavior under you. The defense is the same four rules in every flow below.

- **Preview before you apply.** Read the generated SQL, the breaking-change list, the changelog - never run a step blind.
- **Carry a rollback.** Know the exact command or commit that undoes the step *before* you take it.
- **Re-verify after every step.** Build and run the tests; a green pre-flight that you never re-check proves nothing.
- **One logical change per step.** A migration, an upgrade, a bump - keep them atomic so a break bisects cleanly.

Assess blast radius with the navigation server (`find_symbol`, `find_referencing_symbols`) or the LSP. Do not `Read` whole files hunting for who touches a type - that is exactly the work the symbol tools do faster.

## Flow A - EF Core schema migration

1. **See where you are.** `dotnet ef migrations list` shows what is applied versus pending. Use the navigation server to find the entities you are about to change and everything that references them.
2. **Generate one named migration.** `dotnet ef migrations add <Name>` - name it Verb-then-subject so the history reads as a log: `AddOrderShippedAt`, `MakeEmailUnique`, `DropLegacyStatus`. The one-change-per-migration discipline itself belongs to the skill covering database-schema conventions (naming, keys, indexes, change granularity); this step is just the EF naming and generation mechanics, which stand on their own with nothing else installed.
3. **Preview the SQL.** `dotnet ef migrations script --idempotent` (or `--idempotent <from> <to>` for a range). Read it for the dangerous shapes: dropped or renamed columns, a non-nullable add with no default, a type narrowing that truncates, an index or constraint added to a large table under a lock. The `--idempotent` flag guards each step with an `__EFMigrationsHistory` check so the script is safe to run against a database at any applied state, and re-running it is a no-op (provider-dependent - the SQLite provider has no idempotent scripts, so preview a plain `script <from> <to>` there). EF cannot see your data - you have to.
4. **Stage destructive change in two deploys.** Anything that can lose data or that the old code still depends on is expand-then-contract: first add the new column and backfill (the old code keeps working), ship, then in a later migration drop the old column once nothing reads it. Never collapse both halves into one migration against a live database. A wide backfill is a data migration, not a schema one - run it in batches outside the `ALTER`, never as a single `UPDATE` under a table lock.
5. **Gate the first apply - ask, do not assume.** Applying writes to a live schema and no `remove` undoes lost data, so once the step-3 script has been read the decision is the user's. Put it through ONE AskUserQuestion with three concrete options: **script it out** with `dotnet ef migrations script --idempotent` and hand the SQL to whoever owns the database (recommended - it is the only reviewable, re-runnable form), **apply to the target database now** (name which database in the option text), or **stop here**. Until that answer comes back, run no `dotnet ef database update`, no migrations-bundle executable, and no `Database.Migrate()`. A prose 'shall I apply?' does not satisfy this step, and an approval given for one database never carries to another.
6. **Apply and verify.** In dev, `dotnet ef database update`, then build and run the tests. Past a local box, apply through a migrations bundle run as a gated deploy step - never from a developer machine, never `Database.Migrate()` on app start under load; `references/ef-apply-and-undo.md` has the bundle recipe.
7. **Know the undo.** Roll back with `dotnet ef database update <PreviousMigration>`, then `dotnet ef migrations remove` - never delete migration files by hand, never hand-edit an applied migration. A migration that reached any shared database rolls back as a NEW forward migration, and removing it asks the user first through AskUserQuestion. Read `references/ef-apply-and-undo.md` before any rollback. Query, tracking, and configuration mechanics belong to the skill covering the ORM layer; with nothing installed for that, keep the change to schema and leave query shape alone.

## Flow B - target framework / SDK upgrade

A breaking major the user wants planned and gated stage by stage - a framework or runtime major, an EOL, a load-bearing package's breaking major - is the deliberate version-upgrade flow, which only the user starts, with `/alfred-task-version-upgrade`: name that command to them. The steps below are the per-stage mechanics either way.

1. **Start clean.** Green tests and zero pending migrations before you touch a version - you want any new red to be unambiguously the upgrade's fault.
2. **Move the SDK first.** Bump `global.json` if it pins one, then `<TargetFramework>` and `<LangVersion>` in each project. Sweep the whole solution for stragglers on the old TFM - a mixed-framework solution is its own class of bug.
3. **Match the packages to the framework.** Update Microsoft and third-party packages to the line that targets the new framework, build, and work through the breaks. The official breaking-changes list for the release is the map; read it rather than guessing at each error. For a large or legacy solution an automated sweep drives the mechanical TFM and package bumps and surfaces the analyzers - the .NET Upgrade Assistant (`dotnet tool install -g upgrade-assistant`) still ships but is now deprecated in favor of the GitHub Copilot app modernization agent; whichever you use, still read the breaking-changes list for the behavioral breaks it cannot catch.
4. **Adopt new features on purpose.** A release's additions (`TimeProvider` for testable time, `HybridCache`, keyed services, primary constructors) are opt-in - take them where they pay, in their own follow-up commits, not bundled into the bump.
5. **Verify the full set.** Build, test, then run the repo's formatter so the diff is upgrade-only and not noise. Run whichever one the repo already pins - CSharpier or `dotnet format`, never both; the pick belongs to the skill covering .NET analyzers and build-gate enforcement, and an upgrade is the wrong moment to introduce a second formatter. The floor is .NET 8 / C# 12; how far you go above it is the target you chose.

A .NET Framework 4.8 -> modern .NET move is more than a TFM bump - different programming models and hard blockers (WebForms, server-side WCF, .NET Remoting, AppDomains). Its stance and upgrade-vs-replace blocker map are in `references/net-framework-48.md`.

## Flow C - NuGet package updates

1. **Audit first.** `dotnet list package --outdated` for what is behind, `dotnet list package --vulnerable` (add `--include-transitive`) for what is unsafe. Security fixes jump the queue.
2. **Sort by semver risk.** Patch and minor are usually safe; a major is a contract change - read its release notes before you commit to it. Group the work so the riskiest bumps are isolated.
3. **One package at a time.** Update a package, build, test, then the next. A single-package step is the only step you can bisect; a mass bump turns one regression into a hunt across a dozen libraries.
4. **Centralize versions.** With central package management the version lives once in `Directory.Packages.props`, not scattered across `.csproj` files - that mechanism belongs to the skill covering the solution build spine (`Directory.Build.props`, `Directory.Packages.props`, `global.json`); with none installed, add the `Directory.Packages.props` entry and set `ManagePackageVersionsCentrally` yourself.
5. **Undo cleanly.** Back out a bad update with `git revert` of that step's commit. Never silently downgrade an unrelated dependency to paper over the break.
