---
name: alfred-task-build-from-scratch
description: "Build a new application or major module from scratch. Use when the user asks to build from scratch, start a new project or app, go greenfield, or scaffold - before any code exists; manual, /-only. DESIGN runs IN-SESSION on Opus (checked at run start - a frontmatter pin lasts one turn): the spec becomes 2-3 reasoned architecture options and the user picks, and nothing is scaffolded before that pick. Then the stack's real new-project command + baseline wiring, then the build slice by slice, through the domain seats or in-session per the run-start ask. Not for changing an existing codebase - a feature inside a live app is `alfred-task-solve-cross`, a new module in an existing repo is the alfred-capture-architecture capture plus that stack's solution-designer."
disable-model-invocation: true
---

# Project Build From Scratch - Greenfield Design, Scaffold, Build

Use this skill to build a new application or a major new module from scratch, before code exists. The design happens here, in-session - there is no dispatched greenfield seat: with no code to read, a design pass reasons from the spec that is already in this conversation, and its options come back to the user anyway. This skill carries NO `model` pin for that DESIGN turn, deliberately: a skill-level `model` pin applies only for the rest of the turn in which the skill activates and is not saved to settings, so a multi-turn run returns to the session model (measured: invocations ran on the session model, while agent-level pins in the same session held exactly), so check the session model at run start: when it is not Opus, say so in the opening line, so the switch to `/model` Opus can happen before the options are reasoned. After the user's pick the session can drop to a cheaper model, which is fine: scaffold and build are dispatch mechanics.

## Steps

### 1. DESIGN - in-session, on Opus
Load `alfred-habits-clarify` first (the Skill tool): a spec gap that blocks the design is its question to the user, never a guess. Then turn the spec into 2-3 reasoned architecture options - stack, architecture style, folder/module shape, state and persistence approach - each with its tradeoffs, drawn from the stack's architecture skills (the per-stack table below names them). Ground every option in the house skills, not recall. Multi-stack designs name the seam and its producer/consumer direction up front - the build step runs it producer-first.

### 2. THE PICK - hard gate
Present the options, then put the pick through AskUserQuestion - one option per architecture, its stack and one-line tradeoff as the description, a custom direction always available via Other (plain-text options where the harness lacks the tool). Greenfield tech choices are the user's, never silently picked - nothing is scaffolded before this gate.

### 3. SCAFFOLD
Run the named new-project command (`dotnet new <template>`; `ng new`; `ionic start` for Ionic), establish the structure from the chosen architecture skill, and wire the baseline - DI, config, a test project, formatter/analyzer config - via the stack's own project-setup and code-quality skills where the project installed them. With neither installed, wire that baseline from the chosen architecture skill plus the template's own vendor defaults, and say in the report that it was done without them.

### 4. BUILD - slice by slice
When dispatch is available, ask ONE question before the first slice, via AskUserQuestion - build in the current session, or dispatch the stack seats? - then hold the answer for the run (an invocation that already names the mode is the answer); no dispatch (Cursor) or a scaffold too small to fan out is INLINE without asking.

**DELEGATED** - for each vertical slice, dispatch that slice's stack seats directly from the main session (its designer, then implementer(s), then verifier - the domain-trio vertical, this skill's own `references/domain-trio-protocol.md`). Before the first implementer fans out, stamp the approval gate, in four parts:

- *Shape* - write `<docs-path>/flow/APPROVAL`, first line `APPROVED <plan id> - "<the user's words, verbatim>"` on their explicit approval, or `AUTO - "<their words, verbatim>"` only on a literal no-stops ask. The dispatch hook blocks an unstamped implementer; delete the file when the run completes.
- *Path* - Write the stamp at the ABSOLUTE path `${CLAUDE_PROJECT_DIR}/<docs-path>/flow/APPROVAL` with the Write tool. `.claude/` is a protected path, so the first write in a session prompts: take the prompt's 'allow Claude to edit its own settings for this session' option and the rest of the run is free (no settings key can pre-approve it - `permissions.allow` is not consulted for protected paths). A relative write follows whatever cwd the shell drifted to, and the dispatch then bounces.
- *Ownership* - the stamp belongs to the session that dispatches, written when its own decision lands and deleted at its own close; an earlier session's leftover stamp is not consent.
- *Refused* - if BOTH the Write tool and an absolute-path Bash write are refused by the harness's classifier, stop and put the choice through AskUserQuestion (retry the stamp, or run this stage inline) rather than retrying blind or dispatching around the gate.

Then: reds route to the matching resolver seat for that stack where one is installed, and are fixed in-session where none is. A multi-stack slice runs producer-first: the PRODUCER designer runs first and the interface section of its plan IS the contract, recorded before any consumer seat is briefed. Loop until the spec's first milestone is met.

**INLINE** (chosen or forced) - do the slices in-session with `alfred-habits-plan-writing` plus the architecture skills instead of dispatching.

### 5. HANDOFF - the close, as a field template
First milestone green. Close on a literal line template, not prose to remember - one line per field, a table where a field lists several items:

```
Stack:     <the option the user picked - stack, architecture style, state/persistence, in one line>
Scaffold:  <the new-project command actually run> + <the baseline wired: DI, config, test project, formatter/analyzer>
Slices:    <n> built, <n> verified green - <the milestone reached>
Baseline:  build <green|red>, tests <n passed / n failed>, quoted from the command that produced it
Leftovers: APPROVAL stamp <deleted|still present>; <anything this run started and left up - a container, seeded data, a background process - or `none started`>
Next run:  <each capture whose output does not exist yet, in order: /alfred-capture-architecture (no architecture docs under <docs-path>/architecture/), /alfred-capture-code-style (no <docs-path>/code-style/CODE-STYLE.md) - each in a FRESH session; `none` when both exist>
```

Every count comes from the command that produced it, never a hand tally. A capture is named in `Next run:` only when its output is missing - check the two paths, never list them by default. Those named go TO THE USER as their next commands, never invoked from here - the code-style one is slash-only and a Skill call on it is refused, and both want a fresh session anyway. They give the new repo its map, style doc, and generated awareness rules, and from there the standing flow machinery owns the project.

## Per-stack scaffolding

Read `references/per-stack-scaffolding.md` at step 3, before the new-project command - the command per stack and the architecture and convention skills to match from your skill list by what each covers.

## Example

`references/worked-example.md` walks one brief (a new Angular admin dashboard) through the five steps - read it when the shape of a whole run is unclear.

## Rules
- Greenfield architecture and tech choices are the user's - present options, get the pick, never scaffold before it.
- Design from the house architecture skills, not recall - this skill routes to them, it does not re-derive structure. Version-sensitive choices check the documentation server or the vendor doc, never memory - an option resting on a claim no doc backs says `unverified`.
- The main session is the only orchestrator - never instruct a subagent to dispatch another; the domain seats this skill fans out carry no Agent tool.
- An honest NEEDS_CONTEXT beats a guessed design: a blocking spec question goes to the user before options are locked.
