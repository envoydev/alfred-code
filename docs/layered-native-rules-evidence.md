# Layered native rules - the spikes the design rests on

What Claude Code does with an agent folder reached through a symlink, and with native rule files in a subagent.
The card (layered native rules, agents linked like skills) built on three checks before any code; this page holds
the two that passed, the one not run and the rows each one carries in the code.

- Date: 2026-11-23. macOS, Claude Code 2.1.330 (the spike workspace log names the headless runs), model
  `claude-sonnet-5-5`. Headless `claude -p` runs in a spike workspace under the home folder, never under the OS temp
  folder, with the child-session environment variables unset.
- Layout: `<spike>/ws` (a git repo, the root) with `.claude/rules/root-always.md` (always on, the codeword
  `ROOT-ALWAYS-7731`) and `.claude/rules/root-cs.md` (a `paths: ["**/*.cs"]` rule, `ROOT-CS-4410`); `<spike>/ws/child`
  (a git repo) with `.claude/rules/child-own.md` (`CHILD-OWN-9902`) and `src/a.cs`.
- A plain `InstructionsLoaded` command hook, passed through `--settings`, appended every payload to `<spike>/il.jsonl`.
- Each row reads the run's result text and the hook log, never an exit code alone.

Result words: `PASS`, `NOT RUN - <reason>`.

| Check | Case | Result |
|---|---|---|
| 1 | macOS: a child session follows a symlink in `.claude/agents` | PASS |
| 1 | Windows: the same through a junction | NOT RUN - the Parallels VM had no signed-in `claude` (the first look: all VMs stopped; the second: VM `claude` 2.1.309 answered 'Failed to authenticate: OAuth session expired'). The junction itself was created (`LinkType Junction`) |
| 2 | the alfred-mods band names a path rule loaded by file type | NOT RUN - the band belongs to alfred-mods, out of scope here. A plain hook did see every load, below |
| 3 | a subagent loads the native rule files itself | PASS |

## Check 1 - Claude Code follows an agent directory symlink (macOS)

- Setup: `<spike>/ws/child/.claude/agents/spike-echo` was a symlink to the folder
  `<spike>/ws/.alfred/stack/agents/spike-echo/` (an absolute target; the installer writes a relative one), the folder
  holding `spike-echo.md` with a `name: spike-echo` frontmatter and a one-line instruction to answer with a fixed token.
- Run: one headless `claude -p` in `<spike>/ws/child`, asked to list the custom subagent types and to dispatch
  `spike-echo`.
- Result lines, from the run's `result` text:
  - 'The only custom subagent type is `spike-echo`. The others (`claude`, `Explore`, `general-purpose`, `Plan`,
    `statusline-setup`, `web-fetch`) are built in.'
  - '`spike-echo` replied: `ECHO-AGENT-OK-5521`'
  - `subagent_stats`: 2 spawned, 2 completed, 0 failed.
- Reading: the agent was listed by its frontmatter `name` and dispatched, with the link in place of a real folder.
  The installer links one agent folder per pick on macOS and Linux on this result.
- Not shown: Windows. Until a run there passes, `links.AGENT_JUNCTION_ON_WIN32` stays false and a Windows seat is a
  folder copy.

## Check 3 - a subagent loads the native rule files itself

- Run: the same workspace, one headless `claude -p` at the root, asked to dispatch a `general-purpose` subagent and to
  report which codewords its context held at start, then after it read `child/src/a.cs`.
- Result lines:
  - The subagent replied, verbatim: `ROOT-ALWAYS-7731` and `CHILD-OWN-9902` (the always-on rule text, at its start).
  - After its own read of `child/src/a.cs`: `ROOT-CS-4410` arrived, from `.claude/rules/root-cs.md`, loaded after the
    read.
  - One run's subagent answered `NONE` about the rules attached after its read; the transcript's `instructions` and
    `nested_memory` attachments carry the text, so the delivery happened and the model's report was the miss.
- The plain `InstructionsLoaded` hook logged, in `il.jsonl`, `load_reason` `session_start` for the root's always-on
  rule, `nested_traversal` for the child's rule on the first touch of a file in it, and `path_glob_match` for the
  path rule; the subagent's own loads carry an `agent_id` and `agent_type: general-purpose`.
- Reading: a subagent gets the native rules by itself, so `SubagentStart` sends part 1 only (the rules index and the
  fallback rules) and no rule text. The hook is `rules-session.js`, `@SubagentStart --part 1`.

## Where the code rests on it

- `repo-installer.md`, the Agents row of the delivery table: seats are linked library items, a folder copy on Windows
  (check 1, Windows leg NOT RUN).
- `repo-hooks.md`, the `rules-session.js` passage: `SubagentStart` sends part 1 only (check 3).
- The Windows leg is the one open item: run one headless `claude -p` over a junction in a child's `.claude\agents`
  in the VM, under `C:\Claude-MacOs\<repo>\<run>\`, then set `links.AGENT_JUNCTION_ON_WIN32` with its test.
