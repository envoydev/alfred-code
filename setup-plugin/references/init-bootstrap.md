# The bootstrap phase - `/alfred-code:init` after the install's restart

`/alfred-code:init` reads this file when the install records read `installed` or `initialised`, in a session
started AFTER the install phase's restart - the plugins, servers and seats it installed load at session start, and
this run uses them. Its preamble - the fresh-session measurement, the snapshot protocol, the AskUserQuestion rule, the
house voice and the Bash-only reads of the stack's own files - holds for every line below. A run after an earlier one
reads what is already in place and skips it (`present`, `done`), so it only finishes what the earlier one left.

Six steps, one banner line before each: `[step n/6 - <name>] <what> · next: <name>` - 1 read the
install · 2 the plan · 3 machine installs · 4 memory · 5 captures · 6 AGENTS.md.

## 1. Read the install

One call, nothing changed: `node "$TMP/repo/scripts/install/alfred-code.js" update --source "$TMP/repo" --installed-only --print-plan --plan-out "$TMP/installed.json" > "$TMP/plan.out" 2>&1` - the installer's own read-back (skills, agents, plugins, `left_out`, `browser`), under the scope the stamp records. `--installed-only found nothing installed` means there is no install after all: stop, and name `/alfred-code:init` for a fresh session - its first call then reads `not-installed` and runs the install phase.

**`ALFRED_CODE_SEED=shell`** - the resolve line reported `seed=shell`: print `the shell installers were removed in 2.0.0 - unset ALFRED_CODE_SEED to use the Node installer` and stop.

## 2. The plan - a script states it, never you

`node "$TMP/repo/scripts/init-plan.js" --installed "$TMP/installed.json" --root . --plugin-root "${CLAUDE_PLUGIN_ROOT}"` (plus `--space <name>` on step 4's rule) - paste its lines byte-for-byte in ONE fenced block. It probes this machine and names, in order (unattended, followed by one `unattended:` line per ask of steps 3 to 6 - the answers, taken exactly):

- `machine: <what> - present | missing: <command> | missing after uv: <command> | refresh: <command> | blocked: <why> | skip: <why>` -
  uv, the pinned Python fetched through it, `csharp-ls` when `csharp-lsp` is kept, `typescript-language-server`
  (with the TypeScript 6 it reads) when `typescript-lsp` is kept, the picked
  browsers (a firefox / webkit setup's install failed to download; a chrome / msedge the
  machine does not have), the navigation-server index, then claude-hud's status line and compact
  layout (the account's, or this project's `settings.local.json` for a claude-hud installed for this project alone). The command is the exact one to run.
- `capture: <skill> - run: read <SKILL.md> | done: <output> exists | skip: <why>` - the three
  captures in their fixed order, each only when the install lists its skill AND its seat
  (`capture-awareness` has none, and runs whenever it is installed - each of its parts decides from disk).

Nothing is inferred beyond those lines: a machine item the plan does not name is not this run's.

## 3. Machine installs - ONE ask

No `missing` or `refresh` line: one narration line, next step. Otherwise ONE AskUserQuestion - the servers that
need these cannot start without them; AskUserQuestion has no pre-selection, so a pick goes through a second call
(audit 2026-10-21 C-T4-01):

```ask
Install the <n> machine items the plan names? <each item's label>.
- 'Install all of them (Recommended)' - each line's exact command runs, in plan order
- 'Pick which' - the next call is a multi-select, one option per `missing` / `missing after uv` / `refresh` line, the label the item and the description its exact command
- 'Skip' - nothing is installed; a server that needs one stays down until it is
```
 A `blocked` line is not an
option: name its fix once (the .NET SDK for csharp-ls, the browser for a picked chrome or msedge) -
the user installs it; never attempt one. `claude-hud status line + compact layout` is one of those
lines: its command (`hud-statusline.js`) writes the `statusLine` claude-hud's own setup would - into the
account `settings.json`, or into this project's `.claude/settings.local.json` when claude-hud is installed for
this project alone (2.2.0: the user picks its scope, this project by default) - then claude-hud's row of `meta/plugin-settings.json`, add-only - a status line that is not
claude-hud's is kept and reported with `/claude-hud:setup`. Its command ends in
`# adds <n> claude-hud keys: <names>`, a shell comment the description keeps, so keys an install-phase Skip
left out are named before they land. `refresh` is claude-hud's own line in a stale shape: the description says it
is replaced, after the command copies the account `settings.json` to `settings.json.bak.<time>`. A
`skip` line is not an option either: one narration line (claude-hud absent or switched off, or the
user's own status line with nothing else to add).

Run the picked commands in plan order, uv first - the `after uv` ones need it. A fresh uv lands in a
directory the running shell may not have on PATH yet: its installer prints where. When `uv` is not
found afterwards, EVERY later command of this run carries that directory first -
`PATH="<dir>:$PATH" <command>` - step 3's `after uv` commands and step 4's `memory.js init` alike,
since the import it runs needs `uvx`. The navigation-server index, a browser download and the memory
model (the service's ~166MB embedding model, fetched so its first start fits Claude Code's 30s connect
budget) take minutes: start them in the background and go on to step 4, collecting each result before step 5's
architecture capture (it navigates by symbol) and the close. Report each as installed, failed (its
error line quoted) or skipped by the answer. A server this session started before its runtime existed
connects only after a restart - the close names it.

## 4. Memory - the level, then the notes import

The shared memory database the `alfred-memory` server reads. Paste this table first:

```
| level | database | who shares it |
|---|---|---|
| global (Recommended) | ~/.alfred-memory/memory.db | every Claude account and Cursor on this machine |
| scoped | ~/.alfred-memory/memory_<space>.db (memory_default.db with no space) | just this one Claude account, and Cursor installed with the same space |
| project | <project>/.alfred/.alfred-memory/memory.db (under the data root), gitignored | this project only, from any account |
```

A 2.0.0 database under `~/.memory-mcp` (or `<project>/.memory-mcp`) is the same level: the memory
server's launcher moves the folder at its next start once no server holds it, and links the old path
so Cursor and an install not yet updated reach the same file; until then the level names it where it is.

Then ONE AskUserQuestion with those three options, `global` marked Recommended - the whole point of
shared memory. Picking `project` while this project's awareness docs name sibling repos
(`<docs-path>/awareness/RELATED-PROJECTS-AWARENESS.md`) means their memories are not visible from
here - one caveat line in the close.

Apply it with the init-only entry point - no reinstall; under `.claude/` only the settings key and the
stamp's `initialised:` line change:
`node "$TMP/repo/scripts/install/memory.js" init --project-root . --level <answer> [--space <name>]`
(`--space` when this session's account dir is `~/.claude-<name>`; the same `PATH` prefix as step 3
after a fresh uv). It writes the level into the
`ALFRED_CODE_MEMORY_DB` key the server's launcher reads (the settings file the stamp's scope names),
keeps the database folder out of git at `project` level (the data root's `.gitignore` does it; a folder outside the root gets its own), imports this project's old `MEMORY.md` /
`memory/*.md` notes into THAT database once through the memory service, and - only when the import
succeeds - switches Claude's own memory off (`autoMemoryEnabled: false`; an install that found no notes
already did, and the step reports it as already off) and marks the stamp
`initialised: <date>`, the one signal the router reads and no other run writes. Report its lines: the
level, the import count or WHY it stopped (no `uvx` is the usual one - step 3 skipped uv), and
whether the switch-off happened; never claim it from the answer alone. A failed import leaves Claude's
own memory ON, and the old note files are never deleted. It refuses a copy-route registration at
another path (`.mcp.json`, else the account `.claude.json`) - name its
`/alfred-code:update --memory-level <level>` line. The server
this session runs still opens the database the install phase pointed it at until a restart - when the level is
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

`capture-awareness` runs LAST, so its inventory reflects everything the captures above added. It asks
its own questions on the way - the run book's gaps, and the sibling repos (typed via Other, or 'None' for a
standalone repo) - and its script decides what needs rewriting.

## 6. AGENTS.md - the user's call

Not required - open with WHERE it lives and WHAT a yes changes, then AskUserQuestion (fill it in -
recommended / skip); a 'no' ends the step cleanly. The installer seeded `.claude/AGENTS.md` from
`stack/AGENTS.template.md` when the project had none - `CLAUDE.md`, and the root, where the install's name and place
answers said so; an instruction file with the project's own text (root, `.claude/` or a part's own) is NEVER overwritten. On a yes, read
`$TMP/repo/stack/skills/habits-adjust-agents-md/SKILL.md` (through Bash) and follow it inline, start to finish,
with `<stack>` = the `$TMP/repo` path, pasted as a literal - it is this step's instructions, the one home of the fill: its script picks
create (the seed is still unfilled) or improve (every change shown before it is written), and the
check closes it. The captures just run are what it cites for structure. Never offer skill, agent or
MCP changes here - that is `/alfred-code:configure`.

## Close - one card

**The card restates the OUTCOME of every step** - one line each, in step order: each machine item
(installed, failed with its reason, skipped, blocked with its fix), the memory level and database and
whether the import and the switch-off happened, each capture (ran and what it wrote, done, skipped
and why), AGENTS.md (created, improved or skipped, with the check's last line). Then the user's own next steps as suggestions,
each with its one reason: a restart when step 3 installed a runtime a server needed or step 4 chose
a level other than `global`; `claude mcp list` after it, where every row should read connected;
`${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/post-install.md` as the durable copy. Close the card
with this line, verbatim: 'Nothing is pending on this run - these are yours to run when you choose.'
The line is CONDITIONAL: print it only when the card carries nothing OWED - a blocked item the
servers need, or a failed import, IS owed: name it and put the close through the ask instead
(unattended: name it in the card, list every `unattended:` line under it, and end the run - no ask).

## Unattended - `ALFRED_CODE_UNATTENDED=1`

`/alfred-code:init`'s first call printed `unattended: on`: nobody answers this run (a print-mode session, a benchmark
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
  it. A multi-select ask takes the options its question names as the default, a destructive one left out.
- Log each answer as one line, `unattended: <question> -> <choice>`, with `(<why>)` when the choice is
  not the Recommended option. Step 2's plan already carries the lines for init's own asks (machine
  installs, memory level, AGENTS.md) - apply exactly those, never re-judge them.
- The stack's files are read through the Bash tool, never the Read tool (above): outside the working
  directory the Read tool asks first, and here nobody answers.


## Do not

- Do not install anything the plan did not name, or run a machine command the answer did not pick.
- Do not call a capture skill - read its SKILL.md and follow it; do not re-run a `done` capture.
- Do not reinstall or re-select - no `install`, no `--selection`, no `--add` / `--drop`: that is the install phase (a project with nothing installed) and `/alfred-code:configure`.
- Do not write the snapshot or working files into the project tree, and do not commit anything on the user's behalf.

