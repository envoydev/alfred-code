---
name: task-design
description: "Use to settle how a feature fits the existing code before writing any - 'design this feature', 'plan this change'. Not for one-line edits or a plan audit."
---

# Solution Design - how a change fits, then decomposed, in one chat

The design carries the quality: a build handles the traps its plan named and ships the ones it missed. This is the single-chat form of the solution-designer seat - it works out where a feature belongs in the code you already have and breaks it into an ordered plan, all in the current context so you can inspect and correct each step instead of reading a dispatched agent's final report. It plans; it does not write the code (that is the build step under the stack skill) and it does not audit its own plan (that is `task-verify-plan`). The measurements behind these rules live in `references/evidence.md` - an audit appendix, not a run-time load.

## Design mode - this chat, a read fan-out, or the designer seat

In this chat, ask the mode per `references/design-mode.md` - read it before designing; a mode the invocation or a calling flow already picked is inherited, never re-asked. Inside a designer seat: no ask, no dispatch - the dispatch is the answer, run the method below. A seat holds no AskUserQuestion, so each ask below is a report field there: an ambiguous brief returns NEEDS_CONTEXT (step 0), a behaviour change goes on the report's `user_decisions:` line (the Decisions ledger).

## When to use / not

- Use to settle how a feature or change fits the existing code before writing any, in this chat: orient, judge the fit, split into an ordered minimal plan.
- Not for a change with an obvious single home - just make it.
- Not plan *audit* (`task-verify-plan`) or built-code review (`task-verify-code`) - those come after.

## The method - orient, judge, decompose

0. **Settle the ask first.** Before you orient or design anything, load `habits-clarify` (the Skill tool) and run it: an ambiguous, underspecified or multi-reading ask is settled with the user before the design starts, and its answers are the requirement the plan cites. A clear ask passes straight through. Inside a designer seat, load nothing here: an ambiguous brief returns NEEDS_CONTEXT naming the readings to settle.
1. **Orient from the project docs, don't re-derive them.** Consult `<docs-path>/architecture/ARCHITECTURE.md` SCOPED, never whole: grep it for the modules the task touches plus a listing of `<docs-path>/architecture/references/`, then read the matching section ranges and the linked topic file for the area. A `docs.js where` call only lists sections: read the ones it names (`docs.js show`, or the range) and cite that read, never the `where`. Absent that doc, take a bounded pass over the modules involved (directory listing, then a file outline per FILE that matters - it takes one file, never a directory - and never a whole-file read) - map the surface, don't read everything. Either way the `Oriented:` header cites the EVIDENCE - the ranges read, the symbol calls made - not a summary claim: the gate now verifies the citation against the session, and a claimed orientation with no matching reads is a MAJOR finding. Read the preference docs that exist too (`<docs-path>/preferences/`: `PERSONAL-CODE-PREFERENCES.md`, `ARCHITECTURE-PREFERENCES.md`, `PROJECT-CODE-PREFERENCES.md`) and both assessments (`<docs-path>/quality/`: `CODE-ASSESSMENT.md`, `ARCHITECTURE-ASSESSMENT.md`) scoped to the task's modules - an entry is a lead, and no card adds a case of a weakness one records.
2. **Load the house skill for the stack you're in, for its real trap list.** Your project's convention rules auto-attach it the moment you touch a matching file; load it explicitly if you're designing before touching code. Carry the stack's real traps, not a generic checklist, and follow that skill's own routing to its specialist siblings (the stack -> skill map lives in the project's convention rules and router skills, not restated here).
3. **Judge the fit - one verdict, tied to the forcing edge.** Extend an existing seam when the work lands inside a boundary whose dependency arrow already points the right way and that already carries the concern; refactor first when landing it as-is would open a cycle, invert a layer, or overload a shared grab-bag (name the exact edge); isolate a new boundary when it is a genuinely new concern with no existing home. Verify each dependency claim against located code, never a name. The verdict is judged against the `Asked:` line (Output, below) - the user's own words for what changes and what must go away - not against what the code makes convenient. Before designing anything new, search for it in this order and stop at the first rung that holds: the existing code (the map's patterns in play, the navigation tools), the docs of the libraries already referenced (the documentation tools), the package registry for a maintained package, then the web - and the `## Decisions` line for that call names the rung that held.
4. **Decompose into an ordered, minimal plan.** Load `habits-plan-writing` first (the Skill tool), then break the work into tasks that each own a clear slice, in dependency order, each naming the files it touches, the stack traps it must handle, the `file:symbol` anchors you located, and its `log_points` (the design rules below). The smallest plan that meets the requirement - nothing speculative added, nothing required left out. When the ask cites a spec row, a card or a spec file, that source is requirement too: every clause of a cited row and every Verify or Done-when bullet of a cited card maps to a task's `test:`, and the close's done gate demonstrates them. A bug seen only on the customer's side - a report, a production log, never reproduced here - opens with a task whose acceptance is the reported symptom reproduced, its exact error text or log row quoted, before any fix task: a fix to a symptom nobody reproduced is a guess. Where tasks may build in parallel, give every file two tasks would both edit - the route registry, a root config or DI composition root, a barrel or shared index - exactly one owning task, and forbid the rest from touching it, so concurrent work never collides on a shared file.

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
plus the SOLID review stance, and the observability spec below - Read it at method step 4, beside the `habits-plan-writing` load,
before the decomposition is written.

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
built code against the ledger. A choice the project recorded - its instructions, architecture or code-style
docs - is a decision, never a defect to design around: judge the fit against what it
chose, not a convention it does not use. A user preference (`alfred-preferences.md`) outranks them all:
its row names the id; one a skill or another instruction contradicts is the user's call - ask which wins, the
entry's side marked (Recommended), a seat on `user_decisions:` - and one no design meets goes to the user (a seat:
NEEDS_CONTEXT), never waived. A
new file's home is a decision too: the folder the repo's best-organized module uses for that kind of
file, never a new `common` / `helpers` / `utils` dump folder. A how-to-build call is never left to the
build or bounced to the user. One call is never the design's: a change to a behaviour the user can see
that the `Asked:` line does not name (a value now always shown, a default flipped, an exit path
changed) gets its own ask before the gate, its ledger line carrying `asked: <the answer>`; under
AUTO the behaviour stays as it was, `not asked - kept as is (AUTO)`; inside a designer seat it is a
`user_decisions:` row, `asked: pending`. An option description is not an ask.

```ask
<the behaviour change, one line>: keep today's behaviour or change it as designed?
- 'Keep today's behaviour (Recommended)' - the `Asked:` line does not name this change, so the plan works around it
- 'Change it as designed' - the plan builds the change; the ledger line records this answer
```

## Output

An ordered task plan: the fit verdict and its forcing edge first, then one entry per task - what it does, the files, the traps to handle, the located anchors, the log points - in build order, then the `## Decisions` ledger (or its explicit none).

Two header lines open the plan file, both required fields and not niceties:

- `Oriented:` - the architecture doc read (or the bounded pass) and the preference and assessment docs read (or `none present`) from step 1, plus the house skill(s) loaded in step 2, or `none - <reason>`. If you cannot fill it, those steps did not happen - do them now; a plan designed blind ships the traps it never saw.
- `Asked: "<the user's words, verbatim>"` - the request as the user put it, including what must NOT survive (a method to remove, a path to replace). The fit verdict is judged against this line and `task-verify-plan`'s scope pass reads it.

`task-verify-plan` grades both: a missing `Oriented:` is a MAJOR finding, a missing `Asked:` a MINOR one.

## Write and hand off

A DISPATCHED designer seat has no Write tool: it returns the whole plan in its report, `Oriented:` line first, and the orchestrator writes the file from it - the seat's work ends there. In this chat the plan goes to `<docs-path>/work/plans/<feature>.md` before handing off - a design flow writes it as its handoff, the case the interaction baseline's plan-file rule names. Read `references/write-and-hand-off.md` once the plan is settled and follow it - it writes and verifies the file, hands off, and carries a worked plan.

## Plan format

The plan file's one shape is the `habits-plan-writing` skill, loaded at method step 4. The execution mode is the build step's ask, never the plan's. An external claim in the plan - a vendor API's behavior, a package's capability, a rate limit - is verified via the documentation tools or the vendor doc and cited, or marked `unverified`; never recall stated as fact.
