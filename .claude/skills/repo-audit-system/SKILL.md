---
name: repo-audit-system
description: Use when auditing Alfred Code as one system - conflicts across its parts, token budget, hook value, safety, fresh-session context, its own packaging.
disable-model-invocation: true
---

# Alfred Code system audit

You are the integration engineer for a Claude Code stack. Every other audit in this repo judges ONE part -
the skills, the hooks, the rules, the agents, the CLAUDE.md template, the plugins it installs. You judge
what none of them sees: the install as ONE working system, the way a fresh session meets it. A session is
sent the always-on rules, the AGENTS.md chain, two listings (skills, agents), the hook injections at
session start, per turn, at a seat's dispatch and after compaction, the path rules as files open, and it
acts under the guards on every tool call. The stack works only when those parts agree with each other,
cost what they are worth, guard every route to a dangerous action, and leave a new chat knowing the
project without digging.

Five questions, one dimension each: do the parts conflict; is the context enough and not too much; do the
hooks earn their cost; is every dangerous action guarded on every route; does a fresh session have the
project's facts stated. The stack's own plugin packaging - manifest, marketplace, versioning, validate,
evals - is graded beside them. Measure on throwaway installs of THIS working tree, one per tech profile,
plus the recorded session corpus; never on a real consuming project, never by a billed live session.

It is this repo's own maintenance tool, not part of the shipped catalog.

## When to use

- The user types `/repo-audit-system` to audit the Alfred Code stack as a whole.
- Not for one part's own quality - that part's audit (`/repo-audit-skills`, `-hooks`, `-rules`, `-agents`,
  `-claude-md`) - nor for the third-party plugins themselves (`/repo-audit-plugins`) or a consuming
  project's session log (`/repo-audit-usage`). A defect found inside one part is handed to its audit.

## Parameters

- `STACK_ROOT`: the stack repository (default: `.`).
- `PROFILES`: the tech profiles to install (default: every `stacks` key of `meta/recommendations.json` plus `bare` - `node scripts/profile-fixture.js --help` lists them; a key with no markers fails its test).
- `WORKDIR`: where the fixtures go (default: a `system-audit` folder in the session scratchpad; never inside a real project). Everything in it is test data, deleted at the run's end.
- `RESULTS`: where the run's results stay (default: `<docs-path>/audits/<YYYY-MM-DD>/system/` - this repo's docs root, `.alfred/docs` unless `ALFRED_CODE_DOCS_PATH` names another; machine-local, never committed).
- `CORPUS`: a sessions collection root (optional; without it S2, S3 and S5 score their static side only and each says so).
- `WINDOW`: the context window, in tokens, the skill listing budget is judged at (default: `200000`).
- `OWN_PLUGIN_ROOT`: the plugin the stack ships (default: the core `alfred-code` entry - generated into `./meta/plugin-entries.json` by `scripts/build-marketplace.js` and sourced from the repo root, its components declared in the entry; `./setup-plugin` holds its commands, its router skill, its own hooks, its eval cases and the `plugin.json` whose `version` the release tags). The ten generated MCP entries (`scripts/build-marketplace.js --mcp-entries`, from `meta/mcp-pins.json`) are its packaging too; the upstream package each launches is `/repo-audit-plugins`' D3.
- `MARKETPLACE`: the stack's own marketplace file (default: `./.claude-plugin/marketplace.json`).
- `TARGET`: minimum grade (default: `A` / `9`).

## How the run goes

Autonomous through the report; one ask before any edit; nothing on a machine outside the fixtures.

1. **Principles.** Read `references/principles.md` first - it defines a defect for every later phase.
2. **Phase 0 - discovery** (`references/discovery.md`). Edit nothing. Install one fixture per profile
   (`scripts/profile-fixture.js`), map each (`scripts/session-surface.js --run-hooks --json`), read the
   corpus and the hook-blocks ledger, then build the conflict map, the guard-route map and the
   awareness checklist.
3. **Phase 1 - scoring.** S1-S5 per profile and the packaging grade (`references/rubric.md`), every
   point citing its line or row. Produce the baseline report (the output contract) before any proposal.
4. **Phase 1b - currency.** Re-read each fact row of `references/currency.md` against the live pages
   before scoring with it; correct a DRIFTED row in the same run.
5. **Phase 2 - one ask** (`references/remediation.md`): the fix list, most severe first, each row with
   both sides, the chosen home and the files, or a handoff. Stop for the answer.
6. **Phase 3 - apply and verify**, below, for what the answer picked.
7. **Results and cleanup**, below - on every exit: after Phase 3, after a 'Report only', and after a run a failed
   install stopped.

## Phase 3 - Verification

1. Snapshot every file before its edit into `RESULTS/snapshot/`; `npm run lint` plus the tests that cover each edit, green before the next.
2. Re-install every profile a fix touches from the edited tree and re-run `session-surface.js` on it; diff the map against the baseline: each fix's claimed row, flag or total moves the way it said, and nothing else moves.
3. The temp-project matrix per the repo `CLAUDE.md` for every shipped file the fixes changed - fresh, update over the last release, re-run, the user's own config kept, malformed input, every scope touched.
4. Packaging: `claude plugin validate --strict` on the plugin and the marketplace root, `claude --plugin-dir <root> plugin details <name>` read with its caveats, and the `claude plugin eval` with / without delta (`setup-plugin/evals/`) where a fix touched a command or the router skill.
5. A claim that rests on the corpus (a false-block rate, a re-read count, an unused surface) is PENDING until sessions recorded after the change say it moved; report it so, never as proven by the edit.
6. Re-score from scratch and record the final grades with the same evidence-cited scoring.

If an edit moved a row it did not claim, or broke an install closure, restore it from the snapshot and report it as unresolved with the reason.

## Results and cleanup

The results stay in the docs; the test data is deleted once the last check that reads it has run.

- **Kept, under `RESULTS`** - each written as soon as it exists:
  - `checklist.md` - the awareness checklist, at Phase 0 step 1, before any map is read;
  - `maps/<profile>.baseline.json` as each map is made, and `maps/<profile>.final.json` from the Phase 3 re-run - the
    `session-surface.js --json` output, which prints no machine path;
  - `report.md` - the output contract below, written before the ask and completed after the apply: the baseline, the ask
    and its answer, the before / after diff, the final grades, what was not run;
  - `snapshot/` - every edited file as it was before its edit, the rollback.
- **Deleted:** every fixture (project, account dir, the shared home), every export, every matrix project and probe
  capture - `node scripts/profile-fixture.js --clean <WORKDIR>`, which removes only what the fixture script writes and
  prints `removed:` and `left:`; then whatever else this run put in `WORKDIR` (a matrix copy, a helper script). An install
  log is test data: quote a failed step into `report.md` before the cleanup.
- **Proven gone:** `WORKDIR` no longer exists (or `left:` names only what this run did not create), no
  `session-surface-*` folder sits in the OS temp dir (`find <tmp> -maxdepth 1 -name 'session-surface-*'` - a bare glob
  aborts under zsh), and no `WORKDIR` path appears in the real account's `plugins/installed_plugins.json`,
  `plugins/known_marketplaces.json` or `.claude.json`.

## Stop conditions

- Every profile at A / 9 on S1-S5, the packaging grade at A / 9, all verified; or
- Every remaining sub-A dimension is a handoff, a user's 'Report only', a PENDING corpus claim, or a blocker a guard forbids fixing.

Report the remainder at its real grade.

## Output contract

One report in the conversation, dense, no preamble, no restating this skill:

1. Profile table: `profile`, session-start chars split house / generated / plugin, a turn, the biggest dispatch, after compaction, flags, S1-S5, grade; the system grade (the lowest profile's) under it.
2. Conflict map: one row per relation - `contradicts` / `duplicates` / `collides` / `blocks` / `dangling` / `shadows` - both sides quoted with file and line, the profiles it appears in, the resolution or the handoff.
3. Safety gaps: action, the route that reaches it, the guard or deny that is missing, BLOCKER marked.
4. Awareness checklist per profile: each fact, where it is stated (row and file) or `missing`, before init and after.
5. Packaging block: A1-A5 with cited deductions; the validate, details and eval lines quoted.
6. Handoff rows: target audit, the part, the defect, the evidence.
7. The Phase 1b currency table with this run's verdicts.
8. The ask; after an apply, the before / after surface diff per profile, the files changed and the snapshot location.
9. The results line: the `RESULTS` path, and the cleanup - what `--clean` removed, what was left, the leftover checks.
