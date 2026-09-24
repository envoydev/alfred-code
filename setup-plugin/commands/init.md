---
description: "FRESH install of the alfred-code, from scratch - ask scope + profile up front, then detect the OS + analyse the project and walk the selection in six dependency-ordered layers (rules -> agents -> skills -> hooks -> MCPs -> plugins): each layer shows ONE numbered table of the whole catalog (recommended pre-selected, locked rows carrying the required-by reason), then one selection round - Recommended / All / None, or typed numbers to add and drop. Prerequisite check, install, an OFFERED (never forced) CLAUDE.md fill-in, and a next-steps card (git-hygiene suggestions, the capture sequence in order, a per-language serena note) close the run. In a project, the selection is decided FROM the project (detected stacks seed the recommendations); outside any project it falls back to a global install seeded from the recommended set, stacks chosen by the user. NOT for an existing install - a plain refresh is the sibling update command, choosing what to add or drop is configure."
disable-model-invocation: true
---

# Initialize the Claude stack - fresh install

You are bootstrapping the alfred-code FROM SCRATCH. If the stack is already installed here (a populated `.claude/skills` + `.claude/agents`, or the global account equivalents in no-project mode), stop and route to a sibling command: `/alfred-code:update` for a plain refresh, `/alfred-code:configure` to adjust the selection - updates are their job. NAME the command for the USER to type and end the turn: both siblings are `disable-model-invocation`, so a Skill call from this run is denied (measured: a run asked WHICH sibling, then tried to invoke it and took the denial), and the sibling is better off in a FRESH session anyway - this command's own body, ~9.4k tokens of it, stays in the cached prefix of every message the re-routed run then sends. Work the ladder in order and drive it interactively; the deterministic work is done by `stack-select.js`, you orchestrate. Two modes, detected silently before the first question: **project mode** (the normal case - cwd is a project root in a git repo; the selection is decided from the project itself) and **no-project mode** (anything else - a global install seeded from the recommended set).

**This run needs NO conversation context - so it is worth MOVING, but only out of a session that
is actually loaded.** Measure before you ask: this session's own per-message context is `input +
cache_read + cache_creation` off the last assistant message in the transcript. Ask ONLY when that
figure is past the same trigger `guard-fresh-session-start.js` uses - the tier's own absolute
trigger, `ALFRED_CODE_FRESH_SESSION_200K` (default 150,000) or `ALFRED_CODE_FRESH_SESSION_1M`
(default 400,000), or `ALFRED_CODE_FRESH_SESSION_DEFAULT` (default 180,000) when the window is
neither of those two sizes or cannot be read at all - which one applies comes from the session
model's row in `.claude/hooks/model-windows.json`, else `ALFRED_CODE_DEFAULT_CONTEXT_WINDOW` (a FIRST setup has neither yet: take
the window this session's own model line states - '1M context' is 1,000,000 - and the DEFAULT trigger only when it states none) - or when that hook has already
injected the ask into this turn. Below the
trigger, or when the figure cannot be read at all, SKIP the ask silently and start step 1: an ask
with no measurement behind it is the failure this replaced (measured: it fired on the FIRST message
of a brand-new session, twice in one run, and could quote no number when the user challenged it).
Never author the decision in prose either way.

When it does fire, put it through AskUserQuestion: run here anyway, or run in a fresh session
(recommended), quoting the figure you measured - never one measured in some other session. Every
answer names its next action: fresh session -> give the paste-ready one-liner and end the turn;
run here -> start step 1 now; not now -> say what is owed and end the turn. If a redirect displaces
the ask, re-offer it ONCE. Measured: this command's siblings entered at 131,345 and 168,516 tokens
per message with no ask at all, and one of them authored its own prose decision that was never put
to the user.

**THE PLUGIN CACHE IS THE SNAPSHOT - the common run downloads nothing but a newer release** - read `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md` before step 1 and hold the whole run to it: resolve the snapshot once into `$TMP/repo` - copied from the newest valid plugin-cache entry, downloaded only when there is none (the reference owns the fallback), use every tool from that snapshot, hand it to the installer with `--source` in step 11, and remove `$TMP` per the 'Clean up' section on every exit path. The protocol's 'Narrate, don't trace' section governs every tool call in this run: one quiet call per recompute, no pasted tool output except the decision tables, one narration line between steps.

**Table before question - no exceptions.** Any table or report the user decides from (every layer's `stack-select.js --table` catalog, the `plugin-settings.js` report) is pasted into YOUR message, byte-for-byte in a fenced block, BEFORE the AskUserQuestion that asks about it - never after, never only in the ask's preview panel, never replaced by 'shown above' or a prose summary. A tool result is collapsed in the UI, so a table you only ran is a table the user never saw (measured: agents and skills asks answered 'I do not see any table'). This is the one sanctioned exception to 'no pasted tool output', and the plugin's `guard-layer-table.js` hook denies an ask whose table is missing.

**Every ask in this run goes through the AskUserQuestion tool** - concrete options, the recommended one marked, free text via Other; a prose question or a bare stop-and-wait is invalid (measured: prose asks were skipped in live runs while tool-shaped asks were answered every time). A plain-text option list is the fallback only where the harness lacks the tool.

**House voice in every line this run emits** - narration, tables and the asks alike: single
dashes, never em-dashes, and single quotes in prose. A fresh or refreshed install may have no
`.claude/rules/baseline-interaction.md` loaded at all, so this command's own text is the only place
the voice can come from (measured: a first-run narration line opened with an em-dash, on the one
surface where the rule forbidding it cannot yet exist).

## The ladder - announce every step

Twelve user-facing steps; the machinery between them runs silently. Before EVERY question, one banner line so the user always knows where they are, what is being decided, and what comes next:

```
[step 4/12 - rules] choose the rule set · next: agents
```

1 install choices · 2 permission mode · 3 project analysis · 4 rules · 5 agents · 6 skills · 7 hooks · 8 MCPs · 9 plugins · 10 prerequisite check · 11 install · 12 CLAUDE.md (optional)

**The skeleton is INVARIANT - the stability contract.** Every run prints all 12 banners, in this
order, exactly once each. A step that does not apply THIS run still prints its banner followed by
ONE line naming why it is a no-op (`[step 3/12 - project analysis] skipped - no-project mode,
stacks chosen by hand`, `[step 12/12 - CLAUDE.md] skipped - global install, no project file`),
then moves on - a step never silently vanishes, and steps are never merged, reordered,
renumbered, or invented. Two runs must be comparable banner by banner; the content varies, the
skeleton never does. The closing next-steps card (Post-check below) is part of the skeleton too -
every run ends with it.

## 1. Install choices

Detect silently first - the OS (the installer itself is one `node` command on every OS now; the OS decides the PowerShell spelling of the snippets below, and which twin runs on the `ALFRED_CODE_SEED=shell` fallback - `darwin`/`linux` -> `claude-stack.sh`, Windows -> `claude-stack.ps1` via `pwsh`) and the mode (project root in a git repo -> project mode; anything else -> no-project mode). ONE call answers both, and this is the command - the same copy-ready shape steps 2-3 already give, because improvised probing cost one run three Bash calls where the third re-asked what the first two had already returned (36, 30 and 143 chars of answer for 36% of that run's tokens):

```bash
printf 'os=%s\n' "$(uname -s 2>/dev/null || echo Windows)"; git rev-parse --show-toplevel 2>/dev/null || echo 'mode=no-project'
```

Denied by the permission classifier? ASK, do not re-probe. Re-issuing the same detection under different syntax reads as working around the denial, and the measured run got two declines and an interrupt for it. Put the two facts through one AskUserQuestion instead ('which OS?' / 'install into this project or the account?') with the likely answer marked - the user knows both without a probe. Then ask TWO AskUserQuestion screens (the tool caps four questions per call; each default marked Recommended). **Screen A - the install itself:** scope (`project` default / `global`; in no-project mode this question becomes the no-project-mode confirmation instead - a `global` install into the account `~/.claude` - since there is no project to scope to), profile (the optional `--space` account name, default none), and the one conditional extra: 'install the GitHub CLI?', asked ONLY when `gh` is not already on PATH and skipped entirely when it is. **Screen B - the environment:** one question per `ask: true` row of the snapshot's `$TMP/repo/meta/environment.json`, which is the ONE list of the values the install writes into the scope's settings.json `env` - never a list typed from memory here, or a variable a release adds would silently stop being asked. Each question shows the row's `default` and its `what` in plain words; free text via Other. A row carrying `group_off` is ONE question for the whole FEATURE it owns - it and every row naming it in `asked_with`: name each key with its own default in the question text, and give three answers - use these values (recommended), set your own (Other: one number per key, in the catalog's own order), or do not use the feature (which writes the row's `group_off` value to every key in the group, never a blank). Only a row carrying `group_off` gets an off answer; never invent one for a row without it. **Never print, echo back, or ask for a credential VALUE.** A key matching the catalog's `secret_key_pattern`, or a row flagged `secret: true`, is reported as `set (N chars)` or `absent` and nothing else - not as a shown default, not in a table, not in a question. A value that must be set is set by the user in the file itself, or with a copy-ready command they run in their own terminal; it never travels through the chat. Measured: seven credential exposures in one corpus. The catalog is the whole list: Claude Code's own `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` is not in it and is never asked about or written - the stack used to seed 40 into every project, a value nobody chose. Brownfield: when the target settings.json already carries a value, present THAT as the default - never silently override a pinned choice. Everything else moved to where it belongs: the context7 transport is asked at step 8 only if context7 ends up selected, and `--keep-pins` is a configure/update question - a fresh install has no local pin edits to keep, so never ask it here.

## 2. Permission mode

Read the target scope's settings.json `permissions.defaultMode` - the account file (`~/.claude/settings.json`, or the `--space` profile's) for a `global` install, the project's own `.claude/settings.json` for a `project` install if it already carries one - and report the current value in one line (`unset` if the key is absent). Ask ONE AskUserQuestion: **keep it as it is** (recommended - write nothing here; confirmed by Claude Code's own documented settings precedence, user -> project -> local, later overrides earlier, so the project reads whatever the target file already has, or Claude Code's own default when the key is absent) or **set the default for this project** (write `permissions.defaultMode` into THIS project's `.claude/settings.json` only, pre-filled with the value just reported, editable via Other to any of `default` / `plan` / `acceptEdits` / `bypassPermissions` / `auto` / `dontAsk`). No-project mode: skip - there is no project to scope a default to. Applied at step 11 (Install), the same merge-only-this-key discipline as screen B's environment choices - every other key in `permissions` (`allow` / `deny` / `ask` / `additionalDirectories`) and the rest of the file stay exactly as the installer left them.

## 3. Project analysis - the stacks

Project mode - detect stacks by artifact and record which apply (this detection IS the recommendation input; decide from the project, not from a generic default):

- `*.csproj` / `*.sln` -> .NET. Split by content, per project: a `Microsoft.NET.Sdk.Web` project -> `aspnet`; `<UseWPF>true` -> `wpf`; `<UseWindowsForms>true` -> `winforms`; a `Microsoft.Extensions.Hosting.WindowsServices` reference (or a `ServiceBase` inheritor) -> `windows-service`; an EXECUTABLE carrying none of those markers (`<OutputType>Exe</OutputType>`, or `Microsoft.NET.Sdk.Worker`) -> `console`. A class LIBRARY is never its own stack: `Microsoft.NET.Sdk` with no `OutputType` (library is the default) - and a test project - is a surface of the app that references it, so a WPF solution's own libraries stay `wpf` and add NO `console` (measured mis-detection: libraries inside a WPF app pulled in the console agents + skills). When every .NET project in the repo is a library, ask which surface they serve instead of defaulting to `console`.
- `angular.json` -> `web-angular`; `ionic.config.json` / `capacitor.config.*` -> `ionic-angular`. An Ionic app matches `angular.json` too - when `ionic-angular` detects, do NOT also report `web-angular` for the same app; report both only when the workspace holds a second, distinct Angular app with no Ionic shell.
- a `manifest.json` carrying `"manifest_version"` (or a wxt/crxjs config) -> `browser-extension`.
- `Dockerfile` / `.github/workflows/` -> `devops`; `*.sql` / a migrations folder -> `data`.
- `tsconfig.json` / `jsconfig.json` -> `typescript` (the language-level seed - conventions rules + LSP plugin + ts-js-testing). A TS framework stack claims its own surface: when `web-angular` / `ionic-angular` / `browser-extension` detects, do NOT also report `typescript` for the same app - the framework seeds already carry the rules + LSP, and testing is `angular-testing`'s there (browser-extension seeds ts-js-testing itself); report both only when the repo holds a genuine non-framework TS surface too (Node tooling, a published library, scripts with their own tests).
- `package.json` with `.js` sources and NO `tsconfig.json`/`jsconfig.json` -> `javascript` (the plain-JS seed - the javascript-conventions rule + typescript-lsp, which serves JS too, + ts-js-testing, the shared TS/JS testing hub). One-way suppression: when `typescript` detects it covers JS as well - do NOT also report `javascript`; the framework stacks suppress it the same way (they carry javascript-conventions themselves).

Alongside the stack scan, run the EVIDENCE scan quietly - one call, one narration line:
`node "$TMP/repo/scripts/scan-evidence.js" --root . --catalog "$TMP/repo/meta/evidence.json" --out "$TMP/found.json"` - a deterministic read of the project's package manifests (csproj / Directory.Packages.props / package.json) against the signal catalog. Its `found` map feeds the walk's tables via `--found` and pre-selects what the project provably uses; the conclusions are computed from THIS project's files, never assumed.

A project can match several. Report the detected stacks and put the confirmation through AskUserQuestion (confirm as detected - recommended; adjust via Other, naming stacks to add or drop) - the walk starts IMMEDIATELY after this answer, no other question in between:

```
[step 3/12 - project analysis] confirm the detected stacks · next: rules
Detected: aspnet (src/Api/Api.csproj - Microsoft.NET.Sdk.Web), web-angular (angular.json), devops (Dockerfile + .github/workflows/)
```

Stack names are the catalog keys of `$TMP/repo/meta/recommendations.json` (`web-angular`, never `angular`) - `--stacks` takes exactly those, and the tool names an unknown one on stderr (`unknown-stack`) instead of silently seeding nothing.

No-project mode, and a repo with NO recognizable artifacts (greenfield): skip the artifact detection and instead present the stacks available in `$TMP/repo/meta/recommendations.json` as a multi-pick ('which stacks do you work with?' / 'what will this project be?'); picking none installs just the `always` baseline. Every later step applies unchanged.

## The walk - steps 4-9, one layer at a time

The layer order follows the dependency graph's arrows: rules pull agents + skills, agents pull skills, everything pulls MCPs and plugins, and hooks stand alone - dependencies only point FORWARD through the walk, so an earlier answer is never invalidated by a later one. Hold ONE running `raw.json` (in the temp dir) of the user's DIRECT picks per category (`rules`, `agents`, `skills`, `hooks`, `mcps`, `plugins`); locked items never enter it - the closure re-adds them at emit time.

Per layer, the SAME three-beat shape:

1. **Recompute quietly** - one call: fold the previous layer's picks into `raw.json`, run `node stack-select.js --selection raw.json`, parse the category-tagged `required: <category> <name> - <why>` lines yourself. The current layer's lines are its **locked** set.
2. **Show ONE numbered table of the layer's ENTIRE catalog** - every item the release ships, so nothing is ever offered later or out-of-band. The TOOL renders it, never you: `node stack-select.js --selection raw.json --table <layer> --recs <recommendations.json> --stacks <confirmed,csv> --found "$TMP/found.json"` - **never redirect that to a file**. The table comes back IN the tool result; paste those exact lines into your message inside a fenced code block. (Measured: the old form redirected to `$TMP/table.txt` and told you to paste the file - the tool result was then empty, the read-back was a step nobody took, and one real run asked all six layer questions with no table shown at all. If you want a copy on disk, `| tee "$TMP/table.txt"` - the pipe keeps the output visible.) **The layer turn has ONE fixed shape, in order: (1) the `[step n/12 - <layer>]` banner, (2) the fenced block holding the tool output byte-for-byte, (3) the step-3 selection question - a layer turn missing the fenced table is invalid: render the table and re-send.** The plugin's `guard-layer-table.js` hook denies the ask (up to three times) when no `total: N <layer>` footer follows the table call in your text. Self-check before you send the question: your own message must carry the `total: N <layer>` footer line. It is not there unless you pasted the table. A prose grouping that feels equivalent (`Locked (5): ...` / `Recommended (12): ...` lines) is the exact failure this shape exists to prevent, and the run's narrate-don't-trace rule does not reach this paste - it is the rule's one sanctioned exception (the step-1 recompute already honored the quiet part). The paste is pre-padded by the tool, so it stays aligned at any length; a hand-written markdown table shears when the renderer flushes it in segments. The table ends in a `total: N <layer>` footer - part of the paste and the user's truncation check: fewer visible rows than the footer names (or a missing footer) means the display was cut down - re-paste in full, and never summarize rows into prose; the user decides from the whole catalog, not from a shortlist. Row numbers come from the tool and are stable across rounds. The tool labels each row: `required` (closure-locked, reason in the last column), `evidence` (the scan matched a signal - PRE-SELECTED, the matched signal shown as the reason, droppable like any seed), `recommended` / `stack:<name>` (seeded, droppable), `added` (the user's own pick), `-` (not selected). Recommended = the union of `always` + each confirmed stack in `$TMP/repo/meta/recommendations.json`, pre-selected:

```
[step 5/12 - agents] adjust the agent roster · next: skills
 # | agent                       | selected     | required by
---+-----------------------------+--------------+---------------------------
 1 | ci-failure-diagnoser        | recommended  | -
 2 | dotnet-build-error-resolver | stack:aspnet | rule dotnet-repair-agents
 3 | wpf-implementer             | -            | -
```

3. **One selection round - quick options + numbers.** Ask with the question tool, options in this order: **Recommended** (keep the table exactly as shown - the default), **All** (select every row in the layer's catalog), **None** (keep only the locked rows), and typed adjustments through the free-text answer - `add 3 7 12`, `drop 5`, or both (bare numbers mean add). A drop naming a LOCKED row is refused with its reason shown ('#2 stays - required by rule dotnet-repair-agents; drop that rule first (reopening step 4) or keep it'), never silently honored or silently ignored. Restate the outcome in one line (added N, dropped M), fold it into `raw.json`, and narrate the handoff to the next layer. An `unknown:` line from the recompute is a typo or a retired name - surface it, never pass it through.

## 4. Rules

Nothing in the graph depends on a rule, so this layer never has locked rows - it is the one fully free pick, which is why it goes first: the rules chosen here decide what later layers must keep.

## 5. Agents

Locked = agents the kept rules require (the repair-loop rules pin their resolvers, e.g. `required by rule dotnet-repair-agents`).

## 6. Skills

The full release catalog in one table - the generator `project-*` skills and every other house skill included, so THIS is the only place skills are ever chosen; later steps (CLAUDE.md included) never offer skill additions. Locked = every skill the kept rules and agents REQUIRE (rule attachments and `skills:` frontmatter preloads), each with the reason naming its dependent. A skill an agent's body merely names as a conditional load ('load X when...') gets NO row of its own: an artifact naming a skill must never put it into an install - a need is proven, not suggested. Rows the step-3 evidence scan backed arrive labeled `evidence` and PRE-SELECTED, the matched signal in the reason column ('MassTransit in src/Api/Api.csproj') - droppable like any seed. The scan IS the evidence mechanism: never hand-propose add-candidates beyond what the table already shows. The user adds or drops by number - and the NAMES go back in your next message before anything is written ('adding: markdown-style, ts-js-testing; dropping: wpf-conventions'). An index the user typed is an index YOU resolved, and an off-by-one silently installs the neighbouring row (measured: a five-number edit applied with no name read-back at all - correct that time, unverifiable to the user). The only skills seed is `always.skills` - the house METHOD set: the cross-task orchestrator plus the manual `project-*` method skills (the inline execution twins, the capture/loop generators, the upgrade planner), all pre-selected `recommended` and droppable; their need is 'the stack is installed', not anything a project manifest could prove, which is why they are seeded rather than evidence-scanned. The ONE deliberate exception is `project-build-from-scratch` - greenfield-only by its own description, dead weight on an existing project, so it is never seeded; offer it as an unselected row like any other, and only in a greenfield/no-project run is picking it natural. Beyond the seed set, selected = locked + whatever the user adds.

## 7. Hooks

Hooks are leaf picks - nothing requires them, they require nothing, so every row is free. Recommended = all seventeen: the eleven always-on guards, the session monitor (`monitor-session` - never denies; seeded to log its notes, not inject them), the three session engines (`docs-session` - the docs start block and finish ask - `memory-session` - the shared-memory slice at session start - and `history-session` - what the last sessions on this branch did and ruled), the turn-end build check (`check-turn-build` - wired, but inert until `ALFRED_CODE_TURN_CHECK` flips to `1`, seeded `0`), plus the env-gated `instrument-tool-usage` (wired like the guards, but inert until `ALFRED_CODE_INSTRUMENT` flips to `1` - so keeping it costs nothing idle, and dropping it leaves the install unable to record a measured run without a manual re-wire). The whole set now ships together in the `alfred-code-hooks` plugin, so nothing is copied and nothing is wired per project: this answer is written as `ALFRED_CODE_HOOKS_OFF` in the project's `.claude/settings.json` env - the rows you DROP are the ones named there, and **None** names all sixteen (the emitted selection carries `hook none` for it; `--hooks-answered` at step 10 is what writes it) - and it can be changed later by editing that value, no reinstall.

## 8. MCPs

Locked = the servers the kept selection pulls (`serena` via `baseline-navigation`, `context7` via `baseline-quality-gates`, `memory` via `baseline-memory` - required in every install now, the same way serena and context7 are); recommended = `playwright` plus the confirmed stacks' seeds (`angular-cli` on the Angular/Ionic stacks). The heavy two - `chrome-devtools` and `appium-mcp`, which fail at launch without Chrome or the mobile SDKs - are seeded by NO stack and appear as free adds; appium arrives pre-selected only when the evidence scan matched its own dependency. Everything else - `sentry` included - is a free add for projects that actually use it, shown in the table as an unselected row like any other; note next to `sentry` that it needs two values in the ACCOUNT settings.json env (below).

After the round, and ALWAYS - `memory` is locked, so this fires on every run, not only when the user picks it - ask the shared memory level. Paste this table first, table-before-question like every other decision in this run. At `--scope global` (screen A's scope answer), drop the `project` row entirely - the installer refuses `project` at global scope, since an account-wide install has no single project root to own the database - and show only the first two rows:

```
| level | database | who shares it |
|---|---|---|
| global (Recommended) | ~/.memory-mcp/memory.db | every Claude account and Cursor on this machine |
| scoped | ~/.memory-mcp/memory_<space>.db (memory_default.db with no space) | just this one Claude account, and Cursor installed with the same space |
| project | <project>/.memory-mcp/memory.db, gitignored | this project only, from any account |
```

Then ONE AskUserQuestion carrying exactly the options just shown (two at global scope, three at
project scope), `global` marked Recommended - the
default for a fresh install, the whole point of shared memory. Picking `project` while this
project's related-projects domain already names sibling repos
(`<docs-path>/related-projects/RELATED-PROJECTS.md`, or the generated
`baseline-project-related-context.md`) means those projects' memories will not be visible from
this one - say so in the closing card, not here. Pass the answer to the installer as
`--memory-level <value>` at step 11; the installer registers the memory MCP at that level's
database, imports this project's existing notes into it once, and (only when that import
succeeds) switches Claude's own memory off - read its log for what actually happened and report
that, never assert it from the answer alone.

Only if context7 stayed selected, ask its transport here (`remote` default / `local`); only if playwright stayed selected, ask in the same AskUserQuestion screen TWO questions - which browsers to keep (multi-select: `chrome` pre-selected = the machine's Google Chrome, `msedge` = the machine's Microsoft Edge, `firefox`, `webkit` = Safari's engine; the last two are Playwright's own builds the installer downloads) and which ONE stays enabled (single-select among the kept ones). Each kept browser becomes its own server (`playwright-chrome`, `playwright-firefox`, ...); the installer registers all of them and its next-steps card prints the `/mcp disable playwright-<x>` lines for the others - the user runs them once, and switches any time with `/mcp enable` / `disable`; and only if sentry stayed selected, run the **sentry environment plan** - the slug and the auth mode as TWO SEPARATE questions in the SAME AskUserQuestion call (the tool takes up to four; never fold the slug into an option's DESCRIPTION - a user who answers the auth-mode radio then skips a value buried in prose pays a second round trip, measured): Q1 the slug (`SENTRY_SLUG`: free text, `<org>` or `<org>/<project>`, Sentry's recommended form; an EU-region org - its DSN reads `ingest.de.sentry.io` - must name it; required, re-ask on empty), Q2 the auth mode (`token`, default and recommended, vs `oauth` - browser consent, no key). In the same screen TELL the user to add `SENTRY_ACCESS_TOKEN` (a personal or org API token: Sentry -> Settings -> Account -> API -> Personal Tokens) to the ACCOUNT `settings.json` `env` themselves - the file is `~/.claude/settings.json`, or `~/.claude-<space>/settings.json` under a space - never paste the token into the chat, and never a project-level `.claude/settings.json` (its env does not reach `.mcp.json` - measured). Show the exact snippet:

```json
{ "env": { "SENTRY_SLUG": "<org>[/<project>]", "SENTRY_ACCESS_TOKEN": "<token>" } }
```

The slug is passed to the installer as `--sentry-slug` at step 11 (it seeds the account env); the token is the user's to add, and step 10's prereq check reads that file, so a still-missing token or slug shows as a warning there and in the next-steps card. Skipping sentry asks none of this and writes nothing.

## 9. Plugins

Locked = the plugins the kept selection pulls (an LSP plugin rides its stack's closure). `superpowers` shows as `dependency`: every install carries it beside the core plugin and the installer puts it back on every run, so it cannot be dropped - do not offer it as a pick. Recommended = the always-baseline plugin set (`security-guidance`, `claude-hud` - the two that belong in every install regardless of stack) plus the confirmed stacks' plugin seeds. The rest of `catalog.plugins` is freely addable.

**Plugin settings - part of this layer's turn.** After the selection question, for every kept
plugin the snapshot's `$TMP/repo/meta/plugin-settings.json` has a row for (today `claude-hud`,
whose config file is ACCOUNT-level whichever scope it is installed at), report the delta and ASK
here - the answer is applied at the install step, exactly like screen B's environment choices:

1. `node "$TMP/repo/scripts/plugin-settings.js" --catalog "$TMP/repo/meta/plugin-settings.json" --config-dir <account dir> --installed <kept plugins csv>` - paste its output verbatim in a fenced block. Each line reads `missing` (would be added), `differs` (the user already chose something else) or `match`; `--config-dir` is `~/.claude`, or `~/.claude-<space>` under a profile.
2. ONE AskUserQuestion carrying those counts: **Apply recommended** (Recommended - adds only the missing keys, every value already chosen is kept), **Apply and replace differing** (overwrite those too), **Skip** (change nothing).

No kept plugin with a row: skip this silently, ask nothing. A target that needs a block the
plugin's own setup owns (claude-hud's `statusLine`, which carries the refresh interval) reports
itself as `skipped` rather than inventing it - say so once, and point at `/claude-hud:setup`.

## 10. Prerequisite check

Run: `node stack-select.js --selection "$TMP/raw.json" --emit "$TMP/selection.txt" --hooks-answered --check [--context7-local] [--sentry-oauth] [--playwright-browsers <csv>] [--github-cli] [--config-dir ~/.claude-<space>]` (`--playwright-browsers` with the step-8 kept browsers whenever playwright is kept - a kept `msedge` warns when Edge is not installed; `--config-dir` only under a `--space` profile, so the env probe reads THAT account's settings.json instead of `~/.claude`; `--context7-local` only when the user chose context7 `local`; `--sentry-oauth` only when they chose sentry `oauth` at step 8 - it drops the token warning that mode never needs (the slug warning stays: the URL needs it in both modes; the check reads the account settings.json env as well as the shell); `--github-cli` only when they opted in at step 1). Redirect its output to `$TMP/select.out` like every recompute. It writes `selection.txt` - the closed installer selection. **Fixed shape, three blocks:** (1) one verdict line - `blockers: N · warnings: N`; (2) the closed selection grouped by category, closure adds marked with their reasons; (3) the lists:

- Blockers: list each with its fix, then AskUserQuestion: fix them now and continue (recommended), or drop the affected items (reopen the owning layer's table, re-run, re-emit). Never install past a blocker.
- Warnings: list them and proceed.
- **Convention-conflict warnings (brownfield only).** When the project already carries stated conventions - a root or `.claude/` CLAUDE.md, `<docs-path>/architecture/` docs - check the user's TYPED ADDS from the walk (never the closure-locked rows, never the stack/evidence seeds - those are signal-backed) against them: an add whose PURPOSE conflicts with a stated convention gets ONE warning line quoting the rule verbatim (`warning: skill dotnet-architecture conflicts with CLAUDE.md: 'NOT Clean Architecture / DDD / VSA'`) and one keep-or-drop consent. No citable conflict, no warning - unused-looking is not a conflict; no project docs, skip silently. A conflict warning never blocks the install - the user's keep is final.

## 11. Install

**First, report what the selection means - from the derivation, never in your own words.** Run
`node "$TMP/repo/scripts/derive-state.js" --selection "$TMP/selection.txt" --source "$TMP/repo" >
"$TMP/state.json"` and render four lines from it, nothing added:

- skill and agent plugins - when `routes.skills` is true, `skill and agent plugins: <n> - <names>`
  from `plugins`; otherwise `skill and agent plugins: copy route - copied into .claude/`. The hooks
  entry, the MCP entries and the plugins-layer picks are not in this list - their own layers named
  them.
- `seats switched off:` the seat names in `written.agentDeny` (`permissions.deny` entries -
  configure brings one back), or `none`.
- `hooks switched off:` the names in `written.hooksOff` (`ALFRED_CODE_HOOKS_OFF`), or `none` - on
  the hooks copy route a hook not picked is simply not copied.
- `carried but not picked:` `written.undroppable`, or `none` - a plugin skill cannot be dropped on
  its own; say so once when the list is not empty.

`written` is the installer's own rule applied to the routes this environment runs, so it IS what
the install writes. Under `ALFRED_CODE_SEED=shell` the frozen twin writes no seat deny: print
`seats switched off: not on the shell route` instead.

Then run the installer **from the snapshot**, and pass it back with `--source` so it installs from what you already downloaded instead of fetching again:

- **Any OS:** `node "$TMP/repo/scripts/install/alfred-code.js" install --source "$TMP/repo" --scope <scope> --selection "$TMP/selection.txt" [--space <name>] [--context7 local|remote] [--sentry-slug <slug>] [--sentry-auth token|oauth] [--playwright-browsers <csv> --playwright-enabled <browser>] [--docs-versioning git|local] [--github-cli] [--memory-level global|scoped|project]`
- **`ALFRED_CODE_SEED=shell`** - the resolve line reported `seed=shell`, so the frozen OS twin runs instead. Unix: the same flags, with `bash "$TMP/repo/scripts/os/claude-stack.sh"` in place of the `node` call. Windows: `pwsh -File "$TMP/repo/scripts/os/claude-stack.ps1" install -Source "$TMP/repo" -Scope <scope> -Selection "$TMP/selection.txt" [-Space <name>] [-Context7 local|remote] [-SentrySlug <slug>] [-SentryAuth token|oauth] [-PlaywrightBrowsers <csv> -PlaywrightEnabled <browser>] [-DocsVersioning git|local] [-GitHubCli] [-MemoryLevel global|scoped|project]` - the ps1 handles the serena/TypeScript-on-Windows patch itself.

`--docs-versioning` carries screen B's docs-versioning answer whenever screen B asked it: the installer then WRITES that decision instead of seeding a detected value, prints one `ALFRED_CODE_DOCS_VERSIONING <old> -> '<new>'` line instead of a seed line, and so leaves nothing for the re-probe below to touch.

`--memory-level` carries step 8's answer: the installer registers the memory MCP at that level's
database, imports this project's existing notes into it once, and - ONLY when that import
succeeds - switches off Claude's own auto-memory in THIS repo's own `.claude/settings.json`,
even at global scope (never the account file, which would silence every other project's memory
too). A failed import leaves Claude's own memory ON and is reported as such rather than retried
into a false success; the old `MEMORY.md` / `memory/*.md` files are never deleted either way. Read
the installer's own log for what it actually did and report that verbatim in the close-out; never
claim the switch-off happened because the level was asked.

`--source` is what makes the guided run take ONE download. The installer owns nothing here: it copies out of `$TMP/repo` and leaves it for you to remove at cleanup. It writes `.claude/alfred-code.stamp` recording the commit it installed (read from the snapshot's `RELEASE-SOURCE`) - that is what a later `/alfred-code:configure` diffs against.

The sentry values are ACCOUNT-level, not project-level: `--sentry-slug` writes `SENTRY_SLUG` into the account `settings.json` env itself, and the token and the context7 key land there too when they are exported in the shell the installer runs in (the run writes every key it is handed into that file, at project scope too - never through the chat) - after the run, re-read that file and, when `SENTRY_ACCESS_TOKEN` (token mode) or `SENTRY_SLUG` is still absent, say so in the next-steps card with the file path and the snippet from step 8.

Presence, never the value - run this and paste its lines as-is:
`node "$TMP/repo/stack/hooks/guard-secret-value.js" --presence "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" SENTRY_SLUG SENTRY_ACCESS_TOKEN CONTEXT7_API_KEY`
(the same line runs on Windows - Claude Code's Bash tool is Git Bash, where `$env:USERPROFILE` is not a variable; a `--space <name>` install reads `~/.claude-<name>/settings.json`). Output is `KEY=set (N chars)` or `KEY=absent` - nothing else is ever printed; a shell dump of that file is rewritten by the same hook into its redacted view (every credential value shown as `<set (N chars)>`), and the Read tool on it is blocked.

Then apply the step-1 environment choices where they differ from what the installer left: a merge on the scope's settings.json touching ONLY the chosen keys - every key screen B asked about (the catalog's rows, `env.` prefixed) (plus `autoCompactEnabled: false` when the user chose 'off'; delete the pct override in that case rather than writing a dead value) - everything else in the file preserved. The installer seeds these only when absent, so the values written here are the user's and survive every later update untouched. An accepted default needs no write only where the FILE already holds that value, so read the block back after the install and compare: one row's seed is DETECTED from the repo rather than constant (its `what` says so), and there the catalog default and the seeded value can differ.

When the applied `ALFRED_CODE_DOCS_PATH` differs from what the installer stamped (the installer ran before this merge), re-stamp the deployed rule - run `node $TMP/repo/scripts/stamp-docs-root.js <project root>` (a global install: `--claude-dir <account dir>` instead - the dir holding `rules/` + `settings.json`): it rewrites the 'This install's root:' line in `.claude/rules/baseline-docs-root.md` from settings.json, so the always-on awareness matches the env; every later update re-stamps it too. Add `--reprobe-versioning <value>` to that same command when THIS run's install printed a seed line for the docs-versioning key, passing the value that line named (`git` or `local`): that seed was probed against the docs path the install ran with, and the flag re-reads it at the path just written. The script REFUSES when the file no longer holds that value, so a decision an earlier install wrote, or one the user chose on screen B and this step just applied, is never re-probed - pass the seeded value and let the check answer, rather than judging it here.

On a step-2 'set the default for this project' answer, merge `permissions.defaultMode: <value>` into the PROJECT's `.claude/settings.json` - never the account file - touching ONLY that key inside `permissions` (`allow` / `deny` / `ask` / `additionalDirectories` and everything else in the file untouched). A 'keep it as it is' answer writes nothing.

### 11a. Plugin settings - apply the step-9 answer

The plugin is on disk only now, so this is where the answer lands: re-run the tool with `--apply`
(plus `--replace` when they chose to overwrite differing values) and paste the closing `applied:`
line. 'Skip' writes nothing and is not re-asked. Never hand-edit either file - the tool merges, so
keys outside the catalog and the plugin's own settings survive.

## 12. CLAUDE.md - the user's call (project mode)

Not required - open with WHERE it lives and WHAT a yes changes, then AskUserQuestion (fill it in - recommended / skip); a 'no' ends the run cleanly (a later `/alfred-code:configure` can always reconcile it). The location: the installer seeded `.claude/CLAUDE.md` from the snapshot's `stack/CLAUDE.template.md` when the project had none - that file, in this project, is the target; a pre-existing CLAUDE.md (root or `.claude/`) is NEVER overwritten - the offer becomes a reconcile against the fetched template instead (add the sections it lacks, leave the project's own prose untouched), with the changes shown before writing. On a yes: follow the template's own authoring-outline comment - write the project top (what the project is, structure, the real build/test commands), cover the outline's inventories (stack, commands, secrets/config globs), and trim its rules table to the rules this selection actually installed. Never offer skill/agent/MCP additions here - the walk owned the selection. Skip in no-project mode (a global install seeds no project file).

## Post-check + next steps - close every run with this card

**The card restates the OUTCOME of every step that took a decision** - one line each, in step
order, naming what was chosen and what it did ('git hygiene: `.git/info/exclude` - `.claude/` and
`.serena/` ignored locally, nothing committed'). A decision the user made mid-run and the card
leaves out is a decision they ask about again (measured: a git-hygiene answer was stated once
mid-run, omitted from the close, and re-asked twice over four extra messages).

**The run closes on a suggestion card, never on a question.** The steps below that are the
USER's to run - the session reload, the account-file credential line, the capture sequence,
the serena index - are listed as suggestions, the one everything depends on first and each with
the one reason it matters, SCOPED to what actually needs it ('Reload the session - the MCP servers
connect at launch, and skills, agents and the always-on rules are inventoried then'). Do not say
nothing is live until the reload: hooks and the `settings.json` env are read per invocation and are
live on the next tool call, which `meta/environment.json`'s own comment states and a measured run
proved twice in one session (a hook installed at 08:12:53 fired at 08:21:15; an env flip produced
its first ledger row 7.9 s later and covered 17 of 17 following calls). A claim about the stack's
own behaviour that overshoots is the same defect as one the stack never states - the model invents
the rest. No AskUserQuestion over them: the walk's asks end
with the installer, and the closing ask over follow-ups was dropped as friction - the user's
call, made knowing a prose next step was ignored 3 of 3 in one audited session, which is why the
reason rides beside every step. The gitignore write in item 1 keeps its own consent ask - it is
a write, not a suggestion. Close the card with this line, verbatim: 'Nothing is pending on this
run - these are yours to run when you choose.' The stop-contract guard reads that sentence as a
finished close; without it a 'done + next step' card is blocked as a stall and the guard demands
the very ask this paragraph removes.
The line is CONDITIONAL: print it only when the card carries nothing OWED. A still-required user
action - revoke the old token, fill in a credential, run a rotation - IS pending, so name it and
put the close through the ask instead (measured: one close stated 'Still owed: revoke the old
token in Sentry's dashboard' and this line in the same message).

Report what still needs a hand: LSP tools (`csharp-ls` via `dotnet tool install -g csharp-ls` on a .NET setup), the `/claude-hud:setup` statusline step, and that the first `claude plugin install` may prompt to trust. Then, AFTER the summary, print the next-steps card - built from what THIS run actually installed, never naming a command whose skill is absent. The card opens with the one step everything else depends on - reload the session (MCP servers connect and skills/agents/rules are inventoried at launch; hooks and the settings.json env need no reload - they are live on the next tool call), and name the one command that CONFIRMS it - `claude mcp list` after the restart, where every row should read connected (measured: two stack-seeded stdio servers timed out at 30s and the session ran without them, unreported) - and closes by naming `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/post-install.md` as the durable copy the user can re-read later (it adds the serena setup prompt and the gitignore semantics):

1. **Git hygiene (project mode).** Suggest ignoring the machine-local artifacts this install creates - only entries that apply to the selection and are not already covered by the project's ignore rules: `.claude/` (the install + stamp + the default docs root), `.serena/` (LSP cache + project memories - when serena is selected), `.mcp.json` (installer-regenerated on every run - fix the template, never this file), plus runtime dirs when present in the tree (`.playwright/`, `.slopwatch/`). Show the exact lines first, then one AskUserQuestion with BOTH homes as options: the committed `.gitignore` (recommended), `.git/info/exclude` for a local-only ignore that touches no committed file, or skip; write only on consent.

2. **Shared memory.** Name the level chosen at step 8 and the database it points at, and whether
   the one-time import of the old `MEMORY.md` notes succeeded (the installer's own log names both -
   read it, never assert). A failed import means Claude's own memory is STILL ON - say that plainly
   rather than implying the switch happened because the question was asked. When `project` was
   chosen and this project's related-projects domain names sibling repos
   (`<docs-path>/related-projects/RELATED-PROJECTS.md`, or the generated
   `baseline-project-related-context.md`), add the one-line caveat here: those projects' memories
   will not be visible from this one - the project-level database holds only this project.

3. **The capture sequence** - the deliberate captures that turn a fresh install into an oriented one, in dependency order. Every one of them is the USER's to type: all but the two analyzers (`project-architecture-analyzer`, `project-test-coverage-analyzer`) are manual-only (`disable-model-invocation`), so a Skill call from this run is denied by `guard-fresh-session-start.js` - name them, never attempt one and never narrate that you cannot. List each ONLY when its skill is installed AND its output is missing or stale for this install (the check beside each item) - a capture whose output already exists and still holds is not suggested at all; an uninstalled one gets a single line ('project-code-style-analyzer not installed - add via `/alfred-code:configure`') instead of a dead command:
   1. `/project-architecture-analyzer` - only when `<docs-path>/architecture/ARCHITECTURE.md` does not exist: writes the durable architecture docs every seat reads to orient.
   2. `/project-code-style-analyzer` - only when `<docs-path>/code-style/CODE-STYLE.md` does not exist: captures the project's real code style and generates the path-scoped project-code-style rule.
   3. `/project-related-context <sibling> ...` - OPTIONAL, and only when this project actually has sibling repos and `.claude/rules/baseline-project-related-context.md` does not exist yet: sibling-repo awareness, args only (local paths or git URLs, e.g. `frontend - ../client`, `backend - ../server`); it never scans on its own. A standalone repo skips it - not a gap. The skill is opt-in, so when it is absent say so in one conditional line ('sibling repos? add `project-related-context` via `/alfred-code:configure`') rather than the flat not-installed line the other captures get.
   4. `/project-agent-capabilities` - LAST, and only when this run installed or removed anything (the rule then lists an inventory that no longer exists, or is absent): the generated usage-policy rule reflects the final inventory including anything the captures above added.

4. **serena - one index step, then the honesty note.** The installer already seeded
`.serena/project.yml` (detected `language_servers`, plus `ignored_paths` for `.serena` / `.claude` / `.playwright` -
without which serena's own 327MB language-server directory gets indexed as if it were source:
measured 126 files attempted, 112 failed, all inside `.serena/home`). Tell the user to build the
index ONCE - `SERENA_HOME=.serena/home uvx --python 3.13 --from serena-agent serena project index` (Windows PowerShell: `$env:SERENA_HOME='.serena\home'` - serena hands the path to cmd.exe unquoted, where a `/` cuts it, and so would a space in an absolute path - and, on Windows on ARM, `--python cpython-3.13-windows-x86_64-none`) - and that it
is worth re-running after a large refactor or a branch switch that moves many files. Then state
which case THIS project is, in one line: on TypeScript / Angular / mixed web, serena IS the nav
tool; on C#, nav depends on the Roslyn server starting (the seeded language_servers entry is what
makes it start at all), and where it still stalls on a large solution the `csharp-lsp` plugin owns
navigation - serena stays either way as the per-project memory bus.

## Clean up the temp dir - ALWAYS

Remove `$TMP` per `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md`, on EVERY exit path of THIS command: after a successful install, after an abort, and after a blocker or a user 'no' that stops the run early. Then confirm the project tree holds only installed artifacts.

## Do not

- Do not install the full set - always go through the walk, and never present a layer question without its `[step n/12 - <name>] ... · next: <name>` banner or without the full-catalog table (a partial table hides choices; a later 'want these too?' question is the failure this shape exists to prevent).
- Do not deselect a locked row on the user's behalf, and never drop one silently - the reason column is the answer, the reopen offer is the remedy.
- Do not paste tool output other than the decision tables, or run chatty per-file commands - the 'Narrate, don't trace' contract holds for the whole run.
- Do not call a skill this run just installed. Skills are inventoried at session start, so one written to disk seconds ago is not in the running registry and the call returns `Unknown skill: <name>` (measured) - a wasted round trip the reload item in the closing card already accounts for. Read its `SKILL.md` from the snapshot if you need its content now; otherwise name it in the card and let the user run it after the reload.
- Do not skip a layer, the selection round, or the prerequisite gate. Do not write the archive, the extracted repo, or the working files into the project tree, and do not leave `$TMP` behind on any exit path. Do not commit anything on the user's behalf.
