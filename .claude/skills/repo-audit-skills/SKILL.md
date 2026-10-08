---
name: repo-audit-skills
description: Use when auditing and fixing this repo's shipped skills (stack/skills) toward grade A - triggers, structure, token cost, reuse. Not for agents or rules.
disable-model-invocation: true
---

# Skill audit and remediation

You are a skill quality engineer. Take a set of Claude Code Agent Skills and raise them to excellent,
ship-ready quality: audit every skill under `SKILLS_ROOT`, score each one against an objective rubric,
then rewrite each skill in place until it reaches grade A (numeric 9) without changing what the skill
does. The end state is a skill set a Claude Code user would consider excellent: reliably triggered,
cheap to load, clearly written, logically structured, and free of duplication across skills.

The audit makes no assumptions about which skills exist - discover them from `SKILLS_ROOT`, never
assume a particular set. It is this repo's own maintenance tool, not part of the shipped catalog.

## When to use

- The user types `/repo-audit-skills` to audit the shipped catalog in `stack/skills`, or a root they name.
- Not for the subagents (`/repo-audit-agents`) or the rule files (`/repo-audit-rules`), and not for
  writing one skill - that method is `stack/skills/habits-skill-writing/SKILL.md`.

## Parameters

- `SKILLS_ROOT`: path to the folder containing skills (default: `./stack/skills`). Each skill is a directory with a `SKILL.md` at its root, optionally with `references/`, `scripts/`, `assets/`. This repo's own `.claude/skills/` (this audit family, `plugin-authoring`) is outside the shipped catalog: audit it only when the user names it, and remember the house lint does not hold it.
- `TARGET`: minimum acceptable grade (default: `A` / `9`).
- `MAX_ITERATIONS`: max remediation passes per skill (default: `4`).
- `WRITE`: `true` edits files in place, `false` produces the report only (default: `true`).

## How the run goes

You operate autonomously. Do not ask for confirmation between phases. Stop only on the stop conditions
below. When a stop or finding genuinely needs the user's answer - a proposed split, a conflict with no
repo-decided winner, a blocker only they can waive - put the question through the AskUserQuestion tool
with concrete options and a marked recommendation, never a prose question buried in a report.

1. **Principles.** Read `references/principles.md` before anything else - it defines what counts as a
   defect in every later phase (self-containment, name-only-what-is-guaranteed, forcing shapes,
   invocation control, trigger paths).
2. **Phase 0 - discovery.** Follow `references/discovery.md`: every `SKILL.md` and the references its
   body points to, the per-skill record, the duplication map, the invocation and conflict map, the
   reference-resolution map. Do not edit anything in this phase.
3. **Phase 1 - scoring.** Score each skill on the four dimensions in `references/rubric.md`, citing the
   line or block behind every point, and map the total through its grade bands and floors. Produce the
   baseline report (the output contract below) before any editing.
4. **Phase 1b - currency.** Check the external claims per `references/currency.md`; an unresolved
   DRIFTED finding blocks the skill from A.
5. **Phase 2 - remediation.** Follow `references/remediation.md`: set-level defects first (cycles,
   contradictions, duplication clusters), then the bounded per-skill loop. Its anti-gaming guards
   override the A target.
6. **Phase 3 - verification**, below.

## Phase 3 - Verification

After the loop, for each edited skill:

1. Re-read the full edited `SKILL.md` and any moved reference files end to end. Confirm the frontmatter is still valid and `name` and directory are unchanged.
2. Confirm the behavior-preservation prompts still produce matching outputs.
3. Confirm no guarded rule was dropped. Diff against the snapshot to check.
4. For any multi-home content, confirm every copy is self-contained, its `meta/shared-rules.json` entry pins each site by marker, and no skill loads a file outside its own folder.
5. Confirm the reference layer is navigable: every reference the body cites exists, every reference file is cited somewhere, every skill, agent, or rule the body names still resolves against the live catalogs and is one its install unit guarantees (a described cite matches a real catalog entry; the repo lint's optional-cite checks are green), and names and hierarchy still match the workflow after the edits.
6. Confirm every step the body mandates is proven by something observable in a transcript - a tool call, a report field, a gate file - and treat a claim that the rewritten skill triggers or holds better as unproven until runs show it: the analyzer's SKILLS table and scorecard over the following sessions are the observable, so record the pre-edit numbers beside the edit. Where `meta/skill-comply/<skill>/expect.json` exists, `node scripts/skill-comply.js grade` scores a transcript step by step, offline; its `replay --live` is a billed nested session, so the user says go first, and `compare` applies the A/B ship rule over two replay outputs.
7. Evaluate in a FRESH session, never the authoring one (leftover authoring context masks gaps in the written instructions): for each edited skill run three realistic prompts with the skill available and again with it switched off through the settings visibility override (`skillOverrides` - every stack skill is a project copy since 2.1.0, so the override reaches it), and compare whether it fired and what it produced. `/skill-doctor` (Claude Code v2.1.252+) reports each skill's context cost and invocation count in a live session and names the never-invoked ones - quote its row for the skill beside the analyzer's SKILLS numbers. `claude plugin eval` loads only skills shipped inside a plugin, and since 2.1.0 no plugin carries a stack skill: `npm run eval-bundle -- <out>` puts the core and the whole library into one plugin for it (`meta/evals/library/` holds one case per stack profile, graded `arm: both`; the run is billed). Edits under a watched skills directory take effect within the session and a brand-new top-level skills directory needs `/reload-skills` before it lists, so the fresh session stays the test either way. Precedence between a personal and a project skill of the same name is stated differently across sources (the current docs: enterprise over personal over project; older readings: project wins) - verify it in the install before relying on either.
8. Record the final grade with the same evidence-cited scoring as Phase 1.

If any skill regressed on behavior or lost a guarded rule, restore it from the snapshot and report it as unresolved with the reason.

## Stop conditions

Stop the whole run when either holds:

- Every skill is at A / 9 and passed verification, or
- Every remaining sub-A skill has hit `MAX_ITERATIONS` or has a reported blocker that a guard forbids fixing.

Do not loop past these. Report the remainder honestly rather than inflating grades to force a clean sweep.

## Output contract

Produce a single report with:

1. Summary table: one row per skill with columns `skill`, `trigger path` (rule-forced / hook / slash / description), `baseline grade`, `final grade`, `iterations`, `status` (`raised to A`, `already A`, `blocked: <reason>`).
1b. Collision table: every description pair over the overlap threshold, the shared trigger terms, and the resolution (negative trigger added to each / merged / left, with the reason).
2. Per skill, a short block containing: baseline score by dimension with the top 2-3 cited deductions; what changed, as a terse list of edits; final score by dimension; any blocker and why a guard prevented an A.
3. Duplication map: each cluster found, the skills involved, and how it was resolved (registered restatement or delegation), or why it was left local.
4. Invocation and conflict map: every cycle found and how it was broken, every contradiction and its resolution (or why it is unresolved and the skills are blocked), any genericity flags with cited lines, and every named cite of an optional skill or MCP server converted to a description (file, line, before, after).
5. If `WRITE` is true, the list of files edited, moved, or created, including any `meta/shared-rules.json` entries added or updated, and the snapshot location for rollback.

Keep the report dense. No preamble, no restating this skill back, no filler.
