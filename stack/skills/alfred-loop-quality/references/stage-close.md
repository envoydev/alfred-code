# Stage close and resume - the fresh-session handoff

Read at every stage close (a file's inner loop reached its STOP and another stage remains), at a
forced MID-STAGE pause (a pass done, FIX not started, the chat too heavy to continue well), and FIRST
THING in a resumed session. The ask itself lives in SKILL.md; this file is the shape of what you write
before it and what the next session does with it.

## Before the ask - write the handoff, then ask

Write first, ask second: the ask ends the turn, and a turn that ends with the handoff unwritten leaves
the next session nothing to start from.

1. `<LOOP_DIR>/RUN-STATE.md` - an un-numbered file (the run order sorts on a leading integer, so it is
   never mistaken for a stage), rewritten as a LEAN digest: the run parameters (LOOP_DIR, TARGET, BAR,
   MAX_PASSES, the mode-ask answer), the GREEN BASELINE sha recorded at DISCOVERY, ONE outcome line per
   finished file, only the still-open items, and a `Next:` section naming the next stage file. Nothing
   else - the per-decision rationale is not carryover.
2. `<LOOP_DIR>/DECISIONS.md` - the full per-decision rationale appends here, in either mode, as each
   call lands. It is a side file: no resume reads it whole.
3. Then the AskUserQuestion: continue in a fresh session from the loops folder (recommended) vs
   continue here. Append `continue: <fresh|here> - "<answer>"` to the finished file's outcome line
   before the next stage's first audit or dispatch runs.

## On 'fresh' - the RESUME BLOCK

End the turn with a RESUME BLOCK the new session can start from alone, and nothing else - no 'one more
step', no new work in this chat:

- the exact invocation, naming `RUN-STATE.md` and the next stage number;
- one line on what that stage will do.

## The resumed session

1. Read this file, then `RUN-STATE.md` - offset-scoped to the run parameters plus the latest stage
   when the file is long. Never `DECISIONS.md` whole.
2. The `0.`-numbered standing-guidance file binds every FIX step, so read it again before the first
   FIX - DISCOVERY's own rule re-reads it after a compaction or a per-module split, and a resume is
   the same loss of context.
3. Re-confirm the green baseline BEFORE the first dispatch or edit: a sha-identity diff against the
   recorded baseline sha plus the build, at minimum.
4. When the carried mode is DELEGATED, write the approval stamp again before the first FIX dispatch -
   the stamp belongs to the session that dispatches, and the previous session deleted its own
   (`references/delegated-mode.md`, 'The approval stamp').
5. Run the next stage from its first pass. The final anti-gaming sweep diffs against the sha recorded
   at DISCOVERY, carried in the digest - the cumulative diff is what the sweep exists to read.
