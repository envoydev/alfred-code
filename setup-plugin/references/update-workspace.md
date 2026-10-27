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
- Indented under a row, that project's own asks, as its own update would print them: `data-move: offer`,
  `docs-move: offer`, `instructions-file: ... update=ask*`, `instructions-both: ask`, `workspace: role-ask <case> <rel>`.
- `gone: <rel>` - a listed child folder that no longer holds an install; the cascade removes its line.
- `rescan: <rel>` - with `--rescan`, an installed project below with no parent line.

Show the project rows in your message as one table - project, scope, version, adds, drops, its asks - before any ask.

## The children's asks - ONE ask, only when a child row carries one

In the same AskUserQuestion call as step 2's own asks while it holds fewer than four questions, else a call of its own
right after:

```ask
Answer each project's own questions the recommended way? <each project: its rel and its asks, in a few words>.
- 'Take the recommended (Recommended)' - each ask takes the Recommended option its own update would offer
- 'Pick per project' - one question per ask next, headed with the project, its own options
- 'Leave them all' - nothing is passed: each offer stays an offer, asked again at that project's own update
```

The Recommended answer per ask: `data-move: offer` -> `--data-move move`; `docs-move: offer` -> `--docs-root-move move`;
`instructions-file:` -> the name template `instructions-place.md` names for its `update=` verdict, its Recommended value
as `--instructions-file agents|claude` (`update=ask-local` passes none); `workspace: role-ask` -> the first `ask:` line of
`node "$TMP/repo/scripts/workspace.js" role --root <rel> --when update`, its answer run now as `node
"$TMP/repo/scripts/workspace.js" role --root <rel> --answer <answer>`, never through the answers file. A child's
`instructions-both: ask` is the walk's one account question: ask it once and pass every such project as its own
`--root` to the one `account-instructions` call. 'Pick per project' opens ONE AskUserQuestion call of up to four
questions, one per ask, each option the walk's template for that ask; more asks take a second call.

Write each project's answers with ONE call per project, never a hand-written JSON:

```bash
node "$TMP/repo/scripts/workspace.js" answer --file "$TMP/answers.json" --project <rel> -- <flag> <value> [<flag> <value> ...]
```

A `!!` line means the flag or value was refused and the file is as it was: ask that one again. Unattended, take the
Recommended option for every ask, `update=ask-local` excepted, as the walk does.

## Projects installed below - on `rescan:` rows

```ask
Join these installed projects as children of this one? <each rescan: rel>. Each then takes this install's set and keeps its own picks.
- 'Join as children (Recommended)' - each join is written now, and the cascade below updates them
- 'Leave them standalone' - nothing is written; the next --rescan lists them again
```

'Join as children' runs `node "$TMP/repo/scripts/workspace.js" join --root <rel> --answer join` for each `rescan:` row,
before the cascade; a `!!` line names one that could not join, and the rest still do.

## The cascade - after this project's own installer run

Right after step 3's installer call (the slow path's step 5 on that path) and before the close, ONE call with
`timeout: 600000` (each child is one installer run):

```bash
node "$TMP/repo/scripts/workspace.js" cascade --root . --source "$TMP/repo" --answers "$TMP/answers.json" > "$TMP/cascade.txt" 2>&1
```

Each row reaches `$TMP/cascade.txt` as its project finishes. A cascade that outruns it comes back BACKGROUNDED and
keeps running: never start it again (two cascades would update the same children at once). Wait for its completion
notice, then go on.

It updates every child top-down at its own scope, each from its parent's fresh read-back, with that project's answers
and `--keep-pins`. A failed project skips everything below it, a child that does not name its parent back is skipped
with one `!!` line, and a `gone` child's line comes out of its parent. No answers file is the same as no answers.
When this project's own run printed `step(s) reported a failure above`, skip the cascade and say each child keeps its
set until the next update. Never re-run a failed child by hand from here: `/alfred-code:update` in that folder is its
own walk. The close reads `$TMP/cascade.txt` (`update-close.md`, step 7).
