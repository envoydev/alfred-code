# alfred-capture-architecture - evidence appendix

The measured anecdotes behind this skill's rules, kept out of the run-time body so every session stops paying
for them. Audit material: read it to learn WHY a rule is shaped the way it is, never to run the skill.

## Intro
- **a skill-level `model` pin applies only for the rest of the turn in which the skill activates** - measured: invocations ran on the session model, while agent-level pins in the same session held exactly; the documented turn scope is what the measurement shows, so the session model is the lever

## Execution modes
- **An interrupted or declined ask is answered by RE-ASKING, never by inference** - measured: one run took exactly that sequence as 'run it'
- **Zero drift is a complete run and exits HERE** - measured: a zero-drift run walked into the reference loads and the re-verification anyway, and the restart 13 seconds later paid all of it a second time
- **One `+dirty` escape hatch: the same uncommitted files still unchanged** - measured: one run proved exactly this and stayed inline correctly - the escalation is for a dirty set the diff CANNOT account for, not for the suffix itself

## 2. GATHER
- **A spilled digest: grep it, or Read it with an offset and a limit - never whole** - measured: one unranged Read of a spilled result cost ~10.5k tokens for a fact a single grep would have returned

## 3. AGGREGATE + REASON
- **Load the vocabulary you reason with by MATCHING it** - measured: a companion skill invoked by remembered name in a project whose installed set was different - the 'select a skill by DESCRIPTION, not by name' rule failing in the field exactly where it is written down
- **an ABSENCE as proven only from the source of truth** - measured: a wire frame 'had no field' by usage grep - the decompiled model carried it, unused

## 4. RE-GATHER
- **settle it with the cheapest deterministic probe in-session first** - measured: two digest conflicts settled by one command each, where a re-dispatch would have cost ~50k tokens and returned another opinion

## 5. WRITE
- **the queue is drained in ONE closing pass once every probe is done** - measured: verification that continued past the first write turned one doc into 6 extra patch passes and 1.02M tokens, each pass re-reading a doc that had grown since the last
- **Over target, run the spill pass NOW - this run owns the doc** - measured: a map grew 460 -> 738 lines across rounds because the capture declined to fix it and the loop's intake at the time read only the assessment

## 6. RULE
- **REPLACE it, never delete it** - measured: the `rm` this step used to mandate is denied by the auto-mode classifier, which costs exactly the blocked-call round-trip the delete was written to avoid
- **'~5 lines' is not a budget on its own** - measured: five 470-character lines satisfy it, which is how a shipped rule reached roughly 3x its intended weight

## 7. REPORT
- **`Vocabulary:` - the line is what makes the load happen** - measured: a run with no such report field loaded zero of them
- **`References:` - same receipt logic** - measured: one capture read neither of its own contract references and nothing surfaced the skip
- **shape a follow-up as a RESUME BLOCK** - measured: ~12.9k tokens across two correction rounds reinventing exactly that shape because the convention lived only in a skill this run never loads
- **End with a `Model:` line, UNCONDITIONALLY** - measured both ways: 35 turns of an unrelated command rode Opus after a capture that closed with no such line, and a later capture's line credited the skill's own pin for a session that had been on Opus since message 1 and then declared no reset needed

## Don't game it
- **counts are the measured failure mode, and a too-clean look is not the trigger** - measured: 3 of 8 digests in one capture carried a wrong count and NONE looked suspicious; the doc's own history was 22 corrections, mostly counts and line refs
