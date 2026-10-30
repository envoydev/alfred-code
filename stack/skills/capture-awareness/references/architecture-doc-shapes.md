# The capture's artifacts - required shape and write protocol

## Contents

- **`<docs-path>/awareness/ARCHITECTURE-AWARENESS.md`** - the structure map's required shape
- **Write protocol** (how step 5 lands the doc) - the stamp, section format, the orientation block, watch.json, branches, diagrams and format, the folder, the budget check and the spill

The pros/cons judgment over this map is not this capture's: nothing here writes `<docs-path>/quality/ARCHITECTURE-ASSESSMENT.md`, and no finding goes into the map.

## <docs-path>/awareness/ARCHITECTURE-AWARENESS.md - the structure map

The durable, whole-project architecture record - the orientation a solution-designer reads to keep new work consistent with the structure that already exists. Keep it LEAN: it carries the CORE map only, and deep-dive detail spills to `<docs-path>/awareness/references/<topic>.md` topic files that the main file links from a short index (the same hub-and-spoke shape as a skill's `SKILL.md` plus its `references/`). The five core sections, in order, each concise:

1. **Framework and packages** - the runtime and target framework version, the language version, and the load-bearing packages (ORM, DI, messaging, auth, UI) with their role and major version. The dependencies that shape the architecture, not a lockfile echo.
2. **Architecture logic** - the architecture style (clean / vertical-slice / modular-monolith / layered / MVVM ...) and the layering, as ONE Mermaid `flowchart TD` block (15 nodes max, short labels; an arrow is a proven reference - `A --> B` means A references B) plus one prose line for the rules the arrows cannot say (what an inner layer may not reference - 'Domain references nothing; nothing references Api'). Mermaid because it costs the same tokens as an edge list, GitHub renders it, and agents parse it reliably; structure that will not fit 15 nodes spills to a `references/` topic file, never into a bigger diagram.
3. **Project structure** - a module-inventory table, one row per module/project: module | path + entry point (a `file:symbol` anchor) | responsibility | depends on (why). One row carries everything about a module in one place - the grouped shape agents resolve dependencies from most reliably - and doubles as the concern-to-place map.
4. **Patterns in play** - the recurring patterns and cross-cutting mechanisms actually in use (CQRS, repository / unit-of-work, mediator, options binding, the DI composition root, the error envelope, the auth seam), each anchored where it lives (`file:symbol`), so new work reuses the established pattern instead of inventing a rival.
5. **Boundaries and specifications** - the module and bounded-context boundaries and the contracts that guard them: which boundary is enforced by an architecture test versus held only by convention, the schema-ownership lines, and the constraints new work must satisfy (the house conventions in force, the non-functional targets, the seams that must not be crossed).

A sixth section, `## Known ceilings` (`ARCHITECTURE-AWARENESS.md#known-ceilings`), is filed by the build flows' close through `docs.js set`, never by this capture: a refresh carries it over row for row - no rewording, no trim, no spill - because each row is a deliberate shortcut a later session must be able to find. It is a row register, so the section cap below does not bind it (`docs.js lint` prints its size as a note, never a PROBLEM) and it does not count toward the ~150-line target. Before carrying it over, run `node .claude/hooks/docs.js ceilings --prune`: it moves the rows marked closed - a revisit cell opening on lifted / closed / resolved / done - to `history/known-ceilings-closed.md`, so the register keeps only live shortcuts. A row it lists as `stale` (its `where` path is gone) stays: a rename or move left the shortcut in the code, so re-anchor its `where` cell to the file that holds it now, verified by a search, and name any row you cannot place in the report.

Format discipline - every seat reads this map at orientation, so its weight is paid on every dispatch: keep the core file within ~150 lines and spill the rest to `references/`. Anchors are `file:symbol` throughout (the entry points in section 3, the pattern homes in section 4, the guarded seams in section 5) - the map doubles as the navigation index, so a seat jumps to the anchor via the navigation tools instead of re-deriving where things live. Tables and lists for anything enumerable; prose only for reasoning structure cannot carry (why a boundary exists, an accepted tradeoff). Never ASCII-art box diagrams - the same graph costs about double the tokens and models misread 2D text layout. A `references/` deep-dive may carry a Mermaid sequence diagram for ONE key runtime flow the static map cannot show (events, messaging) or an ER diagram for a bounded context's schema ownership - authored per the `docs-as-code` skill; the core map stays flowchart + tables only.

## Write protocol - how step 5 lands the doc

Followed after AGGREGATE has settled, in this order. Verification is finished before the first byte is written (the
skill body's precondition); this section is the mechanics of the write itself.

### The stamp

Every doc this capture writes opens with `Captured: <branch>@<short-sha>, <YYYY-MM-DD>`. Append `+dirty` to the sha when the working tree holds uncommitted changes (`git status --porcelain` non-empty). Prefer capturing on a clean tree; a dirty one is allowed but marked. Section-level stamps (`<!-- captured: -->`) are written by `docs.js set`, never by hand.

The `+dirty` escape hatch on an UPDATE: when the SAME uncommitted files still sit in the tree unchanged since the capture (provable - their mtimes at or before the prior capture's write, or a matching `git stash create` sha), the dirty set is accounted for and the update may stay inline, saying so in the report. The escalation to per-module dispatch is for a dirty set the diff CANNOT account for, not for the suffix itself.

### Section format

Every `##`, `###` and `####` heading in ARCHITECTURE-AWARENESS.md and `references/*.md` carries its metadata as comment lines directly under it:

    ## The registration contract
    <!-- id: the-registration-contract -->
    <!-- covers: src/*/Program.cs, src/**/*Registrar.cs -->

- `id` - lowercase slug, unique in its file, kept across heading rewordings: every pointer, override and watch entry uses it. `docs.js seed-ids` adds missing ones.
- `covers` - the code globs the section describes, as narrow as the truth allows; a section about an area covers the area. A file this run wrote with no `covers` line in any section is a `docs.js lint` PROBLEM.
- Content: decisions, rules, boundaries, contracts, exceptions, each with its reason. No inventories - counts, file lists, route lists go stale on every change and the code answers them.
- Size: a section's own text (heading to its next heading) targets 3,000 chars and must stay under 6,000 - `docs.js lint` fails above it; split by sub-decision.

### The orientation block

Written to `<docs-path>/awareness/ARCHITECTURE-ORIENTATION-AWARENESS.md` - the only path the docs hook pushes; a copy anywhere else (`.claude/docs/`, the docs root itself) reaches no session. Pushed into every session and subagent by the docs hook, so it is the most expensive file per byte: at most 4,096 bytes (`wc -c`, and `docs.js lint` enforces it). It holds the one-line project shape, the module map in a few lines, the house contracts a newcomer breaks first, and one line per reference file naming its best entry section id. Every `file#id` it names must exist (`docs.js lint` checks).

### watch.json

The map's entries live in the awareness domain's one `<docs-path>/awareness/watch.json`, beside the other parts' entries and the `notOwned` list that keeps the engine off `AGENTS-AWARENESS.md` - so this part never writes the file whole: a whole-file write would wipe them. The files whose change can move an architecture decision, mapped to the sections that own each decision - the docs hook asks for those sections at session end only when one of these files changed. Pipe this part's entries, each `kind` prefixed `architecture: `, through the merge, which replaces this part's entries and its two keys and leaves every other entry and key as it stands:

    node .claude/hooks/docs.js watch-merge awareness --kinds 'architecture: ' --seed '{"sourceRoots": ["src", "tests"], "newModule": {"globs": ["src/*/Features/*/"], "sections": ["modules#module-map"]}}' --own sourceRoots --own newModule <<'EOF'
    [
      { "kind": "architecture: composition root", "globs": ["src/*/Program.cs", "src/**/*Registrar.cs"], "sections": ["slice-anatomy#the-registration-contract"] },
      { "kind": "architecture: architecture tests", "globs": ["tests/*ArchitectureTests/**"], "sections": ["boundaries#constraints-new-work-must-satisfy"] }
    ]
    EOF

Derive the entries from the capture, never from a template: composition roots and registrars, architecture tests, published contract files, project and package references, migrations, auth policy setup - each that exists here, with the section that states its rule. `sourceRoots` are the folders a change is gated in. `newModule` fires when a session creates a folder matching it. An older capture's entries carry the prefix already: the update that moved the map prefixed them.

### Branches

The docs hook's engine owns branch versions (step 1): never write a branch delta file. Committed docs change on the branch and merge with it. Ignored docs on a feature branch change through `docs.js set`; the next session on mainline after the branch merges folds them in by itself.

**The write-pass count on the overlay route** (`docs.js status` says `mode: overlay` on a feature branch): the doc is not written as a file at all, so ONE `docs.js set` per changed section IS the composed write and counts as pass one however many sections it takes; only a second sweep over the same sections is pass two. State it that way on the `Write passes:` line ('1 (overlay, 12 sections)').

### Diagrams and format

Load `docs-as-code` before writing - its Mermaid ground rules govern the core-map flowchart and any deep-dive
sequence/ER diagram (one exception: a reconcile whose diagrams carry forward verified unchanged may skip the load
and say so in the report). This file fixes WHAT each doc contains - including the format-for-agents discipline
above (tables and grouped rows over prose, no ASCII art) that keeps the docs cheap for every seat that reads them
at orientation; `docs-as-code` fixes HOW the diagrams are written. Both docs are clean, scannable Markdown in the
shape this file fixes.

### The folder

Create `<docs-path>/awareness/`, its `references/` and its `history/` only when absent. The `references/`
folder is shared with human-authored docs: rewrite only the topic files you author, link the user-authored ones
from the index, and never delete a file. Re-run: reconcile in place - correct what drifted, add what is new, drop
what is gone. Write ONLY the map's files under `<docs-path>/awareness/` - the map, its `references/` and `history/`,
the orientation block and this part's watch entries; the folder's other docs belong to the other parts - never
source, never another doc.

### The budget check and the spill

After the write, `wc -l` the doc against the target stated above (~150 lines, the Known ceilings rows left out). Over target, spill the overweight
sections to `references/` files NOW - the spill is the sanctioned second pass on the doc (a restructure, not the
per-claim edit stream the one-write rule forbids); this run owns the doc, and no other flow will. An overrun this
run genuinely cannot resolve is said plainly in the REPORT step, for the next capture to pick up.
