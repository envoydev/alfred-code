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
| the rows' cost | macOS 31-34 ms, Linux 20-23 ms, Windows on the leg | Medians of 20 starts each: macOS (Node 24) `--part 1` 33.9 / 31.1 ms with and without the store, PostToolUse 32.9 / 31.1; Linux (`node:22` container) 22.3 / 20.0 and 22.7 / 19.9 |
