---
name: repo-audit-rules
description: Use when auditing and fixing the rule files this repo ships toward grade A - mechanism, always-on cost, conflicts, duplication. Not for AGENTS.md or CLAUDE.md.
disable-model-invocation: true
---

# Rules audit and remediation

You are an instruction-layer quality engineer. Take a Claude Code repository's always-on instruction
layer - CLAUDE.md files and `.claude/rules/*.md` - and raise it to excellent, ship-ready quality: audit
every rule file under the given roots, score each against an objective rubric, then rewrite each in
place until it reaches grade A (numeric 9) without changing intended behavior.

One thing makes rules fundamentally different from skills and agents, and it drives this entire
rubric: rules have no trigger. They are loaded into context at the start of every session and paid for
on every turn, whether or not they are relevant. A skill that is never invoked costs almost nothing. A
rule that is never relevant costs tokens forever and dilutes the rules that matter. So the ranking
question is not 'is this well written' but 'does this earn permanent residency in context, and is it
even in the right mechanism'.

The audit makes no assumptions about which rules, skills, or agents exist - discover every catalog
from the roots below. It is this repo's own maintenance tool, not part of the shipped catalog. Every
repo-specific fact - where the rules live, the mechanical checks, the registries and catalogs the repo
keeps - comes from the repo's own `.claude/kit/repo.json`, never from this file.

## When to use

- The user types `/repo-audit-rules` to audit the rule files `audit.rules.roots` names, or a root they name.
- Not for the AGENTS.md or CLAUDE.md template or a filled copy of one (`/repo-audit-agent-md`), and not
  for hooks (`/repo-audit-hooks`).

## Parameters

- `RULES_ROOT`: folders containing rule files (default: `audit.rules.roots`). All `.md` files are discovered recursively, including subdirectories and symlinks.
- `CLAUDE_MD_PATHS`: the CLAUDE.md files in scope (default: `audit.agent-md.roots`, the CLAUDE.md or AGENTS.md template the repo deploys into target projects; no entry means the repo ships none). The repo's own working instruction file (repo.json `agents_md`, else the root `./AGENTS.md` or `./CLAUDE.md`) may be read for context but is out of scope for scoring and editing.
- `SKILLS_ROOT`: folders containing skills (default: `audit.skills.roots`; no entry is an empty catalog). Required, because the main remediation for a bloated rule set is moving content into skills, and you may only point at skills that exist.
- `AGENTS_ROOT`: folders containing subagents (default: `audit.agents.roots`; no entry is an empty catalog). Used to detect rules that restate what an agent already owns.
- `TARGET`: minimum acceptable grade (default: `A` / `9`).
- `MAX_ITERATIONS`: max remediation passes per file (default: `4`).
- `WRITE`: `true` takes the run to the flow's ask and applies what it picks, `false` stops after the report and the plan (default: `true`).

Source vs deployed layout: a repo that ships rules usually keeps their source in its own tree and installs them into target projects, where each rule lands in `.claude/rules/` and loads by the mechanics in `references/principles.md`. Audit the source files under the roots, but reason about loading, `paths` globs, and cross-file references in terms of the deployed layout, and confirm the source-to-deployed mapping from the install manifest and installer modules the `notes` name instead of assuming it. The enforcement-layer inventory in discovery reads hooks from their source at `audit.hooks.roots` plus the settings files. A deployed rule whose shape is not the source's text - a placeholder the installer stamps, a rule a generator or capture skill writes - is named in the `notes`; a finding there lands in the owner the note names, never in a hand edit of the rule.

Scope boundary: this audit reads and scores the AGENTS.md or CLAUDE.md template - the conflict and duplication maps are meaningless without it - but edits only rule files. An edit the template needs is never made here: it is recorded in the conflict or duplication map as a handoff to `/repo-audit-agent-md`.

## How the run goes

**Load the `repo-audit-plugin` skill before step 1 and run this audit through its flow.** Its planner seat does Phases 0
to 1b and writes Phase 2's edits as a plan, its editor seat applies them, and the planner does Phase 3. This session
coordinates and is the only one that asks the user. The seats do not ask for confirmation between phases; the stops
the flow adds are its own asks, one of them before any edit lands. Stop otherwise only on the stop conditions
below. When a stop or finding genuinely needs the user's answer - a proposed split, a conflict with no
repo-decided winner, a blocker only they can waive - put the question through the AskUserQuestion tool
with concrete options and a marked recommendation, never a prose question buried in a report.

1. **Targets.** Read `.claude/kit/repo.json` -> `audit.rules`. No entry: report 'this repo ships no
   rules - nothing to audit' and stop. `roots` are what this run audits (a root the user names
   overrides them); run every `checks` command where this skill calls for the repo's mechanical
   checks, and quote its result; follow every `notes` line wherever this skill touches a
   repo-specific mechanism (a multi-home registry, an always-on budget, install catalogs, a
   generated or placeholder rule, a usage ledger). Read `audit.agent-md`, `audit.skills`,
   `audit.agents` and `audit.hooks` from the same file for the catalogs the Parameters name.
2. **Principles.** Read `references/principles.md` before any phase - its mechanism facts are
   load-bearing, and its operating principles define what counts as a defect in every later phase.
3. **Phase 0 - discovery.** Follow `references/discovery.md`: every CLAUDE.md in scope and every rule
   file with their imports, the skill and agent catalogs, the enforcement layer, the duplication map,
   the conflict map, the mechanism map. Do not edit anything in this phase.
4. **Phase 1 - scoring.** Score each rule file, and each CLAUDE.md in scope, on the four dimensions in
   `references/rubric.md`, citing the line or block behind every point, and map the total through its
   grade bands and floors. Produce the baseline report (the output contract below) before any editing.
5. **Phase 1b - currency.** Check the external claims per `references/currency.md`; an unresolved
   DRIFTED finding blocks the file from A.
6. **Phase 2 - remediation.** Follow `references/remediation.md`: conflicts, then mechanisms, then
   duplication, then the bounded per-file loop. Its anti-gaming guards override the A target.
7. **Phase 3 - verification**, below.

## Phase 3 - Verification

After the loop:

1. Re-read every edited file end to end. Confirm YAML frontmatter is valid and that `paths` globs parse and match the files they are meant to govern. Test the globs against actual repo paths rather than assuming.
2. Confirm that every skill, agent, hook, permissions entry, or imported file that a rule now points at actually exists - named only where the rule's install unit guarantees it, described by what it covers otherwise, with the description matching a real catalog entry - and that every `checks` command is green (quote each result; a check the `notes` name as covering optional cites is the one this item rests on).
3. Confirm no constraint was lost. Diff against the snapshots and account for every deleted line: it changed no behavior, it was duplicated, or it now lives in a named replacement that exists.
4. Confirm the conflict map is empty, or that each remaining conflict is reported as unresolved with both files marked blocked.
5. Re-read the full loaded set as Claude would receive it, in load order, and confirm no new contradiction was introduced by your edits. Edits that are locally correct can conflict globally.
6. Report the before and after size of the always-on payload: total lines and approximate tokens loaded at session start, and how much of the former payload is now conditional or on-demand. This is the headline number for a rules audit - beside it, the directive-sentence count against the 150-250 band and the count of zero-exception lines with the hook that enforces each (or 'none').
7. Recommend that the operator run `/memory` and `/context` to confirm which files actually load and what they cost, and the `InstructionsLoaded` hook to log exactly what loaded, when and why - the built-in way to prove a path-scoped rule attached on the edit it governs. The objective test for a rule whose value is disputed is the with/without run: the same representative task with the file present and absent, comparing success and tokens; a rule that moves neither is trimmed. Re-run that test after a major model release, since a rule that worked around an older model's limit becomes pure overhead once the newer model handles the case. You cannot verify real load behavior from static files alone, so state this as a limitation rather than claiming it verified. A claim that adherence improved is proven by observation over the following sessions, never by re-reading the file - the official guidance's own test is whether behaviour shifts: name the observable (the usage analyzer or hook-block ledger the `notes` name, else a concrete behaviour a reader of the next sessions can check) and record the pre-edit numbers beside the edit.
8. Record the final grade with the same evidence-cited scoring as Phase 1.

If any file lost a constraint, points at something nonexistent, or introduced a conflict, restore it from the snapshot and report it as unresolved with the reason.

## Stop conditions

Stop the whole run when either holds:

- Every file is at A / 9 and passed verification, or
- Every remaining sub-A file has hit `MAX_ITERATIONS` or has a reported blocker a guard forbids fixing.

Do not loop past these. Report the remainder honestly rather than inflating grades to force a clean sweep.

## Output contract

Produce a single report with:

1. Headline: always-on payload before and after, in lines, approximate tokens and directive-sentence count, plus how much moved to conditional (`paths`) or on-demand (skills), and the zero-exception lines with their enforcing hook or 'none'.
2. Summary table: one row per file with columns `file`, `tier`, `loads` (unconditional / path-scoped / imported), `baseline grade`, `final grade`, `iterations`, `status` (`raised to A`, `already A`, `deleted`, `moved to <target>`, `blocked: <reason>`).
3. Conflict map: every contradiction found, the files and tiers involved, how it was resolved, or why it is unresolved and both files are blocked. Put this first among the detail sections; it is the highest-severity class.
4. Mechanism changes: every rule moved out of prose, with its destination (hook, `permissions.deny`, skill, path-scoped rule) and whether that destination now exists or is only a recommendation. Flag any prose rule left in place pending a replacement that was not built.
5. Duplication map: each cluster, the direction, and how it was resolved, or why it was left local.
6. Per file, a short block: baseline score by dimension with the top 2-3 cited deductions, what changed, final score by dimension, any blocker, and every named cite of an optional skill or MCP server converted to a description (line, before, after).
7. Deletions: every line or block deleted, and which justification applies (no behavior change, duplicated, replaced by a named mechanism).
8. If `WRITE` is true, the list of files edited, moved, created, or deleted, including new skills and hooks, and the snapshot location for rollback.
9. The `checks`: each command with its result line, before and after the edits.
10. The Phase 1b currency table with this run's verdicts.

Keep the report dense. No preamble, no restating this skill back, no filler.
