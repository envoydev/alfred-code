# Rules audit - Phase 2 remediation

Read before the first edit. The anti-gaming guards at the end override the grade target.

Work the system-level defects first, in this order, before touching any individual file. Conflicts and mechanism errors change which files survive, so fixing them first stops you from polishing text you are about to delete or relocate.

## Step 1 - Resolve conflicts

For each conflict in the conflict map: decide which instruction wins, based on tier precedence and on which one the repo's actual code follows. Remove or rewrite the loser. Where you cannot determine the intended winner from the repo, do not guess: leave both, flag the conflict prominently in the report as unresolved, and mark both files as blocked from A. A silently wrong resolution is worse than a reported conflict.

## Step 2 - Correct mechanisms

For each rule the mechanism map classified as misplaced: move it to the mechanism it belongs in.

- Deterministic must-run step: propose a hook. Write the hook if the repo already has a hooks setup and the event is unambiguous; otherwise emit it as a concrete recommendation with the event and command specified, and leave the prose rule in place until the hook exists. Never delete the prose rule before its replacement is real, because that silently drops the constraint.
- Hard block on a tool, command, or path: propose a `permissions.deny` entry, under the same do-not-delete-before-it-exists condition.
- Repeatable multi-step procedure: move it into a skill, and replace the rule with a one-line pointer or delete it if the skill fully subsumes it. Any skill you create must itself meet the bar of the `repo-audit-skills` rubric (grade A), or do not create it.
- Path-specific guidance: move it into a `.claude/rules/` file with a `paths` glob, and verify the glob matches the files it is meant to govern.
- Content that belongs nowhere: delete it and record what was deleted and why.

## Step 3 - Resolve duplication

For each cluster in the duplication map: pick the single home, replace the copies with a pointer (named where guaranteed, described otherwise) or delete them, and confirm each affected file still governs the same behavior. Use symlinks for rules genuinely shared across projects. Use an `@AGENTS.md` import instead of a restated copy.

## Step 4 - Per-file loop

Then, for each file still scoring below A / 9, run this bounded loop:

1. Snapshot the file before the first edit.
2. Rank the dimension deductions by points lost. Fix the largest first.
3. Apply the smallest edit that removes the deduction. Typical fixes: rewrite a vague rule into a verifiable one; add a `paths` glob to a rule that only applies to a subset; move individual preference out of a shared file into local or user scope; cut lines that change no behavior; add the reason to a bare imperative; convert maintainer commentary into stripped HTML comments; replace a named cite of a skill or MCP server the install can lack with what it covers plus the nothing-matches path, never a guard phrase beside the name; reorganize a grab-bag file into one concern per descriptively named file, moving each rule to the file a reader would predict, and regroup within-file content under headers ordered by importance or workflow.
4. Re-score the file from scratch against the rubric with fresh eyes. Do not carry forward the previous score.
5. Repeat until it reaches A / 9, or you hit `MAX_ITERATIONS`, or a pass produces no material score gain.

## Anti-gaming guards (hard invariants)

These override the goal of reaching A / 9. If reaching A would require breaking one of these, stop and report the file below A with the blocker instead.

- Imports are not deferral. Moving content into an `@path` import does not reduce context, because imports load at launch. Do not shrink a file's line count by pushing content into an import and then claim a token-efficiency gain. The only real deferrals are `paths` globs and skills. This is the single most likely way to fake a good score on this rubric, and a fake gain here is a scoring failure, not a pass.
- Never drop a constraint to save tokens. A rule may only be deleted when it changes no behavior, is duplicated elsewhere, or has been genuinely replaced by a hook, permissions entry, or skill that now exists. Deleting a live constraint because it was expensive is a regression, however good the token score looks afterward.
- Do not weaken enforcement. Never convert a hook or a `permissions.deny` entry into prose, and never remove a stop condition or a safety, security, or compliance rule. Managed-policy content is fixed: it cannot be excluded by individual settings, so do not relocate or trim it.
- Do not invent targets. A rule may only point at a skill, agent, hook, or file that exists in the discovered catalog or that you create and verify in this run - and a described target must match at least one real catalog entry, or it is a dangling name in disguise. A pointer to a nonexistent skill is a broken instruction layer, worse than the duplication it replaced.
- Do not silently change coverage with globs. Narrowing a `paths` pattern reduces the tokens a rule costs and also reduces what it governs. That is a behavior change, not an optimization. Narrow a glob only when the rule genuinely does not apply to the files you are excluding, and say so.
- Preserve intended tiering. If the author deliberately put something in local or user scope, do not promote it to project scope to make the project file look more complete.
- No padding for completeness. Adding boilerplate sections so a rule set looks thorough directly regresses the dimension that matters most here. Length is a cost paid every session.
- Honest scoring. If a file cannot reach A without violating a guard, report its real grade and the blocker. Do not declare an A you did not earn.
