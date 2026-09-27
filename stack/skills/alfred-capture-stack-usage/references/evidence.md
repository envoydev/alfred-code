# alfred-capture-stack-usage - evidence appendix

The measured anecdotes behind this skill's rules, kept out of the run-time body so every session stops paying
for them. Audit material: read it to learn WHY a rule is shaped the way it is, never to run the skill.

## Intro and inputs
- **Run the audit from a FRESH session** - measured: an in-session run at ~620k accumulated context paid six 529-retry re-sends (629k cache-write for 11 messages) for a report a fresh session produces from ~20k.
- **The batch is BOUNDED at 12 bundles per run** - measured: two runs took 45 and 53 bundles in one chat for 42.1M and 78.2M cache-read and 2 and 4 forced compactions, because the biggest scope was the one marked Recommended.

## Step 1 - FIND
- **Never pick a scope yourself and never default to the current session** - measured: one run picked 'two sessions' unasked from its own tail, another started analyzing the current session with no ask - the prose form of this step was skipped both times; the tool call is the step.
- **never audit the live session's own tail** - measured: four sessions did, one burning its whole 529-retry budget over 44 minutes and shipping a bundle that undercounts its own tail - the prose rule alone did not hold, this check is the gate.
- **The folder alone is not the test** - measured: the folder becomes true at the SKELETON write, up to 74 minutes before the report is authored, so a run resumed after an interruption would have skipped all 53 of its own unfinished bundles as done.

## Step 2 - GET
- **Run these as SEPARATE simple commands, not a piped one-liner** - measured three times: two runs fell back after a denied pipe; one lost 17 minutes - a quarter of its session - to the resulting cold clone.
- **Only the PIPE half of that rule holds** - measured: one sweep carried a loop in 69 of its 141 calls, because a per-session command times N sessions is N calls - the clause that banned loops was unfollowable at real scope.

## Step 3 - RUN
- **Test for the ledgers, never assert their absence** - measured: all 53 reports in one sweep shipped `Hook ledger | absent` from a prose instruction nobody executed, and 26 of them were reworked at the end of the run for 6,222,488 cache-read - 8.0% of that session.
- **add `--hook-blocks <that file>` - the session's OWN file** - measured: pointing the flag at the shared folder charged one session with eight sessions' blocks - 28 reported against its own 1; the tool now narrows a directory to `<session-id>.jsonl`.

## Step 4 - WRITE
- **the analyzer's tables stay UNTOUCHED** - measured: 5 wrong claims across 4 hand-written reports, each a prose restatement of tool output.
- **judged against the Peak context row, never the average** - measured: a report judged a `[1m]` session against the 150k floor - the conclusion survived, the number did not.
- **A run that ends with no Write, no Edit and no answer is ABANDONED** - measured: a report scored a run 'complete' where 47 tool calls carried zero Write/Edit and the second invocation produced nothing at all.
- **Each row carries the `tool_use_id` it was measured from** - measured: a report blamed a plugin listing for a spill whose `<persisted-output>` marker sits on the frontmatter loop's own result.
- **report it as bleed and never charge it to the skill** - measured: 223 verifier msgs / 31.3M cache-read once landed on a plugin-update command that dispatches nothing.
- **Guard blocks - a required fill, not a section to pass through** - measured: the skeleton's 'EITHER no guard fired OR the ledger was never written' line shipped verbatim, unanswered, in audited bundles because no step required an answer.
- **A duplicate-CALL row quotes the first result's TAIL** - measured: a top waste row charged a re-listing where the first result stopped at 1,252 chars mid-entry and was missing six of the entries.
- **Read the ACTIVE skill's own protocol before charging a skill load** - measured: one waste pass charged both in the same report - a step-3 companion load and the ORIENT read the same skill mandates.
- **A batch that returned nothing usable is waste too** - measured: a report found 'nothing' against the catalog while 21% of the session went to 11 empty greps.
- **A `<persisted-output>` result is NOT in context** - measured: a report charged the recovery as if the data had already been paid for.
- **Credit an outcome to the call that produced it** - measured: a report credited the failed call.
- **Price the LAST message** - measured: a 'waste-free' verdict over its own +124.6k closing message.
- **Every non-zero error count gets a one-line cause** - measured: '2 errors' on Bash where both were `ls` on an absent directory.
- **No cross-session superlative without the sibling's own analyzer output** - measured: a headline cost multiplier that a same-command pair in the same batch contradicts; and two single-session superlatives were both false - 5th of 22, and 4 blocks against a sibling's 18 - one propagated into a shipped cross-session summary.
- **Elapsed time is DERIVED from timestamps, never estimated** - measured: '51 seconds' against the 13.1s the two transcripts give.
- **Sweep 1 - every stop in a flow's window** - measured: three reports stamped 'PASS, all hard gates held' over prose stops; five reports stamped 'PASS' while 1-2 unheld stops sat in the transcript.
- **Sweep 2 - every git commit event anywhere in the session** - measured: a report counted 1 gate deviation where the session held 2, the other silent; a report called a correctly-resumed session 'invoked hollow' and suggested skipping the skill.
- **Sweep 3 - every user correction or redirect** - measured: one report filed a user-caught managed-file edit purely as edit churn.
- **One row per NUMBERED STEP of the audited skill** - measured: a report's check carried Fresh-session / Step 1 / Step 2 / Sweeps 1-3 and no Step 3 row - and step 3 is where both of that session's defects sat; another stamped 'one clean pass' over four breached clauses of the skill it was grading.
- **NOT VISIBLE costs a grep first** - measured: a report marked a step unavailable while the transcript carried it in full - the inverse of the estimated-number failure this whole discipline exists to stop.
- **Read EVERY user turn, not the ones next to command markers** - measured: a report omitted the run's only real ask and the user's 'no' to it entirely, because neither was adjacent to a command marker.
- **A consent claim cites the ask -> mutation PAIR, by timestamp** - measured: a report's consent proof was inverted - two Writes at 09:11 and 09:14 against the first ask at 09:16 - and another scored two DECLINES that landed after the installer had already run as the run's 'biggest strength'.
- **A layer the run CHANGED is checked against the installer's contract too** - measured: a report graded a plugin failure as a syntax slip and proposed hardcoding the command shape, missing that both plugins were still DISABLED after the installer ran.

## Don't game it and the diagnosis discipline
- **Hand-written analysis is the failure mode the checks exist to replace** - measured: a sweep found 14 wrong or mislabeled claims across 12 shipped reports, including one verdict that inverted its own table.
- **Diagnose an error cluster only from the quoted error text** - measured: 88 errors filed under one cause that covered 24; the other 64 carried a different signature.
- **An output-volume claim splits green from red** - measured: 5 of 6 flagged rows were real failure diagnostics from briefs the seats had followed.
- **Quote file, command, and label names VERBATIM** - measured: one report cited a symbol name with zero transcript hits; and 'four logical commits' where the session's own git log printed six.
- **A skill firing late in a long session is costed at its WINDOW's ctx-per-message** - measured: a 242k window reported as the 171k mean.
- **A hook-block claim names the guard whose `Blocked:` text matches** - measured: two reports promoted harness errors to 'guard denials'.
- **A call is credited with its EFFECT only after its own `tool_result` is read** - measured: a report credited the successful draft write to a Bash heredoc whose own result was a failure.
- **'Evidence unavailable' is a CLAIM ABOUT ABSENCE** - measured: a report called a filing-authorization turn unavailable with it four lines away, and declared two tool errors unattributable with both error strings in the transcript it had already cited - the failures were all present in the same transcript.
- **Compliance with a path-scoped rule is scored on an ATTACH event** - measured: a report read compliance off a rule the session had merely opened.
- **A run whose transcript ends before its own closing artifact exists is UNVERIFIABLE** - measured: a report declared a run interrupted mid-step over an installer that had already logged `exit=0` and `==> done`, filed zero findings on that basis, and a sibling report would have recorded a silent PASS for a command cut off before its closing table.
- **A waste claim about reads passes four checks first** - measured: the blocked-read recovery was mislabeled twice; 'read 3x, ~28k redundant' was zero-overlap tiling of a 941-line file; the byte-identical-or-nothing test was measured; a mandated whole read was charged three times on the same doc; and a report inverted a capped no-offset read and its ranged completion, shipping a fix suggestion describing what already happened.
- **A gate claim distinguishes an existence CHECK from a WRITE** - measured: a report fabricated two receipt writes from two absence checks, and the phantom stale-stamp risk burned a downstream audit's time.
- **The Environment rows derive from the AUDITED transcript** - measured: ~17 reports carried the analyst host's CLI version as the session's; one report blamed a session for a clause that shipped hours after it ran.
- **Every hand count states its method inline** - measured: 'appears 45 times' was 23 or 54 by method, reproducible as neither.
- **Verdict-table cells derive from THAT skill's own attributed window** - measured: three reports reused one skill's cells for another, one crediting a no-dispatch skill with '4 seats dispatched'.
- **any count past a handful of events comes from a command** - measured: a report asserted 'two tool errors' three times against its own table's 1.
- **A 'duplicate read' claim stays inside ONE context** - measured: both the cross-context orientation read and the background-task polling shipped as top waste rows in audited reports.
- **The `(Re-invocation ... previously loaded)` marker is not proof of a prior load** - measured: a duplicate-load finding built on the marker alone did not survive the grep.
- **A row that PRAISES a shell idiom states the observed exit status** - measured: a probe scored PASS and held up as the reference shape two other sessions 'got wrong', while its own pipeline masked a non-zero status - reproduced.
- **Cite a table cell by the COLUMN it came from** - measured: a `via Bash (r/w)` read half restated as a write, against this file's own rule that a number a tool prints cannot be misquoted.
- **Cost a failed call as what the transcript SHOWS** - measured: a report described a retry after the last AskUserQuestion index in a transcript that ends eleven messages later with no such call.

## The efficiency scorecard - where each row comes from
The rows measure the practices the official Claude Code guidance (the best-practices and costs pages) and the stack's own session audits agree on. Each entry names the measurement that put the row in; the first run was over 115 main-session transcripts from ten consuming projects on 2026-09-11, before any of the rows could change behaviour - the baseline the observation week is read against.
- **cost at list price** - priced once per API message from its folded usage, because one response arrives as several rows: across 842 local transcripts on 2026-09-23, 87,308 usage rows carried 43,847 message ids, and a per-row sum would have billed cache-read 1.92x and output 1.80x. Folded, the totals sit at a median 1.000 (cache-read) and 0.999 (output) of the harness's own cost-state record, and the list-price cost at a median 0.997 of its billed figure over 178 sessions. Cache writes split 56% 5-minute and 44% 1-hour by tokens, which is why each is billed at its own rate.
- **standing floor** - standing context was 63.5% of a 164-session collection's bill; nine installs floored between 87k and 134k tokens per message; 51% of cache-read across the 115 sessions.
- **cache continuity** - the rule is Claude Code's own `Prompt cache (main)` status-line definition (a miss re-processed over 5% and at least 2,000 tokens; the request after a compaction is an expected rebuild). Baseline: 45 misses re-cached 8.2M tokens - 31% of every cache write in the collection, the largest class the scorecard found and one no earlier report had a row for; 10 expected rebuilds cost 0.8M more. Seven of the top eight sessions sit in two projects.
- **compaction re-reads** - 12 compactions, 39 files re-read after one, ~54k tokens; two sessions re-read 18 files each, one of them the plan the summary should have carried.
- **build-dir reads** - 20 calls, ~8.6k tokens in the whole collection: the class the token-optimization articles put first is negligible here, and that number is why the read guard did not grow one.
- **test and build runs** - 34 of the 38 test runs ran through the PowerShell tool, not Bash, so a Bash-only classifier reported zero; read correctly, 35 of 37 were scoped (a single project or filter) and test output was 5% of shell result volume - which is why no output-compression hook followed.
- **checked commits** - across four audited sessions every push and merge passed every guard, one putting 40 files on a shared branch; the commit gate followed, and this row is its measurement. The 115-session baseline holds no main-transcript commit at all, so the row's first real numbers come from the week.
- **green claims** - 2 of 10 claims that a check passed landed in a turn that ran no check; each is opened before it counts.
- **correction streaks** - the hook's strict detector (three short turns in a row, each after a 1,500+ char answer) fired on 0 of 115 sessions, while 42 of the 45 answers over 1,500 chars drew a short user turn - the strict walk is broken by any tool-carrying answer between corrections. Both numbers sit in the row so the week's threshold decision has them side by side; the hook stays as shipped until then.
- **long answers** - 10 of 377 final answers over 1,800 chars of prose: the budget holds, and the row is there for the sessions where it does not.
- **navigation** - over the 60 most recent local sessions on 2026-09-23, main and seats: 1,391 of 2,193 source-file reads had a locate step in the 3 calls before (63%) - 432 located by a symbol tool, 959 by grep alone - against 1,789 symbol-tool and 4,861 grep calls. The per-session share ran 9% (p25) to 77% (p75) around a 62% median across the 27 sessions that read source, so the row separates sessions rather than restating one habit.
- **MCP failures** - over 434 local sessions on 2026-09-23, 55 calls in 18 sessions came back as a server error (the servers' pre-2.0.0 names): serena 28 of 2,927 (about 1%), sentry 16 of 48, playwright-chrome 6 of 89, context7 5 of 230. `is_error` is the whole signal - no result across 3,242 MCP calls opened on an error string without it - and a guard denial, a harness rejection or a declined ask never reached the server, so none counts. A server health check opens on a material rate, never on one error.
- **dispatch overhead** - 28 of 40 seats spent over 60% of their input re-sending their own first-message context; 55% of all seat input tokens in the collection was that context. The 26k-70k chars of skills preload per designer / implementer / verifier seat is the fixed half of it.
