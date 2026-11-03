# Alfred Code plugin evals

`claude plugin eval` runs these cases against the plugin and again WITHOUT it, and reports the
delta. Every run is a real, billed model call on your own account.

## Why this suite exists at all

The standing excuse for not evaluating this plugin was that nothing in it is model-invocable: all
six commands and the router skill carry `disable-model-invocation`. That excuse is wrong. A case's
`prompt.md` is a USER turn, which is exactly how a manual-only command is invoked, so a read-only
walk makes a valid case - and its without-arm cannot resolve the command at all, which is the
cleanest delta a suite can produce.

The two cases here are READ-ONLY by construction: neither grants `Bash`, `Write` or `Edit`, so no run can
install anything, and both fire in the run's empty sandbox working directory where there is no
install to change.

## The cases

| case | target | prompt | what it proves |
|---|---|---|---|
| `status-no-install` | the core, `alfred-code@envoydev` | `/alfred-code:status` | with nothing installed, the command says so and routes to `/alfred-code:init` instead of rendering its fixed table shapes from the command body |
| `router-hands-back-one-command` | the core, `alfred-code@envoydev` | `/alfred-code` | the router reads the state, names ONE command, and does not start the walk itself |

Both are meant to run against the CORE entry, never `setup-plugin/` alone: the router and the status
command run `node "${CLAUDE_PLUGIN_ROOT}/scripts/install/stamp.js" state .`, and the core's plugin root is
the repo root, where `scripts/` lives - under `setup-plugin/` that path does not exist. On Claude Code
2.1.317 the `alfred-code@envoydev` target resolves to `setup-plugin/` all the same (the 2026-11-03 run below).

The three `size-first-*` cases of `task-solve` moved to `meta/evals/library/` in 2.1.4: since 2.1.0
the core carries no stack skill, so only the eval bundle (the core plus the whole library, one plugin)
carries `task-solve`. They are the only cases that write (`Edit` is granted, the floor case
excepted), each into its own scaffolded workspace - `scaffold.sh` beside `case.yaml`, run only under
`--scaffold`.

## Last recorded run - 2026-11-03, 3.6.0 (develop d3df8a07)

This run: Claude Code 2.1.317, default model (Sonnet 5.5), `--judge-model claude-haiku-4-5`, 3 runs per arm.

| case | with | without | delta |
|---|---|---|---|
| `router-hands-back-one-command` | 0.78 | 0.11 | +0.67 |
| `status-no-install` | 0.33 | 0.33 | 0.00 |

Mean delta +0.33 over 12 runs, 87s, $0.46. Both `with` scores are under 1.00, and the run shows why:

- **The target is NOT the core.** `alfred-code@envoydev` resolved to `setup-plugin/` - the result's plugin
  path, and `${CLAUDE_PLUGIN_ROOT}` expanded to `<marketplace>/setup-plugin` in every with-arm trace that
  called the stamp script - so `scripts/install/stamp.js` does not exist where the command looks.
- **Neither case grants `Bash`**, and both bodies start with `node .../stamp.js state .`. The status
  command tried it, was refused, and said it could not tell the state (3 of 3) - so `routes-to-init`
  failed every run and the delta is 0. The router fell back to a `Glob` of `.claude/` and named
  `/alfred-code:init` (3 of 3); the Haiku judge failed `does-not-run-the-flow` on 2 of them, three votes
  each and no reason recorded - one of the two also named `/alfred-code:update` as a fallback.
- The without-arm cannot resolve either command, so its one point is still `no-invented-tables`, which a
  session with no plugin passes for free.

Re-record this table whenever a command body changes; a delta that falls is the command losing its own
contract, and a `with` score under 1.00 is the command failing it outright.

**Earlier run - 2026-09-12** (Claude Code 2.1.269, the graders and target of that day - `/alfred-code:init`,
`setup-plugin/`): router 1.00 / 0.00 (+1.00), status 1.00 / 0.33 (+0.67), mean +0.83 over 12 runs, 112s, $0.84.

## Running it

The target resolves an INSTALLED plugin, so a working tree is graded from a throwaway config dir that
lists it as the marketplace. `scripts/clean-export.js` copies the tracked files only, so this repo's own
machine-local `.mcp.json` cannot load into a case:

```bash
export CLAUDE_CONFIG_DIR="$(mktemp -d)"            # a throwaway account dir
node scripts/clean-export.js . "$CLAUDE_CONFIG_DIR/src"
claude plugin marketplace add "$CLAUDE_CONFIG_DIR/src"
claude plugin install alfred-code@envoydev
claude plugin enable alfred-code@envoydev           # 2.1.317 installs it 'disabled in your settings'
claude plugin eval alfred-code@envoydev --eval-dir setup-plugin/evals --max-cost-usd 3 --judge-model claude-haiku-4-5 --no-publish   # router + status, the whole dir
claude plugin eval alfred-code@envoydev --eval-dir setup-plugin/evals --case status-no-install --runs 1 --ablation none --no-publish   # iterate cheaply
```

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
