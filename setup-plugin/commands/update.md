---
description: "FAST refresh of an existing Alfred Code install to the newest release - no selection questions (one ask only when the release adds an item this install would not otherwise carry): every installed item, MCP runtime and stack plugin moves to the release's own content and pins, MCP registrations are verified against the manifest and repaired, and what the stack itself retired or renamed upstream since the stamp is pruned - computed from the stamp compare and meta/migrations.json, never guessed; user-authored artifacts and the generated rules are never touched, and one confirmation comes before any migration removal. NOT for choosing items to add or drop - that is /alfred-code:configure; not a first install - that is /alfred-code:init."
disable-model-invocation: true
---

# Update Alfred Code - refresh everything, prune what upstream removed

## 0. Where to run it

**The model gate comes first - before any tool call and before reading further.** This walk is script
orchestration, not reasoning - a stamp compare, an installer invocation, a grep over its log. It runs identically on
the cheap tier and costs about a THIRD as much there (measured: the same scripted walk in the same project cost 3x on
`opus[1m]` as on sonnet). A frontmatter `model:` key CAN pin a skill's run to a tier (the Claude Code skills
frontmatter reference lists `model` and `effort` beside `allowed-tools`), and this command deliberately carries none:
a pin every install inherits is a behaviour change that ships with its own evidence, and `/model` is the USER's
command. So on an expensive tier when a cheap one is available, step 0 is a STOP, not an ask: the opening line is the
whole turn - 'this walk is scripted: `/model sonnet`, then `/alfred-code:update` again, runs it for about a third;
`/alfred-code:update` again on this model runs it here' - and the turn ends before the snapshot is resolved (audit
2026-10-11, session 37d7a42c: the run went on on Opus after the hint, 245.9k cache-read and 83.1k cache-write over 3
messages, and the user interrupted it and ran it again on Sonnet). **When the gate stops the run, that line is the
turn: no tool call, nothing below is read or summarised, and the turn ends on it.** A second `/alfred-code:update` in
this session goes ahead on whatever tier it finds, with no line. An unattended launch picks its model up front and
has nobody to switch it: on the expensive tier make the first call `printf 'unattended=%s\n'
"${ALFRED_CODE_UNATTENDED:-}"`, and on `unattended=1` log `unattended: tier -> run here` and go on instead of stopping.

**This run needs NO conversation context**, so it is the cheapest thing in the stack to move -
but only out of a session that is actually loaded, and the measuring is the hook's, never yours.
`guard-fresh-session-start.js` reads this session's per-message context against its tier's trigger (and
whether a guided run already ran in this session) and, when a move pays, injects a note into this very
turn that quotes the figure and says 'Do NOT start the run yet'. With that note, step 0 is its ask.
Without it, step 0 does not exist: never measure, never mention it - no 'step 0 skipped', no 'fresh
session', no 'context is low, proceeding' - the first line you write is step 1's (audit 2026-10-11,
session bca100bd: 'Step 0 skipped (fresh session)' on the first message of a fresh session, the line
this clause forbids). Where the stack's hooks stand down (a legacy install before its first stamp,
`hook_profile: minimal`) no note comes, and the walk runs here.

When the note comes, put the choice through AskUserQuestion - run here anyway vs run in a fresh
session (recommended). One ordering rule for every ask in this run: **never lead with an option
the harness has already refused.** Once an installer invocation has come back denied, the
recommended answer becomes 'you run it yourself' with the command to paste, and the settings rule
that would pre-authorize it named beside it. State the figure the note quotes and the walk's own
cost beside it: this body plus its own tool output, measured at ~15-17k tokens of tool results in two audited runs
(audit 2026-10-20 C15, 24841a36 and e43969a7) - every one of its messages re-sends whatever this session already
carries on top. Never quote a figure measured in another session for the carry.

| answer | next action |
|---|---|
| fresh session | give the paste-ready one-liner, end the turn, run nothing |
| run here | go to step 1 now |
| not now | say what is owed and end the turn - do not download |

If the user redirects mid-answer and this ask is displaced, re-offer it ONCE when the redirect
is handled, then proceed on their answer.

**House voice in every line this run emits** - narration, tables and the asks alike: single
dashes, never em-dashes, and single quotes in prose. A fresh or refreshed install may have no
`.claude/rules/alfred-interaction.md` loaded at all, so this command's own text is the only place
the voice can come from.

**THE PLUGIN CACHE IS THE SNAPSHOT - the common run downloads nothing** - the shared contract lives at
`${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md`; read it first, in ONE Bash `cat`, and hold the whole run to
it: resolve the snapshot once into `$TMP/repo` - copied from the newest valid plugin-cache entry, downloaded only when there is none, use every tool from that snapshot, hand it back
with `--source` in the install step, and remove `$TMP` on EVERY exit path (fast, slow, blocker,
or a user 'no'). The protocol's 'Narrate, don't trace' section governs every tool call: quiet
machinery, no pasted output, one narration line between steps.

**Budget the CALLS, not the characters.** The fast path is 5-6 Bash calls and nothing else. Every message re-sends
the whole carried session (one audited run read 11.1k of file content and cost 886.8k), so an extra grep is another
full context re-send - fold reads together, and never read a file or output the steps below do not name. The slow
path and the rare branches live in `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/update-slow-path.md`, read in ONE
Bash `cat` only when a step below sends you there.

## 1. Preconditions

This run refreshes an existing install to the newest release, unchanged in shape: the same items, new content -
the MOVING parts included (every MCP runtime at the release's own pin from `meta/mcp-pins.json`, every installed stack
plugin through `claude plugin update`) - and removes what the STACK removed upstream. **No newer plugin is needed:**
the snapshot is the release this run installs, so an `already newest` plugin line is a normal run, never a reason to
stop. The installer's `--installed-only` reads the install back and closes its dependencies itself;
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
node "$TMP/repo/scripts/update-preflight.js" --snapshot "$TMP/repo" --root . ; node "$TMP/repo/scripts/install/release-notes.js" --root .
```

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
  `env-rename-prefix:` / `env-remove:` / `env-reset:` lines - everything you act on. A detected entry joins the prune
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
- `agents-md: offer .claude/CLAUDE.md -> .claude/AGENTS.md` - the instruction file still carries the old name and no
  AGENTS.md sits beside it or at the root, or `agents-md: none (<why>)`. Only `offer` is asked, below.
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
`enables=` field names, and the reason in a few words: **Take the recommended** (the offers marked
`take`), **Take all**, **Take none** (configure adds any later). Mark **Take the recommended** Recommended
when at least one offer says `take`, otherwise **Take none**; a free-text answer names the ones to
take. Each taken offer becomes one `--add "<category> <name>"` on the installer call of whichever
path runs, and so does every `renamed` row, unasked; every `was-off` row becomes one
`--drop "<category> <name>"`, so the user's switch-off carries onto the new name. `arrives`, `off` and `unknown` are never
asked - they go in the step-7 report. No offer, no ask: this is still the no-questions refresh. Unattended, the ask
takes its Recommended option (adding the recommended items only adds), logged as one `unattended: <question> ->
<choice>` line.

**The data root - ONE ask, and only on `data-move: offer`.** Read `update-slow-path.md`'s 'The data root move'
first (the typed-folder, `ignored=`, `yours=` and `conflicts=` cases live there), then one AskUserQuestion before the
installer runs, naming the `from=` places - in the SAME call as the new-items ask when both fire, one question each:

```ask
Move this project's Alfred Code data into <root>? From <from places>: the docs through git mv where tracked, the navigation index, browser profiles and project memory at each server's next start, after a restart. Recommended: one folder outside .claude/, its machine state kept out of git.
- '<root> - move everything (Recommended)' - the docs move now, the servers' data at their next start once nothing holds it; nothing is overwritten
- 'Keep the current layout' - nothing moves, the servers keep reading where their data is, and no later update asks again (configure can still move it)
```

After a move, until that restart this session's hooks keep writing under the OLD root - they read it from the
environment the session started with - and its loaded rule text still names the old one (audit 2026-10-11, session
bca100bd: the monitor hook re-created `<old root>/flow/` after the move). Say so in the close, with the one action it
leaves: after the restart, a `flow/` file left under the old root is this session's record and safe to delete.

**The instruction file's name - ONE ask, and only on `agents-md: offer`.** Before the installer runs,
in the same AskUserQuestion call as the other asks (one question each):

```ask
Rename .claude/CLAUDE.md to .claude/AGENTS.md? The stack's instruction file is AGENTS.md now; the content stays as it is, only the name changes.
- 'Rename it (Recommended)' - git mv where git tracks it, and a '!.claude/CLAUDE.md' re-include in .gitignore or .git/info/exclude follows the new name
- 'Keep CLAUDE.md' - nothing moves; Claude Code still reads it, and the next update asks again
```

A yes is `--rename-claude-md` on the installer call of whichever path runs; its log line says what moved
(an unedited seed moves without the flag). Unattended, take the Recommended option: a rename keeps every
byte and its git history.

## 3. Fast path - refresh in place (the common case)

Run the installer; it reads the install back itself, closes new dependencies through `stack-select.js`, and logs
any `installed-only: required:` additions. **One fixed capture form, always** - `2>&1 | tee "$TMP/install.log"` on
the call itself (the shared contract is in `source-protocol.md`'s 'Capture the installer's own output'):

- **Any OS:** `node "$TMP/repo/scripts/install/alfred-code.js" update --source "$TMP/repo" --scope <scope> --installed-only [--add "<category> <name>"]... [--drop "<category> <name>"]... [--space <name>] --keep-pins [--docs-versioning git|local] [--data-move move|keep] [--data-path <folder>] [--memory-level global|scoped|project] [--rename-claude-md] 2>&1 | tee "$TMP/install.log"`
- **`ALFRED_CODE_SEED=shell`** - the resolve line reported `seed=shell` (`ALFRED_CODE_SEED` set to `shell`). The frozen OS twin is gone, so it no longer runs: print `the shell installers were removed in 2.0.0 - unset ALFRED_CODE_SEED to use the Node installer` and stop.

`<scope>` comes from `node "$TMP/repo/scripts/install/stamp.js" scope .` (`project`, `user` or `local`) and
`--space` names the profile that owns the install. `--keep-pins` is the default here - a fast refresh must not
flatten deliberate local model/effort pin edits. `--docs-versioning` and `--memory-level` ride the call ONLY when the
user's own invocation names a value - read `update-slow-path.md`'s 'Flags' section first. An install with no
memory registration yet needs no flag: the read-back adopts the `alfred-memory` rule and MCP at `global`; the notes
import waits for `/alfred-code:init` (the log says so, and the close names init).

**Give that call a 10-minute timeout, and read its exit code.** A timed-out call is BACKGROUNDED, not failed, and
the run then pays turns re-finding its own installer. Pass `timeout: 600000`, open the call with
`set -o pipefail;`, append `; echo "install exit: $?"` and read THAT number. A NON-ZERO exit stops the run - report
the log's last lines verbatim as a blocker with the fix they name, and never continue to the prune, the close, or
ad-hoc repair work (measured: 14 messages and 1.69M tokens of improvised forensics after exit 1, then 226 files
changed under the user's `.claude` with no ask).

The refresh re-registers every MCP and READS BACK what landed (`mcp repaired: <name>` for a drifted entry), updates
each stack plugin at EVERY scope it is installed at (`plugin update [<scope>]: <entry>` as `x -> y`, `installed this
run` or `already newest`; `plugin current [<scope>]` for one the resolve already took to the release), and never moves
an item between scopes or removes a pick - only what the release itself retired or renamed goes. Pass these log
lines through verbatim in the close: a retired server's removal with its `add it back:` line, a row kept at another
scope with its uninstall command, `context7-local removed - if you ran /mcp disable context7 for it, run /mcp enable
context7`, and `claude-hud has no status line yet - run /alfred-code:init to set it up` - it prints on EVERY run where
claude-hud is installed - this run or already - and no settings file this project reads has a `statusLine` yet; name
`/alfred-code:init` in the close when it prints.

**ONE post-install read.** Everything the report needs is in the log - take it in a single call, never a tail and
never a second grep (a tail is ~75% static boilerplate, and two greps of one log cost two full context re-sends):

```bash
grep -aE 'installed/refreshed this run|mcp repaired:|mcp pruned:|add it back:|is installed at [a-z]+ scope, not this run|is parked here - kept|plugin [A-Za-z0-9_.-]+:|plugin pruned|installed-only: (required|adopting|keeping|adding|dropping|every hook|the stamp predates)|agent kept:|roster:|names nothing this release ships|was dropped from this install|settings(\.local)?\.json( env)?:|renamed:|docs (migration|domain|root|move)|data root:|memory:|memory import:|autoMemoryEnabled|=set \(|=absent|serena project index|!!|overwriting a hand-edited copy|context7-local removed|has no status line yet|plugin moved \[|taking over a copy' "$TMP/install.log"
```

Add a marker to the pattern when the report needs another fact; do not add a call. The RESTART row and any
fail-soft `!!` are not judged from that dump - they are PRINTED by the script that already prints `changed:`:

```bash
node "$TMP/repo/scripts/update-preflight.js" --log "$TMP/install.log" --hooks <step 2's changed: hooks=N> --running "${CLAUDE_PLUGIN_ROOT}"
```

Paste `restart: yes|no`, every `warn: <line>`, and its `renamed:` / `pruned:` lines verbatim - step 7 reads them, not
the raw grep. `--running` is the release this session loaded, so a session already on the snapshot's release owes no
restart for the hook delta.

Presence, never the value - the grep already carries the installer's own `KEY=` presence output on most runs. Run
this ONLY when it returned no `KEY=` line, and paste its lines as-is:
`node "$TMP/repo/stack/hooks/guard-secret-value.js" --presence "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" CONTEXT7_API_KEY`
(the same line runs on Windows; a `--space <name>` install reads `~/.claude-<name>/settings.json`). Output is
`KEY=set (N chars)`, `KEY=empty (present, no value)` or `KEY=absent` - nothing else is ever printed. A key the user
wants set: `update-slow-path.md`'s 'A credential the user wants set' - the value never travels through the chat.

Then:

- Reconcile the project's AGENTS.md (step 6).
- Report per step 7.
- On the copy route, NAME every `installed-only: adopting hook <name>` line in the report with what it blocks; a
  `guard-*` hook still absent after the run is `update-slow-path.md`'s 'A guard hook still absent' ask.
- Clean up `$TMP` and stop. The slow path's steps 4-5 never run on this path.

## 6. Reconcile the project's AGENTS.md

Run the check first and paste its output - its rows (a named path that no longer exists, a command that does
not resolve, the template's own text still live) are this step's facts, whatever the reading below finds:

```bash
node "$TMP/repo/scripts/agents-md-check.js" --root .
```

Then read `$TMP/repo/stack/skills/habits-adjust-agents-md/SKILL.md` - the whole body, never a heading
diff (measured: a run that skipped it and diffed the `## ` headings left every improve-mode check unrun) - and follow it inline with
`<stack>` = the `$TMP/repo` path, pasted as a literal, exactly as the sibling `configure` command's step 13: its improve mode adds the
sections the template gained and OFFERS a fix for what its check reports (never in the recommended
option - a check row is heuristic, applied only when the user picks it), this run's own part is the rules
table for what it pruned, the project's own prose is never overwritten, and every change is shown
before writing.
The installer touches the old names only where the stack wrote them: an instruction file it seeded and still
holds at its hash it rewrites from this release's template (`AGENTS.md: the unfilled seed refreshed ...`), and
the generated rules it re-spells (one `renamed: <file> - <n> ...` line per file) - report those lines. A file that is the project's own it only NAMES, and step 3's `--log` call carries
that as `warn: !! <file> is yours and names <n> old stack name(s) ...`. Never splice those by hand (audit
2026-10-11, session b3f8193f: a hand `sed -i` after an ask that showed no diff, on a file git did not track).
The re-spell is three numbered actions, in this order, never merged:

1. **Print the plan:** `node "$TMP/repo/scripts/update-preflight.js" --respell --root .` - `respell: none` asks nothing
   and ends here.
2. **Show the diff as reply TEXT** - its `respell:` / `-` / `+` lines verbatim in a fenced block in your own message,
   not left inside the tool result: the user sees a Bash result collapsed, and three re-spells were approved with the
   diff only there (audit 2026-10-20 C15, e31af926 and e43969a7). The ask goes out only after this message.
3. **Ask once:**

```ask
Re-spell the old stack names in <file>? The diff is in the message before this question, each line exactly as it will be written.
- 'Re-spell them (Recommended)' - each line exactly as the plan shows it, and nothing else in the file
- 'Leave them' - the file keeps the old names, which no longer resolve to a skill or seat
```

On a yes, the same call with `--apply` writes those lines alone and prints `respelled: <file> - <n> line(s)`
- report it. Unattended, take the Recommended option and log it.
The installer has also dealt with the seeded file's name: an unedited `.claude/CLAUDE.md` it seeded is
moved to `.claude/AGENTS.md` (`git mv` where git tracks it), and so is the user's own on step 2's
rename answer (`--rename-claude-md`); without that answer an edited one, or any when an AGENTS.md
already holds the project's instructions, is left in place and named in one line - report those lines,
and never rename a file outside that answer.

**Run the compare whatever the delta says** - the template being unchanged UPSTREAM says nothing about whether THIS
project's AGENTS.md still matches it (measured: a user asked it twice, verbatim, five and a half minutes apart, after
the old template-unchanged skip). When it comes back clean, say so in one clause and write nothing.

The step closes on ONE receipt line, which step 7 repeats verbatim: `agents-md: compare <clean|N additions> -
check <N rows>` - the sections the compare offered (`clean` when none) and the rows the check printed (`0
rows` when none). A close with no receipt is a step 6 that did not run (audit 2026-10-11, session 5b9ce9c5).

## 7. Post-check

Every line below is READ from something already in context - step 2's output, the one post-install grep, and the
step-3 `--log` call. Nothing here is stated from memory, and nothing needs another call but the hygiene check.

Report the version delta, then what THIS install refreshed: step 2's `changed-here:` line (the release's own
`changed:` beside it when they differ - 'skills 9 here of the release's 10'), naming the paths from the compare's own
`status<TAB>path` rows - never the installer's `installed/refreshed this run` counts, which are the SELECTION size.
Then the `--log` call's `renamed:` and `pruned:` lines VERBATIM (never a count from memory - measured: a close said
'Renamed: 35' against 34 in the log), each `taking over a copy the stamp did not record` line (an older stack copy
the run refreshed), the REPAIRED line (`mcp repaired:` rows and the plugin version moves), the ENVIRONMENT line, the
NEW-ITEMS line (what arrived, what was taken, what stays off - say where that switch lives - or was left, and any
`unknown`), the release notes step 2 printed, step 6's `agents-md:` receipt, and the restart line.

- **COMPARE** - the signal step 2 named, one line: `no-stamp` or `compare-unreachable` (refreshed without a baseline),
  or on `TRUNCATED`: 'the compare was capped at 300 files - run /alfred-code:configure to reconcile what it may have
  missed', with configure on the suggestion card. No signal: no line.
- **ENVIRONMENT** - the installer prints one line per env change, named by the file the scope writes
  (`settings.json env: <old> renamed to <new>`, `settings.local.json env: ...`, `<key> removed (retired ...)`,
  `<key> seeded (<value>)`, `<key> <old> -> '<new>'`). Report those lines; when there are none, say 'env: nothing
  renamed, removed or seeded this run' - a claim the silent log AND step 2's `env-keys:` before-state support. Never
  assert it from memory. The `settings.local.json: created ...` line also arrives as a `warn:` line - report it once,
  here.
- **DATA ROOT** - every `docs root:` / `docs move:` / `data root:` line the grep caught, verbatim.
- **GIT HYGIENE** - the one extra call this step makes, after the installer and before `$TMP` goes:
  `node "$TMP/repo/scripts/git-hygiene.js" --root .`. A `git-hygiene: offer <root>/<TAB><why>` line
  means git lists the data root as untracked while nothing under it is meant to be committed; ask ONE
  AskUserQuestion (a write, so it is asked - not a follow-up):

  ```ask
  Ignore <root>/ in git? <why>.
  - 'The committed .gitignore (Recommended)' - one anchored line the team shares, so no clone lists it as untracked
  - '.git/info/exclude' - this clone only, no committed file touched
  - 'Leave it' - nothing is written, the next update asks again
  ```

  and apply the answer with `--apply gitignore` or `--apply exclude`, reporting its `applied` /
  `current` line. A `none (...)` line is not reported. Unattended, take the Recommended option and log
  it.
- **MEMORY** - the `memory:` line and the importer's own `memory import:` line, verbatim, when the grep caught them.
  A first-time adoption switches Claude's own memory off only once the import succeeds; never assert the switch-off
  from the flag or the adoption alone. No memory line: say nothing.
- **RESTART / WARN** - the `--log` call's `restart: yes|no` (a report LINE, not a question) and every `warn: <line>` (a
  fail-soft that fell back and continued - not a re-run trigger), verbatim.
- **FOLLOW-UPS** - the `context7-local removed` and `claude-hud has no status line yet` lines, verbatim when caught,
  once each here (both also arrive as `warn:` lines).
- **VALIDATE** - step 2's `validate: yes` (the version delta spans more than one release) or
  `policy-rev: stale ...` (the installed usage-policy rule's stamped revision is behind the shipped
  skill's, or carries none) each add a `/alfred-code:validate` suggestion-card row with that reason. Both absent adds
  nothing. Update prunes only what upstream deleted; what this project stopped needing is validate's pass.

The run rewrote `alfred-code.stamp` - the next update or configure diffs from here. Name `/capture-awareness` (when
installed) as the USER's next step when step 2's `changed-here:` line shows `skills=` or `agents=` above 0 - gated on
THAT number alone (the installer re-copies every file every run, so any other gate is always true; the generated
inventory stamps each skill's first sentence, which drifts with content-only updates). When the navigation server is
installed, name the one-off re-index as a next step whenever this run re-seeded serena's `project.yml` (the grep's
`serena project index` line): `SERENA_HOME=.alfred/serena/home uvx --python 3.13 --exclude-newer 2026-10-14T23:59:59Z
--from serena-agent@2.0.0 serena project index` (the release pin and cut-off from `meta/mcp-pins.json`; the data
root's own folder in place of `.alfred`, `.serena/home` while a 2.0.0 folder has not moved; Windows PowerShell:
`$env:SERENA_HOME='.alfred\serena\home'`, and on Windows on ARM `--python cpython-3.13-windows-x86_64-none`). Never invoke it from this run - the skill is manual-only (`disable-model-invocation`), so a
Skill call is DENIED by `guard-fresh-session-start.js`; the report line is the mechanism.

**The run closes on a suggestion card, never on a question.** After the report, list the follow-ups that are the
USER's to run - restart for an MCP change, `/capture-awareness` (when the gate above fires), a manual-only capture whose
output is stale, the navigation-server re-index, a credential to rotate or set by hand - as `Suggested next steps`,
the recommended one first and each with the one reason it matters. **When step 3's `--log` call printed `restart: yes`, the RESTART is row one** - with
`claude mcp list` named beside it as the one command that confirms the servers actually connected (a registration is
not a connection) - every other follow-up runs against the session still holding the OLD ones. A follow-up that is
itself a deliberate run - any capture, a loop - carries a fresh-session note beside it: 'run it in a fresh session;
started here it re-sends this walk's history on every one of its turns'. Under a restart row the note reads 'run it
in the session the restart opens' instead - one action, not two the user can order wrongly. No AskUserQuestion over
them - and read that narrowly: **it forbids an ask about the FOLLOW-UPS, nothing else**; the asks the steps mandate
(new items, the prune confirm, a guard hook's adoption, git hygiene) are unaffected. Close with this line, verbatim,
as the LAST line of the message - nothing after it:
'Nothing is pending on this run - these are yours to run when you choose.' The stop-contract
guard reads that sentence as a finished close; without it a 'done + next step' card is blocked as a stall.
The line is CONDITIONAL: print it only when the card carries nothing OWED. A still-required user action - revoke the old token, fill in a credential, run a rotation - IS pending, so name it and put the close through the ask instead.

## 8. Clean up the temp dir - ALWAYS

Remove `$TMP` per `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md`, on EVERY exit path:
after the fast path, after refresh + prune, after refresh-only, after a blocker, and after a
user 'no'. Then confirm the project tree holds only installed artifacts by LOOKING, never with
`git status`: the stack's own gitignore advice ignores `.claude/` wholesale, so a porcelain status
over it is empty whatever is sitting there. `ls -a .claude` plus a check that no archive, extracted repo,
`raw.json`, `selection.txt` or `install.log` was left in the project - anything stray is named in
the close-out, not silently ignored.

## Do not

- Never delete anything the upstream diff or the migrations catalog did not name - user-authored
  skills/agents/rules/hooks and the generated rules (`alfred-architecture.md`, `alfred-awareness.md`, the awareness docs,
  `project-code-style.md`) appear in neither; if a candidate is in neither list, it stays.
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
- Never start this walk on the expensive tier when a cheap one is available - step 0's tier stop ends
  the first invocation's turn before the snapshot; a second invocation in the session, or an
  unattended launch, goes ahead.
