# Solve Task - step mechanics

Read by `alfred-task-solve` at step 3 APPROVE, before the approve ask is built; complete on its own.
The AUTO waiver is read before any step runs past a stop; the rest is applied at the step named:
the mode-fit rule (step 3), the APPROVAL stamp's write mechanics and lifetime (step 3 onward), the
agents-mode fan-out and the build bar (step 4), the reviewer-fit rule (the step-4 stop) and the
doc-drift surface list (step 6). The
step-3 stop's `Result:` line carries `mechanics: read` - the line that proves this file was loaded
this cycle, not remembered from an earlier one.

## Mode fit - the step-3 approve ask

Two build modes, the recommendation decided per plan, the reason in the option's description:

- **session** - `alfred-task-implement` runs the tasks in this chat. Fits when the tasks are few,
  serial, or one stack's.
- **agents** - each task card goes to its stack's `<stack>-implementer` seat, up to 3 at once,
  frontmatter models unless the user names one. Fits when the plan holds independent tasks that
  can build in parallel (the measured multi-slice exception: built inline, such a plan cost a
  multiple of its dispatched build).

A fixed default is not a recommendation. Agents mode exists only where subagent dispatch is
available; where it is not, the ask offers session only and says so.

## The APPROVAL stamp - writing it, and its lifetime

- **The waiver.** Only on an explicit no-stops ask ('run all recommended without asking me'): write `<docs-path>/flow/APPROVAL` with first line `AUTO - "<their words, verbatim>"`, say in
one line that stops are waived under it, and take each stop's recommended option; the pre-commit
checkpoint and its receipt still apply. Write the stamp at the ABSOLUTE path `${CLAUDE_PROJECT_DIR}/<docs-path>/flow/APPROVAL` with the Write tool. The stamp belongs to the session that dispatches - an earlier session's leftover stamp is not consent.
- `.claude/` is a protected path, so the first write in a session prompts: take the prompt's
  'allow Claude to edit its own settings for this session' option and the rest of the run is free.
  No settings key can pre-approve it - `permissions.allow` is not consulted for protected paths.
- A relative write follows whatever cwd the shell drifted to, and the dispatch then bounces
  because the guard reads the absolute path.
- If BOTH the Write tool and an absolute-path Bash write are refused by the harness's classifier,
  stop and put the choice through AskUserQuestion (retry the stamp, or run this stage inline)
  rather than retrying blind or dispatching around the gate.
- **Lifetime.** The AUTO stamp lives until step 6's close deletes it. Step 4's
  delete-when-fan-out-completes applies to per-plan APPROVED stamps, and a step-5 punch-list
  re-dispatch under AUTO rides the still-live waiver.

## Agents mode - the step-4 fan-out

Fan the plan's task cards out to the matching `<stack>-implementer` seats - a flat
fan-out, the main session the only orchestrator. Write the approval gate file first, quoting
this step's user approval verbatim - the dispatch hook blocks an unstamped implementer - and
DELETE it when the fan-out completes, before the step-5 stop: a stamp left live can silently
authorize an unrelated later dispatch for up to 8h. A red build/test routes per the
repair-agent rules; tick the same plan file per task as reports land. MINT the run's contract
version - `<the plan's Approved: date>-<plan slug>` - and put it in EVERY dispatch prompt
verbatim, with the seat's memory-handoff line spelled out:
`write_memory('<feature>__<contract_version>__<seat>__<task>', ...)`. Each seat's green gate
stays fast - build + fast tests, never integration replays or another minutes-long run; the
slow full run happens once, in this session, at the step-5 review / step-6 done-gate.

## The build bar - both modes

Both modes build to the bar `alfred-task-implement` and every `<stack>-implementer` seat carry - the
quality loop's five stages met on the first pass, comments carrying the why, each judgment call
decided against the codebase's precedent - and the plan's `## Decisions` ledger grows as they
land: appended directly in session mode, folded in from each seat's `decisions:` report lines as
its report lands in agents mode.

## Reviewer fit - the step-4 stop's recommendation

Three options, one recommended, reason stated:

- **'alfred-task-verify-code in-session'** - a routine diff: no dispatch, stays in this context.
- **'the stack's `<stack>-verifier` seat'** - the diff is large, trips a risk trigger (auth,
  migration, concurrency, security, a big refactor), or was built in this session and deserves
  eyes that did not write it; frontmatter model unless the user names one.
- **'skip'** - straight to step 6's done-gate; never the recommendation.

Whichever reviewer runs, its live probe is bounded: an in-process run through the real `Program`
counts as the end-to-end call, else ONE boot attempt and `NOT RUN - environment` (the protocol is
`alfred-task-verify-code`'s).

For a broad parallel sweep the user can still invoke `/code-review` themselves - it is not part of
this flow. The user can inspect the diff themselves at this stop before answering.

## Doc-drift surfaces - the step-6 close line

An architecture-critical surface, any one of which earns the close report's one-line pointer to
the architecture capture: a schema / EF migration, a new module or project, a moved boundary or
dependency direction, a changed cross-stack seam or eventing contract, a new external dependency.
