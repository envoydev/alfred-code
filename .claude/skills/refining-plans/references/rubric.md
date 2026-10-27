# Rubric for plans, designs, and specs

## Scoring

- 7 criteria with 4 binary checks each, 28 checks in total.
- Points for a criterion = weight x checks met / 4. The total is the sum, rounded to the nearest integer.
- A check is met only with quoted text or a section reference from the artifact. N/A counts as met only where a check says N/A allowed and the reviewer gives the reason.
- An open BLOCKER caps the total at 60.
- A score of 100 requires all 28 checks met with evidence, graded by an independent reviewer.

## Bands

- 90-100: an agent can execute it as written, and the residual risks are named.
- 75-89: fixable gaps, such as a missing decision or section.
- 60-74: needs significant rework before anyone acts on it.
- Below 60, or any BLOCKER: do not act on it.

## C1 Correctness and soundness (20)

- C1.1 The approach achieves the stated goal, and no step contradicts another step or a constraint in TASK.
- C1.2 Claims about existing code, APIs, libraries, or data are accurate, checked against the repository where accessible.
- C1.3 At least one credible alternative is named, with the reason it was not chosen.
- C1.4 Edge cases intrinsic to the problem (empty or large input, concurrency, partial failure) are handled or explicitly ruled out.

## C2 Risk and failure modes (15)

- C2.1 Names risks specific to this approach, not generic ones.
- C2.2 Every high risk has a mitigation or a detection mechanism.
- C2.3 States the trade-offs, meaning which qualities (performance, cost, complexity) get worse because of the choice.
- C2.4 Covers security, data integrity, and backward compatibility, or states with a reason why each does not apply.

## C3 Verifiability (15)

- C3.1 Defines done as concrete, checkable acceptance criteria.
- C3.2 Names the tests or checks (unit, integration, e2e, manual) that prove each key behavior.
- C3.3 Each step or milestone has a verification point before later steps depend on it.
- C3.4 Success is observable after rollout (metric, log, alert). N/A allowed if nothing runs in production.

## C4 Scope fit (15)

- C4.1 Covers every explicit requirement in TASK.
- C4.2 Work the TASK does not name sits in a `## Optional` list, each line marked `Recommended - <reason>` or `Not worth it - <reason>`; an extra the TASK asks for is in scope.
- C4.3 States non-goals or out-of-scope items.
- C4.4 The solution is sized to the problem, with no new framework or abstraction where a local change suffices.

## C5 Assumptions and dependencies (10)

- C5.1 Lists the assumptions that would change the plan if false.
- C5.2 Lists external dependencies (services, packages and versions, teams, flags, migrations).
- C5.3 Marks unverified assumptions and says how to verify them.
- C5.4 Makes ordering dependencies between steps explicit.

## C6 Reversibility and rollout (10)

- C6.1 States how to roll back or disable the change.
- C6.2 Identifies irreversible steps (data migrations, deletes, public contract changes) and gates them. N/A allowed if there are none.
- C6.3 Rolls out incrementally where the risk warrants it (flag, phases, canary). N/A allowed for low-risk local changes.
- C6.4 Names the condition that would trigger revisiting the decision.

## C7 Clarity and actionability (15)

- C7.1 An agent could start the next step without asking a question.
- C7.2 Steps name concrete files, components, or interfaces, not vague areas.
- C7.3 No ambiguous wording (should, maybe, TBD, etc.) in load-bearing places.
- C7.4 Steps are ordered, each with one clear outcome.

## Severity

- BLOCKER: as written, the plan fails its goal, corrupts or loses data, breaks a contract, opens a security hole, or cannot be executed.
- MATERIAL: the plan works but at a real cost (rework, outage risk, performance, maintenance burden), or it depends on a decision the author cannot make alone.
- MINOR: polish. List only when there is no BLOCKER or MATERIAL, at most 3.
- A finding whose fix adds work the TASK does not name is neither BLOCKER nor MATERIAL unless the request cannot be met safely without it; its fix is an `## Optional` line.
- Every finding states failure mode, trigger condition, cost, evidence, and a one-line fix. A finding missing any of these is discarded.

## Caps

- BLOCKER: all of them.
- MATERIAL: up to 5 in full, then extras as one line each.
- MINOR: up to 3, only when there is no BLOCKER or MATERIAL.
- Positives: up to 3, one line each, and each must name the obvious alternative it beats. Zero is valid.

## Maintenance

Tune weights or checks only between runs, never during a loop. Revisit the rubric if artifacts that passed still fail during implementation.
