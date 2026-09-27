# Evidence tiers and reachable sources

Read at step 1 TRIAGE, before the tier is named. The tier is the first thing the run establishes
and the last thing its verdict is qualified by; this file is the table it is named from and the
list of what the skill can actually reach.

## The tiers

No source is a lower tier, never a blocker:

| Tier | What you have | What it buys |
|---|---|---|
| 1 | stack trace / exception with a frame, or a failing test | a symbol to start at |
| 2 | a log window around the failure, a red CI run, a monitoring event | a time-ordered sequence |
| 3 | reproducible steps a human wrote down | a repro you can run |
| 4 | a screenshot, a single symptom line, a prose report from a client | a behaviour to locate in code |

A tier-4 report is the DEFAULT case, not an edge case: most projects have no CI, no error
monitoring, and no retained logs. There, step 2 turns prose into an observable and works
code-first - locate the named behaviour, read the paths that could produce the symptom, try to
reproduce - and the verdict says plainly which tier it rests on.

## Sources - what this skill can reach

- **In reach, always:** files and logs on disk, the repo's own history, anything the user pastes
  into the chat, and the app itself when it can be run locally.
- **In reach when the project has it:** the `gh` CLI for a red pipeline; an error-monitoring MCP
  where the project registered one (the baseline comments out the MCPs a project does not need,
  so it can simply be absent from your tool list here).
- **Never in reach:** a LINK. A monitoring-issue URL, a private dashboard, a ticket - if no tool
  in this session can fetch it, say so in one line and ask the user to paste the event, rather
  than guessing what it contained.
