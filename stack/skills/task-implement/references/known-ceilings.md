# Known ceilings - filing the rows at the close

Read at the finish, before the close report, when this build made a deliberate simplification. Each
one is a `where | limit | revisit when` row, never a code comment.

`node .claude/hooks/docs.js show architecture/ARCHITECTURE.md#known-ceilings` for the rows already there and `docs.js hash` of the same ref (both report it absent the first time), then pipe the whole section - `## Known ceilings`, a `<!-- covers: -->` line naming every row's file, the table with the new rows appended - into `docs.js set architecture/ARCHITECTURE.md#known-ceilings --expect <that hash>` (no `--expect` the first time). The covers line makes `docs.js where` show the ceiling to the next session on that code, and `docs.js stale` flag it once the code moves. A build that LIFTED a row already there rewrites that row's `revisit when` cell to `lifted in <short sha or this change>` in the same set, and `docs.js ceilings --prune` then moves it to history. No `architecture/` under the docs root: the rows stay in the close report, and the close says so.
