# Quality-loop run rules

The standing policy the autonomous run holds from Pass 1 of the first file to the Final report: what
counts as a finding, how each one is resolved, and the honesty bars self-judgment cannot waive. Read
once per run (INNER LOOP, before Pass 1 of the first file) and again after a compaction or a
fresh-session resume; the Final report's References-read receipt records the read.

- Decide, do not ask. Every decision the work needs, you make - using the codebase's existing conventions as the tiebreaker - and record it.
- The findings gate - a candidate is a finding only when all four are answered explicitly: what breaks (the concrete wrong outcome - 'it differs from a preference, another codebase, or a reference doc' is not an answer); who notices, and when (named, with the trigger); is it actually new (behavior already recorded as a known limit or a prior decision is a re-measurement, not a discovery); has the project already decided it (a choice recorded in CLAUDE.md or the architecture docs is a **Deliberate tradeoff** - never re-raise it). A gate-passing defect is **Must fix**: it enters the open set. A true-but-not-actionable observation is **Worth knowing**: note it in the pass output, never in the open set - and never 'fix' it.
- Do not invent a finding to demonstrate diligence, and do not omit one to keep a pass short. `open: []` on pass 1 is a valid, expected result on healthy code - a stage that finds nothing is SATISFIED on pass 1, and reporting it is a success, not a weak audit. Equally, twenty real findings means the open set lists all twenty: PLATEAU and OSCILLATION are read off set identity across passes, so a truncated set silently breaks the stop conditions.
- 'Satisfied' means the explicit bar is met - not 'this looks fine' or 'good enough'. Show the score; it is the proof.
- List every remaining item before you stop a file. Never declare a file done with hidden open items.
- Every finding is resolved one way: fixed, decided-and-applied, marked out of scope, or could-not-apply with a reason. Nothing is silently dropped.
- Never weaken, skip, or delete a check, test, or assertion to make a bar appear met. If a fix would break a test, that is a finding, not a fix. The final gate's anti-gaming sweep checks the cumulative diff for exactly this.
- Make the smallest change that resolves each item. Avoid rewrites that introduce new findings - they make the loop diverge instead of converge.
- For gate-based files, the command is the bar - a passing command beats your opinion. Self-judgment is only the fallback for things no command can check, like naming or design quality.
- An enumerable finding class - one a grep or glob can list exhaustively (a banned API, a naming pattern, a suppression marker) - pairs the model audit with the deterministic scan and reconciles the two lists; a model-only sweep misses members.
- The main session is the only orchestrator - never instruct a subagent to dispatch another; the auditors and implementers this loop dispatches (domain verifiers, implementers, resolvers) carry no Agent tool. A stage needing a verdict and a fix is two dispatches from here, not one nested one.
