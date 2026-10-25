---
name: task-auto
description: "Use when the user types /task-auto <request> - the request runs start to finish in auto-mode, each ask taking its Recommended option."
disable-model-invocation: true
---

# Task auto - any request, start to finish, without waiting

The user typed `/task-auto <request>` and walked away. Typing it is the waiver: the hook has written the auto-mode
stamp, every ask that marks a (Recommended) option is answered with it, and the run goes on until its close. The limits
stay where they are - nothing outward, nothing paid.

**Availability** - the flows this skill names are user-typed commands, installed only where the install picked them. The
`Solve flow:` line in context says whether the solve flow is installed here; any other flow named below is never run
from this skill, only named for the user.

## When to use

- Any request typed after `/task-auto`: a feature, a fix, a refactor, a failing test, a question, a doc.
- The banner reads `Auto-mode: OFF` (no request, only the flag, or another session's run holds the stamp): say in one
  line why it did not start, as the banner gives it, and stop.

## The route

Say the route in one line before the work, then take it:

1. **A code change** - the request will edit a file outside the docs root, the data root and `.claude/` (a feature,
   a fix, a refactor, a failing test), whatever its size. Read the file the `Solve flow:` line names, whole, and
   follow it as this run's flow with the request as its task, from its first step to its close: its sizing, its plan
   file, its building in this chat or in seats as its recommended options say, its review and its commit checkpoint.
   Its `references/` and `scripts/` paths sit beside that file.
   - After a compaction, Read it again before the next step. The `Solve flow:` line is gone by then; the file is
     `skills/task-solve/SKILL.md` under the account's config folder, else `.claude/skills/task-solve/SKILL.md` in
     the project.
   - `Solve flow: not installed here` - one `Left for you:` line, `/task-solve --auto-mode <request>`, and the close.
   - A `cross` size, whose row names `/task-solve-cross`, is the user's command: one `Left for you:` line,
     `/task-solve-cross --auto-mode <request>`, and the close.
2. **Another user-typed flow's job** - a version upgrade (`/task-version-upgrade`), a build from scratch
   (`/task-build-from-scratch`), a diagnosis (`/issue-diagnoser`), a quality loop (`/loop-code-quality`,
   `/loop-architecture-quality`, `/loop-test-coverage`), a capture (`/capture-awareness`, `/capture-preferences`,
   `/capture-project-code-style`, `/capture-usage-report`), a change across several parts (`/task-solve-cross`). Not
   run here: one `Left for you:` line, `/<that flow> --auto-mode <request>`, and the close.
3. **Anything else** - a question, a doc under the docs root: do it directly. A file it writes stays uncommitted and
   is named in the close.

## The limits

- `task-auto` commits nothing itself; the solve flow's commit checkpoint does.
- Never push, merge, deploy, publish, open a PR or pay - each goes under `Left for you:`.
- Work the request does not name goes in the close, each line marked `Recommended - <reason>` or
  `Not worth it - <reason>`.
- Tool permission prompts follow the user's permission mode; this skill changes none.

## The close

After the flow's own close, when one ran:

```text
Done: <what the request asked for, and whether it is met>
Changed: <files, and each commit with its subject>
Checks: <each command run, with its result line>
Decisions auto-mode made for you:
- <the ask> - <the option taken>
Left for you: <each outward act, each NOT RUN and why> | none
```

Then delete the stamp if the flow's close left it, as the contract's item (7) says - that ends auto-mode.
