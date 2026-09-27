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
| `arms/<arm>.json` | an arm: its pin, setup commands, onboarding prompts, its own env, an env its onboarding alone gets (`onboardingEnv`) and its flow entry per task kind (`flow`) - never a session field |
| `arms/harness.settings.json` | the sandbox layer every session runs inside |
| `arms/ecc-vocabulary.txt` | ECC's skill, agent and command names at the commit `arms/ecc.json` pins, for the prompt lint |
| `arms/ours-vocabulary.txt` | our names at the release `arms/ours.json` pins, for the prompt lint - this tree may carry an older release |
| `tasks/<id>/` | `prompt.md`, `meta.json`, `hidden/` (the acceptance tests and `grade.json`, never in a session's clone), `reference.patch` (a correct solution, for the proof only) and any setup patches `meta.setup` names |
| `drive.js`, `grade.js`, `aggregate.js` | run, grade, report |
| `lint-prompts.js` | refuses a prompt naming either stack's machinery; part of `npm test` |
| `prove-tasks.js` | the free solvability proof: hidden tests fail at the start, pass on the reference, suite green |
| `lib/` | the pieces, each with its own `*.test.js` |
| `test/` | the fake `claude`, the fake Agent SDK and the throwaway world the tests run on |

## Running it

Every session calls the model and is billed: B3, B4 and B5 each show their cell count and estimated
dollars and ask first.

```
node bench/drive.js --arms ours,ecc,bare --tasks all --reps 3 --parallel 3 [--seed n] [--run id]
                    [--auth <name>] [--wait-on-limit <hours>] [--work-root <dir>]
node bench/drive.js --run <id> --resume
node bench/drive.js --run <id> --mode flow --arms ours,ecc,bare --tasks <the four flow tasks> --reps 2 [...]
node bench/grade.js <id>
node bench/aggregate.js <id> [--reference <opus-run-id>] [--flow <flow-run-id>]
```

- `drive.js` takes one lock per run, builds each arm's template once per pin (setup, then onboarding,
  in the template's own account dir and home), and runs the cells in a seeded order that interleaves
  the arms. Templates and cell work dirs live under the WORK ROOT, `$TMPDIR/alfred-bench-work` unless
  `--work-root` names another, recorded in `run.json` and kept by a resume. Claude Code reads
  `CLAUDE.md`, `CLAUDE.local.md` and `.claude/` from every directory above the one a session starts in,
  so a work root with any of them above it is refused, and so is every template and cell under one -
  the first pilot ran its cells inside this repository and every arm loaded its rules. A resume runs only unfinished cells, and refuses when an arm, a task or the Claude Code
  version changed since the run started. It needs ONE credential set - `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN` or the subscription's `CLAUDE_CODE_OAUTH_TOKEN`, or `--auth <name>` choosing
  one when several are - recorded by name in `run.json`, and runs on macOS and Linux only. Each cell's
  session runs in a compose project of its own (`COMPOSE_PROJECT_NAME`, a neutral `cell-<hash>`), and the
  driver runs `docker compose -p <it> down -v` before the session and again after it - that project only,
  recorded in `session.json` (`compose`) - so no cell reaches another's database (pilot 3: one `repo`
  project for every cell). Each session also runs under a settings layer of its own, written to its work dir
  (`lib/reads.js`): the shared sandbox plus `denyRead` for this checkout (and the main checkout a worktree
  sits in) and the whole work root - every other cell of every run, every template - with the cell's own
  work dir, the plugin code its account dir loads from outside it (its `.git` still denied) and the shared uv
  store re-opened; the narrower rule wins. `session.json` records the lists (`reads`).
- `grade.js` grades serially under the run's lock. Each cell is re-created from its template, checked
  against the baseline its session recorded, patched, and tested with the task's hidden files. The
  patch is the task's change alone: a session's `diff.patch` leaves out the top-level folders the
  stacks keep for themselves (`.alfred`, `.claude`, `.memory-mcp`, `.playwright`, `.serena` - docs
  roots, hook ledgers, the LSP cache), the same for every arm, and `state.txt` beside it names what
  changed there. What
  the harness caused - over 50 failing tests with a connection error, a grader timeout, a changed
  baseline - is infrastructure, queued in `regrade.json`, never counted as the arm's fail.
- `aggregate.js` writes `results/<id>/report.md` and `metrics.json`: the headline table, one per
  group, `guard` and `home-advantage` apart, the verdict in the rule's own words, and the three worst
  tasks per arm.
- The Opus reference column is its own run: `--model claude-opus-5-5 --effort high --arms bare`.
- `--mode flow` is the flow block, its own run on the same templates: only the tasks whose `meta.json`
  names a `kind` (`feature`, `cross`, `bug` - the four the pre-registration names), each cell sending
  its arm's own entry for that kind (`flow` in the arm file) through the Agent SDK
  (`lib/flow.js`) against the same installed CLI, with a scripted approver: every `AskUserQuestion`
  gets the option labelled '(Recommended)', else the first, and every other permission request print
  mode's refusal (its words where the CLI hands them over; `approvals.jsonl` keeps the CLI's reason
  beside each one); `ExitPlanMode` is a stop answered with its first option (the plan approved, one
  row each) and `EnterPlanMode` is let through. The first turn waits for the MCP servers as print mode's does (2 s,
  `CLAUDE_CODE_MCP_STARTUP_WAIT_MS`). The prompts go one after another in one session, each once the turn before it
  has a result; `{file:<path>}` in a prompt is the one file that path names in the clone when it is
  sent (ours' diagnoser names its findings file as the build's input). `approvals.jsonl` beside each
  cell's `stdout.jsonl` holds every answer and refusal. It needs the SDK installed (`npm install` at
  the repo root - an exact dev dependency, the release built for the CLI the run drives; another is
  refused), and a resume keeps the run's mode and refuses a changed flow entry or SDK. Grading is the
  plain block's; `aggregate.js <plain-id> --flow <flow-id>` reports it beside the plain block, never
  merged.

A task's start state is its `startRef` plus `meta.setup`: patches applied in order, each left
uncommitted (`{ "patch" }`) or committed on a new branch with a fixed author and date
(`{ "patch", "commitOn", "message" }`). The session and the grader build it through the same
function, so the grader's baseline check covers it, and a changed patch refuses a resume.

```
node bench/lint-prompts.js
node bench/prove-tasks.js [--tasks all|<id,id>|group:<g>]
```

## What stays out of git

`bench/results/` (transcripts, diffs, grades, reports) is gitignored, and the templates and cell work
dirs live outside the repository, under the work root. Publishing any result is the user's decision.

What the harness writes is kept clean of credentials: sessions get an allowlisted env with auth
passed by name, every auth value is redacted from what lands in `results/`, and each cell's work dir -
which holds its raw account dir - is deleted as soon as the cell ends.

## What B4 must verify before any measured cell

- **D4, the host protection.** The fixture suite passes inside `harness.settings.json`'s sandbox,
  and a probe `rm` outside the clone is refused, on every arm. Measured on 2026-09-26 (bare, one Sonnet
  session): build, 26 integration tests, `npm ci`, lint and 25 web tests pass; a write to the real home
  and an `rm` beside the clone are refused. What it took: `docker *` and `dotnet *` run outside the
  sandbox (the pattern form - a bare name matches only the bare command), each with its
  `permissions.allow` rule because an excluded command meets the ordinary permission flow; MSBuild
  binds a socket the sandbox refuses, so dotnet joins docker as the second host-equivalent hole, by the
  owner's decision. The cell's own home is writable (`~`, npm's cache), npm reaches its registry, NuGet
  restores once per template (`common.json` `restore`), and the three MSBuild switches keep parallel
  cells from sharing a build node. An exclusion matches a LEADING command only, so the compound forms
  a session writes (`cd src && dotnet build | tail`) run sandboxed: a `dotnet` shim first on every
  session's PATH (`lib/dotnet-shim.js`) runs build, test, publish, pack and msbuild in one MSBuild node
  with no node reuse (`-m:1 -nodeReuse:false`; `run` is left alone - it hands unknown tokens to the app),
  and local unix sockets are allowed (`allowAllUnixSockets`, the owner's answer) so a sandboxed
  `docker build` or Testcontainers reaches the daemon. Each session has its own temp dir under `/tmp`
  (`TMPDIR` and `CLAUDE_CODE_TMPDIR`), so parallel cells never share `/tmp/claude-<uid>`. Re-measured
  2026-09-26 (bare, one Sonnet session, `b4-probe-d4`): sandboxed `TMPDIR=/private/tmp/bench-<id>/claude-501`,
  `cd src && dotnet build ../LendingDesk.slnx | tail -3` 0 errors in 16 s, a piped `docker build` done;
  a write beside the clone refused (`b4-probe-d8`). CLI 2.1.283 runs a piped (`dotnet test X | tail`)
  or compound (`cd X && dotnet test`) test command INSIDE the sandbox, although the settings reference
  says any matching part of a compound command unsandboxes it (`b4-probe-tmp`), and there it failed
  twice. vstest aborted after 90 s ('failed to connect to testhost'): the macOS profile admits a
  loopback connect to `127.0.0.1` but not to `::ffff:127.0.0.1`, which a dual-stack .NET socket dials.
  And the integration suite hung on its second `WebApplicationFactory` host, in `FileSystemWatcher`.
  `DOTNET_SYSTEM_NET_DISABLEIPV6=1` and `DOTNET_USE_POLLING_FILE_WATCHER=1` in `common.json` fix both
  without widening the sandbox - measured 2026-09-26 with the CLI's own sandbox runtime
  (`@anthropic-ai/sandbox-runtime` 0.0.77, this file's settings, `cd tests && dotnet test ...`): 18 unit
  tests in 1 s and 26 integration tests (Postgres through Testcontainers) in 8 s, against a 90 s abort
  and a hang without them. `dotnet ef` builds through the muxer beside the running dotnet, never the shim,
  and MSBuild's worker node binds its pipe at `/tmp/MSBuild<pid>`, which the sandbox refuses: pilot 3's
  data cells hung 120-302 s there. `BuildInParallel=false` in `common.json` reaches every build as an MSBuild
  property, so no route starts a worker node - measured 2026-09-27 with the same runtime: `dotnet ef
  migrations add X --project src/LendingDesk.Data | tail` done in 3 s, the Api as startup project answers
  its real error in 6 s, and with the property set back to `true` the same command hangs. `ng build`
  aborted (134) on the unchanged baseline: Angular's persistent build cache opens an lmdb store, lmdb takes
  a SysV semaphore the sandbox profile refuses (`ipc-sysv-sem`; the same profile with that one operation
  allowed opens it), and lmdb's error path then frees an unallocated pointer. Angular keeps that disk cache
  off when `CI` is set, so `common.json` `bashEnv` sets it for Bash commands alone - a file Claude Code
  sources before each one (`CLAUDE_ENV_FILE`), never the CLI, its hooks or its MCP servers. Measured
  2026-09-27: a piped `npm run build` in the sandbox printed `Building...` and stopped (no `dist`) without
  it, and completed in 11 s with it - through the runtime and through the real CLI; the 25 web tests pass.
- **D8, workspace trust.** Measured 2026-09-26 (`b4-probe-d8`, `ours`, `--include-hook-events`): a
  forced `general-purpose` dispatch fired `SubagentStart` and `SubagentStop` (both exit 0), and stderr
  carried no untrusted-workspace warning - no trust entry is written. Print mode never applies a
  project `.claude/settings.json` allow rule, which is why the grants go into the local settings file.
- Every arm's machinery loaded: ten transcripts read end to end.
- The setup routes: `ours`' selection matches a real `/alfred-code:setup` walk on the fixture; its
  onboarding, `/alfred-code:init` with `ALFRED_CODE_UNATTENDED=1` (its unattended mode: every ask
  takes the recommended option, never a destructive one), runs the captures it carries in print mode
  (its onboarding transcript); ECC's hook options, stored as `pluginConfigs` by `--config`, reach its
  hooks. Each arm names what its onboarding must leave in the clone (`expects` - `ours`: the
  architecture capture under `.alfred/docs`; `ecc` and `bare`: `CLAUDE.md`), and a template without
  it is refused, its onboarding kept at `<template>.failed` to read.
- Every template is what a user who set the arm up by hand would have, by one rule for every arm:
  after setup the CLI's own `claude plugin list --json` and the registered servers decide the grants
  written to the clone's `.claude/settings.local.json` - every tool of each MCP server the arm
  installed (`mcp__plugin_<plugin>_<server>__*`, `mcp__<server>__*`) and reads of its own plugin code
  and marketplaces, the 'always allow' answers print mode cannot give (an untracked local file applies
  without workspace trust; a project `settings.json` allow rule does not). Then `claude mcp list` with
  a ten-minute `MCP_TIMEOUT` starts each server once, so the ONE uv cache and Python store under the
  work root (`UV_CACHE_DIR`, `UV_PYTHON_INSTALL_DIR`, shared by every template and cell) is warm and a
  session's server connects inside the 30 s default. `plugins.json` (the list after onboarding),
  `grants.json` and `mcp-warm.txt` sit beside READY and are copied to `results/<run>/onboarding/<arm>/`
  - the third-party plugins a template pulls (`claude-hud`, the two LSP plugins) are not covered by
  the arm's pin, so that list is the record. Last, what setup and onboarding left in the clone is
  committed once, as a user commits a fresh install: `chore: project setup`, the same rule for every arm, by
  a fixed identity set for that command alone, with `.claude/settings.local.json` kept out through the
  clone's own `info/exclude` (Claude Code keeps that file out of git when it writes it, and a tracked one
  needs workspace trust). The lock then checks the commit it sits on, a cell starts on it (pilot 3's ~150
  untracked install files drove 19 commit-gate denials), and the graded diff still starts at the cell's own
  base tree.
- A copied account dir resolves: each arm's plugins load from the cell's own config.
- Package restore time per cell, with a HOME of its own.
- The flow block's approver: one flow cell per arm, each transcript read end to end - every ask
  answered, no stall, the flow reaches its build, `approvals.jsonl` matches the asks (`b4-probe-flow-*`).

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

`ours` checks out its pinned candidate commit from this clone, so the commit must be reachable here
(`git cat-file -e <pin>^{commit}`); until it is, its template fails at the checkout step. 3 arms x 6 tasks (one per group) x 2 reps =
36 cells plus two onboardings. Plan estimate: about $110-150 and 5-6 hours at parallel 3.

```
node bench/drive.js --run b4-pilot --arms ours,ecc,bare --tasks api-01-loan-renewal,web-01-loan-date-rules,data-01-item-retired-at,devops-01-worker-image,cross-01-overdue-contacts,guard-01-member-reinstate --reps 2 --parallel 3
node bench/grade.js b4-pilot
node bench/aggregate.js b4-pilot
```

Then the checks in 'What B4 must verify' above, ten transcripts read end to end. A harness fix after
this point is fine; a change to a task or an arm re-hashes the pre-registration.

A second run, pilot 3, follows the harness fixes above and the stack's own fixes: one harder task per
group, picked from the Opus proof run's wall time (`b3-proof`) - pilot 2's six solved too easily to
tell the arms apart. `ours` is re-pinned to the stack branch's head first (`arms/ours-vocabulary.txt`
regenerated from it, the pre-registration re-hashed).

```
node bench/drive.js --run b4-pilot-3 --arms ours,ecc,bare --tasks api-03-member-notices,cross-02-late-return-event,data-02-loans-cursor-feed,devops-01-worker-image,web-03-check-in-guard,guard-02-reminder-lead-time --reps 2 --parallel 6 --wait-on-limit 12 --auth CLAUDE_CODE_OAUTH_TOKEN
node bench/grade.js b4-pilot-3
node bench/aggregate.js b4-pilot-3
```

Then the flow block as its own run over the four flow tasks, graded the same way and reported beside
the plain one:

```
node bench/drive.js --run b4-pilot-3-flow --mode flow --arms ours,ecc,bare --tasks api-02-last-copy-race,api-03-member-notices,cross-02-late-return-event,data-02-loans-cursor-feed --reps 2 --parallel 6 --wait-on-limit 12 --auth CLAUDE_CODE_OAUTH_TOKEN
node bench/grade.js b4-pilot-3-flow
node bench/aggregate.js b4-pilot-3 --flow b4-pilot-3-flow
```

### B5 - the measured run

After B4 is closed. The pre-registration hash is recorded at the run's start and
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
include the `flow` block (48 cells with `baseline`, 36 without), a `--mode flow` run of its own over
the four flow tasks; `baseline` names no flow entry yet, so a flow run naming it is refused until one
is added. The cheaper cut,
about $600: `--arms ours,ecc,bare` over the twelve headline ids plus the three `guard-*` ids.
