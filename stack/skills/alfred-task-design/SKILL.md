---
name: alfred-task-design
description: "Use to settle how a feature or change fits the existing code before writing any, in this chat: orient, judge the fit, split into an ordered minimal plan. Triggers on how does this fit, design this feature, where does this belong, break this into tasks, plan this change. Not for one-line edits, or auditing a plan that already exists (alfred-task-verify-plan)."
---

# Solution Design - how a change fits, then decomposed, in one chat

The design carries the quality: a build handles the traps its plan named and ships the ones it missed. This is the single-chat form of the solution-designer seat - it works out where a feature belongs in the code you already have and breaks it into an ordered plan, all in the current context so you can inspect and correct each step instead of reading a dispatched agent's final report. It plans; it does not write the code (that is the build step under the stack skill) and it does not audit its own plan (that is `alfred-task-verify-plan`). The measurements behind these rules live in `references/evidence.md` - an audit appendix, not a run-time load.

## Design mode - this chat or the designer seat

Design inline, so you inspect each step; on an agents request, dispatch the one `<stack>-solution-designer` seat (frontmatter model unless you name one) and take its plan. Dispatch nothing you were not asked to. When the invocation names no mode and no calling flow has already recorded one, ask ONE question before designing, via AskUserQuestion - this chat, or the designer seat? - and hold the answer; a mode the run already picked is inherited, never re-asked. Loaded INSIDE a dispatched designer seat, the dispatch IS that answer: run the method below there, no ask and no further dispatch (the seat has neither tool).

## When not

- Not for a change with an obvious single home - just make it.
- Not plan *audit* (`alfred-task-verify-plan`) or built-code review (`alfred-task-verify-code`) - those come after.

## The method - orient, judge, decompose

`references/method-in-full.md` carries the four steps unabridged, with their reasons.

1. **Orient from the project docs, don't re-derive them.** `<docs-path>/architecture/ARCHITECTURE.md` SCOPED - grep it for the touched modules, list its `references/`, read the matching ranges - and `<docs-path>/code-style/CODE-STYLE.md`; absent those, a bounded pass (a listing, then `get_symbols_overview` per FILE, never a whole-file read). The `Oriented:` header cites the EVIDENCE - the ranges read, the symbol calls made - never a summary claim.
2. **Load the house skill for the stack** - the convention rules attach it on touch; load it explicitly when designing before any touch - and carry its real trap list, following its routing to its specialist siblings.
3. **Judge the fit - one verdict, tied to the forcing edge:** extend an existing seam whose dependency arrow already points the right way; refactor first when landing as-is would open a cycle, invert a layer or overload a grab-bag (name the edge); isolate a new boundary only for a genuinely new concern. Verify each dependency claim against located code. The verdict is judged against the `Asked:` line - the user's own words for what changes and what must go away - not what the code makes convenient. Before designing anything new, stop at the first rung that holds: the existing code, the referenced libraries' docs (the documentation server), a maintained package, the web - its `## Decisions` line names the rung.
4. **Decompose into an ordered, minimal plan.** Load `alfred-habits-plan-writing` first, then tasks that each own a slice, in dependency order, each naming its files, traps, located `file:symbol` anchors and `log_points`. The smallest plan that meets the requirement. Where tasks may build in parallel, every shared file (a route registry, the composition root, a barrel) has exactly one owning task.

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

Read `references/design-rules.md` at method step 4, before the decomposition - all seven in full,
the observability spec, the Decisions ledger. SOLID is review vocabulary, never a task card's
justification - name the breakage.

**Observability is designed at the seams.** Stamp each task card with `log_points` - where, at what
level, carrying which identifiers - or `log_points: none - <reason>`.

**Every judgment call lands on the plan with its precedent.** The plan carries a `## Decisions`
ledger - one line per call the design made where the requirement left two defensible shapes:
`the choice - precedent: <file:symbol or named rule>`, or `no precedent - <reason>`; no such call
writes `## Decisions: none - <reason>`. A choice the project already recorded is a decision, never
a defect to design around. `references/design-rules.md` has the ledger in full.

## Output

An ordered task plan: the fit verdict and its forcing edge first, then one entry per task - what it does, the files, the traps to handle, the located anchors, the log points - in build order, then the `## Decisions` ledger (or its explicit none).

Two header lines open the plan file, both required fields and not niceties:

- `Oriented:` - the architecture doc read (or the bounded pass) from step 1 plus the house skill(s) loaded in step 2, or `none - <reason>`. If you cannot fill it, those steps did not happen - do them now; a plan designed blind ships the traps it never saw.
- `Asked: "<the user's words, verbatim>"` - the request as the user put it, including what must NOT survive (a method to remove, a path to replace). The fit verdict is judged against this line and `alfred-task-verify-plan`'s scope pass reads it (the designer seats already restate the requirement as capabilities and constraints - this is the in-chat form's copy).

`alfred-task-verify-plan` fails a plan without them.

## Write and hand off

Write the plan to `<docs-path>/superpowers/plans/<feature>.md` - the FILE is the handoff (a dispatched seat has no Write tool: it returns the plan and the orchestrator writes it). Verify in the same turn and quote all three: `wc -l` the file, grep it for `Oriented:` and `Asked:`, and grep one first-task anchor. Then hand off: `alfred-task-verify-plan` gates it, `alfred-task-implement` builds it, `alfred-task-verify-code` reviews it (`alfred-task-solve` drives the chain).

## Plan format

The plan file's one shape - the header lines, the task card, the status marks the build adds, the `## Decisions` ledger, the resume line - is the `alfred-habits-plan-writing` skill: load it at method step 4 with the design rules, before the plan is written. The execution mode belongs to `alfred-task-solve`'s mode ask, never to the plan. A prior plan consulted for format: its header and one task, never the whole file. An external claim in the plan - a vendor API's behavior, a package's capability, a rate limit - is verified via the documentation server or the vendor doc and cited, or marked `unverified`; never recall stated as fact.

## Example

`references/worked-example.md` takes one brief to its fit verdict and task cards - read it before the first design of a session.
