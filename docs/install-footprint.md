# Install footprint

Everything an Alfred Code run writes, starts and costs. The [README](../README.md) has the short version; this page is the full list, so you can check it before you install.

## In your project

Written at every scope:

- **`.claude/skills/` and `.claude/rules/`** - a copy of each skill and rule the project picked.
- **`.claude/hooks/`** - only the three engines (`docs.js`, `memory.js`, `history.js`) and the model-window table. The eighteen wired hooks come from the core `alfred-code` plugin.
- **`.claude/agents/`** - nothing on the default route. The seats come from the core plugin.
- **`.claude/settings.json`**
  - `permissions.deny` - one `Agent(alfred-code:<seat>)` for each seat the project did not pick.
  - the `env` block - the stack's own keys.
  - the `attribution` keys - commit, PR and session-link attribution off, each only where the project set none.
- **`.claude/settings.local.json`** - the same keys at local scope. At project or user scope too, for a stack key this file already holds, since it applies over `settings.json`.
- **`.claude/alfred-code.stamp`** - the source revision, your picks and a ledger of every write.
- **`.alfred/`** (the data root, `ALFRED_CODE_DATA_PATH`) - the docs, serena's `project.yml` and home config. Its own `.gitignore` keeps everything but the docs out of git, since the browser profiles there hold session cookies.

Written later, or only on one route:

- **`/alfred-code:init`** imports Claude's old memory notes once. Only after that import succeeds does it write `autoMemoryEnabled: false` into the same project file - never the account file.
- **`<repo>/.mcp.json`** is written only on the `ALFRED_CODE_MCPS_VIA_PLUGIN=false` route. The default run instead PRUNES every stack server from it.

## In your account

- **`~/.claude/settings.json`** - `env` keys only: `CONTEXT7_API_KEY`, when you give one. A secret is logged by length, never by value, and never asked for through the chat. `autoMemoryEnabled` never lands here, whatever the install scope.
- **The plugin cache** - `claude plugin install`, at EVERY scope, writes `~/.claude/plugins/cache/...` and `installed_plugins.json`.
- **claude-hud** - its marketplace add and its user-scope install.
- **User-scope installs** - every stack plugin row, at `--scope user`.
- **`~/.claude.json`** - only on the MCP copy route (`ALFRED_CODE_MCPS_VIA_PLUGIN=false`) at user or local scope, for its server registrations.
- **`/alfred-code:init`** additionally writes:
  - the account `statusLine`;
  - claude-hud's own `plugins/claude-hud/config.json` (add-only keys);
  - a `settings.json.bak.<time>` backup, taken before that run's first account write.
- **`~/.alfred-memory/`** - at the `global` or `scoped` memory level, `memory.db` (or `memory_<space>.db` under a `--space` profile). A 2.0.0 `~/.memory-mcp` is moved there by the memory server's launcher once idle, with a link left behind. The `project` level stays inside the project.

Nothing is written outside the project and the account-dir writes named above, and nothing is deleted that the run did not install.

## What runs

At install:

- One `claude plugin install` call per plugin: the optional third-party picks the project kept, `claude-hud` (installed beside the core on every run), the core `alfred-code`, and one plugin per MCP server the project keeps.
- No `claude mcp add` registration at all - the servers ride their own plugins. The opt-out route still makes up to eight.

At every session start:

- Each kept MCP server's launcher downloads and runs its pinned package through uvx or npx: `serena-agent`, `mcp-memory-service`, `@playwright/mcp`, `windows-mcp` or `macos-mcp`. Each runs at the release pin and, for uvx, the pins file's dependency cut-off.
- The navigation server fetches the language servers it needs at run time.

Once:

- In `/alfred-code:init`, to import old notes into the shared memory: a `uvx ... memory server` launch plus the `node scripts/memory-import.js` importer talking to it.
- Once per machine, while the memory service's embedding model is not cached yet: the same server started against a scratch database to fetch it. Setup or update runs it where uvx is present, else it is in init's plan. `ALFRED_CODE_MEMORY_WARM=0` switches it off.

Nothing else executes from the package itself. The package itself is seven command bodies, one skill (the `/alfred-code` router; none ships a script), forty-four agents, three references and twenty hooks - the core's own two (`guard-layer-table.js`, the table-before-question gate, and `library-stamp.js`, the startup line saying the library copies are older than the stack) and the eighteen stack hooks, eight of them run in-process by one dispatcher (`shell-guards.js`) on the shell tools and five by another (`file-guards.js`) on the file tools - with no MCP server, no `bin/` and no dependencies of its own.

## What you install by hand

- `csharp-ls` and `typescript-language-server`, for the two LSP plugins.

## Cost per message

The whole per-message floor - Claude Code's own prompt and tools, every plugin's and MCP server's share, and the stack's pathless rules plus every agent and skill description - was measured at 87k-134k tokens across nine installs. The stack's own always-on text was 12.6k-13.8k of it. `/alfred-code:status` reports your own install's number.

## Under managed settings

- **`strictKnownMarketplaces`** - add two `extraKnownMarketplaces` rows, `envoydev` and `claude-hud`. Both are needed on every run, since `claude-hud` is required, and only `claude-plugins-official` is known by default.
- **`enabledPlugins`** - one key for each plugin the project keeps; `alfred-code` and `claude-hud` always.
- **`allowManagedHooksOnly`** - silently disables all eighteen house hooks. The plugin still installs and enables, but no guard ever fires, and nothing reports it. Decide this one before rolling the stack out under a managed policy.

`ALFRED_CODE_HOOKS_OFF` is the supported way to switch individual hooks off.
