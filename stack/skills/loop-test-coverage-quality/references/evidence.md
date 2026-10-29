# Evidence appendix - the runs these coverage-loop rules were written from

An audit appendix, not a run-time load: read it when a rule in SKILL.md looks like ceremony, never
during a round.

- **The red-check runs before a flagged spec is rewritten (2. TRIAGE + FIX).** About 1 in 20 flags was
  false, caught only by this check.
- **The round verdict carries the fresh-session ask's receipt (4. LOOP or STOP).** The step-not-advice
  form alone was still skipped: one session ran rounds 4 and 5 inside the same 13h chat with only a
  prose question between them - 79.3M cache-read, against 9.4M for the round that owned a fresh
  session.
- **The close restates the purge receipt (4. LOOP or STOP).** Loop rounds measured 0 purges with the
  trio reference's rule unloaded.
- **The commit decision is an ask, never a prose bullet (4. LOOP or STOP).** Three 'your call' bullets
  in one session drifted unresolved for 5h while the uncommitted set grew 16 -> 23 files.
- **Each round boundary is a fresh-session point (Bounded and honest).** Carried-forward conversation,
  not tool output, dominates session cost - measured across the audited loop sessions.
- **The resume reads `## Resume` ranged (Bounded and honest).** Whole-file round-start reads cost
  ~15-16k tokens each on a grown doc, ~24% of it needed.
- **The resume loads the capture's protocol (Bounded and honest).** Two resumed rounds skipped it and
  reconciled by convention-copying instead.
