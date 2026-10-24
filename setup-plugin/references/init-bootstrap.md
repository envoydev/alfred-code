# The bootstrap phase - `/alfred-code:init` after the install's restart

`/alfred-code:init` reads this file when the install records read `installed` or `initialised`, in a session
started AFTER the install phase's restart - the plugins and seats it installed load at session start, and
this run uses them. Its preamble - the fresh-session measurement, the snapshot protocol, the AskUserQuestion rule, the
house voice and the Bash-only reads of the stack's own files - holds for every line below. A run after an earlier one
reads what is already in place and skips it (`present`, `done`), so it only finishes what the earlier one left.

Five steps, one banner line before each: `[step n/5 - <name>] <what> · next: <name>` - 1 read the
install · 2 the plan · 3 machine installs · 4 captures · 5 AGENTS.md.

## 1. Read the install

One call, nothing changed: `node "$TMP/repo/scripts/install/alfred-code.js" update --source "$TMP/repo" --installed-only --print-plan --plan-out "$TMP/installed.json" > "$TMP/plan.out" 2>&1` - the installer's own read-back (skills, agents, plugins, `left_out`), under the scope the stamp records. `--installed-only found nothing installed` means there is no install after all: stop, and name `/alfred-code:init` for a fresh session - its first call then reads `not-installed` and runs the install phase.

**`ALFRED_CODE_SEED=shell`** - the resolve line reported `seed=shell`: print `the shell installers were removed in 2.0.0 - unset ALFRED_CODE_SEED to use the Node installer` and stop.

## 2. The plan - a script states it, never you

`node "$TMP/repo/scripts/init-plan.js" --installed "$TMP/installed.json" --root . --plugin-root "${CLAUDE_PLUGIN_ROOT}"` - paste its lines byte-for-byte in ONE fenced block. It probes this machine and names, in order (unattended, followed by one `unattended:` line per ask of steps 3 to 5 - the answers, taken exactly):

- `machine: <what> - present | missing: <command> | refresh: <command> | blocked: <why> | skip: <why>` -
  `csharp-ls` when `csharp-lsp` is kept, `typescript-language-server` (with the TypeScript 6 it reads) when
  `typescript-lsp` is kept, then claude-hud's status line and compact
  layout (the account's, or this project's `settings.local.json` for a claude-hud installed for this project alone). The command is the exact one to run.
- `capture: <skill> - run: read <SKILL.md> | done: <output> exists | skip: <why>` - the three
  captures in their fixed order, each only when the install lists its skill AND its seat
  (`capture-awareness` has none, and runs whenever it is installed - each of its parts decides from disk).

Nothing is inferred beyond those lines: a machine item the plan does not name is not this run's.

## 3. Machine installs - ONE ask

No `missing` or `refresh` line: one narration line, next step. Otherwise ONE AskUserQuestion - the plugins that
need these cannot start without them; AskUserQuestion has no pre-selection, so a pick goes through a second call
(audit 2026-10-21 C-T4-01):

```ask
Install the <n> machine items the plan names? <each item's label>.
- 'Install all of them (Recommended)' - each line's exact command runs, in plan order
- 'Pick which' - the next call is a multi-select, one option per `missing` / `refresh` line, the label the item and the description its exact command
- 'Skip' - nothing is installed; a language server that needs one stays down until it is
```
 A `blocked` line is not an
option: name its fix once (the .NET SDK for csharp-ls, Node and npm for typescript-language-server) -
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

Run the picked commands in plan order and report each as installed, failed (its error line quoted) or skipped
by the answer. A language server this session started before its binary existed connects only after a restart - the
close names it.

## 4. Captures - each SKILL.md followed inline

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

## 5. AGENTS.md - the user's call

Not required - open with WHERE it lives and WHAT a yes changes, then AskUserQuestion (fill it in -
recommended / skip); a 'no' ends the step cleanly. The installer seeded `.claude/AGENTS.md` from
`stack/AGENTS.template.md` when the project had none - `CLAUDE.md`, and the root, where the install's name and place
answers said so; an instruction file with the project's own text (root, `.claude/` or a part's own) is NEVER overwritten. On a yes, read
`$TMP/repo/stack/skills/habits-adjust-agents-md/SKILL.md` (through Bash) and follow it inline, start to finish,
with `<stack>` = the `$TMP/repo` path, pasted as a literal - it is this step's instructions, the one home of the fill: its script picks
create (the seed is still unfilled) or improve (every change shown before it is written), and the
check closes it. The captures just run are what it cites for structure. Never offer skill, agent or
plugin changes here - that is `/alfred-code:configure`.

## Close - one card

First, one call marks the bootstrap done - `node "$TMP/repo/scripts/install/stamp.js" mark .` dates the stamp's
`initialised:` line (the router reads it) and prints it; a step skipped by the answer is still this run's, so it marks
too. Its one line goes in the card.

**The card restates the OUTCOME of every step** - one line each, in step order: each machine item
(installed, failed with its reason, skipped, blocked with its fix), each capture (ran and what it wrote, done, skipped
and why), AGENTS.md (created, improved or skipped, with the check's last line), then the `initialised:` line. Then the
user's own next steps as suggestions, each with its one reason: a restart when step 3 installed a language server
binary; `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/post-install.md` as the durable copy. Close the card
with this line, verbatim: 'Nothing is pending on this run - these are yours to run when you choose.'
The line is CONDITIONAL: print it only when the card carries nothing OWED - a blocked item a
kept plugin needs IS owed: name it and put the close through the ask instead
(unattended: name it in the card, list every `unattended:` line under it, and end the run - no ask).

## Unattended - `ALFRED_CODE_UNATTENDED=1`

`/alfred-code:init`'s first call printed `unattended: on`: nobody answers this run (a print-mode session, a benchmark
cell, a CI job). Every ask it would put - its own, and each one a SKILL.md followed inline reaches -
is answered by the run itself, never AskUserQuestion, by one rule:

- Take the option marked Recommended, unless it is destructive or needs a person.
- **Destructive** means the option deletes, overwrites or rewrites something this run did not create
  and the project or the account owns: a file or a line the project wrote, a doc an earlier capture
  wrote, a setting or status line already set. Adding is never destructive - a new
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
  installs, AGENTS.md) - apply exactly those, never re-judge them.
- The stack's files are read through the Bash tool, never the Read tool (above): outside the working
  directory the Read tool asks first, and here nobody answers.


## Do not

- Do not install anything the plan did not name, or run a machine command the answer did not pick.
- Do not call a capture skill - read its SKILL.md and follow it; do not re-run a `done` capture.
- Do not reinstall or re-select - no `install`, no `--selection`, no `--add` / `--drop`: that is the install phase (a project with nothing installed) and `/alfred-code:configure`.
- Do not write the snapshot or working files into the project tree, and do not commit anything on the user's behalf.

