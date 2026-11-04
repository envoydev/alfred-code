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
- This repo's own skill; the stack's typed mode for consuming projects is a different thing.

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
- The approval of a design - a graded spec or plan, or a bounded in-chat design (the user's ruling). Words in the
  user's request that name plans, specs or their approval waive them, all kinds at once - 'approve the graded specs and
  plans yourself', 'even plans approval must be done by you', 'plans included' (B2, ruled 2026-11-04) - never the
  trigger words above alone; with the waiver, the score path or the design is reported in place of the ask.
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
Left for you: <each outward act, each NOT RUN and why> | none
```
