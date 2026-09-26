# bench - the head-to-head benchmark

The measured comparison of this stack against ECC and against Claude Code alone, on one public,
purpose-built fixture. Repo tooling: nothing here is installed into a consuming project, and it bumps
no version. The plan it implements - arms, tasks, metrics and the decision rule - is pre-registered
in `PREREGISTRATION.md` before any measured run, and `aggregate.js` refuses to report against a copy
changed since the run started.

## Layout

| Path | What it is |
|---|---|
| `fixture.lock`, `fixture/` | the fixture tag every cell clones, its commit, and the verifier that refuses anything else |
| `arms/common.json` | the ONE session every arm runs: model, effort, permission mode, settings layer, env |
| `arms/<arm>.json` | an arm: its pin, setup commands, onboarding prompts and its own env - never a session field |
| `arms/harness.settings.json` | the sandbox layer every session runs inside |
| `arms/ecc-vocabulary.txt` | ECC's skill, agent and command names at the commit `arms/ecc.json` pins, for the prompt lint |
| `arms/ours-vocabulary.txt` | our names at the release `arms/ours.json` pins, for the prompt lint - this tree may carry an older release |
| `tasks/<id>/` | `prompt.md`, `meta.json`, `hidden/` (the acceptance tests and `grade.json`, never in a session's clone), `reference.patch` (a correct solution, for the proof only) and any setup patches `meta.setup` names |
| `drive.js`, `grade.js`, `aggregate.js` | run, grade, report |
| `lint-prompts.js` | refuses a prompt naming either stack's machinery; part of `npm test` |
| `prove-tasks.js` | the free solvability proof: hidden tests fail at the start, pass on the reference, suite green |
| `lib/` | the pieces, each with its own `*.test.js` |
| `test/` | the fake `claude` and the throwaway world the tests run on |

## Running it

Every session calls the model and is billed: B3, B4 and B5 each show their cell count and estimated
dollars and ask first.

```
node bench/drive.js --arms ours,ecc,bare --tasks all --reps 3 --parallel 3 [--seed n] [--run id]
                    [--auth <name>] [--wait-on-limit <hours>]
node bench/drive.js --run <id> --resume
node bench/grade.js <id>
node bench/aggregate.js <id> [--reference <opus-run-id>] [--flow <flow-run-id>]
```

- `drive.js` takes one lock per run, builds each arm's template once per pin (setup, then onboarding,
  in the template's own account dir and home), and runs the cells in a seeded order that interleaves
  the arms. A resume runs only unfinished cells, and refuses when an arm, a task or the Claude Code
  version changed since the run started. It needs ONE credential set - `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN` or the subscription's `CLAUDE_CODE_OAUTH_TOKEN`, or `--auth <name>` choosing
  one when several are - recorded by name in `run.json`, and runs on macOS and Linux only.
- `grade.js` grades serially under the run's lock. Each cell is re-created from its template, checked
  against the baseline its session recorded, patched, and tested with the task's hidden files. What
  the harness caused - over 50 failing tests with a connection error, a grader timeout, a changed
  baseline - is infrastructure, queued in `regrade.json`, never counted as the arm's fail.
- `aggregate.js` writes `results/<id>/report.md` and `metrics.json`: the headline table, one per
  group, `guard` and `home-advantage` apart, the verdict in the rule's own words, and the three worst
  tasks per arm.
- The Opus reference column is its own run: `--model claude-opus-5-5 --effort high --arms bare`.

A task's start state is its `startRef` plus `meta.setup`: patches applied in order, each left
uncommitted (`{ "patch" }`) or committed on a new branch with a fixed author and date
(`{ "patch", "commitOn", "message" }`). The session and the grader build it through the same
function, so the grader's baseline check covers it, and a changed patch refuses a resume.

```
node bench/lint-prompts.js
node bench/prove-tasks.js [--tasks all|<id,id>|group:<g>]
```

## What stays out of git

`bench/results/` (transcripts, diffs, grades, reports) and `bench/work/` (templates and cell work
dirs) are gitignored. Publishing any result is the user's decision.

What the harness writes is kept clean of credentials: sessions get an allowlisted env with auth
passed by name, every auth value is redacted from what lands in `results/`, and each cell's work dir -
which holds its raw account dir - is deleted as soon as the cell ends.

## What B4 must verify before any measured cell

- **D4, the host protection.** The fixture suite passes inside `harness.settings.json`'s sandbox,
  and a probe `rm` outside the clone is refused, on every arm.
- **D8, workspace trust.** A subagent hook fires in `ours` under print mode. If it stays silent,
  write Claude Code's trust entry into every cell, for every arm alike.
- Every arm's machinery loaded: ten transcripts read end to end.
- The setup routes: `ours`' selection matches a real `/alfred-code:setup` walk on the fixture; its
  onboarding, `/alfred-code:init`, runs the captures it carries in print mode, where its asks cannot
  be answered (its onboarding transcript, and `architecture/ARCHITECTURE.md` under the template's
  docs root); ECC's hook options, stored as `pluginConfigs` by `--config`, reach its hooks.
- The third-party plugins each template pulls at build time (`claude-hud`, the two LSP plugins) are
  not covered by the arm's pin: record `claude plugin list --json` per template beside its READY file.
- A copied account dir resolves: each arm's plugins load from the cell's own config.
- Package restore time per cell, with a HOME of its own.
- `--mode flow` stays refused until its scripted approver is built from what these transcripts show.

## What runs free, and what runs billed

Free - no model, no credential. Run before any billed phase; the prove step needs Docker.

```
node --test bench/*.test.js bench/lib/*.test.js bench/fixture/*.test.js
node bench/lint-prompts.js
node bench/prove-tasks.js --tasks all
```

Every billed phase needs, in the shell that runs `drive.js`:

- **A credential, by name:** `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` (billed to the Console), or
  `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` (the owner's subscription), exported by the user in
  their own terminal (never pasted into a session). Exactly one reaches the sessions: with several set,
  `drive.js` refuses until `--auth <name>` picks one, because in print mode an API key outranks the
  subscription token. `drive.js` refuses without one, and a resume under another; `grade.js`,
  `aggregate.js` and `prove-tasks.js` never read it.
- **Docker running:** `open -a Docker` on macOS, then wait until `docker info` exits 0. Every task's
  suite runs the fixture's integration tests on Testcontainers, so `grade.js` and `prove-tasks.js`
  fail without it. Sessions do not need it.
- **One Claude Code version for the whole phase:** `claude --version` at the start; a resume refuses
  when it changed.
- A billed run that stops part-way is finished with `node bench/drive.js --run <id> --resume`. Grade
  again until `results/<id>/regrade.json` is empty: each pass re-grades the infrastructure cells.
- **A usage limit is not the arm's fail.** On a subscription the plan's limit ends every later session
  with an error. A cell whose last result is a limit (`bench/lib/limit.js`) is set aside unfinished
  under `results/<id>/limited/` (never graded), and the queue stops taking cells. With
  `--wait-on-limit <hours>` the drive probes every 20 minutes and carries on once the limit clears,
  re-running the set-aside cells first; without it, or past those hours, it prints the resume line.
  The pattern is not verified against a real limit, so at every phase end list the cells that did not
  end `ok` and read each `error` cell's last result: a limit it missed is moved into `limited/` by
  hand, its shape added to `lib/limit.test.js` and the pattern fixed before the resume.

The task ids: headline 12 - `api-01-loan-renewal`, `api-02-last-copy-race`, `api-03-member-notices`,
`api-04-member-self-lending`, `web-01-loan-date-rules`, `web-02-members-store`,
`web-03-check-in-guard`, `data-01-item-retired-at`, `data-02-loans-cursor-feed`,
`devops-01-worker-image`, `cross-01-overdue-contacts`, `cross-02-late-return-event`; `guard` 3 -
`group:guard`; `home-advantage` 5 - the `home-*` ids.

### B3 task 11 - the billed solvability proof

`bare` on Opus at high effort, every task once, graded. Plan estimate: about $60-90. Duration, from
the task limits (the plan gives none): 20 cells of 30-40 minutes at parallel 3 is at most about 4.5
hours of sessions, then serial grading. One cell first, to read its transcript for the D4 sandbox
check before paying for twenty.

```
node bench/drive.js --run b3-probe --model claude-opus-5-5 --effort high --arms bare --tasks api-01-loan-renewal --reps 1
node bench/grade.js b3-probe
node bench/drive.js --run b3-proof --model claude-opus-5-5 --effort high --arms bare --tasks all --reps 1 --parallel 3
node bench/grade.js b3-proof
```

A task no correct Opus run solves inside its limit is rewritten, or its limit revisited, before B4 -
and either change re-hashes `PREREGISTRATION.md`.

### B4 - the pilot

Needs the `v2.0.0` tag in this clone (`git tag -l v2.0.0`), because `ours` clones it: until the
release is tagged, its template fails at its first step. 3 arms x 6 tasks (one per group) x 2 reps =
36 cells plus two onboardings. Plan estimate: about $110-150 and 5-6 hours at parallel 3.

```
node bench/drive.js --run b4-pilot --arms ours,ecc,bare --tasks api-01-loan-renewal,web-01-loan-date-rules,data-01-item-retired-at,devops-01-worker-image,cross-01-overdue-contacts,guard-01-member-reinstate --reps 2 --parallel 3
node bench/grade.js b4-pilot
node bench/aggregate.js b4-pilot
```

Then the checks in 'What B4 must verify' above, ten transcripts read end to end. A harness fix after
this point is fine; a change to a task or an arm re-hashes the pre-registration.

### B5 - the measured run

After B4 is closed and 2.0.0 is released. The pre-registration hash is recorded at the run's start and
`aggregate.js` refuses a copy changed since.

```
node bench/drive.js --run b5 --arms ours,ecc,bare,baseline --tasks all --reps 3 --parallel 3
node bench/drive.js --run b5-opus --model claude-opus-5-5 --effort high --arms bare --tasks api-01-loan-renewal,api-02-last-copy-race,api-03-member-notices,api-04-member-self-lending,web-01-loan-date-rules,web-02-members-store,web-03-check-in-guard,data-01-item-retired-at,data-02-loans-cursor-feed,devops-01-worker-image,cross-01-overdue-contacts,cross-02-late-return-event --reps 2 --parallel 3
node bench/grade.js b5
node bench/grade.js b5-opus
node bench/aggregate.js b5 --reference b5-opus
```

Plan estimate, tail included: $1,370 with `baseline` (316 cells), $1,050 without it (243 cells, drop
`baseline` from `--arms`), 30-40 hours of wall time at parallel 3 with serial grading. Those totals
include the `flow` block (48 cells with `baseline`, 36 without), which stays refused until B4 builds
its scripted approver (D11) - until then the runnable part is that much smaller. The cheaper cut,
about $600: `--arms ours,ecc,bare` over the twelve headline ids plus the three `guard-*` ids.
