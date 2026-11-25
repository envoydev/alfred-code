# Execution

Applies to any task of more than a few steps across more than one file or subtask. A change that fits one sentence just gets made.

## Mode

- One agent, in order, is the default: multi-agent work costs several times a single session, and most tasks have fewer independent parts than they first seem to.
- Batch independent reads, searches and commands into one turn; a call that needs another's result waits.
- Subagents only when all hold: two or more subtasks are independent, each is sizeable (about ten tool calls, or a wide read that would flood this context), the contracts they share already exist in code, and each can be verified alone. Never for a handful of calls, never to re-check your own work. A seat a skill prescribes - the plan grader, an audit's planner and editor, a step whose model is not this session's - is that skill's call and outside this limit.
- A role's model the user names in chat - 'plan model fable', 'review with opus' - is saved in `.claude/kit/settings.json` and is that role's model in every session until it is changed (the user, 2026-11-16). Where that request's `kit status` line says `saved: plan_model=fable`, the status hook saved it; where the line carries no `saved:` for it, run `node .claude/kit/settings.mjs set plan_model <model>` (or `audit_model`, `review_model`, `implement_model`, `search_model`) and say what it printed. A dispatch takes the model the line gives.
- Seats that edit files in one directory each get their own worktree. A fan-out goes in three steps: shared contracts first and one build to prove them; a complete brief per seat (objective, files it owns and must not touch, the contract, the checks it must pass, the report shape, and that a blocked command stops the seat, as 'Blocked commands' below says) because it cannot see this conversation; then integrate one track at a time. A seat's 'tests pass' stays unverified until the integrated run confirms it.

## Plan

Five to ten lines in the reply or the todo list, never a plan file unless the user asked for one or started a flow that writes one: subtasks with their files, what depends on what (one consumes the other's output, or both touch the same file, manifest or shared contract), the mode and why, and what is checked when. Then proceed; stop for the user only on a plan needing more than about five seats, a scope far past the request, or a missing secret or service with no local stand-in, and ask through the AskUserQuestion tool with concrete options and one marked recommended - the option an auto-run takes; where the tool is absent (a subagent seat, a headless run), give the same options in plain text with the recommended one marked, and stop.

## Checks, in tiers

- Per batch (seconds): run the tests that cover the change and `npm run lint`; fix before the next batch.
- Once after the whole change: the full `npm test`, never after every step. A wait of minutes runs in the background.
- Before a push: run here every command the repo's CI workflow runs (`.github/workflows/`), in its order, and push only when each passes - the remote run confirms the other operating systems, it is never the first run. Name what could not run here (another OS's leg, a step behind a secret). After the push, watch the run to its end; a red run is fixed before anything else is pushed. Do not invent a check the project lacks.
- A `claude` run under a throwaway `HOME` on macOS - a probe, a harness, a scratch project - puts a `security` stub first on its `PATH`: `printf '#!/bin/sh\ncase "$1" in find-*) exit 44;; esac\nexit 1\n' > <dir>/security`, then `chmod +x`. Why: with no keychain under that `HOME`, Claude Code's credential save opens macOS's 'Keychain Not Found' dialog on the user's screen, and its 'Reset To Defaults' can replace a keychain (2026-11-19). alfred-tools' `withKeychainStub` (`tests/helpers.ts`) is the same stub in code.

## Blocked commands

- A command or tool call that a guard hook or the permission mode blocks is never rewritten, split, encoded or renamed to get past the block. Why: the block is the user's check, and a command shaped to pass it takes that check away (2026-11-25: a run split a variable name to pass a secret guard).
- Never reach the blocked effect by another route. Judge the effect by the end state of the files, not by the command: another command, a tool call, a script and another agent are each a route. Example: after a blocked `git checkout <file>`, a `git show HEAD:<file> > <file>`, a `git restore`, a `git stash` and a Write or Edit back to the old text reach the same end. Why: a fix seat restored a file with `git show` after its `git checkout` was blocked (2026-11-25).
- Drop the part the block objects to only where the task does not need that part. Else stop, quote the message, and give the user the command to run or the permission rule to add.
- A subagent seat stops the same way and reports the block, its message and the command to the session that dispatched it. That session reaches the effect by no other route either. It may run the same command where the guard or the permission mode asks the user, and it names the block to the user - under auto-run, in the close's 'Left for you'.

## Close

One line on the mode and why, what changed, each tier's command with its result, the `cleanup` rule's `Cleanup:` line, and what was not verified and why.
