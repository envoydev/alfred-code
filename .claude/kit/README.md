# Managed by claude-kit

The files listed in `lock.json` come from [envoydev/claude-kit](https://github.com/envoydev/claude-kit), the one
source of the Claude Code rules and skills these repos share. Do not edit them here: change them in claude-kit and
run its sync, which rewrites them in every repo.

- `npm run kit:check` (or `node .claude/kit/check.mjs`) fails when a managed file was edited or removed here, when a
  `CLAUDE.md` hides `AGENTS.md`, and when a managed skill's description is not one line of at most 160 characters.
- `node .claude/kit/settings.mjs` prints the values the kit's skills run on - the pass score, the plan, audit, review,
  implement and search models, whether scoring, auto-run and auto-approve are on - read from `settings.json` beside it, then the
  `KIT_*` variables of a settings file's `env` block, for a name the file lacks; the header of `kit-settings.mjs` lists them and
  `constants.mjs` holds their names and defaults. `settings.json` always holds all nine names (the owner's ruling,
  2026-11-21): the sync, the hook and every save add what is missing, each with its default and never a `KIT_*` variable,
  so a variable has no effect once the file is complete. `unset` writes the name's default, and the value then no longer
  follows its source (a later change of an agent file's model does not reach it). `settings.json` here is this repo's own, and the sync changes only what it lacks: it
  keeps what was set in chat - a model, the pass score, scoring, auto-run, auto-approve - until it is changed, written by the hook
  when a request's first line is only words to switch a mode or name a role's model, and by
  `node .claude/kit/settings.mjs set <name> <value>` for everything else. `status-hook.mjs` is the `UserPromptSubmit` hook this repo's `.claude/settings.json` runs: it shows the
  same values with every request. With them it sends the communication rule's reminder line, and a note when the last
  reply passed the rule's limits (`reply-budget.mjs`).
- `node .claude/kit/prove-plan.mjs <plan>` proves an audit plan: it reads each edited file at the plan's `Baseline`
  revision, finds every `Old` exactly once and applies its `New`, writes the results into a folder beside the plan
  (`expected/` for `plan.md`, each file named `<path>.expected` so no test runner picks it up) and prints
  `Applies: <n> of <n> edits`. It exits 1 and names each edit that did not
  apply, 2 when the plan cannot be read; `--without E<n>` also writes the files of the plan with that edit and the
  edits that need it left out, into `expected-without-E<n>/`. With `--check` before the plan's path it writes
  nothing: it compares the replay with the folders already there and with the plan's `Applies:` line, and exits 1
  on any difference.
- `node .claude/kit/audit-scope.mjs scope <kind> <root>...` tells an audit which items to read: `audit` for an item
  that is new, changed, graded below the target or graded more than 30 days ago, `carried` for the rest, from the
  state its `record` command
  wrote under `docs/superpowers/audits/state/` when the last audit's grades were final. The `repo-audit-plugin`
  flow runs both; neither is run by hand.
- `repo.json` here is this repo's own: the values the kit's templates (`solve-task`, `execution.md`) are filled
  with - its name, its checks, its commit rule. Edit it here, then run claude-kit's sync to rewrite those files.
  Its `audit` map tells the `repo-audit-*` skills what this repo ships and how to check it; they read it at run time.
- Everything else is this repo's own: its `AGENTS.md` at the root, and under `.claude/` the `repo-*` rules and skills
  and `plugin-handling.md`.
