---
description: "Install and bootstrap Alfred Code in a project - one command, two phases. Nothing installed: the fresh install - scope and profile up front, the project analysis (the evidence scan plus validate's missing and evidence-gap checks), the six-layer selection walk (rules -> agents -> skills -> hooks -> MCPs -> plugins: one full-catalog table and one selection ask per layer), the prerequisite check and the install, ending on a restart. Typed again in the new session: the one-time bootstrap - what the kept MCP servers need to start (uv, the pinned Python, the kept LSP plugins' servers, the picked browsers, the navigation-server index, claude-hud's status line - one ask first), the shared-memory level and the old notes import, the captures the install carries, the AGENTS.md fill. A later run finishes only what is left. NOT for changing an install - that is configure; a refresh is update."
disable-model-invocation: true
---

# Alfred Code - install, then bootstrap

One command, two phases, never both in one session. The INSTALL phase selects and installs, and ends on a restart:
plugins, MCP servers, skills, seats and rules load at session start, so what it installed is not live in the session
that installed it. The BOOTSTRAP phase - this same command, typed again in the new session - uses them. The install
records decide which phase this run is; nothing else does.

## Which phase - one call first

`node "${CLAUDE_PLUGIN_ROOT}/scripts/install/stamp.js" state . ; node "${CLAUDE_PLUGIN_ROOT}/scripts/init-plan.js" --mode`:
its first line reads the same install records the hooks read (`alfred-code.stamp`, a copied `hooks/docs.js`) in this
repo, its git top level or a worktree's main checkout; its second, `unattended: on|off`, says whether anyone answers
this run's asks (`on` - the bootstrap file's Unattended section governs every ask).

- `not-installed` -> the INSTALL phase. Unattended (`on`), it is not run: print 'the install phase needs a person -
  run /alfred-code:init in an interactive session' and stop.
- `legacy-unstamped` (a legacy copy-route install that never wrote a stamp - no install record, but two of the
  stack's own signatures in `.claude/`: its hook files, its env keys, three or more of its skill, seat or rule names)
  -> ONE AskUserQuestion, so nothing the project already runs is re-picked by hand:

  ```ask
  This project holds an older install that never wrote a stamp - update it, or install from scratch?
  - 'Update this install (Recommended)' - update reads its picks off disk, each old name under its new one, prunes the old copies and writes the stamp
  - 'Fresh install anyway' - the install phase from scratch, its install pruning the old copies the same way
  ```

  'Update this install' -> name `/alfred-code:update` for the USER to type and end the turn; 'Fresh install anyway'
  -> the INSTALL phase. Unattended: `/alfred-code:update` named, the run ends.
- `worktree-of-installed <main>` -> print exactly 'This is a git worktree of <main>, which holds the install - run
  /alfred-code:init from there' and stop - a worktree shares that checkout's install, and nothing is written into
  this tree, or into that one from here.
- `installed` or `initialised` -> the BOOTSTRAP phase - unless the install phase ran in THIS session: then stop, name
  the restart and `/alfred-code:init` in the new session (what it installed is on disk but not loaded here). A
  bootstrap run after an earlier one only finishes what that one left; changing the selection is
  `/alfred-code:configure`, a plain refresh `/alfred-code:update`.

Every sibling command named here is `disable-model-invocation` - the user's to type, never a Skill call from this run
(measured: a run asked WHICH sibling, then tried to invoke it and took the denial) - and belongs in its own session.

**This run needs NO conversation context - so it is worth MOVING, but only out of a session that
is actually loaded.** Measure before you ask: this session's own per-message context is `input +
cache_read + cache_creation` off the last assistant message in the transcript. Ask ONLY when that
figure is past the same trigger `guard-fresh-session-start.js` uses - the tier's own absolute
trigger, `ALFRED_CODE_CONTEXT_WINDOW_FOR_1M` (default 400,000) on a window of 1M or more,
`ALFRED_CODE_CONTEXT_WINDOW_FOR_300K` (default 280,000) on one of 300k up to 1M, or
`ALFRED_CODE_CONTEXT_WINDOW_FOR_200K` (default 180,000) on one of 200k up to 300k - the window is the session
model's own capacity, its row in `.claude/hooks/model-windows.json`; with no row, a window under 200k or a tier left
unset, the trigger is `ALFRED_CODE_CONTEXT_WINDOW_DEFAULT` (default 180,000) itself (the
install phase has no table yet: take the window this session's own model line states - '1M context' is 1,000,000 -
and the 180,000 default trigger only when it states none) - or when that hook has already
injected the ask into this turn. Below the trigger, or when the figure cannot be read at all, or with
`ALFRED_CODE_AUTO_COMPACT=1` or the tier's trigger at `0` (no fresh-session offer then), SKIP the ask silently and
start the phase: an ask with no measurement behind it is the failure this replaced (measured: it fired on the FIRST
message of a brand-new session, twice in one run, and could quote no number when the user challenged it). Never
author the decision in prose either way.

When it does fire, put it through AskUserQuestion: run here anyway, or run in a fresh session
(recommended), quoting the figure you measured - never one measured in some other session. Every
answer names its next action: fresh session -> give the paste-ready one-liner and end the turn;
run here -> start the phase now; not now -> say what is owed and end the turn. If a redirect displaces
the ask, re-offer it ONCE. Unattended, it is never asked: `unattended: fresh session -> run here (the recommended
one hands the run to a person)`.

**Read the stack's own files through the Bash tool (`cat "<file>"`), never the Read tool** - this
command's phase file, the protocol, `walk.md`, a SKILL.md the plan names, every `references/` file inside one. They
sit outside the working directory (the plugin cache, `$TMP`), where the Read tool asks before every read in default
and acceptEdits mode, while a read-only Bash command carries the broader read access
(code.claude.com/docs/en/security, 'Working directory boundary') and a sandboxed one runs without a
prompt (code.claude.com/docs/en/permissions) - an unattended run has nobody to answer that ask. A
launcher that wants the Read tool to reach them too starts the session with
`--add-dir "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/cache" --add-dir "${TMPDIR:-/tmp}"`.

**THE PLUGIN CACHE IS THE SNAPSHOT - the common run downloads nothing but a newer release** - read `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md` in ONE Bash `cat` (never in ranges, never twice) before the phase starts and hold the whole run to it: resolve the snapshot once into `$TMP/repo` - copied from the newest valid plugin-cache entry, downloaded only when there is none (the reference owns the fallback), use every tool from that snapshot (the install phase hands it to the installer with `--source`), and remove `$TMP` per its 'Clean up' section on every exit path. Its 'Narrate, don't trace' section governs every tool call: one quiet call per recompute, no pasted tool output except the plan and the decision tables, one narration line between steps.

**Every ask in this run goes through the AskUserQuestion tool** - concrete options, the recommended one marked, free text via Other; a prose question or a bare stop-and-wait is invalid (measured: prose asks were skipped in live runs while tool-shaped asks were answered every time). A plain-text option list is the fallback only where the harness lacks the tool. Unattended, no ask is put at all: the bootstrap file's Unattended section answers each one.

**House voice in every line this run emits** - narration, tables and the asks alike: single
dashes, never em-dashes, and single quotes in prose. A fresh or refreshed install may have no
`.claude/rules/alfred-interaction.md` loaded at all, so this command's own text is the only place
the voice can come from (measured: a first-run narration line opened with an em-dash, on the one
surface where the rule forbidding it cannot yet exist).

## The phase - its own file, read whole

- INSTALL -> read `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/init-install.md` and `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/stack-detection.md` in ONE Bash `cat` and follow them,
  start to finish: it is this run's instructions - eleven banner steps and the closing card.
- BOOTSTRAP -> the same for `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/init-bootstrap.md` - six banner steps
  and the closing card.

Read only the file of the phase this run is: the other one is never this run's, and its text would ride in the
cached prefix of every message the run sends (~8k tokens for the install phase, ~3.5k for the bootstrap).

## Clean up the temp dir - ALWAYS

Remove `$TMP` per `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md`, on EVERY exit path of THIS
command: after a finished phase, after an abort, and after a blocker or a user 'no' that stops the run early. Then
confirm the project tree holds only installed artifacts.

## Do not

- Do not run both phases in one session, or the bootstrap in the session the install phase ran in.
- Do not call a sibling command or a skill this run installed - name it for the user.
- Do not write the snapshot or working files into the project tree, and do not commit anything on the user's behalf.
