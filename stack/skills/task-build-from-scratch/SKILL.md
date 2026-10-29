---
name: task-build-from-scratch
description: "Use when asked to build from scratch, start a new app or go greenfield - before any code exists. Manual, /-only. Not for changing an existing codebase."
disable-model-invocation: true
---

# Project Build From Scratch - Greenfield Design, Scaffold, Build

Use this skill to build a new application or a major new module from scratch, before code exists. The design happens here, in-session - there is no dispatched greenfield seat: with no code to read, a design pass reasons from the spec that is already in this conversation, and its options come back to the user anyway. This skill carries NO `model` pin and asks for no model switch: the design runs on the session's model (a skill-level pin lasts only for the turn it activates in; measured: Sonnet at xhigh met every planted constraint of a greenfield spec, as Opus did, for less).

## When to use

- Build a new application or major module from scratch, also on 'scaffold'; manual, /-only.
- DESIGN runs IN-SESSION on the session's model: the spec becomes 2-3 reasoned architecture options and the user picks, and nothing is scaffolded before that pick. Then the stack's real new-project command + baseline wiring, then the build slice by slice, through the domain seats or in-session per the run-start ask.
- Not for changing an existing codebase - a feature inside a live app goes to the cross-domain task flow, and a new module in an existing repo is the architecture capture plus that stack's solution-designer.

**Modes.** Mode flags right after the command - `--mode-auto-run-on`, `--mode-auto-run-off`, `--mode-output-scorer-on`, `--mode-output-scorer-off` - are switches, not the request: strip them; with only flags typed, run as with no arguments. Under the hook's auto-run contract, follow it. With no hook line (hooks off, Cursor), `-on` holds for this run only: each stop takes its `(Recommended)` option, listed in the close, an unmarked one waits, nothing goes outward, no fresh-session hand-off, and the close says auto-run ended; `--mode-output-scorer-on` grades this run's output like a typed stack. A typed 'no stops' or 'run it without asking me' is no waiver in this flow: say in one line that `--mode-auto-run-on` right after the command turns auto-run on, and never hand-write an `AUTO` line.

## Steps

### 1. DESIGN - in-session
Load `habits-clarify` first (the Skill tool): a spec gap that blocks the design is its question to the user, never a guess. Read `PERSONAL-CODE-PREFERENCES.md` and `ARCHITECTURE-PREFERENCES.md` under `<docs-path>/preferences/` (those that exist) before drawing any option - a new project has no code doc or assessment, so they are the whole orientation. Then turn the spec into 2-3 reasoned architecture options - stack, architecture style, folder/module shape, state and persistence approach - each with its tradeoffs, drawn from the stack's architecture skills (the per-stack table below names them). Ground every option in the house skills, not recall. Multi-stack designs name the seam and its producer/consumer direction up front - the build step runs it producer-first.

### 2. THE PICK - hard gate
Where a `scorer: stacked` line is in context, the FIRST action before releasing THE PICK - before its ask is put - is the `mode-output-scorer` Skill call with output `pick`.

Present the options, then put the pick through one ask - one option per architecture, a custom direction always available via Other (plain-text options where the harness lacks the tool):

```ask
<N> architectures fit <the brief>. Which one?
- '<architecture A> (Recommended)' - <its stack; the reason that decides it>
- '<architecture B>' - <its stack; its one-line tradeoff>
```
Greenfield tech choices are the user's, never silently picked - nothing is scaffolded before this gate.

### 3. SCAFFOLD
Run the named new-project command (`dotnet new <template>`; `ng new`; `ionic start` for Ionic), establish the structure from the chosen architecture skill, and wire the baseline - DI, config, a test project, formatter/analyzer config - via the stack's own project-setup and code-quality skills where the project installed them. With neither installed, wire that baseline from the chosen architecture skill plus the template's own vendor defaults, and say in the report that it was done without them.

### 4. BUILD - slice by slice
When dispatch is available, ask ONE question before the first slice and hold the answer for the run (an invocation that already names the mode is the answer) - the mark on the mode the `habits-execution-strategy` verdict picks, listed first:

```ask
Build here or through the stack seats? <the verdict's reason>
- 'In this session (Recommended)' - <why it fits one chat>
- 'Dispatch the stack seats' - <the slices that run in parallel>
```

No dispatch or a scaffold too small to fan out is INLINE without asking.

**DELEGATED** - for each vertical slice, dispatch that slice's stack seats directly from the main session (its designer, then implementer(s), then verifier - the domain-trio vertical, this skill's own `references/domain-trio-protocol.md`). Each slice's designer plan goes through ONE ask before its first implementer, and the stamp below quotes the answer:

```ask
<slice> plan, <N> tasks. Build it?
- 'Approve and build (Recommended)' - stamp, then fan out
- 'Changes needed' - I ask what to change next, in plain text
```

Before the first implementer fans out, stamp the approval gate, in four parts:

- *Shape* - write `<data root>/state/approvals/<plan id>/APPROVAL` (`<plan id>` is the plan file's name without `.md` - the file the protocol writes for the slice, `<docs-path>/work/plans/<feature>.md` with the slice as `<feature>`, so each slice has its own id), first line `APPROVED <plan id> - "<the user's words, verbatim>"` on their explicit approval (under auto-run the hook's `AUTO` stamp already stands - leave it). The dispatch hook blocks an unstamped implementer; delete the file when the run completes. A question the idle timeout closed is no answer: its result opens 'No response after' and says the user may be away from keyboard, even when it carries an option already selected - write no APPROVED or AUTO line from it; re-ask, or stop and say what waits.
- *Path* - Write the stamp at the ABSOLUTE path `${CLAUDE_PROJECT_DIR}/<data root>/state/approvals/<plan id>/APPROVAL` with the Write tool, and give every implementer brief the line `plan: <plan id>` - the dispatch hook passes a brief only on its own plan's stamp. A relative write follows whatever cwd the shell drifted to, and the dispatch then bounces.
- *Ownership* - the stamp belongs to the session that dispatches, written when its own decision lands and deleted at its own close; an earlier session's leftover stamp is not consent.
- *Refused* - if BOTH the Write tool and an absolute-path Bash write are refused by the harness's classifier, stop and ask rather than retrying blind or dispatching around the gate:

  ```ask
  Both write routes refused the approval stamp: <the refusal>.
  - 'Retry the stamp (Recommended)' - allow the write at the prompt
  - 'Run this stage inline' - no dispatch, no stamp
  ```

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
Commit:    <the commit `git log -1 --stat` read back | held - the diff is uncommitted | no git - the scaffold is not a repository>
Next run:  <each capture whose output does not exist yet, in order: /capture-architecture (no architecture docs under <docs-path>/architecture/), /capture-project-code-style (no <docs-path>/preferences/PROJECT-CODE-PREFERENCES.md), /capture-preferences (no PERSONAL-CODE- or ARCHITECTURE-PREFERENCES.md in <docs-path>/preferences/), /capture-awareness LAST (no .claude/rules/alfred-awareness.md - the inventory, the run book and the sibling repos every session loads) - each here, or in a fresh session where a hook's fresh-session text says one pays back; `none` when all four exist>
```

Then the commit decision, ONE AskUserQuestion after the close prints, when the scaffold is a git repository (no git: the `Commit:` field says so and nothing is asked):

```ask
The first milestone is green and the scaffold is uncommitted. Commit it on this machine?
- 'Commit now (Recommended)' - runs `habits-commit-checkpoint` in full, then commits
- 'Hold - review the diff first' - nothing is committed; the diff stays as it is
```

Every count comes from the command that produced it, never a hand tally. A capture is named in `Next run:` only when its output is missing - check the four paths, never list them by default. Those named go TO THE USER as their next commands, never invoked from here - all but the architecture one are slash-only and a Skill call on them is refused. They give the new repo its map, style doc, run book and generated awareness rules, and from there the standing flow machinery owns the project.

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
- Design from the house architecture skills, not recall - this skill routes to them, it does not re-derive structure. Version-sensitive choices check the documentation tools or the vendor doc, never memory - an option resting on a claim no doc backs says `unverified`.
- The main session is the only orchestrator - never instruct a subagent to dispatch another; the domain seats this skill fans out carry no Agent tool.
- An honest NEEDS_CONTEXT beats a guessed design: a blocking spec question goes to the user before options are locked.
