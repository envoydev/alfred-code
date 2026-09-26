---
description: "Remove the Alfred Code stack from THIS project, and nothing of the user's with it. The install ledger in the stamp (every env key, deny entry, hook wiring, MCP registration and copied file the installer wrote, each at the hash it wrote it with) is the whole list: an item still matching its hash goes, one changed since is the user's and is kept and named, and anything the ledger does not name (the user's own hook, server or key) is never touched. The stack's plugin rows and MCP registrations at project or local scope are removed; a user-scope one serves every project on the account, so its commands are printed and never run, like a third-party pick's and the marketplace's. One confirmation first. A stamp from before the ledger is refused with the route (one /alfred-code:update records it). NOT for dropping some items - that is the sibling configure command."
disable-model-invocation: true
---

# Uninstall Alfred Code - the stack out, the user's own config kept

The seed does the whole job from the stamp's ledger; you gate it, confirm it once, run it and report
its own lines. Nothing here is reasoning: keep to the calls below and never inspect or edit a
settings file, `.mcp.json` or a copy by hand - the ledger is what tells the stack's from the user's,
and a hand edit guesses.

**House voice in every line this run emits** - single dashes, never em-dashes, and single quotes
in prose.

## 1. Preconditions

`node "${CLAUDE_PLUGIN_ROOT}/scripts/install/stamp.js" state .` prints one word (two for a
worktree), before anything is downloaded:

- `not-installed` -> say there is no install here to remove, and stop.
- `worktree-of-installed <main>` -> print exactly 'This is a git worktree of <main>, which holds the install - run /alfred-code:uninstall from there' and stop - the installer refuses this tree too.
- `legacy-global` -> a 1.x global install: route to `/alfred-code:update` first (it moves the
  install into the project and records the ledger), and stop.
- `installed` / `initialised` -> go on.

## 2. Confirm once

Put ONE AskUserQuestion: 'Uninstall the stack from this project (Recommended)' vs 'Keep it'. The
question names what goes (the stack's plugin rows and MCP registrations at this project's scope, its
settings entries, hook wirings and copied files, the stamp) and what stays (anything the user added or
changed since the stack wrote it, a user-scope plugin row or MCP registration, the docs root,
`.serena/`, the memory database; at user scope also the seats denied here and `ALFRED_CODE_HOOKS_OFF`,
since the user-scope core stays loaded). 'Keep it' -> end the turn, nothing downloaded.

## 3. Resolve the snapshot, then run the seed

The shared contract is `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md`: resolve
the snapshot once into `$TMP/repo` from the plugin cache, exactly as it says, and remove `$TMP` on
every exit path (step 5). A resolve line reporting `seed=shell` (`ALFRED_CODE_SEED=shell`, or the
1.x `CLAUDE_STACK_SEED`) is refused: print `the shell installers were removed in 2.0.0 - unset ALFRED_CODE_SEED / CLAUDE_STACK_SEED to use the Node installer` and stop. <!-- legacy-name -->

`node "$TMP/repo/scripts/install/alfred-code.js" uninstall --source "$TMP/repo" 2>&1 | tee "$TMP/install.log"`

Read `${PIPESTATUS[0]}`. Exit 1 carries one `error:` line and nothing was touched:

- `predates the install ledger` -> the stamp is from before the ledger, so the stack's entries
  cannot be told from the user's: run `/alfred-code:update` once (it records the ledger), then this
  command again.
- `no alfred-code install here` -> nothing to remove.
- `claude plugin list --json` -> the CLI's plugin listing did not answer, so the stack's rows could
  not be told apart: say so, name that command for the user to check, and run this command again
  once it prints a listing.

## 4. Report the seed's own lines

One `grep -E 'removed|uninstalled|kept|claude plugin|claude mcp|stamp|!!' "$TMP/install.log"`, then a short
report in three parts:

- **Removed** - a count per kind (plugin rows, env keys, deny entries, hook wirings, servers, files).
- **Kept as yours** - every `kept` line, verbatim: a value or file changed since the stack wrote it.
- **Commands to run yourself** - every printed `claude plugin ...` and `claude mcp remove ...` line,
  verbatim: a user-scope row or registration (it loads in every project on the account), a
  third-party pick, the marketplace registration.
  Never run a printed command - which of them the user wants is their call, and a user-scope
  uninstall takes the stack out of every other project too.

`stamp kept` means a step failed (its `!!` line says which): report it, and running this command
again finishes what is left. Close with the restart line: the plugins removed at this scope still
load in this session until Claude Code restarts.

## 5. Clean up the temp dir - ALWAYS

Remove `$TMP` per the source protocol (`rm -rf "$TMP" "$MARK"`), on every exit path: after the run,
after an exit 1, and after a `seed=shell` stop.

## Do not

- Never run a printed command, never edit a settings file, `.mcp.json` or a copy by hand, and never
  delete anything the log does not name as removed.
- Never re-run the seed to feel sure - a second run over a finished uninstall only says there is
  nothing to uninstall.
- Do not commit anything on the user's behalf.
