# CLAUDE.md audit - Phase 2 remediation

Read before the first edit. The anti-gaming guards at the end override the grade target.

Work the system-level defects first, in this order, before touching prose.

## Step 1 - Fix facts and conflicts

Correct every stale or wrong fact against the verified repository state. For each conflict in the conflict map, decide which instruction wins based on tier precedence and what the repo's code actually does, and remove or rewrite the loser. Where you cannot determine the intended winner, do not guess: leave both, flag the conflict prominently as unresolved, and mark the file blocked from A. A silently wrong resolution is worse than a reported conflict.

## Step 2 - Relocate misplaced content

For each block the mechanism map classified as misplaced: move procedures to skills, path-specific guidance to path-scoped rules, deterministic steps to hooks, hard blocks to permissions entries, and individual preference to local or user tier - under the same do-not-delete-before-the-replacement-exists condition as `repo-audit-rules`. Anything you create must meet the bar of its own family audit (skills `repo-audit-skills`, rules `repo-audit-rules`), or do not create it and leave the content in place with a recommendation instead. Respect the scope boundary: when running alongside `repo-audit-rules`, emit rule-file changes as recommendations for it rather than editing rule files yourself.

## Step 3 - Build the hub

Construct or repair the map: add a governing-rules section that names every unconditional rule file with a one-line framing, convert any `@import` of an auto-loaded rules file into a plain backticked reference, add the `@AGENTS.md` import where an AGENTS.md exists and is restated, and route procedures to their skills - by name where guaranteed, by what they cover otherwise; a named pointer at a skill or MCP server the install can lack is rewritten to a description, never given a guard phrase. Reorder sections into the predictable structure from Dimension 2.

## Step 4 - Resolve duplication

For each cluster in the duplication map: pick the single home, replace the copies with a link plus at most a one-line framing, and confirm the behavior is still governed.

## Step 5 - Per-file loop

Then, for each file still scoring below A / 9, run this bounded loop:

1. Snapshot the file before the first edit.
2. Rank the dimension deductions by points lost. Fix the largest first.
3. Apply the smallest edit that removes the deduction. Typical fixes: rewrite a vague instruction into a verifiable one; cut lines that neither change behavior nor route; move maintainer commentary into stripped HTML comments; tighten a section that restates what its linked rule already says down to the link and framing line; replace a named pointer at a skill or MCP server the install can lack with what it covers plus the nothing-matches path.
4. Re-score the file from scratch against the rubric with fresh eyes. Do not carry forward the previous score.
5. Repeat until it reaches A / 9, or you hit `MAX_ITERATIONS`, or a pass produces no material score gain.

## Anti-gaming guards (hard invariants)

These override the goal of reaching A / 9. If reaching A would require breaking one of these, stop and report the file below A with the blocker instead.

- Never `@import` an auto-loaded rules file. `.claude/rules/*.md` already load at launch; importing one duplicates its full content in context and pays for it twice. The hub links, it does not import. This is the most likely mechanical mistake on this rubric, and making it while chasing the linkage score is a scoring failure, not a pass.
- Imports are not deferral. Moving content into an `@path` import does not reduce context. Do not shrink a file's visible line count by pushing content into an import and claim a token-efficiency gain. The only real deferrals are path-scoped rules and skills.
- No link farming. The governing-rules map earns points for making the layer navigable, not for length. Listing every file with paragraph-long annotations recreates the bloat the hub exists to remove; one line of framing per rule is the ceiling.
- Never drop a constraint to save tokens. A line may only be deleted when it changes no behavior, is duplicated elsewhere, or has been genuinely replaced by a named mechanism that now exists.
- Never invent facts or targets. Every command must be verified against the repo, and every link must point at a rule, skill, agent, or file that exists in the discovered catalogs or that you create and verify in this run - and a described pointer must match at least one real catalog entry, or it is a dangling link in disguise. A confident wrong build command or a dangling link is worse than the gap it papers over.
- Do not weaken enforcement. Never convert a hook or permissions entry into prose, and never trim managed-policy content: it cannot be excluded by individual settings and is fixed.
- Preserve intended tiering. If the author deliberately put something in local or user scope, do not promote it to project scope to make the project file look more complete.
- No padding for completeness. Length is a cost paid every session.
- Honest scoring. If a file cannot reach A without violating a guard, report its real grade and the blocker. Do not declare an A you did not earn.
