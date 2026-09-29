# Skill audit - Phase 1 rubric

Read at Phase 1. Every point awarded or deducted cites the line that justifies it.

Score each skill on four weighted dimensions, 100 points total. For every point awarded or deducted, cite the line or block that justifies it. Then map the total to a grade using the band table, applying the dimension floors.

## Dimension 1 - Description and triggering (30 pts)

The frontmatter `description` is the only thing in context before a skill fires, so it is the entire triggering mechanism. Judge it on:

- States when to use the skill in the description itself, and what it does as far as the cap allows, in the third person ('Extracts ...', 'Use when ...' - never 'I can' / 'you can use this': the description is injected into the system prompt and a point-of-view mismatch hurts selection), with the key use case FIRST. The harness truncates `description` plus `when_to_use` at 1,536 chars in the skill listing and the platform validator rejects a description over 1,024, but this repo's lint holds the pair to 160 (check 15c, since 2.1.2): the description is the trigger line - 'Use when' / 'Load when' plus the strongest trigger phrases and at most one short 'Not for' - and the rest of the what-and-when (examples, version floors, 'Covers ...' lists, further negative scope) lives in the body's `## When to use` section, which loads with the body. Score the two together: the description still says what fires the skill, and the section carries what the cap moved out. (9)
- Includes concrete trigger phrases and realistic contexts a user would actually type, not just an abstract summary. (9)
- Handles near-misses where it matters: says when NOT to use it, or scopes itself so an adjacent skill wins the right cases. Two skills collide when a human engineer cannot say which one a request belongs to - then the model cannot either. Measure it: pairwise shared trigger terms across the set's descriptions (measured on the longer descriptions before the 2.1.2 cap: `angular-testing` and `ts-js-testing` shared 35 terms at Jaccard 0.44, the architecture and coverage loops 0.35 - re-measure on the live set, and read each skill's `## When to use` beside it); a pair over ~0.25 gets a negative-trigger clause in each ('Do NOT use for X - that is `y`') or a merge. Names stay distinct - a same-name override across scopes is not a mechanism to design on. (7)
- Is slightly pushy to counter undertriggering ('any time a spreadsheet is the primary input or output' is the official register), but scoped accurately. It does not over-claim capability or stuff unrelated keywords to look more triggerable. The bare keyword list ('Triggers on user interview, JTBD') is the twin defect of the vague summary: it names words, not what the skill produces - a 'Triggers on ...' clause is valid only beside a what-plus-when statement (21 descriptions here carried one before the 2.1.2 cap; none does on 2026-09-29). The vocabulary test: the description holds the words a user would type ('why is this slow?'), not only the author's ('Big-O regressions'). Caps emphasis (MUST, NEVER, CRITICAL) in a description over-triggers; 'Use when ...' is the form. A community source reports each listing entry capped at 250 chars (`SLASH_COMMAND_TOOL_CHAR_BUDGET`) against the official 1,536 for the combined text - verify live in Phase 1b; this repo's 160-char cap sits under both, so the check here is that the trigger terms survived the cap (before it, 61 of 79 descriptions had no 'use' or 'when' inside their first 250 chars). (5)

Floor for A: >= 26/30.

## Dimension 2 - Structure and instruction quality (30 pts)

- Valid frontmatter with `name` and `description` present and correct, by the open spec's constraints: `name` at most 64 chars of lowercase letters, digits and single hyphens (none leading or trailing), no XML tags, not the reserved words 'anthropic' or 'claude'; `description` non-empty, at most 1,024 chars, no XML tags. Naming is consistent across the collection: this set uses noun phrases (`dotnet-testing`) where the spec prefers gerunds (`testing-dotnet`); either is fine, mixing is not. `allowed-tools` is a one-turn permission pre-approval, not a restriction; `disallowed-tools` removes tools while the skill is active and is the only least-privilege shape a skill has (none of the 89 uses either on 2026-09-29 - available, not owed). (4)
- Progressive disclosure with logically structured references. The body stays lean and defers heavy or optional detail to `references/`, and the reference layer is organized so a reader can navigate it: one topic per reference file, descriptive filenames (`error-codes.md` beats `notes2.md`), a directory hierarchy that mirrors the skill's workflow where more than a few files exist, reference files over 100 lines carrying a table of contents (the official threshold - a partial read still sees the file's scope), and every reference linked from `SKILL.md` DIRECTLY: a file reachable only through another reference is a defect, since the model previews a nested reference with a partial read (`head -100`) and works from an incomplete file (measured on an earlier 146-file layer: 4 sat behind a sibling; the layer held 193 files on 2026-09-29). The body cites each reference at the exact step where it is needed, never as an undifferentiated link dump at the end. A pile of references with no discernible organization scores low even if each file is individually fine, because the reader cannot tell what loads when or why. (8)
- Instructions are imperative and explain the why. Rigid all-caps MUST or NEVER walls are a smell; they score lower than the same rule with a reason attached, except where the rule is a genuine safety or privacy invariant. Freedom matches fragility: a fragile or sequence-critical step gets the exact command and no alternatives, a judgment step gets the heuristic; more than one route for one job is offered only as ONE default plus a named escape hatch; one term per concept throughout (never 'endpoint' / 'URL' / 'route' for the same thing); a dated condition ('before August 2025 use ...') moves to an 'old patterns' block; a bundled script is cited with its intent explicit - 'run X' to execute, 'see X' to read - and every constant in it justified. (6)
- Output format is defined explicitly, with a template where the skill produces a fixed shape - and a skill that changes state names the check that proves it worked (a test run, a build, a lint, a diff against a fixture) as a numbered step, with the output contract carrying the evidence: the command and its result line, never the claim alone. A skill that ends on 'done' with no runnable check leaves the user as the verification loop. (6)
- Concrete input and output examples are present for any non-trivial skill. A bundled script solves rather than defers (it handles the missing file and the permission error itself), lists the packages it needs instead of assuming them, and a batch or destructive step runs plan-validate-execute: write the plan file, validate it with a script whose message names the field and the valid options, then apply. No human-centric files inside the skill directory (README, CHANGELOG, an install guide) - only what the agent needs (measured: none here). (6)

Floor for A: >= 26/30.

## Dimension 3 - Token efficiency (20 pts)

This dimension is about leanness within a single skill. Cross-skill duplication is scored separately in Dimension 4.

- Metadata is tight: roughly under 100 words across name plus description. The description is the ONLY part of a skill every session pays for - the harness loads every installed skill's description to decide what to invoke, so the set's descriptions are an always-on cost (lint check 33 sums them with the pathless rules and the agent descriptions under 70,000 chars, and check 15c holds each description plus `when_to_use` to 160). The listing is budgeted too - a share of the context window, past which the least-used skills lose their descriptions whole (verify the figure in Phase 1b) - while a `disable-model-invocation` skill's description leaves it. A description that summarizes the body instead of stating the trigger pays twice. The three-level model prices the skill: level 1, name plus description, always resident at roughly 100 tokens per skill in the official planning figure - this set measured ~190 before the 2.1.2 cap (60k chars over 79 skills) and 13,586 chars over 89 skills on 2026-09-29, ~153 chars (~40 tokens) each; level 2, the body on trigger, under ~5k tokens; level 3, bundled files at zero until read - a script's code never enters context, only its output. (4)
- Body earns its length: no restated instructions, no filler, no content that could live in a reference and be loaded only when needed. Simple skills should be well under 500 lines and usually far shorter. Once invoked, the body stays in context for the rest of the session, and a compaction re-attaches only the FIRST 5,000 tokens of each invoked skill under a shared 25,000-token budget, most recent first - so the rules a run needs after a compaction sit in the first ~20,000 chars and nothing load-bearing sits below them (measured 2026-09-29: 24 of 89 bodies over 12k chars, 2 over 20k). A skill any agent preloads through `skills:` is injected WHOLE on every dispatch of that seat, so its body is a per-dispatch cost as well - score those harder. (7)
- Heavy, optional, or rarely-needed content is deferred to `references/` rather than sitting in the always-loaded body. (5)
- Repeated deterministic work is bundled into a script and referenced, not re-derived in prose every invocation. (4)

Floor for A: >= 17/20.

## Dimension 4 - Reuse and non-duplication (20 pts)

Scored against the duplication map from Phase 0. This is a set-level property: a skill loses points here for content it duplicates from other skills, even if the skill reads well on its own.

- No instruction block, template, rule set, or glossary is copy-pasted across skills unmanaged. Content deliberately living in more than one skill is registered multi-home text: each copy self-contained, marker-pinned in `meta/shared-rules.json`; the unregistered copy is the defect. (8)
- Skills with overlapping scope compose rather than reimplement: the narrower skill owns the logic and the broader one delegates to it - by name only where the same install unit guarantees it, otherwise by describing what it covers so the installed inventory matches it and a project without it still knows what to do - instead of both carrying an unmanaged copy. (5)
- Self-containment holds: no skill loads a file from another skill's folder, no load directive names a skill or MCP server the install can lack (a guarded name is still a name), and each skill can be understood and packaged on its own. A skill that silently depends on a file it never names - or on a file another skill owns - is a defect, not reuse. (4)
- Reuse is proportionate. Small incidental overlaps (a one-line rule, a stock phrase) stay local. Do not over-abstract trivial snippets into registered multi-home text that couples skills for no real saving. (3)

Floor for A: >= 17/20.

## Grade bands

| Total | Grade | Numeric |
|-------|-------|---------|
| 90-100 and all floors met | A | 9 |
| 80-89 | B | 7-8 |
| 65-79 | C | 5-6 |
| 50-64 | D | 3-4 |
| < 50 | F | 1-2 |

A skill reaches A / 9 only when the total is >= 90 and every dimension clears its floor. This is deliberate: it blocks the common failure of acing some dimensions and averaging away a weak one. A skill with a strong body but a vague description is not an A skill, because the description decides whether the body is ever loaded. A skill that reads perfectly but copy-pastes half its body from a sibling skill is not an A skill either, because the duplication is a maintenance defect the reader of one skill cannot see.

A skill implicated in an unresolved invocation cycle or contradiction is blocked from A until the loop or conflict is resolved, whatever its own total - both are set-level defects that make behavior unbounded or nondeterministic.
