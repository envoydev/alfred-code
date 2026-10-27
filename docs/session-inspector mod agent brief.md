# session-inspector mod: agent brief

Oct 27, 2026 · @Oleh

## Purpose

You are a Claude Code agent. Check whether the session-inspector mod below can be built on the installed Claude Code version, give a verdict per feature, and build only what gets GO. Nothing is built before the verdict is approved.

1. Read this brief end to end, then read the mod types Claude Code writes for the installed build. Where the types and this brief disagree, the types win; note each disagreement in the verdict.
2. Run Phase 0: install the probe mod, run the probe session, and save the log.
3. Write the verdict table in the format of the Verdict section, then stop and wait for approval.
4. After approval, build the phases in order. A phase is done only when its acceptance checks pass.

Rules for the whole job:

- State only facts from the docs, the types or the probe log. Mark everything else as unverified.
- The mod makes no network calls and never writes prompts, tool inputs, secrets or the account email to any log or file.
- Keep each hook's own work under 50 ms. Move anything heavier to a timer.

## Context: Claude Code mods

A mod is a plugin whose JavaScript or TypeScript hooks run inside Claude Code, so it can observe, rewrite or answer events and draw its own interface. It needs Claude Code v2.1.287 or later in the terminal and v2.1.286 or later in the Desktop app.

**Files**

- `.claude-plugin/plugin.json`: the plugin manifest.
- `hooks/hooks.json`: `{ "modules": ["./register.js"] }`.
- `hooks/register.js` or `.ts`: exports `register(on, options)` and registers each hook with `on(event, matcher?, async ($, e, next) => ...)`.
- `types/index.d.ts`: needed when the mod uses `$.state`.
- `*.test.ts`: tests run by `claude plugin test`.

**Events this mod uses**

| Event | Used for | Notes |
| --- | --- | --- |
| `tool.call` | Tool counts, outcome after `await next(e)`, plan file writes | Agent id not documented here |
| `tool.check` | Denied calls, the agent behind each call | `e.agentId` documented from v2.1.290 |
| `agent.spawn` | Subagent type, model, task | Does not fire again on resume via SendMessage |
| `turn.step` | Model, effort, token and cache usage, output speed | Async generator, `yield* next(e)` |
| `turn.start`, `turn.complete` | Turn timing |  |
| `prompt.submit` | Time of your last prompt |  |
| `skill.prompt` | Skill name and source | Source fields from v2.1.299 |
| `session.compact` | Compaction count |  |
| `session.start`, `session.end` | Reset per-session state, close today's cost entry | `session.end` hooks share a 1.5 s budget |
| `prompt.compose`, `ui.render` | REC: model instruction and display masking |  |

**Mods API calls this mod uses**

- `$.session.usage()`: `{ startedAt, context: { tokens, window, percent }, rateLimits: [{ kind, percentUsed, resetsAt }], cost }`.
- `$.agent.list()`: subagents with status pending, running, waiting, idle, completed, failed or killed.
- `$.store`: key-value store shared by every session on the machine, 4 MiB in total. `$.state`: reactive per-session state.
- `$.clock.every`, `$.fs.read`, `$.fs.stat`, `$.ui.status`, `$.ui.toast`, `$.ui.open`, `$.ui.invalidate`, `$.command.register`, `$.command.run`.

**Where it draws**

- **Render sites:** `AbovePrompt` is the band, `Pane` is a side or inline pane, and `Spinner` has one instance per agent with the agent id as `e.requestId`.
- **Apps:** everything draws in the terminal and the Desktop Code tab, and in the VS Code extension from v2.1.299, except the band.
- **Headless sessions:** in `claude -p` and cloud sessions hooks run but nothing draws.

## Decisions already made

The mod is one plugin named `session-inspector`, built without Claude HUD, that merges six mods from the source deck into ten features. Challenge a decision in the verdict only with evidence from the probe or the types.

- **Mod-only, no Claude HUD.** One system, so REC can mask everything on screen and timers keep clocks live. HUD draws failed tools as ✓ (`src/render/activity.ts`) and REC cannot reach its statusline.
- **One plugin, one hooks module.** Every feature shares one state, and REC must see everything the plugin draws. Split code into sibling files only if the probe confirms the hooks module can import them.
- **Standalone plugin.** It is its own plugin in its own repo, with its own marketplace, so it installs and works in any project. The envoydev marketplace lists it as a second entry with a GitHub source pinned to a release, for Alfred Code users.
- **Commands.** `/inspect [tab]`, `/auto-handoff ...`, `/rec ...`, `/quiet on|off`. The deck lists `/agents` and `/goal` as built in, so never use those.
- **Core and Alfred Code integration.** The core works from the Claude Code mods API alone. When it detects Alfred Code, it adds the mode banner (auto-run, scorer, model) and routes \[Handoff\] to the stack's resume flow. It never imports stack code: it reads files the stack writes and runs stack commands only when they exist. Without Alfred Code, \[Handoff\] uses the mod's own extractive resume prompt, so each environment has exactly one handoff home. In Alfred Code it can later replace `claude-hud`; it never replaces the `instrument-tool-usage` hook.
- **Parity.** Claude Code only: Cursor has no mods, so the Cursor half of the stack gets no twin. The plan and score file format is a public contract in the plugin's README, so any skill can write it; Alfred Code's plan and scorer skills are one writer.

**Mods from the source deck (claude\_code\_mods.pptx)**

| Deck mod | What happens | Becomes |
| --- | --- | --- |
| CACHE (cache-clock) | Folded in, with its toast at 5 min left and the \[Compact\] button | F4 Cache |
| PLAN (usage-gauge) | Folded in, with its 75% and 90% toasts and pace warning | F1 Session metrics |
| HANDOFF (auto-handoff) | Kept as is | F8 Handoff |
| AGENTS (agent-watch) | Extended with current action, failures and final report | F3 Agents |
| GOAL (goal-meter) | Its task-list tracking becomes the fallback when no plan file exists | F6 Plan progress |
| REC (recording-mode) | Kept, and extended to mask all of this plugin's own output | F9 Recording mode |

Keep each deck mod's chip colour for its feature: cyan `#22d3ee` cache, blue `#60a5fa` plan usage, violet `#a78bfa` handoff, pink `#f472b6` agents, gold `#facc15` plan progress, red for REC.

## Feature scope

Ten features, F1 to F10. The probe must settle every Medium row before the verdict; High rows rest on the docs.

| ID | Feature | Shows | Data source | Confidence |
| --- | --- | --- | --- | --- |
| F1 | Session metrics | Model and effort; context tokens, window and %; 5h and weekly % with reset times, plus any other window kind by name; session duration; session cost; today's cost across sessions; output tok/s; total tokens in, out, cache read, cache write; compactions; account plan and email | `$.session.usage()`, `$.store`, `turn.step`, `session.compact`, `~/.claude.json` via `$.fs.read` | High; Medium for tok/s, token totals, account |
| F2 | Tools and skills | Calls per tool, skill and MCP server; outcome ok, error or denied; last 10 failures with time, target and reason | `tool.call` after `await next(e)`, `tool.check`, `skill.prompt` | High |
| F3 | Agents | Type, model, task, status, elapsed; current action; final report; effort, context used out of window, tools and skills per agent with failures | `agent.spawn`, `$.agent.list()`, `tool.check` (`e.agentId`), `tool.call` on the Agent tool, `turn.step` | High for the first three groups; Medium for the per-agent group |
| F4 | Cache | TTL tier (5 min or 1 h); expiry clock time; hit rate for the last request and the session; cached tokens; rewrite cost if it goes cold; toast at 5 min left; \[Compact\] button | `turn.step` usage, deck price table | Medium |
| F5 | Timeline | Per turn: your prompt time, Claude's reply time, duration, tokens in and out, tool calls, failures; in the band, the time of your last prompt and Claude's last reply | `prompt.submit`, `turn.start`, `turn.complete`, `$.clock.now()` | High |
| F6 | Plan progress | Steps with status, current stage, % done, time on the current step, your integrated notes marked ✎ with their text, last update time | Plan file via `tool.call` on Write or Edit, plus a 30 s `$.fs.stat` poll; task list as fallback | High, if the skills follow the contract |
| F7 | Scores | Score rounds; total and per-criterion score with change from the last round; findings fixed, improved or still open, with the step that fixed them | Scores in the plan file | High, if the scorer follows the contract |
| F8 | Handoff | Deck behaviour: 80% threshold, ask or auto mode, keys h, c, r, toasts, HANDOFF.md fallback | `$.session.usage()`, `session.compact`, `$.command.run` from a timer | High |
| F9 | Recording mode | Deck behaviour: `/rec`, `/rec strict`, private words; plus masking of every surface this plugin draws | `ui.render` on message sites, `prompt.compose`, one internal `mask()` | High for this plugin's output |
| F10 | Compact tool rows | With /quiet on: one line per tool call with its description, output line count and ✓ or ✗; up to 3 error lines on a failure; runs of read-only calls folded into one line. /quiet off restores the full rows | ui.render on ToolUse, ToolResult and ToolGroup | High for the redraw; Medium for the auto mode classifier line and Ctrl+O |

**Notes**

- **F1 today's cost:** add each session's cost to a per-day ledger in `$.store`, keyed by session id, and reset it at local midnight. Drop ledger entries older than 7 days.
- **F1 account:** read only `oauthAccount` from `~/.claude.json`. On any parse failure, hide the field and don't show an error.
- **F4 cache has no size capacity:** what matters is time to expiry, hit rate and rewrite cost. Never show a cache fill bar.
- **F4 hit rate:** cache read ÷ (cache read + cache write + uncached input) for each main-loop request. Subagent requests count in totals only.
- **F9 masking:** pass every string this plugin draws through `mask()`, so REC covers the band, panes, toasts and spinner suffixes, not only messages. REC is display-only: the model still sees secrets in context.
- **F10 compact rows:** display only, so Claude still reads the full output and no tokens are saved. Show the Bash call's `description` instead of the command, falling back to its first 60 characters. Compact first, then pass the row through `mask()`, so REC also covers compact rows. Claude's own text (`AssistantMessage`) is never compacted.

## Layout

Three layers by urgency: a band that stays calm until something needs you, one pane for live detail, and toasts only for changes you must act on. All values in the mockups are illustrative.

&#91;embedded content: session-inspector architecture · 4 sources, 4 surfaces\]

Hooks only update the shared state. Every surface reads that state and passes its text through `mask()`, so REC covers the whole plugin, not only messages.

**Design rules**

- **Calm by default:** idle and healthy, the band is one dim line. Colour appears only when a threshold is crossed.
- **Now first:** while Claude works, line 1 shows what is running: the plan step, each agent's current action, and a running Bash command with its elapsed time. When idle, it shows the last turn: duration, tool calls, failures, and the time of your last prompt and of Claude's reply.
- **Room left:** line 2 holds the gauges. Context and 5h get bars because they move within a session; weekly and cost are numbers.
- **Bars:** 5 segments of 20%, each made of 3 cells of about 6.7% each, with one space between segments, so a bar is 19 characters wide. A cell fills only when its share is reached, so a segment shows full once its 20% is reached. The whole bar takes the threshold colour. Cells are ■ when filled and □ when empty, so a segment reads as a group of three squares.
- **Forecasts:** shown next to the gauges, marked ≈, and only after 3 data points: turns left until the handoff threshold (mean context growth over the last 5 turns), when the 5h or weekly limit runs out at the current pace compared with its reset time, and the plan's time left (mean step time × steps left).
- **Actions, not just alerts:** line 3 appears only when something needs you, and each item carries its button: Handoff, Compact or Inspect. Band buttons get digit hotkeys, which fire when you type the digit alone into an empty prompt.
- **Failure inbox:** failed and denied calls count as new until you open the Now or Tools tab.
- **Narrow terminals, under 100 columns:** each bar shrinks to 5 cells, one per 20% (■□), and line 1 keeps only the plan step and the agent count.
- **Glyphs and colour:** ⟳ running, ✓ done, ✗ failed, ⊘ denied, ✎ your note, ≈ estimate, ⚠ needs you. Colour adds state, model and feature on top, as set out under Colours, so no meaning depends on colour alone.

**Colours**

Colour marks three things: state, model and feature. Every state keeps its glyph, so the UI still reads in a terminal without colour.

| Role | Colour | Where |
| --- | --- | --- |
| OK | green `#22c55e` | ✓, bar fill under 60%, score ▲, on pace, ● live |
| Warning | amber `#f59e0b` | ⚠, ⊘ denied, bar fill from 60 to 85%, a forecast that misses its reset time |
| Failure | red `#ef4444` | ✗, bar fill over 85%, NEEDS A LOOK, score ▼, ● REC |
| Running | bold default text | ⟳ rows; no colour, so amber keeps meaning warning |
| Secondary | the terminal's dim colour | Empty bar cells, separators, times, error text |
| Opus, Sonnet, Haiku, Fable | `#ff8c1a`, `#3d9bff`, `#19c3a6`, `#d16bff` | Model badges in the band, agent rows and spinners |
| Skills | lime `#a3e635` | Skill names |
| Usage | blue `#60a5fa` | ctx, 5h and wk labels; Usage tab label |
| Agents | pink `#f472b6` | AGENTS heading; Agents tab label |
| Plan | gold `#facc15` | PLAN heading; Plan tab label; ✎ your note |
| Cache | cyan `#22d3ee` | Cache tab label; \[Compact\] button |
| Handoff | violet `#a78bfa` | \[Handoff\] button |

- **Bars:** filled cells take the state colour and empty cells stay dim.
- **Buttons:** bold, in the colour of the feature they act on; \[Inspect\], \[Show\] and \[Copy\] stay in the default colour.
- **No colour:** when `NO_COLOR` is set, everything draws in the default colour and the glyphs carry the meaning.
- **Light terminal themes:** gold and lime read poorly on white. Check them in Phase 1 and switch to `#ca8a04` and `#65a30d` there if needed.

&#91;embedded content: band and Now tab with the palette applied\]

The same screen as the band and Now tab mockups below, with the palette applied.

**Band: working**

```text
⟳ S4 Update interceptor 12m │ Explore ▸ Grep AuthService │ Bash ▸ npm test 0:12
ctx ■■■ ■■■ □□□ □□□ □□□ 45% ≈6 turns │ 5h ■■■ □□□ □□□ □□□ □□□ 25% on pace │ wk 62% │ $3.12
```

**Band: idle, needs you**

```text
✓ Turn 7 · 3m 10s · 9 tools · 1 ✗ │ you 14:02 · Claude 14:05 │ PLAN 3/5 · score 8.1 ▲1.3
ctx ■■■ ■■■ ■■■ ■■■ □□□ 82% │ 5h ■■■ ■■■ ■■□ □□□ □□□ 55% limit ≈15:40, resets 16:15 │ wk 62% │ $3.12
⚠ ctx past 80% [4 Handoff]    ⚠ cache cold in 4m [3 Compact]    ✗ 2 new [1 Inspect]
```

**Band: idle and healthy, one dim line**

```text
ctx ■■■ ■□□ □□□ □□□ □□□ 30% │ 5h ■■□ □□□ □□□ □□□ □□□ 15% │ wk 40% │ $1.08 │ you 14:02 · Claude 14:05
```

**Band: narrow terminal**

```text
⟳ S4 12m · 2 agents
ctx ■■□□□ 45% · 5h ■□□□□ 25% · wk ■■■□□ 62%
```

**Spinner, one per agent:** a suffix with the agent's current action and context, such as `Explore · Grep AuthService · 17%`.

**The `/inspect` pane**

- **Placement:** docked beside the transcript at 144 columns or more, inline above the prompt otherwise. It remembers whether it was open.
- **Tabs:** Now (default), Usage, Agents, Tools, Cache, Timeline, Plan. `/inspect <tab>` opens on a tab and `/inspect plan <slug>` picks a plan. There is no separate plan pane.
- **Now:** the view to keep open while Claude works: the current plan step, running agents with their current action, and new failures.
- **Failure rows:** \[Show\] expands the error in a code block and \[Copy\] copies it.
- **Desktop:** the per-turn context chart draws as an SVG; the terminal uses ▁▂▃▄▅▆▇.

```text
[Now]  Usage  Agents  Tools  Cache  Timeline  Plan                         ● live
PLAN   Token refresh · 3/5 · ≈25m left
  ✓ S3 Migration with rollback                done 14:22
  ⟳ S4 Update interceptor                     12m
  · S5 E2E tests
AGENTS 2 running
  ⟳ Explore [haiku ◑ medium] ▸ Grep 'AuthService' in src/   ctx ■■□ □□□ □□□ □□□ □□□ 17%
  ⟳ Plan [opus ◑ high] ▸ Read src/auth/token.ts             ctx ■□□ □□□ □□□ □□□ □□□ 9%
NEEDS A LOOK  2 new
  ✗ 14:21 Edit  src/auth/token.ts   old_string not found          [Show] [Copy]
  ⊘ 13:55 Bash  rm -rf dist         denied by you
```

```text
Usage                                                session 1h 12m
Context   ■■■ ■■■ □□□ □□□ □□□ 45%   90k / 200k     ≈6 turns to 80%
          per turn ▁▂▂▃▃▄▅▅
5h        ■■■ □□□ □□□ □□□ □□□ 25%   resets 16:15       on pace
Weekly    ■■■ ■■■ ■■■ □□□ □□□ 62%   resets Fri 09:00   on pace
Cost      $3.12 session · $18.49 today, est.
Tokens    in 412k · out 38k · cache read 1.9M · cache write 210k · 70.5 tok/s
Account   Max 20x · <account>              Compactions 1, at 14:40
```

```text
Agents (3)                                             opus 1 · haiku 2
⟳ Explore [haiku ◑ medium]  Finding auth code                   2m 15s
   ▸ Grep 'AuthService' in src/
   ctx ■■□ □□□ □□□ □□□ □□□ 17%   tools Read ×6 ✓ · Grep ×3 ✓ · Bash ×1 ✗
⟳ Plan [opus ◑ high]  Design token refresh                      0m 40s
   ▸ Read src/auth/token.ts
✓ general-purpose [haiku]  Check test coverage                  done in 1m 05s
   result: 12 files, 3 untested services                        [Show report]
```

```text
Tools                   calls   ok   ✗   ⊘
Read                       24   24   0   0
Edit                        9    8   1   0
Bash                        7    5   1   1
Skill: plan-builder         2    2   0   0
mcp: context7               3    3   0   0

Last failures
✗ 14:21  Edit  src/auth/token.ts   old_string not found          [Show] [Copy]
✗ 14:09  Bash  npm test            exit 1: 2 failing tests       [Show] [Copy]
⊘ 13:55  Bash  rm -rf dist         denied by you
```

```text
Cache      TTL 1h · expires 15:05, in 52m
Hit rate   last request 94% · session 88%
Cached     86k tokens
If cold    rewrite ≈ $1.12 on Opus 5.5                          [Compact]
```

```text
#   you     Claude   took     in / out      tools   ✗
7   14:02   14:05    3m 10s   12k / 2.1k    9       1
6   13:51   13:52    48s      8k / 0.9k     3       0
```

```text
Plan · Token refresh                           3/5 · 60% · ≈25m left
✓ S1 Add refresh endpoint                      done 13:40
✓ S2 Rotate tokens   ✎ your note integrated    done 14:10
     'Use sliding expiry, not fixed 15 min'
✓ S3 Migration with rollback                   done 14:22
⟳ S4 Update interceptor                        12m
· S5 E2E tests

Scores   R1 6.8 → R2 8.1 ▲1.3
  correctness 7→8 ▲   risk 5→8 ▲   completeness 8→8 =
  fixed:    no migration rollback (S3)
  improved: token expiry handling (S2)
  open:     no load test for refresh storm
last update 2m ago
```

**Compact tool rows (`/quiet on`):** one line per tool call in place of the command and output preview. Failures keep up to 3 error lines, and runs of read-only calls fold into one line.

```text
⏺ Bash · Show CI failure lines 1038-1042 · 30 lines ✓
⏺ Three of the Windows failures reveal a real security gap: ...
⏺ 4 reads · habits-scorer-card.test.js, secret-chain.js, layout.js ×2 · ✓
⏺ Bash · Run guard tests · ✗ exit 1
    AssertionError: expected blocked (guard-sensitive-data.test.js:425)
```

**Toasts:** only for changes you must act on: usage crossing 75% and 90%, cache 5 min from cold, the handoff threshold, a note integrated into the plan, a plan finished, and REC on or off. Everything else waits in the band or the pane.

## Data contracts for the plan and scorer skills

F6 and F7 read one JSON file per plan at `.claude/plans/<slug>.json` in the project. The plan skill and the scorer skill write it, and the mod only reads it. A fixed format means nothing has to be parsed out of chat text.

```json
{
  "version": 1,
  "slug": "token-refresh",
  "title": "Token refresh",
  "updatedAt": "2026-10-27T14:22:00Z",
  "steps": [
    { "id": "S1", "title": "Add refresh endpoint", "status": "done", "startedAt": "2026-10-27T13:20:00Z", "doneAt": "2026-10-27T13:40:00Z" },
    { "id": "S2", "title": "Rotate tokens", "status": "done", "startedAt": "2026-10-27T13:41:00Z", "doneAt": "2026-10-27T14:10:00Z" },
    { "id": "S3", "title": "Migration with rollback", "status": "done", "startedAt": "2026-10-27T14:11:00Z", "doneAt": "2026-10-27T14:21:00Z" },
    { "id": "S4", "title": "Update interceptor", "status": "in_progress", "startedAt": "2026-10-27T14:22:00Z" },
    { "id": "S5", "title": "E2E tests", "status": "pending" }
  ],
  "changes": [
    { "at": "2026-10-27T13:05:00Z", "kind": "created", "source": "claude" },
    { "at": "2026-10-27T14:05:00Z", "kind": "integrated", "step": "S2", "source": "user", "note": "Use sliding expiry, not fixed 15 min" }
  ],
  "scores": [
    { "round": 1, "at": "2026-10-27T13:10:00Z", "scale": 10, "total": 6.8,
      "criteria": { "correctness": 7, "risk": 5, "completeness": 8 },
      "findings": [ { "id": "F1", "text": "No migration rollback", "status": "open" } ] },
    { "round": 2, "at": "2026-10-27T14:25:00Z", "scale": 10, "total": 8.1,
      "criteria": { "correctness": 8, "risk": 8, "completeness": 8 },
      "findings": [ { "id": "F1", "text": "No migration rollback", "status": "fixed", "by": "S3" } ] }
  ]
}
```

**Allowed values**

- `steps[].status`: pending, in\_progress, done, blocked, skipped. At most one step is in\_progress.
- `changes[].kind`: created, step\_added, step\_changed, step\_removed, integrated. `source`: user or claude. `note`: at most 200 characters.
- `scores[].findings[].status`: open, fixed, improved, wontfix. `by`: the id of the step that fixed or improved it.

**Rules to add to the plan skill**

1. Create the file when the plan is first written, with every step pending and a `created` change.
2. Set a step to in\_progress with `startedAt` before working on it, and to done with `doneAt` after it passes its checks.
3. When the user gives text to fold into the plan, change the affected steps and add an `integrated` change with `source: user` and the user's words as `note`.
4. Always rewrite the whole file with the Write tool and update `updatedAt`. Never patch the JSON with Edit.

**Rules to add to the scorer skill**

1. Add a new round each time; never edit an old round.
2. Use the same criteria names and scale in every round.
3. Reuse a finding's id in later rounds, and set its status to fixed, improved or still open, with `by` when a step changed it.

**What the mod does with the file**

- **When it reloads:** after any Write or Edit to a matching path, and on a 30 s `$.fs.stat` check for edits made outside Claude.
- **Several plans:** it shows the most recently updated file, and `/inspect plan <slug>` switches.
- **Invalid JSON:** it keeps the last good version and shows `plan file invalid` in line 2.
- **Staleness:** when `updatedAt` is over 20 minutes old while a step is in\_progress, it shows the age in amber.
- **Fallback:** with no plan file, it shows task list progress from the task-list tool, as the deck's GOAL mod did.

## Phase 0: probe mod

Before any build, a throwaway mod records which fields each event really carries. It logs field names and a few safe values, never prompts, tool inputs or account values. Check every call's exact signature against the types first; the code below assumes async calls and `$.fs.write(path, text)`.

**What the probe must answer**

| # | Question | Decides |
| --- | --- | --- |
| 1 | Does `turn.step` carry an agent id, model and effort? | F3 effort and context per agent |
| 2 | Does `turn.step`'s stream or return value hold input, output, cache read and cache write tokens? | F1 token totals and tok/s, F3 context, F4 |
| 3 | Does `tool.call` carry an agent id, and does its result show an error flag and message? | F2 outcome, F3 tools per agent |
| 4 | Can a `tool.check` entry be matched to its `tool.call`, for example by a shared call id? | F2 denied vs error, F3 failures |
| 5 | Does `skill.prompt` carry an agent id? | F3 skills per agent |
| 6 | Which `rateLimits` kinds does this account report? | F1 |
| 7 | Does `~/.claude.json` hold `oauthAccount`, and with which keys? | F1 account |
| 8 | Can the hooks module import a sibling file? | Code layout |
| 9 | Do `inspect`, `auto-handoff`, `rec` or `quiet` clash with existing commands? | Command names |
| 10 | What do the ToolUse, ToolResult and ToolGroup props hold, which site draws the auto mode classifier line, and does Ctrl+O still expand a redrawn row? | F10 |

**Probe module**

```js
// hooks/register.js: probe only, delete after Phase 0
import { helperLoaded } from './probe-helper.js' // question 8; probe-helper.js exports const helperLoaded = true

const log = []
const shape = (e = {}) => ({
  keys: Object.keys(e),
  agentId: e.agentId, tool: e.tool, skill: e.skill, source: e.source,
  model: e.model, effort: e.effort, isTeammate: e.isTeammate,
})
const keep = (event, e, extra = {}) => log.push({ t: Date.now(), event, ...shape(e), ...extra })
const keysOf = (v) => (v && typeof v === 'object' ? Object.keys(v) : typeof v)

export function register(on) {
  on('session.start', async ($, e, next) => {
    const names = (await $.command.list()).map((c) => c.name)
    keep('session.start', e, {
      helperLoaded,
      clashes: ['inspect', 'auto-handoff', 'rec', 'quiet'].filter((n) => names.includes(n)),
    })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    keep('tool.call', e)
    const r = await next(e)
    keep('tool.call:after', e, { resultKeys: keysOf(r) })
    return r
  })

  on('tool.check', async ($, e, next) => {
    const d = await next(e)
    keep('tool.check', e, { decision: d?.decision })
    return d
  })

  for (const ev of ['agent.spawn', 'skill.prompt', 'session.compact', 'prompt.submit', 'turn.start']) {
    on(ev, async ($, e, next) => { keep(ev, e); return next(e) })
  }

  on('turn.step', async function* ($, e, next) {
    keep('turn.step', e)
    const started = Date.now()
    const chunkTypes = new Set()
    const gen = next(e)
    let step = await gen.next()
    while (!step.done) {
      chunkTypes.add(step.value?.type)
      yield step.value
      step = await gen.next()
    }
    keep('turn.step:end', e, { ms: Date.now() - started, chunkTypes: [...chunkTypes], returnKeys: keysOf(step.value) })
    return step.value
  })

  on('turn.complete', async ($, e, next) => {
    const u = await $.session.usage()
    const agents = await $.agent.list()
    let accountKeys = null
    try {
      const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
      accountKeys = keysOf(JSON.parse(await $.fs.read(`${home}/.claude.json`))?.oauthAccount)
    } catch (err) { accountKeys = `error: ${err.message}` }
    keep('turn.complete', e, {
      usageKeys: keysOf(u), rateKinds: u.rateLimits?.map((r) => r.kind),
      agentKeys: keysOf(agents[0]), accountKeys,
    })
    await $.fs.write('.claude/probe.jsonl', log.map((x) => JSON.stringify(x)).join('\n'))
    return next(e)
  })
}
```

For question 10, add these hooks inside `register(on)`. They log prop names only, never tool input or output.

```js
for (const component of ['ToolUse', 'ToolResult', 'ToolGroup', 'InfoNotice']) {
  on('ui.render', { component }, async ($, e, next) => {
    keep(`ui.render:${component}`, e, {
      surface: e.surface, propKeys: keysOf(e.props), inputKeys: keysOf(e.props?.input),
    })
    return next(e)
  })
}
```

**Probe session**

1. In a scratch repo, run `claude plugin validate ./probe`, then start `claude --plugin-dir ./probe`.
2. Ask Claude to use an Explore subagent to find where config is loaded.
3. Ask Claude to run `node -e "process.exit(1)"`, so one tool call fails.
4. Ask for a file deletion and answer No at the permission prompt, so one call is denied.
5. Press Ctrl+O on one Bash row and note whether it expands. Run any skill, then run `/compact`.
6. Read `.claude/probe.jsonl` and answer the ten questions, quoting the log lines.

## Verdict

The verdict is one row per feature plus an overall call, and then the agent stops for approval. Every row cites its evidence: a probe log line, a type declaration or a doc page.

**Per feature**

- **GO:** every field in the feature's Shows column has a confirmed source.
- **PARTIAL:** the feature ships without the named fields. Those fields are hidden, never shown as guesses.
- **NO-GO:** the feature's main purpose has no source. Drop it and name what would unblock it.

**Overall**

- **GO** when F1, F2, F5 and F6 are all GO, since they are the core of the mod.
- **NO-GO** otherwise. Report what failed and stop.

**Also report**

- The installed Claude Code version.
- Every place where the types disagree with this brief.
- Any risk the probe found that the Risks section does not list.

**Example verdict.** The values are illustrative, not a prediction.

| ID | Verdict | Evidence | Dropped if PARTIAL |
| --- | --- | --- | --- |
| F1 | GO | `turn.complete` usageKeys and rateKinds `five_hour`, `seven_day` (log line 52) |  |
| F2 | GO | `tool.call:after` resultKeys include `isError` (line 18) |  |
| F3 | PARTIAL | `tool.check` has agentId (line 23); `turn.step` and `skill.prompt` have none (lines 9, 31) | Effort, context and skills per agent |
| F4 | GO | `turn.step:end` returnKeys include `usage` with cache read and write (line 12) |  |
| F5 | GO | Documented events |  |
| F6 | GO | Documented events; plan file contract |  |
| F7 | GO | Plan file contract |  |
| F8 | GO | Documented events; deck behaviour |  |
| F9 | GO | Documented events |  |
| F10 | PARTIAL | ToolUse props include input.description (line 64); the classifier line is drawn by InfoNotice (line 66); Ctrl+O shows the mod's row, not the full output | Ctrl+O expansion; use /quiet off for full rows |

Overall: GO. Eight of ten features GO, F3 and F10 PARTIAL.

## Build phases

Five phases after an approved verdict, core first. Skip any feature the verdict marked NO-GO, and hide PARTIAL fields.

| Phase | Builds | Done when |
| --- | --- | --- |
| 1. Core | F1, F2, F5; the band in all its states; `/inspect` tabs Now, Usage, Tools, Timeline; a `mask()` that passes text through | Context and usage match `/context` and `/usage` within 1 point; a failing Bash call shows in Tools with its reason; a denied call shows as denied; today's cost survives a second session |
| 2. Agents and cache | F3, F4; Agents and Cache tabs; spinner suffix | Two parallel Explore agents each show their own current action; cache expiry matches the TTL tier; the 5 min toast fires once |
| 3. Plan and scores | F6, F7; the Plan tab in `/inspect`; the rule changes to the plan and scorer skills | A note given to Claude shows ✎ within 2 s; an outside edit shows within 30 s; a second score round shows changes and the fixed list; invalid JSON keeps the last good view |
| 4. Handoff, REC and compact rows | F8, F9, F10 | At the threshold, ask mode waits and auto mode saves; `/rec strict` hides account, home paths and $ amounts in the band, the pane, toasts and spinners; `/rec test` passes for keys, emails and phones; /quiet on shows one line per tool call and keeps up to 3 error lines on a failure; /quiet off restores the full rows; REC masks compact rows too |
| 5. Ship | Marketplace entry | `claude plugin validate --strict` passes; `tsc` and `claude plugin test` pass; installing from the marketplace in a clean session loads `1 mod active · session-inspector` |

**Every phase**

- Write tests for its hooks as `*.test.ts` before it is called done.
- Run a real terminal session and a Desktop Code tab session, and report what each one draws.
- Commit at the end of the phase with a message that names the phase.

## Constraints and limits

The Claude Code limits below are from the mods reference; the right column is how this mod stays inside them.

| Limit | Value | What the mod does |
| --- | --- | --- |
| Minimum Claude Code | v2.1.287 terminal, v2.1.286 Desktop; some fields need v2.1.290 or v2.1.299 | States the minimum in the README and hides fields the running version lacks |
| A hook's own execution time | 10 s, then the hook is skipped | Keeps each hook under 50 ms; reads files and computes on timers |
| Redraws | 10 a second, 30 in the terminal; extra calls are coalesced | Calls `$.ui.invalidate` at most once per event |
| `$.store` | 4 MiB of JSON in total | Keeps only settings, private words and a 7-day cost ledger |
| `$.fs.read`, `$.fs.write` | 4 MiB per file | Treats a larger plan file as invalid |
| `session.end` hooks | 1.5 s shared budget | Writes the cost ledger on every turn, not only at session end |
| Toasts | 4 s unless `timeoutMs` is set | Uses the default |
| Names of commands and panes | Letters, digits, `_` and `-`, up to 64 characters | `inspect`, `auto-handoff`, `rec`, `quiet` |
| Pane opened without the user asking | Placed from 144 terminal columns | Never auto-opens a pane; panes open only on a command |

**Security**

- **Network:** no `$.http.fetch`, no `$.process` calls, and no `$.model` calls.
- **Approvals:** the mod never approves, denies or rewrites a tool call. It only observes, except the HANDOFF and REC behaviour described in the deck.
- **Private data:** private words live only in `$.store`, never in code, logs or `$.state`.
- **What it reads:** `~/.claude.json` for `oauthAccount`, the plan files, and nothing else.

## Risks and open questions

No known blocker: the core features rest on documented events. The material risks are listed first.

| Rank | Risk | Trigger | Fallback |
| --- | --- | --- | --- |
| MATERIAL | Per-agent effort, context and skills need an agent id that is documented only on `tool.check` | Probe questions 1 and 5 come back empty | F3 PARTIAL: show type, model, task, status, current action and report only |
| MATERIAL | Plan progress is only as accurate as the plan skill's writes | Claude skips a status update | Staleness age in amber; the rule in the plan skill |
| MATERIAL | 'Fixed' and 'improved' are guesswork if the scorer renames findings or criteria | Scorer ignores the contract | Rule in the scorer skill; show a round with no matching ids as new findings |
| MATERIAL | The mods API still changes between versions; fields changed from v2.1.287 to v2.1.300 | A Claude Code update | Tests against the types for the installed build; minimum version in the README |
| MATERIAL | Two homes for a full context: F8 Handoff and the stack's guard-fresh-session-start hook, which offers a fresh session before a heavy run on a full context | Both act as context nears its limit | With Alfred Code present, the stack owns handoff and F8 only shows the state and the button; without it, F8's own handoff is the only one |
| MINOR | On a subscription plan, Cost and Today are API-equivalent estimates, not the bill | Always | Label them 'est.' when the account is on a plan |
| MINOR | The account comes from an undocumented file format | `~/.claude.json` changes shape | Hide the field on any parse failure |
| MINOR | REC hides text on screen only; the model still sees secrets in context | Always | State it in `/rec` help text |
| MINOR | REC's prompt.compose instruction adds tokens to every request while REC is on; everything else in the mod costs no tokens | REC on | Keep the instruction under 60 words; measure turn.step input tokens with REC on and off |

**Open question**

- [ ] Where do the plan and scorer skills write their output today: a file, the task list or only the chat? The answer decides how much the two skills change in Phase 3.

## Sources

- [Mods overview](https://code.claude.com/docs/en/plugins/mods/overview): capabilities, where mods run, trust model, built-in mods.
- [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference): events, API methods, render sites, elements, limits.
- [TypeScript declarations for mods](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts): may be older than the installed build.
- [Create a marketplace](https://code.claude.com/docs/en/plugin-marketplaces): plugin sources and pinning.
- [claude-hud repository](https://github.com/jarrodwatts/claude-hud): the statusline approach this mod replaces.
- claude\_code\_mods.pptx, slides 10 to 20: the six deck mods and their settings.
