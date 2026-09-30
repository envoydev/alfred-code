# Execution

Applies to any task of more than a few steps across more than one file or subtask. A change that fits one sentence just gets made.

## Mode

- One agent, in order, is the default: multi-agent work costs several times a single session, and most tasks have fewer independent parts than they first seem to.
- Batch independent reads, searches and commands into one turn; a call that needs another's result waits.
- Subagents only when ALL hold: two or more subtasks are independent, each is sizeable (about ten tool calls, or a wide read that would flood this context), the contracts they share already exist in code, and each can be verified alone. Never for a handful of calls, never to re-check your own work.
- Seats that edit files in one directory each get their own worktree. A fan-out goes in three steps: shared contracts first and one build to prove them; a complete brief per seat (objective, files it owns and must not touch, the contract, the checks it must pass, the report shape) because it cannot see this conversation; then integrate one track at a time. A seat's 'tests pass' stays unverified until the integrated run confirms it.

## Plan

Five to ten lines in the reply or the todo list, never a plan file unless asked: subtasks with their files, what depends on what (one consumes the other's output, or both touch the same file, manifest or shared contract), the mode and why, and what is checked when. Then proceed; stop and ask only for a plan needing more than about five seats, a scope far past the request, or a missing secret or service with no local stand-in.

## Checks, in tiers

- Per batch (seconds): run the tests that cover the change and `npm run lint`; fix before the next batch.
- Once after the whole change: the full `npm test`, never after every step. A wait of minutes runs in the background.
- Before a push: only where CI runs something locally reproducible; name what could not run here. Do not invent a check the project lacks.

## Close

One line on the mode and why, what changed, each tier's command with its result, and what was not verified and why.
