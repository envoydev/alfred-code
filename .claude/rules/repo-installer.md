---
paths:
  - "scripts/install/**"
  - "scripts/install*"
  - "scripts/source*"
  - "setup-plugin/**"
---

# Installer, plugin commands and delivery

The one installer route, the plugin commands, the delivery surfaces and the snapshot / stamp maintenance gotchas. Moved here verbatim from the repo `CLAUDE.md` so it loads only when you edit these files.

- `scripts/install/` - THE INSTALLER, and the ONLY route: `alfred-code.js` is the entry, one module
  per layer beside it (`args`, `brand`, `source`, `manifest`, `selection`, `library`, `copy`,
  `settings`, `env-migrations`, `plugins`, `mcp` (the retire path alone), `docs`, `seeds`, `pins`,
  `stamp`, `uninstall`, `tool-ignores`, `runtime`, `json-file` - the one JSON reader, below). One `node` command on every OS, so no OS branch in the command bodies. The
  frozen shell twins are deleted (2.0.0) and `ALFRED_CODE_SEED=shell` refuses with one line.
  `meta/stack-manifest.json`, hand-edited, is the one source of the six lists the seed reads;
  `docs/alfred-code.html` is the browser inventory (lint check 60 runs `node --check` over its inline
  script: an unescaped quote in one row string left the page with no tables; check 60b holds every seat's
  `mdl` pin badge and row 'Pinned <model>/<effort>' to its frontmatter - 2.1.5 M57 - and a row's ', max <n> turns'
  to its `maxTurns`, 2.1.6 M59).

- `setup-plugin/` - the Alfred Code plugin: six COMMANDS and one router SKILL.
  - `/alfred-code:init` is ONE command in two phases (setup merged into it, the user's ruling of 2026-10-17): its first
    call (`stamp.js state`) routes. `not-installed` runs the INSTALL phase (`references/init-install.md` - the selection
    walk and the install, reporting `derive-state.js`'s `written` block first), which ends on 'restart, then
    /alfred-code:init again'; `installed` / `initialised` runs the BOOTSTRAP phase (`references/init-bootstrap.md`) - the
    one-time set-up in the new session (`init-plan.js`: the machine installs behind one ask, `stamp.js mark` dating the stamp's
    `initialised:` line - Claude's own memory is left as it is - the captures, the AGENTS.md fill through
    `habits-adjust-agents-md`). `ALFRED_CODE_UNATTENDED=1` in the launch environment (never seeded - a
    settings value would apply over a launcher's) runs init's bootstrap with nobody answering (the install phase
    refuses it): each ask takes its
    Recommended option unless it is destructive (loses or replaces what the project or account owns - a
    claude-hud `refresh` line) or needs a person (typed text, a restart), then the option that changes
    nothing, one `unattended: <question> -> <choice>` line each (init-bootstrap.md 'Unattended'; `init-plan.js`
    prints the bootstrap's own four answers, `update-preflight.js` prints `unattended: on` for update's asks). Init
    reads the stack's files through the Bash tool, never the Read tool, which asks before a read outside
    the working directory. `/alfred-code:update`
    refreshes and prunes from the stamp compare (its ONE ask offers what the release ADDED -
    `update-preflight.js`'s `new:` lines, classified by `derive-state.classifyNew`; a yes is
    `--add '<category> <name>'` on `--installed-only`; its body is a router - the model gate and the order of calls -
    with steps 1-3 in `references/update-walk.md`, cat in the same call as `stamp.js state`, and steps 6-8 in
    `references/update-close.md`, cat in the same call as the `--log` call, so a gate-refused run carries 6.8k body
    chars instead of 35.7k and a run that goes ahead pays no extra call - audit 2026-10-20 C15), `/alfred-code:configure` adds or drops through
    the walk it shares with init's install phase (`setup-plugin/references/walk.md`), `/alfred-code:status` (read-only, no snapshot: general info, a
    health column from the CLI's own error fields plus a `not installed for this project` row per `plugins.js unreached`
    line - a plugin the settings switch on that no install record reaches, another project's record left out (usage
    audit 2026-10-10) - usage from `analyze-usage.js --inventory`, plus the
    install's always-on FLOOR, the stack's share counted by `derive-state.js --floor`), `/alfred-code:validate`
    (project-relative two-way reconcile via `stack-select.js --redundant` / `--missing` /
    `--evidence-gaps`, plus the settings.json `env` layer against `environment.json`, and a read-only
    install audit at its post-check - `scripts/audit-install.js` rows on unpinned launches, wide shell
    grants, hook wirings and credential literals, pasted before one ask, never auto-fixed, and the
    AGENTS.md check - `agents-md-check.js` rows offered to the skill's improve mode, 'Leave them' recommended and first), `/alfred-code:uninstall`
    (the seed's `uninstall` over the stamp's ledger, below; user-scope plugin rows and an older release's MCP registrations printed, never run; the
    unedited instruction-file seed goes only on its own question, the user's ask of 2026-10-23 - `uninstall.js seed .` previews
    it, `--instructions-seed remove|keep` carries the answer, and with none the seed stays and the log names the flag). In a git
    worktree of an installed checkout every command stops and names the main checkout. A legacy copy-route install that never
    wrote a stamp reads `legacy-unstamped` (`stamp.js legacySignature`: no install record, and TWO of the stack's hook files, a
    stack env key, three or more skill / seat / rule names only the stack uses - its `alfred-` / `project-` prefixes or a renamed
    item's old name, `manifest.js stackOwnName`, M3: a catalog name like `typescript` or `npm` is a project's own as often -
    never skills alone); update takes it as a pre-ledger install
    (picks off disk, old names renamed, docs move offered), init asks once with update recommended, the rest route to update, and
    the hooks' record list is NOT extended, so they stay down until that update writes the stamp.
  - configure and validate never inventory by hand: `update --installed-only --print-plan --plan-out`
    writes the installer's own read-back as their `--installed` JSON (with `left_out` - denied seats,
    items of a parked retired entry - and `parked_plugins`, so the walk's closure cannot switch either
    back on), and they apply as `derive-state.js --delta` lines turned into `--add` / `--drop` over the same
    read-back. A drop runs BEFORE the closure: one something kept requires, or a locked always-on rule,
    is logged 'not applied'; a dropped seat is denied, a dropped hook named off, a
    dropped library copy deleted (a copy-route hook unwired too) - never the core, which carries the hooks.
  - The seed prunes only the names in `meta/stack-manifest.json`'s `retired` block (skills, agents,
    rules, hooks, mcps, plugins), and a skill, seat, rule or hook copy only where the stack's own record holds it
    (the stamp's library hash, the ledger's row, or a name only the stack uses) and it still hashes to it - any other is the
    project's, kept and named with `!!` (`retiredKeep`) - add a name there when any of the six is renamed or removed (a
    stamp compare only names what left after the stamped commit). A renamed skill or seat also gets
    a `renamed` row (old -> new; a rule too since 2.1.6): update maps picks, denies, `skillOverrides` and selections by it.
    A hook too since 2026-10-20 (`renamed.hooks`, `guard-answer-length` -> `guard-answer`): its old FILE is also in
    `retired.hooks` (copy and wiring go), and the read-back maps a copied file, the stamp's shipped list and a stored
    `ALFRED_CODE_HOOKS_OFF` (`selection.js readBack`), while `settings.js applyEnv` re-spells a stored off-list the walk did
    not answer - left as it was, the prelude stopped matching it and a switched-off hook ran again (plugin route, measured).
    A retired PLUGIN also gets a
    `meta/retired-plugins.json` row (`retiredIn`, `addBack`): update uninstalls it only as
    `name@<row's marketplace>`, else `name@<stack key>` (`retiredSpec`), keeps a row at another scope
    and prints the add-back line - the path the five cut MCP servers took. On the plugin routes the
    seed also prunes every shipped COPY a plugin now carries. A retired pathless rule, hook wiring, MCP
    registration or plugin costs every session until pruned; a shipped-but-unneeded one is validate's
    whole-stack-absent pass, not a retirement.
  - A retired skill or seat whose copy git TRACKS in the project is the project's own commit: the retired prune
    and the ledger prune (`pruneCopies` / `pruneDroppedCopies`, `gitTracks`) keep it and name it. This repo
    relies on it - `plugin-authoring` left the shipped catalog in 2.1.0 (`retired.skills`) and lives as this
    repo's own skill in `.claude/skills/plugin-authoring`, tracked through the `.gitignore` negation
    (`.claude/*`, `!.claude/skills/`, `.claude/skills/*`, `!.claude/skills/plugin-authoring/`).
  - The `/alfred-code` router is a SKILL and the workers are COMMANDS on purpose (commands list
    namespaced, skills list bare) - do not convert either back.
  - Table before question: `hooks/guard-layer-table.js` (PreToolUse `AskUserQuestion`) denies an ask
    (up to 3 times per table since the last answered ask; it waits for the ask's own transcript row - only when a table call sits in the tail since the typed prompt, M15 - and fails open) whose decision table was run but never pasted - a `stack-select.js
    --table` catalog, the `plugin-settings.js` report or validate's install audit - and, inside an init / configure walk
    holding a `stack-select.js` call, a layer's own selection ask (`Agents: ...`, `Add to the installed skills?`) whose `--table <layer>` never ran (validate's `<Layer>: ...` consent asks are no walk ask - commands track
    T2-03, 2026-10-21) (2.1.7, the user's report of 2026-10-06; its own valve of three per layer). Audit 2026-10-11 added
    configure step 1's `update-preflight.js --inventory` table (proof: its `total:` line) with its closing ask, which needs that
    call to have run, and - inside a typed init / configure / validate run that printed a banner - a gap in the `[step n/N`
    numbers, each with its own valve. A walk that never ASKS gave it nothing to judge (2026-10-21: a real init run narrated
    the hooks table and moved on, and rendered the plugins table through `node -e`), so it also rides PreToolUse `Bash`
    behind `if: Bash(node *)` and judges the walk's NEXT step - a `stack-select.js`, `plugin-settings.js` or installer
    call - inside a typed init / configure run: denied while the latest `--table` has no answered ask after it (a re-run
    of that same table passes), and in init, which walks all five layers in order, while an earlier layer's table never
    ran before a later table, `--emit` or `install`; configure skips areas by design, so only the first check. Each has
    its own valve of three; any other node call leaves before the prelude loads. Step 6.5 (2026-10-21): both walk checks
    read the span back to the newest typed init / configure command (a 2MB tail; past it nothing is judged) - a typed
    reply is the user's answer where it stands, a harness prompt (`hook-prelude.js harnessPrompt`, a `! ` shell row) is
    neither, another typed slash command ends the walk, a compaction summary restarts it only when it names it, and an ask
    the idle timeout closed is no answer; one typed reply had switched the gate off for every later layer. Known ceilings (audit 2026-10-21 H7): a walk run through the
    PowerShell tool is not judged on this path, and neither is a step the `if: Bash(node *)` rule never matches - a node
    spelled by path (`/usr/local/bin/node ...`), behind `env` or inside `bash -c '...'` (the permission rule's matching
    table: only a `VAR=` prefix is stripped); the 2MB tail above covered every real walk measured (455K-1,552K from the
    typed prompt to `--emit`). The walk's own snippets always spell `node "$TMP/..."`, so no code change. It ships in the plugin because a fresh install
    has no stack hooks yet; the rule text is pinned as `table-before-question`. It and `library-stamp.js` run the
    core's prelude gates from the plugin root (2.1.5 M4: the csv, `hook_profile: minimal`, the alias and a Cursor payload
    stand them down; GATE 4 is skipped, `setUp: false`, since the gate serves init's install phase), and a layer-table denial writes a
    block row where the repo is set up; the Cursor-gate test takes its file list from the commands the core launches.
  - None of the six carries `allowed-tools` - settled: it is a per-turn permission pre-approval, not a
    restriction or a context saving.

## The stack's delivery surfaces

All surfaces come from ONE source snapshot per run, so an install is a single revision (the one
`alfred-code.stamp` records).

| Surface | Delivery |
|---|---|
| Skills | LIBRARY copies of every pick in `.claude/skills`, the always ones included (2.1.0 - no plugin carries a stack skill; the core carries only the `/alfred-code` router), hashed in the stamp; `library-check.js` reports drift and staleness |
| MCP | none since 2.10.1 - the stack ships, registers and launches no server; the first update onto 2.10.1 or later takes out what an earlier release left (its server plugins, its copy-route registrations, Claude's memory switch-off, the `deniedMcpServers` rows) and prints one add-back line per server (`repo-mcp.md`) |
| Plugins | 2 OPTIONAL third-party picks (`claude plugin install`), the `*-lsp` pair, each suggested on evidence (`meta/evidence.json`) (`superpowers` left them in 2.0.0, never touched - R109; claude-md-management and security-guidance were RETIRED in 2.0.0 on the user's call, 2026-09-26, superseding R27 - `meta/retired-plugins.json`: the first update past 2.0.0 uninstalls each as `name@claude-plugins-official` at this run's scope and prints its add-back line, a row at another scope kept and named; a row put back after it is the user's own, `plugins.retirementDue`) - plus `claude-hud`, an OPTIONAL pick every walk marks recommended (2.2.0, the user's ruling of 2026-10-06 - it was required and user-scope before; `CORE_DEP_PLUGINS` is empty, lint 51 accepts that), never re-enabled once the user disables it (`install` would - measured on 2.1.282), statusLine + compact layout set by `/alfred-code:init` (`hud-statusline.js` - the account `settings.json` for a user-scope claude-hud, the project's `settings.local.json` for one installed for this project alone) - plus the core. **Per-item scope (2.2.0):** every optional item - the LSP pair and claude-hud (`args.js SCOPED_ITEMS`; a server's `--scope-of` from an older walk is ignored with a line, `RETIRED_SCOPED`) - goes where the user chose, `--scope-of <item>=<global|project|local>` (default: this project, the run's scope; `project` on a user-scope run); the core follows `--scope`. An existing row is KEPT where it is on every run (`scopeFor` reads the listing first) - only an explicit `--scope-of` that names another scope moves it (`plugins.moveScoped`: installed at the new scope first, then the row this project loads uninstalled, plus any narrower than the target; a broader row at a third scope stays and is named; leaving `user` said `!!` with the line that puts it back); the read-back's `scopes` map (`selection.itemScopes`: `global`, `project`, `local`, `managed`, the narrowest where an item sits at several) is what configure's walk shows. The core declares NO `dependencies`: `plugin update` installs none a release adds, a plugin missing one is disabled at load (measured on 2.1.280). Every run refreshes each marketplace its specs name once, reads each plugin as `name@marketplace`; install updates one already listed, update installs an absent one, enables a parked one, then updates, at EVERY scope `claude plugin list --json` reports (`plugins.scopesOf`); `--installed-only` reads back only ENABLED stack entries (the core always is), each row's on/off the narrowest settings file that names it (`plugins.withEffective`) |
| Hooks | folded into the core `alfred-code@envoydev` plugin (all eighteen, generated from the manifest's `hooks[]`); only the engines `docs.js` / `history.js` / `layout.js` / `handoff.js` and `model-windows.json` are copied (`HOOK_ENGINES`); instrumentation off via ALFRED_CODE_INSTRUMENT=0 |
| Agents | all 45 in the core plugin (2.1.0), every one the selection did not pick denied as `Agent(alfred-code:<seat>)` in the project `permissions.deny` - measured to leave the listing and the bill (spike S3) - wherever the core loads, the skills copy route included; the full copy route (no core) writes none and copies the picked seats into `.claude/agents` (absence is off). An update reads the seats back off the core minus the denied, gated by the stamp's picks and the ledger's `managed-deny`, so a seat a release adds is offered, never on by itself; a renamed seat's deny is re-spelled under its new name, so the seat stays off |
| Installer | `node scripts/install/alfred-code.js <install|update|uninstall>` from the snapshot, one command on every OS |
| Install stamp | `alfred-code.stamp` in the project's `.claude/` at EVERY scope - source commit, `installed:` and `installed-ms:` (the write to the millisecond, which the account-file loss check compares a CLI backup with), `picked-skills` / `picked-agents` (only the PICKS, as `name@home` - a skill plain since 2.1.0, a seat `@alfred-code`: `--installed-only` unions them back so an item a release moves is kept; a stamp with neither line takes what the enabled entries carry), `seats-route` (`plugin` or `copy` - how the run delivered the seats; a stamp WITHOUT it is from before 2.1.0, and its first update reads the core as the always closure it then carried: the always skills become copies, a library seat copy is pruned - one edited since, or TUNED (a `model` / `effort` other than the stack's, which no setting can give the core's seat), is kept, its hash carried, and dispatched by its bare name: the capabilities rule's seats line is re-spelled to match (`selection.respellRosterSeats` - `alfred-code:<seat>`, bare for a kept copy) and its inventory lets a project copy win its name - and every seat the install never ran is denied), `library-skills` / `library-agents` / `library-rules` (`name=<sha256>` of each copy as written), `stood-down` (what the full copy route switched off here, `<scope>:<spec>` - the one thing a switch back enables), the LEDGER `managed-env` / `-deny` / `-hooks` / `-mcp` / `-files` (what the run wrote, each at its hash and in the FILE it was recorded for - a move off `local` carries a deny row into settings.json only where that file did not hold it before, and with no ledger a secret-file deny is never claimed; `-mcp` holds an older release's copy-route registrations with their scope, read only by the retire path and uninstall (no run writes a row since 2.10.1; `mcp-held:` and `installed-always-mcps:` are dropped on the next write); a settings or account file the run could not read keeps its rows as recorded. The account `.claude.json` an earlier release registered into is read the retire path's way (`mcp.accountLoss`, `repo-mcp.md`). Update removes what the release stopped writing, a value changed since is the user's and kept; uninstall removes only these - an older release's local-scope registration through the CLI, a user-scope one printed; over an account file unreadable at its start, or replaced since the stamp, it refuses before any change while the file holds none of the recorded registrations, naming the backup that holds them and `/alfred-code:update` as the other way out - the update drops the record of rows the file no longer holds - and a copy put back ends the refusal (review 2.1.6 m3, re-verify N1); at user scope the seat denies and `ALFRED_CODE_HOOKS_OFF` stay, the core still loading - and refuses a stamp with none, or a plugin listing it cannot read, before any change), `data-root:` / `data-pending:` / `data-move: kept` (the data root in effect, a sensitive-data move a run could not make, a kept layout - `repo-memory-data.md`), and `initialised:` - `pending` until init dates it (or the next run, on an older stamp with memory already off); configure diffs it against `main`. Scopes are `project`, `user` and `local` (`global` is read as `user`): the stamp and every copy stay in the project, the scope says where plugin rows are enabled (`user` makes every plugin / MCP call user-scoped), and `local` writes the stack's settings to `settings.local.json`. At every scope the stack keys `settings.local.json` holds are read over `settings.json`, and a write to one goes back there (R99). No reader looks for a stamp in the account dir. |
| Convention gate | nine path-scoped convention rules in `.claude/rules/` |
| Code review | `/review-code` (always installed; a change no plan built) + `task-verify-code` (a planned build) + the `<stack>-verifier` seats; Claude Code's built-in `/code-review` is denied to the model (`guard-fresh-session-start.js`) |
| Security review | `/review-security` (always installed) + the `security-auditor` agent + the pre-commit checkpoint's security half (`habits-commit-checkpoint`), which runs `review-security`; the built-in `/security-review` is denied to the model |
| Project instructions | `AGENTS.md` (seeded to `.claude/AGENTS.md`, or the root on init's place answer; `--instructions-at root\|claude` moves an existing AGENTS.md / CLAUDE.md between the two - `seeds.placeInstructionFiles`) - or `CLAUDE.md` on the name answer (`--instructions-file agents\|claude`, kept as the stamp's `instructions-file:` line - none on an install never asked, whose first update asks, from the `update=` verdict of `seeds.instructionsFileLine`; a switch renames the root, `.claude/` and part files, `seeds.renameInstructionFiles`, only while no root or `.claude/` file carries the answer - a root CLAUDE.md stops every AGENTS.md loading). Both asks in `setup-plugin/references/instructions-place.md` |
| LSP | `csharp-lsp` / `typescript-lsp` plugins |

- **The scope rules (the user's spec of 2026-10-08, checked against code.claude.com/docs/en/plugins/cli-reference,
  /plugins/loading, /mcp and /managed-mcp; `scripts/install-scope-rules.test.js`).** Every scope Claude Code
  offers - `local`, `project`, `user`, and `managed` (the admin's). (1) The core installs at the run's scope (the three `alfred-` servers that followed it until 2.10.1 are retired). (2) A plugin at several scopes reads its narrowest row
  (`parsePluginList` ranks local, project, user, managed). (3) An uninstall or a move takes one scope's row; a
  broader row stays, named. (4) An update refreshes every scope a plugin is installed at (`updateEvery`) - a stack
  row already at the snapshot's release is skipped (`atRelease`, `plugin current [<scope>]`: the source step updated
  it, audit 2026-10-11). (5) A narrower scope switches a
  broader row off for itself alone: a plugin through `claude plugin disable --scope <run scope>`
  (`plugins.overrideScope` - configure's drop and both copy-route stand-downs), and the `deniedMcpServers` `{ serverName }` rows an earlier release wrote for an MCP server (the stamp's `mcp-denied:`
  line) are only lifted now - by the retire step and by uninstall (`settings.applyMcpDeny`) - never the account
  `.claude.json`, which the installer does not hand-edit. (6) Moves and removals come from init and configure; update removes
  only what the release retired or renamed. (7) Every mutating `claude plugin` / `claude mcp` call names its
  scope - plugins default to `user`, MCP servers to `local` (the retire path's removes). (8) A managed row is updated (`--scope managed`,
  the one call that scope takes) and never installed beside, uninstalled, disabled, moved or named with a
  `--scope managed` command (`plugins.leftAt`).
- **The auto-compact window per model (after 2.4.0, the user's rulings of 2026-10-14).** While the project compacts
  instead of offering a fresh session - `ALFRED_CODE_AUTO_COMPACT=1`, seeded `0`, which init's install phase asks with the fresh-session
  triggers and passes as `--auto-compact on|off` (written over the value there, `applyEnv` 3d) and configure's env step
  switches - every run writes
  `modelSettings.<id>.autoCompactWindow` into the project's own settings file (settings.json, settings.local.json at local
  scope - never the account's) for each `model-windows.json` row, at its window tier's fresh-session trigger
  (`settings.js compactWindowSeeds`: `ALFRED_CODE_CONTEXT_WINDOW_FOR_200K` / `_FOR_300K` / `_FOR_1M` from the env the file
  applies, the tier by `fresh-session.js tierKeyOf`, `0` skips the tier, past
  the window held at 90%, inside 100k-1M), so an auto-mode run compacts where the fresh-session gate would offer a resume
  and goes on. Claude Code reads the key at session start only. Add-only and ledgered (`managed-settings:
  <file>:modelSettings.<id>.autoCompactWindow=<hash>`; `stamp.js SETTINGS_PATH` must read the path back, or no update,
  move or uninstall can take the row back - the 2026-10-14 matrix caught exactly that): an update re-derives a row still at
  its hash and removes one it no longer seeds (every one once the key goes back to `0`), a hand-changed value is the user's. Nothing is seeded while this file, the
  sibling project file or the account file sets a top-level `autoCompactWindow`, and a model the sibling or the account
  file names is left to it.
- **The project's own tools skip the data root (the user's ruling of 2026-10-14; `install/tool-ignores.js`).** A tool
  that walks the tree reads its own ignore file and at most the ROOT `.gitignore`, never the data root's nested one:
  `prettier --check .` flagged 272 files under a project's `.alfred/` (measured on Prettier 3.9.1 - a browser profile,
  the docs, serena's memories), and the config guard keeps the model out of an existing ignore file. `.claude/` too (the
  user's call, same day): a fresh install's Prettier run flagged 13 of the stack's library copies there, and `prettier
  --write .` rewrote them for the next update to write back and validate to call drift. So every run writes one marked
  block - `/<data root>/` and `/.claude/` between `# alfred-code:` mark and end lines - into `.prettierignore` (made
  where Prettier is in use - a config file, a `package.json` `prettier` key or dependency) and into an existing
  `.eslintignore`, `.stylelintignore` or `.markdownlintignore`, re-pointed when the data root moves. The stamp's
  `tool-ignores:` line (`<file>=created|appended`) is what it wrote: a block the user took out stays out, a file the user
  deleted is not made again, a folder a line of the project's own already ignores leaves the block (both, and the block
  leaves the file), an edit inside the block is rewritten, and uninstall takes the block back - and a file the stack
  made, once nothing else is left in it. An ESLint flat config is code the installer never edits: `loop-code-quality`
  leaves a finding under either folder out of its gate and report instead.
- **`.mcp.json` is never written since 2.10.1** - the stack registers no server. The retire path only takes an older
  release's rows out, where the ledger or the exact shipped shape vouches for them, and gives the file back its bytes
  (`repo-mcp.md`). Every JSON file the installer parses
  that a person may edit (`.mcp.json`, `settings*.json`, the account's `.claude.json`) goes through ONE reader,
  `install/json-file.js` (`parseJson` / `readJson`; the scripts that read the same files - `stack-select.js`, `plugin-settings.js`,
  `analyze-usage.js`, `library-check.js`, `audit-install.js`, `hud-statusline.js`, `agents-md-check.js` - use it too, and all run from
  the whole tree, so it ships beside them): a leading BOM is stripped, and anything else wrong - a BOM plus
  garbage included - still throws, so it is still unreadable. A BOM'd `.mcp.json` read as empty before (a bare
  `JSON.parse`), and once `keepMcpOrder` kept the BOM every update dropped a pick and its `enabledMcpjsonServers` entry
  (matrix F-BOM, 2.1.6); a new reader of such a file uses the helper, never a bare parse. At project scope, after the retire step's `claude mcp remove` writes `.mcp.json`, the file gets its own bytes back when
  its content did not change, and otherwise keeps its BOM, line ending, indent and key order and every top-level key
  besides `mcpServers` (`mcp.keepMcpOrder`, re-verify 4 T4). `scripts/install-mcp-retire.test.js` pins it.

- **Workspace layering (2026-10-26, on by default from 3.0.0).** A project installed inside an installed folder can join it as a CHILD: it takes the parent's set and
  the variables it reads through the chain, adds its own picks and can ignore any inherited item. Every project has a
  ROLE - `role root|standalone` in its file, or a `parent` line (`roleOf`; no line reads `standalone (not asked)`) - and
  `above <rel>|none` records the tree it was asked against, so the role ask (`roleAsk`) comes back only when that
  changes: init asks it before screen A, configure offers it in the Environment area, and update's preflight prints
  `workspace: role-ask <case> <rel>` for the walk to ask. The record is `<data root>/workspace` (`repo-memory-data.md`)
  - `parent <rel>` here and `child <rel>` in the parent; a parent counts only while its `child` line points back (hop
  rule N1, `install/workspace.js chain`), and the walk stops at depth 8. The installer touches it at TWO points:
  `workspace.prepare` before the run reads its own set (the parent's lines from `--parent-plan`, or from the parent's own
  `update --installed-only --print-plan`; any doubt - a failed or blind read-back, a plan from another folder - leaves
  `parentLines` null, so nothing inherited is added or dropped) with `envPlan` (`ctx.childEnv`) telling the settings
  pass what a child seeds - only the defaults of its `ignore env` keys; the hook loader (`layout.variablesOf`) reads
  the rest from each member's `.variables` at load, never `MEMBER_NEVER` (the docs mode, the switch) nor a member's
  whole-hook `HOOKS_OFF` entry, and a 2.12 child's copies still at their ledger hash go - and `workspaceStep` after the settings pass -
  the `claudeMdExcludes` rows for every stamped folder above (linked or not) in `settings.local.json`, ledgered as array
  members, and the stamp's `own-picks:` / `own-env:` lines that tell a child's own from what it inherits; then
  `mcpHint` prints one `mcp <name>:` line per member's local-scope server this project cannot see - a hint, never a
  copy (D8; an earlier release's copies stay as the user's registrations, only their record goes). Joining prunes
  the child's own seeds a member answers (`pruneOnJoin`); leaving - configure's leave, or the parent's uninstall
  (`releaseChildren`) - first writes every value the child read through the chain into its own `.variables`
  (`keepOnLeave`), so nothing it reads changes. A child's
  `--drop` of a line its parent holds writes that `ignore` line and an `--add` of an ignored one lifts it
  (`recordWord`, never on `--print-plan`), so validate and a hand-run update stick; an install with `--parent-plan`
  adds the parent's set minus the ignores itself, whatever rows the walk's selection kept. It never
  writes a `child` line into a parent: only `workspace.js register` / `join` do, the back-reference being the consent.
  `scripts/workspace.js` is the one CLI the bodies call (`parent`, `register`, `unregister`, `join`, `role`, `ignore`,
  `children`, `status`, `account-instructions`, `plan`, `answer`, `cascade`, `check-loads`): init reads
  `references/init-role.md` beside `role --when init` and `references/init-child.md` only on its Child answer,
  every role change runs `role --answer <answer>`, update's step 2 reads `references/update-workspace.md` only when `plan` names a second project, a gone
  child or a rescan row, and `cascade` runs each child top-down from its parent's fresh read-back (a failed project
  skips its subtree, a run is failed on its summary line since the installer exits 0). `workspace.js` writes each
  line as it is made, so a cascade that outruns the Bash call's 10 minutes leaves the rows it finished, and the walk
  waits for a backgrounded one instead of starting a second. `check-loads` proves the excludes
  with one logged-out `claude -p` in a throwaway account: rules by the `InstructionsLoaded` events, AGENTS.md by the
  built-in plugin's debug lines - a `', '`-separated `loaded:` list in the default mode, and with the account key set
  only a kept count, checked against the files on disk (`docs/workspace-layering-evidence.md`). A local-scope child's
  init hygiene ask passes `git-hygiene.js --local-child`, which offers the data root whatever the docs mode and a
  `.prettierignore` the run created; update and configure pass no flag. Every workspace spawn of `process.execPath`
  goes through `rt.spawnCommand`, which on Windows takes a full path as that file (`resolveWin`, the release 1
  matrix). D5, the account's `instructionFiles` key, is asked once per
  account and ledgered as `managed-account:`; the last uninstall that records it removes it (`lastHolder`). The switch
  is `ALFRED_CODE_WORKSPACE` (`seed: false`, never written), ON by default from 3.0.0 (D9, `layout.switchValueOn`): a
  launch `0` freezes it whatever the files say, else the project's own value decides (settings.local.json, its
  `.variables`, the settings `env`, so a file `0` beats a launch `1`), else the launch value, and only a `0` turns it
  off; off freezes everything - no lookup, ask, cascade or delta, and nothing it wrote is removed.
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
  Never `rm -rf` a plugin-cache entry: that is the CLI's own plugin install. The bash snippet keeps its
  run marker and `$TMP` under `$TMPDIR` (`mktemp -d "$TD/alfred-code.XXXXXX"` - macOS `mktemp -d` alone
  ignores `$TMPDIR`): a sandboxed command writes only there and in the project.
- **The install is versioned, not the file.** `version:` exists only in plugin.json - a `version:` key on
  a skill/agent/rule is ignored; don't add one. Each run writes `alfred-code.stamp` (source commit, or
  the `v<version>` tag when the snapshot names none, + release version); configure diffs it via the GitHub compare API. A run whose source never resolved
  writes NO stamp.
