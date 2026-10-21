---
name: task-verify-plan
description: "Use to audit an existing plan or design before code - 'review this plan', 'is this design sound', 'does it miss anything'. Not plan writing or code review."
---

# Verify Plan - a risk-coverage audit of a plan before you build

A plan built perfectly is still wrong if the plan was wrong - the design carries the quality: a build handles the traps its plan names and ships the ones it misses, and catching the miss here on the page is cheaper than any downstream gate (the code, the tests, task-verify-code). This reviews an EXISTING plan or design (yours, or one written in the house plan format) for the defects that are expensive to discover later. It does not write or fix code; it flags gaps in the plan and hands them back.

## Audit mode - this chat or the verifier seat

Audit inline in this chat, the five passes below. On an agents request, dispatch the plan's stack `<stack>-verifier` seat, exactly as the roster spells it (`alfred-code:<seat>` where the core plugin carries it), to run the same five passes over the plan file - on its frontmatter model unless you name one - and take its punch-list. The seat knows neither the passes nor the Output, so the brief carries both: the five passes and the eight-field block (Output, below), which the seat returns above its `status:` line and you copy as written - `Passes:` included. There is no dedicated plan-auditor seat; the verifier seat runs the audit. Only one seat, no fan-out; dispatch nothing you were not asked to. When the invocation names no mode and no calling flow has already recorded one, ask ONE question before auditing, via AskUserQuestion, and hold the answer:

```ask
Audit this plan in this chat or through the <stack>-verifier seat? This chat: the plan is already here, and the audit is one bounded pass.
- 'Audit this plan in this chat (Recommended)' - the five passes below, inline, nothing dispatched
- 'Dispatch the <stack>-verifier seat' - the same passes in an isolated subagent, on its frontmatter model
```

A mode the run already picked is inherited, never re-asked - with ONE boundary: the cross-task orchestrator's plan gate always runs the five passes in-session whatever the run mode, because the plan is already in that session's context and its protocol says so (the inherited-mode dispatch applies only to this skill's own single-chat chain).

## When to use / not

- Checks the plan names the stack's non-obvious traps, matches the scope, covers edge and safety cases, and stays minimal.
- Triggers also on 'before I build'.
- Use it the moment a plan exists and before implementation starts - especially for anything with a boundary, state, auth, migration, or concurrency surface. The plan file is the whole input: a fresh session (or a different model) audits it as well as the chat that designed it - and independent eyes on the page are the point.
- Not code review - that is `task-verify-code`, after the build.
- Not plan *creation* - that is `task-design` (`habits-plan-writing` is the format), after `habits-clarify` settles an ambiguous ask. This audits a plan that already exists.

**auto-mode.** `--auto-mode` as the first word of the arguments is a mode flag, not a target: the run goes unattended. Each stop takes its `(Recommended)` option and an answered ask is the go, in the same turn; an ask without one waits for the user, the fresh-session hand-off is never taken, nothing is pushed, merged, deployed or sent out, and the hook's `AUTO` stamp in `<data root>/state/approvals/APPROVAL` is the run's approval: write no APPROVED or AUTO line over it, and only the close of the run its `skill:` line names deletes it.

## The audit - five passes, in order

Before reading the plan, load `habits-plan-writing` (the Skill tool) - the shape every header line, card and status mark below is checked against - and the plan's target stack skill, so you check against the right trap list, not a generic one.

1. **Risk coverage - the highest-leverage pass.** Check the plan's `Oriented:` header line first (`task-design` writes it - what oriented the design, which house skills it loaded): a plan missing the line, or naming no house skill with no reason, is itself a MAJOR finding - the design ran blind. Check the CLAIM, not just the field: the line must cite its evidence (the doc range read, the symbol calls made), and where the audit runs in the same session the cited reads must actually exist in it - a filled-in header over reads that never happened passed this gate verbatim while zero orientation occurred (measured: 'ARCHITECTURE.md plus a bounded symbol pass over six surfaces' with no read of the doc anywhere in the session and one symbol call against six claimed). A `docs.js where` listing is a pointer, not a read: it names sections, so docs evidence that is only a `where` call - no `docs.js show` of a section it named, no range read - is unevidenced (measured: `Oriented: verified` stamped over a section the session only listed, and the docs gate reported it unread minutes later). An unevidenced `Oriented:` line is the SAME MAJOR finding as a missing one. Hold the skills the line names against the files the cards touch: a card on a surface whose house skill it does not name - an endpoint or authorization policy with no web or auth skill, a migration with no data-access skill, a spec file with no testing skill - is a MINOR finding naming that area, since the build inherits those traps unseen. Stamp what you verified into the gate line: `Oriented: verified` or `Oriented: MISSING/unevidenced`, so a later scoped re-audit cannot silently inherit the gap (measured: two gate passes over one plan, neither flagged the absent header). Then: does the plan NAME the non-obvious failure modes this feature will hit? Do not carry a generic checklist - load the stack's house skill (the same one your project's convention rules auto-attach for its file types; its router names the specialist siblings) and check the plan against ITS trap list: the data-access, lifecycle, concurrency, and boundary traps that stack actually has. A trap the plan does not name is a trap the build inherits - flag each missing one and where in the plan it belongs. A plan task that breaks a user preference is a MAJOR finding naming the id - read the `PERSONAL-CODE-`, `ARCHITECTURE-` and `PROJECT-CODE-PREFERENCES.md` that exist under `<docs-path>/preferences/` for it, since no edit here hands them over.
2. **Scope match.** The plan covers exactly what was asked - nothing missing, nothing speculative added. A step for a requirement that is not there, or a missing step for one that is, is a finding. 'What was asked' is the plan's `Asked:` line - the user's words, verbatim, written under `Oriented:` by `task-design`; a plan without one is judged against the brief and the missing line is a MINOR finding. Read it for what must NOT survive as much as for what must exist: a plan that added a side-by-side path where the ask was to replace the old one is a scope finding (measured: rejected by the user after its whole build window). Three rules settle what the line alone does not:
   - **An item outside `Asked:`** - an 'adjacent fix', a cleanup, a behaviour a seat's report says the reference has - passes on one of two grounds only: the user asked for it (the answer quoted), or this audit read the cited reference WHOLE - the full function, list or component, never the cited range - and quotes the line that proves the claim in the `Gated` block. Neither holds: a MAJOR finding, and the item leaves the plan; under AUTO it is dropped and listed in the stop's `Result:` line, never kept on the plan's own justification (measured: a seat's two-range read became an 'adjacent fix' every gate passed, and it shipped a regression the full list showed).
   - **A cited source is scope too.** When `Asked:` cites a spec row, a card or a spec file, every clause of a cited row (the defect it describes AND the fix it names) and every Verify or Done-when bullet of a cited card maps to a task and its `test:` clause; an unmapped clause is a MAJOR finding (measured: a card's fifth Verify case dropped and the card stamped DONE; half a spec row unbuilt and pushed).
   - **A behaviour change the ask did not name is the user's call.** A `## Decisions` entry that changes what the user sees, which `Asked:` does not name, passes only with the user's answer on the entry (`asked: <the answer>`); without it, a MAJOR `judgment` finding (measured: an always-shown month passed both gates inside option descriptions and was reverted by the user after `Completed`).
3. **Existence.** Every thing the plan NAMES is checked to exist before the plan passes: a symbol,
   a file, a config key, a CSS or design token, an API the plan calls, a package version floor, a
   capability it assumes a tool or seat has. Check it - `find_symbol`, a read of the config, a
   documentation-server lookup for the external ones - and mark anything you could not confirm `unverified` in
   the finding, never in the plan's prose as fact. This pass exists because asserted existence is
   the most expensive defect class in the corpus - two repairs measured in millions of tokens,
   written up in `references/evidence.md`, both from a name that was asserted rather than looked up.
4. **Edges + safety.** Boundary, empty, and error cases are named, not assumed. Any auth / migration-order / data-loss / concurrency surface is called out WITH its safeguard. Silence on a safety-critical edge is a finding. The plan's final gate (its `Build:` line, the last acceptance) runs the workspace's affected set, or every touched project plus its dependents - a hand-picked project list is a MAJOR finding (measured: 7 of 26 affected projects in the final gate, three dependent suites red at the commit).
5. **Soundness.** A plan that is really a BREAKING version event - a framework or runtime major, an EOL, a load-bearing package's breaking major - is a finding of its own before anything else is judged: that is the staged upgrade flow, with a green gate after every stage, not a feature plan - name `/task-version-upgrade` to the user as their command. Otherwise: the approach matches the repo's existing architecture (match it, never introduce a second), dependencies are ordered, and it is the smallest plan that meets the requirement - and its seams pass the design rules `task-design` decides against: a task boundary that splits one axis of change across two tasks, an interface with one implementation and no credible second, a pattern with no trigger yet in the code, a task whose failure exits name no `log_points` (a silent failure designed in) - each a finding against the PLAN, with the breakage named, never a letter of SOLID alone. A bug plan's acceptance run reproduces the reported symptom (its error text or log row) or names a stricter stand-in the user approved; an unapproved stand-in is a finding.

## Output

**Eight named fields, every run, each with a value** - a controlled measurement put named fields at
5 of 5 emitted against a prose condition at 0 of 1, so anything that must happen every time is a
field, not a sentence about when to write one:

```
Oriented:  verified | MISSING/unevidenced
Asked:     verified | MISSING
Decisions: <N entries, each with its precedent> | ABSENT
Scope:     matches | <what is missing or speculative>
Existence: <N names checked, N unverified> | nothing named
Passes:    risk <v> | scope <v> | existence <v> | edges <v> | soundness <v>
Findings:  <count by severity, or `none`>
Gated:     passed | passed - <N> fixes applied | <N> gaps listed - <date>
```

`Passes:` is the audit record a calling flow copies into its ledger as written: each `<v>` is `pass` or that pass's worst severity (`MAJOR`, `MINOR`), and a pass that did not run is `NOT RUN`, never left out. `passed - <N> fixes applied` is the one form for an audit whose non-judgment fixes landed in the plan in the same step - each named in the calling stop's `Result:` line; a `judgment` item is never one of them. Nor is a fix that changes a build, test or acceptance COMMAND (a flag, a configuration, a project path) unless the run or read that proves the new form is quoted in the `Gated` block; a fix hedged on an assumption ('if the project lacks that configuration, say so') is a finding marked `unverified`, left in the plan as written for the build to prove, never applied in-step (measured: an audit dropped a correct `-p:Platform=x86` from a test command on the run book's say-so, no test project read, and the build's run went 6 red before the flag came back).

`Decisions:` is a PASS CONDITION, not a note: a plan whose `## Decisions` ledger is absent is a
finding in its own right, because the build seats read that ledger for the precedents they must
build to (measured: 0 occurrences of the ledger in a plan that was then stamped `Gated: passed`).

Then the body: a short punch-list, not a rewrite. One line per finding: `severity | the gap | the fix to the PLAN` - and a finding that is a tradeoff or a matter of taste rather than an objective defect carries the extra tag `judgment` (a recorded user preference's breach is MAJOR, never `judgment`): the applier puts each judgment item through its own ask, never folded into a blanket 'fix all' approval (measured: an unmarked transport-channel switch rode a blanket 'go ahead', landed, and was reverted on a live user interrupt - 32% of that apply phase's edits spent applying-then-reversing it). If the plan is sound, say so plainly and name what you checked. When the plan lives in a file (`<docs-path>/work/plans/` - `task-design` writes it there), stamp the verdict into it - the whole eight-field block above, under the header, never the `Gated:` line alone: the block is the record a calling flow copies, a compacted or fresh session resumes from and a re-audit inherits (measured: two audits left 2 of the 8 fields anywhere - exactly the two a one-line stamp held). When the findings are then applied to the plan, land them in as few Edit calls as possible - one per task section, never one per line (measured: 28 single-hunk edits to one plan file in one apply pass, each at full session context). Then it is safe to build against; if not, fix the plan first - that is the whole point of doing this before code.

The judgment ask, one per item:

```ask
<the judgment finding, one line>: keep the plan as written or apply it?
- 'Keep the plan as written (Recommended)' - a judgment item is a matter of taste, not a defect, so the plan stands unless you choose it
- 'Apply it to the plan' - the plan changes as the finding says, and the stop's `Result:` line names it
```

## Example

Auditing the `task-design` export plan ('add data export to the records list' - three tasks: a query projection, a streamed export endpoint, an integration test), one line per pass:

```text
Passes: risk MAJOR | scope MINOR | existence pass | edges MAJOR | soundness pass
1 risk      | MAJOR | no task names cancellation on the streamed export - a client abort leaks the open reader | thread the stack's cancellation mechanism through Tasks 1-2 (its skill's trap list)
2 scope     | MINOR | Task 2 adds an export-format option the requirement never asked for | drop it
3 existence | pass  | every symbol, package and config key the plan names resolves in the repo
4 edges     | MAJOR | empty result set unspecified - header-only output or an error?    | name the expected shape in Task 2; assert it in Task 3
5 soundness | pass  | extends the existing query seam, tasks in dependency order, smallest plan
```

Verdict: fix the plan (2 MAJOR), re-check the two lines, then build.
