# The capture's artifacts - required shape and write protocol

## Contents

- **`<docs-path>/architecture/ARCHITECTURE.md`** - the structure map's required shape
- **Write protocol** (how step 5 lands the doc) - the stamp, section format, ORIENTATION.md, watch.json, branches, diagrams and format, the folder, the budget check and the spill
- **`.claude/rules/alfred-project-architecture.md`** - the awareness rule's template and byte budget

The pros/cons judgment over this map is not this capture's: nothing here writes `<docs-path>/quality/ASSESSMENT.md`, and no finding goes into the map.

## <docs-path>/architecture/ARCHITECTURE.md - the structure map

The durable, whole-project architecture record - the orientation a solution-designer reads to keep new work consistent with the structure that already exists. Keep it LEAN: it carries the CORE map only, and deep-dive detail spills to `<docs-path>/architecture/references/<topic>.md` topic files that the main file links from a short index (the same hub-and-spoke shape as a skill's `SKILL.md` plus its `references/`). The five core sections, in order, each concise:

1. **Framework and packages** - the runtime and target framework version, the language version, and the load-bearing packages (ORM, DI, messaging, auth, UI) with their role and major version. The dependencies that shape the architecture, not a lockfile echo.
2. **Architecture logic** - the architecture style (clean / vertical-slice / modular-monolith / layered / MVVM ...) and the layering, as ONE Mermaid `flowchart TD` block (15 nodes max, short labels; an arrow is a proven reference - `A --> B` means A references B) plus one prose line for the rules the arrows cannot say (what an inner layer may not reference - 'Domain references nothing; nothing references Api'). Mermaid because it costs the same tokens as an edge list, GitHub renders it, and agents parse it reliably; structure that will not fit 15 nodes spills to a `references/` topic file, never into a bigger diagram.
3. **Project structure** - a module-inventory table, one row per module/project: module | path + entry point (a `file:symbol` anchor) | responsibility | depends on (why). One row carries everything about a module in one place - the grouped shape agents resolve dependencies from most reliably - and doubles as the concern-to-place map.
4. **Patterns in play** - the recurring patterns and cross-cutting mechanisms actually in use (CQRS, repository / unit-of-work, mediator, options binding, the DI composition root, the error envelope, the auth seam), each anchored where it lives (`file:symbol`), so new work reuses the established pattern instead of inventing a rival.
5. **Boundaries and specifications** - the module and bounded-context boundaries and the contracts that guard them: which boundary is enforced by an architecture test versus held only by convention, the schema-ownership lines, and the constraints new work must satisfy (the house conventions in force, the non-functional targets, the seams that must not be crossed).

A sixth section, `## Known ceilings` (`ARCHITECTURE.md#known-ceilings`), is filed by the build flows' close through `docs.js set`, never by this capture: a refresh carries it over row for row - no rewording, no trim, no spill - because each row is a deliberate shortcut a later session must be able to find.

Format discipline - every seat reads this map at orientation, so its weight is paid on every dispatch: keep the core file within ~150 lines and spill the rest to `references/`. Anchors are `file:symbol` throughout (the entry points in section 3, the pattern homes in section 4, the guarded seams in section 5) - the map doubles as the navigation index, so a seat jumps to the anchor via the navigation server instead of re-deriving where things live. Tables and lists for anything enumerable; prose only for reasoning structure cannot carry (why a boundary exists, an accepted tradeoff). Never ASCII-art box diagrams - the same graph costs about double the tokens and models misread 2D text layout. A `references/` deep-dive may carry a Mermaid sequence diagram for ONE key runtime flow the static map cannot show (events, messaging) or an ER diagram for a bounded context's schema ownership - authored per the `docs-as-code` skill; the core map stays flowchart + tables only.

## Write protocol - how step 5 lands the doc

Followed after AGGREGATE has settled, in this order. Verification is finished before the first byte is written (the
skill body's precondition); this section is the mechanics of the write itself.

### The stamp

Every doc this capture writes opens with `Captured: <branch>@<short-sha>, <YYYY-MM-DD>`. Append `+dirty` to the sha when the working tree holds uncommitted changes (`git status --porcelain` non-empty). Prefer capturing on a clean tree; a dirty one is allowed but marked. Section-level stamps (`<!-- captured: -->`) are written by `docs.js set`, never by hand.

The `+dirty` escape hatch on an UPDATE: when the SAME uncommitted files still sit in the tree unchanged since the capture (provable - their mtimes at or before the prior capture's write, or a matching `git stash create` sha), the dirty set is accounted for and the update may stay inline, saying so in the report. The escalation to per-module dispatch is for a dirty set the diff CANNOT account for, not for the suffix itself.

### Section format

Every `##`, `###` and `####` heading in ARCHITECTURE.md and `references/*.md` carries its metadata as comment lines directly under it:

    ## The registration contract
    <!-- id: the-registration-contract -->
    <!-- covers: src/*/Program.cs, src/**/*Registrar.cs -->

- `id` - lowercase slug, unique in its file, kept across heading rewordings: every pointer, override and watch entry uses it. `docs.js seed-ids` adds missing ones.
- `covers` - the code globs the section describes, as narrow as the truth allows; a section about an area covers the area.
- Content: decisions, rules, boundaries, contracts, exceptions, each with its reason. No inventories - counts, file lists, route lists go stale on every change and the code answers them.
- Size: a section's own text (heading to its next heading) targets 3,000 chars and must stay under 6,000 - `docs.js lint` fails above it; split by sub-decision.

### ORIENTATION.md

Written to `<docs-path>/architecture/ORIENTATION.md` - the only path the docs hook pushes; a copy anywhere else (`.claude/docs/`, the docs root itself) reaches no session. Pushed into every session and subagent by the docs hook, so it is the most expensive file per byte: at most 4,096 bytes (`wc -c`, and `docs.js lint` enforces it). It holds the one-line project shape, the module map in a few lines, the house contracts a newcomer breaks first, and one line per reference file naming its best entry section id. Every `file#id` it names must exist (`docs.js lint` checks).

### watch.json

Written to `<docs-path>/architecture/watch.json` - the docs hook reads each domain's watch from its own top-level folder under the docs root, so a copy anywhere else is never read. The files whose change can move an architecture decision, mapped to the sections that own each decision - the docs hook asks for those sections at session end only when one of these files changed:

    {
      "sourceRoots": ["src", "tests"],
      "watch": [
        { "kind": "composition root", "globs": ["src/*/Program.cs", "src/**/*Registrar.cs"], "sections": ["slice-anatomy#the-registration-contract"] },
        { "kind": "architecture tests", "globs": ["tests/*ArchitectureTests/**"], "sections": ["boundaries#constraints-new-work-must-satisfy"] }
      ],
      "newModule": { "globs": ["src/*/Features/*/"], "sections": ["modules#module-map"] }
    }

Derive the entries from the capture, never from a template: composition roots and registrars, architecture tests, published contract files, project and package references, migrations, auth policy setup - each that exists here, with the section that states its rule. `sourceRoots` are the folders a change is gated in. `newModule` fires when a session creates a folder matching it.

### Branches

The docs hook's engine owns branch versions (step 1): never write a branch delta file. Committed docs change on the branch and merge with it. Ignored docs on a feature branch change through `docs.js set`; the next session on mainline after the branch merges folds them in by itself.

### Diagrams and format

Load `docs-as-code` before writing - its Mermaid ground rules govern the core-map flowchart and any deep-dive
sequence/ER diagram (one exception: a reconcile whose diagrams carry forward verified unchanged may skip the load
and say so in the report). This file fixes WHAT each doc contains - including the format-for-agents discipline
above (tables and grouped rows over prose, no ASCII art) that keeps the docs cheap for every seat that reads them
at orientation; `docs-as-code` fixes HOW the diagrams are written. Both docs are clean, scannable Markdown per the
`markdown-style` skill.

### The folder

Create `<docs-path>/architecture/` and `<docs-path>/architecture/references/` only when absent. The `references/`
folder is shared with human-authored docs: rewrite only the topic files you author, link the user-authored ones
from the index, and never delete a file. Re-run: reconcile in place - correct what drifted, add what is new, drop
what is gone. Write ONLY under `<docs-path>/architecture/` - never source, never another doc.

### The budget check and the spill

After the write, `wc -l` the doc against the target stated above (~150 lines). Over target, spill the overweight
sections to `references/` files NOW - the spill is the sanctioned second pass on the doc (a restructure, not the
per-claim edit stream the one-write rule forbids); this run owns the doc, and no other flow will. An overrun this
run genuinely cannot resolve is said plainly in the REPORT step, for the next capture to pick up.

## .claude/rules/alfred-project-architecture.md - the awareness rule

Step 6 writes this from the fresh capture, wholesale, to the template below. The body is fixed and names no
path: where the docs live and how to read them by section are the always-on navigation baseline's (the docs-root
rule stamps the literal root), so restating either here would pay twice every session - this rule adds only the
trigger, and that the capture ran. Nothing in it goes stale between captures or moves with the docs root. Create
`.claude/rules/` when absent. Budget: 300 bytes, checked with `wc -c` and reported on the `Rule:` line.

```markdown
---
description: Project architecture capture marker - generated by /capture-architecture; edit via a re-run.
---

The architecture docs are captured for this project - read them before a structural change.
```
