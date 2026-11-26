# /alfred-code:validate - the workspace: the children's fit and the cascade

Read by step 10's last call only when `workspace.js plan` names a second project or a `set-aside:` row. This project's reconcile is done
by then; this file carries its result to the projects joined below it. Without it a child keeps the set it read at its
last update, and a clean validate here says nothing about it. Each child keeps its own picks, ignores and scope.

## The plan - `$TMP/plan.txt`, printed above

Rows as `update-workspace.md` lists them: `workspace-plan: <n> projects`, one `project: <rel>` row per project top-down
(`.` is this project; a child's `add` / `drop` is what this project's reconciled set does to it; `?` with an indented
`!! no projection` is a child the cascade skips with everything below it), `gone:`, `rescan:` and `nested:` rows.
Paste the plan's table in your message verbatim, its `total:` line included, before any ask.

- `set-aside: <rel>` - a joined child the user set aside, printed in place of its `project:` row: it is no child for the fit check, the carry ask or the cascade: it is not in the count and runs nothing here, and a plan with only `set-aside:` rows below skips the fit check, the asks and the cascade call. The close names each: '`/alfred-code:update` in `<rel>` brings it up to date'.
- `rescan: <rel>` - validate joins no project. One line: '`<rel>` is installed below with no parent - `/alfred-code:update`
  here joins it'. It is no child for the check or the cascade.
- `nested: <rel>` - one line: '`<rel>` holds an install inside this repository - `/alfred-code:update` here offers its
  removal'. Nothing else is done with it.
- `gone: <rel>` - the cascade removes its line; no ask.
- Asks indented under a child's row (`docs-move: offer`, `instructions-file: ...`) stay that child's: no answers are
  passed, so each is asked again at that project's own update.

## The fit check - per direct child

The children are the `project:` rows whose parent is this project - no other `project:` row is a path prefix of their
`<rel>` - and no `?` row. A grandchild is checked by its own parent's validate. First the scope read, its own call:
`node "$TMP/repo/scripts/install/stamp.js" scope .` prints the scope word, written below as `<scope>`. Then ONE call
with the detection list, one `scan-evidence.js` per child (`<n>` its number in the plan's order, joined by ` ; `), and
this project's set as step 10 just wrote it, read last so its `parent-read:` line closes the call:

```bash
cat "$TMP/repo/setup-plugin/references/stack-detection.md" ; node "$TMP/repo/scripts/scan-evidence.js" --root <rel> --catalog "$TMP/repo/meta/evidence.json" --out "$TMP/found-<n>.json" ; (node "$TMP/repo/scripts/install/alfred-code.js" update --source "$TMP/repo" --scope <scope> --installed-only --print-plan --plan-out "$TMP/parent.json" > "$TMP/parent.out" 2>&1) && node "$TMP/repo/scripts/stack-select.js" --inherited-check "$TMP/parent.json" ; echo "parent-read: $?"
```

`parent-read` not 0 -> no check for any child: paste its `!! inherited:` line when it printed one, and the close names
`/alfred-code:validate` in each child. Otherwise apply `stack-detection.md` to each child folder - the catalog keys of
`meta/recommendations.json` (`web-angular`, never `angular`); this is no veto ask. Then, per child:

```bash
node "$TMP/repo/scripts/stack-select.js" --redundant --ignored-in <rel> --installed "$TMP/parent.json" --found "$TMP/found-<n>.json" --recs "$TMP/repo/meta/recommendations.json" --graph "$TMP/repo/meta/stack-graph.json" --stacks "<the child's stacks, csv>"
```

The `redundant: <category> <name> - owned by <stacks>, not detected` lines are what the child inherits that fits none
of its stacks. Show each child's lines as a table before the asks, one row per line with the state word `REDUNDANT`
(`<rel> | <category> <name> | REDUNDANT | owned by <stacks>`): the layer-table gate holds an ask until a `--redundant`
call's result is in your text with that word. A child with none gets no fit ask and one line,
`<rel>: no REDUNDANT row to offer - it keeps what it inherits, beside what it already ignores`.

## The asks - ONE AskUserQuestion call

The fit asks, one per child with at least one `redundant:` line, and the carry ask ride one call, up to four questions;
more take a call right after. `<k>` is the child's line count, `<csv>` its stacks (`none` when nothing was detected).
With `<k>` of 2 or more:

```ask
<rel> inherits <k> item(s) from this project that fit none of its stacks (<csv>): <category name - owned by <stacks>, ...>. Ignore those there?
- 'Ignore the <k> suggested (Recommended)' - each is written as an ignore of <rel>, so it never reaches that project; everything else it inherits stays
- 'Keep everything inherited' - nothing is written; the next validate here offers the same removals
- 'Pick' - up to 4 multi-select questions list the <k>; the ones picked are ignored
```

With `<k>` of 1:

```ask
<rel> inherits 1 item from this project that fits none of its stacks (<csv>): <category name - owned by <stacks>>. Ignore it there?
- 'Ignore it (Recommended)' - it is written as an ignore of <rel>, so it never reaches that project; everything else it inherits stays
- 'Keep it' - nothing is written; the next validate here offers the same removal
```

'Pick' groups the items as `update-workspace.md` does: 2 to 4 options a question, never a group of 1. Whenever nobody
answers a fit ask - no ask tool - take 'Keep everything inherited' ('Keep it'): an unanswered run never drops what a
project may own. The stack's auto-run answers no ask of this walk: each goes to the user (3.14.1). Each ignore is written once the answers
are in, one call per item, the `redundant:` line's two words as they stand:

```bash
node "$TMP/repo/scripts/workspace.js" ignore --root <rel> --add "<category> <name>"
```

It prints `workspace: ignore <category> <name> added|kept`; a `!!` line is pasted and that item is not ignored.

The carry ask, `<n>` the plan's count less this project:

```ask
Carry this project's reconciled set to the <n> project(s) below? <each project's rel and its add / drop, in a few words>.
- 'Yes, update them now (Recommended)' - each child updates top-down from this project's set, with the ignores just written; its own asks wait for its own update
- 'No, only this project' - nothing below runs; each keeps its copies and settings until it is updated
```

An unanswered carry ask - no ask tool - takes 'No, only this project'. On 'No, only this project', record it before
the cascade call:

```bash
node "$TMP/repo/scripts/workspace.js" answer --file "$TMP/answers.json" --hold
```

## The cascade

When step 10's installer run printed `step(s) reported a failure above`, skip the asks and the cascade, and say each
child keeps its set until its next update. Otherwise ONE call with `timeout: 600000`, the same on either answer:

```bash
node "$TMP/repo/scripts/workspace.js" cascade --root . --source "$TMP/repo" --answers "$TMP/answers.json" > "$TMP/cascade.txt" 2>&1
```

With the hold it runs nothing and names every project below `held`. A cascade that outruns the call comes back
BACKGROUNDED: never start it again; wait for its completion notice. Never re-run a failed child by hand from here.

## In step 11's report - WORKSPACE

Read `$TMP/cascade.txt` (no `cascade: done` line: still running, wait). One row per project from its
`cascade: <rel><TAB><state>` line - `updated`, `unchanged`, `failed`, `skipped`, `gone`, `held`, `gone-kept` or
`nested` - each `!!` and `report: <rel>: ...` line under it verbatim, then the `cascade: done ...` line, then the ignores
written per child. The suggestion card carries, for each child, '`/alfred-code:validate` in `<rel>` - this run checked
only what `<rel>` inherits, not its own picks'; a `failed` or `skipped` child puts '`/alfred-code:update` in `<rel>`'
there too, and any `held` row '`/alfred-code:validate` here again, answering yes, updates the held projects'.
