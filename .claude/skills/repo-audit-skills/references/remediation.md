# Skill audit - Phase 2 remediation

Read before the first edit. The anti-gaming guards at the end override the grade target.

Work set-level defects first, before the per-skill loops. Break every invocation cycle structurally - remove the unsanctioned dispatch edge, or make the re-entrant skill manual-only - never with a prose depth counter; resolve every contradiction by deciding which skill owns the behavior and rewriting the loser to defer (by name where the winner is guaranteed alongside it, by description otherwise), or, where the repo does not decide the winner, leave both, flag it prominently, and mark both skills blocked. Then resolve cross-skill duplication, still at the set level - duplication fixes touch several skills at once, so doing them before the per-skill loops stops you from polishing a body you are about to delete. For each cluster in the duplication map:

- Snapshot every skill in the cluster.
- Resolve the cluster without breaking self-containment: keep a self-contained copy in every skill that operationally needs the content and register the set in `meta/shared-rules.json` (owner + sites, marker-pinned), or give the narrower skill ownership and have the others delegate to it - by name only where the same install unit guarantees it, by describing what it covers otherwise. Never a cross-skill file pointer.
- Align the copies (or replace them with the delegation) and confirm each affected skill still reads and behaves the same.
- Re-score every skill in the cluster on Dimension 4 (and any dimension the edit touched).

Then, for each skill still scoring below A / 9, run this bounded loop:

1. Snapshot the skill directory before the first edit.
2. Rank the dimension deductions by points lost. Fix the largest first.
3. Apply the smallest edit that removes the deduction. Examples:
   - Vague description: rewrite it to state what plus when, add real trigger phrases, add a when-not-to-use clause for the near-misses you can identify from the skill's own scope.
   - Bloated body: move optional or heavy detail into `references/`, collapse restated rules, delete filler. Deleting weak content raises the token score; do not replace it with different filler.
   - Disorganized references: reorganize the reference layer into one topic per file with descriptive names and a hierarchy that mirrors the workflow, add tables of contents to long files, and move each citation in the body to the step that actually uses it.
   - Duplicated content that survived the set-level pass: resolve it the set-level way - register the self-contained copies or delegate to the owning skill - never with a cross-skill file pointer. Do not re-solve the same duplication in two places.
   - Named cite of a skill or MCP server the install can lack: replace the name with what it covers plus the nothing-matches path; never a guard phrase beside the name, and never a description the catalog cannot match.
   - Rigid rule wall: attach the reason to each rule, or fold redundant rules together. Keep safety and privacy rules verbatim.
   - Missing examples or output template: add one concrete, correct example drawn from the skill's real domain.
4. Re-score the skill from scratch against the rubric with fresh eyes. Do not carry forward the previous score.
5. Repeat until the skill reaches A / 9 or you hit `MAX_ITERATIONS` or a pass produces no material score gain.

## Anti-gaming guards (hard invariants)

These override the goal of reaching A / 9. If reaching A would require breaking one of these, stop and report the skill below A with the blocker instead.

- Behavior preservation. Before editing, write 2-3 realistic prompts the skill should handle. Mentally (or via a subagent, if available) run the skill on them before and after your edits. The produced outputs must match. An edit that changes outputs is a regression, revert it.
- Preserve stated narrowness. If the author intentionally scoped triggering narrowly (for example, fire only on an exact keyword), do not broaden the description to farm the triggering score. Narrow-by-design is correct, not a defect.
- No keyword stuffing. The description must read as something a person wrote. Padding it with synonyms and unrelated terms to look more triggerable is a deduction, not a gain, even if it would pass a naive matcher.
- No padding for completeness. Adding boilerplate sections so a skill looks thorough directly regresses token efficiency. Length is a cost, not a virtue.
- No structure theater. Splitting content into many reference files, or adding hierarchy and tables of contents that nothing needs, does not raise the structure score. Structure must reduce a real reader's navigation cost, not simulate rigor.
- Preserve guardrails. Never delete safety, privacy, language, or formatting rules to save tokens. If a rule is load-bearing, it stays even if it costs points elsewhere.
- No fabricated examples. Examples must be correct for the skill's actual domain. A plausible-looking wrong example is worse than none.
- No over-abstraction for the reuse score. Extract shared content only when it is substantial and genuinely identical. Factoring a one-line rule into a shared file couples skills for no real saving and makes each skill harder to read on its own. When in doubt, keep small overlaps local.
- Do not break packaging in the name of reuse. A skill that now depends on a shared file must name that dependency, so it can still be understood and moved on its own. Silent coupling is a defect.
- Honest scoring. If a skill genuinely cannot reach A without violating a guard, report its real grade and the blocker. Do not declare A you did not earn.
