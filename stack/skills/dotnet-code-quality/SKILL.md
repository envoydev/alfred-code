---
name: dotnet-code-quality
description: "Use when setting up or fixing formatting, analyzers, .editorconfig, warnings-as-errors, or a CI quality gate in .NET - or when the user names CSharpier, dotnet format, Roslynator, editorconfig, analyzer, AnalysisLevel, or NoWarn. .NET conventions for mechanically enforcing code quality: making the house style a build gate, not a review opinion. Floors at .NET 8 / C# 12. Do NOT use for authoring Roslyn analyzers or source generators (the source-generator skill) or for test-suite quality (dotnet-testing)."
---

# .NET code quality - enforcement, not opinion

The `csharp` skill says *what* good C# looks like; this skill makes a build *prove* it. The goal is that style and correctness rules are a gate the compiler and CI enforce, so they never depend on a reviewer noticing. Baseline is .NET 8 / C# 12. This is about configuring the tools - authoring your own Roslyn analyzers belongs to the skill covering source-generator and analyzer authoring, and judging whether the *tests* are any good to the .NET testing hub.

## Two owners, one boundary: formatting vs rules

Split the space cleanly so two tools never fight over the same bytes:

- **A formatter owns layout** - whitespace, wrapping, brace placement. Pick **CSharpier**: it is opinionated and effectively zero-config, which ends the formatting debate instead of relocating it into `.editorconfig` knobs. The alternative, `dotnet format`, drives whitespace from `.editorconfig` style rules - fine if a repo has already standardized on it, but do not run both as formatters.
- **`.editorconfig` + analyzers own rules** - naming, usings, severity, the CA/IDE diagnostics. Formatting style rules effectively defer to the formatter.

Document which tool owns formatting once (in the repo's `CLAUDE.md` / `AGENTS.md`) so an agent never reformats under the wrong engine.

Install CSharpier as a **local tool** for reproducible local-and-CI runs, not globally:

```bash
dotnet new tool-manifest          # if .config/dotnet-tools.json is missing
dotnet tool install csharpier
dotnet csharpier check .          # CI: fails on unformatted code (use 'format' to write)
```

Add a `.csharpierignore` for generated or vendored trees. Tool pinning in `.config/dotnet-tools.json` is `dotnet-project-setup`.

## First-party SDK analyzers before any third-party pack

Turn on the analyzers that ship with the SDK first - they cost nothing and catch real defects. Set them once in `Directory.Build.props` (not per-project; layout is `dotnet-project-setup`):

```xml
<PropertyGroup>
  <EnableNETAnalyzers>true</EnableNETAnalyzers>
  <AnalysisLevel>latest</AnalysisLevel>              <!-- version knob: latest analyzer wave -->
  <AnalysisMode>Recommended</AnalysisMode>           <!-- strictness knob: All for the strictest bar -->
</PropertyGroup>
```

Only reach for a third-party pack (Roslynator, StyleCop, Meziantou) once the SDK baseline is in place and you have a concrete rule the SDK lacks - and give it an explicit severity plan so packs do not enforce contradictory versions of the same rule. **Roslynator** is the first add: prefer the `Roslynator.Analyzers` NuGet package (build-enforced) over the CLI; the CLI (`roslynator.dotnet.cli`) earns its place only for one-off analyze / fix / find-unused sweeps, and treat any auto-`fix` as a controlled change - run it on a bounded target, rebuild, rerun the tests.

A **per-method complexity ceiling** is the archetypal rule the SDK lacks - gate on cyclomatic or cognitive complexity, not just a line-count cap, because a 20-line method can still hide a branch thicket the length rule never catches. The SDK analyzers ship no complexity rule; Roslynator (or Sonar) supplies one, promoted to a build-failing severity like any other. To rank *existing* methods by change risk - cyclomatic complexity weighed against test coverage, so tests land where they pay - see `references/crap-analysis.md`.

## One root `.editorconfig` is the single source of severity

- Exactly **one** repo-root `.editorconfig` with `root = true`. Per-rule severity lives here, in version control - never in IDE-only settings that silently override repo policy.
- Add a **nested** `.editorconfig` only when a subtree genuinely needs different policy (looser rules for `*.Tests`, relaxed docs for generated code). Reserve `.globalconfig` for the exceptional case, not the normal setup.
- Keep **bulk MSBuild switches** (`EnableNETAnalyzers`, `AnalysisLevel`) in `Directory.Build.props`; keep **per-rule severity** (`dotnet_diagnostic.CA2007.severity = warning`) in `.editorconfig`. Do not split one rule's config across both.
- Write real EditorConfig - lowercase filename, forward-slash globs.

## Warnings as errors - and the rule you must not break

A clean build means zero warnings, enforced. For a **new** project, set the bar on day one:

```xml
<TreatWarningsAsErrors>true</TreatWarningsAsErrors>
```

The non-negotiable, because it is the exact reward-hack an agent reaches for: **when a warning-as-error breaks the build, fix the code - never silence the signal.** Specifically, do not

- remove, set `false`, or condition away `TreatWarningsAsErrors` / `WarningsAsErrors`,
- add `<NoWarn>` or `#pragma warning disable` for a promoted warning,
- downgrade a rule's severity in `.editorconfig` (`error` -> `warning`/`none`) to go green.

If the fix is genuinely too large, put it to the user through ONE AskUserQuestion naming the warning ID and the count, with three options: fix it now (recommended), defer that one ID with a `NoWarn` carrying a dated comment, or drop the promotion for this wave. Never take any of the three unilaterally - a silently weakened policy reads as a green build. (See the reward-hacking shortcuts list below; enforce it up front rather than catch it after the fact.)

## Legacy backlog: promote in batches, never all at once

Flipping `TreatWarningsAsErrors=true` on an existing codebase yields hundreds of errors and floods the context; fix quality collapses. Promote a curated set of IDs via `WarningsAsErrors`, in waves, building green between each:

1. **Trivial hygiene first** - mechanical, near-zero-risk: `CS8019` (unnecessary using), `CS0219`/`CS0168` (unused variable), `CS1591` (missing XML doc on public API), `CS0612`/`CS0618` (obsolete member). Add `CS8019;CS0219;CS0168` to `WarningsAsErrors`, fix all, commit.
2. **Code-quality CA rules next, by category** - put the category order to the user through one AskUserQuestion listing the categories, recommending the one with the most findings first: `CA2000` (dispose before scope loss), `CA1062` (validate public args), `CA2007` (`ConfigureAwait`), `CA1822` (mark static), `CA1860`/`CA1861` (LINQ/array perf).
3. **Promote security rules to error** - the `CA3xxx` (injection) and `CA5xxx` (crypto/TLS) families belong at `error` in `.editorconfig`; which rules and why is `dotnet-security`'s (A03 and A02).

## The gate is `dotnet build`

Analyzer enforcement is not a separate CI step - `dotnet build` runs the analyzers and, with warnings-as-errors, fails on a violation. So the same gate developers run locally is the CI gate. Add the formatter check and the build to CI; both must be reproducible from a clean checkout with no machine-global state.

Prove the gate before calling any of this done, and quote the result:

1. `dotnet tool restore` - the pinned tools resolve from the manifest, not from a machine-global install.
2. `dotnet csharpier check .` - exit 0, or the list of unformatted files.
3. `dotnet build -warnaserror` - exit 0, or the analyzer IDs it failed on.

Report the command and its result line for each, never the claim alone. A gate you did not run is a gate you cannot say holds.

## Reward-hacking shortcuts to reject

The recurring ways a change fakes a green build instead of earning it - reject each in review, whoever wrote it. Most are gated above or in a sibling skill; this is the one consolidated list to check a diff against before claiming done.

The shortcut-by-shortcut table is `references/reward-hacking.md` - read it before claiming a change is done.

The build gate above catches the warning-suppression rows automatically; the rest are a review discipline. A check that only notices them after merge has already paid for the slop.
