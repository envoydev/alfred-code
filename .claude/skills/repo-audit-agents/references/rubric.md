# Agent audit - Phase 1 rubric

Read at Phase 1. Every point awarded or deducted cites the line that justifies it.

Score each agent on four weighted dimensions, 100 points total. For every point awarded or deducted, cite the line or block that justifies it. Then map the total to a grade using the band table, applying the dimension floors.

## Dimension 1 - Description and routing (30 pts)

The frontmatter `description` is what the orchestrator reads to decide whether to delegate to this agent. It is the routing mechanism. Judge it on:

- States both what the agent does and when to delegate to it, in the description itself, not deferred to the body - inside the 300-char cap (lint check 15b): the 'Use when...' sentence and its 'Do NOT use' clause, with the rest of the scope in the agent's `## Scope` body section, because the dispatcher's listing carries every enabled seat's description in every session's first call. (9)
- Includes concrete delegation cues: one sentence that says WHEN to delegate, with the detail in the body, which loads only on dispatch - a title-style description ('the database expert') never fires or fires wrong. 'Use PROACTIVELY' / 'use immediately after ...' phrasing is for a stack that wants auto-fire; this stack's dispatch is explicit-only (the capabilities rule and the dispatch guard), so a proactive cue here is a defect, not a merit. (9)
- Handles collisions: scopes itself so a sibling agent wins the cases it should, and says when not to use this agent. (7)
- Selected when relevant without over-claiming its scope or stuffing keywords to win routing it should not win. (5)

Floor for A: >= 26/30.

## Dimension 2 - Expertise, system prompt, tool scope, and autonomy (30 pts)

- Valid frontmatter: `name` and `description` correct; `tools` and `model` set intentionally rather than left to inherit by accident, and the model pin justified by the seat's task class - the official guidance routes most coding work to Sonnet, reserves Opus for design and multi-step reasoning, and points simple seats at Haiku - with any pin change shipped beside a measured cost and outcome delta, never an assertion. The file shape is checked too, because a broken one is skipped silently (logged only under `--debug`): `---` not on line 1, no `name`, a `name` starting with `-` or containing `:`, unparseable YAML. The field set is `name`, `description`, `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `effort`, `isolation`, `color`, `initialPrompt`, `experimental`; a plugin-shipped seat ignores `hooks`, `mcpServers` and `permissionMode`. Mechanics that change what a pin means: `disallowedTools` is applied before `tools`, and an entry with a specifier (`Bash(git push *)`) removes the WHOLE tool - a command-level block belongs in `permissions.deny` or a PreToolUse hook; `permissionMode` is honoured only while the main session is in default, dontAsk or plan mode; `model` resolves per-invocation param > frontmatter > `CLAUDE_CODE_SUBAGENT_MODEL` > the main model (`inherit`), and `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` overrides every pin, so a pin is a default, not a guarantee; `mcpServers` in frontmatter scopes a server to ONE seat and keeps its tool schemas out of the main context - a candidate for a server only one seat uses, and a delivery change that is measured before it moves. (3)
- Single, focused responsibility. The role is clear and not a grab-bag of unrelated jobs that should be separate agents. (4)
- Overqualified for the role. The system prompt establishes the agent as a domain expert operating above the bar of its tasks: it states the expertise it applies, the concrete quality standards it holds output to, and the domain-specific failure modes and edge cases an expert would check before returning. This must be operational, not decorative: every expertise claim must change what the agent checks, produces, or refuses. A generic helper persona scores near zero here; so does a paragraph of 'world-class' flattery that changes no behavior. (6)
- Least-privilege tools: the grant lists only what the role actually uses, with nothing unused and nothing the body needs but lacks. An agent that inherits every tool while using two is a defect. (5)
- Bounded autonomy. The agent runs in its own isolated context and returns a result, so it needs explicit stop conditions, bounded loops, and a defined output contract describing what it hands back to the caller. Unbounded loops and vague returns are the top real-world agent failure. The return is a summary the caller can act on - findings scoped to correctness and the stated requirements from a reviewer, a status word plus the artifact from a builder - never the seat's raw reads or a re-narration of its steps. `maxTurns` is the forcing shape for a bounded loop. A seat can spawn seats to depth 3 by default (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`), 20 running at once (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`), and only the top-level summary returns - a chain loses its intermediate output to the caller, so a nested pattern hands off through files, not returns. The return must not carry instruction-shaped text - a `<system-reminder>`-like tag, a `bypassPermissions` mention - since v2.1.210 the harness escapes it and stamps a `[harness:...]` marker, so a contract asking for such text breaks its own return. (7)
- Imperative instructions that explain why, with examples where the output shape is fixed. Rigid all-caps MUST or NEVER walls score lower than the same rule with a reason attached, except where the rule is a genuine safety or privacy invariant. (5)

Floor for A: >= 26/30.

## Dimension 3 - Token efficiency (20 pts)

Leanness within a single agent. Cross-agent, agent-to-skill, and agent-to-rule duplication is scored in Dimension 4.

- Frontmatter and description are tight, no filler - the description sum per install unit sits well under the 15,000-token startup warning (a single-stack install here: ~1k tokens over 12-14 seats, measured 2026-09-29) - and the `skills:` preload earns every entry, because each preloaded skill is paid on EVERY dispatch before the seat reads its first file: measured 26k-70k chars per designer / implementer / verifier seat, and across a 40-seat baseline 55% of all seat input tokens was the seats' own first-message context, with 28 seats over 60%. A preloaded skill the seat's steps do not use on every run is a defect - route it by description and let the seat load it when the task calls for it. (4)
- Body earns its length: no restated instructions, no filler, no content that could live in a reference and load only when needed. (8)
- Heavy, optional, or rarely-needed content is deferred to a reference rather than sitting in the always-loaded system prompt. (4)
- Repeated deterministic work is bundled into a script or delegated to a skill, not re-derived in prose every run. (4)

Floor for A: >= 17/20.

## Dimension 4 - Reuse of skills, rules, and shared content (20 pts)

Scored against the duplication map from Phase 0. This is a system-level property: an agent loses points for text it duplicates from a skill, a rule, or another agent, even if it reads well on its own.

- No procedure is reimplemented inline that a skill already owns. The agent invokes the skill - by name where its install unit guarantees it, by what it covers otherwise - and keeps only its own orchestration around it. This is the main reuse channel agents have, so it carries the most weight. (7)
- No process, convention, or standard is restated that a rule file or CLAUDE.md already defines. The agent names the governing rule (for example 'follow `.claude/rules/testing.md` for test conventions') and adds only what is specific to its role. Rules define how the project behaves; agents should lean on that definition, not fork it into a private copy that will drift. (4)
- No instruction block, rule set, or template is copy-pasted across agents. Shared content lives in one shared reference each agent cites, or one agent owns it and the others delegate. (5)
- Reuse is named and self-contained. An agent that relies on a skill, rule, or shared reference names it explicitly - or, where the install can lack it, describes what it covers - so the agent stays understandable and portable. Silent dependence is a defect, not reuse, and so is a bare name of an artifact the install can lack - with one exception: a registry-synced multi-home rule (`meta/shared-rules.json`) keeps its copies inline WITHOUT naming the sibling artifacts. (2)
- Reuse is proportionate. Small incidental overlaps stay local. Do not over-abstract a one-line rule into a shared file that couples agents for no real saving. (2)

Floor for A: >= 17/20.

## Grade bands

| Total | Grade | Numeric |
|-------|-------|---------|
| 90-100 and all floors met | A | 9 |
| 80-89 | B | 7-8 |
| 65-79 | C | 5-6 |
| 50-64 | D | 3-4 |
| < 50 | F | 1-2 |

An agent reaches A / 9 only when the total is >= 90 and every dimension clears its floor. This is deliberate: it blocks acing some dimensions and averaging away a weak one. An agent with a sharp prompt but blanket tool access is not an A agent, because the over-grant is a real risk. An agent that reads perfectly but inlines a procedure a skill owns, or forks a convention a rule defines, is not an A agent either, because the duplication is a maintenance defect the reader of one file cannot see.

An agent implicated in an unresolved invocation cycle or cross-layer contradiction is blocked from A until it is resolved, whatever its own total.
