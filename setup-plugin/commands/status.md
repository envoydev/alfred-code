---
description: "SHOW what is installed from Alfred Code in THIS project (or the global install) - read-only, no download, no changes: one table per area (skills, agents, rules, hooks, MCPs, plugins, environment, generated docs & data with their capture dates), the user picks which areas or all. NOT for changing anything - adding/dropping is configure, refreshing is update, project reconcile is validate."
disable-model-invocation: true
---

# Show the installed stack - read-only, per-area tables

You are showing what an Alfred Code install holds, nothing else. This command touches the
network never and the disk read-only: no source download, no `$TMP`, no writes, no deltas
computed. Quiet machinery - read the files, render the tables, one narration line per area at
most. Anything the user wants CHANGED routes to the sibling commands (`configure` to add/drop,
`update` to refresh, `validate` to reconcile).

## 1. Find the install

Project mode when the working tree has a populated `.claude/` (skills or agents present);
otherwise global mode against the account's config dir (skills, plugins and user-scope MCPs live
there; agents/rules/hooks are project-level by construction - the installer lays them only into a git
repo's `.claude/` - so those areas read `none installed` at global scope). Nothing installed in either place ->
say so and route to `/alfred-code:init`. Open with one line naming mode and root:
`status: project install at <root>/.claude` (or `global install at <path>`).

## 2. One question - what to show

One AskUserQuestion multi-select (the tool caps a question at four options, so the eight areas ship
in this FIXED grouping, all four marked Recommended): 'Skills + Agents + Rules', 'Hooks + MCPs +
Plugins', 'Environment', 'Generated docs & data' - single area numbers via Other. Render only the
chosen areas, in this fixed order:

```
 1 skills   2 agents   3 rules   4 hooks   5 mcps   6 plugins
 7 environment   8 generated docs & data
```

Where the harness lacks the tool, the same list as a plain-text prompt (`a` = all, numbers = just
those) is the stated fallback. Every chosen area prints its banner even when empty - an empty area
shows the banner + `none installed`, never silence.

## 3. The tables - fixed shapes, one per area

Collect first, render second: finish EVERY read for an area before its table starts, then emit
the whole table as one uninterrupted block - a table never spans tool calls and no prose
interleaves its rows (fragments render as broken, misaligned pieces). Every table ends with a
`total: N` line. Read everything from disk at render time - never from memory or a prior run's
output.

**Skills** - the directory names under `.claude/skills/` (global: the account skills dir):

| skill | kind |
|---|---|
| dotnet-testing | stack |
| my-team-notes | user-authored |

`kind`: `stack` when the name exists in the installed roster this repo ships (when unsure -
no stamp, heavily edited copy - say `unverified`, never guess); `user-authored` otherwise.

**Agents** - `.claude/agents/*.md`, with the frontmatter pins read from each file:

| agent | model | effort |
|---|---|---|
| web-angular-solution-designer | opus | xhigh |

**Rules** - `.claude/rules/*.md`:

| rule | scope | origin |
|---|---|---|
| baseline-git | always-on | stack |
| typescript-conventions | paths: `**/*.ts`, `**/*.tsx` | stack |
| baseline-project-architecture | always-on | GENERATED |
| project-code-style | paths: `**/*.js` | GENERATED |

Then ONE extra line under that table - the always-on FLOOR this install pays, because nothing
else in the stack reports it and a baseline rule is the one artifact whose cost is multiplied by
every message of every session: total the bytes of the pathless rules plus the project
instructions in one call (`wc -c <rules dir>/baseline-*.md CLAUDE.md .claude/CLAUDE.md
2>/dev/null | tail -1`) and render `always-on floor: <N> chars (~<N/4000>k tokens) across <n>
pathless rules + CLAUDE.md - re-sent on every message and prepended to every subagent dispatch`.
Report the number, judge nothing: there is no threshold here and no advice line (measured: the
standing floor was 63.5% of one 164-session collection's entire token bill, and nine independent
installs floored between 87k and 134k tokens per message - of which the stack's own always-on
text was 12.6k-13.8k). Path-scoped rules are excluded - they load only on a matching touch.

Add a SECOND line for the plugins' share of the same floor, which is the half no repo-side check
can ever see (the repo's lint reads this repo; the injections live in the plugin cache on THIS
machine). The stack's OWN entries are counted by one script, never by hand: `node
"$TMP/repo/scripts/derive-state.js" --floor --plugins <the enabled @envoydev entries,
comma-separated> --settings <account settings.json> --settings .claude/settings.json --settings
.claude/settings.local.json` (deny rules merge across scopes, so pass every one that exists; the
account file alone in global mode) prints the skill descriptions they carry (a
`disable-model-invocation` skill costs nothing, which is why this number sits below the repo lint's
always-on budget, which counts every description) plus the SEATS' descriptions minus every seat
`permissions.deny` switches off - take its `chars`. The entries it lists under `skipped` (the
hooks entry, the MCP entries) are OTHER plugins for the next sentence. For each OTHER enabled plugin, total its
skill, command and agent DESCRIPTION frontmatter (skipping a `disable-model-invocation` one) plus
the static text any `SessionStart` or `SubagentStart` hook injects, and render `plugin floor: <N>
chars (~<N/4000>k tokens) across <n> enabled plugins - <m> of it per SUBAGENT as well`. A plugin
whose injection is computed rather than a literal is counted as unknown and named, never guessed
at. Report and judge nothing, same as the line above. It matters because a SessionStart injection
is invisible everywhere else - `claude plugin details` does not show it, and one measured install
paid 8,337 injected chars a session for two plugins on top of their descriptions.

`scope` comes from the `paths:` frontmatter (absent = always-on). `origin`: `GENERATED` for
the capture-written rules (`baseline-project-*.md`, `project-code-style.md`), `stack`
otherwise, `user-authored` when clearly neither.

**Skills and agents** - skills and agents = the ROUTE decides too: with the core `alfred-code` entry (or a `claude-stack-<stack>` entry an older release installed and update has not removed yet) in the plugins listing, the installed set is what those plugins CARRY - `node "$TMP/repo/scripts/selection-plugins.js" --items <their names, comma-separated>` prints one `skill <name>` / `agent <name>` line each - UNIONED with what is on disk, which on that route is the LIBRARY copies (every item outside the core, copied per pick); without any such entry the disk is the whole set. A row the plugins carry reads `plugin` in its `origin` column; a library copy reads `library`. A carried seat named in `permissions.deny` (any scope) as `Agent(<entry>:<name>)` is switched OFF - it stays in the table with `denied` in its `origin` column, since the plugin still ships it and configure can bring it back.

The library copies get one more table, from the stamp's hashes:

```bash
node "$TMP/repo/scripts/library-check.js" --project . --source "$TMP/repo" --json
```

(`--scope global --config-dir <the account dir>` on a global install). Render its `rows` as

| name | kind | state | mode |
|---|---|---|---|

`state` is `ok`, `drift` (edited in the project), `missing` or `behind` (the running stack ships a
newer one); `mode` is the skill's `skillOverrides` value, `on` when unset. When `stale` is true, put
one line under the table: 'the project copies are from `<version>`, the stack is `<sourceVersion>` -
/alfred-code:update takes them'. `library: no library stamp` prints instead of JSON on an install
older than the library route - say so in one line and skip the table.

**Hooks** - hooks = the ROUTE decides: with `alfred-code-hooks@envoydev` in the plugins listing the installed set is the release's whole hook catalog MINUS the names in `ALFRED_CODE_HOOKS_OFF`; without it, `.claude/hooks/*.js` bare basenames, excluding the engines (`docs`, `memory`, `fresh-session`), the shared `hook-prelude`, and the generated legacy `inject-code-style.js`. On the plugin route the `wired` column reads `plugin` for every row and the
matcher comes from the release catalog; a row named in `ALFRED_CODE_HOOKS_OFF` reads `off (env)`.
On the copy route the set is joined against `settings.json` as before:

| hook | wired | matcher |
|---|---|---|
| guard-catastrophic-rm.js | yes | Bash |
| instrument-tool-usage.js | yes (env-gated, off) | .* |

**MCPs** - mcps = the ROUTE decides: with a `<server>@envoydev` MCP entry in the plugins listing the installed set is those entry NAMES folded back onto the catalog (`playwright-<browser>` -> `playwright`, `context7-local` -> `context7`, everything else is already its catalog name); without any such entry, the server names in `<repo>/.mcp.json` (project mode; global: the account's user-scope
registrations - the installer's `--scope global` registers them with `--scope user`, so read
`claude mcp list`, fail-soft without the CLI: banner + `claude CLI unavailable - skipped`). On the
plugin route the `target` column is the plugin, not a registration:

| server | transport | target |
|---|---|---|
| serena | stdio | uvx --python <pin> ... --project-from-cwd |
| memory | stdio | uvx --python <pin> --with numpy --from mcp-memory-service[sqlite]==<ver> memory server |
| sentry | http | https://mcp.sentry.dev/mcp/${SENTRY_SLUG} |
| playwright-firefox | stdio | npx -y @playwright/mcp@0.0.80 --browser firefox ... |

`target` is the command or URL, middle-truncated to keep the row one line. Playwright has one server per
kept browser (`playwright-<browser>`); which of them is switched on is the user's `/mcp` toggle, not
something this table reads. Never print env
values embedded in a registration - show `${VAR}` literally as written.

`memory` is locked like `serena` and `context7` (every install carries it). Add ONE line under
this table whenever the row is present - the shared-memory level. Hooks install into a project's
`.claude/hooks/` only, same as the secret-presence read above (`--scope global` installs skills
`-g` and plugins/MCPs `--scope user`, but never copies hooks to the account dir - there is no
account-level `memory.js` to fall back to). `.claude/hooks/memory.js` present: run `node
.claude/hooks/memory.js level` and render `<level> <dbPath>` (or `none` if the read disagrees with
the table row above - report that mismatch verbatim, never guess): `memory level: <level> -
<dbPath>`. Absent (global mode, or the hook deselected in this project): do NOT attempt the read
(it fails with `MODULE_NOT_FOUND`) - print `memory level: not checked - memory.js is not installed
here` instead. No `memory` row at all: skip the line, nothing to read.

Whenever that line runs, add a second one checking whether the session-start push can even fire on
THIS machine: `node -e "try{require('node:sqlite');process.exit(0)}catch{process.exit(1)}"`. Exit 0
adds nothing; a non-zero exit means this Node is below 22.13 (`node:sqlite` needs it unflagged), so
render `memory start block: off - this Node is below 22.13, node:sqlite is unavailable and the
session-start push never runs (memory_search still works - it goes through the MCP server, not this
machine's Node)`.

**Plugins** - `claude plugin list` (fail-soft: without the CLI print the banner +
`plugin CLI unavailable - skipped`):

| plugin | version | status |
|---|---|---|

`status` is the listing's own word, copied through - `enabled`, `disabled`, or the scope it is
installed at. A `disabled` row is REPORTED, never dropped: a stack plugin that is installed but
parked is invisible to every inventory that filters the listing down to what is enabled, and that
is how a commit-time security gate sat off through two runs that both reported nothing to do.

**Environment** - the install's knobs and identity, one row each:

| item | value |
|---|---|
| stack version (stamp) | 0.2.3 @ <short-sha> |
| scope | project (the stamp's `scope:` line; `user` there = global) |
| autoMemoryEnabled | false - the one-time import succeeded, Claude's own memory is off (this key always lives in THIS repo's own settings.json, even at global scope - never the account file) |
| ALFRED_CODE_DOCS_PATH | .claude/docs (default) |
| ALFRED_CODE_INSTRUMENT | 0 (default - off) |
| ALFRED_CODE_PUSH_GATE | 1 (default - on) - the publish half of the commit gate; 0 where the remote is already gated |
| ALFRED_CODE_ROTATE_ASK | 1 (default - on) - the stop contract's once-per-exposure rotate ask |
| ALFRED_CODE_FRESH_SESSION_1M | 400000 (default) - the fresh-session gate's trigger on a window above 200k; 0 = off for that tier |
| ALFRED_CODE_FRESH_SESSION_200K | 150000 (default) - the same trigger on a 200k window; 0 = off for that tier |
| ALFRED_CODE_FRESH_SESSION_DEFAULT | 180000 (default) - the same trigger for every other case: a window that is neither of those sizes, or one the gate cannot read. Which one applies comes from the session model's row in `.claude/hooks/model-windows.json` |
| ALFRED_CODE_DEFAULT_CONTEXT_WINDOW | 1000000 (default) - the window for a model `.claude/hooks/model-windows.json` does not list |
| SENTRY_SLUG (account env) | set / not set - only when sentry is installed |
| SENTRY_ACCESS_TOKEN (account env) | set / not set - only when sentry is installed and its registration carries a header |
| CONTEXT7_API_KEY (account env) | set / not set - only when context7 is installed remote; not set = the keyless free tier |

Stamp from `alfred-code.stamp` (`no stamp - source never resolved at install time` when
absent); env values from `settings.json` `env`, marking `(default)` when the key is absent and
a house default applies. `autoMemoryEnabled` is the one exception - a TOP-LEVEL settings.json key,
not under `env`, written by the memory import: read it from THIS repo's own project
`.claude/settings.json` ALWAYS, even for a global-scope install (the switch-off never touches the
account file - that would silence every other project's memory too) and print `false` as done,
`true` or the key ABSENT as `true/absent - the one-time import has not completed yet, Claude's own
memory is still on` (never read an absent key as success). The rows above are the keys the stack SEEDS; any other `ALFRED_CODE_*`
key the file carries (`ALFRED_CODE_ALLOW_WRITE_OUTSIDE`, a key a newer release added) gets its
own row, value as written - this table is not a filter. The sentry and context7 rows read the ACCOUNT `settings.json` (`~/.claude/settings.json`,
or the space's - the file `.mcp.json` expansion reads) and show presence only, never the value. That holds for ANY key, not just these three: a key matching the catalog's `secret_key_pattern` (`meta/environment.json`) or a row flagged `secret: true` is printed as `set (N chars)` or `absent`, never by value; a
sentry `not set` row ends with `-> add it there (or /alfred-code:configure)` (context7 unset is a
working free tier - no arrow, the registration sends an empty header). This table names values only - changing them is `configure`'s
environment area.

Presence, never the value - run this and paste its lines as-is:
`G="$PWD/.claude/hooks/guard-secret-value.js"; [ -f "$G" ] || G=$(find "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/cache" -path '*/hooks/guard-secret-value.js' 2>/dev/null | head -1); node "$G" --presence "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" SENTRY_SLUG SENTRY_ACCESS_TOKEN CONTEXT7_API_KEY`
(the same line runs on Windows - Claude Code's Bash tool is Git Bash, where `$env:USERPROFILE` is not a variable). The guard lives in TWO homes and the line takes whichever exists, newest first: a project `.claude/hooks/` copy (the pre-1.0 route) or the installed `alfred-code-hooks` plugin. Output is `KEY=set (N chars)` or `KEY=absent`. When neither home has it - a global install, the guard deselected, the plugin not installed - `$G` is empty, so do NOT run the line (it fails with `MODULE_NOT_FOUND`) and do NOT read the file another way: print `presence: not checked - guard-secret-value is not installed here` for those three rows.

**Generated docs & data** - the capture output under `<docs-path>` (resolve the root exactly
as the docs-root rule states) plus serena's local memory:

| artifact | present | captured | file updated |
|---|---|---|---|
| architecture/ARCHITECTURE.md | yes | main@a1b2c3d, 2026-07-24 | 2026-07-24 |
| architecture/watch.json | yes | - | 2026-07-24 |
| quality/ASSESSMENT.md | yes | as of main@a1b2c3d, 2026-07-24 (recomputed, not a domain) | 2026-07-24 |
| code-style/CODE-STYLE.md | yes | master@9a68219, 2026-07-25 | 2026-07-25 |
| related-projects/RELATED-PROJECTS.md | no | - | - |
| test-coverage/COVERAGE.md | yes | (bar 85%) | 2026-07-25 |
| loops/ | yes | 3 prompt files | 2026-07-24 |
| .serena/memories/ | yes | 4 notes | 2026-07-25 |

`captured` is the doc's own `Captured:` stamp line read from the file (the related-projects doc
stamps per entry - show the newest); `quality/ASSESSMENT.md` carries no `Captured:` stamp at all -
it recomputes every run with no domain of its own, so this column shows its `As of:` freshness
line instead; `file updated` is the file's mtime date. A `Captured:` stamp older than the file
mtime is normal (loops edit docs without re-capturing) - render both, judge nothing. Rows are
fixed - a capture never run shows `no`, so the user sees what is MISSING as clearly as what
exists. One row is conditional, not a gap: related-projects/RELATED-PROJECTS.md
applies only to a project with sibling repos - a standalone repo reads `no` there permanently.
A leftover architecture/BRANCH-DELTA.md from an older capture is listed as a note, never deleted.

## 4. Close

One line, no summary prose: point unfinished captures at their skills (`architecture not
captured - /project-architecture-analyzer`) and changes at the sibling commands. Nothing else -
this command's output IS the tables.

## Do not

- Never download the source, compute an upstream delta, or name what an update would bring -
  that is `configure`'s opening. Never write or delete anything, including `$TMP`.
- Never render a chosen area without its banner, merge areas into one table, or reorder them.
- Never emit a table in fragments - all reads done, then the block in one piece.
- Never paste file bodies (a doc's stamp line is the exception) - tables only.
