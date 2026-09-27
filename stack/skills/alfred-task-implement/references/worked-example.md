# A worked build

Read before the first task of a session's first plan - three tasks taken to DONE, then the finish, and the report it ends on.

## Example

Executing the records-list export plan (the `alfred-task-design` example, gated by `alfred-task-verify-plan` - three tasks, plus the audit's cancellation fix folded into Tasks 1-2):

- Task 1 - jump to the plan's query-seam anchor, add the export projection + its streaming test (rows streamed, never materialized - the card's trap), thread the cancellation token per the audit. Module tests green, output quoted. DONE.
- Task 2 - the streamed export entry point on the Task 1 seam, mapped to a transfer shape at the edge (the card's boundary trap). Tests green. DONE.
- Task 3 - integration test: header row, one data row, success status, and the audit's empty-set shape. Green on the full suite. DONE.
- Finish - full suite once, `alfred-task-verify-code` over the assembled diff (one finding: a stray debug log - fixed), done-gate run.

```text
task 1 export projection | DONE | module tests green (streamed, cancellation threaded)
task 2 streamed endpoint | DONE | tests green (edge maps to transfer shape)
task 3 integration test  | DONE | full suite green incl. empty-set shape
suite + verify-code: green, 1 finding fixed; nothing deferred
```
