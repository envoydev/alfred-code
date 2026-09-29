# Rules audit - Phase 1 rubric

Read at Phase 1. Every point awarded or deducted cites the line that justifies it.

Score each rule file, and each CLAUDE.md in scope, on four weighted dimensions, 100 points total. For every point awarded or deducted, cite the line or block that justifies it. Then map the total to a grade using the band table, applying the dimension floors.

## Dimension 1 - Mechanism, placement, and scope (30 pts)

This is the dimension that has no analogue in the skill or agent rubric, and it is the one most rule sets fail. It asks whether the content should be an always-on rule at all, and if so, where.

- Right mechanism. The content is genuine behavioral guidance, not a deterministic must-run step that should be a hook, a hard block that should be `permissions.deny`, or a multi-step procedure that should be a skill. Prose that tries to enforce what only a hook can enforce is a defect, because it is unreliable by construction and reads as a guarantee it cannot make. Two official tests settle the borderline cases: an action that must happen every time with zero exceptions is a hook, not a rule; and a rule Claude already follows without it - its gate never fires in the hook-blocks ledger, the analyzer's scorecard shows the behaviour holding across sessions - is deleted or converted to a hook, never kept as insurance, because it pays rent on every message for nothing. (10)
- Earns always-on residency. Content that is relevant to most sessions loads unconditionally; content relevant only to a subset of files sits behind a `paths` glob; content relevant only occasionally lives in a skill. An unconditional rule that matters in a tenth of sessions is paying rent nine times out of ten - and, because the injection is framed as 'may or may not be relevant', it is also the rule most likely to be ignored when it does matter. Classify every block by the placement map above (every session / on a file type / while reading a subtree / for a task) and score the block against the home that class names. (8)
- Right tier. Team-shared standards in project scope, individual preference in user or local scope, org policy in managed scope. Individual preference committed into a shared project file, or team standards stranded in a local file, are both defects. (7)
- Path globs are correct and tight. Where `paths` is used, the patterns actually match the intended files, and are neither so broad they load everywhere nor so narrow they silently drop coverage the rule is supposed to have; brace expansion stays inside the 1,000-pattern budget, and a monorepo that needs whole subtrees excluded uses `claudeMdExcludes` rather than narrower globs on every rule. (5)

Floor for A: >= 26/30.

## Dimension 2 - Rule quality and enforceability (30 pts)

- Specific and verifiable. Each rule is concrete enough that you could check compliance by looking at a diff. 'Use 2-space indentation' works; 'format code properly' does not. Vague or aspirational rules are worse than absent ones, because they consume context and produce inconsistent behavior. The shape that measurably generalizes is imperative plus consequence plus mechanism ('Per-row UpdateOne, never UpdateMany - a bad UpdateMany filter once polluted 4,143 documents'): the rule, what goes wrong without it, and why. This stack's 'measured:' clauses ARE that consequence clause - keep the one that carries the reason, cut a second number that restates it. (9)
- No conflicts. The file does not contradict another loaded file, another tier, an existing hook or permissions entry, or a skill or agent it routes to. Scored against the conflict map. (8)
- Escalation is correct. Rules whose violation is expensive, and which the author clearly needs to hold every time, are escalated to a hook or permissions entry rather than left as prose and hoped for. Where escalation is not possible, the rule at least states the consequence so it is followed for a reason. An escalated rule is checked at both ends: the hook it points at must actually block (`permissionDecision: deny` or exit 2, not exit 1 or advisory stdout), and the prose that survives is a one-line pointer to that gate, never a second full statement of the mandate. (6)
- Imperative, logically structured, and explains why where the reason is not obvious. The rule set reads as an organized system, not an accumulation: one concern per file with a descriptive filename (`testing.md` beats `rules3.md`), files grouped into subdirectories by domain where the set is large (`frontend/`, `backend/`), and within a file, markdown headers grouping related rules with ordering that follows importance or the workflow the rules govern. A rule set where a reader cannot predict which file holds a given rule scores low even if each rule is individually well written. Rigid all-caps MUST or NEVER walls score lower than the same rule with a reason attached, except where the rule is a genuine safety, security, or compliance invariant. Emphasis is a budget of one across the loaded set; a rule Claude keeps ignoring despite emphasis is evidence the set is too long or the line ambiguous, and the fix belongs to Dimension 3 or to a rewording, never to louder wording. (7)

Floor for A: >= 26/30.

## Dimension 3 - Token efficiency (20 pts)

Leanness within a single file. This dimension is scored harder than in the skill and agent rubrics, because rule content is paid on every session with no trigger to amortize it.

- Every line changes behavior. No project trivia, no narration, no restated documentation, no filler a reader could infer from the code. Delete-on-sight, not rewrite-on-sight. (8)
- Size is disciplined, measured in tokens. Report each always-on rule's characters and approximate tokens and the set's total - where the repo has a mechanical cap (here lint check 33 over the pathless rules plus every skill and agent description) it must be green; rule files stay focused on one topic and far shorter than a CLAUDE.md. Oversized files consume context and measurably reduce adherence, so a large file is a correctness problem, not just a cost problem. Count instructions as well as tokens - directive sentences across the always-on set - and report the total against the community 150-250 band (this stack's seven always-on rules measured 170 non-empty lines, 25,082 chars (~6.3k tokens) and 92 bullets on 2026-09-29, before the project CLAUDE.md and the descriptions are added; the earlier six-rule set counted ~220 directive sentences, with 48 zero-exception lines - the always / never / every-time class the placement map routes to hooks - so re-count both). `/context` (and `/context all` for per-MCP-tool costs) is the live measurement of what loaded; `/doctor` (v2.1.206+) proposes trims for a checked-in CLAUDE.md and its cuts are the derivable class - take them. (5)
- Conditional content is actually conditional, behind a `paths` glob or in a skill. Note carefully: content moved into an `@path` import is still loaded at launch and still costs the same tokens. Reorganizing into imports scores nothing here. Only real deferral scores. (5)
- Maintainer notes, where useful, sit in block-level HTML comments, which are stripped before injection and therefore free. (2)

Floor for A: >= 17/20.

## Dimension 4 - Reuse and non-duplication (20 pts)

Scored against the duplication map. This is a system-level property: a file loses points for content it duplicates, even if it reads well alone.

- No procedure is restated that a skill or agent already owns. The rule points to the skill or agent - by name where the same install unit guarantees it, by what it covers otherwise - or is deleted if the skill fully covers it. This is the highest-value reuse channel, since it converts always-on tokens into on-demand tokens. (7)
- No rule text is duplicated across rule files or across CLAUDE.md tiers. Shared content lives in exactly one file at the correct tier. Where the same rule genuinely must apply in several projects, share it by symlinking into `.claude/rules/` rather than copying it. (6)
- Repo documentation is referenced or imported, not restated. If an `AGENTS.md` exists, CLAUDE.md imports it rather than carrying a second copy that will drift. Do not paste README or style-guide content into a rule. (4)
- Reuse is proportionate and named. Small incidental overlaps stay local rather than being abstracted into coupling for no saving, and any file a rule depends on is named explicitly - or, where the install can lack it, described by what it covers - so the layer stays debuggable. (3)

Floor for A: >= 17/20.

## Grade bands

| Total | Grade | Numeric |
|-------|-------|---------|
| 90-100 and all floors met | A | 9 |
| 80-89 | B | 7-8 |
| 65-79 | C | 5-6 |
| 50-64 | D | 3-4 |
| < 50 | F | 1-2 |

A file reaches A / 9 only when the total is >= 90 and every dimension clears its floor. This is deliberate: it blocks acing some dimensions and averaging away a weak one. A beautifully written, specific, lean rule that should have been a hook is not an A rule, because it promises enforcement it cannot deliver. A well-written rule that contradicts another loaded rule is not an A rule either, because the contradiction makes both nondeterministic and no amount of local polish fixes it.
