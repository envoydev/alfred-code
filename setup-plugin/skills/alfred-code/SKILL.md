---
name: alfred-code
description: "Route to the right Alfred Code action when unsure which fits - inspects the install state and answers with the exact command to run: /alfred-code:setup (fresh install - the selection and the install), /alfred-code:init (the one-time bootstrap after setup's restart - services, memory level, captures, AGENTS.md), /alfred-code:update (no-questions refresh + prune of upstream removals), /alfred-code:configure (adjust an existing install - add or drop), /alfred-code:validate (reconcile an install against THIS project - prune what its frameworks do not use and add the detected stacks' missing artifacts), /alfred-code:status (read-only per-area tables of what is installed), /alfred-code:uninstall (remove the stack from this project, keeping the user's own config). Trigger by invoking /alfred-code."
disable-model-invocation: true
---

# /alfred-code - the router

Route by install state, then hand the user the ONE command to run. The actions are manual-only
commands - the user stays at the wheel, so you answer with the command, never run the flow
yourself. The state is one script read of the project's `.claude/`, nothing inferred:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/install/stamp.js" state .` prints `not-installed`,
`legacy-unstamped`, `worktree-of-installed <main>`, `installed` or `initialised`.

- **Installed** = an install record in this repo or its git top level: `alfred-code.stamp` or a
  copied `hooks/docs.js`.
- **Worktree of an installed checkout** = a git worktree whose own `.claude/` holds no record,
  while its main checkout (`<main>`) does. The hooks count it set up; the commands cannot act on it.
- **Legacy unstamped** = no install record, but a legacy copy-route install's signatures in `.claude/` -
  two of: the stack's hook files, its env keys, three or more of its skill, seat or rule names.
- **Initialised** = the stamp's `initialised:` line holds a date - init's memory step writes it once
  the old notes are in the shared memory, and no other run does. Setup writes
  `initialised: pending`; a stamp from before that line counts as initialised when
  `autoMemoryEnabled: false` sits in `settings.json` or `settings.local.json`.

Then:

- Not installed -> `/alfred-code:setup` (fresh install: the selection and the install; it ends on a
  restart).
- Worktree of an installed checkout -> no command here: 'This is a git worktree of <main>, which
  holds the install - run /alfred-code:<the command the ask needs> from there' - every command stops
  on this tree, and the installer refuses it.
- Legacy unstamped -> `/alfred-code:update`, whatever the ask: it reads the picks off disk, each old
  name under its new one, and writes the stamp every other command reads.
- Installed, never initialised -> `/alfred-code:init` (the one-time bootstrap, in a session started
  after setup's restart: the services the MCP servers need, the memory level, the captures, the
  AGENTS.md fill). Initialised -> no bootstrap; one of the lines below.
- Installed and the ask is a plain refresh (no items named) -> `/alfred-code:update` (refresh
  everything installed + prune what upstream removed).
- Installed and the user wants to adjust it (add or drop items, change the selection) ->
  `/alfred-code:configure`.
- Installed and the user wants it reconciled TO THIS PROJECT - prune what the project's frameworks
  do not use (WPF artifacts in a web-only repo, the data vertical with no SQL) AND add the detected
  stacks' artifacts that are missing -> `/alfred-code:validate` (at any scope).
- The ask is to SEE what is installed - inventory, versions, capture dates, 'what do I have?' -
  with nothing to change -> `/alfred-code:status` (read-only tables, per area or all).
- Installed and the ask is to REMOVE the stack from this project -> `/alfred-code:uninstall` (the
  install ledger says what the stack wrote; the user's own keys, hooks and servers stay).
- The ask is whether THIS project's `AGENTS.md` still matches the stack template, or needs an
  update -> `/alfred-code:update` (its step 6 compare) - never answer this from the
  template alone; a generic answer here has shipped a wrong 'no update needed'.
- The install just finished and the ask is 'what now?' -> not installed-and-initialised yet means
  `/alfred-code:init`; after it, walk them through
  `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/post-install.md`.

Answer with the command plus one line naming the state you found (for example: 'no install record
in `.claude/` - run `/alfred-code:setup`'). When more than one reading is plausible, put the
candidates through AskUserQuestion - one option per plausible command, the likeliest marked
Recommended - instead of guessing or asking in prose.
