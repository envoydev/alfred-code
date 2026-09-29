---
name: repo-audit-rules
description: Use when auditing and fixing this repo's rule files (stack/rules) toward grade A - mechanism, always-on cost, conflicts, duplication. Not for CLAUDE.md.
disable-model-invocation: true
---

# Rules audit and remediation

You are an instruction-layer quality engineer. Take a Claude Code repository's always-on instruction
layer - CLAUDE.md files and `.claude/rules/*.md` - and raise it to excellent, ship-ready quality: audit
every rule file under the given roots, score each against an objective rubric, then rewrite each in
place until it reaches grade A (numeric 9) without changing intended behavior.

This audit belongs to a family, alongside `repo-audit-skills`, `repo-audit-agents` and
`repo-audit-claude-md`, and shares their philosophy: objective scoring with cited evidence, a gated A
that cannot be reached by averaging, hard anti-gaming guards, bounded loops, and honest reporting.

One thing makes rules fundamentally different from skills and agents, and it drives this entire
rubric: rules have no trigger. They are loaded into context at the start of every session and paid for
on every turn, whether or not they are relevant. A skill that is never invoked costs almost nothing. A
rule that is never relevant costs tokens forever and dilutes the rules that matter. So the ranking
question is not 'is this well written' but 'does this earn permanent residency in context, and is it
even in the right mechanism'.

The audit makes no assumptions about which rules, skills, or agents exist - discover every catalog
from the roots below. It is this repo's own maintenance tool, not part of the shipped catalog.

## When to use

- The user types `/repo-audit-rules` to audit the rule catalog in `stack/rules`, or a root they name.
- Not for the CLAUDE.md template or a filled CLAUDE.md (`/repo-audit-claude-md`), and not for hooks
  (`/repo-audit-hooks`).

## Parameters

- `RULES_ROOT`: folder containing rule files (default: `./stack/rules`). All `.md` files are discovered recursively, including subdirectories and symlinks.
- `CLAUDE_MD_PATHS`: the CLAUDE.md files in scope (default: `./stack/CLAUDE.template.md`, the template the installer deploys into target projects). The repository's root `./CLAUDE.md` is the stack repo's own working file: it may be read for context but is out of scope for scoring and editing.
- `SKILLS_ROOT`: folder containing skills (default: `./stack/skills`). Required, because the main remediation for a bloated rule set is moving content into skills, and you may only point at skills that exist.
- `AGENTS_ROOT`: folder containing subagents (default: `./stack/agents`). Used to detect rules that restate what an agent already owns.
- `TARGET`: minimum acceptable grade (default: `A` / `9`).
- `MAX_ITERATIONS`: max remediation passes per file (default: `4`).
- `WRITE`: `true` edits files in place, `false` produces the report only (default: `true`).

Source vs deployed layout: this repository stores the stack under `stack/` and installs it into target projects via `node scripts/install/alfred-code.js` (one installer, every OS), where each rule is a library copy in `.claude/rules/` (its hash in the install stamp, drift and staleness reported by `scripts/library-check.js`) and loads by the mechanics in `references/principles.md`. Audit the source files under `stack/` (`stack/rules/`, `stack/hooks/`), but reason about loading, `paths` globs, and cross-file references in terms of the deployed layout, and read `meta/stack-manifest.json` (the six lists the installer reads) plus the installer's own `scripts/install/` modules to confirm the source-to-deployed mapping instead of assuming it. The enforcement-layer inventory in discovery reads hooks from their source at `./stack/hooks`. Two deployed shapes are not the source's text: `baseline-docs-root.md` carries the `__DOCS_ROOT__` placeholder the installer stamps on every run, and the GENERATED rules (`baseline-project-*.md`, `project-code-style.md`) are written by the capture skill that owns them, which fixes their shape - a finding there lands in that skill, never in a hand edit of the rule.

Scope boundary: when this audit runs alongside `repo-audit-claude-md`, it still reads the CLAUDE.md template to build the conflict and duplication maps (both maps are meaningless without it), but edits only rule files; template edits belong to that audit. When run alone, this audit owns both.

## How the run goes

You operate autonomously. Do not ask for confirmation between phases. Stop only on the stop conditions
below. When a stop or finding genuinely needs the user's answer - a proposed split, a conflict with no
repo-decided winner, a blocker only they can waive - put the question through the AskUserQuestion tool
with concrete options and a marked recommendation, never a prose question buried in a report.

1. **Principles.** Read `references/principles.md` before anything else - its mechanism facts are
   load-bearing, and its operating principles define what counts as a defect in every later phase.
2. **Phase 0 - discovery.** Follow `references/discovery.md`: every CLAUDE.md in scope and every rule
   file with their imports, the skill and agent catalogs, the enforcement layer, the duplication map,
   the conflict map, the mechanism map. Do not edit anything in this phase.
3. **Phase 1 - scoring.** Score each rule file, and each CLAUDE.md in scope, on the four dimensions in
   `references/rubric.md`, citing the line or block behind every point, and map the total through its
   grade bands and floors. Produce the baseline report (the output contract below) before any editing.
4. **Phase 1b - currency.** Check the external claims per `references/currency.md`; an unresolved
   DRIFTED finding blocks the file from A.
5. **Phase 2 - remediation.** Follow `references/remediation.md`: conflicts, then mechanisms, then
   duplication, then the bounded per-file loop. Its anti-gaming guards override the A target.
6. **Phase 3 - verification**, below.

## Phase 3 - Verification

After the loop:

1. Re-read every edited file end to end. Confirm YAML frontmatter is valid and that `paths` globs parse and match the files they are meant to govern. Test the globs against actual repo paths rather than assuming.
2. Confirm that every skill, agent, hook, permissions entry, or imported file that a rule now points at actually exists - named only where the rule's install unit guarantees it, described by what it covers otherwise, with the description matching a real catalog entry - and that the repo lint's optional-cite checks are green.
3. Confirm no constraint was lost. Diff against the snapshots and account for every deleted line: it changed no behavior, it was duplicated, or it now lives in a named replacement that exists.
4. Confirm the conflict map is empty, or that each remaining conflict is reported as unresolved with both files marked blocked.
5. Re-read the full loaded set as Claude would receive it, in load order, and confirm no new contradiction was introduced by your edits. Edits that are locally correct can conflict globally.
6. Report the before and after size of the always-on payload: total lines and approximate tokens loaded at session start, and how much of the former payload is now conditional or on-demand. This is the headline number for a rules audit - beside it, the directive-sentence count against the 150-250 band and the count of zero-exception lines with the hook that enforces each (or 'none').
7. Recommend that the operator run `/memory` and `/context` to confirm which files actually load and what they cost, and the `InstructionsLoaded` hook to log exactly what loaded, when and why - the built-in way to prove a path-scoped rule attached on the edit it governs. The objective test for a rule whose value is disputed is the with/without run: the same representative task with the file present and absent, comparing success and tokens; a rule that moves neither is trimmed. Re-run that test after a major model release, since a rule that worked around an older model's limit becomes pure overhead once the newer model handles the case. You cannot verify real load behavior from static files alone, so state this as a limitation rather than claiming it verified. A claim that adherence improved is proven by observation over the following sessions, never by re-reading the file - the official guidance's own test is whether behaviour shifts: name the observable (here the analyzer's scorecard rows and the hook-blocks ledger) and record the pre-edit numbers beside the edit.
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

Keep the report dense. No preamble, no restating this skill back, no filler.
