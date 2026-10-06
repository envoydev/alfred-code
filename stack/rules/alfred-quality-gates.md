---
description: "House baseline - quality gates: code quality, the done-claim gate, and long-running and leftover work. Always-on (no paths), installer-managed - update overwrites local edits."
---

# Quality gates

## Code quality

- No dead code (unfinished work goes in the report).
- Unit tests for new code; integration tests for DB / external service.
- Comments: none by default; a why only when the code cannot say it, in one short line. Never a ticket id, change narration, commented-out code or an unasked `TODO`; the project's comment conventions and language win; a comment your change made stale is updated or deleted. Writing a doc comment (XML docs, TSDoc, JSDoc, docstring) - the FIRST action is the `alfred-habits-code-comments` Skill call, before it is written.

## Definition of done

### The done gate

Before you claim your own change done, fixed, passing, works or ready - the FIRST action is the
`alfred-habits-done-gate` Skill call, before the claim lands.

### Claims about the outside world

- A green build proves the code compiles, not that its API is current: a claim about a package, version floor, API shape, config key or deprecation is checked against the `alfred-documentation` server (Context7, locked into every install) as you write it - recall is not the authority. Prefer the durable policy plus a fetch-at-use pointer over a pinned number.
- Use that server, not a shell stand-in (an `npx` or a registry `curl` answers only a version number). Its tools are DEFERRED: `ToolSearch select:mcp__plugin_alfred-documentation_alfred-documentation__resolve-library-id,mcp__plugin_alfred-documentation_alfred-documentation__query-docs`, then the query. Unreachable: say the claim is unverified.

### Partial work

State complete vs not vs why, then put continue / redirect / stop through the AskUserQuestion tool -
one option each, recommendation marked (a prose-only ask gets skipped).

## Long-running and leftover work

- A wait measured in MINUTES (a CI run, a container build, a full suite, an emulator boot) runs in the background while you do work that does not depend on it; arm the wait when you start it - the `Monitor` tool, deferred: `ToolSearch select:Monitor` first. A 'what is running' check keys on a specific PID, marker file or output sentinel, never a bare process-name grep; task lists track tasks, not shells.
- Infrastructure the run started to build, test or verify (a container or compose stack, a test database and its data, a dev server, an emulator, a watcher) never outlives the work silently: at close list what is still up and put tear-down-vs-keep through AskUserQuestion (batched into the flow's close ask), teardown recommended for the disposable. Tear down only AFTER the answer, and never what you did not start.
- Files the run wrote only to build, test or verify (a scratch script, a temp fixture, a coverage or log dump, a downloaded sample) are deleted once their check passes, no ask - unless the user asked for them, a later step needs them, or they are a deliverable; name those in the close. Never delete what this run did not create; `git status` at the close shows only the intended change.
