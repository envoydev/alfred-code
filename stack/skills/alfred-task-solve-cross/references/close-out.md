# Close-out - the ceilings filing and the report shape

Read at close-out, any mode, before the close report is written.

## Doc-drift - which capture a change names

One line at most, the user decides, never auto-run: a landed change that touched an
architecture-critical surface (a schema/EF migration, a new module, a moved boundary, a new or revised
seam - anything the contract protocol versioned this run - or a new external dependency) gets
`/alfred-capture-architecture` named in the close report; substantial new code + tests with an absent
or pre-change-stamped coverage doc gets `/alfred-capture-test-coverage` the same way. Contradictions
count too: a decision this run made that contradicts an existing architecture or assessment entry
routes the same one line (update mode). The drift line lands in the user-facing close, never only an
internal note.

## File the known ceilings

File every `where | limit | revisit when` row a seat reported this run before the close: `node .claude/hooks/docs.js show architecture/ARCHITECTURE.md#known-ceilings` for the rows already there and `docs.js hash` of the same ref (both report it absent the first time), then pipe the whole section - `## Known ceilings`, a `<!-- covers: -->` line naming every row's file, the table with the new rows appended - into `docs.js set architecture/ARCHITECTURE.md#known-ceilings --expect <that hash>` (no `--expect` the first time). The covers line makes `docs.js where` show the ceiling to the next session on that code, and `docs.js stale` flag it once the code moves. No `architecture/` under the docs root: the rows stay in the close report, and the close says so.

## The close report

One block, no re-pasted plans or ledgers:

```text
mode: <the recorded mode> | contract: <interface + version, or n/a>
lanes: <domain> - <what landed> - <SIGNED_OFF | PUNCH_LIST | BLOCKED>   (one line per lane)
final gate: <integration-reviewer verdict, or n/a for single-domain>
pending: <each undecided or unlanded item, or none>
leftovers: <what this run started and still has up, or none>
doc-drift: <the one line, or none>
ceilings: <rows filed under architecture/ARCHITECTURE.md#known-ceilings, or none>
memories purged: <names|none>
```
