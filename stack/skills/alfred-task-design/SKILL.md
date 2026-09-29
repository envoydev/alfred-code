---
name: alfred-task-design
description: "Use to settle how a feature fits the existing code before writing any - 'design this feature', 'where does this belong'. Not for one-line edits."
---

# Solution Design - how a change fits, then decomposed, in one chat

The design carries the quality: a build handles the traps its plan named and ships the ones it missed. This is the single-chat form of the solution-designer seat - it works out where a feature belongs in the code you already have and breaks it into an ordered plan, all in the current context so you can inspect and correct each step instead of reading a dispatched agent's final report. It plans; it does not write the code (that is the build step under the stack skill) and it does not audit its own plan (that is `alfred-task-verify-plan`). The measurements behind these rules live in `references/evidence.md` - an audit appendix, not a run-time load.

## Design mode - this chat or the designer seat

Design inline in this chat, the method below, so you inspect each step. On an agents request, dispatch the `<stack>-solution-designer` seat instead, exactly as the roster spells it (`alfred-code:<seat>` where the core plugin carries it) - on its frontmatter model unless you name one - and take its returned plan; the seat runs this same method, isolated. Only one designer runs, there is no fan-out here. Dispatch nothing you were not asked to. When the invocation names no mode and no calling flow has already recorded one, ask ONE question before designing, via AskUserQuestion - this chat, or the designer seat? - and hold the answer; a mode the run already picked is inherited, never re-asked. Loaded INSIDE a dispatched designer seat, the dispatch IS that answer: run the method below there, no ask and no further dispatch (the seat has neither tool).

## When to use / not

- Use to settle how a feature or change fits the existing code before writing any, in this chat: orient, judge the fit, split into an ordered minimal plan.
- Triggers also on 'how does this fit', 'break this into tasks', 'plan this change'.
- Not for a change with an obvious single home - just make it.
- Not plan *audit* (`alfred-task-verify-plan`) or built-code review (`alfred-task-verify-code`) - those come after.

## The method - orient, judge, decompose

0. **Settle the ask first.** Before you orient or design anything, load `alfred-habits-clarify` (the Skill tool) and run it: an ambiguous, underspecified or multi-reading ask is settled with the user before the design starts, and its answers are the requirement the plan cites. A clear ask passes straight through.
1. **Orient from the project docs, don't re-derive them.** Consult `<docs-path>/architecture/ARCHITECTURE.md` SCOPED, never whole: grep it for the modules the task touches plus a listing of `<docs-path>/architecture/references/`, then read the matching section ranges and the linked topic file for the area. Read `<docs-path>/code-style/CODE-STYLE.md` for the project's actual code style so the plan's code matches it. Absent those docs, take a bounded pass over the modules involved (directory listing, then `get_symbols_overview` per FILE that matters - it takes one file, never a directory - and never a whole-file read) - map the surface, don't read everything. Either way the `Oriented:` header cites the EVIDENCE - the ranges read, the symbol calls made - not a summary claim: the gate now verifies the citation against the session, and a claimed orientation with no matching reads is a MAJOR finding.
2. **Load the house skill for the stack you're in, for its real trap list.** Your project's convention rules auto-attach it the moment you touch a matching file; load it explicitly if you're designing before touching code. Carry the stack's real traps, not a generic checklist, and follow that skill's own routing to its specialist siblings (the stack -> skill map lives in the project's convention rules and router skills, not restated here).
3. **Judge the fit - one verdict, tied to the forcing edge.** Extend an existing seam when the work lands inside a boundary whose dependency arrow already points the right way and that already carries the concern; refactor first when landing it as-is would open a cycle, invert a layer, or overload a shared grab-bag (name the exact edge); isolate a new boundary when it is a genuinely new concern with no existing home. Verify each dependency claim against located code, never a name. The verdict is judged against the `Asked:` line (Output, below) - the user's own words for what changes and what must go away - not against what the code makes convenient: a plan that fit the code as a side-by-side prototype where the user had asked for the old path to be REPLACED was rejected after its whole build window. Before designing anything new, search for it in this order and stop at the first rung that holds: the existing code (the map's patterns in play, the navigation server), the docs of the libraries already referenced (the documentation server), the package registry for a maintained package, then the web - and the `## Decisions` line for that call names the rung that held.
4. **Decompose into an ordered, minimal plan.** Load `alfred-habits-plan-writing` first (the Skill tool) - the plan file's one shape - then break the work into tasks that each own a clear slice, in dependency order, each naming the files it touches, the stack traps it must handle, the `file:symbol` anchors you located, and its `log_points` (the design rules below). The smallest plan that meets the requirement - nothing speculative added, nothing required left out. Where tasks may build in parallel, give every file two tasks would both edit - the route registry, a root config or DI composition root, a barrel or shared index - exactly one owning task, and forbid the rest from touching it, so concurrent work never collides on a shared file.

## The design rules - decided here, audited later

Three questions on every seam you draw: is this the right TIME for the abstraction, the right PLACE
for the code, and can it lie to a reader or hold a bad state? The plan answers them before an
implementer inherits the answer.

1. **YAGNI + rule of three** - design the direct solution; the seam goes in at the third occurrence, split on what actually varied.
2. **High cohesion, low coupling** - everything a task owns changes for the same reason; a boundary that splits one axis of change across two seats is the wrong boundary.
3. **Program to an interface at boundaries ONLY** - an external system, something the tests mock, something with a credible second implementation.
4. **Illegal states unrepresentable where cheap, fail fast everywhere else** - and composition by default, since a subtype that cannot stand in for its base is a design defect.
5. **Command-query separation** - a method either mutates or answers, never both.
6. **Least astonishment** - the name is the contract.
7. **Patterns are refactored TOWARD, never started from** - absent a trigger already in the code, the simpler structure wins.

`references/design-rules.md` carries all seven in full, each with the failure shape it prevents,
plus the observability spec below - Read it at method step 4, beside the `alfred-habits-plan-writing` load
(the plan file's shape), before the decomposition is written.

SOLID stays review VOCABULARY - 'this violates Liskov' is a precise, fast comment - never the
justification on a task card: a design decision whose only support is a letter of the acronym, with
no breakage named, has not been argued.

**Observability is designed at the seams, never sprinkled by the implementer.** Stamp each task
card with `log_points` - where a line goes, at what level, carrying which identifiers - or
`log_points: none - <reason>`, since an absent field and a considered none must never look alike.
Which crossings and decision points earn a line, the level ladder, the join keys a message carries,
and the log-once rule are in the reference.

**Every judgment call lands on the plan with its precedent.** The plan carries a `## Decisions`
ledger - one line per call the design made where the requirement left two defensible shapes (a
library, a structure, a pattern, a placement, a name at a seam): `the choice - precedent: <file:symbol
or named rule>`, or `no precedent - <reason>` said explicitly and still decided; a plan with no such
call writes `## Decisions: none - <reason>`, so an absent ledger and a considered none never look
alike. The implementer inherits each answer and leaves its why at the line; the reviewer gates the
built code against the ledger. A choice the project already recorded - in its instructions file, the
architecture docs, the code-style doc - is a decision, never a defect to design around: judge the fit
against what the project deliberately chose, not against a convention it deliberately does not use. A
new file's home is a decision too: the folder the repo's best-organized module uses for that kind of
file, never a new `common` / `helpers` / `utils` dump folder. A how-to-build call is never left to the
build or bounced to the user.

## Output

An ordered task plan: the fit verdict and its forcing edge first, then one entry per task - what it does, the files, the traps to handle, the located anchors, the log points - in build order, then the `## Decisions` ledger (or its explicit none).

Two header lines open the plan file, both required fields and not niceties:

- `Oriented:` - the architecture doc read (or the bounded pass) from step 1 plus the house skill(s) loaded in step 2, or `none - <reason>`. If you cannot fill it, those steps did not happen - do them now; a plan designed blind ships the traps it never saw.
- `Asked: "<the user's words, verbatim>"` - the request as the user put it, including what must NOT survive (a method to remove, a path to replace). The fit verdict is judged against this line and `alfred-task-verify-plan`'s scope pass reads it (the designer seats already restate the requirement as capabilities and constraints - this is the in-chat form's copy).

`alfred-task-verify-plan` fails a plan without them.

## Write and hand off

Write the plan to `<docs-path>/superpowers/plans/<feature>.md` before handing off - the FILE is the handoff artifact: it survives compaction and a fresh session, where the chat copy does not. A DISPATCHED designer seat has no Write tool: it returns the whole plan in its report, `Oriented:` line first, and the orchestrator writes the file from it. Then verify the write, in the same turn: `wc -l` the plan file (it exists and is not empty) and grep it for `Oriented:` and `Asked:` - the two header lines `alfred-task-verify-plan` fails a plan without - plus one anchor from the first task, which proves the located `file:symbol` references survived the write. Quote the three results. A plan nobody can find, or one missing a header, is a design run with no output.

Then hand off: gate the plan with `alfred-task-verify-plan` before building, build each task with `alfred-task-implement` under the stack skill (a task the build proves wrong comes back here only through that skill's user ask, never on its own), and review the built code with `alfred-task-verify-code` (`alfred-task-solve` drives this whole chain with a user gate between every step).

## Plan format

The plan file's one shape - the header lines, the task card, the status marks the build adds, the `## Decisions` ledger, the resume line - is the `alfred-habits-plan-writing` skill: load it at method step 4 with the design rules, before the plan is written. The execution mode belongs to `alfred-task-solve`'s mode ask, never to the plan. Consulting a prior plan as a format reference, scope the read: the header plus one task entry, never the whole file, and never another ticket's plan as a substitute for the format authority. An external claim in the plan - a vendor API's behavior, a package's capability, a rate limit - is verified via the documentation server or the vendor doc and cited, or marked `unverified`; never recall stated as fact.

## Example

Brief: 'Add data export to the records list.'

Plan (single-chat output):
- **Fit - extend an existing seam.** The records module already owns the read paths and an export is another read projection, so no new boundary. Forcing edge: the export must not pull the full object graph, so it reads through the existing query-projection seam, never the raw persistence surface.
- **Task 1** - add the export projection to the query seam and its implementation. Trap: stream the rows, never materialize the full set (the stack skill's unbounded-result trap). Anchor: the located query seam (`file:symbol`).
- **Task 2** - add the export entry point returning a streamed response. Trap: map to a transfer shape at the edge, never the persistence entity (the stack skill's boundary trap). Anchor: the located edge (`file:symbol`). Log points: the export's outcome at the entry point - information with the row count and the request's correlation id, error with the exception on a mid-stream failure; the framework's request log already covers the start, so nothing at the projection seam.
- **Task 3** - an integration test asserting the header row, one data row, and the success status. Anchor: the located test suite.
- **Decisions** - the export streams through the framework's own writer, not a new package - precedent: the existing report download (`file:symbol`). No row ceiling: no precedent - decided, the projection already streams.

Then gate with `alfred-task-verify-plan`, build each task with `alfred-task-implement` under the stack's house skills, and review with `alfred-task-verify-code`.
