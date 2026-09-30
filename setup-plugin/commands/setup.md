---
description: "FRESH install of Alfred Code into a project - ask scope + profile up front, then detect the OS + analyse the project, show what it needs and why (the evidence scan plus validate's missing and evidence-gap checks, in a fresh-install mode), and walk the selection in six dependency-ordered layers (rules -> agents -> skills -> hooks -> MCPs -> plugins): each layer shows ONE numbered table of the whole catalog (recommended pre-selected, locked rows carrying the required-by reason), then one selection ask - keep the marked rows, pick groups to add or drop from options, add every row, or only the locked rows. Prerequisite check, install, the environment, permission and plugin-settings merges, then a closing card that ends on the restart and /alfred-code:init, the one-time bootstrap (services, memory, captures, AGENTS.md). NOT for an existing install - that routes to configure."
disable-model-invocation: true
---

# Set up Alfred Code - fresh install

You are installing Alfred Code FROM SCRATCH. First run `node "${CLAUDE_PLUGIN_ROOT}/scripts/install/stamp.js" state .` - one word (two for a worktree), read from the same install records the hooks read (`alfred-code.stamp`, the 1.x `claude-stack.stamp`, a copied `hooks/docs.js`) in this repo, its git top level or a worktree's main checkout. `not-installed` -> go on. `legacy-unstamped` (a legacy copy-route install that never wrote a stamp - no install record, but two of the stack's own signatures in `.claude/`: its hook files, its env keys, three or more of its skill, seat or rule names) -> ONE AskUserQuestion: 'Update this install (Recommended)' - update reads its picks off disk, each old name under its new one, prunes the old copies and writes the stamp, so nothing the project already runs is re-picked by hand - or 'Fresh setup anyway' - this walk from scratch, its install pruning the old copies the same way. 'Update this install' -> stop and route to `/alfred-code:update`; 'Fresh setup anyway' -> go on. `worktree-of-installed <main>` -> print exactly 'This is a git worktree of <main>, which holds the install - run /alfred-code:setup from there' and stop - a worktree shares that checkout's install, and nothing is written into this tree, or into that one from here. `legacy-global` (a 1.x global install whose stamp still sits in the account dir) -> stop and route to `/alfred-code:update`, which moves it into the project. `installed` or `initialised` -> stop and route to `/alfred-code:configure`, which adjusts an install; a plain refresh is `/alfred-code:update`. NAME the command for the USER to type and end the turn: both are `disable-model-invocation`, so a Skill call from this run is denied (measured: a run asked WHICH sibling, then tried to invoke it and took the denial), and the sibling is better off in a FRESH session anyway - this command's own body, ~9.4k tokens of it, stays in the cached prefix of every message the re-routed run then sends. This command selects and installs; the machine-level services, the memory level, the captures and the AGENTS.md fill are `/alfred-code:init`'s, run by the user in the session after the restart this run ends on. Work the ladder in order and drive it interactively; the deterministic work is done by `stack-select.js`, you orchestrate. Every install has a project root - the git repo's top level, else the current directory (the installer's own rule) - so there is no account-only install. Two modes, detected silently before the first question: **project mode** (the normal case - cwd is in a git repo; the selection is decided from the project itself) and **no-repo mode** (no git repo: the current directory becomes the root, confirmed first). <!-- legacy-name -->

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
`.claude/rules/alfred-interaction.md` loaded at all, so this command's own text is the only place
the voice can come from (measured: a first-run narration line opened with an em-dash, on the one
surface where the rule forbidding it cannot yet exist).

## The ladder - announce every step

Eleven user-facing steps; the machinery between them runs silently. Before EVERY question, one banner line so the user always knows where they are, what is being decided, and what comes next:

```
[step 4/11 - rules] choose the rule set · next: agents
```

1 install choices · 2 permission mode · 3 project analysis · 4 rules · 5 agents · 6 skills · 7 hooks · 8 MCPs · 9 plugins · 10 prerequisite check · 11 install

**The skeleton is INVARIANT - the stability contract.** Every run prints all 11 banners, in this
order, exactly once each. A step that does not apply THIS run still prints its banner followed by
ONE line naming why it is a no-op (`[step 3/11 - project analysis] skipped - greenfield, stacks
chosen by hand`),
then moves on - a step never silently vanishes, and steps are never merged, reordered,
renumbered, or invented. Two runs must be comparable banner by banner; the content varies, the
skeleton never does. The closing next-steps card (Post-check below) is part of the skeleton too -
every run ends with it.

## 1. Install choices

Detect silently first - the OS (the installer itself is one `node` command on every OS now; the OS decides the PowerShell spelling of the snippets below, and nothing else: the frozen OS twins no longer run - `ALFRED_CODE_SEED=shell` stops the run at the installer step) and the mode (a git repo -> project mode, its top level the root; anything else -> no-repo mode, the current directory the root). ONE call answers both, and this is the command - the same copy-ready shape steps 2-3 already give, because improvised probing cost one run three Bash calls where the third re-asked what the first two had already returned (36, 30 and 143 chars of answer for 36% of that run's tokens):

```bash
printf 'os=%s\n' "$(uname -s 2>/dev/null || echo Windows)"; git rev-parse --show-toplevel 2>/dev/null || echo "mode=no-repo root=$(pwd)"
```

Denied by the permission classifier? ASK, do not re-probe. Re-issuing the same detection under different syntax reads as working around the denial, and the measured run got two declines and an interrupt for it. Put the two facts through one AskUserQuestion instead ('which OS?' / 'is this directory the project root?') with the likely answer marked - the user knows both without a probe. Then ask TWO AskUserQuestion screens (the tool caps four questions per call; each default marked Recommended). **Screen A - the install itself:** scope - where the PLUGINS are enabled, nothing else: `project` (default - `.claude/settings.json`, everyone who clones the repo), `user` (every project of this account) or `local` (this checkout only - the stack's own settings writes then go to `.claude/settings.local.json` too); the library copies, rules, hook engines, settings and stamp live in the project's `.claude/` at every scope. In no-repo mode screen A opens with the root confirmation instead - install into this directory, or stop and run from the project's root (recommended when this directory is not the project) - profile (the optional `--space` account name, default none), and the one conditional extra: 'install the GitHub CLI?', asked ONLY when `gh` is not already on PATH and skipped entirely when it is. **Screen B - the environment:** one question per `ask: true` row of the snapshot's `$TMP/repo/meta/environment.json`, which is the ONE list of the values the install writes into the scope's settings file `env` (`.claude/settings.local.json` at `local`, else `.claude/settings.json`) - never a list typed from memory here, or a variable a release adds would silently stop being asked. Each question shows the row's `default` and its `what` in plain words; free text via Other. `ALFRED_CODE_DATA_PATH` is the plugin DATA question - where Alfred Code keeps this project's data in general, not the docs alone - asked in this shape:

```ask
Where should Alfred Code keep this project's data - its docs, the navigation index and handoff notes, browser profiles and a project memory database? Recommended: .alfred at the project root - one folder outside .claude/, where Claude Code prompts for every write.
- '.alfred (Recommended)' - everything under one folder at the project root; its own .gitignore keeps all but the docs out of git
- 'Another folder' - the path is asked next: relative, inside the project, never under .claude/, no space
```

An install that already holds data is update's to move (its data question offers it). The answer goes to the installer as `--data-path <folder>`, never the environment merge below. A row carrying `group_off` is ONE question for the whole FEATURE it owns - it and every row naming it in `asked_with`: name each key with its own default in the question text, and give three answers - use these values (recommended), set your own (Other: one number per key, in the catalog's own order), or do not use the feature (which writes the row's `group_off` value to every key in the group, never a blank). Only a row carrying `group_off` gets an off answer; never invent one for a row without it. **Never print, echo back, or ask for a credential VALUE.** A key matching the catalog's `secret_key_pattern`, or a row flagged `secret: true`, is reported as `set (N chars)` or `absent` and nothing else - not as a shown default, not in a table, not in a question. A value that must be set is set by the user in the file itself, or with a copy-ready command they run in their own terminal; it never travels through the chat. Measured: seven credential exposures in one corpus. The catalog is the whole list: Claude Code's own `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` is not in it and is never asked about or written - the stack used to seed 40 into every project, a value nobody chose. Brownfield: when the target settings.json already carries a value, present THAT as the default - never silently override a pinned choice. Everything else moved to where it belongs: `--keep-pins` is a configure/update question - a fresh install has no local pin edits to keep, so never ask it here.

## 2. Permission mode

Read the scope's settings file `permissions.defaultMode` - the project's `.claude/settings.local.json` at `local` scope, else its `.claude/settings.json`, if it already carries one - and report the current value in one line (`unset` if the key is absent). Ask ONE AskUserQuestion: **keep it as it is** (recommended - write nothing here; confirmed by Claude Code's own documented settings precedence, user -> project -> local, later overrides earlier, so the project reads whatever the target file already has, or Claude Code's own default when the key is absent) or **set the default for this project** (write `permissions.defaultMode` into THIS project's `.claude/settings.json` only, pre-filled with the value just reported, editable via Other to any of `default` / `plan` / `acceptEdits` / `bypassPermissions` / `auto` / `dontAsk`). No-project mode: skip - there is no project to scope a default to. Applied at step 11 (Install), the same merge-only-this-key discipline as screen B's environment choices - every other key in `permissions` (`allow` / `deny` / `ask` / `additionalDirectories`) and the rest of the file stay exactly as the installer left them.

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

A project can match several. Report the detected stacks and put the confirmation through AskUserQuestion (the stacks template below - an add or a remove is picked from options, never typed) - the walk starts IMMEDIATELY after this answer, no other question in between:

```
[step 3/11 - project analysis] confirm the detected stacks · next: rules
Detected: aspnet (src/Api/Api.csproj - Microsoft.NET.Sdk.Web), web-angular (angular.json), devops (Dockerfile + .github/workflows/)
```

```ask
Confirm the detected stacks: <detected csv>?
- 'Confirm <detected csv> (Recommended)' - the walk seeds from exactly these
- 'Add stacks' - next call lists the catalog's other stacks as multi-select questions (up to 3 questions of 4)
- 'Remove a stack' - next call lists the detected stacks as one multi-select question
```

Stack names are the catalog keys of `$TMP/repo/meta/recommendations.json` (`web-angular`, never `angular`) - `--stacks` takes exactly those, and the tool names an unknown one on stderr (`unknown-stack`) instead of silently seeding nothing.

A directory with NO recognizable artifacts (greenfield - a no-repo directory usually is): skip the artifact detection and instead present the stacks available in `$TMP/repo/meta/recommendations.json` as a multi-pick ('which stacks do you work with?' / 'what will this project be?'); picking none installs just the `always` baseline. Every later step applies unchanged.

### 3a. Suggestions - what this project needs, and why

Right after the stacks answer, the checks `/alfred-code:validate` runs over an install, in their
fresh-install mode (no `--installed`: nothing is installed yet, so every need reads as missing) -
one call, both halves, no question in between:

`node "$TMP/repo/scripts/stack-select.js" --missing --recs "$TMP/repo/meta/recommendations.json" --stacks <confirmed,csv>; node "$TMP/repo/scripts/stack-select.js" --evidence-gaps --found "$TMP/found.json" --catalog "$TMP/repo/meta/evidence.json" --recs "$TMP/repo/meta/recommendations.json" --stacks <confirmed,csv>`

Paste the lines byte-for-byte in ONE fenced block under a `suggestions:` heading line - each already
carries its reason (`missing: <category> <name> - needed by <stack>`, `evidence-missing: <category>
<name> - <signal in manifest>`), and the baseline every install carries is ONE `baseline: <n> item(s)`
count line, never a row per item. A greenfield run's scan finds nothing: the `--missing` half
alone. The walk pre-selects every row printed here (`stack:<name>`, `evidence`, `required`). An `evidence-missing` row outside the confirmed stacks is the one a hand pick would
miss - name it once in the narration line. Never add a suggestion of your own beyond what the tools
print.

## The walk - steps 4-9, one layer at a time

Read `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/walk.md` before step 4 and run it in **FRESH**
mode - the one walk text this command shares with `/alfred-code:configure`, so the two cannot drift.
The layers run in dependency order, rules -> agents -> skills -> hooks -> MCPs -> plugins, over one
`raw.json` of direct picks, and every layer has the same three beats: recompute quietly, paste the
tool's full-catalog table in a fenced block after the `[step n/11 - <layer>]` banner, then one
selection ask (Keep the marked rows / Pick ... / Add every ... / Only the locked rows, then one grouped multi-select call on 'Pick'; typing is only through Other). The file owns the table rules, the
selection round and each layer's notes; the steps below add only what is this command's own.

## 4. Rules

walk.md's Rules layer - the one fully free pick.

## 5. Agents

walk.md's Agents layer.

## 6. Skills

walk.md's Skills layer, with the FRESH seed set (`always.skills`, `alfred-task-build-from-scratch` never
seeded).

## 7. Hooks

walk.md's Hooks layer - recommended = all eighteen, the answer written as `ALFRED_CODE_HOOKS_OFF`
in the scope's settings file env.

## 8. MCPs

walk.md's MCPs layer, the two browser asks included (step 11 passes their answers).

The memory LEVEL is not asked here: `/alfred-code:init` asks it (global, scoped or project) in the
session after the restart, and imports this project's old notes into the database it names. Until
then the install points the memory server at the global database and leaves Claude's own memory on.

## 9. Plugins

walk.md's Plugins layer, the plugin-settings ask included - applied at step 11a.

## 10. Prerequisite check

Run: `node stack-select.js --selection "$TMP/raw.json" --emit "$TMP/selection.txt" --hooks-answered --check --defer-init [--browsers <csv>] [--github-cli] [--config-dir ~/.claude-<space>]` (`--browsers` with the step-8 kept browsers whenever the browser server is kept - a kept `msedge` warns when Edge is not installed; `--config-dir` only under a `--space` profile, so the env probe reads THAT account's settings.json instead of `~/.claude`; `--github-cli` only when they opted in at step 1). Redirect its output to `$TMP/select.out` like every recompute. It writes `selection.txt` - the closed installer selection. **Fixed shape, three blocks:** (1) one verdict line - `blockers: N · warnings: N`; (2) the closed selection grouped by category, closure adds marked with their reasons; (3) the lists:

- Blockers: list each with its fix, then AskUserQuestion: fix them now and continue (recommended), or drop the affected items (reopen the owning layer's table, re-run, re-emit). Never install past a blocker.
- Warnings: list them and proceed.
- `init:` lines (uv, csharp-ls) are what `/alfred-code:init` installs in the next session, each through its one ask - `--defer-init` keeps them out of the blockers. List them as the close card's first reason to run init, never as a blocker.
- **Convention-conflict warnings (brownfield only).** When the project already carries stated conventions - a root or `.claude/` AGENTS.md or CLAUDE.md, `<docs-path>/architecture/` docs - check the user's TYPED ADDS from the walk (never the closure-locked rows, never the stack/evidence seeds - those are signal-backed) against them: an add whose PURPOSE conflicts with a stated convention gets ONE warning line quoting the rule verbatim (`warning: skill dotnet-architecture conflicts with AGENTS.md: 'NOT Clean Architecture / DDD / VSA'`) and one keep-or-drop consent. No citable conflict, no warning - unused-looking is not a conflict; no project docs, skip silently. A conflict warning never blocks the install - the user's keep is final.

## 11. Install

**First, report what the selection means - from the derivation, never in your own words.** Run
`node "$TMP/repo/scripts/derive-state.js" --selection "$TMP/selection.txt" --source "$TMP/repo" --scope <scope> >
"$TMP/state.json"` (the `<scope>` the installer call below takes - the routes are read as it reads
them) and render four lines from it, nothing added:

- `skills copied:` the count of `skills.library` - every picked skill is a copy in `.claude/skills`
  on every route, so a project can switch any one off (`skillOverrides`, or configure's drop).
- seats - when `routes.skills` is true, `seats: ride the core plugin - <n> picked` (the count of
  `agents.on`); otherwise `seats: copy route - copied into .claude/agents`.
- `seats switched off:` the seat names in `written.agentDeny` (`permissions.deny` entries - every
  seat the selection did not pick, since the core carries all of them; configure brings one back),
  or `none`.
- `hooks switched off:` the names in `written.hooksOff` (`ALFRED_CODE_HOOKS_OFF`), or `none` - on
  the hooks copy route a hook not picked is simply not copied.

`written` is the installer's own rule applied to the routes this environment runs, so it IS what
the install writes.

Then run the installer **from the snapshot**, and pass it back with `--source` so it installs from what you already downloaded instead of fetching again:

- **Any OS:** `node "$TMP/repo/scripts/install/alfred-code.js" install --source "$TMP/repo" --scope <scope> --selection "$TMP/selection.txt" [--space <name>] [--browsers <csv> --browser-enabled <csv|none>] [--docs-versioning git|local] [--data-path <folder>] [--github-cli]`
- **`ALFRED_CODE_SEED=shell`** - the resolve line reported `seed=shell` (`ALFRED_CODE_SEED`, or the 1.x `CLAUDE_STACK_SEED`, set to `shell`). The frozen OS twin names what a 2.0.0 registration cannot resolve, so it no longer runs: print `the shell installers were removed in 2.0.0 - unset ALFRED_CODE_SEED / CLAUDE_STACK_SEED to use the Node installer` and stop. <!-- legacy-name -->

`--docs-versioning` carries screen B's docs-versioning answer whenever screen B asked it: the installer then WRITES that decision instead of seeding a detected value, prints one `ALFRED_CODE_DOCS_VERSIONING <old> -> '<new>'` line instead of a seed line, and so leaves nothing for the re-probe below to touch.

No `--memory-level`: the level is init's question. The installer says so in one line (the notes
import waits for `/alfred-code:init`) and leaves Claude's own memory on - report that line, never a
switch-off.

`--source` is what makes the guided run take ONE download. The installer owns nothing here: it copies out of `$TMP/repo` and leaves it for you to remove at cleanup. It writes `.claude/alfred-code.stamp` recording the commit it installed (read from the snapshot's `RELEASE-SOURCE`) - that is what a later `/alfred-code:configure` diffs against.

The documentation server key is ACCOUNT-level, not project-level: when `CONTEXT7_API_KEY` is exported in the shell the installer runs in, the run writes it into the account `settings.json` env (at every scope - never through the chat). The key is optional - the hosted server answers without one at a lower rate limit.

Presence, never the value - run this and paste its lines as-is:
`node "$TMP/repo/stack/hooks/guard-secret-value.js" --presence "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" CONTEXT7_API_KEY`
(the same line runs on Windows - Claude Code's Bash tool is Git Bash, where `$env:USERPROFILE` is not a variable; a `--space <name>` install reads `~/.claude-<name>/settings.json`). Output is `KEY=set (N chars)` or `KEY=absent` - nothing else is ever printed; a shell dump of that file is rewritten by the same hook into its redacted view (every credential value shown as `<set (N chars)>`), and the Read tool on it is blocked.

Then apply the step-1 environment choices where they differ from what the installer left: a merge on the scope's settings file touching ONLY the chosen keys - every key screen B asked about (the catalog's rows, `env.` prefixed - but `ALFRED_CODE_DATA_PATH`, which the installer already wrote from `--data-path`) (plus `autoCompactEnabled: false` when the user chose 'off'; delete the pct override in that case rather than writing a dead value) - everything else in the file preserved. The installer seeds these only when absent, so the values written here are the user's and survive every later update untouched. An accepted default needs no write only where the FILE already holds that value, so read the block back after the install and compare: one row's seed is DETECTED from the repo rather than constant (its `what` says so), and there the catalog default and the seeded value can differ.

When the applied `ALFRED_CODE_DOCS_PATH` differs from what the installer stamped (the installer ran before this merge), re-stamp the deployed rule - run `node $TMP/repo/scripts/stamp-docs-root.js <project root>`: it rewrites the 'This install's root:' line in `.claude/rules/alfred-docs-root.md` from settings.json, so the always-on awareness matches the env; every later update re-stamps it too. Add `--reprobe-versioning <value>` to that same command when THIS run's install printed a seed line for the docs-versioning key, passing the value that line named (`git` or `local`): that seed was probed against the docs path the install ran with, and the flag re-reads it at the path just written. The script REFUSES when the file no longer holds that value, so a decision an earlier install wrote, or one the user chose on screen B and this step just applied, is never re-probed - pass the seeded value and let the check answer, rather than judging it here.

On a step-2 'set the default for this project' answer, merge `permissions.defaultMode: <value>` into the scope's project settings file (`.claude/settings.local.json` at `local` scope, else `.claude/settings.json`) - never the account file - touching ONLY that key inside `permissions` (`allow` / `deny` / `ask` / `additionalDirectories` and everything else in the file untouched). A 'keep it as it is' answer writes nothing.

### 11a. Plugin settings - apply the step-9 answer

The plugin is on disk only now, so this is where the answer lands: re-run the tool with `--apply`
(plus `--replace` when they chose to overwrite differing values) and paste the closing `applied:`
line. 'Skip' writes nothing and is not re-asked. Never hand-edit either file - the tool merges, so
keys outside the catalog and the plugin's own settings survive.

## Post-check + next steps - close every run with this card

**The card restates the OUTCOME of every step that took a decision** - one line each, in step
order, naming what was chosen and what it did ('git hygiene: `.git/info/exclude` - `.claude/`
ignored locally, nothing committed; `.alfred/` ignores its own machine state'). A decision the user made mid-run and the card
leaves out is a decision they ask about again (measured: a git-hygiene answer was stated once
mid-run, omitted from the close, and re-asked twice over four extra messages).

**The run closes on a suggestion card, never on a question.** The steps below that are the
USER's to run - the restart, the account-file credential line, `/alfred-code:init` - are listed
as suggestions, the one everything depends on first and each with
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

Report what still needs a hand: the browsers left unticked (installed but disabled - `/plugin` turns one on; on the MCP copy route the answer is not applied, every browser is a live `.mcp.json` server and `/mcp` switches it), and that the first `claude plugin install` may prompt to trust. The statusline itself needs no hand step - `/alfred-code:init` (item 2 below) sets it through `hud-statusline.js` and only names `/claude-hud:setup` when it finds a status line that is not claude-hud's and keeps it. Then, AFTER the summary, print the next-steps card - built from what THIS run actually installed, never naming a command whose skill is absent. The card ENDS on the restart and `/alfred-code:init` (item 2) - the one step everything else depends on. Name `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/post-install.md` as the durable copy the user can re-read later (it adds the gitignore semantics):

1. **Git hygiene (project mode - a no-repo directory skips it).** Suggest ignoring the machine-local artifacts this install creates - only entries that apply to the selection and are not already covered by the project's ignore rules: `.claude/` (the install + stamp), `.mcp.json` (installer-regenerated on every run - fix the template, never this file), plus runtime dirs when present in the tree (`.slopwatch/`, or a 2.0.0 `.serena/` / `.playwright/` not moved yet). The data root (`.alfred/` by default - the docs, the navigation index, browser profiles, a project memory database) needs no line: the installer wrote its own `.gitignore`, which keeps everything but the docs out of git. Show the exact lines first, then one AskUserQuestion with BOTH homes as options: the committed `.gitignore` (recommended), `.git/info/exclude` for a local-only ignore that touches no committed file, or skip; write only on consent.

2. **Restart, then `/alfred-code:init`** - restart Claude Code from the project root (MCP servers connect and skills, agents and rules are inventoried at launch; hooks and the settings.json env need no restart - they are live on the next tool call), then type `/alfred-code:init` in the NEW session: it installs what the kept MCPs need to start (uv, the pinned Python, csharp-ls, the picked browsers, the navigation-server index - one ask first; step 10's `init:` lines are the first reason when there are any), asks the memory level and imports the old notes, runs the captures this install carries, and offers the AGENTS.md fill. `claude mcp list` after the restart confirms the servers connected - one that timed out usually lacks what init installs.

## Clean up the temp dir - ALWAYS

Remove `$TMP` per `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md`, on EVERY exit path of THIS command: after a successful install, after an abort, and after a blocker or a user 'no' that stops the run early. Then confirm the project tree holds only installed artifacts.

## Do not

- Do not install the full set - always go through the walk, and never present a layer question without its `[step n/11 - <name>] ... · next: <name>` banner or without the full-catalog table (a partial table hides choices; a later 'want these too?' question is the failure this shape exists to prevent).
- Do not deselect a locked row on the user's behalf, and never drop one silently - the reason column is the answer, the reopen offer is the remedy.
- Do not paste tool output other than the decision tables, or run chatty per-file commands - the 'Narrate, don't trace' contract holds for the whole run.
- Do not call a skill this run just installed. Skills are inventoried at session start, so one written to disk seconds ago is not in the running registry and the call returns `Unknown skill: <name>` (measured) - a wasted round trip the reload item in the closing card already accounts for. The captures are `/alfred-code:init`'s, after the restart - name init in the card, never a capture.
- Do not skip a layer, the selection round, or the prerequisite gate. Do not write the archive, the extracted repo, or the working files into the project tree, and do not leave `$TMP` behind on any exit path. Do not commit anything on the user's behalf.
