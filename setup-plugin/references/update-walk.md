# /alfred-code:update - the walk: preconditions, the delta and its asks, the fast path

Read only once `update.md`'s model gate has passed, in the same call as step 1's `stamp.js state` (the router names
it). Steps 6-8 live in `update-close.md`, read in the same call as step 3's `--log` call; the slow path and the rare
branches in `update-slow-path.md`, read only when a step below sends you there.

## 1. Preconditions

This run refreshes an existing install to the newest release, unchanged in shape: the same items, new content -
the MOVING part included (every installed stack plugin through `claude plugin update`) - and removes what the STACK
removed upstream. **No newer plugin is needed:** the snapshot is the release this run installs, so an `already
newest` plugin line is a normal run, never a reason to stop. The installer's `--installed-only` reads the install back and closes its dependencies itself;
`update-preflight.js` computes the upstream delta - you orchestrate and report.

`node "$TMP/repo/scripts/install/stamp.js" state .` prints one word (two for a worktree), read from the install records
the hooks read (`alfred-code.stamp`, a copied `hooks/docs.js`) in this
repo, its git top level or a worktree's main checkout - never from `.claude/skills` or
`.claude/agents`, which a plugin-route install may not have. `not-installed` -> stop and route to
the sibling `/alfred-code:init` command. `worktree-of-installed <main>` -> print exactly 'This is a git worktree of <main>, which holds the install - run /alfred-code:update from there' and stop - a worktree shares that checkout's install, and nothing is written into this tree, or into that one from here; the installer refuses that tree too. `legacy-unstamped` is a legacy copy-route install that never wrote a
stamp (no install record, but two of the stack's own signatures in `.claude/`) -> go on:
this command is its route - step 2's preflight prints `no-stamp` (the fast path) and offers its data move like
any older install's, and the installer logs `no stamp: an unstamped legacy install`, reads the picks off disk
(each old name under its new one; a project's own skill never one of them, never overwritten, and named), prunes
the old copies and writes the stamp. `installed` / `initialised` -> go on. Every scope - project,
user or local - keeps the stamp, the library copies and the settings in the project's `.claude/`,
so there is one mode. The user names items to add or drop -> that is the sibling
`/alfred-code:configure` command, not this one. One installer on every OS (step 3).

## 2. Compute the delta since the stamp - ONE call

Everything this step needs comes back from one call in the snapshot - the preflight, then the release notes THIS
install owes (only the releases between its stamp and the snapshot, from `setup-plugin/references/update-history.md`;
a snapshot without the script prints an error - read nothing more for it and go on):

```bash
node "$TMP/repo/scripts/update-preflight.js" --snapshot "$TMP/repo" --root . ; node "$TMP/repo/scripts/install/release-notes.js" --root . ; node "$TMP/repo/scripts/workspace.js" plan --root . --source "$TMP/repo" > "$TMP/plan.txt" ; grep -qE '^workspace-plan: ([2-9]|[0-9]{2,}) |^gone: |^rescan: ' "$TMP/plan.txt" && cat "$TMP/plan.txt" "${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/update-workspace.md"
```

(The last two read the workspace: with children below, their rows and `update-workspace.md`, the cascade's walk;
standalone, nothing. Add `--rescan` to `plan` when the user asks to find installed projects below.) Pass
`timeout: 600000` to this call: `plan` reads each parent back, one installer run per project with children.

(The preflight reads the scope's settings as the installer does - `settings.local.json` laid over `settings.json` at
local scope, and at every other scope the stack keys `settings.local.json` holds. A fork install passes `--repo <owner/name>`; a
non-default stamp or settings path passes `--stamp` / `--settings`.) This is the WHOLE pre-install read - never
hand-write a second probe for anything it already prints, and never open `meta/migrations.json` yourself: the script
evaluates its declarative `detect` rules (measured: the hand-run form cost four API round trips and pulled a
2,000-character maintainer `_comment` into context for a three-line existence check). A printed release-notes section
is reported in step 7 beside the installer lines it explains.

It prints, in order:

- `version: <old> -> <new>` then `base: <sha> head: <sha>` - lead your narration with the version delta.
- `status<TAB>path` lines (`modified`/`added`/`removed`, `renamed` with `<- old-path`) filtered
  to stack-owned paths - what has been RELEASED since the stamp (work still on `develop` is invisible by design).
- `changed: skills=<n> agents=<n> rules=<n> hooks=<n> template=<yes|no>` - the RELEASE's delta bucketed by
  install class; the installer's log tail counts every file it COPIED, which is all of them on every run,
  so it can never answer 'what changed'.
- `changed-here: skills=<n> agents=<n> rules=<n> hooks=<n>` - the part of that delta THIS install carries. Step 7
  names THIS as the refresh, and it gates the `/capture-awareness` suggestion.
- `migration: <id><TAB><detect kind>` per DETECTED entry, or `migrations: none detected`, each
  followed by its own indented `why:` / `then:` / `remove:` / `unwire:` / `env-rename:` /
  `env-rename-prefix:` / `env-remove:` / `env-reset:` / `env-off:` / `env-fold:` lines - everything you act on. A detected entry joins the prune
  list labeled `(migration: <why>)`.
- `new: <category> <name><TAB><verdict><TAB><entry|->` per item the release ADDED or RENAMED, or
  `new: none` - classified against THIS install by the derivation, never by you, with optional
  trailing fields `take|leave` (an offer's recommendation), `enables=<entries>` (what a yes would
  switch on), `from=<old name>` (a rename), `old-on-disk` (the rename's old copy is still
  installed) and `was-off` (the OLD name was switched off). Verdicts: `arrives` (this refresh brings
  it, on), `renamed` (a copied item whose old copy is on disk - the update carries it), `offer`
  (only a yes brings it), `off` (the user's own off-state names it), `unknown` (the plugin listing could
  not be read).
- `data-move: offer <root><TAB>from=<places><TAB>...` - this project's data sits outside its data root, or
  `data-move: none (<why>)`. Only `offer` is asked, below.
- `docs-move: offer <from> -> <to><TAB>moves=<names><TAB>stack=<n><TAB>own=<names|none>` - a docs root the user set by
  hand holds the stack's docs, or `docs-move: none (<why>)`. Only `offer` is asked, below.
- `instructions-file: <agents|claude> files=<...> answer=<...> local=<yes|no> update=<ask-rename|ask|ask-local|record-claude|none>`
  - the instruction file's name: the install's, the files', the stamp's answer (`none` before 2.10.0 asked it), a
  CLAUDE.local.md, and the verdict. Only `ask-rename`, `ask` and `ask-local` are asked, below; `record-claude` is passed
  unasked.
- `env-keys: <names>` - the scope's settings `env` KEY NAMES before the run, the before-state step 7 diffs against.
  Names only: the script never prints a value, and neither do you. An `unattended: on` line closes the output: nobody answers this run, and every
  ask below is answered by `/alfred-code:init`'s Unattended rule (references/init-bootstrap.md) instead of AskUserQuestion.
  **Never dump that settings file** - a plain `cat` of it put a live token into a transcript twice; the safe reads
  are `node "$TMP/repo/stack/hooks/guard-secret-value.js" --redacted <settings.json>` and `--presence <settings.json> KEY ...`.

**Environment migrations never join the prune list.** They act on the scope's settings.json `env`, and none can
lose what the user chose: a rename carries the value across, and a removal drops only a key this stack RETIRED (at
its exact seeded value where the key still means something elsewhere). The installer's env pass applies them in the
refresh (renames, then removals, then the absent-only seeds, so a value set under the old name is never
overwritten by the new key's default), and prints one line each - step 7 reports them.

**Build the prune list** from the detected migrations alone - the removals step 5 makes by hand. The installer prunes
every copy the release retired or renamed ITSELF, on either path and whatever step 4's answer, so a compare `removed`
line or a `new:` row carrying `old-on-disk` is reported at step 7 from the `--log` call's `pruned:` line, never offered
as a choice (measured: a 'Refresh only' option promised the old copies would stay, and the installer pruned all 34).
Then route, as numbered actions:

1. **Name the compare signal**, if one applied, in your narration now - `no-stamp` (exit 2 - no baseline, refreshing
   unaffected), `compare-unreachable` (exit 3 - same), or a `TRUNCATED` line (third after the version and base lines:
   the compare caps at 300 files, so the file list may be incomplete). Step 7 repeats it as its COMPARE line, and a
   `TRUNCATED` one routes the reconcile to `/alfred-code:configure` there (audit 2026-10-20 C15, a72fdfbc: a
   truncated compare went out as 'Fast path: no migrations, no offers', the signal never named).
2. **Prune list EMPTY** -> step 3, the fast path. **NON-EMPTY** -> read `update-slow-path.md` and run its step 4.

**New items - ONE ask, and only when a `new:` line says `offer`.** Put every offer through one
AskUserQuestion before the installer runs, each named with its entry or 'copied', the entries its
`enables=` field names, and the reason in a few words - this template when at least one offer says `take`:

```ask
Add what this release brings? <each offer: its name, its entry or 'copied', the entries it enables, the reason in a few words>.
- 'Take the recommended (Recommended)' - the offers marked take, each one --add on the installer call
- 'Take all' - every offer, each one --add
- 'Take none' - nothing is added; /alfred-code:configure adds any later
```

and this one when none does:

```ask
Add what this release brings? <each offer, as above> - none is marked take.
- 'Take none (Recommended)' - nothing is added; /alfred-code:configure adds any later
- 'Take all' - every offer, each one --add on the installer call
```

A free-text answer names the ones to take. Each taken offer becomes one `--add "<category> <name>"` on the installer call of whichever
path runs, and so does every `renamed` row, unasked; every `was-off` row becomes one
`--drop "<category> <name>"`, so the user's switch-off carries onto the new name. `arrives`, `off` and `unknown` are never
asked - they go in the step-7 report. No offer, no ask: this is still the no-questions refresh. Unattended, the ask
takes its Recommended option (adding the recommended items only adds), logged as one `unattended: <question> ->
<choice>` line.

**The data root - ONE ask, and only on `data-move: offer`.** Read `update-slow-path.md`'s 'The data root move'
first (the typed-folder and `conflicts=` cases live there), then one AskUserQuestion before the
installer runs, naming the `from=` places - in the SAME call as the new-items ask when both fire, one question each:

```ask
Move this project's sensitive-data file into <root>? From <from places>. Recommended: one folder outside .claude/, its machine state kept out of git.
- '<root> - move it (Recommended)' - the file moves in this run; nothing is overwritten
- 'Keep the current layout' - nothing moves, the hooks keep reading it where it is, and no later update asks again (configure can still move it)
```

After a move, until that restart this session's hooks keep writing under the OLD root - they read it from the
environment the session started with - and its loaded rule text still names the old one (audit 2026-10-11, session
bca100bd: the monitor hook re-created `<old root>/flow/` after the move). Say so in the close, with the one action it
leaves: after the restart, a file under the old root's `state/` or `statistics/` - or, from a session that started
before 2.8.0, its `flow/` or `hook-blocks/` - is this session's record and safe to delete.

**A docs root the user set by hand - ONE ask, and only on `docs-move: offer`.** Every other leftover docs root moves
unasked; this one may be the team's own folder, and the stack picks its entries by name - so the question names every
entry of `moves=`, never a count alone, and the user spots a `decisions/` or `architecture/` of the team's own. There is
no keep: every docs file of the stack's belongs under the data root, and a user who wants it elsewhere changes the data
root. In the same AskUserQuestion call as the other asks (one question each):

```ask
Move <every moves= entry> from <from> to <to>? <from> was set by hand, and the stack picks these by name. <n> files move (git renames where tracked); <own> stay where they are.
- 'Move them all (Recommended)' - every docs file of the stack's under the data root, as every install has from 2.8.0; a link to an old path needs updating
- 'Some are the team's own' - pick them next: they stay in <from>, the rest move, and the setting goes either way
```

'Move them all' is `--docs-root-move move` on the installer call of whichever path runs. 'Some are the team's own'
opens ONE AskUserQuestion call of multi-select questions, each option one `moves=` entry spelled as printed (2-4 options
a question, up to 4 questions; header `Team's own`); the picks are `--docs-root-move move --docs-root-leave
<entry>,<entry>`, and no pick is 'Move them all'. With one `moves=` entry there is nothing to pick from: ask it as a
yes / no - 'Move it (Recommended)' or 'It is the team's own' - and the second is a plain no, which moves nothing: the
setting goes and that folder stays where it is. A `!! docs root: --docs-root-leave names ...` line means a name was
none of the stack's and nothing moved: ask again from the names it lists. Unattended, take the Recommended option,
`--docs-root-move move`: every docs file of the stack's belongs under the data root, a move loses nothing (git renames
where tracked), and the log's `docs root: moved` line names what moved, so the team can move one back with
`git mv <to>/<entry> <from>/<entry>` - say that line in the close.

**The instruction file's name - ONE ask, on `update=ask-rename`, `update=ask` or `update=ask-local` only.** Before the installer runs, in
the same AskUserQuestion call as the other asks (one question each): read
`"$TMP/repo/setup-plugin/references/instructions-place.md"` and ask the name template its `update=` rule names - never
the place, which is configure's. The answer is `--instructions-file agents|claude` on the installer call of whichever
path runs (`update=record-claude`: `--instructions-file claude`, unasked, said in one line; `update=ask-local`'s 'Keep the
AGENTS.md answer' passes none and is asked again while the CLAUDE.local.md is there); the stamp records any other
answer, so the next update asks no more. The log names each rename. Unattended, take the Recommended option: a rename keeps every byte
and its git history - except on `update=ask-local`, which takes 'Keep the AGENTS.md answer': the Recommended one writes over
the user's own answer, and an unattended run replaces nothing of theirs (review 2026-10-23).

**The workspace - in the same AskUserQuestion call as the other asks, one question each.** On `workspace: role-ask
<case> <rel>` the folders around this project changed since its role was answered. `node "$TMP/repo/scripts/workspace.js"
role --root . --when update` prints the options as `ask: <label><TAB><answer>` lines, Recommended first; the question
by case:

- `never` - 'A folder above, `<rel>`, holds an install this project never joined. Join it?';
- `above` - 'A new install sits above this project at `<rel>`. Join it?';
- `rejoin` - '`<rel>` no longer lists this project as its child. Rejoin it?';
- `parent-gone` - 'This project's parent, `<rel>`, holds no install now. Become standalone?' - the values it read
  there go back to the defaults, named;
- `between` - 'A new install sits at `<rel>`, between this project and its parent. Stay where it is?'.

```ask
<the case's question above>
- '<the first ask: label up to its mark> (Recommended)' - what the case's words say it does
- '<each next ask: label>' - the other way
```

Run `node "$TMP/repo/scripts/workspace.js" role --root . --answer <the chosen line's answer>` before the installer call;
every answer is recorded, so the same folders are not asked about again; a leave keeps every value read through the
workspace. On exit 3 (a workspace file was locked) say
the ask comes back at the next update. Unattended, take the first. On `instructions-both: ask` (a CLAUDE.md
above a joined child, and the account loads only one of the two files):

```ask
Load CLAUDE.md and AGENTS.md both, in every project of this account? A parent folder holds a CLAUDE.md, so this child's AGENTS.md is skipped there.
- 'Load both (Recommended)' - one key in the account's settings.json, removed again by the last uninstall that recorded it
- 'Leave it' - nothing is written and no project of this account asks again
```

'Load both' runs `node "$TMP/repo/scripts/workspace.js" account-instructions --root . --apply`, 'Leave it' the same with
`--decline`. Unattended, both take the Recommended option.

## 3. Fast path - refresh in place (the common case)

Run the installer; it reads the install back itself, closes new dependencies through `stack-select.js`, and logs
any `installed-only: required:` additions. **One fixed capture form, always** - `2>&1 | tee "$TMP/install.log"` on
the call itself (the shared contract is in `source-protocol.md`'s 'Capture the installer's own output'):

- **Any OS:** `node "$TMP/repo/scripts/install/alfred-code.js" update --source "$TMP/repo" --scope <scope> --installed-only [--add "<category> <name>"]... [--drop "<category> <name>"]... --keep-pins [--docs-versioning git|local] [--data-move move|keep] [--data-path <folder>] [--docs-root-move move [--docs-root-leave <entry>,...]] [--instructions-file agents|claude] 2>&1 | tee "$TMP/install.log"`
- **`ALFRED_CODE_SEED=shell`** - the resolve line reported `seed=shell` (`ALFRED_CODE_SEED` set to `shell`). The frozen OS twin is gone, so it no longer runs: print `the shell installers were removed in 2.0.0 - unset ALFRED_CODE_SEED to use the Node installer` and stop.

`<scope>` comes from `node "$TMP/repo/scripts/install/stamp.js" scope .` (`project`, `user` or `local`).
`--keep-pins` is the default here - a fast refresh must not
flatten deliberate local model/effort pin edits. `--docs-versioning` rides the call ONLY when the
user's own invocation names a value - read `update-slow-path.md`'s 'Flags' section first.

**Give that call a 10-minute timeout, and read its exit code.** A timed-out call is BACKGROUNDED, not failed, and
the run then pays turns re-finding its own installer. Pass `timeout: 600000`, open the call with
`set -o pipefail;`, append `; echo "install exit: $?"` and read THAT number. A NON-ZERO exit stops the run - report
the log's last lines verbatim as a blocker with the fix they name, and never continue to the prune, the close, or
ad-hoc repair work (measured: 14 messages and 1.69M tokens of improvised forensics after exit 1, then 226 files
changed under the user's `.claude` with no ask).

The refresh updates each stack plugin at EVERY scope it is installed at (`plugin update [<scope>]: <entry>` as
`x -> y`, `installed this run` or `already newest`; `plugin current [<scope>]` for one the resolve already took to
the release), and never moves an item between scopes or removes a pick - only what the release itself retired or
renamed goes. Pass these log lines through verbatim in the close: the `mcp servers:` block - the servers an earlier
release registered, taken out by the first update onto 2.10.1 or later (`mcp <name>: kept` for one changed since, the
user's), each with its `add it back:` line, and the `mcp data:` line naming what they left on disk - a row kept at
another scope with its uninstall command, `context7-local removed - if you ran /mcp disable context7 for it, run /mcp
enable context7`, and `claude-hud has no status line yet - run /alfred-code:init to set it up` - it prints on EVERY run where
claude-hud is installed - this run or already - and no settings file this project reads has a `statusLine` yet; name
`/alfred-code:init` in the close when it prints.

**ONE post-install read.** Everything the report needs is in the log - take it in a single call, never a tail and
never a second grep (a tail is ~75% static boilerplate, and two greps of one log cost two full context re-sends):

```bash
grep -aE 'installed/refreshed this run|mcp servers:|mcp data:|mcp pruned:|mcp [A-Za-z0-9_.-]+: (the|kept)|add it back:|is installed at [a-z]+ scope, not this run|is parked here - kept|plugin [A-Za-z0-9_.-]+:|plugin pruned|installed-only: (required|adopting|keeping|adding|dropping|every hook|the stamp predates)|agent kept:|roster:|names nothing this release ships|was dropped from this install|settings(\.local)?\.json( env)?:|renamed:|docs (migration|domain|root|move)|data root:|layout:|!!|overwriting a hand-edited copy|context7-local removed|has no status line yet|plugin moved \[|taking over a copy' "$TMP/install.log"
```

Add a marker to the pattern when the report needs another fact; do not add a call. The RESTART row and any
fail-soft `!!` are not judged from that dump - they are PRINTED by the script that already prints `changed:`,
and the same call reads the rest of the run, `update-close.md` (steps 6-8):

```bash
node "$TMP/repo/scripts/update-preflight.js" --log "$TMP/install.log" --hooks <step 2's changed: hooks=N> --running "${CLAUDE_PLUGIN_ROOT}" ; cat "${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/update-close.md"
```

Paste `restart: yes|no`, every `warn: <line>`, and its `renamed:` / `pruned:` lines verbatim - step 7 reads them, not
the raw grep. `--running` is the release this session loaded, so a session already on the snapshot's release owes no
restart for the hook delta.

Then:

- With `$TMP/plan.txt` naming a child, run `update-workspace.md`'s cascade call now - the same call on either answer.
- Reconcile the project's AGENTS.md (`update-close.md`'s step 6).
- Report per its step 7.
- On the copy route, NAME every `installed-only: adopting hook <name>` line in the report with what it blocks; a
  `guard-*` hook still absent after the run is `update-slow-path.md`'s 'A guard hook still absent' ask.
- Clean up `$TMP` (its step 8) and stop. The slow path's steps 4-5 never run on this path.

## Do not

- Never delete anything the upstream diff or the migrations catalog did not name - user-authored
  skills/agents/rules/hooks and the generated rules (`alfred-architecture.md`, `alfred-awareness.md`, the awareness docs)
  appear in neither; if a candidate is in neither list, it stays.
- Never install an addition the step-2 ask did not take, and never remove an MCP or plugin the
  diff did not retire - dropping by choice, and adopting anything the release did not add, is
  the sibling `configure` command.
- Never skip the step-4 confirm before deletions, never run past a blocker, and never leave
  `$TMP` behind. Do not commit anything on the user's behalf.
- Never re-derive in chat what a script already computed: no re-listing installed items on the
  fast path, no reading the compare's raw API JSON, no paging installer output beyond the one
  grep step 3 names, and no hand-written probe for anything step 2's preflight already printed.
- **A fail-soft `!!` line is not a re-run trigger.** The installers log `!!` for a step that fell
  back and CONTINUED - the fallback is the designed behaviour, and the line usually says so.
  Report it; never re-run the installer end to end to feel sure (measured: one run did, at about
  half the session's total cost, and changed nothing).
