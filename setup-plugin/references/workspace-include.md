# The workspace children - which ones this run includes

Printed by a walk's `include` call, after `$TMP/include.txt`, only when a line of the kinds below printed. A project with no
joined child, or no root at all, prints none of them and never reads this file. A set-aside child stays joined and keeps
inheriting this project's set. This run reads, scans and updates only the children it includes, and it never changes a
set-aside child's picks, version or settings values.

## The line kinds

- `included: <rel>` - a joined child this run works on: detection reads it, the cascade updates it.
- `set-aside: <rel>` - a joined child this run leaves alone. It is not read, not scanned and not updated.
- `unasked: <rel>` - a joined child the user was never asked about. It is taken as included until answered, and a child an update's rescan joins stays unasked until the next walk.
- `below: <rel>` - a project below a child. It follows its child and is never asked about.
- `unattended: on` - nobody answers asks in this run.
- `include: <i> included, <s> set aside, <u> unasked` - the summary line.
- `!!` - a record is garbage, or locked.

## 1. The `!!` case

Paste each `!!` line. Then read the other lines printed with it.

- No `included:`, `set-aside:` or `unasked:` line printed: this project's own record is the bad one, and it cannot list its children. Take every joined child as included for the cascade, ask nothing and write nothing. The root scan takes `--children none` and the close says the children were not read, naming the line.
- Any of those lines printed: the bad record is a child's or a grandchild's. Follow sections 2 to 4 on the lines printed. The child with the bad record keeps the state its own line shows, and no project below it is listed. The close names the `!!` line.

## 2. The ask - only on `unasked:` lines

ONE ask about the `unasked:` children. An included or a set-aside child is never asked again here. `<n>` is their count.

```ask
<n> joined child(ren) were never asked about: <the unasked rels>. Which does this project work on?
- 'Include the <n> new one(s) (Recommended)' - each is read, scanned and updated by this project, as before
- 'Pick which to include' - up to 4 multi-select questions list them; the ones picked are included, the rest are set aside
- 'Set them aside' - this project leaves them alone: each stays joined and keeps what it has, and nothing of it is read, scanned or updated here
```

'Pick' groups the children in 2 to 4 options a question, never a group of 1. The answer is ONE call, either flag left off
when its list is empty, its lines pasted:

```bash
node "$TMP/repo/scripts/workspace.js" include --root . --include <csv> --set-aside <csv>
```

Whenever nobody answers - no ask tool, or an `unattended: on` line - take 'Include the new ones' and write nothing: the
next attended walk asks again. The stack's auto-run answers none of it.

With no `unasked:` line, ask nothing. Say in one line which children are included and which are set aside, and that
`/alfred-code:configure` changes it.

## 3. Detection and the scans

- Detection reads `.`, the folder of every `included:` and `unasked:` child, and each `below:` folder under those children.
  The report names the folder per stack, as `web-angular (app: angular.json)`.
- A set-aside child is not read. One report line each: `set aside <rel>`.
- The root scan carries `--children`. `<csv>` is every `included:` and `unasked:` rel, and `none` is the value when there
  is none. The scan reads the projects below each child by itself. `--children none` reads this project's own files only.
  Validate's own call keeps its `--judgment` flag beside it.

```bash
node "$TMP/repo/scripts/scan-evidence.js" --root . --catalog "$TMP/repo/meta/evidence.json" --children <csv|none> --out "$TMP/found.json"
```

- `--redundant`, `--missing` and `--evidence-gaps` take the stacks of this project, of the included children and of the
  projects below them.

## 4. What a set-aside child keeps

A root's drop can take an item a set-aside child still uses. So while a child is set aside, every row of the removal set
shows `kept for <rels>` (the set-aside children): REDUNDANT rows, accepted JUDGMENT-DROP rows and configure's drop lines. A
migration (retired) row is never kept. It goes everywhere and shows no marker.

On a yes, record the keep ONCE per item, before the root's apply:

```bash
node "$TMP/repo/scripts/workspace.js" include --root . --keep '<category> <name>'
```

It prints `include: kept <category> <name> for <rel>` per child, `include: <rel> ignores <category> <name> - not kept` for
a child that never had the item, or `include: no child set aside`. The installer backs the walk up: where a root drops an
own pick that a set-aside child neither ignores nor has a keep line for, the installer keeps it and writes the line itself.
So this call is a cross-check, not the only guard.

The installer's own output may carry `kept lines of <rel> rewritten: ...`. It means the run rewrote the kept lines in a record at or below this project (a rename mapped, a line pruned, a backstop line added). The close names each `<rel>`.

A `!!` line from the call: paste it and take that item out of this run's drop set. The close says
'`<category> <name>` stays at the root: its keep was not written'.

At a user-scope root, a plugin drop is a user-scope disable that reaches a set-aside child at once, and a keep line cannot
hold it. Take each plugin row that shows `kept for <rels>` out of the drop set. The close says
'plugin <name> stays on at user scope: <rel> uses it'.
