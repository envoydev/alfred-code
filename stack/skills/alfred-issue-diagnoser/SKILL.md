---
name: alfred-issue-diagnoser
description: "Use to investigate a failure of any kind in THIS chat, from whatever evidence you actually have - a pasted error-monitor event, one log file, several log sources at once, a red CI run, a stack trace, a screenshot, or nothing but a customer saying checkout is slow. Four gated steps: triage the evidence to a tier, gather (inline or evidence-gatherer seats), prove the root cause, then a user fork - write a report, plan the fix as contracted tasks, or add log points and re-run. Read-only throughout: it never writes the fix. Trigger on investigate this bug, diagnose this failure, what is causing this, triage this report. Not the fix build (alfred-task-solve takes the tasks from here), not a signature lookup you already have the answer for."
disable-model-invocation: true
---

# Diagnose Failure - one entry for any failure evidence

One reported failure, four steps, the user holding the gate between them. This skill owns the
chain, the stops, the evidence accounting and the fork; the catalogues and seats do the specialist
work. READ-ONLY throughout - no step writes code, so no approval stamp or commit gate applies.
`references/steps-in-full.md` carries every rule below unabridged.

## Evidence tiers

Tier 1 a stack trace or failing test, 2 a log window / red CI run / monitoring event, 3 written
repro steps, 4 a screenshot or a prose report; no source is a lower tier, never a blocker. The tier
is named first and qualifies the verdict last - a tier-4 conclusion is never presented with tier-1
confidence. Read `references/evidence-tiers.md` at step 1, before naming it.

## State - two layers

The findings file (`<docs-path>/diagnoses/<slug>.md`) is the durable truth - the observable, the
tier, the digests' key lines, the hypotheses, the proven cause, the stamps (`Tier`, `Gathered`,
`Cause`, `Outcome`). The navigation-server note `<slug>__diagnosis` is the cursor. **On invocation, resume before starting:** `list_memories` -> `read_memory` the note, read the file's stamps,
resume at the cursor - never re-run a stamped step.

## Mode - ask at start

When dispatch is available, ask ONE question before the evidence pass - unless a calling flow
already picked the mode, which is inherited:

```ask
Gather the evidence <inline | through the seats>: <what settles it - one grep, or a big or many-source pull>.
- 'Gather inline in this session (Recommended)' - a single command or a bounded grep settles it
- 'Gather through evidence-gatherer seats' - big or many sources; the raw volume never lands here
```

The mark moves to the seats when the evidence is BIG or MANY (a multi-megabyte log, three sources to
correlate). A declined ask is answered by re-asking, never by inference.

## The stop contract

A stop IS one AskUserQuestion call: one line of result and the artifact path, then the next move
through the tool - EVERY stop. Where the harness has no such tool, list the options in plain text
and END THE TURN. Past the install's fresh-session trigger for its window (150,000 tokens on a 200k window, 400,000 on a 1M one, 180,000 on any other window), or across hours, the
fresh-session resume IS one of every ask's options - resume needs only the findings file and the note.
**Every ask marks exactly one option `(Recommended)`, listed first**; an ask with no mark is
malformed. A step-done stop:

```ask
<Step> done - <findings path>. Continue to <next step>: <the one reason it is next>.
- '<Next step> (Recommended)' - <what it does, in one line>
- 'Gather more evidence' - <the source still missing>
- 'Resume in a fresh session' - required past the fresh-session trigger above
```

## The steps

Each step that names a catalogue INVOKES it via the Skill tool, again in a new cycle.

1. **TRIAGE** - read the evidence as it came, restate the failure as an OBSERVABLE (what happened,
   where, what should have), name the tier. Load the signature catalogue matching the failure's
   origin from YOUR skill list by what each covers - local-runtime crash signatures, or red-pipeline
   signatures - re-reading the list once before writing 'none installed'. A red pipeline leaves this
   skill: the CI diagnoser seat is this stop's recommended option. Write the findings file with the
   observable and `Tier: <n>`. *Stop.*
2. **GATHER** - per the mode: one evidence-gatherer per source, or bounded commands inline; correlate
   sources on a shared key and say which agreed. At tier 4 it is code-first: locate the behaviour
   through the navigation server and attempt a repro. Never slurp a large log - grep to the signal.
   Append the key lines, stamp `Gathered:`, *Stop* - never run straight into step 3.
3. **ROOT CAUSE** - the FIRST action is the `alfred-habits-root-cause` Skill call (skip only when it
   is in context); its hypothesis-and-test loop runs the step. **Hard cap: 2 investigation passes** -
   then record the surviving hypotheses RANKED with what would decide each. Stamp `Cause:` with the
   file + symbol and its proof, or `Cause: unproven - <n> hypotheses ranked`. It ends at the fork.
4. **THE FORK** - ONE question, the three real outcomes, proven recommending 4b and unproven moving
   the mark to 4c:

   ```ask
   The cause is <proven at file:symbol | unproven - N hypotheses ranked>. <Plan the fix | Instrument>: <why>.
   - 'Plan the fix as tasks (Recommended)' - the cards go into the findings file for /alfred-task-solve
   - 'Write a report on the issue' - a standalone document, no task cards
   - 'Add log points and re-run' - one card of log points, so the next occurrence arrives a tier higher
   ```

   Read `references/steps-in-full.md`'s step 4 before writing the branch picked - what a report
   carries, the task-card contract, the instrumentation card. Stamp `Outcome:`. A proven cause is a
   CLOSING point: the next phase starts in a FRESH session from the findings path, offered in this
   stop. *Stop* - after 4b the close names the build as the user's own command:

   ```ask
   The fix is planned in <findings path>. Build it from that file in a fresh session.
   - 'Build it: /alfred-task-solve <findings path> in a fresh session (Recommended)' - the file is the whole input
   - 'Stop here' - the findings file keeps the cause and the tasks
   ```

   The close carries anything pending; a sibling repo's fix is a task card under `<docs-path>/cross-project-tasks/`,
   never chat-only prose. Delete the cursor note; keep the signature-to-fix note for a proven cause.

## Do not

- Never pass a stop without the user's explicit word, or take the fork yourself.
- Never end a stop's turn without its AskUserQuestion (or the plain-text option list).
- Never write code, edit a file under test, or run a destructive repro (a migration against a real
  database, seeding or deleting tracked files, a commit) - a destructive-only repro says so and stops.
- Never report an unproven cause as the answer, and never claim a source you could not reach.
