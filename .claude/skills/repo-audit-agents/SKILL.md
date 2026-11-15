---
name: repo-audit-agents
description: Use when auditing and fixing this repo's shipped subagents toward grade A - routing, expertise, tool scope, reuse. Not for skills or rules.
disable-model-invocation: true
---

# Agent audit and remediation

You are an agent quality engineer. Take a set of Claude Code subagents and raise them to excellent,
ship-ready quality: audit every agent under `AGENTS_ROOT`, score each one against an objective rubric,
then rewrite each agent in place until it reaches grade A (numeric 9) without changing what the agent
does.

This is a sibling of `repo-audit-skills` and shares its philosophy: objective scoring with cited
evidence, a gated A that cannot be reached by averaging, hard anti-gaming guards, bounded loops, and
honest reporting. Two things matter more here than for skills. First, an excellent agent is written as
an overqualified domain expert: its system prompt establishes deep expertise in its role, the
standards it holds output to, and the failure modes an expert would check for, so the agent performs
above the bar of the tasks routed to it. Second, agents duplicate text badly, from each other, from
skills that own a procedure, and from rules that already define process and behavior. An excellent
agent invokes skills and refers to rules instead of restating them - by name where its install unit
guarantees them, by what they cover otherwise.

The audit makes no assumptions about which agents, skills, or rules exist - discover every catalog from
the roots below. The end state is an agent set a Claude Code user would consider excellent: reliably
routed to, expert-grade, least-privilege, bounded, cheap to load, and free of duplication. It is this
repo's own maintenance tool, not part of the shipped catalog.

## When to use

- The user types `/repo-audit-agents` to audit the repo's shipped seats (the `audit.agents` roots in
  `.claude/kit/repo.json`), or a root they name.
- Not for the skills (`/repo-audit-skills`) or the rule files (`/repo-audit-rules`).

## Parameters

- `AGENTS_ROOT`: folders containing subagent definitions (default: the `audit.agents` roots from step 1). Each agent is a markdown file with YAML frontmatter (`name`, `description`, optional `tools`, optional `model`) and a system-prompt body.
- `SKILLS_ROOT`: folders containing skills (default: the `audit.skills` roots). Required, because reuse and duplication are scored against the real skill catalog. If absent, note it and score skill reuse as not applicable.
- `RULES_ROOT`: folders containing rule files (default: the `audit.rules` roots), plus the instruction-file template the repo ships (the `audit.agent-md` roots, or the template its `notes` name). Required, because agents must refer to the rules that govern their process instead of restating them, and you may only point an agent at rules that exist; with none, note it and score rule reuse against the project CLAUDE.md files alone. Note that agents cite rules by their deployed path (`.claude/rules/...`, where an install places them in a target project), while existence is validated against the source catalog at `RULES_ROOT`. The repo's own working `CLAUDE.md` is out of scope unless the map lists it as shipped.
- `TARGET`: minimum acceptable grade (default: `A` / `9`).
- `MAX_ITERATIONS`: max remediation passes per agent (default: `4`).
- `WRITE`: `true` edits files in place, `false` produces the report only (default: `true`).

## How the run goes

You operate autonomously. Do not ask for confirmation between phases. Stop only on the stop conditions
below. When a stop or finding genuinely needs the user's answer - a proposed split, a conflict with no
repo-decided winner, a blocker only they can waive - put the question through the AskUserQuestion tool
with concrete options and a marked recommendation, never a prose question buried in a report.

1. **Targets.** Read `.claude/kit/repo.json` -> `audit.agents`. No entry: report 'this repo ships no
   agents - nothing to audit' and stop. Its `roots` are `AGENTS_ROOT` for this run (a root the user
   names overrides them), and the `audit.skills` and `audit.rules` roots supply the catalogs; run
   every `checks` command wherever this skill calls for the repo's checks, and quote its result;
   follow every `notes` line wherever this skill touches a repo-specific mechanism (a multi-home
   registry, an install catalog, a dispatch spelling, a seat-rename record, a session analyzer).
2. **Principles.** Read `references/principles.md` before any phase - it defines what counts as a
   defect in every later phase (install units, name-only-what-is-guaranteed, seat versus skill, the
   dispatch price, forcing shapes, no cycles).
3. **Phase 0 - discovery.** Follow `references/discovery.md`: every agent file and its record, the
   skill and rule catalogs, the duplication map, the invocation and conflict map, the
   reference-resolution map. Do not edit anything in this phase.
4. **Phase 1 - scoring.** Score each agent on the four dimensions in `references/rubric.md`, citing the
   line or block behind every point, and map the total through its grade bands and floors. Produce the
   baseline report (the output contract below) before any editing.
5. **Phase 1b - currency.** Check the external claims per `references/currency.md`; an unresolved
   DRIFTED finding blocks the agent from A.
6. **Phase 2 - remediation.** Follow `references/remediation.md`: system-level defects first (cycles,
   contradictions, duplication clusters), then the bounded per-agent loop. Its anti-gaming guards
   override the A target.
7. **Phase 3 - verification**, below.

## Phase 3 - Verification

After the loop, for each edited agent:

1. Re-read the full edited file end to end. Confirm the frontmatter is valid, and `name` and file name are unchanged.
2. Confirm the `tools` grant still covers every tool the body uses and lists nothing it does not.
3. Confirm the behavior-preservation tasks still return matching results.
4. Confirm no guarded rule, stop condition, or tool restriction was dropped. Diff against the snapshot to check.
5. Confirm every skill, rule, agent, or reference the file now points to actually exists - named explicitly where the install unit guarantees it, described by what it covers otherwise, with the description matching a real catalog entry - that no body directive names a skill or MCP server the install can lack (the repo's `checks` are green, any optional-cite check among them included), and that any shared content lives in exactly one place.
6. Treat a claim that the rewritten seat is cheaper or holds its contract better as unproven until dispatches show it: the per-seat table and dispatch-overhead row of the repo's session analyzer, where its `notes` name one, over the following sessions are the observable, so record the pre-edit numbers (preload share, output per dispatch, status words returned) beside the edit.
7. After any rename or new seat: run `/doctor` for duplicate-name collisions across the tree, confirm every `tools` entry still resolves, and re-sum the descriptions per install unit against the 15,000-token warning. A renamed or retired seat also gets the migration record the repo's `notes` name, and every body that dispatches it keeps the dispatch spelling those `notes` set (a plugin-shipped seat answers to `<plugin>:<seat>`), with the check that pins it run.
8. Record the final grade with the same evidence-cited scoring as Phase 1.

If any agent regressed on behavior, lost a guarded rule, or points at something that does not exist, restore it from the snapshot and report it as unresolved with the reason.

## Stop conditions

Stop the whole run when either holds:

- Every agent is at A / 9 and passed verification, or
- Every remaining sub-A agent has hit `MAX_ITERATIONS` or has a reported blocker a guard forbids fixing.

Do not loop past these. Report the remainder honestly rather than inflating grades to force a clean sweep.

## Output contract

Produce a single report with:

1. Summary table: one row per agent with columns `agent`, `baseline grade`, `final grade`, `iterations`, `status` (`raised to A`, `already A`, `blocked: <reason>`).
2. Per agent, a short block containing: baseline score by dimension with the top 2-3 cited deductions; what changed, as a terse list of edits; final score by dimension; any blocker and why a guard prevented an A.
3. Duplication map: each cluster, the direction (agent-to-agent, agent-to-skill, agent-to-rule, agent-to-reference), and how it was resolved (invoke skill, cite rule, delegate to agent, shared reference, new extracted skill), or why it was left local.
4. Invocation and conflict map: every cycle found and how it was broken, every cross-layer contradiction and its resolution (or why it is unresolved and the agents are blocked), any genericity flags with cited lines, and every named cite of an optional skill or MCP server converted to a description (file, line, before, after).
5. Extracted-skill recommendations: procedures repeated across agents with no skill owner that should become skills, whether or not you extracted them this run.
6. Install-unit description budget: per install unit (what one install carries, per the repo's `notes`; with none, the whole shipped set), the resident description total in chars and tokens against the 15,000-token warning, the always-installed share where installs differ, and any seat whose description overlaps a sibling's routing cases (file, the two descriptions' shared cue).
7. If `WRITE` is true, the list of files edited, moved, or created, including any new skills or shared references, and the snapshot location for rollback.

Keep the report dense. No preamble, no restating this skill back, no filler.
