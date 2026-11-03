# Alfred Code plugin evals

`claude plugin eval` runs these cases against the plugin and again WITHOUT it, and reports the
delta. Every run is a real, billed model call on your own account.

## Why this suite exists at all

The standing excuse for not evaluating this plugin was that nothing in it is model-invocable: all
six commands and the router skill carry `disable-model-invocation`. That excuse is wrong. A case's
`prompt.md` is a USER turn, which is exactly how a manual-only command is invoked, so a read-only
walk makes a valid case - and its without-arm cannot resolve the command at all, which is the
cleanest delta a suite can produce.

The two cases are read-only in intent, not by construction: neither grants `Write` or `Edit`, and `Bash` only as
`Bash(node:*)` - the stamp script's state read both bodies open with. That grant would let `node -e` write, so
what keeps a run harmless is where it fires: the run's empty, throwaway sandbox working directory, with no install
to change.

## The cases

| case | target | prompt | what it proves |
|---|---|---|---|
| `status-no-install` | the core alone (`--core` bundle) | `/alfred-code:status` | with nothing installed, the command says so and routes to `/alfred-code:init` instead of rendering its fixed table shapes from the command body |
| `router-hands-back-one-command` | the core alone (`--core` bundle) | `/alfred-code` | the router reads the state, names ONE command, and does not start the walk itself |

Both are meant to run against the CORE entry, never `setup-plugin/` alone: the router and the status
command run `node "${CLAUDE_PLUGIN_ROOT}/scripts/install/stamp.js" state .`, and the core's plugin root is
the repo root, where `scripts/` lives - under `setup-plugin/` that path does not exist. On Claude Code
2.1.317 the `alfred-code@envoydev` target resolved to `setup-plugin/` all the same (the 2026-11-03 run below),
so the target is now the core-only bundle (Running it, below).

The three `size-first-*` cases of `task-solve` moved to `meta/evals/library/` in 2.1.4: since 2.1.0
the core carries no stack skill, so only the eval bundle (the core plus the whole library, one plugin)
carries `task-solve`. They are the only cases that write (`Edit` is granted, the floor case
excepted), each into its own scaffolded workspace - `scaffold.sh` beside `case.yaml`, run only under
`--scaffold`.

## Last recorded run - 2026-11-03, 3.7.1 (develop f006d9a4, the core-only bundle)

This run: Claude Code 2.1.317, default model (Sonnet 5.5), `--judge-model claude-haiku-4-5`, 3 runs per arm,
`--allow-tools 'Bash(node:*)'`, target `build-eval-bundle.js --core`.

| case | with | without | delta |
|---|---|---|---|
| `router-hands-back-one-command` | 1.00 | 0.00 | +1.00 |
| `status-no-install` | 1.00 | 0.33 | +0.67 |

Mean delta +0.83 over 12 runs, 86s, $0.83. Every with-arm run passes every grader: the status command reads the
state through the stamp script and routes to `/alfred-code:init` (3 of 3), and the router names one command without
starting the walk (3 of 3). The without-arm's one point is still `no-invented-tables`, which a session with no plugin
passes for free.

**Run before the re-target - 2026-11-03, 3.6.0** (develop d3df8a07, target `alfred-code@envoydev`, which resolved to
`setup-plugin/`, no `Bash` grant): router 0.78 / 0.11 (+0.67), status 0.33 / 0.33 (0.00), mean +0.33 over 12 runs, $0.46 -
the stamp script did not exist under that plugin root and could not run without the grant.

Re-record this table whenever a command body changes; a delta that falls is the command losing its own
contract, and a `with` score under 1.00 is the command failing it outright.

**Earlier run - 2026-09-12** (Claude Code 2.1.269, the graders and target of that day - `/alfred-code:init`,
`setup-plugin/`): router 1.00 / 0.00 (+1.00), status 1.00 / 0.33 (+0.67), mean +0.83 over 12 runs, 112s, $0.84.

## Running it

The target is a FOLDER holding the core alone (D7, 2026-11-03): `alfred-code@envoydev` resolved
`setup-plugin/` on 2.1.317, whose plugin root has no `scripts/`, so it is no target any more.
`build-eval-bundle.js --core` copies the core's commands, router and seats, the trees their bodies name at
the core's own relative paths, and these cases as its `evals/` - tracked files only, so this repo's
machine-local `.mcp.json` cannot load into a case. `--allow-tools` grants what the cases list:

```bash
OUT="$(mktemp -d)/alfred-code-core"
node scripts/build-eval-bundle.js --core "$OUT"
claude plugin eval "$OUT" --allow-tools 'Bash(node:*)' --max-cost-usd 3 --judge-model claude-haiku-4-5 --no-publish   # router + status, the whole dir
claude plugin eval "$OUT" --allow-tools 'Bash(node:*)' --case status-no-install --runs 1 --ablation none --no-publish   # iterate cheaply
```

The table above is the first run against the core-only bundle.

Measured on 2.1.317: `--case '[rs][ot]*'` finds no case (the two cases are the whole dir, so the filter
went); the HTML report is published to claude.ai unless `--no-publish`; the first run in the plugin dir
asks to trust it (`--trust-plugin` answers it unattended); `--keep-temp` keeps each run's
`out/trace.jsonl`, where the with-arm's resolved `${CLAUDE_PLUGIN_ROOT}` can be read back.

The size-first cases run through the eval bundle, which carries the library and, at the core's own
relative paths, the `scripts/`, `meta/`, `stack/` and `setup-plugin/references/` trees its bodies name:

```bash
npm run eval-bundle -- /tmp/alfred-code-bundle
claude plugin eval /tmp/alfred-code-bundle --case 'size-first-*' --scaffold --max-cost-usd 5
```

Two things measured on 2.1.269 that the docs page does not spell out, so do not re-derive them: a
`regex` grader's `target` accepts `last_message` (the default) and `files`, and a plain string like
`final_message` fails case validation with `graders.N.target: Invalid input`; and `--max-cost-usd`
is checked BEFORE each run launches, so a ceiling below one run's cost still pays for the first one.

`results/` is gitignored - the artifact is machine-local and re-dated every run. The table above is
the part worth keeping.
