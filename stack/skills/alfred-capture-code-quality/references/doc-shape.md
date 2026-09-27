# <docs-path>/quality/CODE-ASSESSMENT.md - required shape and write protocol

## Contents

- **Why this doc lives outside the docs-domain engine** - recomputed every run, never versioned
- **Rule sources** - what counts as a rule, and which source wins a disagreement
- **The findings gate** - the four questions a candidate must pass before it is a finding
- **The count rule** - an output, never a target, in both directions
- **The three buckets** - every surviving item lands in exactly one
- **The shape** - Rule sources, Must fix, Worth knowing, Deliberate tradeoffs, Proposed decisions, Summary
- **Format discipline** - the budget, and the spill pass that keeps every entry
- **Write mechanics** - the freshness line, the folder, the single overwrite

## Why this doc lives outside the docs-domain engine

`<docs-path>/quality/` carries no `watch.json`, so `domains()` in `.claude/hooks/docs.js` never picks it
up - this doc and `quality/ASSESSMENT.md` beside it are no docs domain at all. Findings are a function of
the rules plus the code, recomputable on demand for whatever branch you are on; versioning them would be
storing a cache and calling it a record. No `<!-- id: -->` / `<!-- covers: -->` lines, no section stamp,
no `docs.js set` or `lint`, no branch-overlay question at session end - none of that machinery applies,
and this skill never invokes it. On a project that commits its docs, plain git tracks the file like any
other; on a local-only docs root it is local too.

## Rule sources

A rule is a checkable statement of what the code must or must not do, taken from one of three sources -
never from recall, and never from a reference the project did not install:

1. **The stage prompts under `<docs-path>/loops/`** - each `<n>.<name>.md` with `n` above zero. Its 'Look
   for' bullets are the rules, its severity paragraph their scale, its `Bar:` line the bar, and its 'Not
   a finding' list is part of the rule too. The `0.`-numbered file is FIX discipline and never judged
   against; un-numbered files (`RUN-STATE.md`, `DECISIONS.md`, notes) are run records, never rules.
2. **`<docs-path>/code-style/CODE-STYLE.md`** - the idioms the project actually follows; a divergence
   the code-style capture recorded as the project's own choice is the rule here.
3. **The convention rules** under `.claude/rules/` - each path-scoped file attaches one file family to
   its house convention skill; the skill's rules are the rules for that family.

**Precedence.** The project's own record wins a disagreement: its decision log and CLAUDE.md choices
first, then the loops prompts, then `CODE-STYLE.md`, then a house convention skill. A lower source's rule
that a higher one contradicts is not a finding. No `loops/` folder, or none holding a stage prompt, drops
source 1 - the report says so, and sources 2 and 3 are judged alone. All three absent: the run stops
before GATHER and writes nothing - a doc judged against no rule would read as clean code.

## The findings gate - pass all four questions or it is not a finding

Before ANY candidate is recorded as a finding, answer all four explicitly; an unanswerable question is a
fail, and a failed candidate is routed (Worth knowing, or folded into an existing entry) or dropped -
never tiered:

1. **What breaks?** The concrete wrong outcome - wrong or lost data, a crash, a silent failure, a security
   hole, a change that cannot be made safely, or time repeatedly lost by the next developer. 'It differs
   from how a convention or another codebase would do it' is not an answer.
2. **Who notices, and when?** A user, an operator, or the next person to touch this code - named, with
   the trigger condition. A bug needs its constructible input, state or sequence.
3. **Is it actually new?** Unchanged code the last run's `CODE-ASSESSMENT.md` already records is a
   re-measurement: fold the sharper number into the existing entry, never open a new one, and never
   re-tier or re-grade it upward merely because it now has a number.
4. **Has the project already decided this?** Read the decision log and the project CLAUDE.md's recorded
   choices FIRST. A recorded decision is a Deliberate tradeoff, never a defect, and never re-raised.

**Architecture and coverage stay out.** A candidate whose fix is a new boundary, an inverted layer or a
rival pattern is the architecture-quality capture's; a missing or weak test is the coverage capture's.
Both are counted as hand-offs in the report and never written here - two docs holding one fact drift.

## The count rule - an output, never a target, in both directions

- **Never pad upward.** No preference is promoted to a finding, and no MINOR to a MAJOR, to make the doc
  look thorough. Zero gate-passing findings is a complete result on healthy code - state it plainly.
- **Never truncate downward.** EVERY candidate that passed the gate is recorded; dropping one because the
  list is long is silent data loss the next run cannot detect.
- **Length is handled by grouping, ranking and the spill pass, never by deletion.** One entry per rule
  per module, whatever its instance count; ranked so the top is actionable at a glance.

## The three buckets - every surviving item lands in exactly one

| Bucket | Meaning | The quality loop may act on it? |
|---|---|---|
| **Must fix** | A breach of a named rule that passed the gate - carries Rule, Severity, Tier, Remediation | Yes |
| **Worth knowing** | True and verified, but no action warranted now: a scale limit the code documents, a pattern the project is migrating away from on purpose. Not a defect. | Never |
| **Deliberate tradeoff** | A rule the project chose not to follow, with the reason and where it is recorded | Never - and never re-raise it |

No bucket has a size limit. Every Worth-knowing entry states the condition that would promote it to Must
fix; each re-run checks that condition - promote it, leave it, or DELETE it when the condition can no
longer occur. An entry whose promotion condition you cannot state is dropped, not listed.

## The shape

- **Rule sources** - one line per source judged (`loops/2.code-quality.md`, `CODE-STYLE.md`, each
  convention rule by file), or the line saying a source was absent. The reader learns what the code was
  held to before reading what it broke.
- **Must fix** - every finding that passed the gate, ranked by severity, then blast radius. C-IDs are
  rank labels, not identities: a re-rank renumbers so C1 is always the current top; a cross-run reference
  cites the title. Each entry carries four fields:
  - **Rule** - the source file and the rule inside it, quoted short.
  - **Severity** - the breached rule's own scale (BLOCKER / MAJOR / MINOR in the loops prompts); a rule
    with no scale is graded by blast radius.
  - **Remediation** - the smallest change that satisfies the rule, through the seam the code already uses.
  - **Tier** - **small** (a localized edit an implementer can land), **substantial** (a designer-led
    multi-task change - decompose, build, verify), or **structural** (a risky cross-cutting rework - flag
    it, never let a loop auto-apply it).

  One entry in that shape:

  > **C2 - The refund path swallows the gateway failure and reports success.** `RefundService.RefundAsync` catches the gateway exception and returns `Ok` (located: `src/Orders/RefundService.cs:88`), so a failed refund reads as paid until the nightly reconciliation flags it.
  > **Rule** - `loops/2.code-quality.md` - Bugs: swallowed exceptions.
  > **Severity** - BLOCKER.
  > **Remediation** - rethrow through the service's existing error envelope and let the endpoint map it to a failed refund.
  > **Tier** - small.
- **Worth knowing** - one line per entry plus its promotion condition.
- **Deliberate tradeoffs** - the rule not followed, the reason, and where the project recorded it. Sourced
  from the decision log or CLAUDE.md (gate question 4) - never written from this skill's own judgment.
- **Proposed decisions** - a repeatedly-declined Must-fix entry, or a rule the code breaks everywhere on
  purpose, shaped ready to accept: the claim, the reason, what it costs. A person accepts one by writing
  it into the decision log; the next run's gate question 4 then moves the entry out of Must fix.
- **Summary** - the per-bucket counts, the Must-fix severity and tier tallies, the finding count per rule
  source (a source with zero is listed as checked clean), and the top few highest-leverage fixes.

## Format discipline - the budget

This doc is read at intake by every quality-loop round, so its weight is paid again each time.

- **Target: ~300 lines**, `wc -l`-checked after the write. Over target, run the spill pass: an entry's
  location list past three collapses to its count plus the command that re-lists every instance (the
  scan the seat quoted - a `grep -n`, a glob). The entry itself stays, with its title, fields and first
  three locations; a class no command can list keeps its full list.
- **No per-round history in this doc, ever.** A running log of what changed round to round belongs to
  the loop's own report, never to a doc recomputed fresh every run.

## Write mechanics

**No write gate, no diff check, no stamp-triggered skip.** The doc is recomputed from the rules, the
code and the decision log every run, so an overwrite destroys nothing a re-run would not reproduce.
REPLACE the file wholesale - READ it first if it exists, so the Write is legal (an `rm` first is denied
by the auto-mode classifier).

Open the doc with a freshness line for the human reader - `As of: <branch>@<short-sha>, <YYYY-MM-DD>`
(`+dirty` appended when the working tree holds uncommitted changes). It is informational only, never a
gate: nothing reads it to decide whether to skip a run.

Create `<docs-path>/quality/` only when absent. Write ONLY `<docs-path>/quality/CODE-ASSESSMENT.md` -
never source, never the loops prompts, never the decision log, never `quality/ASSESSMENT.md`.
