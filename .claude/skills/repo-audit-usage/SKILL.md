---
name: repo-audit-usage
description: Use when collecting consuming projects' Claude Code sessions and auditing how the stack did - tokens, gates, skills, docs. Not for one project's own report.
disable-model-invocation: true
---

# Stack usage - collect and audit

One run for the whole loop: gather Claude Code session evidence from consuming projects and audit it
against this stack's source. It replaces the three prompts that used to split this work (collect
inside one project, sweep many projects, audit a collection) - they disagreed about who collects,
where the data already is, and whether reports arrive authored, and a run that guessed wrong wasted a
session. **Every one of those conflicts is now an ANSWERED QUESTION before any analysis starts.**

The counters say what ran and what it cost; the conversation says why. Both are in scope. This is
this repo's own maintenance tool, not part of the shipped catalog.

## When to use

- The user types `/repo-audit-usage` to collect session bundles from consuming projects, audit a
  collection already under `docs/*investigation*/`, or both.
- Not for one project's own usage report - that is the stack's `capture-usage-report` skill, run
  inside that project, whose bundles this audit can collect.

## How the run goes

You operate autonomously AFTER step 0, with one exception - the fix-routing question in Phase C. Do
not ask for confirmation between phases. Stop only on the stop conditions at the end. A decision that
genuinely needs the user mid-run goes through AskUserQuestion with concrete options and a marked
recommendation, never a prose question in a report.

### Step 0 - ask, one question at a time

**Detect first, ask second.** Never ask what the machine can tell you. Before the first question, and
writing nothing, establish and then STATE in the question text:

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
instead of guessing. The chain - which answer opens which question, and each question's options - is
`references/questions.md`; read it before the first ask.

### Ground rules for every phase

- **Absolute paths in every command.** A `cd` persists between calls, so a later relative path
  silently resolves somewhere else - one run wrote a whole bundle tree into a nested copy of its
  own destination and it looked like data loss.
- **Never print analyzer output into the chat.** Every collection command writes to a file - the
  analyzer's own `--out <file>`, never a `>` redirect. Reading full reports back is what drives a
  run's context into the hundreds of thousands.
- **Never read a transcript whole.** Session files run to tens of MB. Count with
  `scripts/analyze-usage.js` (it dedupes usage by message id and finds a bundle's sibling
  `subagents/` itself) and with `jq` / `grep`; then Read only the offsets that need judgment.
- **Privacy wall.** Bundles carry private project names, absolute paths, file contents and
  possibly secrets. Everything quoting them stays inside the audit dir; anything reaching a tracked
  stack file is genericized to 'a consuming project'. Re-run both gitignore checks after copying.
- **Copy, never move.** The audited project owns its data; this run is a reader.

### Phases

1. **Phase A - collect** (skipped entirely when the evidence answer was 'audit what is already
   collected'): follow `references/collect.md`, once per project, by the route the data answer picked.
   On 'collect only', report the collection and stop.
2. **Phase B - audit**: follow `references/audit.md` bundle by bundle, oldest first, writing each
   bundle's audit file before starting the next - it is the resume point. Every finding takes the one
   shape and one of the statuses in `references/findings.md`. Only the main session classifies a
   finding and writes the audit files.
3. **Phase B2 - synthesis**: follow `references/synthesis.md` once the last bundle has its audit file -
   the clusters, `SUMMARY.md` and its four mandatory tables.
4. **Phase C - verdict and routing**, below.

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
  (the documentation server) before a mechanism is built on it - the verification is what the fix cites (measured: a
  finding asked for `allowed-tools` on a command as a context saving; it is a per-turn permission
  pre-approval that removes no schema, so the fix was to write the verified semantics down, not to
  add the key).
- **Privacy sweep over TRACKED files, not just the audit dir.** The collection's project names and
  every absolute local path are grepped across the whole tracked tree at the close - a leak predates
  the campaign as easily as it arrives with it (measured: one private project name sat in a tracked
  test comment from an earlier release and was only found by the closing sweep). Re-run both
  gitignore checks in the same pass.

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
skill.
