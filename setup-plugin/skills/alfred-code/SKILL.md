---
name: alfred-code
description: "Route to the right Alfred Code action when unsure which fits - inspects the install state and answers with the exact command to run: /alfred-code:init (fresh install from scratch), /alfred-code:update (no-questions refresh + prune of upstream removals), /alfred-code:configure (adjust an existing install - add or drop), /alfred-code:validate (reconcile an install against THIS project - prune what its frameworks do not use and add the detected stacks' missing artifacts), /alfred-code:status (read-only per-area tables of what is installed). Trigger by invoking /alfred-code."
disable-model-invocation: true
---

# /alfred-code - the router

Route by install state, then hand the user the ONE command to run. The five actions are
manual-only commands - the user stays at the wheel, so you answer with the command, never run
the flow yourself:

- Nothing installed here (no populated `.claude/skills` / `.claude/agents`, and no global install
  to target) -> `/alfred-code:init` (fresh install from scratch).
- The stack is installed and the ask is a plain refresh (no items named) -> `/alfred-code:update`
  (refresh everything installed + prune what upstream removed).
- The stack is installed and the user wants to adjust it (add or drop items, change the
  selection) -> `/alfred-code:configure`.
- The stack is installed and the user wants it reconciled TO THIS PROJECT - prune what the
  project's frameworks do not use (WPF artifacts in a web-only repo, the data vertical with no SQL)
  AND add the detected stacks' artifacts that are missing -> `/alfred-code:validate` (project mode
  only).
- The ask is to SEE what is installed - inventory, versions, capture dates, 'what do I have?' -
  with nothing to change -> `/alfred-code:status` (read-only tables, per area or all).
- The ask is whether THIS project's `CLAUDE.md` still matches the stack template, or needs an
  update -> `/alfred-code:update` (its step 6 compare, project mode) - never answer this from the
  template alone; a generic answer here has shipped a wrong 'no update needed'.
- The install just finished and the ask is 'what now?' (session reload, gitignore lines, serena
  setup, which captures in which order) -> not a command: walk them through
  `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/post-install.md`.

Answer with the command plus one line naming the state you found (for example: 'no `.claude/skills`
here - run `/alfred-code:init`'). When more than one reading is plausible, put the candidates
through AskUserQuestion - one option per plausible command, the likeliest marked Recommended -
instead of guessing or asking in prose.
