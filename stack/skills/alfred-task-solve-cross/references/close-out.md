# Close-out - any mode

Read at the close, before the close report and its asks: the doc-drift line, what the run started, the pending sweep, the known-ceilings filing, the report shape, and the two close asks.

**Contents:** [The close, in order](#the-close-in-order), [The close report](#the-close-report)

## The close, in order

At close-out (any mode), add **doc-drift awareness** - one line at most, the user decides, never auto-run: a landed change that touched an architecture-critical surface (a schema/EF migration, a new module, a moved boundary, a new or revised seam - anything the contract protocol versioned this run - or a new external dependency) gets `/alfred-capture-architecture` named in the close report; substantial new code + tests with an absent or pre-change-stamped coverage doc gets `/alfred-capture-test-coverage` the same way. The close also names what this run started to build, test, or verify and still has up - a Docker container or compose stack, seeded integration-test data, a dev server, a background watcher - and puts tear-down-vs-keep through AskUserQuestion in the same close (teardown recommended for the disposable; `none` said plainly; what the run did not start is never touched).

An uncommitted diff is held for the user's review - a commit waits for their word (`baseline-git.md`), and a picked commit runs `alfred-habits-commit-checkpoint` whole, after the integration gate signed off (pilot 3: the recommended commit was taken 6 of 6 times, $6.36 across the flow block). The close's two questions, in one AskUserQuestion call:

```ask
The lanes landed and the final gate signed off; the diff is uncommitted. Hold it for your review first.
- 'Hold - review the diff first (Recommended)' - nothing is committed; the diff stays as it is
- 'Commit now' - runs `alfred-habits-commit-checkpoint` in full, then commits
```

```ask
This run started <what is still up>. Tear it down - nothing later in this run needs it.
- 'Tear it down (Recommended)' - stops only what this run started
- 'Keep it up' - it stays running for you
```

The close opens with a **pending sweep** - anything undecided or unlanded is named as its own line or ask option, never dropped at the session's end: an earlier ask still unanswered, unpushed commits (check the upstream), an undecided push, any gate still owed (a verifier not run, a review skipped - named in the user-facing text, never only in a private receipt), and any bug flagged this run but not fixed. A flagged-but-unfixed bug also goes into the ledger or task docs BEFORE any memory purge, so the purge cannot destroy its only record. Doc-drift covers contradictions too: a decision this run made that contradicts an existing architecture or assessment entry routes the same one line (update mode), and the drift line lands in the user-facing close, never only an internal note.

**Known ceilings.** File every `where | limit | revisit when` row a seat reported this run before the close: `node .claude/hooks/docs.js show architecture/ARCHITECTURE.md#known-ceilings` for the rows already there and `docs.js hash` of the same ref (both report it absent the first time), then pipe the whole section - `## Known ceilings`, a `<!-- covers: -->` line naming every row's file, the table with the new rows appended - into `docs.js set architecture/ARCHITECTURE.md#known-ceilings --expect <that hash>` (no `--expect` the first time). The covers line makes `docs.js where` show the ceiling to the next session on that code, and `docs.js stale` flag it once the code moves. No `architecture/` under the docs root: the rows stay in the close report, and the close says so.

## The close report

The close report itself has a fixed shape - one block, no re-pasted plans or ledgers:

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
