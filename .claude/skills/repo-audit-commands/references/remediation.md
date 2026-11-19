# Command audit - Phase 2 remediation

Read before the first edit. The anti-gaming guards at the end override the grade target.

Work set-level defects first, before the per-command loops:

- **Collisions and dead entries.** A command that shares its typed name with a skill or a sibling, or that the
  manifest never loads, is not fixed by an edit to its text: plan nothing for it, list the ways out (remove it, load
  it, rename it) as a candidate with what each changes for users, and mark it blocked.
- **Blocked edges.** Where a body tells the model to run a manual-only entry, rewrite the line so it names that
  entry to the user as the next step.
- **Duplication clusters.** Snapshot every command in the cluster. Move procedure into a script the commands call,
  where the repo already has that mechanism; otherwise keep a self-contained copy in each command that needs it and
  register the set in the repo's multi-home registry (owner and sites, marker-pinned). Re-score every command in
  the cluster on Dimension 4 and any dimension the edit touched. A new script is a code change with its own tests -
  plan it only where the repo's `notes` say commands may gain one in an audit; otherwise report it as a candidate.

Then, for each command still scoring below A / 9, run this bounded loop. A command already at A / 9 gets no loop edit: each deduction it keeps is scored, cited in the report and listed as not planned, with the reason 'at the target - the loop runs only below it'. The loop:

1. Snapshot the command file before the first edit.
2. Rank the dimension deductions by points lost. Fix the largest first.
3. Apply the smallest edit that removes the deduction. Examples:
   - Menu line that names the mechanism: rewrite the description to the outcome and the moment, key use first.
   - Hint and body disagree: change the hint to what the body reads. Change the body's reading only where the hint
     is what users already type and the body's behavior stays the same.
   - No path for an empty or malformed argument: add the step that asks, lists the choices or stops with the usage
     line, before the first write.
   - Ungated write: add one step that shows the plan and asks before applying. Never add a second confirmation to
     a flow that already has one.
   - Broad pre-approval: narrow `allowed-tools` to the calls the body makes. Every call the body makes must still be
     covered, or the user meets a prompt the command never had.
   - Unquoted or pasted argument: quote it at the call, or move it out of the pre-run line into a step the model
     runs after checking it.
   - Unbounded pre-run output: replace it with the bounded form of the same state.
   - Bloated body: collapse restated rules, delete filler, move the load-bearing rules up. Deleting weak content
     raises the cost score; do not replace it with different filler.
   - Model-startable command with side effects: add `disable-model-invocation: true` - and say in the report that
     the model can no longer start it.
4. Re-score the command from scratch against the rubric with fresh eyes. Do not carry forward the previous score.
5. Repeat until the command reaches A / 9 or you hit `MAX_ITERATIONS` or a pass produces no material score gain.

## Anti-gaming guards (hard invariants)

These override the goal of reaching A / 9. If reaching A would require breaking one of these, stop and report the
command below A with the blocker instead.

- Behavior preservation. Before editing, write 3 realistic invocations the command should handle - typical
  arguments, none, a malformed one. Walk the command through them before and after your edits: the steps taken and
  the writes made must match, apart from the gap the edit closes. An edit that changes anything else is a
  regression, revert it.
- The typed surface is fixed. No rename, no move between folders, no reordered or removed argument, no changed
  default - each goes to the report as a candidate.
- No conversion. A command is never turned into a skill folder, split or merged in the audit, whatever the fit
  score says.
- Preserve guardrails. Never delete a confirmation step, a 'never' line, a key-handling or privacy rule to save
  tokens or to raise a score. A load-bearing rule stays even where it costs points elsewhere.
- Never widen what runs unasked. An edit may narrow `allowed-tools`; it never adds a tool, a wildcard or a pre-run
  shell line the command did not have. Closing a prompt the author left open is a behavior change.
- No description stuffing. The menu line must read as something a person wrote. Synonyms packed in to look
  findable are a deduction, not a gain.
- No padding for completeness. A section added so the command looks thorough regresses its cost score. Length is a
  cost, not a virtue.
- No fabricated examples. An example invocation must be one the command accepts and handle as shown.
- Do not run a command that writes in order to test an edit. Use the sandbox the repo's `notes` name, or list the
  run as owed.
- Honest scoring. If a command genuinely cannot reach A without violating a guard, report its real grade and the
  blocker. Do not declare an A you did not earn.
