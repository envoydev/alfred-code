# Rules audit - Phase 1b currency check

Read at Phase 1b, before any row drives a score or an edit.

Rules are thin, but their glob lists and the few framework claims they carry (file shapes, tool names) are still claims about the outside world. Training-data recall drifts, so these claims are verified against current
documentation through the documentation MCP - never re-asserted from memory. This check changes no
dimension weights (scores stay comparable across audit runs); like the other set-level defects,
an unresolved DRIFTED finding blocks the artifact from A.

1. **Inventory** while scoring Phase 1: collect every externally-verifiable claim - a named
   package or library, a version floor, an API call inside a code example, a config or CLI
   syntax block, a deprecation or 'X does not support Y' statement, a best-practice claim
   attributed to a library's documentation. A documented harness behaviour the mechanism facts above rely on - how `.claude/rules/` files load, that CLAUDE.md can carry compaction instructions, what `disable-model-invocation` blocks, the effort and model defaults - is an external claim too: check it against the official Claude Code docs pages (best practices, memory, costs, hooks) each run, since those pages move between releases - the rules feature itself arrived around v2.0.64, path-scoped loading was fixed across v2.1.198-v2.1.239, `/doctor` trims arrived in v2.1.206, and the brace-expansion budget, the compaction reload behaviour, `claudeMdExcludes`, the hook exit-code and `permissionDecision` semantics and the `InstructionsLoaded` event are all version-tied, so each one this audit states is re-read from the live page before it drives an edit. Expect few claims per rule; an empty inventory is a valid result - record it and skip the lookups.
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
