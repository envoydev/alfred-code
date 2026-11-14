---
name: auto-run
description: "Load before the first step when the user is away or says 'auto mode', 'without stopping', 'run without asking' or 'take the recommended options'."
---

# Auto-run - take the recommended option and keep going

The user said to run without them. A session parked on a question costs them the whole time they are away and buys
nothing; a wrong ruling costs rework they can see and undo. So every ask that would go to them takes its
`(Recommended)` option, every such choice is written down, and only the acts below still stop the run.

## When to use

- The user's words: 'auto mode', 'auto-run', 'run without asking', 'take the recommended options', 'continue without
  me', or that they are away.
- It is on from that message for the rest of the session. A message the user types mid-run keeps it on and is
  answered; a message starting with 'stop auto run' turns it off for the rest of the session.
- This repo's own skill, kept in claude-kit and synced into each repo; the stack's typed mode for consuming projects
  is a different thing.

## The ledger

ONE run ledger holds the mode for the whole run, however many plans it spans: the ledger file the user's run already
names, else `docs/superpowers/<YYYY-MM-DD>-auto-run.md` under the project root.

1. The first action writes `Auto-run: on - '<the user's words>'` into the run ledger, directly under its title.
2. Rulings made while a plan executes go to that plan's `docs/superpowers/sdd/<plan basename>/progress.md` too.
3. After a compaction, Read the run ledger's `Auto-run:` line before the next ask: it is how the mode outlives the
   summary.
4. 'stop auto run' appends `Auto-run: off - <date>`.

## The rule

- Every ask that would go to the user takes its `(Recommended)` option, and the ledger gets
  `Ruling: <the ask> - <the option taken> - <cost if wrong>`.
- An ask with no marked option takes the option you would recommend, ledgered the same way.
- The user's own words about how to run ('one by one without stopping') outrank a prompt file's or a plan's own
  'one task only': finish a task, write its ledger line, start the next in the same turn.

## What still stops

- A push, a merge, a version bump, a billed run (named with its cost), anything irreversible or outward-facing (a
  publish, a deletion outside the scratchpad and the docs root with no backup, a message to another person), and a
  security-sensitive action - unless the user's own words in this session already authorised that exact act.
  - A merge can be refused even then: Claude Code's auto permission mode denied a `gh pr merge` the user had asked
    for (2026-11-04). When the run will end in a merge, ask for it before the user leaves - they merge it themselves
    (`! gh pr merge <n> --merge`) or add a permission rule for it. Never route around a denial; what depends on the
    merge, such as tags or a marketplace move, waits with it.
- A guard's security ask - a credential shown, work discarded, a write outside the project, a protective guard
  switched off - is never auto-run's to answer, whatever the user authorised around it: take its safe option and list
  the act under `Left for you`. Only the user's own pick of its unsafe option opens it; a reply that merely implies it
  does not (2026-11-04: a discard guard refused a receipt written on such a reply).
- A plan so broken that every path forward is a guess.
- A design - a spec, graded or not, or a bounded in-chat design - waits for the user's yes (the user, 2026-11-10,
  keeping design approval theirs), unless the user's own words in this session hand it to you: 'approve the specs
  and plans yourself', 'even specs approval must be done by you', 'specs included' (B2, ruled 2026-11-04). A request
  that only names a spec as its work ('implement specs/x.md without stopping') does not, and neither do the trigger
  words above. With that waiver a spec is approved on the bar a plan meets below, and a bounded in-chat design, which
  has no grade, is approved as written.
- A graded implementation plan does NOT stop - the trigger words alone carry this, no waiver is needed (the user's
  ruling, 2026-11-10: 'when I enabled it you must approve plans by your own, not wait for me'). Once the
  refining-plans loop passes it - 90 or more, no BLOCKER open - the run approves it: the ledger gets
  `Ruling: approval of <path> - approved by the run at <score path> - <cost if wrong>`, the file's status line says
  'approved by the run under auto-run', and the build starts in the same turn with the execution method its handoff
  recommends. A skill's own 'ask the user to review' step for the plan, its handoff included, is that approval and
  is not put. A turn that ends on 'please review the plan' for a plan at 90 or more is this rule skipped (2026-11-04:
  two such stops in one run).
- A spec or plan whose grade loop ended under 90, on its best round, waits for the user's approval with its score
  path and open findings (the user, 2026-11-10), and the run goes on with work that does not depend on it.
- A stop names the one decision it needs.

## Scope

Work the request does not name is not done. It goes in a `## Optional` list in the close, each line
`Recommended - <reason>` or `Not worth it - <reason>`.

Tool permission prompts follow Claude Code's permission mode; this skill changes none.

## The close

```text
Done: <what the request asked for, and whether it is met>
Changed: <files, and each commit with its subject>
Checks: <each command run, with its result line>
Decisions auto-mode made for you:
- <the ask> - <the option taken>
- approval of <path> - approved by the run at <score path>
Left for you: <each outward act, each NOT RUN and why> | none
```
