---
name: task-implement
description: "Use to build a task plan in this chat, task by task - 'execute the plan', 'build the plan', 'implement task 2'. Not for ad-hoc edits or the full gated cycle."
---

# Project Implementer - execute a verified plan, task by task, in one chat

This is the build step of the single-session vertical: `task-design` produced the plan, `task-verify-plan` audited it, this executes it - one task at a time, in the plan's dependency order, in your context so every diff is inspectable as it lands. It carries the implementer seat's *execution protocol* only; the coding conventions themselves need no restating - the path-scoped rules auto-attach the house skill per file type, the preferences docs the alfred-preferences.md rule names - the project's actual style among them - are read before the first edit, and the plan's task cards name the stack traps.

The measurements behind these rules live in `references/evidence.md` - an audit appendix, not a run-time load.

The plan FILE is the whole input - not the chat that produced it. In a long build carried conversation, not the tools, is the dominant token cost, so a fresh session (or `/clear` between tasks) keeps the context at plan size - offer one where a hook's fresh-session text says it pays back with the cache warm; the per-task ticks below make any task boundary a safe resume point.

## When to use

- You have a task plan and want to build it in this chat: it honors each task's contract, writes code + tests, gates each task green before the next, then hands to the build review.
- Not for a plan-less ad-hoc edit, or the whole gated cycle from design to done (/task-solve).

**Modes.** Mode flags right after the command - `--mode-auto-run-on`, `--mode-auto-run-off`, `--mode-output-scorer-on`, `--mode-output-scorer-off` - are switches, not the request: strip them; with only flags typed, run as with no arguments. Under the hook's auto-run contract, follow it. With no hook line (hooks off, Cursor), `-on` holds for this run only: each stop takes its `(Recommended)` option, listed in the close, an unmarked one waits, nothing goes outward, no fresh-session hand-off, and the close says auto-run ended; `--mode-output-scorer-on` grades this run's output like a typed stack. A typed 'no stops' or 'run it without asking me' is no waiver in this flow: say in one line that `--mode-auto-run-on` right after the command turns auto-run on, and never hand-write an `AUTO` line.

## Build mode - this chat or the implementer seats

1. **Pick the mode.** When the invocation names no mode and no calling flow has already recorded one (`task-solve`'s `mode <session|agents>` approval line, an orchestrator's brief), ask ONE question before building and hold the answer; a mode the run already picked is inherited, never re-asked. The mark sits on the mode the `habits-execution-strategy` verdict picks (`parallel seats` moves it to the seats, listed first):

   ```ask
   Build here or through the implementer seats? <the verdict's reason>
   - 'In this chat (Recommended)' - <why it fits one chat>
   - 'Dispatch the implementer seats' - <the tasks that run in parallel>
   ```
2. **Build.** In-chat: build in this chat, the protocol below. On an agents answer: dispatch each task to its `<stack>-implementer` seat instead, exactly as the roster spells it (`alfred-code:<seat>` where the core plugin carries it) - up to `ALFRED_CODE_MAXIMUM_RUN_AGENTS` at once (default 5), each on its frontmatter model unless you name one.
3. **Stamp the approval before the first dispatch.** `<data root>/state/approvals/<plan id>/APPROVAL` (`<plan id>` is the plan file's name without `.md`), first line `APPROVED <plan id> - "<the user's words, verbatim>"` on their explicit approval (under auto-run the hook's `AUTO` stamp already stands - leave it); the dispatch hook blocks an unstamped implementer; delete the file when the run completes. A question the idle timeout closed is no answer: its result opens 'No response after' and says the user may be away from keyboard, even when it carries an option already selected - write no APPROVED or AUTO line from it; re-ask, or stop and say what waits. Write the stamp at the ABSOLUTE path `${CLAUDE_PROJECT_DIR}/<data root>/state/approvals/<plan id>/APPROVAL` with the Write tool, and give every implementer brief the line `plan: <plan id>` - the dispatch hook passes a brief only on its own plan's stamp. A relative write follows whatever cwd the shell drifted to and the dispatch then bounces. The stamp belongs to the session that dispatches - written when its own decision lands, deleted at its own close; an earlier session's leftover stamp is not consent.
4. **If the stamp is refused, ask - never dispatch around it.** If BOTH the Write tool and an absolute-path Bash write are refused by the harness's classifier, stop and ask rather than retrying blind or dispatching around the gate:

   ```ask
   Both write routes refused the approval stamp: <the refusal>.
   - 'Retry the stamp (Recommended)' - allow the write at the prompt
   - 'Run this stage inline' - no dispatch, no stamp
   ```
5. **Stay the only orchestrator.** Keep the main session the only orchestrator, routing a red per the repair-agent rules, and ticking the plan file as reports land - and each seat's gate is build + fast tests only, never a minutes-long run like integration replays or an E2E pass; the full suite stays with this session's finish step. Dispatch nothing you were not asked to.
6. **No plan approval line, one ask before task 1.** The approval is the calling flow's too - and a plan file that carries no `Approved:` line when this skill is invoked on its own gets ONE approval ask before task 1, its answer written to the plan as `Approved: <date> - "<the user's words, verbatim>"`:

   ```ask
   <plan file> carries no Approved: line. Build it?
   - 'Approve - build task 1 (Recommended)' - stamped as Approved:
   - 'Changes needed' - I ask what to change next, in plain text
   ```

## The protocol - per task, in plan order

Before reading the plan, load `habits-plan-writing` (the Skill tool) - the card fields and status marks below are its shape - and `habits-test-first`, the loop every card's `test:` runs on.

1. **Take exactly one task.** Its card is the contract: the files it owns, the traps it names, the `file:symbol` anchors, the `test:` it writes first, and its acceptance criterion. When the plan lives in a file (it should - `task-design` writes it to `<docs-path>/work/plans/`), mark the task `IN_PROGRESS` there before touching code. Jump to the anchors - the designer already located them; do not re-navigate the repo.
2. **Build the slice + its tests together.** The acceptance criterion is what the tests prove; a task without its test is not built, it is drafted. The card's `test:` comes first, by `habits-test-first` - its red, a run that failed on the assertion the criterion names, is the only red that counts. The card's `log_points` go in with the slice, through the repo's logging seam at the level and with the identifiers the card names - never left for a later pass, never a second logger. Every line meets 'The bar I build to' - structure, quality, naming, comments - and every judgment call lands with its precedent. Stay inside the task's boundary - a needed change outside it is a flag, not a detour (see below).
3. **Gate the task green.** Build + the relevant tests after each task, not at the end of the plan - the plan header's `Build:` command set where it has one, scoped to the touched projects and never a subset of it: a gate that drops the build passes what only the build catches (a template binding error, a missing provider). Resolve every red INLINE in this session - keep the fix loop here, quoting each build/test run so every attempt stays inspectable; the in-chat build dispatches nothing. The loop is bounded the way the resolver seats' is: after the FIFTH red run of one task's gate the next act is ONE ask, never a sixth run - the mark on 'Keep fixing inline' when the last red run changed, else on the resolver seat (or 'Stop' where the project installed none), listed first. Load the stack's convention skills for the trap list when the red points at one.

   ```ask
   <task> is red after 5 runs: <the last error>.
   - 'Keep fixing inline (Recommended)' - <what the last run changed>
   - 'Hand it to a resolver seat' - <the seat>
   - 'Stop' - the task stays red in the plan
   ```
4. **Close the task honestly** - the per-task completion gate is `habits-done-gate`'s rule, carried here so no load stands between it and the tick: run the acceptance command after the last edit and quote its output before any done word. Run it, then tick the task `DONE` with its evidence line - the acceptance command's own quoted output - in the plan file, append the task's judgment calls to the plan's `## Decisions` ledger (choice + precedent, per the bar), and refresh the plan's one-line resume note (next task + any mid-task state). The file, not the chat, is what a compacted or fresh session resumes from - it must never be more than one task stale. Then the next task. Partial is stated as partial. A task whose acceptance criterion is a RUN that has not happened yet - an integration pass, a manual try, a suite the gate deferred - stays `IN_PROGRESS` with a `needs: <the run>` line; 'code complete, builds' is not DONE. A task stamped `FAILED` ends the turn with ONE ask before any further run or edit - a 'reported to the user' line in the plan with no ask behind it is the measured failure:

   ```ask
   <task> FAILED: <why>.
   - 'Stop and report (Recommended)' - the plan records it
   - 'Continue inline' - <the next attempt>
   - 'Resolver seat' - <the seat>
   - 'Revert' - back to the task's start
   ```

## The bar I build to

The review-and-fix loop's five stages - structure, code quality, naming, logging, comments - are the bar the built slice meets on the FIRST pass, so a later loop over this code finds nothing. Hold each as you write, not as a pass afterwards. `references/build-bar.md` carries the five rung by rung - Read it before the first task of a plan, and again at any task whose card names a stage this run has not applied yet:

- **Structure** - a new file lands where the repo's best-organized module puts that kind of file, in the folder the task card names; never a dump folder, never a folder for one file.
- **Code quality** - the seven decision-level rules the plan settled apply to every line you add, and the line-level list in the reference applies with them.
- **Naming** - the repo's own vocabulary and casing for every identifier, one name per concept; no `data` / `info` / `manager` / `helper` where a specific word exists.
- **Logging** - the card's `log_points`, per the build step that places them: through the repo's seam, at the card's level with the card's identifiers, nothing beyond them.
- **Comments** - the always-on quality-gates rule's comments line, made concrete at write time. A checkable claim in a comment (a symbol, a count, an invariant) is true against the code you wrote; an existing comment your edit made stale is fixed in the same edit.

**A model change never leaves its task without its migration** - generated by the tool, or hand-written when the tool cannot run here. A schema model with no migration fails every integration test at boot (EF: `PendingModelChangesWarning`).

**The user's preferences first.** Build to the preferences docs `alfred-preferences.md` names - PERSONAL-CODE-, ARCHITECTURE-, GIT- and PROJECT-CODE-, the personal and architecture docs above the project one - ahead of the house conventions. Where an entry and a skill or another instruction disagree, ask the user which wins, the entry's side marked (Recommended) - a seat builds the entry's side and names the clash on `decisions:`. A task that cannot meet one stops and asks, naming the id - a seat returns NEEDS_CONTEXT - since a waiver is the user's `Except:` line, never the build's.

**Decisions.** A judgment call the card left open - two idiomatic shapes, a placement, a name at a seam - is decided here, never bounced back: pick the option most consistent with the codebase's existing patterns and record it as `the choice - precedent: <file:symbol or named rule>`, or `no precedent - <reason>` said explicitly and still decided. In-chat, append it to the plan file's `## Decisions` ledger; a dispatched seat reports it as `decisions:` lines for the orchestrator to fold in, never editing the shared plan file itself (siblings build in parallel). A bounce (an in-chat ask, a seat's NEEDS_CONTEXT) is for a user-level requirement or scope beyond the card, never for a how-to-build call.

**Reuse before recreation.** Before new code, stop at the first rung that holds: the app's own seam for the capability; the stdlib, runtime or framework already does it; an existing helper in this repo or an already-referenced package does it (search first - a second copy is a defect, consolidate to the existing seam); it is one line; only then the minimum code that works. Less code that still works - never the flimsier algorithm, never at the cost of validation at a trust boundary, error handling that prevents data loss, or secret handling.

The seam rung: any capability the project wraps - such as the clock, the file system, logging, settings, a process or the network - goes through the abstraction the touched class or the project already routes it through; search them first.

- A member the project's own interface lacks is added to it, its implementation and a test - never inlined as the raw call.
- When that interface sits outside the task's files, stop and name the member as a contract change (a seat's `BLOCKED_CONTRACT_CHANGE`).
- A framework seam the project chose, such as `ILogger<T>` or `TimeProvider`, is used through its members or an extension over it, never a new wrapper.

**Callers first on a bug fix.** Before changing a function to fix a bug, list its callers (the navigation tools' references) and fix once where they all route through - a guard on only the reported path leaves every sibling caller broken, and one guard in the shared function is also the smaller diff.

## When the plan meets reality

- **A task proves wrong mid-build** (the seam isn't where the plan said, a trap the audit missed): stop the task and name the delta - never silently redesign while implementing. The re-entry is the USER's call on the FIRST occurrence, not a counter you spend: end the turn with ONE ask (plain-text options where the harness lacks the tool) and re-enter only on that answer. The plan is the contract; reality wins, but through a revision, not a drift.

  ```ask
  <task> proves wrong: <the delta>.
  - 'Re-design this slice with task-design (Recommended)' - <the delta, named>
  - 'Continue against the delta' - <what changes>
  - 'Stop the build here' - the plan records where
  ```
- **A tool the environment blocks** (a generator hanging on denied egress, a command the sandbox refuses): the task still finishes in this session - take the in-session route before any ask. For an EF migration: `dotnet ef migrations add <Name>` with `--project` AND `--startup-project` both set to the project holding the design-time DbContext factory - the tools take that factory first and boot no host; failing that, hand-write the migration and its model-snapshot change from the nearest prior migration. Only a task with no in-session route becomes a blocker ask, and that ask recommends the route - never 'retry the same command' or 'you run it'.
- **Scope beyond the plan** (a bug discovered nearby, a refactor itch): flag it and ask (plain-text options where the harness lacks the tool). Never rides along. A bug reported AFTER a cycle stamped COMPLETE or outside any active cycle takes the second ask:

  ```ask
  Out of plan: <the item>.
  - 'Leave it for later (Recommended)' - named in the report
  - 'Add it to the plan' - a revision, then build
  ```

  ```ask
  <the bug>, reported outside an active cycle.
  - 'Defer (Recommended)' - named in the report
  - 'Fix now, ad hoc' - <the fix>
  - 'Open a new cycle' - a new plan file
  ```
- **A shared contract surfaces** (a DTO both sides compile against, a schema semantic): stop the task and put it through ONE ask - the same BLOCKED_CONTRACT_CHANGE discipline the dispatched seats follow:

  ```ask
  <task> touches a shared contract: <the DTO or schema>.
  - 'Hand it to the cross-domain flow (Recommended)' - you run `/task-solve-cross`; this build stops here
  - 'Keep it in this plan as a scoped change' - <the scope>
  - 'Stop the build' - the plan records where
  ```

## Finish - the in-session verifier

All tasks green: run the full suite once - the workspace's affected set (`nx affected -t test lint build` in an Nx workspace), else every touched project plus the projects that depend on it, never a hand-picked list - quoting the command in the report and in any verifier brief. A red called pre-existing, or a fix closed on a pass the unpatched code was never seen to fail ('uncapped', 'no longer reproduces'), needs that check run on the base (a stash or a worktree) and quoted - else the report says `unproven`. Then review the assembled diff against the plan - the reviewer through ONE ask unless a calling flow already chose it, pointed at the plan file so it reviews against the plan, not in isolation, and apply its findings; then the done-gate on the whole feature.

```ask
All tasks green (<the suite command>). Who reviews the diff?
- 'task-verify-code in-session (Recommended)' - inline, the single-chat form of the verifier seat
- 'The <stack>-verifier seat' - dispatched, isolated, on its frontmatter model
```

Report against the plan, one line per task - `task | status (DONE / deferred / revised) | evidence (the green command and what it proved)` - then the suite + the review result, the `## Decisions` ledger by its entry count (never re-pasted), and anything deferred or revised with its reason. The vertical is complete: design (`task-design`) -> audit (`task-verify-plan`) -> build (this) -> review (`task-verify-code` / `<stack>-verifier`) - one session, every step inspectable.

**Known ceilings.** File every deliberate simplification this build made as a `where | limit | revisit when` row - never a code comment - before the close: Read `references/known-ceilings.md` and file the rows by its procedure; the close report says how many rows it filed, or `none`.

## Example

Executing the records-list export plan (the `task-design` example, gated by `task-verify-plan` - three tasks, plus the audit's cancellation fix folded into Tasks 1-2):

- Task 1 - jump to the plan's query-seam anchor, add the export projection + its streaming test (rows streamed, never materialized - the card's trap), thread the cancellation token per the audit. Module tests green, output quoted. DONE.
- Task 2 - the streamed export entry point on the Task 1 seam, mapped to a transfer shape at the edge (the card's boundary trap). Tests green. DONE.
- Task 3 - integration test: header row, one data row, success status, and the audit's empty-set shape. Green on the full suite. DONE.
- Finish - full suite once, `task-verify-code` over the assembled diff (one finding: a stray debug log - fixed), done-gate run.

```text
task 1 export projection | DONE | module tests green (streamed, cancellation threaded)
task 2 streamed endpoint | DONE | tests green (edge maps to transfer shape)
task 3 integration test  | DONE | full suite green incl. empty-set shape
suite + verify-code: green, 1 finding fixed; nothing deferred
```

## Don't game it

The acceptance criterion is satisfied by behavior, never by weakening the test that checks it. A green gate means the commands ran and their output says green - quoted, not assumed. Never suppress a warning, stub a path, or narrow a test to advance to the next task; a task that cannot go green honestly goes back to design as a named delta.
