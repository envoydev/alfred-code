# Usage audit - Phase B audit

Read at Phase B, before the first bundle.

Contents: bundle anatomy - principles - Phase B0 discovery - Phase B1 per bundle (facts, decision trail,
contract conformance, token and effectiveness verdicts, generated docs, skills, the plugin's flow-skill runs, report
integrity, the audit file) - delegated execution.

`SESSIONS_ROOT` is the root step 0 found among `roots`; a swept collection nests one project level above
the session-id folders, so enumerate `<root>/*/<session-id>/` too and carry the project
name into every finding's evidence. Audit output goes to `<SESSIONS_ROOT>/AUDIT/` - inside the
ignored root deliberately, so private data never reaches a tracked file.

## Bundle anatomy - discover, never assume

Bundles come from several capture generations, and the collector's own file names are a `notes` line;
inventory each bundle.

| File | What it is | Trust |
|---|---|---|
| `session.jsonl` / `<session-id>.jsonl` | the full main-session transcript | ground truth |
| `subagents/agent-*.jsonl` (+ `.meta.json`) | one transcript per dispatched agent; meta names the type | ground truth |
| `tool-results/`, `custom-title.json` | the rest of the transcript's `<session-id>/` folder | ground truth |
| a tool-usage ledger | the instrumentation tool ledger | deterministic - check its coverage window, it can start mid-session |
| a hook-block ledger | one row per guard BLOCK | deterministic; absent means no block OR an older capture - never read absence as 'no blocks'; the collector's receipt says which |
| the collector's receipt | one row per store - status, count, and why for an `absent` one | deterministic - read in Phase B0, before any finding about a store |
| collect-time context | roots, variables, plugins and switches as the collector found them | read at collect time, not the session's own state |
| a data-root mirror | the project's data root mirrored path for path - the session's state and ledgers | deterministic; the Conformance section reads it |
| docs and temp files | docs the session wrote, under their path below the docs root; hook temp files naming the session | the file as it stood at collect time |
| analyzer output | the analyzer's JSON and text output - names vary by capture generation | deterministic derivation |
| a usage report | a model-written report (authored route) or an unfilled skeleton | claims - verify before reuse |

Where the collector also keeps per-project ledgers beside the session folders (a `notes` line names them), use
them as the authority whenever a bundle's own copy is missing, and check them for a session id with NO
bundle: that session is measurable (what ran, what was blocked) but not readable (no transcript),
so it belongs in the remainder, never silently in the counts. A hook-block row names the hook,
the tool and the denial text - it is the only way to tell a gate that earned its keep from one that
misfired, and a run of identical reasons across projects is a misfiring guard, not user error
(measured: five blocks on the plugin's own catalogs, whose denial text named a temp path while the
real trigger was the file's content).

## Principles

- The transcript outranks every report about it. Re-derive every countable claim before it enters a
  finding - a prior sweep found wrong counts in shipped reports that read as entirely plausible.
- The practices are the official ones. The scorecard measures what the Claude Code best-practices and
  costs pages prescribe - a check Claude can run and evidence over assertion, short always-on files
  with sometimes-relevant material in skills, hooks for zero-exception actions, subagents for heavy
  reads, a clear after two corrections, compaction instructions, one test while iterating and the
  suite at the gate - plus the repo's own measured rules. A finding names the practice it tests, and
  a practice those pages have dropped or changed is re-verified against them before it is enforced.
- Read the conversation, not just the ledgers. A bundle whose findings all come from analyzer
  output has been summarized, not audited.
- A finding is a mechanism, not a vibe: trigger, observed behaviour, measured cost, and the exact
  repo file the fix lands in. 'Could be more efficient' is noise.
- Absence of evidence is not failure evidence. A gate that never fired because nothing tripped it
  is working - mark it unobserved until you confirm its trigger arose.
- Judge the contract too. Behaviour that followed the written contract into a bad outcome makes the
  contract the defect - file it against the contract's home.
- Check the live tree before proposing: `OPEN`, `FIXED-SINCE <ref>`, or `NOT-STACK`.
- Mechanisms over prose - a hook, a gate file, a report field, a numbered step. Measured: prose
  guidance was skipped in a material fraction of audited runs; mechanisms held.
- User friction is the highest-signal evidence: a correction, a repeated ask, a mid-task redirect.
  Locate and read every one, with the turns on both sides.
- A decision point with no tool-shaped ask is a finding. So is a Skill call against a manual-only
  skill - the home is the artifact whose TEXT instructed the call.

## Phase B0 - discovery

Enumerate bundles and inventory their files. Read any root `SUMMARY_*.md` for the already-known
list. Snapshot the plugin's current version and recent release history as the already-fixed
reference. Order bundles oldest-first where timestamps allow, so later ones validate shipped fixes.
Read each bundle's collector receipt (and the report section that prints it, where a note names one) before
any finding about a store: an `absent` row's reason - never written, swept, no data root - says the store is not
evidence of what the session did. A bundle with no receipt predates the collector or was copied by hand, and its
stores beyond the transcript are unknown. Edit nothing here.

## Phase B1 - per bundle, in order

Write each bundle's audit file before starting the next - it is the resume point, and a bundle that
already has one is skipped on re-invocation.

- **Facts first.** Token spend per agent, model mix, message and turn counts, tool-call frequency,
  dispatches and agent types, errors, hook blocks, ledger coverage. Use the bundle's analyzer
  artifacts; run the analyzer a note names where they are missing (with none, `jq` over the
  transcripts). Token math is always the script's or a reproducible `jq` count's. Every
  non-zero `errors` cell is resolved to its own `tool_result` text before anything is written about
  it - 'cause unrecorded' is a claim about absence and needs the grep that proves it (measured: one
  audit called two errors unattributable with both error strings in the transcript it had already
  cited). And a run is INTERRUPTED only when it stopped short of the last NON-OPTIONAL step of its
  own protocol, never because the transcript's last line is not a summary (measured: one audit
  declared a run interrupted mid-step over an installer that had logged `exit=0` and `==> done`,
  and filed zero findings on that basis).
- **The decision trail.** Reconstruct the spine, then walk both sides together: what the user asked
  in their own words and how the reply answered it (length, directness, result first, a
  decision-shaped question asked through the tool or left in prose); what the assistant chose next
  and on what basis - the skill, agent, rule or MCP it reached for, the ones it had and ignored,
  where it assumed instead of asking, where it re-derived what the project's docs already held,
  where it called work done before proving it; and every friction point with its surrounding turns.
- **Contract conformance.** Build the roster of the plugin's artifacts that participated, pull their
  CURRENT source, and check observed behaviour against the written contract. Two checks earn their
  cost every time: gate-file forensics (content AND mtime against the session window - one leftover
  stamp authorized dispatches in four later sessions) and context-load root-causing (did the
  clause's text ever enter the session - a satellite rule never Read is a placement defect, not a
  discipline failure; measured 10/10 generic dispatches traced to one unread file). Path-scoped
  rule attachment IS observable - on the harness's `nested_memory` attach row, plus any record a
  `notes` line names - with a glob proxy over the touched files as the floor under them, so an
  unused path-scoped rule is a finding like any other. What stays invisible is a HOOK: it leaves no
  transcript record, so a plugin shipping only hooks can never be scored used.
- **Token verdict - do we waste tokens?** Break the spend down: cache read vs cache creation vs
  output, per agent, and per phase of the run. Then name the drivers with numbers - the largest
  single tool result, a file read more than once, work re-derived that a generated doc already
  held, a dispatch whose brief cost more than the agent returned, a retry storm, context carried
  past the fresh-session trigger. Close with ONE line: what the session delivered, what it cost,
  and the avoidable share as a measured number (`~180k of 940k, 19%`), never an adjective. A
  session that spent heavily and delivered the result reliably is a PASS - say so; waste is spend
  with nothing bought, and that is the verdict this audit exists to reach. Where the analyzer a note names prints an efficiency block, it is the floor of this breakdown: cache misses by Claude Code's own rule and the tokens they re-cached, compaction re-reads, build-dir reads, scoped against whole-suite runs, checked commits, green claims with no check, correction streaks, long answers, heavy agents. Each row is opened per the diagnosis discipline a note names (with none: re-read the transcript turns behind the row) before it is costed; the avoidable share sums only the rows that survived.
- **Effectiveness verdict - did it work?** One line beside the token verdict: what landed (the artifact, the commits and whether each had a check before it), how many user corrections it took and whether a correction-streak hook, where the plugin ships one, would have met them, how many green claims had no check in their turn, how many stops went unheld. A session can be cheap and ineffective - that is a finding against the flow, never a PASS.
- **Generated docs - useful, and actually used?** Where the plugin generates project docs (a note lists
  them), for every task that needed orientation (a fix, an investigation, a design), check whether the
  session READ what the plugin generates for exactly that, or re-derived the same knowledge by grepping
  the tree. Both directions are findings with different homes: never read while present is a delivery
  defect (the rule, skill or agent brief that should have routed the agent to it); read and not
  sufficient is a content defect against the skill that generates it; absent because never captured
  is a first-run gap, not a defect. Quote the turn where the doc was read, or the greps that stood in
  for it, and cost the difference. A plugin that generates no docs skips this check and says so.
- **Skills - misused, or not used at all.** Three shapes, each a finding: a skill that fired when
  its own description did not match the turn; the job done by hand while an installed skill covered
  it (the strongest evidence is the user's own words next to that skill's description); and the
  right skill in the wrong mode - invoked as a Skill call where the contract says name it to the
  user, or inline where it promises dispatch. Check the installed inventory for that project, not
  the repo's full catalog: a skill the project never installed cannot be a non-use finding. Where the
  analyzer a note names prints an inventory - one row per installed skill, agent, rule, plugin and MCP
  server with whether it was used, HOW that was observed and when, the unused names collapsed per
  layer, and `used in N of M sessions` plus the never-used set across a collection - that is the check,
  machine-written. Read its source line first: a row sourced from the repo's catalog means the installed
  set was NOT reachable and the denominator is the repo's, not this project's - re-run it against that
  project's install before filing a non-use finding off it. Read the `how` column too: a skill preloaded
  by a dispatched agent's frontmatter was paid for in full with zero calls, which is a different finding
  from a skill nothing reached.
- **The plugin's flow skills under load.** Every one that ran (the families a note names) is judged
  against its own `SKILL.md`: the phases it promises, the asks it must put through AskUserQuestion, the
  artifact it must write, the state file it resumes from, and whether it VERIFIED its result or asserted
  it. Report each as a row - skill, sessions seen, tokens, conformed / violated /
  conformed-into-a-bad-outcome, and the one thing that would make it cheaper or more reliable. A
  flow-skill run that produced its artifact but cost more than the work it saved is a MATERIAL
  token-waste finding against that skill, with the two numbers side by side.
- **Report integrity.** Spot-check a model-written report's countable claims against the transcript -
  with the report checker a note names where one exists (it should print every judgment number that
  cites no machine row of that same report); a wrong number is itself a finding, and your value is the
  one that enters the ledger.
- **Conformance.** Where the report skeleton carries a machine-written expected-vs-observed section (a note
  names the claims and step sources it grades), a conformed / violated count in the audit file cites those
  rows; it never recounts them. A row `not visible` in three audits running names a writer that is missing -
  say so in the summary.
- **The audit file** `<AUDIT_DIR>/<session-id>.md`: header (id, date, tech stacks, task, headline
  numbers), one-line verdict, the TOKEN VERDICT and EFFECTIVENESS lines (delivered / cost / avoidable share; landed / corrections / unchecked claims / unheld stops), the scorecard rows quoted, the
  plugin-surface scorecard (generated docs used or bypassed; skills fired, missed and misused; each
  flow-skill run with its conformance and cost), the findings ledger including positive findings,
  report-integrity result, and `FIXED-SINCE` observations.

## Delegated execution

**Delegated execution** (the Q-EXECUTION answer): a read-only subagent per bundle carries the bundle
path, the anatomy table, the principles, and the ledger shape as its mandatory return contract,
plus any prior-summary claim about that session as a verify-don't-re-report seed. Subagents return
`status: PROPOSED`; only the main session classifies OPEN / FIXED-SINCE / NOT-STACK, and only the
main session writes the audit files and Phase B2 - those need the live tree. Expect a concurrency
cap: launch up to it, replace as completions arrive, write each audit file before its replacement.
