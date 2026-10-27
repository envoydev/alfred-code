---
description: "SHOW what an Alfred Code install holds in THIS project and whether it runs - read-only, no download, no changes: general info (version, stamp, scope, docs root), what is enabled, a health column per plugin from the CLI's own error fields, env values with credentials by presence only, which installed skills, agents and plugins this project's sessions used and never used, and the generated docs with their capture dates; the user picks which areas or all. NOT for changing anything - adding/dropping is configure, refreshing is update, project reconcile is validate."
disable-model-invocation: true
---

# Show the installed stack - read-only, per-area tables

You are showing what an Alfred Code install holds and whether it runs, nothing else. This command
resolves NO snapshot: no source download, no `$TMP`, no writes, no deltas computed. Every script
it runs is the RUNNING plugin's own copy under `${CLAUDE_PLUGIN_ROOT}` - the plugin cache holds the
whole repo, `scripts/` and `stack/` included - written into the command exactly as this file shows
it (the path is expanded into this text; the shell never has the variable). The network is never
touched. Quiet machinery - read, render the tables, one
narration line per area at most. Anything the user wants CHANGED routes to the sibling commands
(`configure` to add/drop, `update` to refresh, `validate` to reconcile).

## 1. Find the install

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/install/stamp.js" state .` - one word (two for a worktree), read from the same
install records the hooks read (`alfred-code.stamp`, a copied
`hooks/docs.js`) in this repo, its git top level or a worktree's main checkout. Never test for
`.claude/skills` or `.claude/agents`: a plugin-route install can have neither.

- `not-installed` -> say so and route to `/alfred-code:init`.
- `worktree-of-installed <main>` -> print exactly 'This is a git worktree of <main>, which holds the install - run /alfred-code:status from there' and stop - every table below reads this tree's own `.claude`, which holds nothing.
- `legacy-unstamped` -> say so and route to `/alfred-code:update`: a legacy copy-route install that never
  wrote a stamp (no install record, but two of the stack's own signatures in `.claude/`), whose picks
  update reads off disk before it writes the stamp. Render nothing else - with no stamp every table below
  reads nothing.
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

One table, no ask - it is seven rows and every other area reads against it:

| item | value |
|---|---|
| stack version (stamp) | 2.0.0 @ <short-sha> |
| running plugin | 2.0.0 - `alfred-code@<key>`, enabled at project scope |
| scope | project |
| data root | .alfred (default) |
| docs root | .alfred/docs (default) |
| initialised | 2026-09-24 |
| workspace | child of .. - own 3, ignored 1 - load check clean 2026-10-25 |

- `stack version`: the stamp's version and commit - `alfred-code.stamp` (`no stamp - source never
  resolved at install time` when it is not there).
- `running plugin`: the `alfred-code` row of `claude plugin list --json` - its version, its
  marketplace key (the part after `@`) and its
  scope. No CLI: `claude CLI unavailable`.
- `scope`: the stamp's `scope:` line; absent = `project`.
- `data root`: `ALFRED_CODE_DATA_PATH` from the scope file (`settings.local.json` over `settings.json`),
  `(default)` when absent - the one folder for this project's docs and the hooks' state - plus the count
  of the stamp's `data-pending:` lines when there are any (a sensitive-data move a run could not make) and
  `data move kept` when the stamp says `data-move: kept`.
- `docs root`: `<data root>/docs` - `ALFRED_CODE_DATA_PATH` from the scope file, `(default)` when absent; a leftover `ALFRED_CODE_DOCS_PATH` (retired in 2.8.0) shows instead, marked `(leftover - /alfred-code:update moves the docs and removes it)`.
- `initialised`: the stamp's `initialised:` line - a date, or `pending` (run `/alfred-code:init`).
- `workspace`: one call, `node "${CLAUDE_PLUGIN_ROOT}/scripts/workspace.js" status --root . ; node
  "${CLAUDE_PLUGIN_ROOT}/scripts/workspace.js" children --root .`. `workspace: parent <rel>` -> `child of <rel> - own
  <n>, ignored <n> - load check <state> <at>` (the counts of its `own:` and `ignored:` lines, its `check:` line, `never`
  when none ran); `child:` lines -> `root of <n> children` (`, <n> gone` for each `gone` one); both when both; neither ->
  `standalone`. A `!!` line it prints is pasted under the table.

## 3. One question - what else to show

One AskUserQuestion multi-select (the tool caps a question at four options, so the areas ship in
this FIXED grouping; AskUserQuestion has no pre-selection, so an empty pick shows all four - audit 2026-10-21
C-T4-01); a typed answer names single area numbers:

```ask
What else to show? None ticked shows all four.
- 'Skills + Agents + Rules (Recommended)' - areas 1-3
- 'Hooks + Plugins' - areas 4-5, where the health column lives
- 'Environment' - area 6
- 'Usage + Generated docs & data' - areas 7-8
```
 Render only the chosen areas, in this fixed order:

```
 1 skills   2 agents   3 rules   4 hooks   5 plugins
 6 environment   7 usage   8 generated docs & data
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

**In a child** (the general table's `workspace` row says `child of`), every table below gains a `from` column after
its name: `own` for a row the `own:` line names (`<category> <name>`), `ignored` for one the `ignored:` line names -
listed though it is not installed, since the parent holds it - and `from root` for every other installed row.

**Skills and agents** - the ROUTE decides the set. With the core `alfred-code` entry enabled in
the plugins listing, the installed set is what those plugins CARRY - `node
"${CLAUDE_PLUGIN_ROOT}/scripts/selection-plugins.js" --items <their names, comma-separated>` prints
one `skill <name>` / `agent <name>` line each (the core: every seat, no skill) - minus every seat
`permissions.deny` names (`Agent(alfred-code:<seat>)`, each seat the project did not pick), UNIONED
with the LIBRARY copies on disk (`.claude/skills/<name>/`: every skill, copied per pick;
`.claude/agents/<name>.md` on the copy route). Without any such entry the disk is the whole set.

| skill | origin |
|---|---|
| dotnet-testing | library |
| my-team-notes | user-authored |

| agent | origin | model | effort |
|---|---|---|---|
| web-angular-solution-designer | plugin | opus | xhigh |

`origin`: `plugin` for a carried row, `library` for a copy the stamp's `library-skills` /
`library-agents` names, `user-authored` for a copy it does not name. A carried seat named in
`permissions.deny` (either settings file) as `Agent(<entry>:<name>)` is switched OFF - it stays in
the table with `denied` as its origin, since the plugin still ships it and configure can bring it
back. `model` / `effort` are the frontmatter pins read from the agent file (the plugin's own copy
for a carried seat).

**Rules** - `.claude/rules/*.md`:

| rule | scope | origin |
|---|---|---|
| alfred-preferences | always-on | stack |
| typescript-conventions | paths: `**/*.ts`, `**/*.tsx` | stack |
| alfred-architecture | always-on | GENERATED |

`scope` comes from the `paths:` frontmatter (absent = always-on). `origin`: `GENERATED` for the
capture-written rules (`alfred-architecture.md`, `alfred-awareness.md`), `stack` otherwise,
`user-authored` when clearly neither.

Then ONE extra line under that table - the always-on FLOOR this install pays, because nothing
else in the stack reports it and a baseline rule is the one artifact whose cost is multiplied by
every message of every session: total the bytes of the pathless rules plus the project
instructions in one call (`wc -c <rules dir>/alfred-*.md AGENTS.md .claude/AGENTS.md CLAUDE.md .claude/CLAUDE.md
2>/dev/null | tail -1`) and render `always-on floor: <N> chars (~<N/4000>k tokens) across <n>
pathless rules + project instructions - re-sent on every message and prepended to every subagent dispatch`.
Report the number, judge nothing: there is no threshold here and no advice line (measured: the
standing floor was 63.5% of one 164-session collection's entire token bill, and nine independent
installs floored between 87k and 134k tokens per message - of which the stack's own always-on
text was 12.6k-13.8k). Path-scoped rules are excluded - they load only on a matching touch.

Add a SECOND line for the plugins' share of the same floor, which is the half no repo-side check
can ever see (the repo's lint reads this repo; the injections live in the plugin cache on THIS
machine). `<key>` is the marketplace key from the general table. The stack's OWN share is
counted by one script, never by hand: `node "${CLAUDE_PLUGIN_ROOT}/scripts/derive-state.js" --floor --plugins <the enabled @<key> entries, comma-separated> --skills-dir .claude/skills --settings <account settings.json> --settings .claude/settings.json --settings .claude/settings.local.json`
(deny rules and `skillOverrides` merge across scopes, so pass every one that exists, in that order)
prints the descriptions of the stack skills copied into the project (2.1.0: no plugin carries a
skill; a `disable-model-invocation` copy, or one `skillOverrides` sets to anything but `on`, costs
nothing, which is why this number sits below the repo lint's always-on budget, which counts every
description) plus the SEATS' descriptions minus every seat `permissions.deny` switches off - take its
`chars`. The entries it lists under `skipped`
are OTHER plugins for the next sentence, and the core joins them for its HOOKS
alone - the stack hooks ride the core, and `--floor` counts only its skills and seats. For each
OTHER enabled plugin, total its skill, command and agent DESCRIPTION frontmatter (skipping a
`disable-model-invocation` one) plus the static text any `SessionStart` or `SubagentStart` hook
injects, and render `plugin floor: <N> chars (~<N/4000>k tokens) across <n> enabled plugins - <m>
of it per SUBAGENT as well`. A plugin whose injection is computed rather than a literal is counted
as unknown and named, never guessed at. Report and judge nothing, same as the line above. It
matters because a SessionStart injection is invisible everywhere else - `claude plugin details`
does not show it, and one measured install paid 8,337 injected chars a session for two plugins on
top of their descriptions.

The library copies - every skill, a seat on its copy route, AND every rule, since no plugin ever
carries a rule - get one more table, from the stamp's hashes, checked against the running plugin:

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
item names - skipped, never read` (a hand-edited stamp; `/alfred-code:update` rewrites it). For each
`blocked` entry, one line: `blocked: skill <skill> is '<mode>' in skillOverrides, but <rules> send the
model to it` (that Skill call fails; `name-only` keeps it callable). For each `unrecorded` name, one
line: `unrecorded: skill <name> - an older stack copy the stamp does not record; /alfred-code:update
takes it over` (the model reads that older text, description included, until it does).
`library: no library stamp` prints instead of JSON on an install older than the library route -
say so in one line and skip the table.

**Hooks** - the ROUTE decides: the hooks ride the core, so with the core (`alfred-code@<key>`) in
the plugins listing and `ALFRED_CODE_HOOKS_VIA_PLUGIN` not `false` the installed set is the
release's whole hook catalog (the stamp's `shipped-hooks:` line) MINUS the names in
`ALFRED_CODE_HOOKS_OFF` read from the stack view; otherwise (the copy route, where the core's own copies stand down for the
wired ones), `.claude/hooks/*.js` bare basenames, excluding the engines (`docs`, `handoff`,
`layout`, `history`, `fresh-session`, `shell-writes`, `hidden-chars`, `forge`, and an older install's `memory`), the shared `hook-prelude`, the dispatchers
(`shell-guards`, `file-guards`) and the generated legacy `inject-code-style.js` - `HOOK_EXCLUDE` in
`scripts/install/selection.js` is the list. On the plugin route the `wired` column reads `plugin` for every row and the
matcher comes from the release catalog; a row named in `ALFRED_CODE_HOOKS_OFF` reads `off (env)`.
On the copy route the set is joined against the scope file's `hooks` block:

| hook | wired | matcher |
|---|---|---|
| guard-catastrophic-rm.js | yes | Bash |
| instrument-tool-usage.js | yes (env-gated, off) | .* |

**Plugins** - ONE `claude plugin list --json` call (fail-soft: without the CLI print the banner +
`plugin CLI unavailable - skipped`):

| plugin | version | scope | enabled | health |
|---|---|---|---|---|
| alfred-code@<key> | 2.0.0 | project | yes | ok |
| typescript-lsp@claude-plugins-official | 1.0.0 | project | yes | plugin-not-found |

`enabled` is the row's own `enabled` field. A disabled row is REPORTED, never dropped: a stack
plugin that is installed but parked is invisible to every inventory that filters the listing down
to what is enabled, and that is how a commit-time security gate sat off through two runs that both
reported nothing to do. `health` is `ok` when the row's `errors` list is empty or absent, else the
`type` of each `errorDetails` entry, comma-separated (the `errors` text when a row has no details).
It is the only place a plugin that cannot load says so: a row the catalog no longer lists reads
`enabled: true` in settings, loads nothing, and shows the failure nowhere but this field
(`docs/plugin-cli-evidence.md` S13, S25).

A row whose `projectPath` names another project is that project's install, not this one's - leave it out. Then
`node "${CLAUDE_PLUGIN_ROOT}/scripts/install/plugins.js" unreached .` names what the settings switch on that loads
nothing here - no record reaches it, and no registered marketplace serves it from a relative path (`docs/plugin-cli-evidence.md` S29): each `unreached: <spec>\t<file>\t<why>` line is one more row - version and scope `-`, enabled
`yes (<file>)`, health `not installed for this project`, the line's command in the close. `unreached: none` adds
nothing; `unreached: unknown` adds the line under the table (measured: a project's settings enabled a plugin
whose only record was another project's, and the session searched for its tools three times).

**Environment** - the install's knobs, one row each, from the STACK VIEW (`settings.local.json` over
`settings.json` key by key, at every scope). The rows are the catalog's: read `${CLAUDE_PLUGIN_ROOT}/meta/environment.json`
and print one row per `env` entry - its `key`, the value the stack view holds, and its `what` cut to one clause - never a
copied list, which drifts (2026-10-21: a copy here had lost five of the catalog's rows). `ALFRED_CODE_HOOKS_OFF` prints
its `<hook>:<part>` entries, or none:

| item | value |
|---|---|
| <each catalog key> | <value>, or `<default> (default)` - <its what, one clause> |

Mark `(default)` when the key is absent and a house default applies. The catalog's rows are the keys the stack SEEDS;
any other `ALFRED_CODE_*` key the file carries (`ALFRED_CODE_ALLOW_WRITE_OUTSIDE`, a key a newer
release added) gets its own row, value as written - this table is not a filter. A key matching the
catalog's `secret_key_pattern` (`meta/environment.json`) or a row flagged `secret: true` is printed
as `set (N chars)` or `absent`, never by value. This table names values only - changing them is `configure`'s environment area.

Presence, never the value - a key the table marks secret is read through the guard that ships in the running
core plugin, one call per file, its lines pasted as-is:
`node "${CLAUDE_PLUGIN_ROOT}/stack/hooks/guard-secret-value.js" --presence <file> <KEY>` (the same line runs on
Windows - Claude Code's Bash tool is Git Bash). Output is `KEY=set (N chars)`, `KEY=empty (present, no value)` or
`KEY=absent` - never read the file another way.

**Usage** - which installed skills, agents, rules and plugins this project's sessions
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
the seat handoff notes still on the bus (`node .claude/hooks/handoff.js left` - its first line is the count; exit 1 prints no row):

| artifact | present | captured | file updated |
|---|---|---|---|
| architecture/ARCHITECTURE.md | yes | main@a1b2c3d, 2026-07-24 | 2026-07-24 |
| architecture/watch.json | yes | - | 2026-07-24 |
| quality/ARCHITECTURE-ASSESSMENT.md | yes | as of main@a1b2c3d, 2026-07-24 (recomputed domain) | 2026-07-24 |
| quality/CODE-ASSESSMENT.md | no | - | - |
| preferences/PROJECT-CODE-PREFERENCES.md | yes | master@9a68219, 2026-07-25 | 2026-07-25 |
| preferences/GIT-PREFERENCES.md | yes | - | 2026-07-25 |
| preferences/TOOLS-PREFERENCES.md | yes | - | 2026-07-25 |
| awareness/AGENTS-AWARENESS.md | yes | master@9a68219, 2026-07-25 | 2026-07-25 |
| awareness/PROJECT-AWARENESS.md | yes | master@9a68219, 2026-07-25 | 2026-07-25 |
| awareness/RELATED-PROJECTS-AWARENESS.md | no | - | - |
| quality/test-coverage/COVERAGE.md | yes | (bar 85%) | 2026-07-25 |
| quality/loops/ | yes | 3 prompt files | 2026-07-24 |
| handoff notes (state/handoff) | yes | 4 notes | - |

`captured` is the doc's own `Captured:` stamp line read from the file (the related-projects
awareness doc stamps per entry - show the newest); the two `quality/` docs carry no `Captured:` stamp at all -
each recomputes every run (`quality/` is a recomputed domain, never versioned), so this column shows its `As of:` freshness
line instead; `file updated` is the file's mtime date. A `Captured:` stamp older than the file
mtime is normal (loops edit docs without re-capturing) - render both, judge nothing. Rows are
fixed - a capture never run shows `no`, so the user sees what is MISSING as clearly as what
exists. One row is conditional, not a gap: awareness/RELATED-PROJECTS-AWARENESS.md
applies only to a project with sibling repos - a standalone repo reads `no` there, or `yes` with no entry once the
capture recorded it as standalone.
A leftover architecture/BRANCH-DELTA.md from an older capture is listed as a note, never deleted.

Under the table, the tool order the next session start is told:

```bash
node "${CLAUDE_PLUGIN_ROOT}/stack/skills/capture-preferences/scripts/tools.js" order --project .
node "${CLAUDE_PLUGIN_ROOT}/stack/skills/capture-preferences/scripts/tools.js" modes --project .
```

Paste both outputs as-is in one fenced block - the stack's defaults until `/capture-preferences tools` ranks the user's own,
then what navigation each actor gets and whether a language server covers the project. No `--lsp`: status changes nothing.

## 5. Close

One line, no summary prose: point unfinished captures at their skills (`architecture not
captured - /capture-architecture`), a health failure or a `drift` / `behind` library row
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
