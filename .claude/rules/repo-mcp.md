---
paths:
  - "stack/mcp/**"
  - "meta/mcp-*.json"
  - "scripts/install/mcp.js"
  - "scripts/lint-mcp-tools.js"
  - "scripts/refresh-mcp-pins.js"
  - "scripts/build-marketplace.js"
---

# MCP servers

One plugin per server, the tool-name rule, scopes, the navigation server, project-root anchoring and the pinned Python. Moved here verbatim from the repo `CLAUDE.md` so it loads only when you edit these files.

- **Every MCP server ships as its OWN plugin, and the tool names say so.** ONE PLUGIN, ONE SERVER,
  SAME NAME (lint check 53): a plugin server's tools are `mcp__plugin_<plugin>_<server>__<tool>`, so
  every shipped tool name is `mcp__plugin_<n>_<n>__<tool>`, and lint check 54 fails on a bare
  `mcp__<server>__` under `stack/`, `setup-plugin/`, `meta/` or `scripts/` - today's servers and every name
  `renamed.mcps` / `retired.mcps` left behind (it resolves to nothing: a
  `tools:` allowlist silently drops the tool, a `ToolSearch select:` line finds none); check 59 fails
  on a plugin spelling whose plugin ships no server there - a renamed server's old spelling; check 62 fails
  on one whose TOOL its pinned server lacks (`meta/mcp-tools.json`, each server's tool names at its pin, written
  by `refresh-mcp-pins.js --write`), so a pin bump that renames a tool is a finding, not a silent drop. All three
  live in `scripts/lint-mcp-tools.js`, and a deliberate fixture line carries `mcp-fixture` in a comment. A plugin's
  servers LOAD TOGETHER, so a second server in one entry would put a second set of tool schemas in
  every session. The entries are GENERATED (`scripts/build-marketplace.js --mcp-entries`, from
  `meta/mcp-pins.json`); `ALFRED_CODE_MCPS_VIA_PLUGIN=false` restores the 0.2.x registration route for
  the browser, on which the installer re-spells the copied skills, agents, rules and hooks to the bare
  names a registration writes - that needs the FILES, so the switch belongs with
  `ALFRED_CODE_SKILLS_VIA_PLUGIN=false` (a mixed pair is reported, never half-fixed). A seat's
  `skills:` preloads are bare in the source since 2.1.0, so a copied seat resolves the project copies
  on every route (the full copy route's `alfred-code:<skill>` re-spelling has nothing left to do). The LOCKED THREE
  are plugin-only whenever any plugin route is on: installed beside the core (never as its
  `dependencies`, see the Plugins surface) and never also registered, which would run each server
  twice. No MCP entry declares `dependencies` at all (2.1.4, I7): Claude Code refuses to disable a plugin
  an enabled one depends on ('... is still required by ...', measured on 2.1.284), so a browser or
  desktop entry naming the core blocked the full copy route's core stand-down and a user's own core
  disable, for a core that carries nothing those servers need. They come back to `.mcp.json` only on the FULL copy route, at every scope - never `mcp add
  --scope user`; every registration and verify
  pass skips a locked name while the core is on. A switch onto that route disables the core and the
  locked three first, and copies every seat the core carried, a denied seat excepted - that route reads
  them from the disk, where a plugin-route install holds no seat. At `user` scope
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
  `navigation` (alfred-navigation), `documentation`
  (alfred-quality-gates) and `memory` (alfred-memory) are LOCKED into every install and may be
  named in artifacts; every other server is droppable, so a body describes it. Only those three are
  seeded everywhere; the rest arrive by proof - a stack whose surface always has them, an evidence
  signal, or the user's pick. The names are ROLES; prose names the role and gives the upstream once
  where a reader needs it ('the navigation server (Serena)'). A backticked `browser` is no graph edge
  (`stack-graph.js` MCP_COMMON_WORDS): the word is too common to prove a need. Catalog of 6 names, 9 plugins:
  - `browser` (Playwright MCP) - seeded for web-angular / ionic / extension, evidence-proven elsewhere. One catalog
    entry, expanded after the selection into ONE PLUGIN per kept browser (`browser-chrome|msedge|firefox|
    webkit`, each started through `stack/mcp/browser-launch.js` with `--browser <engine>` + profile
    `<data root>/browser/<engine>` - a 2.0.0 `.playwright/<engine>` serves until its move; firefox/webkit downloaded at the
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
    registers it (R124); an earlier registration under its name goes only where the stack vouches for it (the ledger's
    row there at its hash, or with no row at that scope the release template's exact shape), the user's own kept and
    named with its remove command (re-verify 3 S4). `enabledMcpjsonServers` names only the `.mcp.json` servers the run registered
    and lets load - never a plugin-carried locked server or an engine left off. A legacy 1.x `playwright` server
    migrates. Both routes start Playwright MCP with `--no-webmcp` (the launcher's argv, the copy route's
    manifest row): 0.0.82 collects and lists the tools a visited PAGE registers through WebMCP by default,
    and a page is data, never a toolbox. The browser agents grant all four, each minus `browser_run_code_unsafe`
    (RCE-equivalent) through their `disallowedTools`, which Claude Code applies before `tools` resolves
    (code.claude.com/docs/en/sub-agents). The data root's own `.gitignore` keeps the profiles out of
    git (they hold session cookies); a 2.0.0 `.playwright/<engine>` still in use gets `.playwright/.gitignore` (`*`).
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
    on macOS, uv when missing). Windows-MCP starts with `--exclude-tools PowerShell,Registry,Process,FileSystem`
    (2.1.4, I10: FileSystem writes, moves and deletes where no house guard looks);
    `ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE` replaces the list (`none` lifts it) - read by the launcher from
    the shell and the three settings files, and on the copy route resolved into Windows-MCP's own
    `WINDOWS_MCP_EXCLUDE_TOOLS`; each name is checked against the pinned tool list (`desktop-launch.js WINDOWS_TOOLS`,
    held equal to `meta/mcp-tools.json`: case mended, an unknown one named and dropped, a list naming none keeps the
    default), and Windows-MCP's own `WINDOWS_MCP_TOOLS`, which OVERRIDES the list, never reaches it - the launcher
    drops it from the child's environment and the copy route registers it empty (2.1.5 M41). The gate is by tool NAME, so `App` stays whole, and its `launch_executable`
    mode starts any program: a house guard denies that mode and every MacOS-MCP `Shell` call unless
    `<docs-path>/flow/DESKTOP-EXEC-ALLOW` allows it. MacOS-MCP 0.4.6 has no exclude flag; its own config.toml `[tools] exclude` removes a tool, which the stack does not write, and it runs as `macos-mcp serve` (with
    no subcommand it exits with usage, measured); it checks its Accessibility grant (and a System Events
    probe it calls Screen Recording) before it serves and EXITS when one is missing - the server fails to
    connect and System Settings opens - unless `MACOS_MCP_SKIP_PERMISSION_CHECK=1` starts it ungranted. On
    the copy route a desktop server's plugin row goes the engine way (I8, `engineStandDown`): uninstalled
    at the run's scope before its registration, or at user scope on the FULL copy route switched off in
    this project only and recorded in `stood-down:` - left on, it ran a second UI-automation server beside
    the registration. `ALFRED_CODE_PLATFORM` (or stack-select's `--platform`)
    stands in for the OS where a run must be judged as another's - the tests and the temp-project matrix.
    Both start their upstream with `ANONYMIZED_TELEMETRY=false` (the entries' `env`, the copy route's
    registration): both wheels read it, defaulting to `true`, and send PostHog usage events otherwise.
    Each server brings the `desktop-automation` skill through the graph (the 'Select a skill by DESCRIPTION' invariant in `CLAUDE.md`). `wpf-verifier`, `winforms-verifier`
    and `evidence-gatherer` hold only its read-only observe tools (Windows `Snapshot` / `Screenshot` / `WaitFor`,
    macOS `Snapshot` / `Wait` - the pinned wheels' readOnlyHint tools that look at the desktop), named in `tools:`
    and described in the body, so no graph edge pulls the opt-in server into an install; a stack that seeds a
    server no seat of it holds is listed main-thread-only in `scripts/seat-grants.test.js` (browser-extension's browser).
  - plus `navigation` (Serena), `documentation` (Context7, the hosted remote only - its `Context7-API-Key` header, the name
    Context7 documents (2.1.5 M25: a proxy may drop a header name with an underscore, and a keyed user with it), expands
    `CONTEXT7_API_KEY` from the ACCOUNT settings.json `env`, keyless = the free tier) and `memory`. 2.0.0 cut `angular-cli`,
    `chrome-devtools`, `appium-mcp`, `sentry` and `context7-local` (manifest `retired.mcps`,
    `meta/retired-plugins.json`): update uninstalls each only as `name@<stack key>` and prints its
    add-back line.
  - **The 2.0.0 rename** (`meta/stack-manifest.json` `renamed.mcps`, the one table): `serena`,
    `context7` and `playwright-<engine>` are `navigation`, `documentation` and `browser-<engine>`, plugin
    and server alike. The old ids stay LISTED as RETIRED aliases carrying their successor's server under
    the old name and no dependency (I6: their audience has no 2.x core, so a dependency on it stops the
    alias's server loading) (`build-marketplace.js mcpAliasEntries`, held by lint 53), so an install not yet updated
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
    the generated project files are re-spelled (`selection.respellRenamed`; a seeded AGENTS.md / CLAUDE.md only while the ledger
    still holds it at its hash - the user's own is named, never rewritten). The old flags
    (`--playwright-browsers`, `--playwright-enabled`) and stamp lines (`playwright-browsers:`,
    `playwright-enabled:`) are read for one release.

- **The navigation server (Serena) self-activates via `--project-from-cwd`** (finds `.serena/project.yml` or `.git` walking
  up from its cwd); a project with no `.git` of its own whose folder has moved under the data root gets
  `--project <cwd>` from the launcher instead (the literal directory, not the failed expansion below), and the
  copy route registers `--project .` there (`@SERENA_PROJECT_FLAG@ @SERENA_PROJECT_DIR@`, serena resolving it against
  its cwd - 2.1.5 M26). Its
  AUTO-GENERATED config is not a substitute (empty language list filled async, only the top language
  enabled), so the installer SEEDS serena's `project.yml` (`<data root>/serena/`, or a 2.0.0 `.serena` not
  moved yet) on install and update: project name, the `language_servers` their own scan detects (C#,
  TypeScript/JS), and `ignored_paths` for the data root, `.claude`, `.serena` and `.playwright`. A key that
  already has entries is never rewritten - except the stack's own value (2.0.0's or the data-root shape),
  which follows the root - and never appended twice (a duplicate YAML key is an error). The key was renamed from `languages` in serena 1.7.0; the C#
  Roslyn server needs .NET 10+ (serena installs it into `SERENA_HOME`). Two approaches FAIL - do not
  retry: (1) an `mcp_tool` `SessionStart` hook calling `activate_project`; (2)
  `--project ${CLAUDE_PROJECT_DIR}`. `.mcp.json` DOES expand `${VAR}` / `${VAR:-default}`, but
  `CLAUDE_PROJECT_DIR` is not reliably in scope at parse time, and expansion reads only the shell
  environment plus the ACCOUNT settings.json `env` (an unset `${VAR}` stays literal with a
  `claude mcp list` warning). Cursor runs serena with `--context ide-assistant`. Claude runs it on the
  stack's own context, `stack/mcp/navigation-context.yml` (2.1.4, I12 - ruling 'Keep rename + safe
  delete'): serena 1.7.0's `claude-code` context (its six exclusions, `single_project`, structured output
  off) plus `replace_content`, `replace_in_files`, `replace_symbol_body`, `insert_after_symbol`,
  `insert_before_symbol` and `onboarding` off - writes no Edit/Write-matched hook sees - with
  `rename_symbol` and `safe_delete_symbol` kept, and a prompt that sends edits to the harness tools
  (never calling Edit forbidden). serena reads `--context <path>` as a custom context file
  (`context_mode.py`: a separator or a `.yml` suffix). The plugin entry keeps `--context claude-code` and
  `serena-launch.js` swaps in the file beside it (`contextArgs`) - an entry naming the file would stop a
  project whose plugin cache predates it, since Claude Code launches the refreshed entry against the
  installed version. The full copy route copies it to `.claude/navigation-context.yml` (beside the
  `.mcp.json` that names it, so a clone carries both) and registers `--context .claude/navigation-context.yml`
  (`@SERENA_CONTEXT@`; 2.1.5 R6: serena fails CLOSED on a context path that does not resolve, so the row starts at the
  checkout through `ROOT_BOOT` and the relative path resolves there - re-verify 3 S3; a snapshot without the file keeps
  `claude-code`); the
  verify pass reads the same token, the ledger's `managed-files` records the copy, and a run that no
  longer registers navigation (a plugin route) removes an unchanged copy, as uninstall does.
- **Every project-anchored server starts at its project root, whatever the launch directory** (re-verify 3 S2, S3;
  re-verify 4 T1-T3). Claude Code starts a server in the directory the session was launched from, a subdirectory included,
  and an inherited `CLAUDE_PROJECT_DIR` names whatever folder the shell had. `stack/hooks/memory.js projectRootOf` is the
  one answer, bounded the way hook-prelude's set-up gate reads a folder: the git top level (`gitTopOf` - the first `.git`
  at or above the launch directory that this user owns, git's own safe.directory rule, never a home or above one), and
  the `checkout` is the nearest folder between the two holding an install record (hook-prelude's list, pinned as
  `install-records`), else that top level; with no git it is the launch directory alone. Nothing above the top level is
  read - a record or engine planted in a shared ancestor redirected the database, serena and the memory tag, and ran
  (T1). A linked worktree's `project` is the main checkout whenever that one holds a record, whatever the worktree
  carries, so both routes open main's project database (T2). The four plugin launchers read it (browser, navigation and
  desktop at the `checkout`, memory at the `project`), as do `memory-session.js` and the engine's CLI verbs (`level`,
  `export` and the rest - T3); no launcher reads `CLAUDE_PROJECT_DIR`. The copy route's navigation, browser and memory
  rows start as `node -e <ROOT_BOOT> -- <checkout|project> <command> ...`: a constant that reads the launch directory the
  same bounded way. A `checkout` row starts the command itself (through `cmd /d /s /c` on Windows) at the folder holding
  the nearest copied `.claude/hooks/memory.js`, else the git top level, else the launch directory - it runs no project
  code, so a user-scope row runs nothing a repo ships and a repo never set up starts at its own top level. A `project`
  row hands over to that engine's `runAtRoot` (in a linked worktree with none of its own, the main checkout's), which
  starts the server at the project and resolves the database there; with no engine it says one line on stderr naming
  `/alfred-code:update`. So the committed `.mcp.json` holds only project-relative paths, the same in every checkout, and
  no parse-time variable. An account-level memory database (global, scoped) is always committed as
  `~/.alfred-memory/<file>`, and `runAtRoot` resolves it on the machine that starts the server (the engine's
  `liveDbPath`: the new place, else an unmoved 2.0.0 `~/.memory-mcp` twin - T6), so each teammate's checkout gets its
  own right path; a local- or user-scope registration keeps the absolute path. `mcp.identityOf` reads the server after
  the anchor (`serverWords`); `mcp.exactStack` vouches only for an anchor running this release's `ROOT_BOOT` or one
  `FORMER_ROOT_BOOTS` lists, and for an engine profile under this project (T5) - a release that changes `ROOT_BOOT`
  lists the old one there, or every row it registered reads as the user's.
- **The navigation server's state is isolated per project** under the data root: `SERENA_HOME` is
  `<data root>/serena/home` (the launcher sets it; the copy route registers it), and serena's per-project
  folder - the index cache, `memories/`, `project.yml` - is `<data root>/serena`, named by
  `project_serena_folder_location` in the home's own `serena_config.yml` (serena 1.7.0 has no flag for it;
  `data-root.js ensureSerenaConfig` writes it absent-only and follows the root only over the stack's own
  value, never a user's central path). The data root's `.gitignore` keeps it out of git (LSP cache ~327MB
  for C#); a 2.0.0 `.serena/` still in use keeps its own `.gitignore` (`*`), widened from serena's
  narrower one (`/cache`, `/project.local.yml`), any other text the project's.
- **Every uvx-launched server runs on a PINNED Python** - `stack/mcp/uv-python.js` is the one answer: `3.13`,
  the x64 `cpython-3.13-windows-x86_64-none` on Windows on ARM; `ALFRED_CODE_UV_PYTHON` overrides,
  read from the shell, then `settings.local.json`, `settings.json` and the account settings (a plugin
  server never gets a project settings env key). uvx takes the newest interpreter, and serena-agent's
  pyyaml 6.0.2 ships no 3.14 wheel, so an unpinned start dies without a C compiler (Claude Code shows
  only CONNECTION_CLOSED); Windows ARM64 has no wheel for five compiled deps on ANY Python, while the
  x64 build runs there under emulation. Every such plugin entry starts through a node launcher
  (`serena-launch.js`, `memory-launch.js`, `desktop-launch.js`; the browser engines' npx through
  `browser-launch.js`, for the profile's place) because the right value is the MACHINE's
  (windows-mcp 0.8.6 already needs 3.14, so `refresh-mcp-pins.js` takes the newest release the pinned
  Python can install); the copy route
  resolves `@UV_PYTHON@` into `.mcp.json`. Never hand-patch a cached entry - the next refresh
  overwrites it (`docs/uv-python-pin-evidence.md`). The serena launcher keeps `SERENA_HOME` RELATIVE
  in the platform's separator, and the copy route registers `.alfred\serena\home` on Windows
  (`@SERENA_HOME@`) - which is why the data root may hold no space: serena 1.7.0 execs its TypeScript server through npm's `.bin` shim, so cmd.exe
  gets the path UNQUOTED and cuts it at its first `/` (an absolute one at the first space). Both
  launchers pass a stop signal on to uvx (`runUvx`), or the server outlives them. The pin fixes only the top
  package, so every uvx start also takes the release's dependency CUT-OFF (2.1.5 M24): `--exclude-newer
  <refreshed>T23:59:59Z`, the pins file's own day (uv takes only what was uploaded before it -
  docs.astral.sh/uv/concepts/resolution), passed by each plugin entry to its launcher beside the pin it was
  generated with (an older launcher ignores the flag), resolved into the copy route's rows (`@UV_EXCLUDE_FLAG@
  @UV_EXCLUDE_NEWER@`, two words dropped when the day is missing) and spelled into init's and the docs' index
  command; a `UV_EXCLUDE_NEWER` the user set (the env, then the three settings files - `uv-python.js
  userExcludeNewer`) replaces it everywhere: the launcher hands it to uv, the copy route registers it and init's
  index command spells it, `false` meaning no cut-off (a mirror that publishes no upload time serves nothing under
  one - the post-install connect check names the escape). `refresh-mcp-pins.js` also REFUSES a serena bump (exit 1, the pin kept) until the new release's
  `claude-code.yml` hashes as the `# upstream:` line in `navigation-context.yml` records - re-diff, re-record,
  refresh (2.1.5 R7).
