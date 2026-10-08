---
name: task-build-from-scratch
description: "Use when asked to build from scratch, start a new app or go greenfield - before any code exists. Manual, /-only. Not for changing an existing codebase."
disable-model-invocation: true
---

# Project Build From Scratch - Greenfield Design, Scaffold, Build

Use this skill to build a new application or a major new module from scratch, before code exists. The design happens here, in-session - there is no dispatched greenfield seat: with no code to read, a design pass reasons from the spec that is already in this conversation, and its options come back to the user anyway. This skill carries NO `model` pin for that DESIGN turn, deliberately: a skill-level `model` pin applies only for the rest of the turn in which the skill activates and is not saved to settings, so a multi-turn run returns to the session model (measured: invocations ran on the session model, while agent-level pins in the same session held exactly), so check the session model at run start: when it is not Opus, say so in the opening line, so the switch to `/model` Opus can happen before the options are reasoned. After the user's pick the session can drop to a cheaper model, which is fine: scaffold and build are dispatch mechanics.

## When to use

- Build a new application or major module from scratch, also on 'scaffold'; manual, /-only.
- DESIGN runs IN-SESSION on Opus (checked at run start - a frontmatter pin lasts one turn): the spec becomes 2-3 reasoned architecture options and the user picks, and nothing is scaffolded before that pick. Then the stack's real new-project command + baseline wiring, then the build slice by slice, through the domain seats or in-session per the run-start ask.
- Not for changing an existing codebase - a feature inside a live app goes to the cross-domain task flow, and a new module in an existing repo is the architecture capture plus that stack's solution-designer.

## Steps

### 1. DESIGN - in-session, on Opus
Load `habits-clarify` first (the Skill tool): a spec gap that blocks the design is its question to the user, never a guess. Then turn the spec into 2-3 reasoned architecture options - stack, architecture style, folder/module shape, state and persistence approach - each with its tradeoffs, drawn from the stack's architecture skills (the per-stack table below names them). Ground every option in the house skills, not recall. Multi-stack designs name the seam and its producer/consumer direction up front - the build step runs it producer-first.

### 2. THE PICK - hard gate
Present the options, then put the pick through AskUserQuestion - one option per architecture, its stack and one-line tradeoff as the description, exactly one marked `(Recommended)` and listed first with the reason that decides it, a custom direction always available via Other (plain-text options where the harness lacks the tool). Greenfield tech choices are the user's, never silently picked - nothing is scaffolded before this gate.

### 3. SCAFFOLD
Run the named new-project command (`dotnet new <template>`; `ng new`; `ionic start` for Ionic), establish the structure from the chosen architecture skill, and wire the baseline - DI, config, a test project, formatter/analyzer config - via the stack's own project-setup and code-quality skills where the project installed them. With neither installed, wire that baseline from the chosen architecture skill plus the template's own vendor defaults, and say in the report that it was done without them.

### 4. BUILD - slice by slice
When dispatch is available, ask ONE question before the first slice, via AskUserQuestion - build in the current session, or dispatch the stack seats? - one option marked `(Recommended)` per the `habits-execution-strategy` verdict - then hold the answer for the run (an invocation that already names the mode is the answer); no dispatch (Cursor) or a scaffold too small to fan out is INLINE without asking.

**DELEGATED** - for each vertical slice, dispatch that slice's stack seats directly from the main session (its designer, then implementer(s), then verifier - the domain-trio vertical, this skill's own `references/domain-trio-protocol.md`). Each slice's designer plan goes through ONE AskUserQuestion before its first implementer - 'Approve and build (Recommended)' / 'Changes needed' - and the stamp below quotes the answer. Before the first implementer fans out, stamp the approval gate, in four parts:

- *Shape* - write `<docs-path>/flow/APPROVAL`, first line `APPROVED <plan id> - "<the user's words, verbatim>"` on their explicit approval, or `AUTO - "<their words, verbatim>"` only on a literal no-stops ask. The dispatch hook blocks an unstamped implementer; delete the file when the run completes.
- *Path* - Write the stamp at the ABSOLUTE path `${CLAUDE_PROJECT_DIR}/<docs-path>/flow/APPROVAL` with the Write tool. Only where the docs root still sits under `.claude/` (the old `.claude/docs` default, kept) is the write protected: a prompt for it offers 'Yes, and allow Claude to edit files in this project's .claude folder for this session' - take that, since `permissions.allow` cannot pre-approve it. A relative write follows whatever cwd the shell drifted to, and the dispatch then bounces.
- *Ownership* - the stamp belongs to the session that dispatches, written when its own decision lands and deleted at its own close; an earlier session's leftover stamp is not consent.
- *Refused* - if BOTH the Write tool and an absolute-path Bash write are refused by the harness's classifier, stop and put the choice through AskUserQuestion (retry the stamp, or run this stage inline) rather than retrying blind or dispatching around the gate.

Then: reds route to the matching resolver seat for that stack where one is installed, and are fixed in-session where none is. A multi-stack slice runs producer-first: the PRODUCER designer runs first and the interface section of its plan IS the contract, recorded before any consumer seat is briefed. Loop until the spec's first milestone is met.

**INLINE** (chosen or forced) - do the slices in-session with `habits-plan-writing` plus the architecture skills instead of dispatching.

### 5. HANDOFF - the close, as a field template
First milestone green. Close on a literal line template, not prose to remember - one line per field, a table where a field lists several items:

```
Stack:     <the option the user picked - stack, architecture style, state/persistence, in one line>
Scaffold:  <the new-project command actually run> + <the baseline wired: DI, config, test project, formatter/analyzer>
Slices:    <n> built, <n> verified green - <the milestone reached>
Baseline:  build <green|red>, tests <n passed / n failed>, quoted from the command that produced it
Leftovers: APPROVAL stamp <deleted|still present>; <anything this run started and left up - a container, seeded data, a background process - or `none started`>
Next run:  <each capture whose output does not exist yet, in order: /capture-architecture (no architecture docs under <docs-path>/architecture/), /capture-code-style (no <docs-path>/code-style/CODE-STYLE.md), /capture-project-capabilities (no <docs-path>/project-capabilities/PROJECT-CAPABILITIES.md - the run book the verifiers read first), /capture-agent-capabilities LAST (no .claude/rules/alfred-project-agent-capabilities.md) - each in a FRESH session; `none` when all four exist>
```

Every count comes from the command that produced it, never a hand tally. A capture is named in `Next run:` only when its output is missing - check the four paths, never list them by default. Those named go TO THE USER as their next commands, never invoked from here - all but the architecture one are slash-only and a Skill call on them is refused, and each wants a fresh session anyway. They give the new repo its map, style doc, run book and generated awareness rules, and from there the standing flow machinery owns the project.

## Per-stack scaffolding

**Availability** - each row's skills exist only where that stack was installed; match them from your skill list by what each covers, and a skill absent because the project is greenfield (an evidence-gated specialist arrives only once code shows the need) is designed around from the stack's hub skill and the vendor docs, never guessed by name.

| Stack | new-project command | Architecture + convention skills to match from your skill list |
|---|---|---|
| Angular web | ng new | the Angular framework-conventions skill + the Angular CSS/SCSS styling skill |
| Ionic/Capacitor mobile | ionic start + cap add | the Ionic/Capacitor conventions skill + the mobile router that indexes it |
| ASP.NET Core backend | dotnet new webapi/web | the .NET architecture skill + the ASP.NET web/API skill, or its minimal-API specialist where the design picked that shape |
| WPF desktop | dotnet new wpf | the WPF conventions skill (strict MVVM) |
| SQL / data | first schema | the cross-engine database-conventions skill + the .NET migrations skill |

## Example

Brief: 'Start a new Angular admin dashboard.'
1. **DESIGN** in-session: three options - standalone + signals with feature folders; NgRx-backed modular; minimal-shell MVP - each with routing, state tier, folder shape, and the tradeoff that decides it.
2. **THE PICK**: the user chooses option one.
3. **SCAFFOLD**: `ng new admin`, structure per the Angular framework-conventions skill, wire lint/format config, a test setup, the core routing shell.
4. **BUILD**: first slice (the auth shell) - dispatch the web-Angular stack's own trio in order, its solution-designer, then its implementer(s), then its verifier; loop the punch-list. Repeat per slice to the first milestone.
5. **HANDOFF**: suggest the captures so the repo gets its map and style artifacts.

## Rules
- Greenfield architecture and tech choices are the user's - present options, get the pick, never scaffold before it.
- Design from the house architecture skills, not recall - this skill routes to them, it does not re-derive structure. Version-sensitive choices check the documentation server or the vendor doc, never memory - an option resting on a claim no doc backs says `unverified`.
- The main session is the only orchestrator - never instruct a subagent to dispatch another; the domain seats this skill fans out carry no Agent tool.
- An honest NEEDS_CONTEXT beats a guessed design: a blocking spec question goes to the user before options are locked.
