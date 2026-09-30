---
name: alfred-task-implement
description: "Use to build a task plan in this chat, task by task - 'execute the plan', 'build the plan', 'implement task 2'. Not for ad-hoc edits or the full gated cycle."
---

# Project Implementer - execute a verified plan, task by task, in one chat

This is the build step of the single-session vertical: `alfred-task-design` produced the plan, `alfred-task-verify-plan` audited it, this executes it - one task at a time, in the plan's dependency order, in your context so every diff is inspectable as it lands. It carries the implementer seat's *execution protocol* only; the coding conventions themselves need no restating - the path-scoped rules auto-attach the house skill per file type, the generated path-scoped project-code-style rule attaches the project's actual style on any matching file touch, and the plan's task cards name the stack traps.

The measurements behind these rules live in `references/evidence.md` - an audit appendix, not a run-time load.

The plan FILE is the whole input - not the chat that produced it. Run this in a fresh session (or `/clear` between tasks) and the context stays at plan size instead of dragging the design run forward with every call - in a long build that carried conversation, not the tools, is the dominant token cost; the per-task ticks below make any task boundary a safe resume point.

## When to use

- You have a task plan and want to build it in this chat: it honors each task's contract, writes code + tests, gates each task green before the next, then hands to the build review.
- Not for a plan-less ad-hoc edit, or the whole gated cycle from design to done (/alfred-task-solve).

## Build mode - this chat or the implementer seats

1. **Pick the mode.** When the invocation names no mode and no calling flow has already recorded one (`alfred-task-solve`'s `mode <session|agents>` approval line, an orchestrator's brief), ask ONE question before building, via AskUserQuestion - this chat, or the implementer seats? - and hold the answer; a mode the run already picked is inherited, never re-asked.
2. **Build.** In-chat: build in this chat, the protocol below. On an agents answer: dispatch each task to its `<stack>-implementer` seat instead, exactly as the roster spells it (`alfred-code:<seat>` where the core plugin carries it) - up to 3 at once, each on its frontmatter model unless you name one.
3. **Stamp the approval before the first dispatch.** `<docs-path>/flow/APPROVAL`, first line `APPROVED <plan id> - "<the user's words, verbatim>"` on their explicit approval, or `AUTO - "<their words, verbatim>"` only on a literal no-stops ask; the dispatch hook blocks an unstamped implementer; delete the file when the run completes. Write the stamp at the ABSOLUTE path `${CLAUDE_PROJECT_DIR}/<docs-path>/flow/APPROVAL` with the Write tool. Only where the docs root still sits under `.claude/` (the old `.claude/docs` default, kept) is the write protected: a prompt for it offers 'Yes, and allow Claude to edit files in this project's .claude folder for this session' - take that, since `permissions.allow` cannot pre-approve it. A relative write follows whatever cwd the shell drifted to and the dispatch then bounces. The stamp belongs to the session that dispatches - written when its own decision lands, deleted at its own close; an earlier session's leftover stamp is not consent.
4. **If the stamp is refused, ask - never dispatch around it.** If BOTH the Write tool and an absolute-path Bash write are refused by the harness's classifier, stop and put the choice through AskUserQuestion (retry the stamp, or run this stage inline) rather than retrying blind or dispatching around the gate.
5. **Stay the only orchestrator.** Keep the main session the only orchestrator, routing a red per the repair-agent rules, and ticking the plan file as reports land - and each seat's gate is build + fast tests only, never a minutes-long run like integration replays or an E2E pass; the full suite stays with this session's finish step. Dispatch nothing you were not asked to.
6. **No plan approval line, one ask before task 1.** The approval is the calling flow's too - and a plan file that carries no `Approved:` line when this skill is invoked on its own gets ONE approval AskUserQuestion before task 1, its answer written to the plan as `Approved: <date> - "<the user's words, verbatim>"`.

## The protocol - per task, in plan order

Before reading the plan, load `alfred-habits-plan-writing` (the Skill tool) - the card fields and status marks below are its shape - and `alfred-habits-test-first`, the loop every card's `test:` runs on.

1. **Take exactly one task.** Its card is the contract: the files it owns, the traps it names, the `file:symbol` anchors, the `test:` it writes first, and its acceptance criterion. When the plan lives in a file (it should - `alfred-task-design` writes it to `<docs-path>/superpowers/plans/`), mark the task `IN_PROGRESS` there before touching code. Jump to the anchors - the designer already located them; do not re-navigate the repo.
2. **Build the slice + its tests together.** The acceptance criterion is what the tests prove; a task without its test is not built, it is drafted. The card's `test:` comes first, by `alfred-habits-test-first` - its red, a run that failed on the assertion the criterion names, is the only red that counts. The card's `log_points` go in with the slice, through the repo's logging seam at the level and with the identifiers the card names - never left for a later pass, never a second logger. Every line meets 'The bar I build to' - structure, quality, naming, comments - and every judgment call lands with its precedent. Stay inside the task's boundary - a needed change outside it is a flag, not a detour (see below).
3. **Gate the task green.** Build + the relevant tests after each task, not at the end of the plan. Resolve every red INLINE in this session - keep the fix loop here, quoting each build/test run so every attempt stays inspectable; the in-chat build dispatches nothing. The loop is bounded the way the resolver seats' is: after the FIFTH red run of one task's gate the next act is ONE AskUserQuestion - keep fixing inline / a resolver seat / stop - never a sixth run. Load the stack's convention skills for the trap list when the red points at one. (To offload a large, noisy fix loop to a specialist resolver seat instead, that is the dispatched multi-agent `alfred-task-solve-cross`; this single-chat skill stays inline.)
4. **Close the task honestly** - the per-task completion gate (`alfred-habits-done-gate`, loaded before the first task closes - run the acceptance command and quote its output before any done word): run it, then tick the task `DONE` with its evidence line - the acceptance command's own quoted output - in the plan file, append the task's judgment calls to the plan's `## Decisions` ledger (choice + precedent, per the bar), and refresh the plan's one-line resume note (next task + any mid-task state). The file, not the chat, is what a compacted or fresh session resumes from - it must never be more than one task stale. Then the next task. Partial is stated as partial. A task whose acceptance criterion is a RUN that has not happened yet - an integration pass, a manual try, a suite the gate deferred - stays `IN_PROGRESS` with a `needs: <the run>` line; 'code complete, builds' is not DONE. A task stamped `FAILED` ends the turn with ONE AskUserQuestion - continue inline / resolver seat / stop / revert - before any further run or edit: a 'reported to the user' line in the plan with no ask behind it is the measured failure.

## The bar I build to

The review-and-fix loop's five stages - structure, code quality, naming, logging, comments - are the bar the built slice meets on the FIRST pass, so a later loop over this code finds nothing. Hold each as you write, not as a pass afterwards. `references/build-bar.md` carries the five rung by rung - Read it before the first task of a plan, and again at any task whose card names a stage this run has not applied yet:

- **Structure** - a new file lands where the repo's best-organized module puts that kind of file, in the folder the task card names; never a dump folder, never a folder for one file.
- **Code quality** - the seven decision-level rules the plan settled apply to every line you add, and the line-level list in the reference applies with them.
- **Naming** - the repo's own vocabulary and casing for every identifier, one name per concept; no `data` / `info` / `manager` / `helper` where a specific word exists.
- **Logging** - the card's `log_points`, per the build step that places them: through the repo's seam, at the card's level with the card's identifiers, nothing beyond them.
- **Comments** - the always-on quality-gates rule's comments line, made concrete at write time. A checkable claim in a comment (a symbol, a count, an invariant) is true against the code you wrote; an existing comment your edit made stale is fixed in the same edit.

**A model change never leaves its task without its migration** - generated by the tool, or hand-written when the tool cannot run here. A schema model with no migration fails every integration test at boot (EF: `PendingModelChangesWarning`).

**Decisions.** A judgment call the card left open - two idiomatic shapes, a placement, a name at a seam - is decided here, never bounced back: pick the option most consistent with the codebase's existing patterns and record it as `the choice - precedent: <file:symbol or named rule>`, or `no precedent - <reason>` said explicitly and still decided. In-chat, append it to the plan file's `## Decisions` ledger; a dispatched seat reports it as `decisions:` lines for the orchestrator to fold in, never editing the shared plan file itself (siblings build in parallel). A bounce (an in-chat ask, a seat's NEEDS_CONTEXT) is for a user-level requirement or scope beyond the card, never for a how-to-build call.

**Reuse before recreation.** Before new code, stop at the first rung that holds: the stdlib, runtime or framework already does it; an existing helper in this repo or an already-referenced package does it (search first - a second copy is a defect, consolidate to the existing seam); it is one line; only then the minimum code that works. Less code that still works - never the flimsier algorithm, never at the cost of validation at a trust boundary, error handling that prevents data loss, or secret handling.

**Callers first on a bug fix.** Before changing a function to fix a bug, list its callers (the navigation server's `find_referencing_symbols`) and fix once where they all route through - a guard on only the reported path leaves every sibling caller broken, and one guard in the shared function is also the smaller diff.

## When the plan meets reality

- **A task proves wrong mid-build** (the seam isn't where the plan said, a trap the audit missed): stop the task and name the delta - never silently redesign while implementing. The re-entry is the USER's call on the FIRST occurrence, not a counter you spend: end the turn with ONE AskUserQuestion - re-design this slice with `alfred-task-design` (recommended, the delta named in the option) / continue against the delta as it stands / stop the build here (plain-text options where the harness lacks the tool) - and re-enter only on that answer. The plan is the contract; reality wins, but through a revision, not a drift.
- **A tool the environment blocks** (a generator hanging on denied egress, a command the sandbox refuses): the task still finishes in this session - take the in-session route before any ask. For an EF migration: `dotnet ef migrations add <Name>` with `--project` AND `--startup-project` both set to the project holding the design-time DbContext factory - the tools take that factory first and boot no host; failing that, hand-write the migration and its model-snapshot change from the nearest prior migration. Only a task with no in-session route becomes a blocker ask, and that ask recommends the route - never 'retry the same command' or 'you run it'.
- **Scope beyond the plan** (a bug discovered nearby, a refactor itch): flag it and put the call through AskUserQuestion - add it to the plan vs leave it for later (plain-text options where the harness lacks the tool). Never rides along. The same ask covers a bug reported AFTER a cycle stamped COMPLETE or outside any active cycle - fix now ad hoc vs open a new cycle vs defer.
- **A shared contract surfaces** (a DTO both sides compile against, a schema semantic): stop - that is `alfred-task-solve-cross` territory, the same BLOCKED_CONTRACT_CHANGE discipline the dispatched seats follow.

## Finish - the in-session verifier

All tasks green: run the full suite once, then review the assembled diff against the plan - your choice of reviewer: `alfred-task-verify-code` (inline, dispatches nothing - the single-chat form of the verifier seat) or the `<stack>-verifier` seat (dispatched, isolated, on its frontmatter model unless you name one) - pointed at the plan file so it reviews against the plan, not in isolation, and apply its findings; then the done-gate on the whole feature. Report against the plan, one line per task - `task | status (DONE / deferred / revised) | evidence (the green command and what it proved)` - then the suite + the review result, the `## Decisions` ledger by its entry count (never re-pasted), and anything deferred or revised with its reason. The vertical is complete: design (`alfred-task-design`) -> audit (`alfred-task-verify-plan`) -> build (this) -> review (`alfred-task-verify-code` / `<stack>-verifier`) - one session, every step inspectable.

**Known ceilings.** File every deliberate simplification this build made - a `where | limit | revisit when` row, never a code comment - before the close: `node .claude/hooks/docs.js show architecture/ARCHITECTURE.md#known-ceilings` for the rows already there and `docs.js hash` of the same ref (both report it absent the first time), then pipe the whole section - `## Known ceilings`, a `<!-- covers: -->` line naming every row's file, the table with the new rows appended - into `docs.js set architecture/ARCHITECTURE.md#known-ceilings --expect <that hash>` (no `--expect` the first time). The covers line makes `docs.js where` show the ceiling to the next session on that code, and `docs.js stale` flag it once the code moves. No `architecture/` under the docs root: the rows stay in the close report, and the close says so.

## Example

Executing the records-list export plan (the `alfred-task-design` example, gated by `alfred-task-verify-plan` - three tasks, plus the audit's cancellation fix folded into Tasks 1-2):

- Task 1 - jump to the plan's query-seam anchor, add the export projection + its streaming test (rows streamed, never materialized - the card's trap), thread the cancellation token per the audit. Module tests green, output quoted. DONE.
- Task 2 - the streamed export entry point on the Task 1 seam, mapped to a transfer shape at the edge (the card's boundary trap). Tests green. DONE.
- Task 3 - integration test: header row, one data row, success status, and the audit's empty-set shape. Green on the full suite. DONE.
- Finish - full suite once, `alfred-task-verify-code` over the assembled diff (one finding: a stray debug log - fixed), done-gate run.

```text
task 1 export projection | DONE | module tests green (streamed, cancellation threaded)
task 2 streamed endpoint | DONE | tests green (edge maps to transfer shape)
task 3 integration test  | DONE | full suite green incl. empty-set shape
suite + verify-code: green, 1 finding fixed; nothing deferred
```

## Don't game it

The acceptance criterion is satisfied by behavior, never by weakening the test that checks it. A green gate means the commands ran and their output says green - quoted, not assumed. Never suppress a warning, stub a path, or narrow a test to advance to the next task; a task that cannot go green honestly goes back to design as a named delta.
