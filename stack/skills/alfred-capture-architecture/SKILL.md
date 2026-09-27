---
name: alfred-capture-architecture
description: "Captures or refreshes the project's architecture docs - the structure map and the always-on architecture rule. Use when the user asks to capture, document or refresh the architecture, or asks what the project's structure or module boundaries are. Deliberate only, never mid-build; not for fixing what it finds, code style, test coverage, or a pros/cons judgement of the architecture - that reads this map."
---

# Project Architecture Analyzer - Capture the Architecture (Deliberate)

You are the architect seat: you build the project's architecture picture by reasoning over cheap digests and record it as `<docs-path>/architecture/ARCHITECTURE.md` (the map) and `.claude/rules/baseline-project-architecture.md` (the always-on pointer). The reading is delegated to architecture-analyzer; the judgment is not - you aggregate, reconcile and write in-session. This is capture only: the pros/cons over the map is a separate capture, matched from your skill list by what it covers, and `alfred-loop-architecture-quality` runs both.

**Model check at run start.** No `model` pin, deliberately: a skill-level `model` pin applies only for the rest of the turn in which the skill activates and is not saved to settings - set the session to Opus with `/model` before a capture; not on Opus, say so in the first thing the user sees. `references/capture-in-full.md` carries every step below with its reasons - read it on a first capture. Read `references/doc-shapes.md` and `references/hazards.md` before AGGREGATE; `vocabulary-roles.md` and `report-fields.md` at their step.

## Execution modes

- **Zero drift exits first.** With docs and a `Captured:` stamp present, run `git diff --name-only <stamp-sha>..HEAD` and `git status --porcelain`; empty against a clean tree: report `docs current at <branch>@<short-sha>, captured <date> - no drift, nothing rewritten` and stop.
- **FIRST capture** (no docs or no stamp; a provisional `ORIENTATION.md` is overwritten) - when dispatch is available, ask ONE question before gathering - architecture-analyzer seats (recommended) or in-session - unless a calling loop picked it; a declined ask is re-asked, never inferred.
- **UPDATE** - INLINE, scoped to the modules the stamp diff names; escalate to per-module dispatch when the diff spans many modules, the stamp is unreachable or `+dirty`, or the user asks for agents.
- **Write gate** - any run whose target doc exists asks ONE question before the first byte: refresh the capture (recommended) / stop and report the drift; no answer, no write; recorded on the REPORT's `Write gate:` line.

## The run

1. **ORIENT** - read the existing map (a claim to verify); `node .claude/hooks/docs.js status` decides the branch model (`mode: git` writes in place, `mode: overlay` on a feature branch lands sections with `docs.js set`); build the module inventory from a listing (on an UPDATE, the drifted modules).
2. **GATHER** - the architecture-analyzer AGENT (`subagent_type: architecture-analyzer`) per module, in one message, the smallest modules merged, a huge one `depth: quick` first; each brief says locate first, never a whole file. You are the expensive seat: never read the codebase wholesale yourself; a spilled digest is grepped, never read whole.
3. **AGGREGATE + REASON** - read `references/vocabulary-roles.md`, LIST the installed skills, pick each role by what a candidate covers (an absent role is read from the code - never a remembered name), and name them on the `Vocabulary:` line. Assemble the structure and reconcile it against the docs; prove every edge from a usage and every absence from the source of truth; hunt `references/hazards.md` for the stack. Judging weaknesses is not this skill's act.
4. **RE-GATHER on the gaps** - a contradiction on a CHECKABLE fact: settle it with the cheapest deterministic probe in-session first. **Hard cap: 3 gather rounds.**
5. **WRITE** - only after the write gate and ALL verification: two passes at most (the composed write, and the spill only if the doc is over budget), `docs.js status` quoted after the first write, never a per-claim edit stream. Every doc opens with `Captured: <branch>@<short-sha>, <YYYY-MM-DD>` (`+dirty` when the tree holds uncommitted work) and every section carries its `<!-- id: -->` / `<!-- covers: -->` lines per `references/doc-shapes.md`; write `ORIENTATION.md` and `watch.json` too, run `docs.js lint`, measure (`docs.js toc` on the overlay route, `wc -l` elsewhere) and spill if over. Write only under `<docs-path>/architecture/`.
6. **RULE** - regenerate `.claude/rules/baseline-project-architecture.md` to the doc-shapes template (pathless, the docs root baked literal): READ the existing rule first so the Write is legal, `wc -c` it, re-trim past 300 bytes. Generated, never fetched - the installer's manifest must not list this rule.
7. **REPORT** - read `references/report-fields.md`; the files written, gather rounds, the structure headline, anything unverified; then the receipt lines, one per field: `Vocabulary:`, `References:`, `Write gate:`, `Write passes:`, `Rule:`, `Model:`.

## Don't game it
Record the structure that exists, not the one the names imply - every claim traced to located code, anything unverified marked so. Re-measure every COUNTABLE claim a digest returns with one command before it enters the doc.
