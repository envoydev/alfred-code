# Stack Usage - Collect and Audit

One prompt for the whole loop: gather Claude Code session evidence from consuming projects and
audit it against this stack's source. It replaces the three prompts that used to split this work
(collect inside one project, sweep many projects, audit a collection) - they disagreed about who
collects, where the data already is, and whether reports arrive authored, and a run that guessed
wrong wasted a session. **Every one of those conflicts is now an ANSWERED QUESTION before any
analysis starts.**

The counters say what ran and what it cost; the conversation says why. Both are in scope.

You operate autonomously AFTER step 0, with one exception - the fix-routing question in Phase C.
Do not ask for confirmation between phases. Stop only on the objective conditions at the end. A decision that genuinely needs the user mid-run goes through
AskUserQuestion with concrete options and a marked recommendation, never a prose question in a
report.

---

## Step 0 - ask, one question at a time

**Detect first, ask second.** Never ask what the machine can tell you. Before the first question,
and writing nothing, establish and then STATE in the question text:

- where this session is running (the alfred-code clone, or a consuming project root),
- whether a collection root already exists and how many bundles it holds - glob
  `docs/*investigation*/` rather than assuming the default name (`docs/session-investigation/`):
  a real collection on this machine sits in the plural spelling, and a run that assumed the
  singular would have audited an empty folder. Use what actually holds bundles, and say which,
- how many of those bundles already have an audit file in `<root>/AUDIT/`,
- whether that root is gitignored - `git check-ignore -q <root> && echo IGNORED` - and whether
  `git status --porcelain <root> | wc -l` is 0,
- which config dirs exist on this machine (`~/.claude*/projects/`) and whether this project has a
  history folder there.

A collection root that is NOT ignored is a stop condition, not a question: raw transcripts land
there. Fix `.gitignore`, then continue.

**ONE AskUserQuestion per question, and the answer just given picks the next one.** Never batch the
chain: batched, a user who answers 'the bundles are already collected in the investigation folder'
is still asked where to collect from, what to write into the collected reports and whether to audit
now - four dead questions on one screen. A question the answers so far made moot is not asked, and
not asked with 'moot' in its text either. Every ask states what detection found, so the user picks
instead of guessing.

### Q1 - EVIDENCE - always first, alone

- `Audit what is already collected` (recommended when the root holds bundles - say how many)
- `Collect from particular projects, then audit` - one or more project roots the user names, this
  one included when they name it

Ask nothing else until this answer is in: it picks the chain.

### The schema - which answer opens which question

Read it as a tree: a question exists only on the branch its parent answer opened. Nothing on
another branch is asked, and no question is asked twice.

```
Q-EVIDENCE  (always first, alone)
|
+- 'Audit what is already collected'      -> nothing about collecting is ever asked
|    +- Q-BUNDLES
|         +- every bundle | only bundles with no audit file yet | a named subset
|              +- Q-EXECUTION  [asked only if dispatch available AND >3 bundles in scope]
|                   +- inline | fan-out  -> Phase B -> Phase C -> Q-ROUTING
|
+- 'Collect from particular projects'
     +- Q-PROJECTS  (free text paths; resolve each BEFORE the next ask)
     |    +- none resolved -> STOP: no history and no bundles on this machine for those paths
     +- Q-DATA  - is the data already generated for those projects, or must it be generated?
          |
          +- 'already generated'  -> no analyzer runs; Phase A copies what the projects hold
          |    +- Q-SCOPE   [+ 'exclude this session' only when the list includes this project]
          |         +- Q-AFTER
          |
          +- 'generate what is missing' (recommended) | 'generate everything fresh'
               +- Q-SECTIONS  - authored | skeleton
                    +- Q-SCOPE   [same this-session note]
                         +- Q-AFTER
                              +- collect only -> Phase A -> STOP (no Q-EXECUTION, no Q-ROUTING)
                              +- audit now    -> Q-EXECUTION [same gate as above]
                                                   -> Phase A + B -> Phase C -> Q-ROUTING
```

| Question | Asked only when | The answer sets | Read later by |
|---|---|---|---|
| Q-EVIDENCE | always, first, alone | `evidence` = audit-existing / collect | picks the chain; `audit-existing` skips Phase A entirely |
| Q-BUNDLES | `evidence` = audit-existing | `bundles` = all / no-audit-file-yet / subset | Phase B0 enumeration |
| Q-PROJECTS | `evidence` = collect | `projects[]` (absolute paths) | Phase A, every route |
| Q-DATA | `evidence` = collect, after the paths resolved | `data` = already-generated / fill-gaps / regenerate | Phase A route per project |
| Q-SECTIONS | `data` != already-generated | `sections` = authored / skeleton | Phase A routes 2 and 3 |
| Q-SCOPE | `evidence` = collect | `scope`, and `include_self` when this project is in the list | Phase A session list |
| Q-AFTER | `evidence` = collect | `after` = audit-now / collect-only | the stop condition after Phase A |
| Q-EXECUTION | the run will audit (`evidence` = audit-existing, or `after` = audit-now) AND dispatch is available AND >3 bundles are in scope | `execution` = inline / fan-out | Phase B1 delegated execution |
| Q-ROUTING | Phase C only, never step 0 - the punch-list must exist first | `routing` | Phase C apply step |

### The questions

- **Q-BUNDLES** (auditing what exists) - `every bundle` / `only bundles with no audit file yet`
  (recommended when `AUDIT/` already holds some - say how many of how many) / `a named subset or a
  date range` (Other). State the bundle and audit-file counts detection found.
- **Q-PROJECTS** (collecting) - absolute paths, free text; offer this project's own root as the
  pre-filled option when the session is running inside one. Before the next ask, resolve each path
  to its history folder under `~/.claude*/projects/` AND check whether it already has a bundle set
  (its own docs root, or a folder under the collection root), then say per project what was found -
  that inventory is what makes the next question answerable. No project name or path ever reaches a
  tracked file.
- **Q-DATA** (collecting, after the paths resolved) - is the data already there, or must it be
  generated? `generate only what is missing` (recommended - name the counts: N sessions with a
  bundle, M without) / `it is already generated - just collect it` / `regenerate everything, even
  where a bundle exists`. A project with bundles and no history folder can only answer the second;
  a project with history and no bundles can only answer the first or third - say so instead of
  offering a choice that cannot run.
- **Q-SECTIONS** (only when something is being generated) - `authored` - invoke
  `/project-stack-usage-analyzer` so a model fills each report's judgment sections (slower, richer,
  needs a session inside that project) - or `skeleton` - `analyze-usage.js --report-md` only,
  judgment left unwritten because the audit re-derives it anyway (recommended for more than one
  project, and the only route that works from outside the project).
- **Q-SCOPE** (collecting) - `every session found` / `only sessions not collected yet` (recommended
  when the projects in scope already have bundles) / `a date range or explicit session ids`
  (Other). State the session count the previous answers resolved. When the project list includes
  the project this session is running in, this question carries the extra choice `exclude this
  session` (recommended - auditing the tail of the session doing the auditing reads its own
  output); otherwise it is not mentioned at all.
- **Q-AFTER** (collecting) - `audit now, in this run` (recommended) / `collect only, audit later in
  a fresh session`. On `collect only` the chain ends here: Phase A runs and the run stops.
- **Q-EXECUTION** (auditing in this run) - `audit inline in this session` / `fan each bundle's
  fact-gathering out to read-only subagents` (recommended when dispatch is available and more than
  three bundles are in scope). No dispatch capability, or three bundles or fewer: inline, no
  question.

Fix routing is NOT asked here. It is asked once, in Phase C, with the punch-list on screen - asking
it up front means asking a question whose own recommended answer is 'ask me later'.

Hold every answer for the whole run. Re-asking a settled question mid-run is a defect.

---

## Ground rules for every phase

- **Absolute paths in every command.** A `cd` persists between calls, so a later relative path
  silently resolves somewhere else - one run wrote a whole bundle tree into a nested copy of its
  own destination and it looked like data loss.
- **Never print analyzer output into the chat.** Every collection command redirects to a file.
  Reading full reports back is what drives a run's context into the hundreds of thousands.
- **Never read a transcript whole.** Session files run to tens of MB. Count with
  `scripts/analyze-usage.js` (it dedupes usage by message id and finds a bundle's sibling
  `subagents/` itself) and with `jq` / `grep`; then Read only the offsets that need judgment.
- **Privacy wall.** Bundles carry private project names, absolute paths, file contents and
  possibly secrets. Everything quoting them stays inside the audit dir; anything reaching a tracked
  stack file is genericized to 'a consuming project'. Re-run both gitignore checks after copying.
- **Copy, never move.** The audited project owns its data; this run is a reader.

---

## Phase A - collect (skipped entirely when Q-EVIDENCE was `audit what is already collected`)

Once per project in `projects[]`; the Q-DATA answer picks that project's route. Destination is
always `<alfred-code repo>/docs/session-investigation/<project>/`.

**Route 1 - the data is already generated.** Copy the WHOLE bundle set the project holds -
`SUMMARY.md`, `_rollup.txt` as `rollup.txt`, and every per-session folder entire - out of
`<project>/.claude/docs/alfred-code-usage-report/` (or its `ALFRED_CODE_DOCS_PATH` root). Add the
two ledgers per session from that same root (`tools-usage/<sid>.jsonl`, `hook-blocks/<sid>.jsonl`)
where the bundle does not already carry them. Nothing is generated. A session in scope with no
bundle is reported as missing, and generated only under the `fill-gaps` answer.

**Route 2 - generate, `authored` sections.** `/project-stack-usage-analyzer` must run in a fresh
session INSIDE that project's root - it is the only route that fills the judgment sections. Invoke
it with the scope answer, let it write one bundle per session plus its `SUMMARY.md` under the
project's docs root, then copy the set as in route 1. For a project you are not in, name it as a
run the user starts there, and carry on with the other projects rather than blocking.

**Route 3 - generate, `skeleton` sections.** Nothing runs inside the audited project - Claude Code
already stores its history, and this route reads it from here.

1. Resolve each project's history folder: one folder per project under `<config-dir>/projects/`,
   named by the absolute project path with every `/` replaced by `-`. There can be MORE THAN ONE
   config dir (`~/.claude` plus any `CLAUDE_CONFIG_DIR` space), so glob `~/.claude*/projects/` and
   take every match, not the first. No folder means no history on this machine: record the project
   as skipped, create no empty bundle, carry on.
2. Rollup once per history folder - `node scripts/analyze-usage.js <history-dir>` - apply the scope
   answer, drop what is already collected, and print the resolved session list (the list, never the
   analyzer output).
3. Write `<DEST>/<project>/<session-id>/` per session:

| Artifact | How |
|---|---|
| `analyzer.json` | `node scripts/analyze-usage.js <transcript> --json > .../analyzer.json` |
| `analyzer-full.txt` | the same call without `--json` |
| `report-usage.md` | `--report-md` (skeleton), or the authored file from the project route |
| `<session-id>.jsonl` | copy of the transcript - ground truth, and the ONLY artifact carrying the actual messages |
| `subagents/` | copy of the transcript's sibling folder when it exists |
| `tool-usage-<sid>.jsonl` | the instrumentation ledger from the project's docs root (`<project>/.claude/docs/tools-usage/<sid>.jsonl`, or its `ALFRED_CODE_DOCS_PATH` root) |
| `hook-blocks-<sid>.jsonl` | the guard-block ledger from the same root - the only place naming WHICH hook denied a call |

   Pass `--hook-log <ledger>`, `--hook-blocks <that session's file, never the directory>` and
   `--docs-root <root>` for a non-default docs path; say so per session when a ledger is absent.
4. Write `<DEST>/<project>/rollup.txt`, and `SUMMARY.md` when the project contributed more than one
   session, so the audit's Phase 0 has its orientation file.

Report the collection before going on: projects collected and by which route, projects skipped for missing history,
sessions per project, total size, both gitignore checks. On the `collect only` answer, stop here
and name the audit as the next run.

---

## Phase B - audit

`SESSIONS_ROOT` is the root step 0 found (default name `docs/session-investigation`, any
`docs/*investigation*/` accepted); a swept collection nests one project level above the session-id
folders, so enumerate `<root>/*/<session-id>/` too and carry the project
name into every finding's evidence. Audit output goes to `<SESSIONS_ROOT>/AUDIT/` - inside the
ignored root deliberately, so private data never reaches a tracked file.

### Bundle anatomy - discover, never assume

Bundles come from several capture generations; inventory each one.

| File | What it is | Trust |
|---|---|---|
| `session.jsonl` / `<session-id>.jsonl` | the full main-session transcript | ground truth |
| `subagents/agent-*.jsonl` (+ `.meta.json`) | one transcript per dispatched seat; meta names the type | ground truth |
| `tool-usage-<sid>.jsonl` | the instrumentation tool ledger | deterministic - check its coverage window, it can start mid-session |
| `hook-blocks-<sid>.jsonl` | one row per guard BLOCK | deterministic; absent means no block OR an older capture - never read absence as 'no blocks' |
| `analyzer.json` / `analysis.json` / `analyzer-full.txt` | `analyze-usage.js` output - the JSON carries either name depending on the capture generation | deterministic derivation |
| `report-usage.md` | a model-written report (authored route) or an unfilled skeleton | claims - verify before reuse |

Beside the session folders, each project directory also carries `tools-usage/<session-id>.jsonl`
and `hook-blocks/<session-id>.jsonl` - the same two ledgers collected per project. Use them as the
authority whenever a bundle's own copy is missing, and check both folders for a session id with NO
bundle: that session is measurable (what ran, what was blocked) but not readable (no transcript),
so it belongs in the remainder, never silently in the counts. A `hook-blocks` row names the hook,
the tool and the denial text - it is the only way to tell a gate that earned its keep from one that
misfired, and a run of identical reasons across projects is a misfiring guard, not user error
(measured: five blocks on the stack's own catalogs, whose denial text named a temp path while the
real trigger was the file's content).

### Principles

- The transcript outranks every report about it. Re-derive every countable claim before it enters a
  finding - a prior sweep found wrong counts in shipped reports that read as entirely plausible.
- The practices are the official ones. The analyzer's scorecard measures what the Claude Code
  best-practices and costs pages prescribe - a check Claude can run and evidence over assertion,
  short always-on files with sometimes-relevant material in skills, hooks for zero-exception
  actions, subagents for heavy reads, a clear after two corrections, compaction instructions,
  one test while iterating and the suite at the gate - plus this stack's own measured rules. A
  finding names the practice it tests, and a practice those pages have dropped or changed is
  re-verified against them before it is enforced.
- Read the conversation, not just the ledgers. A bundle whose findings all come from analyzer
  output has been summarized, not audited.
- A finding is a mechanism, not a vibe: trigger, observed behaviour, measured cost, and the exact
  stack file the fix lands in. 'Could be more efficient' is noise.
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

### Phase B0 - discovery

Enumerate bundles and inventory their files. Read any root `SUMMARY_*.md` for the already-known
list. Snapshot the stack's current version and recent release history as the already-fixed
reference. Order bundles oldest-first where timestamps allow, so later ones validate shipped fixes.
Edit nothing here.

### Phase B1 - per bundle, in order

Write each bundle's audit file before starting the next - it is the resume point, and a bundle that
already has one is skipped on re-invocation.

- **Facts first.** Token spend per seat, model mix, message and turn counts, tool-call frequency,
  dispatches and agent types, errors, hook blocks, ledger coverage. Use the bundle's analyzer
  artifacts; run the script where they are missing. Token math is always the script's. Every
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
- **Contract conformance.** Build the roster of stack artifacts that participated, pull their
  CURRENT source, and check observed behaviour against the written contract. Two checks earn their
  cost every time: gate-file forensics (content AND mtime against the session window - one leftover
  stamp authorized dispatches in four later sessions) and context-load root-causing (did the
  clause's text ever enter the session - a satellite rule never Read is a placement defect, not a
  discipline failure; measured 10/10 generic dispatches traced to one unread file). Path-scoped
  rule attachment IS observable, on two records the analyzer's `Inventory vs use` section reads -
  the harness's `nested_memory` attach row and `guard-read-whole-file.js`'s shell-route notice,
  both measured across the corpus - with a glob proxy over the touched files as the floor under
  them; the old 'invisible in transcripts, never report its absence' rule is retired, so an unused
  path-scoped rule is now a finding like any other. What stays invisible is a HOOK: it leaves no
  transcript record, so a plugin shipping only hooks can never be scored used.
- **Token verdict - do we waste tokens?** Break the spend down: cache read vs cache creation vs
  output, per seat, and per phase of the run. Then name the drivers with numbers - the largest
  single tool result, a file read more than once, work re-derived that a generated doc already
  held, a dispatch whose brief cost more than the seat returned, a retry storm, context carried
  past the fresh-session trigger. Close with ONE line: what the session delivered, what it cost,
  and the avoidable share as a measured number (`~180k of 940k, 19%`), never an adjective. A
  session that spent heavily and delivered the result reliably is a PASS - say so; waste is spend
  with nothing bought, and that is the verdict this audit exists to reach. The analyzer's EFFICIENCY block is the floor of this breakdown (`--json` carries it as `main.efficiency` plus `dispatchOverhead`): cache misses by Claude Code's own rule and the tokens they re-cached, compaction re-reads, build-dir reads, scoped against whole-suite runs, checked commits, green claims with no check, correction streaks, long answers, heavy seats. Each row is opened per the analyzer skill's discipline reference before it is costed; the avoidable share sums only the rows that survived.
- **Effectiveness verdict - did it work?** One line beside the token verdict: what landed (the artifact, the commits and whether each had a check before it), how many user corrections it took and whether the hook's streak threshold would have met them, how many green claims had no check in their turn, how many stops went unheld. A session can be cheap and ineffective - that is a finding against the flow, never a PASS.
- **Generated docs - useful, and actually used?** For every task that needed orientation
  (a fix, an investigation, a design), check whether the session READ what the stack generates for
  exactly that - `<docs-path>/architecture/ARCHITECTURE.md` and its `references/`,
  `quality/ASSESSMENT.md`, `code-style/CODE-STYLE.md`, the test-coverage capture - or re-derived
  the same knowledge by grepping the tree. Both directions are findings with different homes: never
  read while present is a delivery defect (the rule, skill or agent brief that should have routed
  the seat to it); read and not sufficient is a content defect against the skill that generates it;
  absent because never captured is a first-run gap, not a defect. Quote the turn where the doc was
  read, or the greps that stood in for it, and cost the difference.
- **Skills - misused, or not used at all.** Three shapes, each a finding: a skill that fired when
  its own description did not match the turn; the job done by hand while an installed skill covered
  it (the strongest evidence is the user's own words next to that skill's description); and the
  right skill in the wrong mode - invoked as a Skill call where the contract says name it to the
  user, or inline where it promises dispatch. Check the installed inventory for that project, not
  the stack's full catalog: a skill the project never installed cannot be a non-use finding. The
  analyzer's `Inventory vs use` section (`inventory` in `--json`) is that check, machine-written -
  one row per installed skill, agent, rule, plugin and MCP server with whether it was used, HOW
  that was observed and when, the unused names collapsed per layer, and `used in N of M sessions`
  plus the never-used set in directory mode. Read its source line first: a row sourced `catalog`
  means the installed set was NOT reachable and the denominator is the stack's, not this
  project's - re-run with `--inventory <that project's .claude>` before filing a non-use finding
  off it. Read the `how` column too: a skill preloaded by a dispatched seat's frontmatter was paid
  for in full with zero calls, which is a different finding from a skill nothing reached.
- **`/project-*` skills under load.** Every one that ran is judged against its own `SKILL.md`: the
  phases it promises, the asks it must put through AskUserQuestion, the artifact it must write, the
  state file it resumes from, and whether it VERIFIED its result or asserted it. Report each as a
  row - skill, sessions seen, tokens, conformed / violated / conformed-into-a-bad-outcome, and the
  one thing that would make it cheaper or more reliable. A `/project-*` run that produced its
  artifact but cost more than the work it saved is a MATERIAL token-waste finding against that
  skill, with the two numbers side by side.
- **Report integrity.** Spot-check a model-written report's countable claims; a wrong number is
  itself a finding, and your value is the one that enters the ledger.
- **The audit file** `<AUDIT_DIR>/<session-id>.md`: header (id, date, stacks, task, headline
  numbers), one-line verdict, the TOKEN VERDICT and EFFECTIVENESS lines (delivered / cost / avoidable share; landed / corrections / unchecked claims / unheld stops), the scorecard rows quoted, the
  stack-surface scorecard (generated docs used or bypassed; skills fired, missed and misused; each
  `/project-*` run with its conformance and cost), the findings ledger including positive findings,
  report-integrity result, and `FIXED-SINCE` observations.

Every finding, everywhere, uses one shape - the clustering depends on it:

```
- [SEVERITY] [category] <one-line defect> | evidence: <session id + locator + measured number> | home: <exact stack file> | status: OPEN / FIXED-SINCE <ref> / PARTLY FIXED <ref> / NOT-STACK | fix: <the smallest mechanism that removes it>
```

Severity: `BLOCKER` (a wrong result shipped, or a gate failed to catch one), `MATERIAL` (a broken
contract with real consequence, or measured avoidable cost), `MINOR`. Categories:
`protocol-violation`, `wrong-behavior`, `token-waste`, `missing-mechanism`, `report-integrity`,
`docs-and-gates`, `user-friction`.

**The four statuses, and what each one costs to claim:**

- `FIXED-SINCE <ref>` is a claim about the LIVE tree and is verified there before it is written -
  open the named file at HEAD (or in the working tree, saying which) and read the clause that
  closes the finding. A release note, a changelog line, another audit file's stamp, or your own
  memory of having fixed it are none of them evidence (measured: two FIXED-SINCE stamps in one
  campaign were written off a remembered edit; re-reading the source proved one defect fully live).
- `PARTLY FIXED <ref>` is the honest home for a mitigation that is real but not the mechanism the
  finding asked for - prose where a gate was needed, a measurement where an enforcement was needed,
  a fix that closes three of four routes. The stamp SAYS which half landed and names the residual in
  its own words. Without this status the two failure modes are a false FIXED and a stale OPEN, and a
  campaign that has neither word for it produces both.
- `NOT-STACK` covers a defect no stack file owns: the audited project's own code, the harness, and
  the audit's OWN output. That last class is large and predictable - a defect in a bundle's
  `report-usage.md`, a `SUMMARY.md`, or the report-generation prompt is a local artifact, so close
  it `NOT-STACK` and route the durable half to the stack skill that owns that work
  (`project-stack-usage-analyzer`), naming the rule that landed there.
- `OPEN` is a transient state, never a verdict. A finding is OPEN only between the audit that filed
  it and the routing answer that dispositions it - see Phase C's close-out.

**Bulk stamping is allowed, per HOME, never per finding-count.** A cluster of N findings sharing one
home closes with one verification of that home's live source and one stamp text naming the mechanism
that closed it. Never stamp by pattern-match on the finding's own words: the same sentence appears
in findings the mechanism does not reach.

**Delegated execution** (the Q-EXECUTION answer): a read-only subagent per bundle carries the bundle
path, the anatomy table, the principles, and the ledger shape as its mandatory return contract,
plus any prior-summary claim about that session as a verify-don't-re-report seed. Subagents return
`status: PROPOSED`; only the main session classifies OPEN / FIXED-SINCE / NOT-STACK, and only the
main session writes the audit files and Phase B2 - those need the live tree. Expect a concurrency
cap: launch up to it, replace as completions arrive, write each audit file before its replacement.

### Phase B2 - cross-session synthesis

1. Cluster findings by defect, home or mechanism gap. A pattern across sessions outranks a one-off
   of equal severity: rank by severity, then frequency x measured cost.
2. Reconcile against the already-known list - recurred (the shipped fix did not hold: escalate),
   stayed fixed (validation), or new.
3. For each OPEN cluster, decide the smallest structural fix and its exact home, honouring the
   repo's invariants: one home per piece, mechanisms over prose, platform-neutral skill bodies, the
   shared-rules registry for multi-home text. Hunt the root fix that collapses a cluster before
   patching per finding - one severity flip dissolved a four-session bypass cluster.
4. Write `<AUDIT_DIR>/SUMMARY.md`: the rollup table (one row per session), the ranked cluster table
   with evidence counts, the OPEN punch-list grouped by stack home, the validation record, and the
   NOT-STACK observations fenced off from the punch-list. Four tables are mandatory beside it:
   **token economics** - per session and per project, total spend, avoidable share, and the top
   three drivers, plus the scorecard totals per project with their denominators (misses and tokens re-cached, expected rebuilds, compaction re-reads, build-dir reads, scoped / whole-suite runs, checked / all commits, unverified / all green claims, correction streaks beside short-after-long corrections, long answers / final answers, heavy / all seats) - copied from the `--json` dumps, the numbers a hook or rule change is read from after its observation week - closing with one cross-collection verdict on whether this stack wastes tokens and where; **effectiveness** - one row per session: landed (y/n, the artifact), commits checked / all, user corrections, green claims with no check, unheld stops; **stack surface** - one row per skill, agent, rule, hook and MCP that appears anywhere in
   the collection, with sessions seen, tokens attributable, conformance, and the misuse / non-use
   count, built from the analyzer's `inventory` block - one recursive run over the collection
   ROOT gives `installed in K of M sessions, used in N` per name and the never-used set per
   layer directly, resolving each session's installed set from its own cwd so a name a project
   never installed is not counted against it; never re-derive it by hand; and **generated docs** - per project, which captures exist, how often a session read them
   versus re-derived what they hold, and the measured cost of the re-derivation. A surface that
   never appears in any session is reported as unobserved with its install count, never as
   unnecessary - absence of evidence is not failure evidence.

---

## Phase C - verdict and routing

Present the summary, then ask the ONE question step 0 deliberately left open, now that the
findings exist: apply BLOCKER + MATERIAL (recommended) / apply all OPEN / report only, change
nothing.

Applying means landing each fix in its stack home under this repo's rules: source of truth here,
never a consuming project's copy; wording genericized; `npm run lint` and `npm test` green; and the
session evidence cited in the commit - the bundle id and the measured number are the proof the
prove-don't-assert rule demands. A behavioural claim ships with its evidence, not an assertion.

**The run is not finished while a finding says OPEN.** Whatever the routing answer was, every
finding ends the run with a disposition and a reason: `FIXED-SINCE` verified in the live tree,
`PARTLY FIXED` with the residual named, `NOT-STACK` with the owner named, or - for a fix that is
possible and deliberately not taken - `WONTFIX` with the cost or risk that decided it. 'Report only'
dispositions the ledger too; it just dispositions everything to OPEN's replacements without editing
a stack file. A deliberate non-fix is a decision the ledger records, not a finding left hanging
(measured: a campaign that applied every mechanism it found still left 62 findings reading OPEN,
which reads as unfinished work rather than as the judgment calls they were).

**Two close-out sweeps, both cheap, both in the working tree:**

- **Premise check on any finding about a harness or API feature.** A finding that assumes what a
  frontmatter key, CLI flag, hook event or tool parameter DOES is verified against the current docs
  (context7) before a mechanism is built on it - the verification is what the fix cites (measured: a
  finding asked for `allowed-tools` on a command as a context saving; it is a per-turn permission
  pre-approval that removes no schema, so the fix was to write the verified semantics down, not to
  add the key).
- **Privacy sweep over TRACKED files, not just the audit dir.** The collection's project names and
  every absolute local path are grepped across the whole tracked tree at the close - a leak predates
  the campaign as easily as it arrives with it (measured: one private project name sat in a tracked
  test comment from an earlier release and was only found by the closing sweep). Re-run both
  gitignore checks in the same pass.

---

## Honesty guards

- No finding without a locator - session id, a reachable offset or file, and the number you
  measured. A finding you cannot point to is deleted, not softened.
- Re-derive, never quote. A number taken from a model-written report unverified is a violation even
  when it turns out correct.
- No manufactured findings. An audit of a clean session reports a clean session.
- Respect design decisions. A behaviour the repo records as deliberate is not a finding unless the
  sessions show its rationale no longer holds - cite both.
- One defect, one finding: the same root cause in five sessions is one cluster with five evidence
  lines.
- Report the remainder honestly - bundles skipped, checks not run, claims unverified.
- A claim that something is already fixed is held to the same bar as a claim that it is broken: both
  are read out of the live source in this sitting. The direction of the claim does not change the
  evidence it needs.

## Stop conditions

Stop when the collection is reported and the run was `collect only`; or when every selected bundle
has its audit file, `SUMMARY.md` is written, the routing is answered and no finding anywhere in
`AUDIT_DIR` still reads `status: OPEN` (`grep -rc 'status: OPEN' <AUDIT_DIR>` is the check, and it
is run before the final message). Stop early on a structural
blocker - a collection root that is not gitignored, unreadable bundles, a missing analyzer - and
report what completed and what blocked the rest.

## Output contract

The deliverables are the bundles (when collecting), the per-session audit files and `SUMMARY.md` in
`AUDIT_DIR`, and - when fixes were applied - the stack files edited with the evidence each cites.
The final message is the rollup and the ranked clusters, dense: no preamble, no restating this
prompt.
