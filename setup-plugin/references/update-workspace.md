# /alfred-code:update - the workspace: the children's asks and the cascade

Read by step 2's call only when `workspace.js plan` names a second project, a `set-aside:` row, a `gone:` child, a `rescan:` row or a `nested:` row. This
project's own update runs exactly as the walk says; this file adds the projects joined below it. Each child keeps its
own picks and ignores, and its own scope.

## The plan - `$TMP/plan.txt`, printed above

- `workspace-plan: <n> projects` - this project and every joined project below it.
- `project: <rel><TAB>scope=<s><TAB>version=<stamped>-><snapshot><TAB>add=<csv|-><TAB>drop=<csv|->` - one row per
  project, top-down. `.` is this project, whose own delta is step 2's. A child's `add` / `drop` is what this release and
  this project's set do to that child; `?` with an indented `!! no projection - <why>` means its read-back failed, and
  the cascade skips it and everything below it.
- Indented under a row, that project's own asks, as its own update would print them:
  `docs-move: offer`, `instructions-file: ... update=ask*`, `instructions-both: ask`, `workspace: role-ask <case> <rel>`.
- `set-aside: <rel>` - a joined child the user set aside, printed in place of its `project:` row: it is no child for the fit check, the carry ask or the cascade: it is left out of the count and runs nothing here, and a plan with only `set-aside:` rows below asks and runs nothing. The close names each: '`/alfred-code:update` in `<rel>` brings it up to date'.
- `gone: <rel>` - a listed child folder that no longer holds an install; the cascade removes its line.
- `rescan: <rel>` - an installed project below with no parent line, no role recorded and its workspace switch not 0
  (every update's `plan` rescans). Each is joined below, after step 2's answers and before the installer call, and
  counts as a project below.
- `nested: <rel>` - an install inside this repository: a plain subfolder with its own `.claude/` and stamp and no `.git` of
  its own, which this repository's install already reaches. It is not a project of its own: never joined, never counted
  as a project below. A joined child whose `.git` is gone is one too: it prints only as `nested:`, never as a `project:`
  row, and the cascade counts it `nested` (`cascade: <rel>` and `nested`, with one `cascade: <rel> is part of this repository now`
  line, no `!!`) and never runs the installer there. Rows below it stay `skipped`.

Paste the plan's table in your message verbatim, its `total:` line included, before any ask.

## The children too, or only this project - ONE ask

Asked whenever a project below would run: the plan names a second project, or a `rescan:` row (it counts as a project
below; the join comes after this ask is answered, and one that prints a `!!` line is reported and skipped); a plan whose
only rows below are `gone:` asks nothing and runs the cascade, which only removes their lines. `<n>` is the plan's count
less this project, plus the `rescan:` rows. In the same AskUserQuestion
call as step 2's own asks while it holds fewer than four questions, else a call of its own right after. When a child
row carries its own asks:

```ask
Update the <n> project(s) below this one as well? <each project: its rel and its asks, in a few words>.
- 'Yes, their questions the recommended way (Recommended)' - each child updates now, top-down; each ask takes the Recommended option its own update would offer
- 'Yes, I pick per project' - each child updates now; one question per ask next, headed with the project, its own options
- 'Yes, their questions left for later' - each child updates now; nothing is passed, each offer stays an offer, asked again at that project's own update
- 'No, only this project' - nothing below runs; each keeps its own copies and settings until it is updated
```

When no child row carries one, the question offers the two ends:

```ask
Update the <n> project(s) below this one as well? <each project's rel>.
- 'Yes, update them too (Recommended)' - each child updates now, top-down, from this project's new set
- 'No, only this project' - nothing below runs; each keeps its own copies and settings until it is updated
```

A held child reads this project's new set at its own next update, so the cascade is the default, not a duty. A held
child is not frozen whole: its folder is left as it is, but a core plugin installed for the whole account moves for
every project, so its sessions run the new hooks and agents beside its older copies until its own update.
On 'No, only this project', record it now, in step 2, and write no child's answers:

```bash
node "$TMP/repo/scripts/workspace.js" answer --file "$TMP/answers.json" --hold
```

The Recommended answer per ask: `docs-move: offer` -> `--docs-root-move move`;
`instructions-file:` -> the name template `instructions-place.md` names for its `update=` verdict, its Recommended value
as `--instructions-file agents|claude` (`update=ask-local` passes none); `workspace: role-ask` -> the first `ask:` line of
`node "$TMP/repo/scripts/workspace.js" role --root <rel> --when update`, its answer run now as `node
"$TMP/repo/scripts/workspace.js" role --root <rel> --answer <answer>`, never through the answers file. A child's
`instructions-both: ask` is the walk's one account question: ask it once and pass every such project as its own
`--root` to the one `account-instructions` call - on 'No, only this project' no child's root: nothing below is
written. 'Yes, I pick per project' opens ONE AskUserQuestion call of up to four questions, one per ask, each option the
walk's template for that ask; more asks take a second call.

Write each project's answers with ONE call per project, never a hand-written JSON:

```bash
node "$TMP/repo/scripts/workspace.js" answer --file "$TMP/answers.json" --project <rel> -- <flag> <value>
```

The call takes each `<flag> <value>` pair of that project, one after the other. A `!!` line means the flag or value was refused and the file is as it was: ask that one again. Unattended, take the
Recommended option for every ask, `update=ask-local` excepted, as the walk does.

## Projects installed below - joined, then checked - on `rescan:` rows

The user's ruling (2026-11-19): every update joins each installed project it finds below and suggests what that child
should leave out. The joins run after step 2's AskUserQuestion answers are applied - this project's own `role --answer`
first - and before the installer call. The check runs after this project's own installer run (step 3) and before the
cascade. A hold answer stops neither: each join and each ignore is still written.

**The join - no ask.** For each `rescan:` row, in the order the plan lists them:

```bash
node "$TMP/repo/scripts/workspace.js" join --root <rel> --answer join
```

It prints `workspace: parent <up> written|kept`, `workspace: child <rel-from-that-parent> written|kept in <up>`,
`role: child of <name>` and `join: join`; `<up>` is the way from the child to this project (`..`, `../..`) - the
rescan stops at the first installed folder, so the parent of every row is this project. A join that prints `!!` is
reported and skipped: that project stays standalone, gets no check, and the rest still join. Narrate one line per
joined project: `<rel> joined as a child of <name>`, and that `/alfred-code:configure` in that project ('Leave and
become standalone') takes it out again. A project that recorded a role - standalone or root, a 'Leave and become
standalone' included - or whose own workspace switch is 0 is no row and is never joined here.

**The check - once the installer call has run, per joined child.** It reads this project's set as this release just
wrote it, offers taken: every row's parent is this project, so ONE parent read serves every joined child. Validate's
own commands (`/alfred-code:validate`, step 2 - same flags, same stack-select modes). A failed installer run
(`step(s) reported a failure above`) skips the check and its asks: say `/alfred-code:validate` in that project
offers the same check. First the scope read, once, its own call: `node "$TMP/repo/scripts/install/stamp.js" scope .` prints the scope word, written
below as `<scope>`. Then the first call, once - the parent's set, the detection list and the evidence scan
of every child checked in this run - the ones joined now and the ones re-checked below - (one `scan-evidence.js` per child, `<n>` its number across both, joined ones first, each group in the plan's order, joined by ` ; `), the parent read last so its `parent-read:` line closes the call:

```bash
cat "$TMP/repo/setup-plugin/references/stack-detection.md" ; node "$TMP/repo/scripts/scan-evidence.js" --root <rel> --catalog "$TMP/repo/meta/evidence.json" --out "$TMP/found-<n>.json" ; (node "$TMP/repo/scripts/install/alfred-code.js" update --source "$TMP/repo" --scope <scope> --installed-only --print-plan --plan-out "$TMP/parent.json" > "$TMP/parent.out" 2>&1) && node "$TMP/repo/scripts/stack-select.js" --inherited-check "$TMP/parent.json" ; echo "parent-read: $?"
```

`parent-read` not 0 -> no check for any child: paste its `!! inherited:` line when it printed one and say
`/alfred-code:validate` in that project offers the same check. Otherwise apply `stack-detection.md` to each joined
child folder - the catalog keys of `meta/recommendations.json` (`web-angular`, never `angular`). This is no veto ask:
the fit ask below is the child's choice. Then, per child, the second call:

```bash
node "$TMP/repo/scripts/stack-select.js" --redundant --installed "$TMP/parent.json" --found "$TMP/found-<n>.json" --recs "$TMP/repo/meta/recommendations.json" --graph "$TMP/repo/meta/stack-graph.json" --stacks "<the child's stacks, csv>"
```

`--installed` takes the parent's `--plan-out` file as it is - the file validate's own `installed.json` is. The
`redundant: <category> <name> - owned by <stacks>, not detected` lines are the items the child inherits that fit none of
its stacks. Show each child's lines as a table before the asks, one row per line with the state word `REDUNDANT`: the
layer-table gate holds an ask until a `--redundant` call's result is in your text with that word. A child with none gets
no ask and one line, `<rel>: no REDUNDANT row - keeps everything it inherits`.

**The fit ask - ONE per joined child that has at least one `redundant:` line.** All of them ride in one
AskUserQuestion call, up to four questions, one per child; more children take a second call, before the cascade. With
`<k>` of 2 or more:

```ask
<rel> joined this workspace as a child - its stacks: <csv>. Of what it inherits, <k> item(s) fit none of them: <category name - owned by <stacks>, ...>. Ignore those here?
- 'Ignore the <k> suggested (Recommended)' - each is written as an ignore of <rel>, so it never reaches that project; everything else it inherits stays
- 'Keep everything inherited' - nothing is written; the next validate in <rel> offers the same removals
- 'Pick' - up to 4 multi-select questions list the <k>; the ones picked are ignored
```

With `<k>` of 1 there is nothing to pick from, so the ask has two options:

```ask
<rel> joined this workspace as a child - its stacks: <csv>. Of what it inherits, 1 item fits none of them: <category name - owned by <stacks>>. Ignore it here?
- 'Ignore it (Recommended)' - it is written as an ignore of <rel>, so it never reaches that project; everything else it inherits stays
- 'Keep it' - nothing is written; the next validate in <rel> offers the same removal
```

'Pick' opens the questions of 2-4 multi-select options each. The items split in the order listed (as `walk.md` deals its
picks) into groups of 2 to 4 options, never a group of 1: with a remainder of 1, the previous group gives one up (17 items
split 4, 4, 4, 3, 2). One group is one question, at most four questions go in one AskUserQuestion call, and more groups
take a call right after. Each option is one item as the `redundant:` line prints it, its description the owning stacks,
`header` at most 12 characters. `<csv>` is `none` when nothing was detected. The ignores are
written now, one call per item, each `<category> <name>` being the `redundant:` line's two words as they stand:

```bash
node "$TMP/repo/scripts/workspace.js" ignore --root <rel> --add "<category> <name>"
```

It prints `workspace: ignore <category> <name> added|kept`; a `!!` line is pasted and that item is not ignored.
'Keep everything inherited' writes nothing. Whenever nobody answers this ask - `unattended: on` or no ask tool - take
'Keep everything inherited', never 'Ignore the <k> suggested': an
unanswered run never drops what a project may own, and an item the child had installed before the join reads as
inherited. Say
in the close which ignores were applied (`update-close.md`, WORKSPACE). The cascade runs when the plan names a child
or a `rescan:` row joined: a joined child is a child for it, though `$TMP/plan.txt` listed none.

## Children joined earlier - re-checked on the items this update added

The user's ruling (2026-11-19): a child joined by an earlier update gets the fit check again, but only on the items this
update added to this project - an item a later update brings reaches every earlier child, so it is checked there too. A
child joined in this run keeps the full check above, unchanged.

**The added items - `$TMP/added.txt`.** Once step 2's new-items answer is applied (either path), before the installer call, write one line
`<category> <name>` for every `new:` row whose verdict is `arrives` and for each offer taken as an `--add`, from the
`new:` lines in `update-walk.md`. No such row and no offer taken: the file stays empty, and this section runs nothing
and asks nothing.

**The children.** Every `project:` row of the plan whose parent is this project - no other `project:` row is a path
prefix of its `<rel>` - that this run did NOT join (not a `rescan:` row) and that is not ignored. A grandchild is not
checked here: its own parent's update checks it, and the cascade runs that update.

**The check - after the installer call, with a non-empty `$TMP/added.txt` and at least one such child.** Run it beside
the fit check above and reuse its parent read: its first call already scanned each child checked here, under the same `<n>`.
When that first call did not run (no `rescan:` row), make it once, with one `scan-evidence.js` per child checked here. A
`parent-read` not 0 stops this check as it stops that one. Per child,
apply `stack-detection.md` to its folder, then the second call with one more flag, `--only`:

```bash
node "$TMP/repo/scripts/stack-select.js" --redundant --only "$TMP/added.txt" --installed "$TMP/parent.json" --found "$TMP/found-<n>.json" --recs "$TMP/repo/meta/recommendations.json" --graph "$TMP/repo/meta/stack-graph.json" --stacks "<the child's stacks, csv>"
```

`--only` prints only a `redundant:` line naming an item of the file; a missing file exits 2 with one line on stderr and
no list, and an empty one prints nothing. Its lines are shown as the table above. A child with no line gets no ask and
one line, `<rel>: no REDUNDANT row among the new items`, which the layer-table gate reads as the call's result. A failed installer run
skips this check as it skips the one above.

**The ask - ONE per such child that has at least one line.** It rides the same AskUserQuestion call(s) as the join
fit asks, up to four questions a call. `<k>` is the line count. Its three options act as the fit ask's: 'Ignore' is
written one `workspace.js ignore --root <rel> --add "<category> <name>"` per item, and 'Pick' groups the items as above.
With `<k>` of 1, leave out 'Pick'.

```ask
<rel> inherits <k> new item(s) from this update that fit none of its stacks: <category name - owned by <stacks>, ...>. Ignore those here?
- 'Ignore the <k> suggested (Recommended)' - each is written as an ignore of <rel>, so it never reaches that project; everything else it inherits stays
- 'Keep everything inherited' - nothing is written; only new items are asked, so this answer is not asked again for these
- 'Pick' - up to 4 multi-select questions list the <k>; the ones picked are ignored
```

Whenever nobody answers this ask - `unattended: on` or no ask tool - take 'Keep everything inherited', as the
join ask does. Say in the close which ignores were applied (`update-close.md`, WORKSPACE).

## Installs nested in this repository - on `nested:` rows

The user's ruling (2026-11-19): an install in a plain subfolder of this repository is not a project of its own, so each
one is named and offered for removal. The installer always installs at the top of the repository, so such a folder only
comes from an older release or a copied folder. One question per `nested:` row, in step 2's AskUserQuestion call while it
holds fewer than four questions, else a call of its own right after:

```ask
<rel> holds an install of its own inside this repository - this repository's install already reaches that folder. Remove the nested install?
- 'Remove the nested install (Recommended)' - its stack copies, links, generated rules, the stack's settings keys and stamp go; its AGENTS.md, any copy you edited, its docs and data in .alfred and your own files stay
- 'Keep it' - nothing changes; the next update asks again
```

'Remove the nested install' runs, once the answers are applied and before the installer call:

```bash
node "$TMP/repo/scripts/workspace.js" remove-nested --root . --path <rel>
```

Report its lines: `remove-nested: <rel> - <n> stack file(s) removed`, one `remove-nested: <rel> kept <path> - <why>` per file that
stays, and `remove-nested: done <rel>`. It takes only the files that folder's own stamp records, never this
repository's install, the account, a plugin or git's exclude file; a `!!` line is reported and that folder is left as it
is. Whenever nobody answers this ask - `unattended: on` or no ask tool - take
'Keep it', never 'Remove the nested install': an unanswered run never removes what a project may own.

## The cascade - after this project's own installer run

Right after step 3's installer call (the slow path's step 5 on that path) and before the close, ONE call with
`timeout: 600000` (each child is one installer run):

```bash
node "$TMP/repo/scripts/workspace.js" cascade --root . --source "$TMP/repo" --answers "$TMP/answers.json" > "$TMP/cascade.txt" 2>&1
```

The call is the same on either answer. With the hold recorded it reads nothing back and runs nothing: it names every
project below `held` (a gone one `gone-kept`, out of the count) and ends on the same `cascade: done` line, so the close
reports them as it reports a cascade, and a gone child keeps its line until a cascade runs.

Each row reaches `$TMP/cascade.txt` as its project finishes. A cascade that outruns it comes back BACKGROUNDED and
keeps running: never start it again (two cascades would update the same children at once). Wait for its completion
notice, then go on.

It updates every child top-down at its own scope, each from its parent's fresh read-back, with that project's answers
and `--keep-pins`. A failed project skips everything below it, a child that does not name its parent back is skipped
with one `!!` line, and a `gone` child's line comes out of its parent. No answers file is the same as no answers.
When this project's own run printed `step(s) reported a failure above`, skip the cascade and say each child keeps its
set until the next update. Never re-run a failed child by hand from here: `/alfred-code:update` in that folder is its
own walk. The close reads `$TMP/cascade.txt` (`update-close.md`, step 7).
