# Skill audit - Phase 1b currency check

Read at Phase 1b, before any row drives a score or an edit.

Skill bodies and their references/ carry claims about the outside world - packages, version floors, API syntax in examples, deprecation statements. Training-data recall drifts, so these claims are verified against current
documentation through the documentation MCP - never re-asserted from memory. This check changes no
dimension weights (scores stay comparable across audit runs); like the other set-level defects,
an unresolved DRIFTED finding blocks the artifact from A.

1. **Inventory** while scoring Phase 1: collect every externally-verifiable claim - a named
   package or library, a version floor, an API call inside a code example, a config or CLI
   syntax block, a deprecation or 'X does not support Y' statement, a best-practice claim
   attributed to a library's documentation. A documented harness behaviour the mechanism facts above rely on - how `.claude/rules/` files load, that CLAUDE.md can carry compaction instructions, what `disable-model-invocation` blocks, the effort and model defaults - is an external claim too: check it against the official Claude Code docs pages (best practices, memory, costs, skills) each run, since those pages move between releases - for skills that means the listing cap (1,536 official, 250 per entry claimed by a community source), the `paths` semantics, the compaction re-attach budget, live change detection and the scope precedence, each re-read from the live page before it drives an edit. For references/, sample the files the body cites at load-bearing steps rather than sweeping every reference exhaustively.
2. **Prioritize** what a release can invalidate: version-named claims, code examples that call
   library APIs, deprecation/support statements. House judgment (strategy, conventions,
   tradeoffs, forbidden patterns) has no external truth to check - skip it.
3. **Verify, bounded**: group the claims by library; per library, one `resolve-library-id` plus
   at most 2-3 `query-docs` calls covering the whole batch. Cap ~15 libraries per run - the long
   tail rolls to the next audit and is listed as unchecked. Documentation server unreachable: mark the whole
   check SKIPPED in the report and move on; never substitute recall for the lookup.
4. **Verdict per claim**: CURRENT (docs agree) | DRIFTED (docs contradict - a MATERIAL finding)
   | UNVERIFIABLE (docs silent - recorded, not a finding). Record the table (library, claim,
   verdict, evidence line) in the baseline report.
5. **Remediation routing** for DRIFTED: fix it in Phase 2 - and when the drifted content is
   version-coupled detail (an API sample, a per-release config block), prefer REPLACING it with
   the durable policy plus a fetch-at-use pointer (the documentation server at usage time) over updating the
   number: judgment stays in the artifact, drifting facts are fetched live.
