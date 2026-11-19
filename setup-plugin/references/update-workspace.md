# /alfred-code:update - the workspace: the children's asks and the cascade

Read by step 2's call only when `workspace.js plan` names a second project, a `gone:` child or a `rescan:` row. This
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
- `gone: <rel>` - a listed child folder that no longer holds an install; the cascade removes its line.
- `rescan: <rel>` - an installed project below with no parent line (every update's `plan` rescans). Each is joined
  below, before any ask, and counts as a project below.

Paste the plan's table in your message verbatim, its `total:` line included, before any ask.

## The children too, or only this project - ONE ask

Asked whenever a project below would run: the plan names a second project, or a `rescan:` row (joined first, so it
counts as a project below; one whose join printed a `!!` line does not); a plan whose only rows below are `gone:` asks
nothing and runs the cascade, which only removes their lines. `<n>` is the plan's count less this project, plus the
`rescan:` rows that joined. It comes after the joins and their fit asks (the next section). In the same AskUserQuestion
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
node "$TMP/repo/scripts/workspace.js" answer --file "$TMP/answers.json" --project <rel> -- <flag> <value> [<flag> <value> ...]
```

A `!!` line means the flag or value was refused and the file is as it was: ask that one again. Unattended, take the
Recommended option for every ask, `update=ask-local` excepted, as the walk does.

## Projects installed below - joined, then checked - on `rescan:` rows

The user's ruling (2026-11-19): every update joins each installed project it finds below and suggests what that child
should leave out. This runs right after the plan is pasted - before the scope ask is put, before any answer is acted on
and before the cascade - so a held cascade still leaves each join and its ignores written.

**The join - no ask.** For each `rescan:` row, in the order the plan lists them (a row below another is joined after
that one):

```bash
node "$TMP/repo/scripts/workspace.js" join --root <rel> --answer join
```

It prints `workspace: parent <up> written|kept`, `workspace: child <rel-from-that-parent> written|kept in <up>`,
`role: child of <name>` and `join: join`; `<up>` is the way from the child to the folder it joined (`..`, `../..`) - for
a row below another child that is that child, not this project. A `!!` line names a project that could not join (it
stays standalone and gets no check), and the rest still do. Narrate one line per joined project: `<rel> joined as a
child of <name>`, and that `/alfred-code:configure` in that project ('Leave and become standalone') takes it out again.

**The check - per joined child, with the check `/alfred-code:validate` runs** (its step 2 - same flags, same
stack-select modes), against the set the child now inherits, its parent's. Two Bash calls per child, `<n>` its number
in the plan's order, because the child's stacks come from reading it between them.

First call, the parent's set, the detection list and the evidence scan:

```bash
(cd "<rel>/<up>" && node "$TMP/repo/scripts/install/alfred-code.js" update --source "$TMP/repo" --scope "$(node "$TMP/repo/scripts/install/stamp.js" scope .)" --installed-only --print-plan --plan-out "$TMP/parent-<n>.json" > "$TMP/parent-<n>.out" 2>&1) && node "$TMP/repo/scripts/stack-select.js" --inherited-check "$TMP/parent-<n>.json" ; echo "parent-read: $?" ; cat "$TMP/repo/setup-plugin/references/stack-detection.md" ; node "$TMP/repo/scripts/scan-evidence.js" --root <rel> --catalog "$TMP/repo/meta/evidence.json" --out "$TMP/found-<n>.json"
```

`<rel>/<up>` is the folder `join` joined. `parent-read` not 0 -> no check for that child: paste its `!! inherited:` line
when it printed one and say its fit is checked at its own next update. Otherwise apply `stack-detection.md` to the
child folder - the catalog keys of `meta/recommendations.json` (`web-angular`, never `angular`); read the list once,
the first child's call, and reuse it. This is no veto ask: the fit ask below is the child's choice. Then the second call:

```bash
node "$TMP/repo/scripts/stack-select.js" --redundant --installed "$TMP/parent-<n>.json" --found "$TMP/found-<n>.json" --recs "$TMP/repo/meta/recommendations.json" --graph "$TMP/repo/meta/stack-graph.json" --stacks "<the child's stacks, csv>"
```

`--installed` takes the parent's `--plan-out` file as it is - the file validate's own `installed.json` is. The
`redundant: <category> <name> - owned by <stacks>, not detected` lines are the items the child inherits that fit none of
its stacks. A child with none gets no ask: narrate `<rel> keeps everything it inherits`.

**The fit ask - ONE per joined child that has at least one `redundant:` line.** All of them ride in one
AskUserQuestion call, up to four questions, one per child; more children take a second call, before the scope ask.

```ask
<rel> joined this workspace as a child - its stacks: <csv>. Of what it inherits, <k> item(s) fit none of them: <category name - owned by <stacks>, ...>. Ignore those here?
- 'Ignore the <k> suggested (Recommended)' - each is written as an ignore of <rel>, so it never reaches that project; everything else it inherits stays
- 'Keep everything inherited' - nothing is written; the next validate in <rel> offers the same removals
- 'Pick' - one multi-select question lists the <k>; the ones picked are ignored
```

`<csv>` is `none` when nothing was detected. The ignores are written now, one call per item, each `<category> <name>`
being the `redundant:` line's two words as they stand:

```bash
node "$TMP/repo/scripts/workspace.js" ignore --root <rel> --add "<category> <name>"
```

It prints `workspace: ignore <category> <name> added|kept`; a `!!` line is pasted and that item is not ignored.
'Keep everything inherited' writes nothing. Unattended, take the Recommended option. Say in the close which ignores
were applied (`update-close.md`, WORKSPACE). A joined child is a child for the cascade below, though `$TMP/plan.txt`
did not list it: run the cascade call even when the plan named no other child.

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
