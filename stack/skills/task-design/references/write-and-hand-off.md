# Write and hand off - the in-chat close of a design

Read in THIS chat once the plan is settled. A dispatched designer seat never reads it: it has no
Write tool and returns the whole plan in its report, `Oriented:` line first.

## Write the plan file

Write the plan to `<docs-path>/superpowers/plans/<feature>.md` before handing off: the FILE survives
compaction and a fresh session, where the chat copy does not. Then verify the write, in the same turn:
`wc -l` the plan file (it exists and is not empty) and grep it for `Oriented:` and `Asked:` - the two
header lines `task-verify-plan` grades (a missing `Oriented:` MAJOR, a missing `Asked:` MINOR) -
plus one anchor from the first task, which proves the located `file:symbol` references survived the
write. Quote the three results. A plan nobody can find, or one missing a header, is a design run with
no output.

## Hand off

Gate the plan with `task-verify-plan` before building, build each task with
`task-implement` under the stack skill (a task the build proves wrong comes back here only
through that skill's user ask, never on its own), and review the built code with
`task-verify-code` (`task-solve` drives this whole chain with a user gate between every
step).

## Worked example

Brief: 'Add data export to the records list.'

Plan (single-chat output):
- **Fit - extend an existing seam.** The records module already owns the read paths and an export is another read projection, so no new boundary. Forcing edge: the export must not pull the full object graph, so it reads through the existing query-projection seam, never the raw persistence surface.
- **Task 1** - add the export projection to the query seam and its implementation. Trap: stream the rows, never materialize the full set (the stack skill's unbounded-result trap). Anchor: the located query seam (`file:symbol`).
- **Task 2** - add the export entry point returning a streamed response. Trap: map to a transfer shape at the edge, never the persistence entity (the stack skill's boundary trap). Anchor: the located edge (`file:symbol`). Log points: the export's outcome at the entry point - information with the row count and the request's correlation id, error with the exception on a mid-stream failure; the framework's request log already covers the start, so nothing at the projection seam.
- **Task 3** - an integration test asserting the header row, one data row, and the success status. Anchor: the located test suite.
- **Decisions** - the export streams through the framework's own writer, not a new package - precedent: the existing report download (`file:symbol`). No row ceiling: no precedent - decided, the projection already streams.

Then gate with `task-verify-plan`, build each task with `task-implement` under the stack's house skills, and review with `task-verify-code`.
