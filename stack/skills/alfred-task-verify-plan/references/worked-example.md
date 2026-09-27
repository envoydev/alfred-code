# A worked audit

Read before the first audit of a session - the five passes on one plan, one line each, and the verdict they add up to.

## Example

Auditing the `alfred-task-design` export plan ('add data export to the records list' - three tasks: a query projection, a streamed export endpoint, an integration test), one line per pass:

```text
1 risk      | MAJOR | no task names cancellation on the streamed export - a client abort leaks the open reader | thread the stack's cancellation mechanism through Tasks 1-2 (its skill's trap list)
2 scope     | MINOR | Task 2 adds an export-format option the requirement never asked for | drop it
3 existence | pass  | every symbol, package and config key the plan names resolves in the repo
4 edges     | MAJOR | empty result set unspecified - header-only output or an error?    | name the expected shape in Task 2; assert it in Task 3
5 soundness | pass  | extends the existing query seam, tasks in dependency order, smallest plan
```

Verdict: fix the plan (2 MAJOR), re-check the two lines, then build.
