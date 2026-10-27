# Load auto-run when the user is away

- When the user says they are away or gone, or to run 'without stopping', 'without asking me', in 'auto mode', or to take the recommended options, load the `auto-run` skill BEFORE the first step - even when the work looks like it will need no ask. Why: its description alone did not fire on 'I am away - run the lint fixes one by one without stopping' (two probes, 2026-10-27), and the user should not have to name it.
- After a compaction, Read the run ledger's `Auto-run:` line before the next ask: it is how the mode outlives the summary.
