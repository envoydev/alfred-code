# CLAUDE.md - Alfred Code repo

## What this repo is

The single source of truth for the **Claude Code** half of the house coding-agent setup - not an
application. It holds what is applied to *other* projects: house-style skills, the base instruction
template, hook scripts, convention rules, agents, and the installer that wires skills / MCP servers /
plugins into each project. The **Cursor** twin lives in
[`cursor-stack`](https://github.com/envoydev/cursor-stack), a sibling with its OWN skills, agents and
installers (it does not clone this repo, and its lists may diverge - e.g. it ships no `plugin-authoring`).
A change that maps to Cursor is mirrored there in the same sitting. Consuming projects pull from
here; a change made only inside a consuming project is throwaway.

**The goal every change serves: Sonnet at high / xhigh effort, run through this stack, does better
work than Opus at high effort without it.** Skills, rules, hooks, agents, docs structures and scripts
exist to close that gap - pre-digested context, deterministic scripts and hooks doing the navigation
and checking, small pushed slices instead of broad reads. Judge every design by that yardstick: does
it make Sonnet more correct, cheaper or more reliable? A feature that only pays off on Opus, or needs
the model to infer what a script could state, works against the goal. Prove it like any behavioral
change (see the invariants below).

## Layout - one home per concern

- `stack/skills/` - the house-style skills (`SKILL.md` each), auto-activating on their keywords /
  file types. The always closure rides the CORE plugin; every other skill and agent is LIBRARY -
  listed by no marketplace entry, copied into `.claude/skills` / `.claude/agents` per pick - and
  every rule is a library copy in `.claude/rules` the same way (`scripts/install/library.js`, each
  copy's hash in the stamp), because a plugin skill is locked on and only a project copy can be
  switched off per project (measured, the 2026-09-24 library test). `scripts/library-check.js`
  reports drift and staleness for validate and status; the core's SessionStart line
  (`setup-plugin/hooks/library-stamp.js`) says when the copies are older than the stack.
  `ALFRED_CODE_SKILLS_VIA_PLUGIN=false` restores the 0.2.x copy route.
- `scripts/install/` - THE INSTALLER, and the ONLY route: `alfred-code.js` is the entry, one module
  per layer beside it (`args`, `brand`, `source`, `manifest`, `selection`, `library`, `copy`,
  `settings`, `env-migrations`, `plugins`, `mcp`, `docs`, `serena`, `memory`, `seeds`, `pins`,
  `stamp`, `uninstall`, `runtime`), plus `claude-stack.js`, the entry shim a 1.x command body still calls against <!-- legacy-name -->
  a 2.0.0 snapshot (it runs `alfred-code.js`; keep it listed so it is never deleted as unlisted
  before the 2.x line ends). One `node` command on every OS, so no OS branch in the command bodies. The
  frozen shell twins are deleted (2.0.0) and `ALFRED_CODE_SEED=shell` refuses with one line.
  `meta/stack-manifest.json`, hand-edited, is the one source of the six lists the seed reads;
  `docs/alfred-code.html` is the browser inventory (lint check 60 runs `node --check` over its inline
  script: an unescaped quote in one row string left the page with no tables).
- `stack/CLAUDE.template.md` - the stack-neutral per-project skeleton a consuming project's
  `CLAUDE.md` is filled in from. Conventions ship separately in `stack/rules/baseline-*.md`. Its
  authoring outline (Setup and Key files among it) and keep-out list say WHAT a CLAUDE.md holds; the
  core's `alfred-capture-claude-md` skill is HOW, the one home of the fill (create, or improve with
  every change shown first, a separate part getting its own `<part>/CLAUDE.md`) - `/alfred-code:init`,
  `update` and `configure` follow it inline; and `scripts/claude-md-check.js` is the verdict it closes
  on: every named path exists, every command's program resolves on PATH or in the project, no
  placeholder, `TODO` or template text is left, and an installer seed still unfilled is named
  (`--list` marks it). Validate runs the check for drift. Its rows are heuristic (measured 2026-09-26
  over four real projects: 39 rows with 1 true, 7 rows once the shapes behind the rest were fixed), so
  no ask marks a check-driven fix recommended - the skill offers each one and the user picks.
- `stack/hooks/` - seventeen hooks, folded INTO the core `alfred-code` plugin (2.0.0 - there is no
  hooks plugin). Nothing is copied or wired per project except the three engines (`docs.js`,
  `memory.js`, `history.js`) and `model-windows.json` in `.claude/hooks/`, because 22 bodies shared
  with cursor-stack run `node .claude/hooks/docs.js` (and the history block points at `history.js
  rulings`). The core's hooks block is GENERATED from the manifest's `hooks[]` table after the core's
  own two per event (`mergeHooks`, lint check 48); every hook carries `"timeout": 10` (a hook with none
  gets Claude Code's 600s) except `check-turn-build.js`'s 60 on its `Stop` wiring and `shell-guards.js`'s 80, from the
  `HOOK_TIMEOUTS` table (per file, per event) the seed writes, and launches as `node "${CLAUDE_PLUGIN_ROOT}/<file>"` (a bare path needs the exec bit, and
  never runs on Windows). `ALFRED_CODE_HOOKS_VIA_PLUGIN=false` restores the 0.2.x copy route (the
  core's copies stand down for the wired ones); the walk writes the hooks it did NOT pick into
  `ALFRED_CODE_HOOKS_OFF`. The five gates live in `hook-prelude.js`, never inlined: the csv opt-out;
  the core's `hook_profile` userConfig (`/config`, account-level; `minimal` keeps only the rm, secret
  and force-push guards, `strict` reads `ALFRED_CODE_TURN_CHECK` as on, the csv still wins);
  the plugin copy standing down beside a still-wired copied twin; a repo never set up (no install
  record in it, its git top level or - for a git worktree - its main checkout, so a worktree of an
  installed checkout counts as set up; under a user-scope core such a repo is written nothing and only
  the rm, secret and force-push guards stay live, writing no row - R54, R86); and the 1.x ALIAS - a
  hook launched from a `.../claude-stack/<version>` root stands down while settings enable an <!-- legacy-name -->
  `alfred-code@*` its `installed_plugins.json` row can load (S26). All fail open.
  The fresh-session arithmetic (trigger per window tier, window lookup, cold floor) lives in one
  engine, `fresh-session.js`, which the two fresh-session hooks and the monitor require from their
  own directory; a hook that runs before it lands keeps every offer off. `shell-writes.js` parses a
  shell command's writes for the cross-project guard and the done gate. The eight guards with a
  `Bash|PowerShell` row are wired as ONE hook, `shell-guards.js` (R11; both generators fold the rows,
  `wiringRows`): each guard runs in-process with its own gates and ledger row (its `global.BLOCK_DETAIL` cleared before and after it), every block reason
  reaches the model, a throwing guard fails open alone.
  Every guard appends one row per BLOCK to `<docs-path>/hook-blocks/<session>.jsonl`
  (`analyze-usage.js --hook-blocks` tallies it) - the block RATE is what says a gate earns its keep.
  A denial that needs the user's decision ends in ONE AskUserQuestion, and an 'allow' answer is
  honoured through a `<docs-path>/flow/*-ALLOW` receipt (this session's own, under 8h).
  - `guard-protected-force-push.js` - blocks force-push to protected branches.
  - `guard-catastrophic-rm.js` (PreToolUse `Bash`) - a recursive `rm` of an unrecoverable target, and
    EVERY git call in the command, read from its argv (flags anywhere, a tree-ish before the paths): a
    path `checkout` / `restore` of the working tree / `reset --hard` / a forced `checkout` or `switch` only
    when the PATHSPEC it names is dirty (judged where git runs: cwd, a leading `cd`, `-C`; `status -z`, so
    a non-ASCII name reads as written; an untracked file counts only when the target tracks it, `-` being
    the previous branch), `clean -f` by its own `-n` dry run (ignored files included), plus
    `stash drop` / `stash clear` / `reflog expire` / `prune` / a `gc` given a prune date or a `-c gc.*Expire`
    by what they destroy; one block names every loss. PowerShell `Remove-Item -Recurse`
    counts. A SQL `DROP` or `dotnet ef database drop` writes a log-only probe row. A 'discard it' answer
    is honoured via `<docs-path>/flow/DISCARD-ALLOW` (paths, `stash@{N}`, or `*`).
  - `guard-read-whole-file.js` (PreToolUse `Read` + `Bash`) - blocks whole-file dumps (also through the
    shell, any oversized file, a sweep over `.md` files). An unexpanded `$VAR` target is not judged; a
    leading `cd` moves the anchor; a counting expression is not a dump. Every denial carries the
    `ToolSearch select:` line that loads the navigation server's tools.
  - `guard-secret-value.js` (PreToolUse `Read` + `Bash`) - credentials are read for PRESENCE, never
    value. Judged by file CONTENT (a JSON/dotenv file holding a `secret_key_pattern` key with a live
    value). On the shell route the dump / `echo $SECRET` / bare `env` are REWRITTEN via
    `hookSpecificOutput.updatedInput` to redacted forms (`--redacted <file>`, `--redacted-env`); the
    Read tool and a credential literal stay blocked. A rewrite drops the rest of the command, so one
    carrying a CHANGING step (an edit, a redirect, a build) is blocked instead; a filtering read (`grep`,
    `jq .path`, `head`) keeps its filter over the view. A connection-string / URL password and a PEM
    private key count as credentials whatever the key. `--presence <file> [KEY ...]` is the sanctioned
    one-key read. 'Show' is honoured through the `<docs-path>/flow/SECRET-READ-ALLOW` receipt.
  - `guard-unapproved-dispatch.js` (PreToolUse `Task|Agent`) - blocks an `*-implementer` dispatch
    without the `<docs-path>/flow/APPROVAL` gate file (written on explicit approval or an AUTO waiver),
    blocks a generic `general-purpose`/`claude` dispatch while that stamp is live (stamps older than 8h
    or the session are absent), and blocks an `Explore`/generic dispatch asking a SYMBOL question. An
    `Explore` / `Plan` brief gets the untrusted-content sentence appended (`updatedInput`, never a deny).
  - `guard-ungated-commit.js` (PreToolUse `Bash`) - blocks a non-trivial `git commit` without the
    `<docs-path>/flow/COMMIT-GATE` receipt, and `git push` / `gh pr merge` without `PUSH-GATE`. A dry
    run or a branch level with upstream is never gated; `ALFRED_CODE_PUSH_GATE=0` turns the push half off.
    Both are judged in the repo git runs in (the shell's cwd, a leading `cd`, `-C`) - a worktree is its own.
    A PUSH-GATE receipt spanning more than one MANIFEST-owning directory needs a `scope:` line naming
    what the probe actually ran (a plain top-level folder is no project, so an ordinary repo never asks).
    Every commit, trivial or not, first gets a scan of the lines it ADDS (the index, plus what `-a` or a
    chained `git add` takes in; a commit NAMING paths, the working tree of those paths - alone under
    `--only`, on top of the index under `--include`; at most 2MB, a binary file or one past the cap
    skipped, and past the total the scan stops reading but keeps its hits): a conflict marker, a debugger, a focused test, a
    credential-shaped literal or a hidden character (`hidden-chars.js`, the lint's class; a byte-0 BOM
    passes, and so does a joiner or direction mark a script needs) blocks, and no COMMIT-GATE receipt opens it - a hit meant to land goes
    through one ask and `<docs-path>/flow/STAGED-SCAN-ALLOW` (`file:line`, a file or `*`).
  - `guard-stop-contract.js` (`Stop` + `SubagentStop`; INJECTION-ONLY, never denying: PreToolUse `AskUserQuestion`;
    LOG-ONLY: `PostToolUse` + `PostToolUseFailure` on the shell tools) - blocks a turn ending on a decision-shaped question in prose (the quality
    loop's mode and stage-close asks worded as statements included), or a 'done, next step pending' close; holds ONCE a subagent that stops on a wait nobody will end ('I'll wait for...' or its own
    ScheduleWakeup) with no background work of its own; a close saying the RUN has nothing pending (the pinned line in shared-rules.json) is
    finished. Credential branch: asks for rotation ONCE per exposure (`ALFRED_CODE_ROTATE_ASK=0` off).
    Three LOG-ONLY probes (2026-09-25 - the habits skills lean on their descriptions and the flows that load
    them, and the misses are counted, never held or injected): a done claim over a turn's source edit
    (file tool or shell write) writes one `done-gate` row per turn - `unrun` when nothing ran after the edit,
    with the skill load, the project's test markers and any instruction line against running tests
    (`ALFRED_CODE_DONE_GATE=0` off) - and the first red build or test run of a streak writes one
    `root-cause` row (one streak per actor) that `analyze-usage.js --hook-blocks` resolves against the
    transcript: the skill loaded before the next fix, in context, after it, or MISSED. A close dismissing a
    failure ('pre-existing', 'unrelated to my change', 'flaky', 'skipping tests for now') in a turn with a red
    run, a skipped test or an added skip marker writes one `rationalization` row per turn.
    Fresh-session offer on a clean close past the window's ABSOLUTE trigger:
    `ALFRED_CODE_FRESH_SESSION_200K` (default 150000), `_1M` (400000), `_DEFAULT` (180000, any other or
    unreadable window); `0` switches that case off; seeded absent-only. The window comes from ONE table (the session
    model's row in the shipped `model-windows.json`, else `ALFRED_CODE_DEFAULT_CONTEXT_WINDOW`, seeded 1000000; no id
    suffix, carry or compaction is read), never declared. A trigger at or above its window is clamped
    inside it, and `_DEFAULT` must stay below the smallest window it can land on. The offer fires only
    when a resume recovers something (carry minus the session's first-message floor >= 40% of carry),
    re-arms at 1.5x growth, and never mid-response. A long-idle or long-span session takes the same
    offer under the window (`ALFRED_CODE_FRESH_SESSION_AFTER_HOURS`, default 2, unseeded, `0` off).
  - `guard-fresh-session-start.js` - denies the MODEL's own PreToolUse `Skill` call on a
    `disable-model-invocation` skill (read from its frontmatter; the user's slash turn is untouched), and
    offers a fresh session before a deliberate orchestration run (capture, loop, solve flow, review,
    guided walk) when the context is past the window trigger OR (slash route only) this session already
    TYPED a run - a Skill call is a phase of a run in flight, and harness-written user rows are no turn. Routes:
    PreToolUse `Skill` BLOCKS; `UserPromptSubmit` INJECTS for slash-invoked runs (never denies - that
    would erase the prompt); `SessionStart` matcher `compact` injects the ask plus two lines: answer in
    the language of the user's prompts, and re-read a live plan file's header first. `PreCompact` writes
    `<docs-path>/flow/COMPACT-STATE` first (the live plan, the open flow stamps with their ages, the
    files this session wrote, no model call), and the compact start points at it - even with every
    fresh-session offer off.
  - `guard-cross-project-write.js` (PreToolUse `Write`/`Edit`/`NotebookEdit`/`Bash`) - a write outside
    the project root is blocked (file tools and shell routes: redirection, `tee`, in-place `sed`/`perl`,
    `cp`/`mv` destination, `rm`/`mkdir`/`chmod`, `git -C <other>` mutating, `cd <other>` then a write);
    the change goes to a task card under `<docs-path>/cross-project-tasks/`. Reading stays open. Session
    scratch, `~/.claude` / `~/.claude-<space>` and `/dev` stay writable; paths compared as REAL paths; a
    Git Bash mount path (`/c/...`, `/cygdrive/c/...`) is translated first (the same regex is inlined in
    five hooks, pinned as `gitbash-mount-path`). 'Allow' is honoured through the
    `<docs-path>/flow/CROSS-WRITE-ALLOW` receipt; `ALFRED_CODE_ALLOW_WRITE_OUTSIDE` opens a second
    tree permanently. Also carries the log-only fork-liveness PROBE (`mode: probe` rows, denies nothing).
  - `guard-config-protection.js` (PreToolUse `Write`/`Edit`/`MultiEdit`/`NotebookEdit`/`Bash`/`PowerShell`) - a
    check is never made green by weakening the check: a change to a lint / format / analyzer config that
    ALREADY exists (eslint, prettier, stylelint, biome, `.editorconfig`, a ruleset) is blocked, and in
    tsconfig / MSBuild files only a change to the strictness keys (compared as key=value pairs, so any
    other edit passes). Creating a config passes; the shell routes are the in-place edit, redirect, `tee`,
    `rm`, `mv` and a `cp` onto it. 'Allow' is honoured through `<docs-path>/flow/CONFIG-EDIT-ALLOW` (a
    file, its basename or `*`); `ALFRED_CODE_CONFIG_PROTECT=0` turns it off.
  - `monitor-session.js` (`PostToolUse` on every tool + `UserPromptSubmit`) - a live monitor that never
    denies: one actor running the same tool with the same input 5 times in a turn, more than 20 distinct files
    written in a turn, the context at 80% of the fresh-session trigger (read from `fresh-session.js`, once per
    session). Each note is one `mode: monitor` row in the hook-blocks ledger; `ALFRED_CODE_MONITOR` is seeded
    `log` (rows only, the observation week), `inject` hands the note back as `additionalContext`, `0` is off.
  - `check-turn-build.js` (`PostToolUse` on `Write|Edit|MultiEdit` + `Stop`) - seeded OFF
    (`ALFRED_CODE_TURN_CHECK=0`; `1` turns it on per project after a measured week - validate and status
    paste `analyze-usage.js --turn-check-advice`'s one row at 3 unchecked done claims in the newest 10
    sessions, never setting it). The PostToolUse half
    lists the turn's written paths in `<docs-path>/flow/turn-edits-<session>`; at `Stop` it runs ONE scoped
    check per nearest root - the project's own `tsc --noEmit -p` for TypeScript, `dotnet build --no-restore
    -v q` for C# - and hands the first 20 error lines back as a block, once per turn (the continuation Stop
    passes). A missing compiler or a timeout is a pass.
  - `guard-answer-length.js` (`UserPromptSubmit` + `Stop`) - injects the answer budget every turn; the
    Stop half blocks prose past 1800 chars when the user asked for no depth, and blocks an em-dash in
    prose at any length. After the third consecutive short correction following a long answer it injects
    the format ask (injection only). A correction turn (short, after an answer, carrying a correction marker -
    the test the analyzer shares, `correction-turn-test`) writes one `correction` probe row;
    `ALFRED_CODE_CORRECTION_NUDGE` is seeded `log`, `inject` adds the memory-save line, `0` is off.
  - `instrument-tool-usage.js` - wired env-gated: skipped unless `ALFRED_CODE_INSTRUMENT` (seeded "0")
    is "1".
  - `docs-session.js` (`SessionStart`, `SubagentStart`, `SubagentStop`, PreToolUse on Read/Edit/Write/MultiEdit/NotebookEdit/Bash/PowerShell/Grep/Glob, `Stop`) with its engine `docs.js` (copied beside it, not wired) - every docs DOMAIN (a top-level folder under the docs root holding a `watch.json`, plus the grandfathered `architecture/`) follows the branch, and HOW is declared at install time in `ALFRED_CODE_DOCS_VERSIONING` (`--docs-versioning` writes it; absent, ONE rule seeds it and is the engine's fallback, in three homes - `install/docs.js`, `stamp-docs-root.js`, `docs.js` - pinned by one table-driven test: `local` only when the docs are kept out of git - no domain tracked, and a domain exists or git ignores the docs root - else `git`, a fresh project included): `git` means the docs are committed and git versions them per branch, `local` means per-branch section overlays under `<docs-path>/.branches/`, folded into mainline at the first mainline session after the branch merges. The setting WINS over what the repo does, and a disagreement is reported in `status` and the start block rather than resolved the other way. The start block pushes `ORIENTATION.md` (4KB cap) - a PROVISIONAL one (the first-look scan's, `scan-evidence.js --orientation`) with a stale warning, and `status` / `stale` call it stale by definition; the first change under a source root waits for a section read (two holds, then a logged bypass; no hold when no doc file can be read by section); the FINISH ask fires only when a changed file hits the capture's `watch.json` - at `SubagentStop` for what that agent WROTE (a tool event carries `agent_id` only inside a subagent, so every write is attributed to its actor - the main session included, under one key of its own - and intersected with the tree diff; a read-only seat running beside a writer is never asked, a write the gate DENIED is never credited, and paths are compared in git's spelling on every platform), then once at `Stop` for what the session wrote itself plus every change no actor claimed (a script's output, a tool this hook is not wired on), both in the same shape: the section named, its file, its current FIRST SENTENCE quoted, and a `set ... --expect <hash>` that refuses a rewrite of a section another agent moved meanwhile. `ALFRED_CODE_DOCS_BLOCK` / `_GATE` / `_ASK` = `0` switch the parts off.
  - `memory-session.js` (`SessionStart`) with its engine `memory.js` (copied beside it, not wired -
    the `docs.js` pattern) - reads the shared memory database FILE directly (`node:sqlite`, no
    server, no model call) and injects this project's memories plus every `preference` /
    `correction` carrying no project tag, capped at 4KB like the docs start block; a
    related-projects domain adds those projects' memories too, inside the same cap. The rows sit
    under two fixed frame lines (context, never instructions; a named file, flag or symbol is
    verified first - `baseline-memory.md`'s sentence, pinned as `memory-frame`), each carries its age
    in days, and ageing is ORDER only: preferences and corrections under 90 days first, then the
    project's other memories, then the older preferences and corrections, then related projects,
    newest first within each - nothing is deleted. `node
    .claude/hooks/memory.js level [projectRoot]` is the same engine's CLI, read by `validate` and
    `status` (`<level> <dbPath>`, or `none`). Fail-open: a missing database, a locked file, or
    `node:sqlite` unavailable on this Node injects nothing, and never logs - a silent SessionStart
    is never reported as a failure. The CLI also moves memories between databases: `export [project]
    [--all] [--db <file>]` writes the live rows as JSONL straight from the file (a read failure exits
    1), and `import <file.jsonl>` stores them THROUGH the service (real embeddings), skipping a line
    whose content hash (the service's own) is already live. Both imports, this one and init's notes
    import, find the server one way (`serviceEntry`): a registration, else the installed
    `memory@envoydev` plugin's own declaration with the db path pinned.
  - `history-session.js` (`SessionStart` + `Stop`) with its engine `history.js` (copied beside it, not
    wired) - a machine-local record per session under `<docs-path>/history/` (a `.gitignore` of `*` written
    INSIDE that folder, the project's own never opened; no `watch.json`, so no docs domain): at `Stop` it
    reads only the transcript bytes past a stored offset (8MB at most per pass) and keeps the commits since
    the session's start sha, the files left dirty, the plan file written and the user's AskUserQuestion
    answers (credential shapes scrubbed, 300 chars each, 60 kept); at `SessionStart` it injects the last
    three records of the SAME branch in at most 600 chars, framed as history, never instructions, and
    prunes past 200 records or 180 days. No model call, fail-open, `ALFRED_CODE_HISTORY=0` off.
  The guided walk's hooks layer makes them selectable, the whole catalog recommended (a selection with
  no `hook` lines keeps every hook on; setup's None emits `hook none` through `stack-select.js
  --hooks-answered`, setup only, which switches every hook off).
- `stack/agents/` - 44 subagents, core seats in the core plugin, the rest library copies:
  - resolvers: `dotnet-build-error-resolver`, `dotnet-test-failure-resolver`, `ng-build-error-resolver`,
    `angular-test-resolver`;
  - cross-cutting: `alfred-issue-diagnoser-ci`, `alfred-issue-diagnoser-runtime`, `security-auditor` (read-only
    OWASP/CWE posture audit), `integration-reviewer` (mandatory read-only cross-domain final gate
    against the frozen contract);
  - 30 per-domain seats - `<stack>-solution-designer` -> `<stack>-implementer` -> `<stack>-verifier`
    across 10 stacks (ASP.NET, web Angular, WPF, WinForms, console, Windows Service, Ionic Angular, data,
    DevOps, browser extension);
  - six read-only support seats: `evidence-gatherer`, `test-coverage-analyzer`,
    `architecture-analyzer`, `code-quality-analyzer`, `code-style-analyzer`, `related-project-analyzer`.
  Pins: resolvers `sonnet`/`high`, designers `opus`/`xhigh`, verifiers `sonnet`/`xhigh`, implementers
  `sonnet`/`medium`, support seats `sonnet`. Captures are deliberate-only
  (`alfred-capture-architecture` writes `architecture/ARCHITECTURE.md` and
  `baseline-project-architecture.md`; the findings go to `alfred-capture-architecture-quality`
  (`quality/ASSESSMENT.md`), the code's to `alfred-capture-code-quality` (`quality/CODE-ASSESSMENT.md`); never in a build flow).
  `alfred-task-solve-cross` is the single entry-point orchestrator (single-stack vertical per
  `references/domain-trio-protocol.md`; cross-domain runs freeze the contract and end at
  `integration-reviewer`; two tasks sharing a directory run as `isolation: "worktree"` seats, which
  branch from HEAD because the installer seeds `worktree.baseRef: "head"` add-only, and fan in as an
  uncommitted `git apply`). cursor-stack shipped twins of all 44 before this rebrand and is PENDING
  the same rename while its mirror is paused - a protocol change here usually needs the same edit
  there once it resumes (divergences only: `model: inherit`, no `tools:` allowlist, no auto-delegation
  hard-disable).
- `stack/rules/` - twenty single-job rules, each a library copy in `.claude/rules/`. Seven always-on `baseline-*.md`
  (no `paths:`): interaction, quality-gates, security, git (the commit checkpoint itself is the
  `alfred-habits-commit-checkpoint` skill), navigation, docs-root (`ALFRED_CODE_DOCS_PATH` is the ONLY lever;
  the installer stamps its value over `__DOCS_ROOT__` on every run),
  memory (what belongs in the shared `memory` MCP, when to save it, and to search before asking or
  reading - locks the server in the way `baseline-navigation` locks the navigation server).
  Skill/agent usage policy + MCP routing live in the GENERATED `baseline-project-agent-capabilities.md`.
  Thirteen path-scoped: `markdown-docs.md`, `skill-authoring.md`, the repair routers
  (`dotnet-repair-agents.md`, `angular-repair-agents.md`) and nine convention rules, each
  glob-attaching ONE file family to its house-style skill. Every convention rule uses the imperative form pinned as
  `convention-rule-first-action` in shared-rules.json - a new one copies that form, never paraphrases it.
- `setup-plugin/` - the Alfred Code plugin: seven COMMANDS and one router SKILL.
  - `/alfred-code:setup` is the selection walk and the install (reports `derive-state.js`'s `written`
    block first) and ends on 'restart, then /alfred-code:init'; `/alfred-code:init` is the one-time
    bootstrap in the new session (`init-plan.js`: the machine installs behind one ask, the memory level
    - `scripts/install/memory.js init` imports Claude's old notes, switches its own memory off and
    writes the stamp's `initialised:` line - the captures, the CLAUDE.md fill through
    `alfred-capture-claude-md`). `/alfred-code:update`
    refreshes and prunes from the stamp compare (its ONE ask offers what the release ADDED -
    `update-preflight.js`'s `new:` lines, classified by `derive-state.classifyNew`; a yes is
    `--add '<category> <name>'` on `--installed-only`), `/alfred-code:configure` adds or drops through
    the walk it shares with setup (`setup-plugin/references/walk.md`), `/alfred-code:status` (read-only, no snapshot: general info, a
    health column from the CLI's own error fields, usage from `analyze-usage.js --inventory`, plus the
    install's always-on FLOOR, the stack's share counted by `derive-state.js --floor`), `/alfred-code:validate`
    (project-relative two-way reconcile via `stack-select.js --redundant` / `--missing` /
    `--evidence-gaps`, plus the settings.json `env` layer against `environment.json`, and a read-only
    install audit at its post-check - `scripts/audit-install.js` rows on unpinned launches, wide shell
    grants, hook wirings and credential literals, pasted before one ask, never auto-fixed, and the
    CLAUDE.md check - `claude-md-check.js` rows offered to the skill's improve mode, no option recommended), `/alfred-code:uninstall`
    (the seed's `uninstall` over the stamp's ledger, below; user-scope plugin rows and MCP registrations printed, never run). In a git
    worktree of an installed checkout every command stops and names the main checkout.
  - configure and validate never inventory by hand: `update --installed-only --print-plan --plan-out`
    writes the installer's own read-back as their `--installed` JSON (with `left_out` - denied seats,
    items of a parked retired entry - and `parked_plugins`, so the walk's closure cannot switch either
    back on), and they apply as `derive-state.js --delta` lines turned into `--add` / `--drop` over the same
    read-back. A drop runs BEFORE the closure: one something kept requires, or a locked always-on rule
    or server, is logged 'not applied'; a dropped core seat is denied, a dropped hook named off, a
    dropped library copy deleted (a copy-route hook unwired too), and an MCP entry nothing kept needs
    is disabled at the run's own scope and route - never the core (which carries the hooks) or the
    three locked servers.
  - The seed prunes only the names in `meta/stack-manifest.json`'s `retired` block (skills, agents,
    rules, hooks, mcps, plugins) - add a name there when any of the six is renamed or removed (a
    stamp compare only names what left after the stamped commit). A renamed skill or seat also gets
    a `renamed` row (old -> new): update maps picks, denies, `skillOverrides` and selections by it.
    A retired PLUGIN also gets a
    `meta/retired-plugins.json` row (`retiredIn`, `addBack`): update uninstalls it only as
    `name@<row's marketplace>`, else `name@<stack key>` (`retiredSpec`), keeps a row at another scope
    and prints the add-back line - the path the five cut MCP servers took. An entry that CARRIED picks (the per-stack entries retired in 1.3.0) is named
    only in `meta/retired-entries.json`, since update copies its picks first. On the plugin routes the
    seed also prunes every shipped COPY a plugin now carries. A retired pathless rule, hook wiring, MCP
    registration or plugin costs every session until pruned; a shipped-but-unneeded one is validate's
    whole-stack-absent pass, not a retirement.
  - The `/alfred-code` router is a SKILL and the workers are COMMANDS on purpose (commands list
    namespaced, skills list bare) - do not convert either back.
  - Table before question: `hooks/guard-layer-table.js` (PreToolUse `AskUserQuestion`) denies an ask
    (up to 3 times per table) whose decision table was run but never pasted - a `stack-select.js
    --table` catalog, the `plugin-settings.js` report or validate's install audit. It ships in the plugin because a fresh setup
    has no stack hooks yet; the rule text is pinned as `table-before-question`.
  - None of the seven carries `allowed-tools` - settled: it is a per-turn permission pre-approval, not a
    restriction or a context saving.
- `meta/` - never installed:
  - `shared-rules.json` pins every deliberate multi-home rule (owner + marker-pinned copies); the lint
    goes red when a copy's marker breaks.
  - `stack-graph.json` - generated dependency graph read by `stack-select.js`; regenerate with
    `npm run graph` (lint fails when stale).
  - `plugin-entries.json` - the GENERATED core entry, computed by `scripts/build-marketplace.js` from
    the placement rule in `scripts/plugin-placement.js`: the core is the always closure plus every
    stack hook, every other item is library. Regenerate with `npm run marketplace`; lint checks 44 and
    45 fail when the file is stale, a second plugin appears, or an item has no home or two. The live
    marketplace also lists the two 1.x ids as RETIRED aliases (`aliasEntries`, from `brand.js`
    `LEGACY`): the core under its old name, and the old hooks id carrying nothing. No `renames` key -
    a rename strands a 1.x install, a listed id refreshes in place (`docs/rebrand-evidence.md` S11,
    S21); lint 49 fails on a `renames` key or an `alfred-code-hooks` entry.
  - `retired-entries.json` - the 20 per-stack entries 1.2.0 shipped, FROZEN and listed under a RETIRED
    description until evidence shows no install still resolves through them, never on a release cadence
    (an unlisted entry still enabled silently stops loading, `docs/rebrand-evidence.md` S25; lint 49 counts
    them as generated), so an installed one keeps working
    until update copies its picks and uninstalls it (leaves first); a PARKED one, or one at another
    scope, is kept and logged with its uninstall command. The FILE stays while the names are retired:
    it is the only record of what each entry carried.
  - `evals/library/` - one `claude plugin eval` case per stack profile, graded `arm: both`;
    `npm run eval-bundle -- <out>` puts the core and the whole library into ONE plugin named
    `alfred-code` so the eval CLI can load a library item. The run is billed.
  - `environment.json` - the ONE list of settings.json `env` values the stack owns; adding a variable is
    one row plus the seed's own (lint check 58 - not check 27, which is the `suggests:` removal
    check below).
  - `recommendations.json` - seeds + the never-flag `general` list (project-conditional opt-ins, e.g.
    `alfred-capture-related-projects` / `related-project-analyzer`: addable, never seeded or re-added); its
    `notes` give an opt-in row nothing selects its walk-table why.
  - `evidence.json` - need-signals `scripts/scan-evidence.js` matches against manifests; evidence rows
    arrive pre-selected, absence is advisory, evidence never creates a `required` lock.
  - `plugin-settings.json` - recommended config for INSTALLED plugins, applied by
    `scripts/plugin-settings.js`: walks report and ask in the plugins layer turn, apply after install;
    add-only by default (`--replace` overwrites); each row names the verified plugin VERSION (lint 28).
  - `model-prices.json` - the list prices `analyze-usage.js` bills its cost row from, with the source page and
    fetch date inside; refreshed from that page, never from memory (a unit test pins the page's multipliers).
  - `judgment.json`, `migrations.json` - existence-detected retirements of GENERATED artifacts plus the
    `env` RENAMES the env pass applies every run (order pinned as `env-pass-order`). A renamed key is read
    under its old spelling as fallback until every install has it (e.g. `ALFRED_CODE_DOCS_PATH`,
    ex-`CLAUDE_DOCS_PATH`).
  Commands reach `meta/` through the run's snapshot (`$TMP/repo/meta/`), never `${CLAUDE_PLUGIN_ROOT}`.
- `scripts/lint-skills.js` - the parity lint. `scripts/analyze-usage.js` - offline token/tool report over
  a session transcript (+ `subagents/`), with an EFFICIENCY scorecard (one measured number per practice);
  it reads `PowerShell` as a shell route, writes with `--out <file>` (never a `>` redirect), and
  `--check-report <file>` re-reads a finished report, printing every judgment number that cites no
  machine row of that same report. Its rollup skips the live session (`CLAUDE_CODE_SESSION_ID`,
  `--exclude-session <id>`) and counts a plugin only where a registry record reaches or it was used.
  `scripts/claude-md-check.js` - a project's CLAUDE.md files against the tree they describe, read-only
  and no model call. `scripts/scan-evidence.js` - deterministic manifest-only
  evidence scan; `--orientation` prints the provisional `ORIENTATION.md` the `alfred-capture-first-look` skill writes. `scripts/skill-comply.js` - grades whether a skill's steps were followed in a transcript (`check` / `grade`, offline, over the expectation files in `meta/skill-comply/`); `replay` runs the fixtures through `claude -p` only on `--live`, which is billed; `compare` applies the A/B ship rule over two replay outputs (a step failing on both arms is INCONCLUSIVE, never not-worse; one graded by nothing offline is NOT GRADED). `README.md` stays compact (headline counts lint-checked; inventories live in the HTML).

## The stack's delivery surfaces

All surfaces come from ONE source snapshot per run, so an install is a single revision (the one
`alfred-code.stamp` records).

| Surface | Delivery |
|---|---|
| Skills | the core plugin (`alfred-code@envoydev`, the always closure) plus LIBRARY copies of every other pick in `.claude/skills`, hashed in the stamp; `library-check.js` reports drift and staleness |
| MCP | the 9 generated `<server>@envoydev` plugin entries the project's closure reaches (`build-marketplace.js --mcp-entries`), plus the six pre-2.0.0 ids listed as RETIRED aliases for installs not yet updated; `ALFRED_CODE_MCPS_VIA_PLUGIN=false` restores `claude mcp add` -> `<repo>/.mcp.json` with its drift verify |
| Plugins | 2 OPTIONAL third-party picks (`claude plugin install`), the `*-lsp` pair, each suggested on evidence (`meta/evidence.json`) (`superpowers` left them in 2.0.0, never touched - R109; claude-md-management and security-guidance were RETIRED in 2.0.0 on the user's call, 2026-09-26, superseding R27 - `meta/retired-plugins.json`: the first update past 2.0.0 uninstalls each as `name@claude-plugins-official` at this run's scope and prints its add-back line, a row at another scope kept and named; a row put back after it is the user's own, `plugins.retirementDue`) - plus the REQUIRED `claude-hud` (user scope - its status line is account-wide), installed beside the core every run (`CORE_DEP_PLUGINS` = the manifest's parked rows, lint 51), never re-enabled once the user disables it (`install` would - measured on 2.1.282), statusLine + compact layout set by `/alfred-code:init` (`hud-statusline.js`) - plus the core. The core declares NO `dependencies`: `plugin update` installs none a release adds, a plugin missing one is disabled at load (measured on 2.1.280). Every run refreshes each marketplace its specs name once, reads each plugin as `name@marketplace`; install updates one already listed, update installs an absent one, enables a parked one, then updates, at the scope `claude plugin list --json` reports; `--installed-only` reads back only ENABLED stack entries (the core always is) |
| Hooks | folded into the core `alfred-code@envoydev` plugin (all seventeen, generated from the manifest's `hooks[]`); only `docs.js` / `memory.js` / `history.js` / `model-windows.json` are copied; instrumentation off via ALFRED_CODE_INSTRUMENT=0 |
| Agents | core seats in the core plugin, unpicked ones denied as `Agent(alfred-code:<seat>)` in the project `permissions.deny` (the copy routes write none - absence is off); every other seat of the 44 is a library copy in `.claude/agents`, and a retired entry's seat deny gains the core spelling, and keeps its own while that entry is still installed (Claude Code matches the exact home name), so the seat stays off |
| Installer | `node scripts/install/alfred-code.js <install|update|uninstall>` from the snapshot, one command on every OS |
| Install stamp | `alfred-code.stamp` in the project's `.claude/` at EVERY scope - source commit, `picked-skills` / `picked-agents` (only the PICKS, as `name@home`: `--installed-only` unions them back so an item a release moves is kept; a stamp with neither line takes what the enabled entries carry), `library-skills` / `library-agents` / `library-rules` (`name=<sha256>` of each copy as written), `stood-down` (what the full copy route switched off here, `<scope>:<spec>` - the one thing a switch back enables), the LEDGER `managed-env` / `-deny` / `-hooks` / `-mcp` / `-files` (what the run wrote, each at its hash and in the FILE it was recorded for - a move off `local` carries a deny row into settings.json only where that file did not hold it before, and with no ledger a secret-file deny is never claimed; `-mcp` records the copy route's local- and user-scope registrations with their scope; a settings or account file the run could not read keeps its rows as recorded. Update removes what the release stopped writing, a value changed since is the user's and kept; uninstall removes only these - a local-scope registration through the CLI, a user-scope one printed; at user scope the seat denies and `ALFRED_CODE_HOOKS_OFF` stay, the core still loading - and refuses a stamp with none, or a plugin listing it cannot read, before any change), and `initialised:` - `pending` until init dates it (or the next run, on an older stamp with memory already off); configure diffs it against `main`. Scopes are `project`, `user` and `local` (`global` is read as `user`): the stamp and every copy stay in the project, the scope says where plugin rows are enabled (`user` makes every plugin / MCP call user-scoped), and `local` writes the stack's settings to `settings.local.json`. At every scope the stack keys `settings.local.json` holds are read over `settings.json`, and a write to one goes back there (R99). A 1.x account-dir stamp is read by update (which moves it into the project), `--print-plan` (configure and validate's read-back), `update-preflight.js`, `library-check`, `stamp.js state`, `stamp.js scope` (`installScope` falls back to it, A-I1), and the `library-stamp.js` SessionStart hook (B-I1) |
| Convention gate | nine path-scoped convention rules in `.claude/rules/` |
| Security review | `/security-review` + the `security-auditor` agent + the pre-commit checkpoint's security half (`alfred-habits-commit-checkpoint`) |
| Project instructions | `CLAUDE.md` (seeded to `.claude/CLAUDE.md`) |
| LSP | `csharp-lsp` / `typescript-lsp` plugins |

## The model these templates encode

- **Every MCP server ships as its OWN plugin, and the tool names say so.** ONE PLUGIN, ONE SERVER,
  SAME NAME (lint check 53): a plugin server's tools are `mcp__plugin_<plugin>_<server>__<tool>`, so
  every shipped tool name is `mcp__plugin_<n>_<n>__<tool>`, and lint check 54 fails on a bare
  `mcp__<server>__` under `stack/`, `setup-plugin/`, `meta/` or `scripts/` (it resolves to nothing: a
  `tools:` allowlist silently drops the tool, a `ToolSearch select:` line finds none); check 59 fails
  on a plugin spelling whose plugin ships no server there - a renamed server's old spelling (a
  deliberate fixture line carries `mcp-fixture` in a comment). A plugin's
  servers LOAD TOGETHER, so a second server in one entry would put a second set of tool schemas in
  every session. The entries are GENERATED (`scripts/build-marketplace.js --mcp-entries`, from
  `meta/mcp-pins.json`); `ALFRED_CODE_MCPS_VIA_PLUGIN=false` restores the 0.2.x registration route for
  the browser, on which the installer re-spells the copied skills, agents, rules and hooks to the bare
  names a registration writes - that needs the FILES, so the switch belongs with
  `ALFRED_CODE_SKILLS_VIA_PLUGIN=false` (a mixed pair is reported, never half-fixed). On the FULL copy
  route alone (all three switches `false`, so no core plugin) the copied agents' `alfred-code:<skill>`
  preloads are re-spelled to the bare skill too - nothing serves the qualified name there; with the
  core on they stay and resolve. The LOCKED THREE
  are plugin-only whenever any plugin route is on: installed beside the core (never as its
  `dependencies`, see the Plugins surface) and never also registered, which would run each server
  twice. They come back to `.mcp.json` only on the FULL copy route, at every scope - never `mcp add
  --scope user`; every registration and verify
  pass skips a locked name while the core is on. A switch onto that route disables the core and the
  locked three first, and copies every skill and seat the core carried, a denied seat excepted - that
  route reads them from the disk, where a plugin-route install holds only the extras. At `user` scope
  the rows are switched off in THIS project only (`disable --scope project`, which Claude Code honours
  over the user row while every other project keeps it - measured on 2.1.282, I2). Each off lands in
  the stamp's `stood-down` line, and a switch back enables exactly those, at the scope they were
  written: never the listing's flag (S22), and never a core the user switched off themselves (R116,
  M9). An unreadable plugin listing on a copy route is one loud line naming the commands, never an
  empty list acted on.
- **MCP servers are per-project at project and local scope** (a `user` install makes them
  account-wide) - except the user-scope FULL copy route (C10): its stack servers go to THIS
  project's own `.mcp.json` instead, and a stale user-scope registration an earlier run left behind
  is named with its remove command (`claude mcp remove <name> -s user`), never removed by this one.
  A user-scope run that registers anywhere else (the plugin route, or the MCP copy route with the
  core on) prunes the stack's own registrations from that `.mcp.json`; the user's own server under a
  stack name is kept and named with its remove command.
  `navigation` (baseline-navigation), `documentation`
  (baseline-quality-gates) and `memory` (baseline-memory) are LOCKED into every install and may be
  named in artifacts; every other server is droppable, so a body describes it. Only those three are
  seeded everywhere; the rest arrive by proof - a stack whose surface always has them, an evidence
  signal, or the user's pick. The names are ROLES; prose names the role and gives the upstream once
  where a reader needs it ('the navigation server (Serena)'). A backticked `browser` is no graph edge
  (`stack-graph.js` MCP_COMMON_WORDS): the word is too common to prove a need. Catalog of 6 names, 9 plugins:
  - `browser` (Playwright MCP) - seeded for web-angular / ionic / extension, evidence-proven elsewhere. One catalog
    entry, expanded after the selection into ONE PLUGIN per kept browser (`browser-chrome|msedge|firefox|
    webkit`, each `--browser <engine>` + profile `.playwright/<engine>`; firefox/webkit downloaded at the
    release pin) - not one plugin declaring four, which would load four copies of the tool schemas every
    session. Setup/configure ask `--browsers` (install) and `--browser-enabled` (absent: all
    on at install, none flipped by update); the stamp's two lines (`browser-engines:`, `browser-enabled:`) are the record on EVERY route (a
    switch onto the copy route carries them over, R116), and a stamped engine a run drops is
    uninstalled. On the copy route an engine's plugin row is uninstalled, on or off - except at user
    scope on the FULL copy route (C11): there the engine registers in THIS project's `.mcp.json`
    while its user-scope row still serves every other project, so an uninstall would take it from
    all of them; it is switched off in this project only (`disable --scope project`) and recorded in
    the stamp's `stood-down:` line, which a switch back enables. At project scope one left off is
    registered AND named in `disabledMcpjsonServers` (it rejects a `.mcp.json`
    server only - measured); the list moves only when the enable answer does. No settings key reaches a
    local- or user-scope registration, so there the registration IS the enable: one left off is not
    registered (the stamp keeps it installed, its browser is still downloaded) and a later enable
    registers it (R124). `enabledMcpjsonServers` names only the `.mcp.json` servers the run registered
    and lets load - never a plugin-carried locked server or an engine left off. A legacy 1.x `playwright` server
    migrates. The browser agents grant all four. A kept engine writes `.playwright/.gitignore` (`*`): the
    browser profiles hold session cookies.
  - `windows-desktop` (Windows-MCP) and `macos-desktop` (MacOS-MCP) - each drives the machine's OWN
    desktop apps, so each installs on its own OS only and neither on Linux (`stack/mcp/desktop-launch.js`
    is the one home of which OS each drives; the walk's table, `--missing` / `--redundant`, the installer
    and the launcher all read it). windows-desktop is seeded for the WPF and WinForms stacks there;
    macos-desktop is seeded by no stack. Both manifest rows ship `active: false` - in the catalog, never
    in a run that names no selection - because a server that clicks through the user's desktop with
    their full rights is opt-in. A server left out is named in one line, a row another machine enabled at
    project scope is left as it is - that line and the launcher's own refusal name `claude plugin disable
    <name>@<marketplace> --scope local`, this machine only, since `/plugin` would switch the committed row
    off for the teammate on the right OS too - and the run that brings one in prints its prerequisites once (English
    display language and matching privilege on Windows, the Accessibility and Screen Recording grants
    on macOS, uv when missing). Windows-MCP starts with `--exclude-tools PowerShell,Registry,Process`;
    `ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE` replaces the list (`none` lifts it) - read by the launcher from
    the shell and the three settings files, and on the copy route resolved into Windows-MCP's own
    `WINDOWS_MCP_EXCLUDE_TOOLS`. MacOS-MCP 0.4.6 has no such flag, and runs as `macos-mcp serve` (with
    no subcommand it exits with usage, measured). `ALFRED_CODE_PLATFORM` (or stack-select's `--platform`)
    stands in for the OS where a run must be judged as another's - the tests and the temp-project matrix.
    Both start their upstream with `ANONYMIZED_TELEMETRY=false` (the entries' `env`, the copy route's
    registration): both wheels read it, defaulting to `true`, and send PostHog usage events otherwise.
    Each server brings the `desktop-automation` skill through the graph (below).
  - plus `navigation` (Serena), `documentation` (Context7, the hosted remote only - its `CONTEXT7_API_KEY` header expands from
    the ACCOUNT settings.json `env`, keyless = the free tier) and `memory`. 2.0.0 cut `angular-cli`,
    `chrome-devtools`, `appium-mcp`, `sentry` and `context7-local` (manifest `retired.mcps`,
    `meta/retired-plugins.json`): update uninstalls each only as `name@<stack key>` and prints its
    add-back line.
  - **The 2.0.0 rename** (`meta/stack-manifest.json` `renamed.mcps`, the one table): `serena`,
    `context7` and `playwright-<engine>` are `navigation`, `documentation` and `browser-<engine>`, plugin
    and server alike. The old ids stay LISTED as RETIRED aliases carrying their successor's server under
    the old name (`build-marketplace.js mcpAliasEntries`, held by lint 53), so an install not yet updated
    keeps its tools after a marketplace refresh (S25). Update swaps each old row at THIS run's scope
    (`plugins.migrateRenamed`): the successor installed there first, then the old id removed - an
    engine keeps its on/off, a locked server comes on. An old row at ANOTHER scope serves the projects
    there, whose not-yet-updated files still spell the old tools, so it is stood down instead: the
    successor installed at this run's scope, the old id disabled for this project only (`disable
    --scope project`, or `local`), and one `!!` line naming its uninstall for once every project there
    has updated; this scope's rows go first, since an in-place uninstall clears the settings key a
    disable wrote (I2). An old id the run does not carry goes at this run's scope only. The full copy route stands the old ids down instead. Old copy-route registrations
    go on every route by the stack's own shape (the user's own server under an old name is kept), the
    approval lists follow, the read-back and selection lines read old names under the new ones, and
    the generated project files are re-spelled (`selection.respellRenamed`). The old flags
    (`--playwright-browsers`, `--playwright-enabled`) and stamp lines (`playwright-browsers:`,
    `playwright-enabled:`) are read for one release.
- **`memory` is required like navigation and documentation**, chosen per install by LEVEL rather than by
  a droppable pick: `global` (`~/.memory-mcp/memory.db`, every Claude account and Cursor on the
  machine - the default for a fresh install), `scoped` (`~/.memory-mcp/memory_<space>.db`,
  `memory_default.db` with no space - one account), `project` (`<project>/.memory-mcp/memory.db`,
  gitignored - this project only). `--memory-level` sets it; init and configure ASK it (one
  AskUserQuestion, the three levels, `global` recommended), update passes it only when the invocation
  names one, and changing it re-points the server, never touching the database file. The server needs
  the `[sqlite]` extra - `mcp-memory-service[sqlite]==<ver>` via `uvx --with numpy --from ...` - for
  real 384-dim embeddings; without it the server refuses to start on a database already holding
  memories. Env: `MCP_MEMORY_STORAGE_BACKEND=sqlite_vec`, `MCP_MEMORY_SQLITE_PATH=<db>`,
  `MCP_MEMORY_SQLITE_PRAGMAS=busy_timeout=15000` (a shared file, several writers). SETUP never
  imports: `/alfred-code:init`, in the session after setup's restart (`scripts/install/memory.js
  init`), imports the project's existing `MEMORY.md` / `memory/*.md` notes into the chosen database
  once, through the service (idempotent), and only after that import succeeds switches Claude's own
  memory off (`autoMemoryEnabled: false`) and writes the stamp's `initialised:` line. The switch-off
  lands in THIS project's own `.claude/settings.json` at project and user scope, and in
  `settings.local.json` at local scope, where a value the user set stays local (R96) - never the
  account file, which would silence every other project. A failed import leaves Claude's own memory
  ON and is reported, never retried into a false success; the old note files are never deleted.
  A note a PRE-fix registration imported was hash-embedded, so it loads by project tag but misses a
  `memory_search` by meaning; `memory.js reembed` fixes it (the service has no re-embed tool): the
  marker is the stored vector's norm (about 11 for a hash embedding, 1 for the sentence model), each
  row is deleted, stored and given back its dates through the service, after an owner-only backup
  under `~/.memory-mcp/backups/` that `reembed --restore <backup>` replays. A row tied to another
  memory (superseded, a child, a graph edge) is left alone; the first row goes alone and stops the run
  when its new vector is still not unit length. `memory.js duplicates` reports same-content pairs and
  deletes nothing.
- **The navigation server (Serena) self-activates via `--project-from-cwd`** (finds `.serena/project.yml` in its cwd). Its
  AUTO-GENERATED config is not a substitute (empty language list filled async, only the top language
  enabled), so the installer SEEDS `.serena/project.yml` on install and update: project name, the
  `language_servers` their own scan detects (C#, TypeScript/JS), and `ignored_paths` for `.serena` /
  `.claude` / `.playwright`. A key that already has entries is never rewritten, and never appended twice
  (a duplicate YAML key is an error). The key was renamed from `languages` in serena 1.7.0; the C#
  Roslyn server needs .NET 10+ (serena installs it into `SERENA_HOME`). Two approaches FAIL - do not
  retry: (1) an `mcp_tool` `SessionStart` hook calling `activate_project`; (2)
  `--project ${CLAUDE_PROJECT_DIR}`. `.mcp.json` DOES expand `${VAR}` / `${VAR:-default}`, but
  `CLAUDE_PROJECT_DIR` is not reliably in scope at parse time, and expansion reads only the shell
  environment plus the ACCOUNT settings.json `env` (an unset `${VAR}` stays literal with a
  `claude mcp list` warning). Cursor runs serena with `--context ide-assistant`; Claude with `claude-code`.
- **The navigation server's state is isolated per project** via `-e SERENA_HOME=.serena/home`; memories live in
  `.serena/memories/`. The whole `.serena/` must be gitignored (LSP cache ~327MB for C#, memories).
- **Every uvx-launched server runs on a PINNED Python** - `stack/mcp/uv-python.js` is the one answer: `3.13`,
  the x64 `cpython-3.13-windows-x86_64-none` on Windows on ARM; `ALFRED_CODE_UV_PYTHON` overrides,
  read from the shell, then `settings.local.json`, `settings.json` and the account settings (a plugin
  server never gets a project settings env key). uvx takes the newest interpreter, and serena-agent's
  pyyaml 6.0.2 ships no 3.14 wheel, so an unpinned start dies without a C compiler (Claude Code shows
  only CONNECTION_CLOSED); Windows ARM64 has no wheel for five compiled deps on ANY Python, while the
  x64 build runs there under emulation. Every such plugin entry starts through a node launcher
  (`serena-launch.js`, `memory-launch.js`, `desktop-launch.js`) because the right value is the MACHINE's
  (windows-mcp 0.8.6 already needs 3.14, so `refresh-mcp-pins.js` takes the newest release the pinned
  Python can install); the copy route
  resolves `@UV_PYTHON@` into `.mcp.json`. Never hand-patch a cached entry - the next refresh
  overwrites it (`docs/uv-python-pin-evidence.md`). The serena launcher keeps `SERENA_HOME` RELATIVE
  in the platform's separator, and the copy route registers `.serena\home` on Windows
  (`@SERENA_HOME@`): serena 1.7.0 execs its TypeScript server through npm's `.bin` shim, so cmd.exe
  gets the path UNQUOTED and cuts it at its first `/` (an absolute one at the first space). Both
  launchers pass a stop signal on to uvx (`runUvx`), or the server outlives them.
- **Three memory stores and one record, don't conflate:** the `memory` MCP is the SHARED memory - preferences,
  corrections, project facts and agent lessons, searchable by meaning, one database per chosen
  level (global/scoped/project) read by every Claude account and Cursor at that level; the navigation server's
  per-project memory (`.serena/memories/`) is the EPHEMERAL handoff bus between agents within one
  feature, never a place for what should outlast it; Claude's own built-in memory (`MEMORY.md` +
  `memory/*.md`) is SWITCHED OFF by `/alfred-code:init` (`autoMemoryEnabled: false`) after a
  one-time import of its existing notes into the `memory` MCP - it has no search and is not shared
  with Cursor, which is why the MCP replaces it rather than sitting beside it. Which repos are
  related lives in the generated `.claude/rules/baseline-project-related-context.md` (the
  `/alfred-capture-related-projects` skill), not memory. The session HISTORY (`<docs-path>/history/`,
  `history-session.js`) is the fourth, machine-local and never shared: what each session did and what
  the user ruled, script-written, read back at the next start on the same branch - a record, not memory.
- **Two stores, split by durability** (hard rule). The committed architecture docs
  (`<docs-path>/architecture/ARCHITECTURE.md` + `references/`, owned by
  `alfred-capture-architecture`) are the DURABLE truth every seat reads to orient, refreshed
  deliberately (that skill or `alfred-loop-architecture-quality`), never after each change. The code
  style lives in `<docs-path>/code-style/CODE-STYLE.md` + the path-scoped `project-code-style.md` rule
  (owned by `alfred-capture-code-style`). The findings (`quality/ASSESSMENT.md`, `quality/CODE-ASSESSMENT.md`, owned by the
  two `*-quality` captures) are the opposite of durable - recomputed fresh every run, so
  `quality/` carries no `watch.json` and is no docs domain. Navigation-server memory (`<feature>__<contract_version>__<seat>`,
  never the `memory` MCP) is the EPHEMERAL inter-seat bus; anything that must survive a fresh clone
  belongs in the committed docs.
- **Never `Read` a whole file to find a symbol** (hard rule, both stacks): locate via the navigation server
  (`find_symbol` / `find_referencing_symbols`) or the LSP; `Read` is for code already located.

## Working in THIS repo - invariants

- **`develop` is where work lands; `main` is the release branch.** Merging `develop` -> `main` IS the
  release: the workflow rebuilds the archive and tags `v<version>` from
  `setup-plugin/.claude-plugin/plugin.json`. Bump it (plus `marketplace.json` metadata; lint enforces
  equality) on `develop` with any release-worthy change. Never commit feature work to `main`; keep `main`
  the GitHub default branch. Lint + test workflows gate every push and PR.
- **Public repo.** No private project names or absolute local paths in tracked files.
- **The 1.x name is retired, never reused.** Its spellings (`CLAUDE_STACK_*`, the older <!-- legacy-name -->
  `CLAUDE_DOCS_PATH`, `claude-stack.stamp`, the marketplace key, the plugin cache dir, <!-- legacy-name -->
  `Agent(claude-stack:<seat>)`) are READ for the whole 2.x line by legacy readers; the new spelling <!-- legacy-name -->
  wins when both exist. Lint check 57 fails on any other 1.x spelling in a tracked file: a reader's
  line carries the word `legacy-name` in a comment (`<!-- legacy-name -->` in markdown, `//` or `#`
  in code), and only history (`docs/*-evidence.md`, `meta/migrations.json`,
  `meta/retired-entries.json`), the marketplace's generated `plugins[]` and the retired entry names
  pass unmarked. Anything NEW is `alfred-code` / `ALFRED_CODE_` from day one.
- **The repo root is a plugin source, so seven names are RESERVED there.** Every marketplace entry
  shares this root as its `source` and lists the paths it ships, but a shared root is auto-discovered
  whatever an entry lists (measured, spike S9c in `docs/plugin-migration-evidence.md`): a root
  `agents/` or `commands/` loads once PER ENTRY, a root `.mcp.json` or `hooks/hooks.json` loads once
  and is attributed to a different entry each time. So `skills/`, `commands/`, `agents/`,
  `hooks/hooks.json`, `monitors/`, `settings.json` and `.lsp.json` never appear at the root (lint
  check 46), and hooks and MCP servers are declared INLINE in each entry instead. `.mcp.json` is the
  one exception, because this repo is also a consuming project: it stays machine-local and
  gitignored, and the temp-project matrix installs from `scripts/clean-export.js` so it cannot leak
  into a case.
- **Parity / source-of-truth.** Behaviour lands only in `scripts/install/`, the one route.
  `meta/stack-manifest.json` is hand-edited and carries the six lists the seed reads (`npm run lint`
  holds it to disk, the HTML and the skill count). A shared baseline change is mirrored into
  cursor-stack in the same sitting. Never patch only a generated `.mcp.json` or a consuming
  project's copy - the installer wipes it.
- **Select a skill by DESCRIPTION, not by name.** Naming works only for a skill guaranteed alongside its
  citer (a frontmatter preload, an own-stack skill). Anything else - a skill no stack seeds, or one from a
  DIFFERENT stack - is described by what it covers. A guard phrase beside the name is not the remedy.
  Lint checks 25 and 26 block a named cite that can be absent; a router hub opts out with an
  `**Availability**` callout. Naming a skill never installs it: `suggests:` is removed (check 27) and the
  graph emits no body-mention edge. Install need is PROVEN via `meta/evidence.json`, a per-stack seed, or
  a server that brings the skill: a manifest `mcps[].skills` row is the graph's one edge back at a skill
  (`graph.mcps`), so the skill arrives with its server, a configure drop cascades both ways, and update
  never offers it alone.
- **One home per piece, no duplication.** A deterministic gate -> a hook. A per-file-type convention -> a
  path-scoped rule attaching its skill. A keyword capability -> the skill's description. Cross-cutting
  guidance -> the always-on `baseline-*.md` set (each with an `.mdc` twin in cursor-stack to mirror). The
  base template carries only per-project structure + platform routing. Never state one trigger twice.
- **Prove a behavioral change, don't assert it.** A model / effort pin, routing rule or plugin-set change
  ships only with evidence: run the build + tests yourself and read the code, measure the token delta when
  the claim is about cost, and commit the evidence BEFORE any reset. Verify outside-world claims
  (package, version, API shape, CLI flag) through the documentation server in the same sitting and cite it.
- **Every change is proven on a TEMP PROJECT before it is committed - MANDATORY, no exceptions.** Unit
  tests and a green `npm run lint` / `npm test` are necessary, never sufficient. Each change or feature
  (installer, hook, command, skill, rule, agent, MCP, manifest - a one-line or prose-only edit included)
  is exercised end to end from THIS working tree (`--source <repo>`) inside throwaway projects created
  under the session scratchpad (or `os.tmpdir()`), never a real consuming project, and removed after.
  - Edge cases are REQUIRED, not optional: a fresh install; an update over an older install; a re-run
    (idempotent - a second run changes nothing); a project holding the user's own config the change must
    not clobber (hand-added MCP server, settings key, hook); missing, empty or malformed input (absent
    file, garbage JSON, unset env); every scope the change touches (`project`, `user`, `local`); and
    every boundary the change introduces (at, one under, one over).
  - Read the RESULT, never the exit code alone: open the written `.mcp.json` / `settings.json` / copied
    files and hook output, and assert they are what the change claims.
  - A bug found blocks the commit AND the release: fix it, add a regression test, re-run the whole
    temp-project matrix. A case not run is reported as NOT RUN, never implied as passing. No 'done',
    commit, version bump or `develop` -> `main` merge until the matrix is green and its commands plus
    results are in the report.
- **House voice:** direct, lean, single dashes not em-dashes, single quotes in prose, recommend one
  option with a reason. Lint check 32 sweeps `stack/`, `setup-plugin/`, `meta/` for em-dashes, and
  those plus `scripts/` for characters nobody can see (zero-width, bidi, a BOM past byte 0 outside a
  `.ps1`, the tag block) - write one as an escape. A joiner or direction mark a script needs is text:
  a ZWJ between two emoji parts or two non-ASCII letters, a ZWNJ between two non-ASCII letters, an
  LRM / RLM beside one.
- **The always-on surface has a BUDGET.** Lint check 33 sums the pathless `baseline-*.md` bodies plus
  every agent and skill DESCRIPTION and fails over 160,000 chars (115,792 on 2026-09-26: pathless rules 36,166, agent descriptions 29,148, skill descriptions 50,478 - the 2.0.0 audit tightened rules and skill descriptions, -2,260, the MCP role names added +311, the desktop-automation description +793, and alfred-capture-claude-md's +688). A rule moved into the
  baseline set or a grown description is costed against it. `/alfred-code:status` reports an install's
  own floor.

## Maintenance gotchas

- **`.mcp.json` is the COPY ROUTE only** (`ALFRED_CODE_MCPS_VIA_PLUGIN=false`); on the default
  plugin route the installer registers nothing and prunes every stack name it ever wrote, including
  the four `browser-*` spellings and the pre-2.0.0 names (`serena`, `context7`, `playwright-*`), out of `.mcp.json` and out of `enabledMcpjsonServers`. On that
  copy route it is **registered by the CLI and VERIFIED by the installer - fix the manifest, not the
  output.** `claude mcp add` over an existing name prints 'already exists' and exits 0, so a failed
  `remove` looks like success. `verifyProject` / `verifyUser` (`scripts/install/mcp.js`) read the result
  back: at project scope `.mcp.json` is parsed and drifted entries rewritten (`mcp repaired: <name>`);
  at user and local scope the shape comes from `claude mcp get`, a mismatch is retried once through the CLI, then
  reported (the account config is never hand-edited). A manual registration that takes a stack MCP plugin's place
  (the Context7 url under any name, or a plugin-carried server's own name at local, project or user scope) gets one
  line naming its `claude mcp remove` command and is never removed by the run: plugins rank below those scopes
  (measured, 2.1.282), so the warning is the only signal. The expected shape is built from the same
  manifest words; a server the project added by hand is never touched. `scripts/install-mcp.test.js`
  pins it on the seed.
- Editing a consuming project's installed copy is local-only; mirror it into `scripts/install/` here
  (and into cursor-stack when it touches the shared baseline or a twinned agent/rule).
- **Everything installs from ONE source snapshot** per run (`install/source.js`, `createSource`), resolved in
  this order: a handed `--source`; the PLUGIN CACHE; the release archive
  (`releases/latest/download`, with a `RELEASE-SOURCE` file naming commit + version); a shallow clone
  of `main`. A change ships only once merged to `main`; until then the per-file fail-soft keeps
  existing copies. Never reintroduce a raw fetch of a repo-owned file (per-file, stale, mixes
  revisions).
- **The plugin cache IS the snapshot, so the common run downloads nothing but a newer release**
  (`pluginCache`, `scripts/install/source.js`): `<config>/plugins/cache/<marketplace>/alfred-code/<version>/`
  is the whole repo, because every marketplace entry is sourced from the repo ROOT (measured on a real
  install) - but with NO `RELEASE-SOURCE` and no `.git`, so its revision is the `v<version>` tag of its
  own `plugin.json` (`readRevision`, shared with `stamp-compare.js`). The NEWEST valid entry across
  marketplaces wins (`sort -V`); one counts only with `stack/skills` + `stack/agents`, so a
  half-written one is rejected. It is by construction the revision the enabled plugins run from. The
  stack writes no cache of its own (the old `stack-source` cache, its promote, the release probe and
  `STACK_SOURCE_CACHE` are RETIRED). A shape change is a THREE-site edit (`scripts/install/source.js`,
  the protocol's two snippets), covered by `scripts/source-cache.test.js` and
  `scripts/install-source.test.js`. A first run BOOTSTRAPS: no cache on a plugin route installs the
  core first so its cache serves the same run. Every run takes the LATEST: the seed (no `--source`)
  and both protocol snippets refresh the catalog and `plugin update` EVERY installed stack entry at
  its own scope BEFORE the cache is read - a refreshed catalog alone never moves the cache, and an
  entry left behind would launch naming files its older version lacks. `--print-plan` changes no
  plugin.
- **One download per RUN.** The plugin commands resolve the snapshot themselves and pass it with
  `--source`; the script never deletes a borrowed source (`owned` in `scripts/install/source.js` is
  false for `--source` and the plugin cache), and the commands remove their `$TMP` on every exit path.
  Standalone (no `--source`) still resolves and cleans up what it fetched; keep that path working.
  Never `rm -rf` a plugin-cache entry: that is the CLI's own plugin install.
- **The install is versioned, not the file.** `version:` exists only in plugin.json - a `version:` key on
  a skill/agent/rule is ignored; don't add one. Each run writes `alfred-code.stamp` (source commit, or
  the `v<version>` tag when the snapshot names none, + release version); configure diffs it via the GitHub compare API. A run whose source never resolved
  writes NO stamp.
- Authoring a skill in `stack/skills/`: the method is `alfred-habits-skill-writing` (the
  `skill-authoring.md` rule loads it; its A/B is `scripts/skill-comply.js`); on top of it here - the
  parity lint, HTML + count sync, house voice.
- Skills are shared with Cursor: a skill body stays platform-neutral (conditionals like 'INLINE when no
  dispatch'), never forked per platform.
