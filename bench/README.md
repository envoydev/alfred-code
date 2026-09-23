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
node bench/drive.js --run <id> --resume
node bench/grade.js <id>
node bench/aggregate.js <id> [--reference <opus-run-id>] [--flow <flow-run-id>]
```

- `drive.js` takes one lock per run, builds each arm's template once per pin (setup, then onboarding,
  in the template's own account dir and home), and runs the cells in a seeded order that interleaves
  the arms. A resume runs only unfinished cells, and refuses when an arm, a task or the Claude Code
  version changed since the run started. It needs `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` set,
  and runs on macOS and Linux only.
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
- The setup routes: `ours`' selection matches a real `/claude-stack:init` walk on the fixture, and
  ECC's hook-profile variables reach its hooks.
- A copied account dir resolves: each arm's plugins load from the cell's own config.
- Package restore time per cell, with a HOME of its own.
- `--mode flow` stays refused until its scripted approver is built from what these transcripts show.
