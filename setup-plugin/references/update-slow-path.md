# /alfred-code:update - the slow path and the rare branches

`update-walk.md` holds the fast path every run takes (steps 1-3) and `update-close.md` steps 6-8; this file is read -
in ONE Bash `cat` - only when one of its cases applies: a non-empty prune list (steps 4 and 5), a `data-move: offer`
line, a `--docs-versioning` value in the user's own invocation, or a `guard-*` hook still absent after a copy-route
run. Each section says when it applies; the rest of the run
stays in those two.

## 4. Pruning path - confirm once, then refresh + prune

The installer reads the install back itself (`--installed-only`), so the ask below needs only the compare.

Show the version delta, the refresh counts by category (step 2's `changed-here:`), and the NAMED prune
list - each detected migration with its why. Ask ONE question through AskUserQuestion:

```ask
Refresh and prune? <the version delta and refresh counts>; prune: <each migration's path and why>. The copies the release retired or renamed go either way.
- 'Refresh and prune (Recommended)' - the installer refreshes, then step 5 removes what the migrations name
- 'Refresh only' - no migration removal; the stack's own retired and renamed copies still go
```

The answer governs those removals alone: 'refresh only'
means step 3's installer run and no migration removal, while the copies the release retired or renamed go
either way - the installer prunes the stack's own on both answers, so the ask says so in one clause and
never offers to keep them. For example:

```
alfred-code 0.1.0 -> 0.2.0 - refresh: 12 skills, 9 agents, 6 rules, 3 hooks
prune: .claude/hooks/inject-code-style.js (migration: style delivery moved to a generated rule)
```

On 'proceed': run the installer exactly as in step 3 - its `--add` already carries every `renamed`
row's new name (the old copy is on disk, the new one is not yet, so the read-back alone would lose
it) and every offer the step-2 ask took. A removed name needs no flag - this release
does not ship it, so the read-back cannot carry it - and the installer prunes its copy; step 5 deletes only
what the migrations name. Never rebuild the
selection from a disk inventory on the Node seed: on the plugin routes `.claude/` holds only the
library copies, and a selection built from it switches off every seat an enabled entry carries (the Phase 8
read-back exists for exactly that). The first update past 2.1.0 is the one that moves an install
across: its stamp has no `seats-route:` line, so the read-back goes by what the 2.0.x core carried -
the always skills become copies, a library seat copy is pruned (an edited one is kept and named, and so
is a tuned one - a `model` / `effort` other than the stack's, which no setting can give the core's seat), and
every seat the install never ran is denied; the installer says it in one `installed-only: the stamp
predates 2.1.0` line (and one `agent kept:` line per kept seat copy, naming its pins and that it is
dispatched by its bare name - the capabilities rule's seats line is re-spelled to match, every other seat
as `alfred-code:<seat>`). Quote each `agent kept:` line in the report: the core's twin still lists beside the
copy, and deleting the copy is how the user takes the stack's seat back. A `required:` line (a dependency the new release introduced) is auto-kept and
reported. An `unknown:` line is NEVER prune evidence: a skill, agent, rule or hook the user wrote
prints exactly that way, and the installer leaves every one of them in place (it only replaces the names it ships; a hand-added `.mcp.json` server is never
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
as a next step - run nothing on the user's behalf. Then step 6 of `update-close.md`.

## The data root move - on `data-move: offer`

Alfred Code keeps a project's data in ONE folder, `.alfred` at the project root by default: the docs, the
hooks' state, the seats' handoff notes and the sensitive-data file. It sits outside
`.claude/`, where Claude Code prompts for every write - every plan, capture and commit receipt - denies it in
`dontAsk`, and no allow rule lifts it (code.claude.com/docs/en/permission-modes, 'Protected paths'). The sensitive-data
file moves only on the answer to `update-walk.md`'s ask; the docs move unasked (below).

A typed folder (Other) is a custom root: `--data-path <folder> --data-move move`; it must be relative,
inside the project, never under `.claude/`, with no space. The recommended answer is `--data-move move`,
the keep answer `--data-move keep` - on the installer call of whichever path runs (the 2.0.0 spelling
`--docs-move` is read for one release). The docs are no part of the offer: they always sit at `<data root>/docs`, and
every run moves them unasked from a leftover `ALFRED_CODE_DOCS_PATH` (retired in 2.8.0) the stack wrote or an earlier
root - the log's `docs root:` lines say what moved, and a `!! docs root:` line names a clash that kept the key. A root
the user set by hand is the one exception: its own ask, on `docs-move: offer` (update-walk.md). A `conflicts=<n>` field means data already sits at the new place: do not ask - name the
count, run without the flag (the old place stays in effect), and the next update offers again once they are cleared. After a move the log carries `docs root: moved ...` and `data root: ...`
lines (what moved), and the `--log` call prints `restart: yes`.
Unattended, the ask takes its Recommended option - the move overwrites nothing (a conflict already stops it) -
logged as one `unattended: <question> -> <choice>` line.

## Flags the user's own invocation names - `--docs-versioning`

`--docs-versioning` is passed ONLY when the user's own invocation names a value (`/alfred-code:update
--docs-versioning local`, or 'switch docs versioning to git') - never asked for, never inferred. The
installer writes it over the current value and prints one `settings.json env: ALFRED_CODE_DOCS_VERSIONING
<old> -> '<new>'` line; any other value is refused before anything is written. Without it, the key is
only seeded when missing. `--memory-level` left with the memory server in 2.10.1: the installer accepts it and
ignores it in one line.

## A guard hook still absent after a copy-route run

Hooks are an all-or-nothing layer on the `--installed-only` path: an install that HAS hooks receives every
hook the release ships, and the run logs `installed-only: adopting hook <name>` for each one. A hook the user
DROPPED is not resurrected - the stamp records the catalog each run shipped, so 'shipped then, absent now' reads
as a deliberate drop and is left out, logged as such. Put adoption through AskUserQuestion only when the installer
did NOT adopt it - a `guard-*` ENFORCEMENT hook still absent after the run (the derivation fell back, or it was
dropped before):

```ask
Adopt <hook>? <what it blocks, from its header's first lines>. The update did not add it.
- 'Adopt now (Recommended)' - copied into .claude/hooks/ and wired as the installer wires it
- 'Leave it off' - it stays absent; /alfred-code:configure adds it later
```

On 'Adopt now' copy it from `$TMP/repo/stack/hooks/` into `.claude/hooks/` and wire its
matcher entries into settings.json exactly as the installer's hook step does. To author that ask, read the hook's
own header comment and nothing else (`head -8 "$TMP/repo/stack/hooks/<file>"`) - every guard states what it blocks
in its first lines; reading the hook to understand it cost 3.6k tokens and the session's largest context spike in
one audited run, for a one-sentence question. (Measured, and the reason the layer became all-or-nothing: the
v0.2.20 commit gate reached zero of three consuming projects - every update surfaced it as an FYI the user exited
past, while the same updates refreshed the rule text the hook exists to enforce.)
