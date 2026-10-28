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

## The children too, or only this project - ONE ask

Asked whenever a project below would run: the plan names a second project, or a `rescan:` row (counted as if joined);
a plan whose only rows below are `gone:` asks nothing and runs the cascade, which only removes their lines. `<n>` is
the plan's count less this project, plus the `rescan:` rows. In the same AskUserQuestion call as step 2's own asks
while it holds fewer than four questions, else a call of its own right after. The scope ask and the join ask go in one
call, the scope ask first; when step 2's own call has no room for both, they take a call of their own right after. When
a child row carries its own asks:

```ask
Update the <n> project(s) below this one as well? <each project: its rel and its asks, in a few words>.
- 'Yes, their questions the recommended way (Recommended)' - each child updates now, top-down; each ask takes the Recommended option its own update would offer
- 'Yes, I pick per project' - each child updates now; one question per ask next, headed with the project, its own options
- 'Yes, their questions left for later' - each child updates now; nothing is passed, each offer stays an offer, asked again at that project's own update
- 'No, only this project' - nothing below runs; each keeps its set until it is updated
```

When no child row carries one, the question offers the two ends:

```ask
Update the <n> project(s) below this one as well? <each project's rel>.
- 'Yes, update them too (Recommended)' - each child updates now, top-down, from this project's new set
- 'No, only this project' - nothing below runs; each keeps its set until it is updated
```

A held child reads this project's new set at its own next update, so the cascade is the default, not a duty.
On 'No, only this project', record it now, in step 2, and write no child's answers:

```bash
node "$TMP/repo/scripts/workspace.js" answer --file "$TMP/answers.json" --hold
```

The Recommended answer per ask: `data-move: offer` -> `--data-move move`; `docs-move: offer` -> `--docs-root-move move`;
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

## Projects installed below - on `rescan:` rows

```ask
Join these installed projects as children of this one? <each rescan: rel>. Each then takes this install's set and keeps its own picks.
- 'Join as children (Recommended)' - each join is written now, and the cascade below updates them unless the scope ask's answer was 'No, only this project'
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
