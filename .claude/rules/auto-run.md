# Load auto-run when the user is away

- When the user says they are away or gone, or to run 'without stopping', 'without asking me', in 'auto mode', or to take the recommended options, load the `auto-run` skill BEFORE the first step - even when the work looks like it will need no ask. Why: its description alone did not fire on 'I am away - run the lint fixes one by one without stopping' (two probes, 2026-10-27), and the user should not have to name it.
- Before a session's first ask or review handoff, run `node .claude/kit/settings.mjs` once: `auto_run: on` is the user's standing default for this project (`KIT_AUTO_RUN=on` in their own settings), so load `auto-run` and say it is on from the settings. Skip it once the user's words in this session turned the mode on or off.
- After a compaction, Read the run ledger's `Auto-run:` line before the next ask: it is how the mode outlives the summary.
