---
description: "SHOW what an Alfred Code install holds in THIS project and whether it runs - read-only, no download, no changes: general info (version, stamp, scope, docs root), what is enabled, a health column per plugin and MCP server from the CLI's own error fields, env values with credentials by presence only, which installed skills, agents and plugins this project's sessions used and never used, and the generated docs with their capture dates; the user picks which areas or all. NOT for changing anything - adding/dropping is configure, refreshing is update, project reconcile is validate."
disable-model-invocation: true
---

# Show the installed stack - read-only, per-area tables

You are showing what an Alfred Code install holds and whether it runs, nothing else. This command
resolves NO snapshot: no source download, no `$TMP`, no writes, no deltas computed. Every script
it runs is the RUNNING plugin's own copy under `${CLAUDE_PLUGIN_ROOT}` - the plugin cache holds the
whole repo, `scripts/` and `stack/` included - written into the command exactly as this file shows
it (the path is expanded into this text; the shell never has the variable). The network is touched
only by `claude mcp list`'s own health check. Quiet machinery - read, render the tables, one
narration line per area at most. Anything the user wants CHANGED routes to the sibling commands
(`configure` to add/drop, `update` to refresh, `validate` to reconcile).

## 1. Find the install

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/install/stamp.js" state .` - one word (two for a worktree), read from the same
install records the hooks read (`alfred-code.stamp`, the 1.x `claude-stack.stamp`, a copied <!-- legacy-name -->
`hooks/docs.js`) in this repo, its git top level or a worktree's main checkout. Never test for
`.claude/skills` or `.claude/agents`: a plugin-route install can have neither.

- `not-installed` -> say so and route to `/alfred-code:setup`.
- `worktree-of-installed <main>` -> print exactly 'This is a git worktree of <main>, which holds the install - run /alfred-code:status from there' and stop - every table below reads this tree's own `.claude`, which holds nothing.
- `legacy-global` -> a 1.x global install whose stamp still sits in the account dir: say so and
  route to `/alfred-code:update`, which moves it into the project. Render nothing else - its copies
  are not where this command reads.
- `installed` or `initialised` -> go on.

Every install lives in the PROJECT at every scope: the stamp, the library copies, the rules, the
copied hook engines and the settings are under `<root>/.claude/` (`<root>` = the git top level,
else the current directory); the scope says only where the plugin rows are enabled and which
settings file holds the stack's keys - `.claude/settings.local.json` at `local` scope (it wins over
`settings.json` key by key), `.claude/settings.json` at `project` and `user`. Call that file the
SCOPE FILE below. But at EVERY scope a stack key `settings.local.json` holds applies over `settings.json`,
as Claude Code lays the two files - a value a move off `local` kept there, or one set by hand - so the
env reads below use the STACK VIEW: `settings.json`'s `env` with every `ALFRED_CODE_*` key of
`settings.local.json` laid over it (at `local` scope, the whole local `env`).

## 2. General info - always, before the question

One table, no ask - it is five rows and every other area reads against it:

| item | value |
|---|---|
| stack version (stamp) | 2.0.0 @ <short-sha> |
| running plugin | 2.0.0 - `alfred-code@<key>`, enabled at project scope |
| scope | project |
| docs root | .claude/docs (default) |
| initialised | 2026-09-24 |

- `stack version`: the stamp's version and commit - `alfred-code.stamp`, or a 1.x
  `claude-stack.stamp` read the same way until its first 2.0.0 update (`no stamp - source never <!-- legacy-name -->
  resolved at install time` when neither is there).
- `running plugin`: the `alfred-code` row of `claude plugin list --json` - its version, its
  marketplace key (the part after `@`; a 1.x install keeps its own for the whole 2.x line) and its
  scope. No CLI: `claude CLI unavailable`.
- `scope`: the stamp's `scope:` line; absent = `project`.
- `docs root`: `ALFRED_CODE_DOCS_PATH` from the scope file, `(default)` when absent.
- `initialised`: the stamp's `initialised:` line - a date, or `pending` (run `/alfred-code:init`).

## 3. One question - what else to show

One AskUserQuestion multi-select (the tool caps a question at four options, so the areas ship in
this FIXED grouping, all four marked Recommended): 'Skills + Agents + Rules', 'Hooks + MCPs +
Plugins' (the health columns live here), 'Environment', 'Usage + Generated docs & data' - single
area numbers via Other. Render only the chosen areas, in this fixed order:

```
 1 skills   2 agents   3 rules   4 hooks   5 mcps   6 plugins
 7 environment   8 usage   9 generated docs & data
```

Where the harness lacks the tool, the same list as a plain-text prompt (`a` = all, numbers = just
those) is the stated fallback. Every chosen area prints its banner even when empty - an empty area
shows the banner + `none installed`, never silence.

## 4. The tables - fixed shapes, one per area

Collect first, render second: finish EVERY read for an area before its table starts, then emit
the whole table as one uninterrupted block - a table never spans tool calls and no prose
interleaves its rows (fragments render as broken, misaligned pieces). Every table ends with a
`total: N` line. Read everything from disk at render time - never from memory or a prior run's
output.

**Skills and agents** - the ROUTE decides the set. With the core `alfred-code` entry (or a
`claude-stack-<stack>` entry an older release installed and update has not removed yet) enabled in <!-- legacy-name -->
the plugins listing, the installed set is what those plugins CARRY - `node
"${CLAUDE_PLUGIN_ROOT}/scripts/selection-plugins.js" --items <their names, comma-separated>` prints
one `skill <name>` / `agent <name>` line each - UNIONED with the LIBRARY copies on disk
(`.claude/skills/<name>/`, `.claude/agents/<name>.md`: every item outside the core, copied per
pick). Without any such entry the disk is the whole set.

| skill | origin |
|---|---|
| dotnet-testing | plugin |
| angular-signals | library |
| my-team-notes | user-authored |

| agent | origin | model | effort |
|---|---|---|---|
| web-angular-solution-designer | library | opus | xhigh |

`origin`: `plugin` for a carried row, `library` for a copy the stamp's `library-skills` /
`library-agents` names, `user-authored` for a copy it does not name. A carried seat named in
`permissions.deny` (either settings file) as `Agent(<entry>:<name>)` is switched OFF - it stays in
the table with `denied` as its origin, since the plugin still ships it and configure can bring it
back. `model` / `effort` are the frontmatter pins read from the agent file (the plugin's own copy
for a carried seat).

**Rules** - `.claude/rules/*.md`:

| rule | scope | origin |
|---|---|---|
| baseline-git | always-on | stack |
| typescript-conventions | paths: `**/*.ts`, `**/*.tsx` | stack |
| baseline-project-architecture | always-on | GENERATED |
| project-code-style | paths: `**/*.js` | GENERATED |

`scope` comes from the `paths:` frontmatter (absent = always-on). `origin`: `GENERATED` for the
capture-written rules (`baseline-project-*.md`, `project-code-style.md`), `stack` otherwise,
`user-authored` when clearly neither.

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
machine). `<key>` is the marketplace key from the general table. The stack's OWN entries are
counted by one script, never by hand: `node "${CLAUDE_PLUGIN_ROOT}/scripts/derive-state.js" --floor --plugins <the enabled @<key> entries, comma-separated> --settings <account settings.json> --settings .claude/settings.json --settings .claude/settings.local.json`
(deny rules merge across scopes, so pass every one that exists) prints the skill descriptions they
carry (a `disable-model-invocation` skill costs nothing, which is why this number sits below the
repo lint's always-on budget, which counts every description) plus the SEATS' descriptions minus
every seat `permissions.deny` switches off - take its `chars`. The entries it lists under `skipped`
(the MCP entries) are OTHER plugins for the next sentence, and the core joins them for its HOOKS
alone - the stack hooks ride the core, and `--floor` counts only its skills and seats. For each
OTHER enabled plugin, total its skill, command and agent DESCRIPTION frontmatter (skipping a
`disable-model-invocation` one) plus the static text any `SessionStart` or `SubagentStart` hook
injects, and render `plugin floor: <N> chars (~<N/4000>k tokens) across <n> enabled plugins - <m>
of it per SUBAGENT as well`. A plugin whose injection is computed rather than a literal is counted
as unknown and named, never guessed at. Report and judge nothing, same as the line above. It
matters because a SessionStart injection is invisible everywhere else - `claude plugin details`
does not show it, and one measured install paid 8,337 injected chars a session for two plugins on
top of their descriptions.

The library copies - skills, agents AND rules alike, since no plugin ever carries a rule - get one
more table, from the stamp's hashes, checked against the running plugin:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/library-check.js" --project . --source "${CLAUDE_PLUGIN_ROOT}" --json
```

Render its `rows` as

| name | kind | state | mode |
|---|---|---|---|

`kind` is `skill`, `agent` or `rule`; `state` is `ok`, `drift` (edited in the project), `missing` or
`behind` (the running stack ships a newer one); `mode` is the skill's `skillOverrides` value (absent
for an agent or a rule row), `on` when unset. When `stale` is true, put one line under the table:
'the project copies are from `<version>`, the stack is `<sourceVersion>` - /alfred-code:update
takes them'. When `invalid` is above 0, one more line: `invalid: <n> stamp name(s) are not valid
item names - skipped, never read` (a hand-edited stamp; `/alfred-code:update` rewrites it).
`library: no library stamp` prints instead of JSON on an install older than the library route -
say so in one line and skip the table.

**Hooks** - the ROUTE decides: the hooks ride the core, so with the core (`alfred-code@<key>`) in
the plugins listing and `ALFRED_CODE_HOOKS_VIA_PLUGIN` not `false` the installed set is the
release's whole hook catalog (the stamp's `shipped-hooks:` line) MINUS the names in
`ALFRED_CODE_HOOKS_OFF` read from the stack view; otherwise (the copy route, where the core's own copies stand down for the
wired ones), `.claude/hooks/*.js` bare basenames, excluding the engines (`docs`, `memory`,
`history`, `fresh-session`), the shared `hook-prelude`, and the generated legacy
`inject-code-style.js`. On the plugin route the `wired` column reads `plugin` for every row and the
matcher comes from the release catalog; a row named in `ALFRED_CODE_HOOKS_OFF` reads `off (env)`.
On the copy route the set is joined against the scope file's `hooks` block:

| hook | wired | matcher |
|---|---|---|
| guard-catastrophic-rm.js | yes | Bash |
| instrument-tool-usage.js | yes (env-gated, off) | .* |

**MCPs** - the ROUTE decides the set: with a `<server>@<key>` MCP entry in the plugins listing the
installed set is those entry NAMES folded back onto the catalog (`browser-<engine>` ->
`browser`, everything else is already its catalog name); without any such entry (the full copy
route), the server names in `<root>/.mcp.json`, or at `user` scope the account's registrations.
The `health` column is ONE `claude mcp list` call, which checks every server it lists: copy its
status text through as written - `✔ Connected`, `! Connected · tools fetch failed`, `! Needs
authentication`, `✘ Failed to connect`, `✘ Connection error`, `⏸ Pending approval`, `⊘ Disabled
for this project` (https://code.claude.com/docs/en/mcp, 'Server status'). Match a row by its server
name, which the listing may qualify with its plugin; a server the listing does not name reads `not
listed`. No CLI: the banner + `claude CLI unavailable - skipped` for the column.

| server | transport | target | health |
|---|---|---|---|
| navigation | stdio | node .../serena-launch.js ... --project-from-cwd | ✔ Connected |
| memory | stdio | node .../memory-launch.js | ✔ Connected |
| documentation | http | https://mcp.context7.com/mcp | ✔ Connected |
| browser-firefox | stdio | npx -y @playwright/mcp@0.0.80 --browser firefox ... | ✘ Failed to connect |

`target` is the command or URL, middle-truncated to keep the row one line; on the plugin route it
is the entry's own declaration. The browser server has one server per installed browser
(`browser-<engine>`), and any number can be on together; which are on is the user's `/plugin`
toggle (the stamp's `browser-enabled:` is their last answer, not the live state). Never print
env values embedded in a registration - show `${VAR}` literally as written.

`memory` is locked like `navigation` and `documentation` (every install carries it). Add ONE line under
this table whenever the row is present - the shared-memory level. `.claude/hooks/memory.js`
present: run `node .claude/hooks/memory.js level` and render `memory level: <level> - <dbPath>`
(or `none` if the read disagrees with the table row above - report that mismatch verbatim, never
guess). Absent (the hook deselected in this project): do NOT attempt the read (it fails with
`MODULE_NOT_FOUND`) - print `memory level: not checked - memory.js is not installed here`
instead. No `memory` row at all: skip the line, nothing to read.

Whenever that line runs, add a second one checking whether the session-start push can even fire on
THIS machine: `node -e "try{require('node:sqlite');process.exit(0)}catch{process.exit(1)}"`. Exit 0
adds nothing; a non-zero exit means this Node is below 22.13 (`node:sqlite` needs it unflagged), so
render `memory start block: off - this Node is below 22.13, node:sqlite is unavailable and the
session-start push never runs (memory_search still works - it goes through the MCP server, not this
machine's Node)`.

**Plugins** - ONE `claude plugin list --json` call (fail-soft: without the CLI print the banner +
`plugin CLI unavailable - skipped`):

| plugin | version | scope | enabled | health |
|---|---|---|---|---|
| alfred-code@<key> | 2.0.0 | project | yes | ok |
| browser-webkit@<key> | 2.0.0 | project | yes | plugin-not-found |

`enabled` is the row's own `enabled` field. A disabled row is REPORTED, never dropped: a stack
plugin that is installed but parked is invisible to every inventory that filters the listing down
to what is enabled, and that is how a commit-time security gate sat off through two runs that both
reported nothing to do. `health` is `ok` when the row's `errors` list is empty or absent, else the
`type` of each `errorDetails` entry, comma-separated (the `errors` text when a row has no details).
It is the only place a plugin that cannot load says so: a row the catalog no longer lists reads
`enabled: true` in settings, loads nothing, and shows the failure nowhere but this field
(`docs/rebrand-evidence.md` S13, S25).

**Environment** - the install's knobs, one row each, from the STACK VIEW (`settings.local.json` over
`settings.json` key by key, at every scope):

| item | value |
|---|---|
| autoMemoryEnabled | false - the one-time import succeeded, Claude's own memory is off |
| ALFRED_CODE_INSTRUMENT | 0 (default - off) |
| ALFRED_CODE_PUSH_GATE | 1 (default - on) - the publish half of the commit gate; 0 where the remote is already gated |
| ALFRED_CODE_ROTATE_ASK | 1 (default - on) - the stop contract's once-per-exposure rotate ask |
| ALFRED_CODE_FRESH_SESSION_1M | 400000 (default) - the fresh-session gate's trigger on a window above 200k; 0 = off for that tier |
| ALFRED_CODE_FRESH_SESSION_200K | 150000 (default) - the same trigger on a 200k window; 0 = off for that tier |
| ALFRED_CODE_FRESH_SESSION_DEFAULT | 180000 (default) - the same trigger for every other case: a window that is neither of those sizes, or one the gate cannot read. Which one applies comes from the session model's row in `.claude/hooks/model-windows.json` |
| ALFRED_CODE_DEFAULT_CONTEXT_WINDOW | 1000000 (default) - the window for a model `.claude/hooks/model-windows.json` does not list |
| CONTEXT7_API_KEY (account env) | set (N chars) / absent - absent = the keyless free tier |

Mark `(default)` when the key is absent and a house default applies. `autoMemoryEnabled` is a
TOP-LEVEL key, not under `env`, written by init's memory import into the scope file - never the
account file, which would silence every other project's memory too: print `false` as done, `true`
or the key ABSENT as `true/absent - the one-time import has not completed yet, Claude's own memory
is still on` (never read an absent key as success). The rows above are the keys the stack SEEDS;
any other `ALFRED_CODE_*` key the file carries (`ALFRED_CODE_ALLOW_WRITE_OUTSIDE`, a key a newer
release added) gets its own row, value as written - this table is not a filter. A key matching the
catalog's `secret_key_pattern` (`meta/environment.json`) or a row flagged `secret: true` is printed
as `set (N chars)` or `absent`, never by value. The documentation server row reads the ACCOUNT `settings.json`
(`~/.claude/settings.json`, or the space's - the file the MCP header expands from). This table
names values only - changing them is `configure`'s environment area.

Presence, never the value - run this and paste its lines as-is:
`node "${CLAUDE_PLUGIN_ROOT}/stack/hooks/guard-secret-value.js" --presence "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" CONTEXT7_API_KEY`
(the same line runs on Windows - Claude Code's Bash tool is Git Bash, where `$env:USERPROFILE` is
not a variable). The guard ships in the running core plugin, so it is always there when this
command is. Output is `KEY=set (N chars)` or `KEY=absent`; any other key the table marks secret is
read the same way, one `--presence <file> <KEY>` call per file - never by reading the file another
way.

**Usage** - which installed skills, agents, rules, plugins and MCP servers this project's sessions
used, and which they never reached, from the analyzer's own inventory block (it reads every
transcript of this project on this machine, so a long history takes a few seconds; with no folder
named it finds this project's transcripts itself, from its cwd, spelled the way Claude Code names the
folder on every OS):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/analyze-usage.js" --inventory .claude | sed -n '/^INVENTORY vs USE/,$p'
```

No such directory, or nothing printed: `usage: no session transcripts for this project on this
machine` and skip the table. Otherwise render one row per layer from the block's own lines:

| layer | used | never used |
|---|---|---|
| skills | 9 of 31 installed | 22: angular-signals, dotnet-testing, ... |
| agents | 2 of 14 installed | 12: ... |

`used` is the block's `used X of Y installed`; `never used` is its count plus the names it lists,
middle-truncated past ten. Its `always-on` names (rules in every prompt) are neither - add them as
one line under the table. Copy the block's closing caveat as the last line: a hooks-only plugin can
never score used, and a catalog-sourced row proves the stack ships the artifact, not that this
project installed it.

Then the Stop build check advisory, from the same transcripts and this project's done-gate probe rows:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/analyze-usage.js" --turn-check-advice .
```

It prints ONE `turn-check: advise - ...` line or nothing. A printed line goes under the usage table
as-is; nothing printed means no row. The switch is the user's - never set it from here.

**Generated docs & data** - the capture output under the docs root from the general table, plus
The navigation server's local memory:

| artifact | present | captured | file updated |
|---|---|---|---|
| architecture/ARCHITECTURE.md | yes | main@a1b2c3d, 2026-07-24 | 2026-07-24 |
| architecture/watch.json | yes | - | 2026-07-24 |
| quality/ASSESSMENT.md | yes | as of main@a1b2c3d, 2026-07-24 (recomputed, not a domain) | 2026-07-24 |
| quality/CODE-ASSESSMENT.md | no | - | - |
| code-style/CODE-STYLE.md | yes | master@9a68219, 2026-07-25 | 2026-07-25 |
| related-projects/RELATED-PROJECTS.md | no | - | - |
| test-coverage/COVERAGE.md | yes | (bar 85%) | 2026-07-25 |
| loops/ | yes | 3 prompt files | 2026-07-24 |
| .serena/memories/ | yes | 4 notes | 2026-07-25 |

`captured` is the doc's own `Captured:` stamp line read from the file (the related-projects doc
stamps per entry - show the newest); the two `quality/` docs carry no `Captured:` stamp at all -
each recomputes every run with no domain of its own, so this column shows its `As of:` freshness
line instead; `file updated` is the file's mtime date. A `Captured:` stamp older than the file
mtime is normal (loops edit docs without re-capturing) - render both, judge nothing. Rows are
fixed - a capture never run shows `no`, so the user sees what is MISSING as clearly as what
exists. One row is conditional, not a gap: related-projects/RELATED-PROJECTS.md
applies only to a project with sibling repos - a standalone repo reads `no` there permanently.
A leftover architecture/BRANCH-DELTA.md from an older capture is listed as a note, never deleted.

## 5. Close

One line, no summary prose: point unfinished captures at their skills (`architecture not
captured - /alfred-capture-architecture`), a health failure or a `drift` / `behind` library row
at the sibling command that fixes it, and changes at the sibling commands. Nothing else - this
command's output IS the tables.

## Do not

- Never download the source, resolve a snapshot, compute an upstream delta, or name what an update
  would bring - that is `configure`'s opening. Never write or delete anything, `$TMP` included.
- Never decide an install exists from `.claude/skills` or `.claude/agents` - the stamp state is the
  one test.
- Never render a chosen area without its banner, merge areas into one table, or reorder them.
- Never emit a table in fragments - all reads done, then the block in one piece.
- Never paste file bodies (a doc's stamp line is the exception) - tables only.
