---
description: "One-time bootstrap of an Alfred Code install, run in the session AFTER setup's restart - installs what the kept MCP servers need to start (uv, the pinned Python, csharp-ls when csharp-lsp is kept, the picked browsers, the navigation-server index, claude-hud's status line in its compact layout - every machine-level install through ONE ask first), sets this project's shared-memory level and imports Claude's old notes (no reinstall), runs the captures the install carries (related projects, architecture, code style, agent capabilities) by following each SKILL.md inline, then offers the CLAUDE.md fill. Nothing installed yet routes to /alfred-code:setup."
disable-model-invocation: true
---

# Initialize Alfred Code - the one-time bootstrap

You are bootstrapping an install `/alfred-code:setup` laid down, in a session started AFTER its
restart - the plugins, servers and seats it installed load at session start, and this run uses
them. Three checks come first, in order, each one line. The first is one call,
`node "${CLAUDE_PLUGIN_ROOT}/scripts/install/stamp.js" state . ; node "${CLAUDE_PLUGIN_ROOT}/scripts/init-plan.js" --mode`:
its first line reads the same install records the hooks read (`alfred-code.stamp`, the 1.x
`claude-stack.stamp`, a copied `hooks/docs.js`) in this repo, its git top level or a worktree's <!-- legacy-name -->
main checkout; its second, `unattended: on|off`, says whether anyone answers this run's asks
(`on` - the Unattended section below governs every ask from here):

- **Nothing installed** - `not-installed`: stop and name `/alfred-code:setup` for the USER to type,
  then end the turn. `legacy-global` (a 1.x global install whose stamp still sits in the account
  dir): stop the same way on `/alfred-code:update`, which moves it into the project. Both are
  `disable-model-invocation` - the user's to type, never a Skill call from this run - and each
  belongs in its own session. `worktree-of-installed <main>` -> print exactly 'This is a git worktree of <main>, which holds the install - run /alfred-code:init from there' and stop - a worktree shares that checkout's install, and nothing is written into this tree, or into that one from here.
- **Setup ran in THIS session** - stop: name the restart, then `/alfred-code:init` in the new
  session. What setup installed is on disk but not loaded here.
- **Run before** - go on: every step below reads what is already in place and skips it
  (`present`, `done`), so a second run only finishes what the first left.

**This run needs NO conversation context - so it is worth MOVING, but only out of a session that
is actually loaded.** Measure before you ask: this session's own per-message context is `input +
cache_read + cache_creation` off the last assistant message in the transcript. Ask ONLY when that
figure is past the same trigger `guard-fresh-session-start.js` uses - the tier's own absolute
trigger, `ALFRED_CODE_FRESH_SESSION_200K` (default 150,000) or `ALFRED_CODE_FRESH_SESSION_1M`
(default 400,000), or `ALFRED_CODE_FRESH_SESSION_DEFAULT` (default 180,000) when the window is
neither of those two sizes or cannot be read at all - which one applies comes from the session
model's row in `.claude/hooks/model-windows.json`, else `ALFRED_CODE_DEFAULT_CONTEXT_WINDOW` - or
when that hook has already injected the ask into this turn. Below the trigger, or when the figure
cannot be read at all, SKIP the ask silently and start step 1. When it fires, put it through
AskUserQuestion: run here anyway, or run in a fresh session (recommended), quoting the figure you
measured; fresh session -> give the paste-ready one-liner and end the turn. Unattended, it is never
asked: `unattended: fresh session -> run here (the recommended one hands the run to a person)`.

**Read the stack's own files through the Bash tool (`cat "<file>"`), never the Read tool** - this
protocol, a SKILL.md the plan names, every `references/` file inside one. They sit outside the
working directory (the plugin cache, `$TMP`), where the Read tool asks before every read in default
and acceptEdits mode, while a read-only Bash command carries the broader read access
(code.claude.com/docs/en/security, 'Working directory boundary') and a sandboxed one runs without a
prompt (code.claude.com/docs/en/permissions) - an unattended run has nobody to answer that ask. A
launcher that wants the Read tool to reach them too starts the session with
`--add-dir "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/cache" --add-dir "${TMPDIR:-/tmp}"`.

**THE PLUGIN CACHE IS THE SNAPSHOT - the common run downloads nothing but a newer release** - read `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md` (through Bash, as above) before step 1 and hold the whole run to it: resolve the snapshot once into `$TMP/repo`, use every tool from that snapshot, and remove `$TMP` per its 'Clean up' section on every exit path. Its 'Narrate, don't trace' section governs every tool call: one quiet call per recompute, no pasted tool output except the plan and the tables named below, one narration line between steps.

**Every ask in this run goes through the AskUserQuestion tool** - concrete options, the recommended one marked, free text via Other; a prose question or a bare stop-and-wait is invalid. Unattended, no ask is put at all: the Unattended section answers each one.

**House voice in every line this run emits** - narration, tables and the asks alike: single
dashes, never em-dashes, and single quotes in prose.

Six steps, one banner line before each: `[step n/6 - <name>] <what> · next: <name>` - 1 read the
install · 2 the plan · 3 machine installs · 4 memory · 5 captures · 6 CLAUDE.md.

## 1. Read the install

One call, nothing changed: `node "$TMP/repo/scripts/install/alfred-code.js" update --source "$TMP/repo" --installed-only --print-plan --plan-out "$TMP/installed.json" > "$TMP/plan.out" 2>&1` - the installer's own read-back (skills, agents, plugins, `left_out`, `browser`), under the scope the stamp records. `--installed-only found nothing installed` means there is no install: route to `/alfred-code:setup` as above.

**`ALFRED_CODE_SEED=shell`** - the resolve line reported `seed=shell`: print `the shell installers were removed in 2.0.0 - unset ALFRED_CODE_SEED / CLAUDE_STACK_SEED to use the Node installer` and stop. <!-- legacy-name -->

## 2. The plan - a script states it, never you

`node "$TMP/repo/scripts/init-plan.js" --installed "$TMP/installed.json" --root . --plugin-root "${CLAUDE_PLUGIN_ROOT}"` (plus `--space <name>` on step 4's rule) - paste its lines byte-for-byte in ONE fenced block. It probes this machine and names, in order (unattended, followed by one `unattended:` line per ask of steps 3 to 6 - the answers, taken exactly):

- `machine: <what> - present | missing: <command> | missing after uv: <command> | refresh: <command> | blocked: <why> | skip: <why>` -
  uv, the pinned Python fetched through it, `csharp-ls` when `csharp-lsp` is kept, the picked
  browsers (a firefox / webkit setup's install failed to download; a chrome / msedge the
  machine does not have), the navigation-server index, then the account's claude-hud status line and compact
  layout. The command is the exact one to run.
- `capture: <skill> - run: read <SKILL.md> | done: <output> exists | skip: <why>` - the four
  captures in their fixed order, each only when the install lists its skill AND its seat.

Nothing is inferred beyond those lines: a machine item the plan does not name is not this run's.

## 3. Machine installs - ONE ask

No `missing` or `refresh` line: one narration line, next step. Otherwise ONE AskUserQuestion,
multi-select, one option per `missing` / `missing after uv` / `refresh` line - the label names the
item, the description carries its exact command - every one pre-selected, 'install the selected'
recommended (the servers that need them cannot start without them). A `blocked` line is not an
option: name its fix once (the .NET SDK for csharp-ls, the browser for a picked chrome or msedge) -
the user installs it; never attempt one. `claude-hud status line + compact layout` is one of those
lines: its command (`hud-statusline.js`) writes the account `statusLine` claude-hud's own setup
would, then claude-hud's row of `meta/plugin-settings.json`, add-only - a status line that is not
claude-hud's is kept and reported with `/claude-hud:setup`. Its command ends in
`# adds <n> claude-hud keys: <names>`, a shell comment the description keeps, so keys a setup Skip
left out are named before they land. `refresh` is claude-hud's own line in a stale shape: the description says it
is replaced, after the command copies the account `settings.json` to `settings.json.bak.<time>`. A
`skip` line is not an option either: one narration line (claude-hud absent or switched off, or the
user's own status line with nothing else to add).

Run the picked commands in plan order, uv first - the `after uv` ones need it. A fresh uv lands in a
directory the running shell may not have on PATH yet: its installer prints where. When `uv` is not
found afterwards, EVERY later command of this run carries that directory first -
`PATH="<dir>:$PATH" <command>` - step 3's `after uv` commands and step 4's `memory.js init` alike,
since the import it runs needs `uvx`. The navigation-server index and a browser download take minutes:
start them in the background and go on to step 4, collecting each result before step 5's
architecture capture (it navigates by symbol) and the close. Report each as installed, failed (its
error line quoted) or skipped by the answer. A server this session started before its runtime existed
connects only after a restart - the close names it.

## 4. Memory - the level, then the notes import

The shared memory database the `memory` server reads. Paste this table first:

```
| level | database | who shares it |
|---|---|---|
| global (Recommended) | ~/.memory-mcp/memory.db | every Claude account and Cursor on this machine |
| scoped | ~/.memory-mcp/memory_<space>.db (memory_default.db with no space) | just this one Claude account, and Cursor installed with the same space |
| project | <project>/.memory-mcp/memory.db, gitignored | this project only, from any account |
```

Then ONE AskUserQuestion with those three options, `global` marked Recommended - the whole point of
shared memory. Picking `project` while this project's related-projects domain names sibling repos
(`.claude/rules/baseline-project-related-context.md`) means their memories are not visible from
here - one caveat line in the close.

Apply it with the init-only entry point - no reinstall; under `.claude/` only the settings key and the
stamp's `initialised:` line change:
`node "$TMP/repo/scripts/install/memory.js" init --project-root . --level <answer> [--space <name>]`
(`--space` when this session's account dir is `~/.claude-<name>`; the same `PATH` prefix as step 3
after a fresh uv). It writes the level into the
`ALFRED_CODE_MEMORY_DB` key the server's launcher reads (the settings file the stamp's scope names),
writes `.memory-mcp/.gitignore` at `project` level, imports this project's old `MEMORY.md` /
`memory/*.md` notes into THAT database once through the memory service, and - only when the import
succeeds - switches Claude's own memory off (`autoMemoryEnabled: false`; an install that found no notes
already did, and the step reports it as already off) and marks the stamp
`initialised: <date>`, the one signal the router reads and no other run writes. Report its lines: the
level, the import count or WHY it stopped (no `uvx` is the usual one - step 3 skipped uv), and
whether the switch-off happened; never claim it from the answer alone. A failed import leaves Claude's
own memory ON, and the old note files are never deleted. It refuses a copy-route registration at
another path (`.mcp.json`, else the account `.claude.json`) - name its
`/alfred-code:update --memory-level <level>` line. The server
this session runs still opens the database setup pointed it at until a restart - when the level is
not `global`, the close names the restart.

## 5. Captures - each SKILL.md followed inline

For every `capture: ... - run: read <path>` line, in plan order: read that `SKILL.md` (through Bash)
and follow it inline, start to finish - never a Skill call: the reads stay in this run, and the manual-only ones
are denied by `guard-fresh-session-start.js`. It is this step's instructions for that capture:
its relative `references/` and `scripts/` paths resolve from the SKILL.md's own directory, and a
plugin-root placeholder in it arrives unexpanded - read it as the plugin root the plan's path
carries. Its seat is installed (the plan checked), so a dispatch it names is made as written. A
`done` or `skip` line is one narration line each - a done capture is re-run later by the user, never
here.

`alfred-capture-related-projects` takes its sibling list as arguments: ONE AskUserQuestion first - type the
siblings via Other in the capture's own form (`<name> - <local path or git URL>`, several separated
by commas), or 'none - skip it' (recommended only when the repo names no sibling). 'none' skips the
capture. `alfred-capture-agent-capabilities` runs LAST, so its generated rule reflects everything the
captures above added; its own precheck decides whether the rule needs regenerating.

## 6. CLAUDE.md - the user's call

Not required - open with WHERE it lives and WHAT a yes changes, then AskUserQuestion (fill it in -
recommended / skip); a 'no' ends the step cleanly. The installer seeded `.claude/CLAUDE.md` from
`stack/CLAUDE.template.md` when the project had none; a CLAUDE.md with the project's own text (root,
`.claude/` or a part's own) is NEVER overwritten. On a yes, read
`$TMP/repo/stack/skills/alfred-capture-claude-md/SKILL.md` (through Bash) and follow it inline, start to finish,
with `STACK=$TMP/repo` - it is this step's instructions, the one home of the fill: its script picks
create (the seed is still unfilled) or improve (every change shown before it is written), and the
check closes it. The captures just run are what it cites for structure. Never offer skill, agent or
MCP changes here - that is `/alfred-code:configure`.

## Close - one card

**The card restates the OUTCOME of every step** - one line each, in step order: each machine item
(installed, failed with its reason, skipped, blocked with its fix), the memory level and database and
whether the import and the switch-off happened, each capture (ran and what it wrote, done, skipped
and why), CLAUDE.md (created, improved or skipped, with the check's last line). Then the user's own next steps as suggestions,
each with its one reason: a restart when step 3 installed a runtime a server needed or step 4 chose
a level other than `global`; `claude mcp list` after it, where every row should read connected;
`${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/post-install.md` as the durable copy. Close the card
with this line, verbatim: 'Nothing is pending on this run - these are yours to run when you choose.'
The line is CONDITIONAL: print it only when the card carries nothing OWED - a blocked item the
servers need, or a failed import, IS owed: name it and put the close through the ask instead
(unattended: name it in the card, list every `unattended:` line under it, and end the run - no ask).

## Unattended - `ALFRED_CODE_UNATTENDED=1`

The first call printed `unattended: on`: nobody answers this run (a print-mode session, a benchmark
cell, a CI job). Every ask it would put - its own, and each one a SKILL.md followed inline reaches -
is answered by the run itself, never AskUserQuestion, by one rule:

- Take the option marked Recommended, unless it is destructive or needs a person.
- **Destructive** means the option deletes, overwrites or rewrites something this run did not create
  and the project or the account owns: a file or a line the project wrote, a doc an earlier capture
  wrote, a setting or status line already set, a stored memory. Adding is never destructive - a new
  file, a new line, a new install, a setting where none was - and neither is moving what the stack
  itself manages with every byte and its git history kept (update's docs-root move). A machine line in
  `refresh` state is destructive (its command replaces the account's existing status line); a
  `missing` one is not.
- **Needs a person** means the option works only with free text typed via Other (a sibling list, a
  name), or it ends the run on something a person must do (paste a fresh-session one-liner, restart).
- Then, and on an ask with no option marked Recommended, take the option that changes nothing (skip,
  none, stop here, run here); an ask with no such option is skipped with its step, and the close names
  it. A multi-select ask takes every pre-selected option that is not destructive.
- Log each answer as one line, `unattended: <question> -> <choice>`, with `(<why>)` when the choice is
  not the Recommended option. Step 2's plan already carries the lines for init's own asks (machine
  installs, memory level, related projects, CLAUDE.md) - apply exactly those, never re-judge them.
- The stack's files are read through the Bash tool, never the Read tool (above): outside the working
  directory the Read tool asks first, and here nobody answers.

## Clean up the temp dir - ALWAYS

Remove `$TMP` per `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md`, on EVERY exit path of THIS command.

## Do not

- Do not install anything the plan did not name, or run a machine command the answer did not pick.
- Do not call a capture skill - read its SKILL.md and follow it; do not re-run a `done` capture.
- Do not reinstall or re-select - no `install`, no `--selection`, no `--add` / `--drop`: that is `/alfred-code:setup` and `/alfred-code:configure`.
- Do not write the snapshot or working files into the project tree, and do not commit anything on the user's behalf.
