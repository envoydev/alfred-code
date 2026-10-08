# Evidence appendix - the runs these rules were written from

An audit appendix, not a run-time load: read it when a rule in SKILL.md looks like ceremony, never
during a diagnosis.

- **Every ask marks exactly one option `(Recommended)`, listed first.** In pilot 3 both diagnose runs
  of the flow block asked with no mark, and the scripted approver took the first option each time.
- **Re-read the skill list before writing 'none installed' (step 1).** Measured: a listing held the
  local-runtime catalogue and the findings file still said 'none installed'.
- **GATHER ends on its own stop (step 2).** Measured: one run skipped this checkpoint and ran GATHER
  straight into ROOT CAUSE as a single 36-call stretch.
- **A proven cause is a closing point - recommend the fresh session (step 4).** Measured: a 17h15m
  diagnosis chat carried four auto-compactions, ~1.46M tokens dropped, while the findings file
  already held the history it re-sent - no `Stop` gate caught it, since that session never closed.
