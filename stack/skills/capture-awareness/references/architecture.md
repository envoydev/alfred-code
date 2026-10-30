# Architecture awareness - capture the architecture map (deliberate)

Read when the architecture part runs (`/capture-awareness architecture [<target>]`). You are the architect seat for this run: you build the project's architecture picture by reasoning over cheap digests, and you record it as the structure map, `<docs-path>/awareness/ARCHITECTURE-AWARENESS.md`, with its references, its history and the orientation block every session is pushed. The awareness rule's map line - written by the router's close, never by this part - points every session at it.

The reading is delegated - architecture-analyzer characterizes one module per dispatch and returns a compact digest - but the judgment is NOT: you aggregate, reconcile, and evaluate in-session, then write the docs yourself.

**Model: the session's.** The judgment runs on the model the session is on; ask for no switch - the lighter model matched the heaviest here at the same cost (`architecture-evidence.md`). No `model` pin either - a skill-level pin lasts only for the turn it activates in. The REPORT step's `Model:` line names the model the judgment ran on.

The measurements behind these rules live in `architecture-evidence.md` - an audit appendix, not a run-time load.

This is capture only: it maps the structure, it does not judge it. The pros/cons read over this map - weaknesses, strengths, tiered and gated - is a separate deliberate capture, recomputed fresh every run rather than stored here, matched from the installed skill list by what it covers. The per-change fit verdict (extend / refactor first / isolate) is the domain solution-designers', reading the map this part writes. Not for fixing what it finds, code style or test coverage, and never mid-build.

Read `architecture-doc-shapes.md` (the map's required shape and the write protocol) and `architecture-hazards.md` (the stack-keyed hazard catalog) before AGGREGATE - they are this part's contract, not suggestions. `architecture-vocabulary-roles.md` and `architecture-report-fields.md` are read at their step; the report's `References:` line records every one of them.

**An install not yet updated.** When the map still sits at the legacy home, `architecture/ARCHITECTURE.md` under the docs root, write nothing: report `the map is at the old home - /alfred-code:update moves it` and stop. A write at the new home beside it would leave two maps.

## Execution modes

**The cheapest run is decided first: a zero-drift UPDATE exits before anything else loads.** Where the docs and a `Captured:` stamp already exist, run `git diff --name-only <stamp-sha>..HEAD` and `git status --porcelain` BEFORE reading on. An empty diff against a clean tree (no `+dirty` on the stamp) means the docs already describe this commit: report `docs current at <branch>@<short-sha>, captured <date> - no drift, nothing rewritten` and stop - no other reference loads, no vocabulary skills, no gather, no doc write. Everything below is for a FIRST capture or a run with real drift.

The dispatch decision then keys off FIRST RUN vs UPDATE, not preference - pick once, hold for the run:

- **FIRST capture** (no existing docs, or no `Captured:` stamp; an `ARCHITECTURE-ORIENTATION-AWARENESS.md` headed 'provisional - replaced by the architecture capture' is the first-look scan's, never a capture - overwrite it, no write gate) - when dispatch is available, ask ONE question before gathering, via AskUserQuestion - characterize the modules via architecture-analyzer seats (recommend it: the cheap seats absorb the reads), or in-session? - unless the mode is already answered: the router's chain asked it, or a mode word after the topic (a calling flow, a quality loop) picked the run's mode, which is inherited, never re-asked. An interrupted or declined ask is answered by RE-ASKING, never by inference - a re-invoked slash command after a 'skip' answer is a new run that asks again, not consent for the declined one. DELEGATED: dispatch architecture-analyzer per module as below; reasoning and writing stay here. INLINE (chosen, or no dispatch): characterize the modules yourself, navigation-tools-first and bounded, and continue at AGGREGATE identically.

  ```ask
  First architecture capture across <the modules>. Characterize them through the architecture-analyzer seats or in this session?
  - 'Through the seats (Recommended)' - the cheap seats absorb the reads; the reasoning and the write stay here
  - 'In this session' - navigation-tools-first and bounded, no dispatch
  ```

- **UPDATE** (docs + stamp exist) - INLINE in this session: `git diff --name-only <stamp-sha>..HEAD` scopes the drift. Zero drift already exited above; anything non-empty is a real update: verify + reconcile ONLY the touched modules (navigation-tools-first, located reads) - the rest of the doc stands on the prior capture. A `+dirty` stamp breaks that trust, so its claims are verified beyond the diff, not assumed - the one escape hatch is in architecture-doc-shapes' stamp section. Escalate back to per-module dispatch for the drifted modules when the diff spans many modules, when the stamp's sha is unreachable (a rebase) or `+dirty` - a first-run-sized job wearing an update's name - or when the USER explicitly asks for agents: their ask always wins over the inline default.

**Write gate - any run whose target doc already exists asks before the first byte.** The rewrite replaces a doc the user may still want as it stands, so before the first write of the run put it through ONE AskUserQuestion (free text via Other; plain-text options where the harness lacks the tool), asked once and held for the run - unless the router's chain answer or a mode word after the topic already gave this part its run gate:

```ask
<docs-path>/awareness/ARCHITECTURE-AWARENESS.md already exists (<its Captured: stamp>). Refresh the capture over it?
- 'Refresh the capture (Recommended)' - the branch check in step 1 decides whether it lands in place or through `docs.js set`
- 'Report the drift only' - nothing is written; the docs stay as they stand
```

An earlier session's answer is not consent for this run - a `ruled:` line in the injected session history included - so ask again: the ruling it would rely on came from a capture that never landed. Two runs skip it because they write nothing to replace: a FIRST capture (no doc to overwrite) and a zero-drift UPDATE (it exits before step 5). No answer, no write - never fall through to the overwrite, and record the answer on the REPORT's `Write gate:` line.

## The run

### 1. ORIENT
Read `<docs-path>/awareness/ARCHITECTURE-AWARENESS.md` if it exists - a claim to verify, not ground truth - and note which `<docs-path>/awareness/references/` files are yours versus user-authored.

**Branch model first** - the docs follow git through `node .claude/hooks/docs.js` (the docs hook's engine): `docs.js status` names the mode and branch, and THAT line decides - the mode is declared at install time, not inferred from what happens to be committed. `mode: git` means git versions the docs per branch, so a capture writes in place and the commit carries it. `mode: overlay` on a feature branch means that branch's sections live in an overlay, so a capture there lands each changed section with `docs.js set <file>#<id>` and never rewrites the mainline files. On mainline, or without git, a capture writes in place. When `.claude/hooks/docs.js` is absent (the docs hook deselected), write in place and say in the report that branch versions are off.

Read the config/manifest files for framework and package facts. Build the module inventory (a directory listing; a file's outline is per FILE, for the files that matter, never a directory) - the list of areas to characterize. Scope it if the user did (the part's target); whole project otherwise - and on an UPDATE, the inventory is the drifted modules the stamp diff names, not the whole project.

### 2. GATHER - architecture-analyzer per module, in parallel
Dispatch the architecture-analyzer AGENT - the Agent tool, its `subagent_type` spelled exactly as the roster spells it (`alfred-code:architecture-analyzer` where the core plugin carries it), never a tool of that name - per module/topic on the inventory, batched into a single message where the areas are independent, up to `ALFRED_CODE_MAXIMUM_RUN_AGENTS` at once (default 5); merge the smallest modules into ONE combined dispatch rather than one each, since the fixed preload costs the same per seat whatever it returns. A module too large for one seat's two passes (hundreds of files) is briefed `depth: quick` first and re-dispatched `depth: deep` only on the part the map needs. Each brief tells the seat to locate with the navigation tools and read only the ranges that matter, never a whole file, before its first tool call. Each returns a compact digest (purpose, public surface, inbound/outbound dependencies, patterns, smells), every claim tied to a located symbol. You are the expensive seat: never read the codebase wholesale yourself - the navigation tools (a file's outline, a symbol, its callers) and `Read` are for light orientation and spot-verification of one edge only. A digest the harness spilled to a persisted `tool-results/*.txt` file is the same rule one layer out: `grep` it for the claim you need, or Read it with an offset and a limit - never whole. After the dispatch, end the turn: each hand-back arrives on its own, and a notification poll only re-sends the context.

### 3. AGGREGATE + REASON - in-session
Load the vocabulary you reason with by MATCHING it, and make the match an ACTION with an output rather than a caution you read past: Read `architecture-vocabulary-roles.md` now - the roles to fill and the stacks that ship no match. Before the first load, LIST what this project actually has (`ls .claude/skills`, plus the plugin skills your own skill list shows), pick each role by what a candidate's description says it COVERS, and put the chosen names in the report's `Vocabulary:` line. A role with no match in that listing is ABSENT: read the code instead and say so - never load a name from memory.

Then two acts, in order:

1. **Assemble.** Put the digests together into the structure - layers, dependency directions, patterns, boundaries - and reconcile against the existing docs: declared vs enforced part company exactly where coupling escapes the static graph (the hunt list opens `architecture-hazards.md`).
2. **Prove.** Treat a name as a hypothesis, an edge as proven only from a usage - and an ABSENCE as proven only from the source of truth (the wire schema, the decompiled model, the vendor contract): a grep over usages proves the code does not USE the thing, never that the thing does not exist. Hunt the hazard catalog for the stack in play.

Judging what these proven facts mean - a weakness, a strength, a tier - is not this part's act. That reasoning, gated, is the separate pros/cons capture named above; it reads what you assemble and prove here.

### 4. RE-GATHER on the gaps
Where a part is unclear or uncovered, dispatch architecture-analyzer again on exactly that topic. Where two digests contradict each other on a CHECKABLE fact, settle it with the cheapest deterministic probe in-session first - a `grep -c`, a navigation lookup, the stack's own command - and re-dispatch only for a judgment conflict no command can settle. **Hard cap: 3 gather rounds.** Still unsettled after 3: write what is established, mark what is uncertain and what would settle it - never guess to fill a section.

### 5. WRITE - the map, per architecture-doc-shapes.md

**Preconditions, both checked before the first write: the Execution-modes write gate has been answered (where the target doc already exists), and verification is FINISHED.**

- **Close the loop.** The first write is followed immediately by `node .claude/hooks/docs.js status`, its output quoted on the `Write passes:` line as the proof the write closed the loop - no probe that checks a code claim runs after that quoted line - no seat dispatch and no source read either. The write is the last act, not a workspace: a claim you discover you still need is QUEUED, and the queue is drained in ONE closing pass once every probe is done.
- **Two passes, no more.** Two passes are sanctioned and no more: the composed write, and - only where the post-write `wc -l` says the doc is over its budget - the spill restructure. Both are counted on the `Write passes:` line; a third pass is the defect this precondition exists to stop, and when one happens anyway the report says so rather than hiding it.
- On the overlay route, one `docs.js set` per changed section is pass one - `architecture-doc-shapes.md` 'Branches' has the count rule.

What the write lands:

- Every doc this capture writes opens with a stamp line - `Captured: <branch>@<short-sha>, <YYYY-MM-DD>`, `+dirty` appended when the working tree holds uncommitted changes - and every `##`-`####` section carries `<!-- id: -->` and `<!-- covers: -->` comment lines under its heading, per the **Section format** in `architecture-doc-shapes.md`; on a feature branch with ignored docs, sections land through `docs.js set` (step 1).
- The capture also writes `<docs-path>/awareness/ARCHITECTURE-ORIENTATION-AWARENESS.md` to its shape there - the path the docs hook pushes it from - merges its own `architecture: ` entries into `<docs-path>/awareness/watch.json` (architecture-doc-shapes.md 'watch.json'), and moves round history under `history/`.
- Write the map to its required shape; counts are outputs, never targets or caps. Compose the reconcile in-session and land it in one write (or one batched edit pass) - never a per-claim edit stream. Write ONLY the map's files under `<docs-path>/awareness/` - the map, its `references/` and `history/`, the orientation block and this part's watch entries - never source, never another doc.
- After the write, run `node .claude/hooks/docs.js lint awareness --map`: fix every PROBLEM row before the report. Another part's row (a plain `lint` prints every part and domain) is named in the report, never fixed here.
- **Measure after the write.** After the write, measure the doc against architecture-doc-shapes' stated target - the map is read at every dispatch's orientation, so its weight is paid on every seat. On the overlay route measure with `node .claude/hooks/docs.js toc <file>`, which sums the sections THIS branch reads, overlays applied; `wc -l` on the mainline file there measures text that does not hold the branch's sections at all, so the budget decision would be taken on the wrong doc. Everywhere else `wc -l` the file. Over target, run the spill pass NOW - this run owns the doc, and no other flow will; an overrun this run genuinely cannot resolve is said plainly in the REPORT step, for the next capture to pick up.

### 6. REPORT
Read `architecture-report-fields.md` now - it defines every field below and the RESUME BLOCK shape. Confirm the files written (created vs refreshed), then lean: gather rounds used and whether the picture settled within the cap, the structure headline, anything unverified and what would settle it. Then the receipt lines - one per field, UNCONDITIONAL, a named field being what makes its step actually run and the record that nothing was silently trimmed: `Vocabulary:`, `References:` (which of this part's `architecture-*.md` references this run actually Read), `Write gate:` (the answer verbatim, or why the run skipped the ask), `Write passes:`, `Rule:` (the router close's `--rule` verdict - the map line it wrote, or why none), and `Model:` - the model the judgment ran on, plus the exact `/model` command for the USER to paste where the run was raised, in one of the reference's two shapes; never a claim about how it got there or that a reset happened, since `/model` has no assistant-invokable equivalent. No re-paste of the doc bodies - point to the files. One line per named field, a table where a field lists several items: the answer budget caps prose (tables are exempt), and the receipts fit inside it, not trimmed away.

## Don't game it
Record the structure that exists, not the one the names imply - every claim traces to code you or an architecture-analyzer located, and anything unverified is marked unverified, never rounded up to certainty. Re-measure every COUNTABLE claim a digest returns - a line count, an N-of-anything, a file:line ref - with one command before it enters the doc: counts are the measured failure mode, and a too-clean look is not the trigger. Prose characterizations may stand on the digest; numbers may not.
