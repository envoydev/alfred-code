---
name: alfred-capture-related-projects
description: "Use when the user names sibling repos to capture - 'capture the related projects', 'map the sibling repos'. Not for this repo's own architecture."
disable-model-invocation: true
---

# Project Related Context - Capture the Sibling Repos (Deliberate)

You drive the deliberate capture of a project's related repositories, and you own both tiers of the house related-projects model:

1. `.claude/rules/alfred-project-related-context.md` - the generated AWARENESS rule: pathless, so it loads every session and every subagent - the minimum that makes the siblings exist for the agent (name / location / relation / seam), plus the trigger to read the doc when a task touches a seam.
2. `<docs-path>/related-projects/RELATED-PROJECTS.md` - the on-demand ORIENTATION doc: the full entries including `first_read` and the evidence behind each relation and seam, read when actually working near a seam. Its folder `<docs-path>/related-projects/` is a docs domain holding ONLY this doc, its `references/` and its `watch.json` - this capture is the sole author, and nothing else belongs there. Every OTHER doc tied to a sibling repo - a cross-repo plan, a change request, an issue note, a sibling's run recipe - is filed instead in the plain folder `<docs-path>/related-context/`, by any session that produces one; that folder carries no `watch.json` of its own, so the docs engine never lists, sections or asks about anything filed in it. A location outside the docs root takes the user's explicit approval first, per the docs-root baseline.

Both are generated files; a re-run refreshes both in place. The rule's name is deliberately NOT in the stack installer's catalog (and never may be - a copy would overwrite the generated one) and no installer ledger records either file, so `/alfred-code:update` never touches them. Whether git carries the doc follows `node .claude/hooks/docs.js status`, never a default: `mode: git` - committed and versioned per branch, so it ships with the repo; `mode: overlay` - kept out of git, so a fresh clone re-runs the capture. The rule ships only where the project commits `.claude/rules/`.

**Args-driven, never a scan.** The user names the related projects - local paths or git URLs, optionally with a relation hint each (`../backend`, `git@github.com:org/shared-contracts.git provides-to`). In-repo sub-projects are siblings too: `./server`, `./client` in a monorepo are valid locations, and their entries give alfred-task-solve-cross the dependency direction for producer-first ordering. No args: ask for them via AskUserQuestion (free text via Other - never options scraped from a filesystem scan; a plain-text ask where the harness lacks the tool) and stop. Do not guess at siblings from the filesystem.

## When to use

- Passing local paths or git URLs: it analyzes what you name, it never scans.
- Characterizes each sibling and writes BOTH tiers: the always-on awareness rule `.claude/rules/alfred-project-related-context.md` (name / location / relation / seam per sibling) and the on-demand orientation doc `related-projects/RELATED-PROJECTS.md` under the docs root. Re-run to refresh - entries upserted, unlisted ones kept.
- Not this repo's own architecture (alfred-capture-architecture), and not dynamic cross-repo findings (those go to the shared `memory` MCP, tagged with the sibling's name).

## Execution modes
DELEGATED vs INLINE keys on dispatch capability, not file presence. When dispatch is available (and the seat exists), ask ONE question before the fan-out, via AskUserQuestion - characterize the siblings via the read-only seats that characterize one sibling repo each (recommend it: the seats absorb the reads), or in-session? - then pick once, hold for the run:

- **DELEGATED** (the user chose seats) - fan out related-project-analyzer per sibling as below, exactly as the roster spells it (`alfred-code:<seat>` where the core plugin carries it); you merge and write.
- **INLINE** (chosen - or forced, no question asked: no dispatch (Cursor), or that seat is absent, which this opt-in capture must tolerate: it ships outside the always-installed baseline, so a project can carry the skill without the seat) - do the same characterization in-session, one sibling at a time, honoring the agent's own rules (both-sides cross-reference evidence, verified first_read, 3 locating passes, UNVERIFIED over fabrication; a URL sibling is shallow-cloned to scratch and removed after) - then continue at MERGE identically.

## The run

### 0. MODE - the one ask
Resolve the Execution modes question above NOW, via AskUserQuestion, before anything else in this run - the ask is a numbered step because a preamble-only ask gets skipped straight past to the fan-out (measured: one run dispatched 4 seats with zero asks). One exception: a bare invocation with no args fires the no-args ask ('Args-driven, never a scan' above) INSTEAD and stops - there is nothing to pick a mode for yet; when both questions are open they join the same AskUserQuestion call.

### 1. VALIDATE - the arg list
For each location: a path must exist (relative resolved from the project root), a URL must look like a git remote. An invalid location is reported and skipped, never silently dropped. Note each relation hint - it travels to the agent as a prior, not a verdict.

### 2. FAN OUT - one analyzer seat per sibling, in parallel
Dispatch all seats in a single message. Each dispatch prompt carries: the HOST project's root and identity (name + package/assembly ids - read them once from the manifest files first), ONE sibling location, and its hint if given. The agents write no files; their final messages - one YAML entry + evidence + uncertainty each - are your merge input. An agent returning UNVERIFIED fields is a valid result: both tiers record what could not be read.

### 3. MERGE - write <docs-path>/related-projects/RELATED-PROJECTS.md
`<docs-path>/related-projects/` is a docs domain like every other - it carries its own `watch.json`, so
`domains()` in `.claude/hooks/docs.js` picks it up and the engine sections and lints it exactly like
`architecture/` or `code-style/`. Create the folder when absent, with a `watch.json` holding `{}` -
deliberately EMPTY: a sibling repo's characterization is not falsified by a change in THIS repo, so no
glob exists whose match should ask whether an entry still holds; the empty file states that intent in
the repo rather than leaving it to memory. Nothing here is `notOwned` either - this capture is the sole
author of `RELATED-PROJECTS.md`, so an ordinary write (or an ordinary `docs.js set` on a branch) is
always allowed, unlike `decisions/`.

Legacy layout: a `PROJECT-RELATED-CONTEXT.md` sitting loose at the docs root itself (the pre-folder
home) is MOVED into `related-projects/` as `RELATED-PROJECTS.md` and reconciled there - never left
behind as a stale twin. Consolidate into one doc - apply the `markdown-style` skill so it reads as a
quick reference. Shape:

1. The `Captured: <branch>@<short-sha>, <date>` lifecycle stamp, then one opening line - what the doc is: the durable orientation detail for cross-repo work; the always-loaded awareness minimum lives in the generated rule; dynamic findings go to the shared `memory` MCP instead, tagged with the sibling's own name, never here. Stamp nuance for THIS doc: the entries describe the SIBLING repos as read on that date - the date is the staleness signal (siblings drift on their own), while this repo's branch matters little; re-running the capture for a sibling upserts its entry, which is this doc's whole update path.
2. **One `##` heading per sibling**, `<!-- id: <slug> -->` and deliberately NO `covers:` - nothing
   in this repo's code should trigger a re-read of a sibling's own characterization (`docs.js lint`
   notes a section that declares no `covers:`, but never fails on one). Each heading carries the
   house schema entry as a fenced YAML block (location, relation, first_read, seam, its own
   `captured:` stamp) followed by a short evidence note: what grounds the relation and seam (the
   located files, both sides), plus any uncertainty or UNVERIFIED marker carried over verbatim. Keep
   each note lean - orientation, not an audit.

`references/artifact-shapes.md` carries both shapes verbatim - the section entry with a filled
example, and the generated rule below - plus the per-entry provenance rule that makes a
branch-born seam readable, and the write mechanics for a mainline write versus a feature branch's
overlay. Read it before writing either file.

### 4. RULE - write .claude/rules/alfred-project-related-context.md
The awareness tier, generated from the same entries - a valid PATHLESS rule (frontmatter with a `description:` and NO `paths:`, so it is always-on). Keep it to the awareness minimum; describe edges, not roles:

The body is the copy target in `references/artifact-shapes.md` - take it verbatim and fill only
the entry block: name / location / relation / seam per sibling, NO `first_read` (that detail is
the doc's job), and the trailing `(captured on <branch>)` marker where an entry was captured off
the base branch.

Create `.claude/rules/` when absent. The rule is regenerate-only: entries come from the reports, the three closing bullets are fixed - never hand-edit the copy, never let the rule grow evidence or first_read detail (always-on tokens are paid every session and every subagent; the fat stays in the doc).

**Re-run is an upsert, keyed by `location`, in BOTH files.** A sibling passed this run: its entry (and doc note) rewritten from the fresh report. An existing entry whose location was NOT passed: kept exactly as-is (removal is a manual edit - report which entries you left untouched so stale ones are visible). Both files converge; they never accumulate duplicates, and their entry sets never drift apart - the same run writes both.

### 5. REPORT
Verify before reporting: the generated rule's frontmatter parses and carries no `paths:` key, and every `first_read` path in the doc resolves in the sibling it names - a first_read never lists a doc that was not verified to exist. Then confirm both artifacts (rule created/refreshed + entry count; doc created/refreshed + entries rewritten vs kept; any location skipped as invalid or UNVERIFIED). State where each landed - the doc by the `mode:` line `node .claude/hooks/docs.js status` prints (`git`: committed with the repo; `overlay`: kept on this machine). No re-paste of either body - point to the files.

## Handing work to a sibling project

A session belongs to ONE project: a change the capture shows a sibling must make is handed off as a
task card, never written into that repo. At REPORT, when the capture surfaced work the other side
owns, Read `references/sibling-handoff.md` and write the card as it says.

## Don't game it
Every entry is grounded in the agent's located evidence or carries its UNVERIFIED marker into both tiers - a relation is never smoothed over, a hint never overrides contradicting evidence silently (the contradiction is reported), a first_read never lists a doc that was not verified to exist. Unreachable siblings stay in both files as UNVERIFIED entries, not silently dropped - the reader deserves to know a seam exists even when it could not be read.
