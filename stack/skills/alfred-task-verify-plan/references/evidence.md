# Evidence behind the plan-audit passes

An audit appendix, not a run-time load: the measurements the passes in `SKILL.md` were written
from. Read it when a pass looks like overhead and you want the number behind it, never as part of
a run.

## Existence (pass 3) - asserted existence is the most expensive defect class in the corpus

- An invented CSS design token, plus two wrong test predictions built on top of it, cost
  **2,663,771 tokens** to repair. Nothing in the plan named a token that did not exist; the plan
  named one and nobody opened the file it was supposed to live in.
- A false capability claim propagated through a DURABLE doc over six escalating hops -
  **790,759 tokens** of recovery - after being certified twice by a report that never checked it.
  A claim inside a committed doc is re-read by every later run, so a wrong one compounds where a
  wrong chat message does not.

Both are the same failure: a name asserted rather than looked up. The pass costs one
`find_symbol`, one config read, or one context7 lookup per named thing.

## Why the audit runs before the build, not after

A flawed plan built perfectly is still wrong, and the rework lands on code that already exists -
the diff, its tests and its review all have to be redone. The passes are ordered cheapest-first
for that reason: scope and existence before soundness, because a plan that fails either makes the
rest of the audit moot.
