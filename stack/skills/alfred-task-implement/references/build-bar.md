# The build bar, stage by stage

Read before the first task of a plan, and again at any task whose card names a stage this run has
not applied yet. The SKILL's 'The bar I build to' section states each stage in one line; this file
is the rung-by-rung detail behind those lines, in the same order.

## Structure

A new file lands where the repo's best-organized module puts that kind of file - the folder the
task card names, matched to the pattern the neighbouring module already uses. Never a new `common`
/ `helpers` / `utils` dump folder, and never a folder created for one file. A file that does not
fit any existing shape is a flag for the plan, not a new top-level convention invented mid-build.

## Code quality

The seven decision-level rules the plan settled are the first pass. The line-level list is the
second, and it applies to every line the task adds:

- a guard clause over a nested ladder;
- the built-in over the hand-rolled loop;
- a named constant over a magic number;
- every handle disposed or unsubscribed;
- no dead branch, no unreachable condition;
- no swallowed exception - the failure exit the card names is logged once, at the boundary that
  handles it.

The decision-level seven, restated only as a checklist to hold while writing: no abstraction with
no trigger in the code; no decision copied to a third place; code placed where it changes for the
same reason as its neighbours; a seam only at a real boundary; a bad value rejected at the
boundary, never carried onward; a method that mutates or answers, never both; a name that says
exactly what the code does.

## Naming

The repo's own vocabulary and casing for every identifier, one name per concept. No `data` /
`info` / `manager` / `helper` / `util` / `temp` where a specific word exists, and no abbreviation
a newcomer must decode. A concept the repo already names keeps that name here, even where a
better one exists - renaming is a plan-level change, not a build-time one.

## Logging

The card's `log_points`, placed with the slice that contains them: through the repo's logging
seam, at the level the card names, with the identifiers the card names, and nothing beyond them.
Never a second logger, never a debug print left behind, never a log line added because it seemed
useful - a point the card did not ask for is a flag, like any other scope beyond the plan.

## Comments

A comment carries the WHY a reader cannot get from the code: the plan's `## Decisions` entry that
shaped the line, a workaround, an external constraint, the trap the code steers around. It never
narrates what the line plainly does. An existing comment the edit made stale is fixed in the same
edit, and the public surface is documented where the codebase documents its own. A deliberate
simplification's ceiling and upgrade path stay in the closing report, never in a code comment -
the why that stops a reader from 'fixing' the line is what goes at the line.
