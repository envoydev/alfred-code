---
description: "FAST refresh of an existing Alfred Code install - no selection questions (one ask only when the release adds an item this install would not otherwise carry): bring everything currently installed to the newest release, MCP runtimes and plugins included (MCPs re-registered at the release's own pins, then VERIFIED against the manifest shape and repaired where a registration drifted - `claude mcp add` over an existing name exits 0 without writing, so a stale entry used to survive every update; `claude plugin update` per installed stack plugin, at the scope the plugin is actually installed at) AND prune what the stack itself deleted or renamed upstream since the stamped install. The common case (upstream removed nothing) is one script-driven pass: the installer's --installed-only reads the install back and refreshes it, nothing else loads. The prune list is computed from the GitHub compare between the stamp and the new snapshot, never guessed - plus the snapshot's meta/migrations.json entries for retired GENERATED artifacts (existence-detected, e.g. the legacy inject-code-style hook) that a file compare can never name. User-authored artifacts and the generated baseline-project-*.md / project-code-style.md rules can never be touched. One confirmation before anything is deleted. Works with no newer plugin: the snapshot's own pins move the library copies, hooks and MCPs. NOT for choosing items to add or drop beyond what the release itself added - that is the sibling configure command; not a first install - that is setup."
disable-model-invocation: true
---

# Update Alfred Code - refresh everything, prune what upstream removed

You are refreshing an existing install to the newest release, unchanged in shape: the same
items, new content - including the MOVING parts: the installer takes every MCP runtime at the
release's own pin (`meta/mcp-pins.json`, never a registry lookup) and re-registers it, and runs `claude plugin update` on
each installed stack plugin after refreshing the marketplaces, so an update leaves no MCP or
plugin behind on an old version - plus removing the artifacts the STACK removed upstream, which a plain
refresh leaves orphaned forever. **No newer plugin is needed:** the snapshot is the release this
run installs, so the library copies (skills, agents, rules), the hook engines and every MCP move to
THAT release's content and pins whether or not `claude plugin update` finds anything newer - an
`already newest` plugin line is a normal run, never a reason to stop. The deterministic work lives in scripts, not in this chat:
the installer's `--installed-only` reads the install back (disk, plugin entries, the off-state it
wrote) and closes its dependencies itself, and `stamp-compare.js` computes the upstream delta - you orchestrate and report.
Measured before this split, a model-driven walk grew the session ~40k tokens; keep the fast
path near 10k by never reading files or output the steps below do not name. **Budget the CALLS,
not the characters.** The fast path is 5-6 Bash calls and nothing else. Content tokens are the
small half of the bill: one audited run read 11.1k of file content and cost 886.8k, because every
message re-sends the whole carried session. An extra grep is not 200 tokens, it is another full
context re-send - so fold reads together rather than trimming what each one returns.

## Upgrading a 1.x install to 2.0.0

A 1.x install upgrades through its OWN update command - `/claude-stack:update`, or <!-- legacy-name -->
`/alfred-code:update` where the session lists that one. Nothing is run by hand:

1. The refresh lands 2.0.0 under the old names: 2.0.0 lists `claude-stack` and `claude-stack-hooks` <!-- legacy-name -->
   as retired aliases, so `plugin update` of each old id takes the new release into the cache.
2. The 2.0.0 installer installs `alfred-code` at the old core's scope and marketplace key, and only
   once that took, removes the old entries - the retired per-stack ones first, then both aliases. It
   also renames every `CLAUDE_STACK_*` setting to `ALFRED_CODE_*` (one log line per key) and replaces <!-- legacy-name -->
   `claude-stack.stamp` with `alfred-code.stamp`. <!-- legacy-name -->
3. Restart Claude Code once: the commands are `/alfred-code:*` from then on.

A failed install of the new core removes nothing - the old core keeps running - and the run prints
the exact `claude plugin install` command to run before updating again. A 1.x core at another scope
is kept for the projects that use it, with its uninstall command printed. The install keeps its
marketplace key (`claude-stack` on a 1.x account - a registered key never changes), so its ids read <!-- legacy-name -->
`alfred-code@claude-stack`: expected, not broken. <!-- legacy-name -->

## 0. Where to run it

**This walk is script orchestration, not reasoning** - a stamp compare, an installer invocation, a
grep over its log. It runs identically on the cheap tier and costs about a THIRD as much there
(measured: the same scripted walk in the same project cost 3x on `opus[1m]` as on sonnet). A frontmatter
`model:` key CAN pin a skill's run to a tier (the Claude Code skills frontmatter reference lists
`model` and `effort` beside `allowed-tools`), and this command deliberately carries none: a pin
every install inherits is a behaviour change that ships with its own evidence, and `/model` is the
USER's command. So when this session is on an expensive tier, say it ONCE in the opening line - 'this walk is scripted;
`/model sonnet` runs it for about a third' - and continue either way. Never ask about it, never
repeat it.

**House voice in every line this run emits** - narration, tables and the asks alike: single
dashes, never em-dashes, and single quotes in prose. A fresh or refreshed install may have no
`.claude/rules/baseline-interaction.md` loaded at all, so this command's own text is the only place
the voice can come from (measured: a first-run narration line opened with an em-dash, on the one
surface where the rule forbidding it cannot yet exist).

**This run needs NO conversation context**, so it is the cheapest thing in the stack to move -
but only out of a session that is actually loaded. Measure before you ask: this session's own
per-message context is `input + cache_read + cache_creation` off the last assistant message in the
transcript. Ask ONLY when that figure is past the same trigger `guard-fresh-session-start.js` uses
- the tier's own absolute trigger, `ALFRED_CODE_FRESH_SESSION_200K` (default 150,000) or
`ALFRED_CODE_FRESH_SESSION_1M` (default 400,000), or `ALFRED_CODE_FRESH_SESSION_DEFAULT`
(default 180,000) when the window is neither of those two sizes or cannot be read at all - which
one applies comes from the session model's row in `.claude/hooks/model-windows.json`, else
`ALFRED_CODE_DEFAULT_CONTEXT_WINDOW` - or when that hook has already injected
the ask into this turn. Below the trigger, or when the figure cannot be read at all, SKIP the ask
silently and go to step 1: an ask with no measurement behind it is the failure this replaced
(measured: it fired on the FIRST message of a brand-new session, twice in one run, and could quote
no number when the user challenged it). Never author the decision in prose either way - and below the trigger that means NO line at
all: not 'context is low, proceeding', not a one-clause aside. The only visible output of a
skipped step 0 is that step 1 starts.

When it does fire, put the choice through AskUserQuestion - run here anyway vs run in a fresh
session (recommended). One ordering rule for every ask in this run: **never lead with an option
the harness has already refused.** Once an installer invocation has come back denied, the
recommended answer becomes 'you run it yourself' with the command to paste, and the settings rule
that would pre-authorize it named beside it - re-offering the denied path as the recommendation
buys a second identical denial (measured, and it drew the only free-text complaint in that
session). The fast path is ~10k tokens on its own, but every one of its messages
re-sends whatever this session already carries, so state the figure you measured and the ~10k
budget beside it. Never quote a figure measured in another session: the number that used to sit
here was ~2x over on lifetime cache-read and ~4.8x over on the tail when it was next checked.

Every answer names the next action, and this step is not done until one is taken:

| answer | next action |
|---|---|
| fresh session | give the paste-ready one-liner, end the turn, run nothing |
| run here | go to step 1 now |
| not now | say what is owed and end the turn - do not download |

If the user redirects mid-answer and this ask is displaced, re-offer it ONCE when the redirect
is handled, then proceed on their answer.

**THE PLUGIN CACHE IS THE SNAPSHOT - the common run downloads nothing** - the shared contract lives at
`${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md`; read it first and hold the whole run to
it: resolve the snapshot once into `$TMP/repo` - copied from the newest valid plugin-cache entry, downloaded only when there is none, use every tool from that snapshot, hand it back
with `--source` in the install step, and remove `$TMP` on EVERY exit path (fast, slow, blocker,
or a user 'no'). The protocol's 'Narrate, don't trace' section governs every tool call: quiet
machinery, no pasted output, one narration line between steps.

## 1. Preconditions
`node "$TMP/repo/scripts/install/stamp.js" state .` prints one word (two for a worktree), read from the install records
the hooks read (`alfred-code.stamp`, the 1.x `claude-stack.stamp`, a copied `hooks/docs.js`) in this <!-- legacy-name -->
repo, its git top level or a worktree's main checkout - never from `.claude/skills` or
`.claude/agents`, which a plugin-route install may not have. `not-installed` -> stop and route to
the sibling `/alfred-code:setup` command. `worktree-of-installed <main>` -> print exactly 'This is a git worktree of <main>, which holds the install - run /alfred-code:update from there' and stop - a worktree shares that checkout's install, and nothing is written into this tree, or into that one from here; the installer refuses that tree too. `legacy-global` is a 1.x GLOBAL install whose stamp still
sits in the account dir: this command is its route - step 2's preflight reads that stamp and the
installer moves it into the project. `installed` / `initialised` -> go on. Every scope - project,
user or local - keeps the stamp, the library copies and the settings in the project's `.claude/`,
so there is one mode. The user names items to add or drop -> that is the sibling
`/alfred-code:configure` command, not this one. One installer on every OS (step 3).

## 2. Compute the delta since the stamp - ONE call
Everything this step needs comes back from one script in the snapshot:

```bash
node "$TMP/repo/scripts/update-preflight.js" --snapshot "$TMP/repo" --root .
```

(It reads the scope's settings as the installer does - `settings.local.json` laid over
`settings.json` at local scope, and at every other scope the stack keys `settings.local.json` holds. A `--space` install passes `--config-dir ~/.claude-<space>`, so a
1.x global stamp is looked for in that account. A fork install passes `--repo <owner/name>`; a
non-default stamp or settings path passes `--stamp` / `--settings`.) This is the WHOLE
pre-install read - never hand-write a second probe for anything it already prints, and never
open `meta/migrations.json` yourself: the catalog is a maintainer file with a 2,000-character
`_comment`, its `detect` rules are declarative, and the script evaluates them. Measured: the
hand-run form cost four API round trips and pulled the catalog into context for what is a
three-line existence check.

It prints, in order:

- `version: <old> -> <new>` then `base: <sha> head: <sha>` - lead your narration with the
  version delta. A `legacy-stamp: <file> - a 1.x global install; ...` line means the baseline is
  the account's 1.x stamp: say once that this update moves it into the project.
- `status<TAB>path` lines (`modified`/`added`/`removed`, `renamed` with `<- old-path`) filtered
  to stack-owned paths; the diff is what has been RELEASED since the stamp - work still on
  `develop` is invisible by design, never diff against it.
- `changed: skills=<n> agents=<n> rules=<n> hooks=<n> template=<yes|no>` - the delta bucketed by
  install class. This is what step 7 names as refreshed, and what gates the
  `/project-agent-capabilities` suggestion; the installer's log tail counts every file it
  COPIED, which is all of them on every run, so it can never answer 'what changed'.
- `migration: <id><TAB><detect kind>` per DETECTED entry, or `migrations: none detected`, each
  followed by its own indented `why:` / `then:` / `remove:` / `unwire:` / `env-rename:` /
  `env-rename-prefix:` / `env-remove:` / `env-reset:` lines - everything you act on. A detected entry joins the prune list labeled
  `(migration: <why>)`. Do not open the catalog for any of it: an entry that did not fire prints
  nothing, and reading 'just that one entry by id' still pulls the whole file in (measured: 2,182
  of a 5,180-char read is the maintainer `_comment`, 42%, paid on every update of every project).
- `new: <category> <name><TAB><verdict><TAB><entry|->` per item the release ADDED or RENAMED, or
  `new: none` - classified against THIS install by the derivation, never by you, with optional
  trailing fields `take|leave` (an offer's recommendation), `enables=<entries>` (what a yes would
  switch on), `from=<old name>` (a rename), `old-on-disk` (the rename's old copy is still
  installed) and `was-off` (the OLD name was switched off - the off-state is matched by name, so
  the new one would come on). Verdicts: `arrives` (this refresh brings
  it, on), `renamed` (a copied item whose old copy is on disk - the update carries it), `offer`
  (only a yes brings it), `off` (the user's own off-state names it - a denied seat, a hook in
  `ALFRED_CODE_HOOKS_OFF`, the walk's None, a parked entry), `unknown` (the plugin listing could
  not be read).
- `env-keys: <names>` - the scope's settings `env` KEY NAMES before the run, and the
  before-state step 7 diffs its read-back against. Names only: the script never prints a value,
  and neither do you. **Never dump that file** - a plain `cat` of it put a live 71-character
  `SENTRY_ACCESS_TOKEN` into a transcript twice in this collection. When you need to look again,
  the safe reads are `node "$TMP/repo/stack/hooks/guard-secret-value.js" --redacted <settings.json>`
  (every credential value shown as `<set (N chars)>`, the rest as written - the one form that
  works when the key names are not known in advance) and `--presence <settings.json> KEY ...`
  for named keys.

**Environment migrations are the exception: they never join the prune list.** They act on the
scope's settings.json `env`, and none of them can lose anything the user chose: `rename_settings_env`
changes a KEY and carries the value across, `rename_settings_env_prefix` does the same for every key
sharing an old PREFIX in one entry (the 2.0.0 rebrand's `CLAUDE_STACK_* -> ALFRED_CODE_*` is the only <!-- legacy-name -->
one shipped so far), and `remove_settings_env` drops a key this stack
RETIRED - one nothing reads any more, and where the key still means something outside this stack it
carries the exact seeded value it is dropped at, so a hand-set value stays. The installer's env pass
applies them during the refresh in both step 3 and step 4
(renames, then removals, then the absent-only seeds, so a value set under the old name is never
overwritten by the new key's default).
Your job is to detect them before the run and NAME them in the report: `env: <old> renamed to <new>
(value kept)` for a single key, `env: <old-prefix>* renamed to <new-prefix>* (values kept)` for a
prefix entry, `env: <key> removed (retired)`. New variables the release introduces need no
catalog entry at all - the same pass seeds them absent-only - but report those too, as
`env: <key> seeded (<value>)`, reading the file after the run rather than assuming.

**Build the prune list** from the compare's `removed` lines (a `stack/...` path gone entirely
maps to its installed artifact; a path still present in the snapshot is a move WITHIN the item,
not a removal), every `new:` row carrying `old-on-disk` (its old copy is pruned whatever the
verdict - an arriving rename leaves the old copy behind too; a `renamed` row's new name is carried
by `--add`, a rename being the same item continuing, never an adoption choice), and the detected
migrations. Three outputs decide the path:

- **Prune list EMPTY** -> step 3, the fast path. This includes `no-stamp` (exit 2 - no baseline,
  pruning impossible, refreshing unaffected), `compare-unreachable` (exit 3 - same), and a
  `TRUNCATED` line, third after the version + base lines (the removal list cannot be trusted complete - never prune from a
  possibly-partial diff; route the reconcile to `configure` in the report). Say which applied.
- **Prune list NON-EMPTY** -> step 4, the pruning path.

**New items - ONE ask, and only when a `new:` line says `offer`.** Put every offer through one
AskUserQuestion before the installer runs, each named with its entry or 'copied', the entries its
`enables=` field names, and the reason in a few words: **Take the recommended** (the offers marked
`take` - a rule whose closure every enabled entry already carries, so a yes switches no entry on),
**Take all**, **Take none** (configure adds any later). Mark **Take the recommended** Recommended
when at least one offer says `take`, otherwise **Take none**; a free-text answer names the ones to
take. Each taken offer becomes one `--add "<category> <name>"` on the installer call of whichever
path runs, and so does every `renamed` row, unasked; every `was-off` row becomes one
`--drop "<category> <name>"`, so the user's switch-off carries onto the new name. `arrives`, `off` and `unknown` are never
asked - they go in the step-7 report. No offer, no ask: this is still the no-questions refresh.

## 3. Fast path - refresh in place (the common case)
Run the installer; it reads the install back itself, closes new dependencies through
`stack-select.js`, and logs any `installed-only: required:` additions:

**One fixed capture form, always** - `2>&1 | tee "$TMP/install.log"` on the call itself, so the
post-install read below has a file that was actually written (the shared contract is in
`source-protocol.md`'s 'Capture the installer's own output'):

- **Any OS:** `node "$TMP/repo/scripts/install/alfred-code.js" update --source "$TMP/repo" --scope <scope> --installed-only [--add "<category> <name>"]... [--drop "<category> <name>"]... [--space <name>] --keep-pins [--docs-versioning git|local] [--memory-level global|scoped|project] 2>&1 | tee "$TMP/install.log"`
- **`ALFRED_CODE_SEED=shell`** - the resolve line reported `seed=shell` (`ALFRED_CODE_SEED`, or the 1.x `CLAUDE_STACK_SEED`, set to `shell`). The frozen OS twin names what a 2.0.0 registration cannot resolve, so it no longer runs: print `the shell installers were removed in 2.0.0 - unset ALFRED_CODE_SEED / CLAUDE_STACK_SEED to use the Node installer` and stop. <!-- legacy-name -->

`--docs-versioning` is passed ONLY when the user's own invocation names a value (`/alfred-code:update
--docs-versioning local`, or 'switch docs versioning to git') - never asked for, never inferred. The
installer writes it over the current value and prints one `settings.json env: ALFRED_CODE_DOCS_VERSIONING
<old> -> '<new>'` line; any other value is refused before anything is written. Without it, the key is
only seeded when missing.

`--memory-level` is passed ONLY when the user's own invocation names a value (`/alfred-code:update
--memory-level project`, or 'move memory to the project level') - never asked for, never inferred: this
is the no-questions fast path, and an existing registration is otherwise left exactly where it is. The
installer re-points the registration to that level's database (nothing is copied or deleted) and
prints `memory: level <old> -> <new>: <newPath> (old memories stay in <oldPath>)`; any other value is
refused before anything is written (`--memory-level project` is refused at `--scope user` on the full
copy route, where one registration would bake one path into every project of the account).

An install carrying no memory registration yet needs no flag at all - the `--installed-only`
derivation now ADOPTS `baseline-memory` and the `memory` MCP the same way it adopts a new hook,
whenever they are absent: the registration lands at `global` unless `--memory-level` named another
level. The notes import waits for `/alfred-code:init` - no run imports until the stamp's
`initialised:` line holds a date (the log says `the notes import waits for /alfred-code:init`, and the
close names init). Once it does, the installer imports this project's existing notes through the
service once, and - only once that import succeeds - switches Claude's own memory off in THIS repo's
own settings file (`.claude/settings.local.json` at local scope, else `.claude/settings.json`), at
every scope (never the account file, which would silence every other project's memory too).
A failed import leaves Claude's own memory ON and is logged as such, never retried into a false
success; the old `MEMORY.md` / `memory/*.md` files are never deleted either way. Read the installer's
log for what actually happened - the grep below carries both the `memory:` registration line and the
importer's own `memory import:` line - and report that, never assert the switch-off from the flag
or the adoption alone.

**Give that call a 10-minute timeout, and read its exit code.** A full refresh runs past the Bash
tool's own default on a cold machine, and a timed-out call is BACKGROUNDED, not failed: the run then
pays turns re-finding its own installer (measured: 3 recovery turns, one of them loading a tool
schema it never called). Pass `timeout: 600000` on the call. The `tee` means `$?` is the pipe's own
exit code, not the installer's - append `; echo "install exit: ${PIPESTATUS[0]}"` and read THAT
number. A NON-ZERO exit stops the run - report the log's last lines verbatim as a blocker with the
fix they name, and never continue to the prune, the close, or ad-hoc repair work: the measured
breach spent 14 messages and 1.69M tokens on improvised forensics after exit 1 and then changed 226
files under the user's `.claude` with no ask.

`<scope>` is the stamp's own `scope:` line (`project`, `user` or `local`) and `--space` the profile
that owns the install; `--keep-pins` is the default here - a fast
refresh must not flatten deliberate local model/effort pin edits. The refresh re-registers every MCP
and then READS BACK what landed: at project scope the installer compares every stack-owned entry in
`.mcp.json` against the manifest shape and rewrites the ones that drifted (`mcp repaired: <name>` in
the log), because `claude mcp add` over a name the preceding `remove` did not clear prints 'already
exists' and exits 0 - which is how consuming projects kept a stale stdio registration through update after
update. Servers the project added by hand are never touched. Plugins are updated
at the scope the listing says they are installed at and their versions are read back, so the log names
each one as `x -> y`, `installed this run` (claude-hud on an install that lacked it) or `already newest` instead of asserting a refresh. A server the 2.0.0 cut removed (`angular-cli`, `chrome-devtools`, `appium-mcp`, `sentry`, `context7-local`)
is uninstalled by its stack spec only - a same-named plugin from another marketplace and a row at another
scope are kept and logged with the uninstall command that removes them - and each removal prints its `add it back:`
line; pass the removals, their add-back lines and every kept row's line through verbatim in the close-out. Playwright keeps its browsers the same
way: every browser the stamp's `playwright-browsers:` names is updated in place, never installed over (a legacy single `playwright` server
migrates to `playwright-<its --browser>`, none = `chrome`), a `firefox` / `webkit` build is downloaded again
at the release's pin, and no browser is switched on or off - the user's `/plugin` toggle stands. One the user uninstalled by hand
comes back as the stamp's `playwright-enabled:` last left it; a disabled browser the stamp does not name stays parked.

**ONE post-install read.** When the installer returns, everything the report needs is in its log,
so take it in a single call - never a tail, never a second grep. A tail is ~75% static boilerplate,
and two consecutive greps of the same log (measured) cost two full context re-sends for one extra
line:

```bash
grep -aE 'installed/refreshed this run|mcp repaired:|mcp pruned:|add it back:|is installed at [a-z]+ scope, not this run|is parked here - kept|plugin [A-Za-z0-9_.-]+:|plugin pruned|installed-only: (required|adopting|keeping|adding|dropping|every hook)|names nothing this release ships|was dropped from this install|settings(\.local)?\.json( env)?:|docs (migration|domain)|memory:|memory import:|autoMemoryEnabled|=set \(|=absent|serena project index|!!|overwriting a hand-edited copy' "$TMP/install.log"
```

That one pattern carries every fact step 7 reports: the refresh counts, the repaired
registrations, each retired server's removal and its `add it back:` line, each retired row kept at another scope
or parked, with its uninstall command, each plugin's `x -> y`, `installed this run` or `already newest`, the dependencies the new release
pulled in, every env key the run renamed / removed / seeded / set (the installer prints one line each -
so the ENVIRONMENT line is READ, never asserted), each capture doc moved onto its domain folder and each
moved folder switched on as a domain (`docs migration` / `docs domain:` - report them as they read), the
memory registration line and the importer's own `memory import:` line or error text (present whenever
`--memory-level` was passed, the level changed, or an install gained the memory MCP for the first
time this run - now the fast path's own default outcome whenever it was absent, not a special case),
the credential presence lines, and the serena re-index hint. Add a marker to the pattern when the report needs another
fact; do not add a call. Never tail the log instead - a tail is ~75% static boilerplate and misses
the lines above it.

The RESTART row and any fail-soft `!!` are not judged from that dump - they are PRINTED, in the same
breath, by the script that already prints `changed:`:

```bash
node "$TMP/repo/scripts/update-preflight.js" --log "$TMP/install.log" --hooks <step 2's changed: hooks=N>
```

Paste `restart: yes|no` and every `warn: <line>` it prints verbatim - step 7 below reads them, not
the raw grep.

Presence, never the value - the line above already carries the installer's own `KEY=` presence
output on most runs. Run this ONLY when that grep returned no `KEY=` line, and paste its lines
as-is:
`node "$TMP/repo/stack/hooks/guard-secret-value.js" --presence "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" CONTEXT7_API_KEY`
(the same line runs on Windows - Claude Code's Bash tool is Git Bash, where `$env:USERPROFILE` is not a variable; a `--space <name>` install reads `~/.claude-<name>/settings.json`). Output is `KEY=set (N chars)` or `KEY=absent` - nothing else is ever printed; a shell dump of that file is rewritten by the same hook into its redacted view (every credential value shown as `<set (N chars)>`), and the Read tool on it is blocked.

CONTEXT7_API_KEY never travels through the chat - when it is missing and the user wants one, offer
this copy-ready command, so the value goes from the user's clipboard into the file without
passing through a transcript (it is not echoed, and it is not a shell argument either). **PASTE it
into your reply. Never run it through Bash and never ask whether to run it** - it prompts for input
this session cannot supply, it trips the credential guard, and the ask it generates has one
sensible answer, which makes it a decision not worth a user's turn. Swap `KEY_NAME` for the key:

```bash
python3 -c "import getpass,json,pathlib;f=pathlib.Path('~/.claude/settings.json').expanduser();d=json.loads(f.read_text() or '{}') if f.exists() else {};d.setdefault('env',{})['KEY_NAME']=getpass.getpass('value (not echoed): ');f.parent.mkdir(parents=True,exist_ok=True);f.write_text(json.dumps(d,indent=2))"
```

On Windows: `$t = Read-Host 'value' -AsSecureString`, then write the same key with
`ConvertFrom-SecureString -AsPlainText`. If the user pastes the value into the chat anyway, use
it for what they asked and END THE TURN on the rotation ask - it is in the transcript on disk now,
and that is their decision to make, not one to leave unsaid. Then:

- Reconcile the project's CLAUDE.md (step 6 - the step states when and why it runs).
- Report per step 7 - version delta, refreshed counts from the installer's log tail, the
  `required:` additions it named, and the step-2 `new:` lines: one line naming what `arrives`,
  one naming what stays `off` (the user's own switch - say where it lives), the offers taken and
  left, and any `unknown` (the listing could not be read - `configure` can take them).
- Hooks on the COPY route - and the installer does most of it for you. Hooks are an
  all-or-nothing layer on the `--installed-only` path: an install that HAS hooks receives every
  hook the release ships, and the run logs `installed-only: adopting hook <name>` for each one.
  A hook the user DROPPED is not resurrected - the stamp records the catalog each run shipped, so
  'shipped then, absent now' reads as a deliberate drop and is left out, logged as such. NAME every
  adopted hook in the step-7 report, one line with what it blocks.
  Put adoption through AskUserQuestion only when the installer did NOT adopt it - a `guard-*`
  ENFORCEMENT hook still absent after the run (the derivation fell back, or it was dropped before) -
  and on 'adopt now' copy it from `$TMP/repo/stack/hooks/` into `.claude/hooks/` and wire its
  matcher entries into settings.json exactly as the installer's hook step does. To author that ask,
  read the hook's own header comment and nothing else (`head -8 "$TMP/repo/stack/hooks/<file>"`) -
  every guard states what it blocks in its first lines; reading the hook to understand it cost 3.6k
  tokens and the session's largest context spike in one audited run, for a one-sentence question.
  (Measured, and the reason the layer became all-or-nothing: the v0.2.20 commit gate reached zero of
  three consuming projects - every update surfaced it as an FYI the user exited past, while the same
  updates refreshed the rule text the hook exists to enforce, leaving the discipline prose-only for
  a week.)
- Clean up `$TMP` and stop. Steps 4-5 never run on this path.

## 4. Pruning path - confirm once, then refresh + prune
The installer reads the install back itself (`--installed-only`), so the ask below needs only the
compare.

Show the version delta, the refresh counts by category, and the NAMED prune list (migrations
included, with their why). Ask ONE question through AskUserQuestion: proceed with refresh +
prune (recommended), or refresh only. Nothing is ever deleted silently; 'refresh only' means
step 3's installer run instead, then the report. For example:

```
alfred-code 0.1.0 -> 0.2.0 - refresh: 12 skills, 9 agents, 6 rules, 3 hooks
prune: .claude/rules/web-conventions.md (renamed upstream; typescript-conventions.md carried over)
```

On 'proceed': run the installer exactly as in step 3 - its `--add` already carries every `renamed`
row's new name (the old copy is on disk, the new one is not yet, so the read-back alone would lose
it) and every offer the step-2 ask took. A removed name needs no flag - this release
does not ship it, so the read-back cannot carry it - and step 5 deletes its files. Never rebuild the
selection from a disk inventory on the Node seed: on the plugin routes `.claude/` holds only the
library copies, and a selection built from it switches off every seat an enabled entry carries (the Phase 8
read-back exists for exactly that). A `required:` line (a dependency the new release introduced) is auto-kept and
reported. An `unknown:` line is NEVER prune evidence: a skill, agent, rule or hook the user wrote,
and an MCP server added by hand, print exactly that way, and the installer leaves every one of
them in place (it only replaces the names it ships; a hand-added `.mcp.json` server is never
touched). It is excluded from the emitted selection and nothing more - list it in the report as
`kept - not a stack item`. Only the compare list and the migrations prune. Blockers stop the run with their fixes -
never update past one; warnings are listed and passed.

## 5. Prune
Delete each item on the confirmed list, showing every command before running it. A deleted hook
also loses its `.claude/settings.json` wiring in the same pass - show that edit too (a
migration entry's `unwire_settings_hook` names exactly which entry goes - `<file>::<Matcher>`
scopes it to ONE matcher when the file stays wired for its other events, and a
`settings_hook_wired` detect matches on that wiring being present rather than on a file;
parse-edit-rewrite,
never regex, never touching other wiring). A migration's `then` line goes in the step-7 report
as a next step - run nothing on the user's behalf.

## 6. Reconcile the project's CLAUDE.md
Against the snapshot's `stack/CLAUDE.template.md`, ADDITIVELY, exactly as the sibling
`configure` command's step 13: add sections the template gained, update the rules table for
what this run pruned, never overwrite the project's own prose, show changes before writing.

**Run the compare whatever the delta says** - the template being unchanged
UPSTREAM says nothing about whether THIS project's CLAUDE.md still matches it, and the
template-unchanged skip left that question with no command that answers it: not update, which
skipped, and not validate, which touches only the rules table. Measured: a user asked it twice,
verbatim, five and a half minutes apart. The compare is a 75-line file against a 116-line one, so
cost is not the argument; when it comes back clean, say so in one clause and write nothing.

## 7. Post-check
Every line below is READ from something already in context - step 2's preflight output, the one
post-install grep, and the step-3 `update-preflight.js --log` call. Nothing here is stated from
memory, and nothing needs another call.

Report the version delta, then what actually CHANGED: step 2's `changed: skills=<n> agents=<n>
rules=<n> hooks=<n> template=<yes|no>` line, naming the paths from the compare's own
`status<TAB>path` rows. Do NOT report the installer's copy counts as the delta - it re-copies every
installed file on every run, so its `installed/refreshed this run - skills=N` is the SELECTION size,
not the change; an audited close named the two refreshed rules and omitted the two hooks that were
the entire upstream delta, because it read the log tail instead of the compare. Then the pruned
items by name, the REPAIRED line when the installer logged any (`mcp repaired: <name>` rows and the
plugin version moves - these are the drift the run corrected, and a user who has been carrying a
stale registration needs to see it named), the ENVIRONMENT line, the NEW-ITEMS line (what arrived,
what was taken, what stays off or was left, each by name), and the restart line.

- **ENVIRONMENT** - the installer prints one line per env change, named by the file the scope
  writes (`settings.json env: <old> renamed to <new>`, or `settings.local.json env: ...` for a key
  that file holds - every key at local scope, and at project or user scope each stack key it already
  held, since it applies over settings.json there; `<key> removed (retired ...)`, `<key> seeded (<value>)`, `<key> <old> -> '<new>'` for a passed
  `--docs-versioning`), and the grep already caught
  them. Report those lines; when there are none, say 'env: nothing renamed, removed or seeded this
  run' - a claim you can make because the log is silent AND step 2's `env-keys:` set is the
  before-state you are comparing against. Never assert it from memory: three audited runs did, and
  one named keys it had never probed.
- **MEMORY** - when the grep caught a memory line, report it verbatim: the `memory:` level/database
  line (present whenever `--memory-level` was passed, the level changed, or this run adopted the
  registration for the first time - the fast path's own default now, whenever it was absent, not
  conditional on a flag) plus the importer's own `memory import:` line - the counts on success, or its
  error text on failure. A first-time adoption switches Claude's own memory off only once that import
  succeeds; a failed import leaves it ON and the importer's own line says why - report that plainly,
  never assert the switch-off happened because the level was named or adopted. No memory line caught:
  say nothing - an install that already had one and passed no flag left it untouched.
- **RESTART / WARN** - step 3's `update-preflight.js --log` call already printed `restart: yes|no`
  (a report LINE on `yes`, not a question - an audited run spent its ask slot on a credential and
  closed with no restart step, having re-registered all seven servers) and every `warn: <line>` (a
  fail-soft that fell back and continued - not a re-run trigger, see Do not below; an audited run
  surfaced its only `!!` in 1 of 4 runs that had one, buried in a raw grep dump). Report both verbatim.
- **VALIDATE** - step 2's `validate: yes` (the version delta spans more than one release) or
  `policy-rev: stale ...` (the installed usage-policy rule's stamped revision is behind the shipped
  skill's, or carries none) each add a `/alfred-code:validate` suggestion-card row with that reason
  - 'the install is behind by more than one release' / 'the stamped policy is from an older
  release'. Both absent adds nothing. Update prunes only what upstream deleted; a server or skill
  this project stopped needing is validate's whole-stack-absent pass, unmentioned by this command.

The run rewrote `alfred-code.stamp` - the next update or configure diffs from here. Name
`/project-agent-capabilities` (when installed) as the USER's next step when step 2's `changed:`
line shows `skills=` or `agents=` above 0 - the generated rule stamps each skill's first sentence,
which drifts with content-only updates (measured: a 'roster unchanged, rule still accurate' skip
left 7 of 10 stamped sentences stale and the user caught it manually). Gate it on THAT number and
nothing else: keyed on 'the release refreshed any installed skill or agent file' the clause was
permanently true, because the installer re-copies all of them every run - so the suggestion fired on
runs where no skill had changed at all, and a user acted on one. The usage policy inside that
generated rule ships verbatim from the skill and is never re-fetched, so a project can carry a
two-release-old policy with nothing to notice it (measured: one project's rule still described the
fresh-session gate as '40% of the context window, 150k floor', a spelling retired at 0.2.70) - that
is the VALIDATE bullet's `policy-rev:` trigger above, one printed row, not a re-confirmed grep pair
(measured: re-confirmed 3 extra times, ~275k tokens, against an already-conclusive first read).
When serena is installed, also name the one-off re-index as a next step whenever this run
re-seeded `.serena/project.yml` - an install predating the seeding has no `ignored_paths`, so its
cache was built over serena's own language-server directory: `SERENA_HOME=.serena/home uvx --python
3.13 --from serena-agent serena project index` (Windows PowerShell: `$env:SERENA_HOME='.serena\home'` - serena hands the path to cmd.exe unquoted, where a `/` cuts it, and so would a space in an absolute path - and, on Windows on ARM, `--python cpython-3.13-windows-x86_64-none`). Never invoke it from this run - the skill is manual-only (`disable-model-invocation`), so a
Skill call is DENIED by `guard-fresh-session-start.js`, which reads that flag from the skill's own
frontmatter. Do not lean on the harness for it: measured both ways, one update run's call was
refused and another slipped through. The report line is the mechanism.

**The run closes on a suggestion card, never on a question.** After the report, list the
follow-ups that are the USER's to run - restart for an MCP change, `/project-agent-capabilities`
(when installed and the step-2 gate above fires), a manual-only capture whose output is stale, the
serena re-index, a credential to rotate or set by
hand - as `Suggested next steps`, the recommended one first and each with the one reason it
matters. **When this run re-registered an MCP or replaced a hook file, the RESTART is row one** - with
`claude mcp list` named beside it as the one command that confirms the servers actually connected
(a registration is not a connection: measured, two stdio servers timed out at 30s and the session
ran without them with nothing reporting it) - -
every other follow-up runs against the session that is still holding the OLD ones, and a card that
ranks a capture above it tells the user to re-capture an inventory that is not loaded yet (measured:
a run that replaced two guard hooks and re-registered all four servers listed the re-capture first,
and the user ran that first) ('`/project-agent-capabilities` - the update refreshed 12 skill files, so the generated
rule's stamped sentences are stale'). A follow-up that is itself a deliberate run - any of the
captures, a loop - carries a fresh-session note beside it: 'run it in a fresh session; started
here it re-sends this walk's history on every one of its turns'. The guard cannot help with this
one - a scripted update ends far below its trigger by design - and measured, two deliberate runs
chained in one session cost about twice what the second cost run fresh. No AskUserQuestion over them - and read that narrowly:
**it forbids an ask about the FOLLOW-UPS, nothing else.** The step-3 adoption ask for an added
`guard-*` hook and the step-4 prune confirm are mandated by their own steps and are unaffected;
'an update asks nothing by design' has been read as forbidding both, in the same project that also
read it as permitting a closing ask. The follow-up ask was dropped as friction - the user's call,
made knowing a prose next step was ignored 3 of 3 in one audited session, which is why the reason
rides beside every step. Close with this line, verbatim, as the LAST line of the message - nothing
after it:
'Nothing is pending on this run - these are yours to run when you choose.' The stop-contract
guard reads that sentence as a finished close; without it a 'done + next step' card is blocked
as a stall and the guard demands the very ask this paragraph removes.
The line is CONDITIONAL: print it only when the card carries nothing OWED. A still-required user action - revoke the old token, fill in a credential, run a rotation - IS pending, so name it and put the close through the ask instead (measured: one close stated 'Still owed: revoke the old token in Sentry's dashboard' and this line in the same message).

## 8. Clean up the temp dir - ALWAYS
Remove `$TMP` per `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md`, on EVERY exit path:
after the fast path, after refresh + prune, after refresh-only, after a blocker, and after a
user 'no'. Then confirm the project tree holds only installed artifacts by LOOKING, never with
`git status`: the stack's own gitignore advice ignores `.claude/` wholesale, so a porcelain status
over it is empty whatever is sitting there (measured: a run reported '`.claude` tree clean' from an
empty status, on the same listing where its own earlier `ls` had shown a stray
`alfred-code.stamp.testwrite`). `ls -a .claude` plus a check that no archive, extracted repo,
`raw.json`, `selection.txt` or `install.log` was left in the project - anything stray is named in
the close-out, not silently ignored.

## Do not
- Never delete anything the upstream diff or the migrations catalog did not name - user-authored
  skills/agents/rules/hooks and the generated `baseline-project-*.md` / `project-code-style.md`
  rules appear in neither; if a candidate is in neither list, it stays.
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
  Report it; never re-run the installer end to end to feel sure. Measured: one run did, at about
  half the session's total cost, and changed nothing.
- Never run this walk on the expensive tier when a cheap one is available. It is script
  orchestration - a preflight, an installer invocation, a grep and a report - not reasoning: the
  same scripted walk cost 3x on a 1M-window opus session as on sonnet in the same project, for the
  same output.
