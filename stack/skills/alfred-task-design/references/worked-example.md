# A worked design

Read before the first design of a session - one brief taken to a fit verdict and three task cards.

## Example

Brief: 'Add data export to the records list.'

Plan (single-chat output):
- **Fit - extend an existing seam.** The records module already owns the read paths and an export is another read projection, so no new boundary. Forcing edge: the export must not pull the full object graph, so it reads through the existing query-projection seam, never the raw persistence surface.
- **Task 1** - add the export projection to the query seam and its implementation. Trap: stream the rows, never materialize the full set (the stack skill's unbounded-result trap). Anchor: the located query seam (`file:symbol`).
- **Task 2** - add the export entry point returning a streamed response. Trap: map to a transfer shape at the edge, never the persistence entity (the stack skill's boundary trap). Anchor: the located edge (`file:symbol`). Log points: the export's outcome at the entry point - information with the row count and the request's correlation id, error with the exception on a mid-stream failure; the framework's request log already covers the start, so nothing at the projection seam.
- **Task 3** - an integration test asserting the header row, one data row, and the success status. Anchor: the located test suite.
- **Decisions** - the export streams through the framework's own writer, not a new package - precedent: the existing report download (`file:symbol`). No row ceiling: no precedent - decided, the projection already streams.

Then gate with `alfred-task-verify-plan`, build each task with `alfred-task-implement` under the stack's house skills, and review with `alfred-task-verify-code`.
