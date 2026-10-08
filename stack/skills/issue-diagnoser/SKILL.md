---
name: issue-diagnoser
description: "Use when a failure needs investigating - an error event, logs, red CI, a stack trace, 'what is causing this'. Not for the fix, which /task-solve owns."
disable-model-invocation: true
---

# Diagnose Failure - one entry for any failure evidence

One reported failure, four steps, the user holds the gate between them. This skill owns the
chain, the stops, the evidence accounting, and the fork at the end; the catalogues and the
seats do the specialist work. It is READ-ONLY from start to finish - no step here writes code,
so no approval stamp and no commit gate come into play. The measurements behind these rules live in
`references/evidence.md` - an audit appendix, not a run-time load.

## When to use

- Evidence can be a pasted error-monitor event, one log file, several log sources at once, a red CI run, a stack trace, a screenshot, or nothing but a customer saying checkout is slow.
- Four gated steps: triage the evidence to a tier, gather (inline or evidence-gatherer seats), prove the root cause, then a user fork - write a report, plan the fix as contracted tasks, or add log points and re-run.
- Read-only throughout: it never writes the fix.
- Not the fix build (task-solve takes the tasks from here), not a signature lookup you already have the answer for.

## Evidence tiers - name the tier, carry it as the confidence label

The tier is the first thing this skill establishes and the last thing its verdict is qualified
by - tier 1 a stack trace or failing test, 2 a log window / red CI run / monitoring event, 3
written repro steps, 4 a screenshot or a prose report. No source is a lower tier, never a
blocker. A tier-4 report is the DEFAULT case, not an edge case, and a conclusion drawn there is
labelled as such, never presented with tier-1 confidence.

`references/evidence-tiers.md` carries the table (what each tier buys, and the code-first path a
tier-4 report takes) plus what this skill can and cannot reach - files, logs, the repo history,
the app itself, `gh` and an error-monitoring MCP where the project has one, and never a LINK.
Read it at step 1, before the tier is named.

## State - two layers, split by durability

- **The findings file** (`<docs-path>/diagnoses/<slug>.md`) is the durable truth: the failure as
  an observable, the evidence tier, every digest's key lines, the hypotheses with their verdicts,
  the proven cause, and the stamps this run adds (`Tier`, `Gathered`, `Cause`, `Outcome`). On any
  conflict with memory or the chat, the file wins.
- **The navigation-server note** (`write_memory` named `<slug>/diagnosis`) is the working cursor: current
  step, chosen mode, resume pointer, the error signature and its proven fix once found - that
  last part is the reusable half, keyed to the signature, never a dump of the log.

**On invocation, resume before starting:** `list_memories` -> `read_memory` the slug's note (or
an equivalent direct read of `<data root>/serena/memories/`, `.alfred` by default) and read the findings file's stamps. A run
mid-flight resumes at its cursor - never re-run a step already stamped. A run between steps 2
and 3 looks like:

```
findings <docs-path>/diagnoses/orders-sync-disposed.md:
  Observable: nightly order sync stops after the first batch; expected all batches
  Tier: 1 (ObjectDisposedException, frame OrderSyncJob.ExecuteAsync) | Gathered: 2 sources agree
  Cause: <pending>
note 'orders-sync-disposed/diagnosis': step 3 ROOT CAUSE - mode inline, 1 hypothesis open
```

## Mode - ask at start

When dispatch is available, ask ONE question before the evidence pass - unless a calling flow
already picked the run's mode, which is inherited, never re-asked:

```ask
Gather the evidence <inline | through the seats>: <what settles it - one grep, or a big or many-source pull>.
- 'Gather inline in this session (Recommended)' - a single command or a bounded grep settles it
- 'Gather through evidence-gatherer seats' - big or many sources; the raw volume never lands here
```

The mark moves to the seats when the evidence is BIG or MANY (a multi-megabyte log, a CI dump,
three sources to correlate): the whole point of that seat is that the raw volume never lands in
this context. An interrupted or declined ask is answered by RE-ASKING, never by inference.

## The stop contract

A stop IS one AskUserQuestion call: report one line of result and the artifact path, then put
the next move through the AskUserQuestion tool - EVERY stop, the plain step-done ones included.
There is no non-decision stop: 'what happens next' is itself the decision. The options are
concrete - the next step named, the route-back where a step surfaced gaps, the fresh-session
resume on a long run - the recommendation marked per that stop's own rule, free text always
available via the built-in Other. Where the harness has no such tool, list the same options in
plain text and END THE TURN. The selected answer is the go; silence is not, and a stop that
only narrates is not a stop. Once the run has crossed the install's fresh-session trigger for its
context window (150,000 tokens on a 200k window, 400,000 on a 1M one, 300,000 on any other
window) or spans hours, the fresh-session resume IS one of the next ask's options - a CONSTRUCTION check before
emitting each stop, not a memory: resume needs only the findings file plus the note.

**Every ask marks exactly one option `(Recommended)`, listed first** - the move this stop's rule
recommends, the reason in its description; an ask with no mark is malformed, rebuild it before
sending - an unmarked ask gets its first option taken whatever it says. A step-done stop:

```ask
<Step> done - <findings path>. Continue to <next step>: <the one reason it is next>.
- '<Next step> (Recommended)' - <what it does, in one line>
- 'Gather more evidence' - <the source still missing>
- 'Resume in a fresh session' - required past the fresh-session trigger above
```

## The steps

Each step that names a catalogue INVOKES it via the Skill tool - and re-invokes it in a new
cycle in the same chat, even when an earlier cycle already loaded it.

1. **TRIAGE** - read the evidence in whatever form it arrived (`Read` opens a screenshot as
   readily as a log), restate the failure as an OBSERVABLE - what happened, where, what should
   have happened instead - and name the tier, per `references/evidence-tiers.md`. Then load the signature
   catalogue that matches the failure's origin, matched from YOUR skill list by what each skill
   says it covers, never by a remembered name: the one covering local-runtime crash signatures
   (null-reference, DI resolution, async deadlock, race, disposed lifecycle, config drift) for a
   failure on your own machine, the one covering red-pipeline signatures (compile/restore,
   green-locally-red-on-the-runner, quality gate, signing, workflow drift, infra flake) for a
   red CI run. **Before writing 'none installed': re-read the skill list text once more end to end
   for a description match** - a catalogue present in that list and skipped is the measured failure
   this line exists to catch. Only when that recheck comes back empty does this project have
   no such catalogue - say so and proceed on the method alone. **A red pipeline is the one route that leaves this skill:** CI
   needs the `gh` log pull and the CI-versus-local environment delta, which is
   issue-diagnoser-ci's specialty - offer that dispatch as the recommended option at this
   stop rather than re-deriving it here. Write the findings file with the observable and
   `Tier: <n>`. *Stop.*
2. **GATHER** - per the mode: dispatch one evidence-gatherer per source (reproduce this path,
   pull and grep that log window, capture that screen) exactly as the roster spells it (`alfred-code:<seat>` where the core plugin carries it), several in parallel when several
   hypotheses need confirming, and reason over the compact digests they return; or run the
   bounded commands inline. Correlate multiple sources on a shared key - a correlation/trace id,
   a timestamp window, a release version - and say which sources agreed and which did not. At
   tier 4, with no source to pull, this step is code-first instead: locate the named behaviour
   with the navigation server per `.claude/rules/alfred-navigation.md`, read the paths that could produce the
   symptom, and attempt a repro. Never slurp a large log into this context - grep to the signal
   and quote a bounded window. If it cannot be reproduced, say so with what you tried, and work
   from the evidence and the code. Append the digests' key lines to the findings file, stamp
   `Gathered:`, then stop - put 'continue to root cause?' through the AskUserQuestion tool per
   'The stop contract' above (the stop hook already enforces the call).
3. **ROOT CAUSE** - the FIRST action of this step is the `habits-root-cause` Skill call,
   before the first hypothesis (skip it only when that skill is already in context): its
   hypothesis-and-test loop runs the whole step - hypotheses first, each one confirmed or killed
   against the code. Form the fewest hypotheses the evidence supports, then
   confirm or kill each against the located code and the reproduction - root cause before
   symptom, never a plausible guess. Match the evidence to the catalogue's signature and isolate
   where the signature points, which is almost never the line that threw. **Hard cap: 2
   investigation passes.** If the cause stays ambiguous after 2, stop guessing and record the
   surviving hypotheses RANKED with what would decide between each. Stamp `Cause:` with the
   file + symbol and the evidence that proves it, or `Cause: unproven - <n> hypotheses ranked`.
   Report a severity and an explicit P0-P3 priority when the ask was to level it rather than fix
   it. **This step ends at the fork below - it never continues into planning on its own.**
4. **THE FORK** - the step-3 stop asks ONE question whose options are the three real outcomes,
   each named concretely. The recommendation is set by whether step 3 actually proved a cause -
   proven recommends 4b, unproven moves the mark to 4c - with the reason in the option's description:

   ```ask
   The cause is <proven at file:symbol | unproven - N hypotheses ranked>. <Plan the fix | Instrument>: <why>.
   - 'Plan the fix as tasks (Recommended)' - the cards go into the findings file for /task-solve
   - 'Write a report on the issue' - a standalone document, no task cards
   - 'Add log points and re-run' - one card of log points, so the next occurrence arrives a tier higher
   ```

   - **4a. REPORT** ('Write a report on the issue') - finish the findings file as a standalone
     document: the observable, the evidence tier, the proven cause with its located symbol, the
     blast radius and who it affects, severity + priority, and what a fix would have to change.
     No task cards. This is the outcome when the fix is someone else's, or not now.
   - **4b. PLAN TASKS** ('Plan the fix as tasks') - first load `habits-execution-strategy` (the Skill
     tool) over the minimal change: how the fix runs, not only what it changes. Its `Execution:` line sets the cards' split -
     units it found parallel-safe become separate cards, units that share a file or need another's
     output stay one card or are ordered - and is stated beside the close's ask, never written into
     the findings file (task-solve decides the build mode again on the gated plan).
     Then decompose the minimal change per cause into tasks on that split, each with a contract: the files it owns, what it must not touch, its
     acceptance criterion, and the `log_points` the fix must leave behind at the seam that
     failed. Name the target stack per task. The cards go into the findings file under a
     `## Tasks` heading - the file is the handoff, not the chat. The build is the user's next
     step, never yours: the close-out names `/task-solve` with the findings path as its
     input (it is slash-only - a model Skill call is refused - and its DESIGN step turns these
     cards into the gated plan). If the real fix is a redesign rather than a targeted change,
     say so and make that stack's solution-designer the option's route instead of planning it
     here; if it would change a shared contract, mark it BLOCKED_CONTRACT_CHANGE rather than
     planning a silent edit.
   - **4c. INSTRUMENT** ('Add log points and re-run') - the outcome that turns 'no evidence' into
     work instead of a guess: ONE task card carrying only the log points to add at the suspect
     seam - the exact symbols, the levels, and the identifiers each line must carry - so the next
     occurrence arrives one tier higher. Name the hypothesis each line is there to decide.
   Stamp `Outcome:` with the branch taken. **A proven cause is a CLOSING point, not a midpoint:**
   the findings file is durable and self-contained by construction, so whatever the fork picked,
   the next phase - writing the report, building the tasks, reading the new logs - starts in a
   FRESH session resumed from that path, and this stop offers it as an option in its own words
   ('resume from `<findings path>` in a fresh session'). Recommend it once the chat has run for
   hours or past that same trigger - no `Stop` gate catches a session that never closes.
   *Stop* - after 4b the close names the build as the user's own command:

   ```ask
   The fix is planned in <findings path>. Build it from that file in a fresh session.
   - 'Build it: /task-solve <findings path> in a fresh session (Recommended)' - the file is the whole input
   - 'Stop here' - the findings file keeps the cause and the tasks
   ```

   This close-out stop carries anything
   pending: an unwritten task card, a source the user still has to paste, a sibling repo that
   needs the same fix (that handoff is a FILE - a task card under `<docs-path>/cross-project-tasks/`
   - never chat-only prose). Delete the navigation server cursor note; keep the signature-to-fix note if the
   cause was proven, that is the reusable half.

## Do not

- Never pass a stop without the user's explicit word, and never take the fork yourself - step 4
  runs the branch the USER picked, and 'obviously they want the fix' is not an answer.
- Never end a stop's turn without its AskUserQuestion (or the plain-text fallback's option list).
- Never write code, edit a file under test, or run a destructive repro - one that applies a
  migration against a real database, seeds or deletes tracked files, or commits. If the only
  repro is destructive, say so and stop.
- Never present a tier-3 or tier-4 conclusion with tier-1 confidence, and never report a cause
  you did not prove as the answer - an honest 'unproven, here is what would decide it' with the
  4c instrumentation card beats a plausible guess that sends the fix at the wrong symbol.
- Never state a source was checked that you could not reach - an unfetchable link, an absent
  monitoring MCP, and a log the project does not retain are each named, not silently skipped.
- Never keep run state only in chat: a stamp that is not in the findings file does not exist.
