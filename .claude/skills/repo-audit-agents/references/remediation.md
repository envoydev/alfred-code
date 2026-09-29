# Agent audit - Phase 2 remediation

Read before the first edit. The anti-gaming guards at the end override the grade target.

Work system-level defects first, before the per-agent loops. Break every invocation cycle structurally - drop the unsanctioned dispatch edge or tool grant, or make the re-entrant skill manual-only - never with a prose depth counter; resolve every cross-layer contradiction by deciding the owner and rewriting the loser to defer, or report it unresolved with the affected files blocked. Then resolve duplication, still at the system level - duplication fixes touch several files at once, so doing them before the per-agent loops stops you from polishing a body you are about to delete. For each cluster in the duplication map:

- Snapshot every agent in the cluster.
- Choose the home for the shared content:
  - Agent reimplements an existing skill: replace the inline steps with an instruction to use that skill - named where the seat's install unit guarantees it, described by what it covers otherwise - keeping only the agent-specific orchestration.
  - Agent restates a process or convention a rule or CLAUDE.md defines: replace the restated block with a named citation of the governing rule, keeping only what is genuinely role-specific.
  - Several agents inline the same procedure with no skill owner: extract a new skill for it, then have each agent invoke the new skill. Any skill you extract must itself meet the bar of the `repo-audit-skills` rubric (grade A), or do not extract it.
  - Agent-to-agent overlap with no skill or rule fit: move the shared text to one shared reference each agent cites, or let the narrower agent own it and the others delegate.
- Replace the copies with a short pointer to that home (named where guaranteed, described otherwise). Confirm each affected agent still reads and behaves the same.
- Re-score every agent in the cluster on Dimension 4 and any dimension the edit touched.

Then, for each agent still scoring below A / 9, run this bounded loop:

1. Snapshot the agent file before the first edit.
2. Rank the dimension deductions by points lost. Fix the largest first.
3. Apply the smallest edit that removes the deduction. Examples:
   - Vague routing description: rewrite it to state what plus when-to-delegate, add real cues, add a when-not-to-use clause for the sibling agents it collides with.
   - Generic persona: rewrite the opening of the system prompt to establish concrete domain expertise, the quality bar the agent enforces, and the expert-level checks it runs before returning. Every claim you add must be tied to a behavior; if it changes nothing the agent does, cut it.
   - Blanket tool access: replace an inherited-all grant with an explicit list of only the tools the body uses. Add a tool only if the body clearly needs it.
   - Unbounded autonomy: add explicit stop conditions, a loop bound, and a defined return contract to the caller.
   - Bloated body: move optional or heavy detail into a reference, collapse restated rules, delete filler. Deleting weak content raises the token score; do not replace it with different filler.
   - Duplicated content that survived the system-level pass: point to the skill, rule, agent, or reference that owns it. Do not re-solve the same duplication twice.
   - Named cite of a skill or MCP server the install can lack: replace the name with what it covers plus the nothing-matches path; never a guard phrase beside the name, and never an install edge (`suggests:` is removed - a need is proven by evidence or seeded per stack).
   - Rigid rule wall: attach the reason to each rule, or fold redundant rules together. Keep safety, privacy, and tool-restriction rules verbatim.
   - Missing examples or output contract: add one concrete, correct example drawn from the agent's real domain.
4. Re-score the agent from scratch against the rubric with fresh eyes. Do not carry forward the previous score.
5. Repeat until the agent reaches A / 9 or you hit `MAX_ITERATIONS` or a pass produces no material score gain.

## Anti-gaming guards (hard invariants)

These override the goal of reaching A / 9. If reaching A would require breaking one of these, stop and report the agent below A with the blocker instead.

- Behavior preservation. Before editing, write 2-3 realistic tasks the orchestrator would delegate to this agent. Mentally, or via a subagent if available, run the agent on them before and after your edits. The returned results must match. An edit that changes the result is a regression, revert it.
- No persona inflation. Expertise framing counts only when each claim maps to a check, a standard, or a refusal the agent actually performs. Adding superlatives, credentials, or 'you are the world's best X' preambles that change no behavior is padding and scores as a deduction, not a gain.
- Do not invent skills, rules, or references. An agent may only be pointed at a skill, rule file, or reference that actually exists in the discovered catalogs, or one you extract in this run and verify - and a described cite must match at least one real catalog entry, or it is a dangling name in disguise. An instruction to follow a rule that does not exist is a broken agent, worse than the duplication it replaced.
- Least privilege stays least. Never widen a tool grant to make an agent more capable or to dodge a stop condition. If the body genuinely needs a tool it lacks, add exactly that tool and say why.
- Preserve bounded autonomy. Never remove a stop condition or loop bound to make an agent look more autonomous. Autonomy without a stop is a defect.
- Preserve stated narrowness. If the author scoped routing narrowly on purpose, do not broaden the description to farm the routing score.
- No keyword stuffing. The description must read as something a person wrote.
- No padding for completeness. Adding boilerplate so an agent looks thorough regresses token efficiency. Length is a cost, not a virtue.
- No fabricated examples. Examples must be correct for the agent's actual domain.
- No over-abstraction and no silent coupling. Extract shared content only when it is substantial and genuinely identical, and every agent that depends on it must name it (or describe it, where the install can lack it).
- Honest scoring. If an agent cannot reach A without violating a guard, report its real grade and the blocker. Do not declare an A you did not earn.
