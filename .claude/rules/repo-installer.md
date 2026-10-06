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
  `settings`, `env-migrations`, `plugins`, `mcp`, `docs`, `serena`, `memory`, `seeds`, `pins`,
  `stamp`, `uninstall`, `runtime`, `json-file` - the one JSON reader, below), plus `claude-stack.js`, the entry shim a 1.x command body still calls against <!-- legacy-name -->
  a 2.0.0 snapshot (it runs `alfred-code.js`; keep it listed so it is never deleted as unlisted
  before the 2.x line ends). One `node` command on every OS, so no OS branch in the command bodies. The
  frozen shell twins are deleted (2.0.0) and `ALFRED_CODE_SEED=shell` refuses with one line.
  `meta/stack-manifest.json`, hand-edited, is the one source of the six lists the seed reads;
  `docs/alfred-code.html` is the browser inventory (lint check 60 runs `node --check` over its inline
  script: an unescaped quote in one row string left the page with no tables; check 60b holds every seat's
  `mdl` pin badge and row 'Pinned <model>/<effort>' to its frontmatter - 2.1.5 M57 - and a row's ', max <n> turns'
  to its `maxTurns`, 2.1.6 M59).

- `setup-plugin/` - the Alfred Code plugin: seven COMMANDS and one router SKILL.
  - `/alfred-code:setup` is the selection walk and the install (reports `derive-state.js`'s `written`
    block first) and ends on 'restart, then /alfred-code:init'; `/alfred-code:init` is the one-time
    bootstrap in the new session (`init-plan.js`: the machine installs behind one ask, the memory level
    - `scripts/install/memory.js init` imports Claude's old notes, switches its own memory off and
    writes the stamp's `initialised:` line - the captures, the AGENTS.md fill through
    `alfred-habits-adjust-agents-md`). `ALFRED_CODE_UNATTENDED=1` in the launch environment (never seeded - a
    settings value would apply over a launcher's) runs init with nobody answering: each ask takes its
    Recommended option unless it is destructive (loses or replaces what the project or account owns - a
    claude-hud `refresh` line) or needs a person (typed text, a restart), then the option that changes
    nothing, one `unattended: <question> -> <choice>` line each (init.md 'Unattended'; `init-plan.js`
    prints init's own four answers, `update-preflight.js` prints `unattended: on` for update's asks). Init
    reads the stack's files through the Bash tool, never the Read tool, which asks before a read outside
    the working directory. `/alfred-code:update`
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
    AGENTS.md check - `agents-md-check.js` rows offered to the skill's improve mode, no option recommended), `/alfred-code:uninstall`
    (the seed's `uninstall` over the stamp's ledger, below; user-scope plugin rows and MCP registrations printed, never run). In a git
    worktree of an installed checkout every command stops and names the main checkout. A legacy copy-route install that never
    wrote a stamp reads `legacy-unstamped` (`stamp.js legacySignature`: no install record, and TWO of the stack's hook files, a
    stack env key, three or more skill / seat / rule names only the stack uses - its `alfred-` / `project-` prefixes or a renamed
    item's old name, `manifest.js stackOwnName`, M3: a catalog name like `typescript` or `npm` is a project's own as often -
    never skills alone); update takes it as a pre-ledger install
    (picks off disk, old names renamed, docs move offered), setup asks once with update recommended, the rest route to update, and
    the hooks' record list is NOT extended, so they stay down until that update writes the stamp.
  - configure and validate never inventory by hand: `update --installed-only --print-plan --plan-out`
    writes the installer's own read-back as their `--installed` JSON (with `left_out` - denied seats,
    items of a parked retired entry - and `parked_plugins`, so the walk's closure cannot switch either
    back on), and they apply as `derive-state.js --delta` lines turned into `--add` / `--drop` over the same
    read-back. A drop runs BEFORE the closure: one something kept requires, or a locked always-on rule
    or server, is logged 'not applied'; a dropped seat is denied, a dropped hook named off, a
    dropped library copy deleted (a copy-route hook unwired too), and an MCP entry nothing kept needs
    is disabled at the run's own scope and route - on the copy route its registration removed where the ledger records it
    (at local and user scope with no row there, in the release template's exact shape) and its row with it, the user's own server under the name kept (review 2.1.6 M2) - never the core (which carries the
    hooks) or the three locked servers.
  - The seed prunes only the names in `meta/stack-manifest.json`'s `retired` block (skills, agents,
    rules, hooks, mcps, plugins), and a skill, seat, rule or hook copy only where the stack's own record holds it
    (the stamp's library hash, the ledger's row, or a name only the stack uses) and it still hashes to it - any other is the
    project's, kept and named with `!!` (`retiredKeep`) - add a name there when any of the six is renamed or removed (a
    stamp compare only names what left after the stamped commit). A renamed skill or seat also gets
    a `renamed` row (old -> new; a rule too since 2.1.6): update maps picks, denies, `skillOverrides` and selections by it.
    A retired PLUGIN also gets a
    `meta/retired-plugins.json` row (`retiredIn`, `addBack`): update uninstalls it only as
    `name@<row's marketplace>`, else `name@<stack key>` (`retiredSpec`), keeps a row at another scope
    and prints the add-back line - the path the five cut MCP servers took. An entry that CARRIED picks (the per-stack entries retired in 1.3.0) is named
    only in `meta/retired-entries.json`, since update copies its picks first. On the plugin routes the
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
    --table` catalog, the `plugin-settings.js` report or validate's install audit - and, inside a walk (a `stack-select.js`
    call since the typed prompt), a layer's own selection ask (`Agents: ...`, `Add to the installed skills?`) whose
    `--table <layer>` never ran (2.1.7, the user's report of 2026-10-06; its own valve of three per layer). It ships in the plugin because a fresh setup
    has no stack hooks yet; the rule text is pinned as `table-before-question`. It and `library-stamp.js` run the
    core's prelude gates from the plugin root (2.1.5 M4: the csv, `hook_profile: minimal`, the alias and a Cursor payload
    stand them down; GATE 4 is skipped, `setUp: false`, since the gate serves setup), and a layer-table denial writes a
    block row where the repo is set up; the Cursor-gate test takes its file list from the commands the core launches.
  - None of the seven carries `allowed-tools` - settled: it is a per-turn permission pre-approval, not a
    restriction or a context saving.

## The stack's delivery surfaces

All surfaces come from ONE source snapshot per run, so an install is a single revision (the one
`alfred-code.stamp` records).

| Surface | Delivery |
|---|---|
| Skills | LIBRARY copies of every pick in `.claude/skills`, the always ones included (2.1.0 - no plugin carries a stack skill; the core carries only the `/alfred-code` router), hashed in the stamp; `library-check.js` reports drift and staleness |
| MCP | the 9 generated `<server>@envoydev` plugin entries the project's closure reaches (`build-marketplace.js --mcp-entries`), plus the six pre-2.0.0 ids listed as RETIRED aliases for installs not yet updated; `ALFRED_CODE_MCPS_VIA_PLUGIN=false` restores `claude mcp add` -> `<repo>/.mcp.json` with its drift verify |
| Plugins | 2 OPTIONAL third-party picks (`claude plugin install`), the `*-lsp` pair, each suggested on evidence (`meta/evidence.json`) (`superpowers` left them in 2.0.0, never touched - R109; claude-md-management and security-guidance were RETIRED in 2.0.0 on the user's call, 2026-09-26, superseding R27 - `meta/retired-plugins.json`: the first update past 2.0.0 uninstalls each as `name@claude-plugins-official` at this run's scope and prints its add-back line, a row at another scope kept and named; a row put back after it is the user's own, `plugins.retirementDue`) - plus the REQUIRED `claude-hud` (user scope - its status line is account-wide), installed beside the core every run (`CORE_DEP_PLUGINS` = the manifest's parked rows, lint 51), never re-enabled once the user disables it (`install` would - measured on 2.1.282), statusLine + compact layout set by `/alfred-code:init` (`hud-statusline.js`) - plus the core. The core declares NO `dependencies`: `plugin update` installs none a release adds, a plugin missing one is disabled at load (measured on 2.1.280). Every run refreshes each marketplace its specs name once, reads each plugin as `name@marketplace`; install updates one already listed, update installs an absent one, enables a parked one, then updates, at the scope `claude plugin list --json` reports; `--installed-only` reads back only ENABLED stack entries (the core always is) |
| Hooks | folded into the core `alfred-code@envoydev` plugin (all eighteen, generated from the manifest's `hooks[]`); only `docs.js` / `memory.js` / `history.js` / `model-windows.json` are copied; instrumentation off via ALFRED_CODE_INSTRUMENT=0 |
| Agents | all 44 in the core plugin (2.1.0), every one the selection did not pick denied as `Agent(alfred-code:<seat>)` in the project `permissions.deny` - measured to leave the listing and the bill (spike S3, rebrand-evidence S6) - wherever the core loads, the skills copy route included; the full copy route (no core) writes none and copies the picked seats into `.claude/agents` (absence is off). An update reads the seats back off the core minus the denied, gated by the stamp's picks and the ledger's `managed-deny`, so a seat a release adds is offered, never on by itself; a retired entry's seat deny gains the core spelling, and keeps its own while that entry is still installed (Claude Code matches the exact home name), so the seat stays off |
| Installer | `node scripts/install/alfred-code.js <install|update|uninstall>` from the snapshot, one command on every OS |
| Install stamp | `alfred-code.stamp` in the project's `.claude/` at EVERY scope - source commit, `installed:` and `installed-ms:` (the write to the millisecond, which the account-file loss check compares a CLI backup with), `picked-skills` / `picked-agents` (only the PICKS, as `name@home` - a skill plain since 2.1.0, a seat `@alfred-code`: `--installed-only` unions them back so an item a release moves is kept; a stamp with neither line takes what the enabled entries carry), `seats-route` (`plugin` or `copy` - how the run delivered the seats; a stamp WITHOUT it is from before 2.1.0, and its first update reads the core as the always closure it then carried: the always skills become copies, a library seat copy is pruned - one edited since, or TUNED (a `model` / `effort` other than the stack's, which no setting can give the core's seat), is kept, its hash carried, and dispatched by its bare name: the capabilities rule's seats line is re-spelled to match (`selection.respellRosterSeats` - `alfred-code:<seat>`, bare for a kept copy) and its inventory lets a project copy win its name - and every seat the install never ran is denied), `library-skills` / `library-agents` / `library-rules` (`name=<sha256>` of each copy as written), `stood-down` (what the full copy route switched off here, `<scope>:<spec>` - the one thing a switch back enables), `mcp-held` (the copy route's MCP picks a local-, project- or user-scope registration of the user's own held back, `<scope>:<name>` - read back as picks, so the update after the name frees registers the stack's; re-verify 4 T7), the LEDGER `managed-env` / `-deny` / `-hooks` / `-mcp` / `-files` (what the run wrote, each at its hash and in the FILE it was recorded for - a move off `local` carries a deny row into settings.json only where that file did not hold it before, and with no ledger a secret-file deny is never claimed; `-mcp` records the copy route's local- and user-scope registrations with their scope; a settings or account file the run could not read keeps its rows as recorded. The CLI replaces an account `.claude.json` it cannot parse (a 0-byte one too; an array it rewrites in place) at its first plugin or mcp call - which every command's source step makes before the installer - keeping the old one as `backups/.claude.json.corrupted.<ms>` (measured on 2.1.284), so the ledger's rows at the copy route's registration scope stand, and are read back as picks, when the file is unreadable at the run's start, a corrupted backup is newer than the stamp (to the millisecond its `installed-ms:` line records; an older stamp's whole second otherwise), or the file holds none of them and is a rewritten one - no entry for this project, or a fresh file with no `firstStartTime` from before the stamp - so the user's own removal of every registration stands (`mcp.accountLoss`, matrix 2.1.5 F1, review 2.1.6 B1 and re-verify), said in one line before the first registration. An unreadable one is met at the start by a recovery call nothing reads (the call that meets it answers with the CLI's notice and none of its own output), trusted only when it leaves a new backup. A registration the ledger does not record is taken back only as an earlier release's loss, every sign together (review 2.1.6 re-verify 2 R1): a stamp from a release that could lose rows (no `installed-ms:` - so a configure drop made since is never undone), a corrupted backup newer than the project's set-up - its `initialised:` time, or for a stamp init never dated the stamp file's own birth, since the stamp is rewritten in place (the lossy run wrote its own `installed:` just after the backup it made), the release template's exact shape (`mcp.exactStack` - its words and env keys, free only in a pin, the cut-off date, the python and a path; re-verify 3 S1) carrying the stack's marks (`mcp.stackAuthored` - the release's cut-off with a pinned package, a desktop server's telemetry off, an engine's profile with `--no-webmcp` where `browser-engines:` lists it), and a server whose skill or engine the stamp records. The CLI keeps every corrupted copy it makes (none pruned, and none made for content it already backed up - measured on 2.1.284); with any sign missing nothing is adopted, and a registration of the stack's own package and marks is named with `/alfred-code:configure` as the way back. Update removes what the release stopped writing, a value changed since is the user's and kept; uninstall removes only these - a local-scope registration through the CLI, a user-scope one printed; over an account file unreadable at its start, or replaced since the stamp, it refuses before any change while the file holds none of the recorded registrations, naming the backup that holds them and `/alfred-code:update` as the other way out - a copy put back ends the refusal (review 2.1.6 m3, re-verify N1); at user scope the seat denies and `ALFRED_CODE_HOOKS_OFF` stay, the core still loading - and refuses a stamp with none, or a plugin listing it cannot read, before any change), `data-root:` / `data-pending:` / `data-move: kept` (the data root in effect, the server-data moves owed to a launcher, a kept layout - below), and `initialised:` - `pending` until init dates it (or the next run, on an older stamp with memory already off); configure diffs it against `main`. Scopes are `project`, `user` and `local` (`global` is read as `user`): the stamp and every copy stay in the project, the scope says where plugin rows are enabled (`user` makes every plugin / MCP call user-scoped), and `local` writes the stack's settings to `settings.local.json`. At every scope the stack keys `settings.local.json` holds are read over `settings.json`, and a write to one goes back there (R99). A 1.x account-dir stamp is read by update (which moves it into the project), `--print-plan` (configure and validate's read-back), `update-preflight.js`, `library-check`, `stamp.js state`, `stamp.js scope` (`installScope` falls back to it, A-I1), and the `library-stamp.js` SessionStart hook (B-I1) |
| Convention gate | nine path-scoped convention rules in `.claude/rules/` |
| Security review | `/security-review` + the `security-auditor` agent + the pre-commit checkpoint's security half (`alfred-habits-commit-checkpoint`) |
| Project instructions | `AGENTS.md` (seeded to `.claude/AGENTS.md`) |
| LSP | `csharp-lsp` / `typescript-lsp` plugins |

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
  manifest words; a server the project added by hand is never touched. At local and user scope the run removes or
  re-registers only a registration it vouches for (`vouchedAt`: the ledger's row there at its hash, or with no row at
  that scope the release template's exact shape, `mcp.exactStack`), so the user's own server under a picked or left-off
  name is kept and named with `claude mcp remove <name> -s <scope>` - a fresh local install included (re-verify 3 S4,
  S7). A PICKED name held that way stays a pick: the stamp's `mcp-held:` line records it (`<scope>:<name>`, the ledger
  lists only what the stack wrote), the read-back takes it as a pick, and its one line says the first
  `/alfred-code:update` after the user removes theirs registers the stack's (re-verify 4 T7). `verifyUser` names the run's
  scope in its lines (S8); an unreadable settings or `.mcp.json` file is said as `could not be read (<code>)`, a parse
  error as 'not valid JSON' (S9). At project scope (`.mcp.json`) the same held rule applies, judged by the ledger's `mcp` row
  rather than a hash: a name the ledger LISTS is the stack's whatever the row holds now (an edit to it is still repaired -
  the documented drift repair), and one it does not list, or with no ledger one that is not the release template's exact
  shape, is the user's own - kept, named with `claude mcp remove <name> -s project`, recorded as `project:<name>` in
  `mcp-held:`, never ledgered and never named in `enabledMcpjsonServers` (matrix F-OWN, 2.1.6; a `.mcp.json` row of the
  older shape with no ledger - a 1.x install - is held the same way until its owner removes it). At local scope (and user scope on the MCP copy route), where the stack registers in the account file, a project `.mcp.json` row of the
  user's own under a picked name is held the same way (`project:<name>`, the `-s project` hint) - it outranks the account row, so nothing is
  registered over it. A held row is never ledgered (`ledgerOf`'s no-ledger adoption skips it) and stays held on every later update until it is
  exactly the stack shape or the user removes it (delta F-LOCAL, F-LEDGER). A `.mcp.json` that cannot be read (garbage, EACCES) is no empty
  selection: the read-back keeps the picks the ledger recorded, the ledger and the `mcp-held:` line stand as recorded, one line says so, and
  restoring the file restores the install; a MISSING file is still empty (delta F-UNREAD). The plugin route writes
  nothing there, so an own row under a picked name is only named (`mayPrune`'s line). Every JSON file the installer parses
  that a person may edit (`.mcp.json`, `settings*.json`, the account's `.claude.json`) goes through ONE reader,
  `install/json-file.js` (`parseJson` / `readJson`; the scripts that read the same files - `stack-select.js`, `plugin-settings.js`,
  `analyze-usage.js`, `library-check.js`, `audit-install.js`, `hud-statusline.js`, `agents-md-check.js` - use it too, and all run from
  the whole tree, so it ships beside them): a leading BOM is stripped, and anything else wrong - a BOM plus
  garbage included - still throws, so it is still unreadable. A BOM'd `.mcp.json` read as empty before (a bare
  `JSON.parse`), and once `keepMcpOrder` kept the BOM every update dropped a pick and its `enabledMcpjsonServers` entry
  (matrix F-BOM, 2.1.6); a new reader of such a file uses the helper, never a bare parse. At project scope, after the CLI writes `.mcp.json`, the file gets its own bytes back when
  its content did not change, and otherwise keeps its BOM, line ending, indent and key order and every top-level key
  besides `mcpServers` (`mcp.keepMcpOrder`, re-verify 4 T4). `scripts/install-mcp.test.js` pins it on the seed.

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
