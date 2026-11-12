# Workspace source - stage 0 evidence

What Claude Code does with the host behaviours the workspace-source stages 1 to 4 lean on, measured before any of
them is built. Nothing here ships: the rows were run with `meta/probes/hook-delivery.js`, which starts Claude Code in
print mode against a stand-in Messages API on 127.0.0.1, records every request and answers from a script.

- Date: 2026-11-12.
- Claude Code: 2.1.322 on macOS, 2.1.309 on the Windows VM. git 2.56.0 on macOS, 2.55.0.windows.5 on the VM.
- Every run went to the local stand-in: $0, no request to the vendor, an empty throwaway config folder per run.
- A result is quoted from a recorded request, a hook's event file, the file on disk or git's output. `<root>` and
  `<child>` are folders of a throwaway project.
- A stand-in shows what Claude Code SENDS, never what a model does with it.

Result words: `yes`, `no`, a measured value, `NOT RUN - <reason>`. `STOP <stage>` marks a result that contradicts a
fact the design leans on.

## What changed a plan

- **A dispatched agent starts async** (2.1.322): the `Agent` call answers 'Async agent launched successfully' and the
  subagent's requests arrive beside the session's later ones. The probe scripts each actor apart (`"sub": true`).
- **The cap is exactly 10,000 characters** (P1): 10,000 arrive whole, 10,001 are replaced by a file path. It counts
  characters, not bytes.
- **A skill's `model:` line does not move the request's model** (P5), so stage 2 builds no skill entry.
- **A dispatch hook takes an alias only** (P6): a full model id fails the `Agent` tool's schema.
- **`Explore` and `Plan` load no project rule** (P8): the loader's skip list for built-in types is those two.
- **`--add-dir` carries the root's skills into a child that is its own repository** (P9); the settings key does not.
- **No compaction could be forced at $0** (P7), and auto mode does not run against a stand-in (P12b): both NOT RUN.
- **On Windows the Edit tool's own write breaks a hard link** (P11), and so do a save by replacement and a
  `git checkout`. The design's own rule for that result: a Windows agent is a real copy with its recorded hash, no
  hard link (stage 3).
- **On Windows a root's `settings.local.json` does not reach a child in the same repository** (P13): the rows from
  above that Section 4 warns about exist on macOS and Linux only.
- **The Windows rows ran on 2.1.309**, the release the VM holds; the macOS rows on 2.1.322.

## The rows

| Row | Result | Evidence | Leans on it |
| --- | --- | --- | --- |
| P1 the cap's edge | 9,999 and 10,000 ASCII characters arrive whole; 10,001 is replaced. 9,999 non-ASCII characters (19,983 bytes) arrive whole; 10,001 (19,987 bytes) is replaced. The cap counts characters | At 10,001 the request holds `SessionStart hook additional context: <persisted-output> Output too large (9.8KB). Full output saved to: <a file under the config folder>`. Control: 9,500 whole | Section 1's part size of 9,500 holds (F8) |
| P2 the real set | All five parts whole | A copy-route install at project scope wires seven SessionStart rows (six fire on a startup, the `compact` row does not). Five more rows of 9,500 characters each: every closing marker is in the first request, none replaced by a preview. The seven installed rows add 1,122 characters on a fresh startup; with the five parts the one hook context is 48,566 characters. Control: the same install without the five, no part marker | Section 1: twelve rows wired, eleven firing |
| P3 resume and fork | On `--resume` and on `--resume --fork-session` the first request still holds run 1's push, and a hook that pushes again is delivered again | The hook saw `source: resume` and `source: fork`; run 1's marker once in each first request, the second run's own marker beside it. Run 1: `source: startup` | Section 1's 'those two sources send nothing' is right: a push there would double the text |
| P4 PostToolUse after a touch | `yes` for all four | Under `acceptEdits`: an Edit (the file changed on disk, the tool result no error, the marker in the next request), a Write (the same), a Read of a file at the project root, and a subagent's Read (the marker in the subagent's next request). Control: a main-session Read of a sub-folder file | Path rules through the loader (Section 6) |
| P5 a skill's model | `no` for the alias and for a full id | `model: haiku`, then `model: claude-sonnet-5-5` (the id P6's control request shows for a `sonnet` pin): the `model` of every request after the Skill call stays the session's (`claude-opus-5-5`), also two tool calls later in the turn. After the alias run's Skill call the request's own text says 'You are powered by the model named Haiku 5.5', but the request is not sent to it. Control: no `model:` line, the same model | Section 3: stage 2 builds no skill entry (the spec's stated fallback) |
| P6 a pinned seat with an entry | Alias `yes`; full id `no` | An agent file pinning `model: sonnet`, a PreToolUse hook on `Agent` returning `updatedInput.model` and no permission decision. `haiku`: the subagent's first request is `claude-haiku-5-5` (the pin alone: `claude-sonnet-5-5`; the session: `claude-opus-5-5`). `claude-haiku-5-5`: the dispatch is refused, 'PreToolUse hook for Agent returned updatedInput that failed schema validation ... expected one of "sonnet", "opus", "haiku", "fable"' | Section 3's seats: the reader accepts aliases only |
| P7 a subagent's compaction | `NOT RUN - no compaction in three tries` | The stand-in reported `usage.input_tokens` of 190,000, 400,000 and 950,000 on every answer. The subagent made five requests in each run, its SubagentStart push in all five; no PreCompact, PostCompact or `compact` SessionStart event fired and no summary request was sent | Section 1's three-way rule for a compacting subagent stays unmeasured |
| P8 built-in agent types | `general-purpose` yes (control), `claude` yes, `statusline-setup` yes; `Explore` no, `Plan` no | The five types the first request's agent listing names, each dispatched in a project holding one pathless rule; the read is that rule's marker in the type's first request | The SubagentStart skip list (F20) |
| P9 the root's skills by added directory | `permissions.additionalDirectories`: no. `--add-dir`: yes | A child that is its own repository below a root holding one skill. With the root in the child's `permissions.additionalDirectories` the skill's marker is absent from the child's first request; with `--add-dir <root>` it is there. Controls: a same-repository child receives it; a child in its own repository with nothing added does not | Section 2 (F2). The `yes` re-opens whether a link is needed for a session started with `--add-dir` |
| P10 Windows: delivery | `yes` for all three deliveries, in a root and in a child; the model hook `yes` | A SessionStart push is in the session's first request and not in a subagent's; a SubagentStart push is in the subagent's first request; PostToolUse context after a Read is in the session's next request. A dispatch hook returning `haiku`: the subagent's first request is `claude-haiku-5-5`. Control (neither flag): no marker, the subagent's request `claude-opus-5-5` | Sections 1 and 3 on Windows (F10) |
| P11 Windows: links | The links load and a child's own agent wins. Every save tried breaks the hard link | A junction per skill and a hard link per agent, in a root and a child: each marker once in the first request; the child's own agent of the same name is the one listed. An Edit through the child's path under `bypassPermissions` lands and leaves two files with different bytes; so does a rename of a temp file over the store's file, and a `git checkout` of it (a change written in place keeps one file). Under `acceptEdits` the Edit is refused - `.claude` is a protected path - so that run reads nothing. Control: the same store with no link, no marker | Section 2 on Windows. The Edit result is the design's own 'revisit' case: stage 3 makes a Windows agent a copy |
| P12 the write block's ask | (a) a subagent under `acceptEdits`: `yes`. (b) auto mode: `NOT RUN`. (c) Windows, the main session: `yes` | (a) A throwaway plugin loaded with `--plugin-dir` whose PreToolUse hook answers `ask`: the file is unwritten and the tool result is the refusal 'PROBE-ASK: this write changes the project rules'; without the plugin the same Write goes through. (b) `--permission-mode auto` is taken (the init line reports `auto`) but the first tool call is refused: 'Auto mode is unavailable: its safety check does not run for this session'. (c) The same throwaway plugin under `acceptEdits`: the file is unwritten and the tool result is the refusal; without the plugin the Write goes through | Section 1's write block (F24) |
| P13 the root's local settings | Windows: neither row reaches the child. Linux: `NOT RUN` | A deny row `Agent(<seat>)` and an `env` key in the ROOT's `.claude/settings.local.json`, the session started in a child of the same repository: the agent is still listed, its dispatch runs and the key is unset - as in the control with the rows absent | Section 4's 'rows from above' (F26): not on Windows |
| P14 the store's layout (macOS) | `yes` | A root whose `.claude/skills/<a>`, `<b>` and `.claude/agents/<x>.md`, `<y>.md` are relative symlinks into `.alfred/stack`: each of the four markers once in its first request. A sub-folder child linking `<a>` and `<x>`, with `skillOverrides: { <b>: 'off' }` and a deny row `Agent(<y>)` in its own `settings.local.json`: `<a>` and `<x>` once, `<b>` and `<y>` absent. A child in its own repository linking `<a>` and `<x>`: the same. A dispatch of `<x>` runs from each child. Control: real folders and files, no store, the four markers once | Section 2 (F28; a root's own links; 'In one repository') |
| G1 `git clean -fdx` over a link | macOS: no file lost. Windows: no file lost | macOS: a committed store, symlinks in the root and the child; a clean in a child that is its own repository, in a sub-folder child and from the root above it removes the child's link and leaves the store whole. Control: the same three cleans with no link. Windows: a committed store, a junction per skill and a hard link per agent in the root and the child, the same three cleans: the child's junction and hard link are removed and the store is whole. Control: no link, the store whole | The Windows gate of Section 2 |
| G2r removing a junction from Node | Every form removes the junction and leaves its target whole | `fs.rmSync(link)`, `fs.rmSync(link, { recursive: true })`, `fs.unlinkSync(link)` and `fs.rmdirSync(link)`, each on a fresh junction whose target holds one file: no error, the junction gone, the file there. Node v22.23.3 | Stage 3's unlink step |
| G3 F16 | The file is not re-included: the root line wins | A root `.gitignore` line `.alfred/`, an inner `.alfred/.gitignore` of `*`, `!.gitignore`, `!keep.md`, an empty global config: `git check-ignore -v .alfred/keep.md` names `.gitignore:1:.alfred/`, and `git status` lists only the root `.gitignore`. Control: no inner file, the same line | Stage 1 (decision 2's inner `.gitignore`): F16 holds |
| G4 the include's path form | `NOT RUN - not built, the owner's decision 2` | - | nothing |
| O1 the prompt itself | `NOT RUN - the owner's one live session` | The project and its throwaway plugin are built by one command; the hand-off is in the stage's close | Section 1 |
| O2 the Cursor fixture | `NOT RUN - the owner's run in Cursor` (nine cells) | `cursor-fixture.js` is rebuilt on the shipped layout and builds its tree; Cursor is not installed on the build machine | Section 6's Cursor column |

The Linux half of P13 is `NOT RUN - no Claude Code binary in the gate's Linux image`.

## Re-running a row

```text
node meta/probes/hook-delivery.js <project> <label> --approve --inject -- SESSION-INJECT-MARK
node meta/probes/hook-delivery.js <project> <label> --approve --inject --inject-size 9999 -- SESSION-INJECT-MARK
```

Each prints `SESSION-INJECT-MARK: main-1` while the stand-in still drives the installed release and the cap has not
moved under 9,999. Run both on each Claude Code release before a stage is built on these rows.

## Stage 4a - G1

The rule loader's rows, from the core entry's own generated hooks block, against the local stand-in ($0). Claude Code
2.1.322, macOS, 2026-11-12. The fixture is built by hand: a stamped root `ws` with `.alfred/stack/rules/g1-a.md`
(`G1-ROOT-A`), `g1-b.md` (`G1-ROOT-B`) and `g1-ts.md` (`paths: ["**/*.ts"]`, `G1-PATH`), and a joined child `ws/api`
with `g1-c.md` (`G1-CHILD`). 'Once' is counted over the request's JSON text.

| Cell | Result | What was read |
| --- | --- | --- |
| a main request | `yes` | `G1-ROOT-A` and `G1-ROOT-B` each once in the first request, inside `Project rules, part 1 of 1`; `G1-CHILD` absent |
| a subagent's request | `yes` | The two root markers each once in the subagent's first request |
| a child session's request | `yes` | `G1-ROOT-A`, `G1-ROOT-B` and `G1-CHILD` each once in the first request |
| a path rule | `yes` | `G1-PATH` absent from the first request, once in the request after the Read of `src/a.ts` |
| the request after a compaction | `NOT RUN` | One try: the session resumed with `/compact` passed to the probe's fixed prompt gave one `SessionStart` with source `resume` and no `compact` event. The unit tests of the `compact` source stand in; one live session is the open cell |
| the inert state | `yes` | The same root with `.alfred/stack/rules` moved aside: no `Project rules` text in the first request |
| the rows' cost | macOS 31-34 ms, Linux 20-23 ms, Windows 84-118 ms | Medians of 20 starts each: macOS (Node 24) `--part 1` 33.9 / 31.1 ms with and without the store, PostToolUse 32.9 / 31.1; Linux (`node:22` container) 22.3 / 20.0 and 22.7 / 19.9; Windows (two runs, below) |

### Windows

The same four cells and the timing in the gate's Windows 11 VM, Node 22.23.3, the rows written in shell form with the
guest's `node.exe` spelled out, on the committed loader (6032e9d0). `claude update` run as the VM's service account
installed 2.1.322 into that account's profile and left the user's copy at 2.1.309, so the cells ran 2.1.322 from there
and the install was removed afterwards. The gate's `win` leg ran the loader's eight test files: 314 tests, 0 failed,
10 skipped (the two loader tests that need POSIX permissions or links, and eight earlier Windows skips in the other
files).

| Cell | Result | What was read |
| --- | --- | --- |
| a main request | `yes` | `G1-ROOT-A` and `G1-ROOT-B` once each in the first request, `G1-CHILD` absent |
| a subagent's request | `yes` | The two root markers once each in the subagent's first request |
| a child session's request | `yes` | `G1-ROOT-A`, `G1-ROOT-B` and `G1-CHILD` once each in the first request |
| a path rule | `yes` | `G1-PATH` absent from the first request, once in the request after the Read of `src/a.ts` |
| the rows' cost | 84-118 ms | Two runs of 20 starts each. Run 1: `--part 1` 101.7 / 89.8 ms with and without the store, PostToolUse 118.4 / 96.4. Run 2: 90.0 / 83.6 and 89.6 / 90.2. A bare `node -e 0` start in the same VM took 89 ms, so almost all of it is the runtime's start |

Run 1's PostToolUse median is over the 100 ms line the design set for the per-file row, so the choice of a row on
every file action goes back to the owner; nothing was changed to get under it.

## Stage 4b - G2

Does a rule the loader sends get followed as well as the same rule loaded by Claude Code itself? 2026-11-12, Claude
Code 2.1.322, model `claude-sonnet-5-5` (the `sonnet` alias, one id on all 120 init rows), effort `high`, macOS, the
stack at 8c16aa5d. Twelve clauses, five runs per arm, 120 billed sessions through the `skill-comply` fixtures at the
`plain` prompt level, each in its own `HOME` and config dir.

- **Native arm** - the copy-route install as shipped: the rules in `.claude/rules`.
- **Loader arm** - the same install, then before the scaffold every `.claude/rules/*.md` that is also a shipped rule
  moved by hand into `.alfred/stack/rules` (stage 4c's move is not built): the six pathless rules, `markdown-docs` and
  the fixture's stack rules. Each case was checked: a native case got no loader block; a loader case moved all six
  pathless rules and got every `Project rules, part k of n` block with its closing line (120 of 120 valid). A $0 probe
  of one case per arm showed each pathless rule's marker once in the first request, and a path rule absent from the
  first request and once after the Read of a matching file.

A hit is the clause's step graded PASS after a read of the transcript; a run that never reached the clause's trigger
is a miss in either arm. All 120 reads agreed with the grader.

| Clause | Rule | Native (of 5) | Loader (of 5) | Down |
| --- | --- | --- | --- | --- |
| C1 `interaction-literal-example` | alfred-interaction | 5 | 5 | 0 |
| C2 `interaction-permission-given` | alfred-interaction | 5 | 5 | 0 |
| C3 `answer-budget` | alfred-interaction | 5 | 5 | 0 |
| C4 `tier4-house-voice` | alfred-interaction | 5 | 5 | 0 |
| C5 `preferences-branch-pattern` | alfred-preferences | 5 | 5 | 0 |
| C6 `tier4-docs-placement` | alfred-docs-root | 4 | 4 | 0 |
| C7 `tier4-secret-handoff` | alfred-security | 5 | 5 | 0 |
| C8 `habits-code-comments` | alfred-quality-gates | 0 | 0 | 0 |
| C9 `rule-navigation-large-json` | alfred-navigation | 5 | 5 | 0 |
| C10 `csharp` | csharp-conventions (path) | 5 | 5 | 0 |
| C11 `rule-javascript-load` | javascript-conventions (path) | 5 | 5 | 0 |
| C12 `rule-markdown-load` | markdown-docs (path) | 5 | 5 | 0 |

`G2: PASS - native 54/60, loader 54/60, worst clause down 0`. The pass line, fixed in the design before the run: 'the
loader passes when its hits over the sixty runs are at most five under native's and no clause is down by four or
more of its five'; with equal arms it is crossed by chance in about 13% of rounds at 80% adherence, 5% at 90%, 1% at
95%.

- **The misses.** C6: one run per arm stopped to ask how to gather before a first architecture capture and wrote
  nothing. C8: no run in either arm wrote a doc comment at all (the rule's 'none by default' held), so the
  doc-comment trigger never fired and every run is a miss - the clause cannot separate the arms in this fixture.
- **What C10-C12 measured.** Loads before the first touch of a matching file: native 14, loader 12 of 15 each - the
  skills' own descriptions fire on the prompt, so those hits do not need the rule. Hits after the touch: native 1 of 1
  run, loader 3 of 3. Fewer than five such runs per arm: the path-rule half of the round did not test delivery. The
  $0 probe above and the unit tests are what show the path push arrives.
- **Nudges and shell touches.** No hit followed a `This command touches files governed by` nudge in either arm
  (`withoutNudged` is also `PASS`). Shell first touches: native 6, loader 7. A load before the touch counts as a hit.
- **Not run.** None: 120 of 120 sessions ended `ok`.
- **The compaction cell** (the open G1 cell): one print-mode session in a loader case project - a Read, `/compact`,
  then two more messages. The `compact` start fired, and after the compact boundary one `SessionStart` attachment held
  parts 1, 2 and 3 of 3, each opened and closed once. Print mode dropped the two messages queued after `/compact`, so
  the path rule's return was not seen live; the per-session record was gone after the run, and the loader's unit test
  'path rule: again after a compaction and after a clear' pins the return. Result: `yes` for the parts.
- **Spend.** $16.27 for the 120 sessions (smoke $3.25 for 24, reps $13.02 for 96) plus $0.14 for the compaction
  session: $16.41 of the $40 cap.

## Stage 4c - the rule move

The library rules move from `.claude/rules` to `.alfred/stack/rules`, sent by the loader of stage 4a. Proved on
installer-made temp projects from this working tree (`--source <repo>`, a local export registered first), every row
on an isolated home and account dir, the real account's `installed_plugins.json`, `known_marketplaces.json`,
`settings.json` and `~/.gitconfig` hashed before and after (unchanged). macOS, Claude Code 2.1.322, Node 22.23.3,
2026-11-12, on the fix-pass tree (81d71903).

**The matrix.** 183 PASS, 0 FAIL, 1 NOT RUN, 41 stand-in sessions ($0). The NOT RUN is the same-repository sub-folder
child: the installer runs a sub-folder as its repository's root and join refuses a same-repository child (stage 3).
The rows cover a fresh install, an update over 3.10.0, a re-run (no byte changed), the user's own rule and edited
rule kept, a garbage stamp and a garbage `workspace.json`, every scope, a joined child, the write block under
`acceptEdits` and `bypassPermissions`, a worktree and the revert. What the rows showed beyond a pass:

- An edited library rule is overwritten by the source text at the move, as every update overwrites one today.
- A rule-less selection leaves an empty store and the canary; deleting `.alfred` and updating lays no rule again,
  as 3.10.0 does for a deleted `.claude/rules`.
- A native `.claude/rules` file wins by name over a store file of the same name.

**The cells ($0, the local stand-in).**

| Cell | Result | What was read |
| --- | --- | --- |
| a main request | `yes` | Each always rule once, one `Project rules` block, the canary once |
| a subagent's request | `yes` | Each always rule once |
| a path rule | `yes` | `markdown-docs` absent from the first request, once in the request after a matching Read |
| `disableAllHooks: true` | `yes` | The canary text once, no `Project rules` block |

**The boundaries.** A store rule of 65,535 or 65,536 bytes is sent and fills the five parts (a 9-byte rule beside it
is then not sent, and status names it `not sent`); one of 65,537 bytes is skipped, status printing `rule skipped:
.alfred/stack/rules/big.md - over 64 KB`, and the small rule is sent. A workspace 8 deep reaches its top root's rule;
9 deep does not (the walk stops at 8), the next root's rule still sent.

**Linux.** The gate's `linux` leg on the 35 test files the stage touched: 1566 tests, 0 failed, 6 skipped.

**Windows.** The gate's `win` leg on the same files first failed one test of 1566: the status floor's rows are posix
on every OS and the test built its expected sources with the platform separator. The test was fixed (a test bug, two
assertions) and the leg re-run on the file: 24 tests, 0 failed, 1 skipped (d1928e8f). Stage 4a's G1 cells then ran in
the gate's Windows 11 VM through its `win-g1.js` recipe on the committed 4c loader (d1928e8f), the guest's Claude Code
2.1.309 (not updated), Node 22.23.3, against the local stand-in ($0), on stage 4a's hand-made fixture with the rules
in `.alfred/stack/rules`; the installer's own Windows route is covered by the leg's install tests.

| Cell | Result | What was read |
| --- | --- | --- |
| a main request | `yes` | `G1-ROOT-A` and `G1-ROOT-B` once each in the first request, `G1-CHILD` absent |
| a subagent's request | `yes` | The two root markers once each in the first subagent request |
| a child session's request | `yes` | `G1-ROOT-A`, `G1-ROOT-B` and `G1-CHILD` once each in the first request |
| a path rule | `yes` | `G1-PATH` absent from the first request, once in the request after the Read |

**The revert.** An older installer lays no rule when the stamp reads none back, so deleting the store copies would
leave a project with no rules. The revert is a recipe run over each project BEFORE the first update from the tree the
revert lands on: each `.alfred/stack/rules/<name>.md` the stamp's `library-rules` line names at its stamped hash
moves back to `.claude/rules/<name>.md` (a file changed since the install is kept in the store and named; where the
name is already taken there, the store copy is removed and the native file stands), the canary
`.claude/rules/alfred-rules.md` is removed at its ledger hash, and an emptied `.alfred/stack/rules` folder is removed.
The matrix reverted onto the tree before 4c (abca3661, whose stage 4a loader reads the store) twice - with an edited
rule and the user's own store file, and with nothing of the user's: after the recipe and that tree's update the rules
were back in `.claude/rules` with no canary, the edited rule and the user's file stayed in the store, and a session
sent each always rule once - the edited one from the native file that tree's update laid, which wins by name, so the
edit is kept on disk but not sent. Without the recipe that tree also sent each rule once, from the store. Rolling forward
again over each case put the rules back in the store. A revert onto 3.10.0 or earlier (no loader) was NOT RUN; there
the recipe is required.

## Stage 5 - probes

What Claude Code itself sends when a session or an agent touches a file under a child project, against the local
stand-in ($0). Claude Code 2.1.322, macOS, 2026-11-13. Two hand-made fixtures: `own/ws` (the child `api` its own
repository, ignored by the root's `.gitignore`) and `one/ws` (`api` a plain sub-folder). Each `api` holds
`.claude/rules/r1.md` (`R1-RULE-MARK`), `CLAUDE.md` (`R1-CLAUDE-MARK`), `AGENTS.md` (`R1-AGENTS-MARK`) and `src/a.txt`.
The command is `node meta/probes/hook-delivery.js <ws> <label> --approve <flags> -- <marks>`.

| Row | Flags | Result | What was read |
| --- | --- | --- | --- |
| R1 own repository | `--read <ws>/api/src/a.txt` | rule and `CLAUDE.md` loaded, `AGENTS.md` not | `R1-RULE-MARK` and `R1-CLAUDE-MARK` in `main-2`, after the Read; `R1-AGENTS-MARK` absent |
| R1 control, a sub-folder | the same on `one/ws` | the same | the same |
| R2 a subagent's Read | `--agent --step '{"sub":true,"name":"Read",...}'` | rule and `CLAUDE.md` loaded in the subagent's turn, `AGENTS.md` not | both marks in `main-4`, a `subagent` request after its Read, on both fixtures |
| R4 a second-level agent | `--inject --agent --step <Agent 'level two'> --step <its Read>` on `one/ws` | `yes` | the Read's PostToolUse carries the second-level `agent_id` (not the first level's); `PATH-INJECT-MARK` in `main-5`, the request whose first message holds 'level two'. Control (a first-level Read): `main-4` |
| R5 Cursor, two cells | the root opened, a child's file read; a subagent's read | `NOT RUN - the owner's Cursor run` | steps 10 and 11 of the machine-local Cursor fixture |

What they change: R1 and R2 show Claude Code loads a child's `.claude/rules` and `CLAUDE.md` on its own after a Read
under it - in its own repository as in a sub-folder - and never `AGENTS.md`, so the block's line 2 (naming `AGENTS.md`)
and line 3 (the native rule files) stay: on a host that loads them the 'unless it is already in your context' clause
covers it. R4 `yes`: a sub-agent keys its own markers, so the limit 'a sub-agent shares its parent's markers' is not
needed.
