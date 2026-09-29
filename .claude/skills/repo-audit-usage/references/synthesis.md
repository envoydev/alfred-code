# Usage audit - Phase B2 cross-session synthesis

Read after the last bundle has its audit file.

1. Cluster findings by defect, home or mechanism gap. A pattern across sessions outranks a one-off
   of equal severity: rank by severity, then frequency x measured cost.
2. Reconcile against the already-known list - recurred (the shipped fix did not hold: escalate),
   stayed fixed (validation), or new.
3. For each OPEN cluster, decide the smallest structural fix and its exact home, honouring the
   repo's invariants: one home per piece, mechanisms over prose, platform-neutral skill bodies, the
   shared-rules registry for multi-home text. Hunt the root fix that collapses a cluster before
   patching per finding - one severity flip dissolved a four-session bypass cluster.
4. Write `<AUDIT_DIR>/SUMMARY.md`: the rollup table (one row per session), the ranked cluster table
   with evidence counts, the OPEN punch-list grouped by stack home, the validation record, and the
   NOT-STACK observations fenced off from the punch-list. Four tables are mandatory beside it:
   **token economics** - per session and per project, total spend, avoidable share, and the top
   three drivers, plus the scorecard totals per project with their denominators (misses and tokens re-cached, expected rebuilds, compaction re-reads, build-dir reads, scoped / whole-suite runs, checked / all commits, unverified / all green claims, correction streaks beside short-after-long corrections, long answers / final answers, heavy / all seats) - copied from the `--json` dumps, the numbers a hook or rule change is read from after its observation week - closing with one cross-collection verdict on whether this stack wastes tokens and where; **effectiveness** - one row per session: landed (y/n, the artifact), commits checked / all, user corrections, green claims with no check, unheld stops; **stack surface** - one row per skill, agent, rule, hook and MCP that appears anywhere in
   the collection, with sessions seen, tokens attributable, conformance, and the misuse / non-use
   count, built from the analyzer's `inventory` block - one recursive run over the collection
   ROOT gives `installed in K of M sessions, used in N` per name and the never-used set per
   layer directly, resolving each session's installed set from its own cwd so a name a project
   never installed is not counted against it; never re-derive it by hand; and **generated docs** - per project, which captures exist, how often a session read them
   versus re-derived what they hold, and the measured cost of the re-derivation. A surface that
   never appears in any session is reported as unobserved with its install count, never as
   unnecessary - absence of evidence is not failure evidence.
