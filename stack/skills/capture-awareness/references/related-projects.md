# Related projects awareness - the sibling repos and the seams that bind them

Read at step 3. `RELATED-PROJECTS-AWARENESS.md` makes the siblings exist for every session: per sibling its
location, its relation, the seam between the two repos and the docs to read first over there. The rule imports it
whole, so each entry stays lean - orientation, not an audit. This capture is the doc's sole author.

## Contents

- **Args-driven, never a scan** - the user names the siblings
- **Execution modes** - one seat per sibling, or in-session
- **The run** - validate, characterize, merge
- **The doc's shape** - the preamble, one section per sibling, per-entry provenance
- **Write mechanics** - first capture whole, a re-run as an upsert
- **Handing work to a sibling** - the task card, never a write over there

## Args-driven, never a scan

The user names the related projects - local paths or git URLs, optionally with a relation hint each
(`../backend`, `git@github.com:org/shared-contracts.git provides-to`). In-repo sub-projects are siblings too:
`./server`, `./client` in a monorepo are valid locations, and their entries carry the dependency direction a
cross-domain build orders by. Never guess at siblings from the filesystem: with no arguments and no doc, the step-3
ask in SKILL.md takes the locations as typed text. A location outside the docs root for any file this step writes
takes the user's explicit approval first, per the docs-root baseline.

## Execution modes

DELEGATED vs INLINE keys on dispatch capability, not file presence. When dispatch is available (and the seat
exists), ask ONE question before the fan-out, via AskUserQuestion - characterize the siblings via the read-only
seats that characterize one sibling repo each (recommend it: the seats absorb the reads), or in-session? - then
pick once, hold for the run. When the siblings ask of SKILL.md step 3 is open too, both questions go in the same
AskUserQuestion call.

```ask
Characterize <the siblings> through the related-project-analyzer seats, one per sibling, or in this session?
- 'Through the seats (Recommended)' - the read-only seats absorb the reads; the merge and the write stay here
- 'In this session' - one sibling at a time, no dispatch
```

- **DELEGATED** (the user chose seats) - fan out related-project-analyzer per sibling as below, exactly as the
  roster spells it (`alfred-code:<seat>` where the core plugin carries it); you merge and write.
- **INLINE** (chosen - or forced, no question asked: no dispatch, or that seat is absent - it is an opt-in pick, so a
  project can carry this capture without it) - do the same characterization in-session, one sibling at a time,
  honoring the seat's own rules (both-sides cross-reference evidence, verified first_read, 3 locating passes,
  UNVERIFIED over fabrication; a URL sibling is shallow-cloned to scratch and removed after) - then continue at
  MERGE identically.

## The run

1. **VALIDATE** - for each location: a path must exist (relative resolved from the project root), a URL must look
   like a git remote. An invalid location is reported and skipped, never silently dropped. Note each relation hint
   - it travels to the seat as a prior, not a verdict.
2. **CHARACTERIZE** - DELEGATED: dispatch up to `ALFRED_CODE_MAXIMUM_RUN_AGENTS` seats in one message (default 5), the next as each hands back. Each prompt carries the HOST project's root
   and identity (name + package or assembly ids - read them once from the manifest files first), ONE sibling
   location, its hint if given, and the `read_at:` its entry already carries in the doc (a re-capture starts from
   what changed since). The seats write no files; their final messages - one YAML entry + evidence + uncertainty
   each - are the merge input. A seat returning UNVERIFIED fields is a valid result: the doc records what could not
   be read.
3. **MERGE** - write the doc to the shape below. Check before reporting: `node .claude/hooks/docs.js lint awareness`
   (fix every PROBLEM row) and `test -e <sibling>/<first_read>` for every `first_read` path - a first_read never
   lists a doc that was not verified to exist.

The answer 'None - a standalone repo' writes the doc with its preamble and no entry, so a later run keeps it and
asks nothing; the rule step imports the doc only once it holds an entry.

## The doc's shape

````markdown
Captured: <branch>@<short-sha>, <date>

# Related projects

This repo is one of several that make up a product: the siblings, and the edges that bind them. Dynamic
cross-repo findings go to Claude Code's own memory, naming the sibling, never here.

- A task card addressed to THIS repo is written in the SIBLING's tree, under its own docs root's
  `work/cross-project-tasks/<this repo>.md` (a sibling not yet on 2.8.0: `cross-project-tasks/` at its root) - search
  both before calling a named card absent.
- The navigation tools bind to THIS repo: Read/Grep a sibling directly, but symbol-navigate it only from a
  context rooted there.
- An entry's `captured:` names the branch it was read on: on any other branch, verify its seam exists before
  relying on it.

## acme-billing-api
<!-- id: acme-billing-api -->
<!-- covers: src/Contracts/OrderCreated.cs -->

```yaml
location:   ../acme-billing-api
relation:   provides-to
first_read: [.alfred/docs/architecture/ARCHITECTURE.md]
seam:       the OrderCreated contract in src/Contracts - this repo publishes, billing consumes
read_at:    main@9f8e7d6
captured:   develop@a1b2c3d, 2026-07-24
```

What grounds it: `src/Contracts/OrderCreated.cs` (this repo, publishes) and `acme-billing-api/src/Consumers/OrderCreatedConsumer.cs` (sibling, consumes).
````

- **The stamp** - `Captured: <branch>@<short-sha>, <date>` records the LAST run. The entries describe the SIBLING
  repos as read on that date - the date is the staleness signal (siblings drift on their own), while this repo's
  branch matters little.
- **One `##` heading per sibling**, `<!-- id: <slug> -->` (a lowercase slug of the sibling's name, unique in the
  file, kept across heading rewordings; `docs.js seed-ids` adds a missing one), then `<!-- covers: <globs> -->`
  naming the THIS-repo files on its 'What grounds it' line. The sibling drifts on its own, which the entry's
  `captured:` and `read_at:` stamps keep answering; the covers watch this repo's side of the seam, so a session that
  moves or rewrites the seam file is asked at its close whether the entry still holds. An entry whose seam located
  no file in this repo (UNVERIFIED, or a seam wholly on the sibling's side) carries no covers line and no watch
  entry: nothing here can make it stale (`docs.js lint` notes a section with no `covers:`, never fails on one). The
  heading is the sibling's name: the memory hook reads these headings to surface each sibling's memories.
- **The entry** - location, relation, first_read, seam, the seat's `read_at:` and its own `captured:` stamp - then
  ONE line of evidence: what grounds the relation and the seam (the located files, both sides), plus any
  uncertainty or UNVERIFIED marker carried over verbatim. Describe edges, not roles.
- **Per-entry provenance** - entries are upserted at different times, so `captured:` is per entry and the doc-wide
  stamp never stands in for one. It matters most for a relationship born on a feature branch (the seam code exists
  only there); re-running the capture for that sibling after the branch merges refreshes the entry with the base
  branch's stamp. `read_at:` is the other side's provenance: the SIBLING's own `<branch>@<short-sha>` as the seat
  read it (a URL sibling: its clone's) - `n/a - not a git checkout` when it is none. A re-capture hands the old
  value to the seat, which starts from `git -C <sibling> log --oneline <sha>..HEAD`, and a reader checks the same
  range before trusting the seam.

## Write mechanics

- **A first capture** writes `RELATED-PROJECTS-AWARENESS.md` whole (Write), creating `<docs-path>/awareness/` when
  absent - `docs.js set` refuses a file that does not exist yet.
- **A re-run is an upsert, keyed by `location`.** A sibling passed this run: its entry rewritten from the fresh
  characterization, through `node .claude/hooks/docs.js set RELATED-PROJECTS-AWARENESS#<id> <textfile>`: the
  engine writes it in place on mainline, without git or under git versioning, and into this branch's overlay
  otherwise - the capture never decides which. A new sibling's section is added the same way. An existing entry
  whose location was NOT passed is kept exactly as-is (removal is a manual edit - the report names the entries left
  untouched so stale ones are visible). Where `set` wrote in place, also edit the top `Captured:` line to this run's.
- **The watch, after each write.** Merge one entry per sibling this run wrote, each under its own exact kind, one
  `--kind 'seam with <slug>'` per sibling - never the bare prefix, so a one-sibling re-run keeps every other
  sibling's entry. The globs are the section's covers:

  ```bash
  node .claude/hooks/docs.js watch-merge awareness --kind 'seam with acme-billing-api' <<'EOF'
  [ { "kind": "seam with acme-billing-api", "globs": ["src/Contracts/OrderCreated.cs"], "sections": ["RELATED-PROJECTS-AWARENESS#acme-billing-api"] } ]
  EOF
  ```

  A sibling whose seam now locates no file here, or whose section was removed, is named with no stdin entry (`[]`),
  which drops its entry; the run book's entries and the `notOwned` key are kept. Then `node .claude/hooks/docs.js
  watch <one seam file>` names the sibling's section - none named means its entry was dropped, fixed before the
  report. An engine older than the merge answers with its usage line: skip the merge and the check, and say so in
  the report.

Every entry is grounded in the located evidence or carries its UNVERIFIED marker - a relation is never smoothed
over, a hint never overrides contradicting evidence silently (the contradiction is reported). Unreachable siblings
stay as UNVERIFIED entries, not silently dropped: the reader deserves to know a seam exists even when it could not
be read.

## Handing work to a sibling

A session belongs to ONE project. When the capture shows work a sibling repo has to make - a consumed package, a
related service - investigate freely (read its code, run its tests read-only, find the exact symbol) and then HAND
IT OFF: `guard-cross-project-write.js` blocks the write, and the reason is not tidiness. A change applied from here
skips that repo's tests, conventions, review and release, and the project that owns it never sees it happen.

Write the card at `<docs-path>/work/cross-project-tasks/<other-project>.md`, appending to it rather than replacing it,
one section per task:

- **What must change, and where** - the file and symbol you located, not 'somewhere in the auth layer'.
- **Why this project needs it** - the concrete failure or limitation on this side.
- **The contract** - the shape both sides must agree on (a signature, an endpoint, a payload, a version floor).
- **How that side verifies it** - the test or check that proves it landed.

The card reaches the sibling's session through the user, so the report prints it too, as the docs-root rule's hand-off block:
its absolute card path lets that session read the whole card, and its text means nobody asks for it.
