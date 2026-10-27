# Install footprint

Everything an Alfred Code run writes, starts and costs. The [README](../README.md) has the short version; this page is the full list, so you can check it before you install.

## In your project

Written at every scope:

- **`.claude/skills/` and `.claude/rules/`** - a copy of each skill and rule the project picked.
- **`.claude/hooks/`** - only the four engines (`docs.js`, `history.js`, `layout.js`, `handoff.js`) and the model-window table. The eighteen wired hooks come from the core `alfred-code` plugin.
- **`.claude/agents/`** - nothing on the default route. The seats come from the core plugin.
- **`.claude/settings.json`**
  - `permissions.deny` - one `Agent(alfred-code:<seat>)` for each seat the project did not pick.
  - the `env` block - the stack's own keys.
  - the `attribution` keys - commit, PR and session-link attribution off, each only where the project set none.
- **`.claude/settings.local.json`** - the same keys at local scope. At project or user scope too, for a stack key this file already holds, since it applies over `settings.json` - and custom memory's `autoMemoryEnabled: false` when this file holds the `ALFRED_CODE_MEMORY=custom` choice.
- **`.claude/alfred-code.stamp`** - the source revision, your picks and a ledger of every write.
- **`.alfred/`** (the data root, `ALFRED_CODE_DATA_PATH`) - the docs, the hooks' state, the seats' handoff notes and the secrets file (`.secrets`, `.sensitive-data` before). Its own `.gitignore` keeps everything but the docs out of git.

Written later, or only on one route:

- **`/alfred-code:init`** dates the stamp's `initialised:` line at its close. It never touches `autoMemoryEnabled` unless the project picks custom memory, and otherwise Claude Code's own memory stays as you set it. Custom memory writes `autoMemoryEnabled: false`, ledgered, beside the choice - into `settings.local.json` when that file holds `ALFRED_CODE_MEMORY`, so a personal choice never switches a teammate's memory off, else into the file the run writes. A personal choice never takes the team's switch-off out of `settings.json` while that file still says custom. An update or uninstall over an earlier release takes back the `autoMemoryEnabled: false` that release's init wrote.
- **`<repo>/.mcp.json`** is never written. An update over an earlier release takes the stack's own registrations out of it; a server of yours stays.
- **`.claude/settings.local.json`** gets claude-hud's `statusLine` from `/alfred-code:init` when claude-hud is installed for this project alone - the command names this machine's `node`, so it stays out of the shared file - after a `settings.local.json.bak.<time>` copy of the file, when it already exists.

## In your account

- **`~/.claude/settings.json`** - nothing the stack needs: it seeds no account key. `autoMemoryEnabled` never lands here, whatever the install scope - custom memory writes it into the project's own settings file. The CLI's own `claude plugin marketplace add` records each marketplace the run registers under `extraKnownMarketplaces` there (code.claude.com/docs/en/plugins/loading).
- **The plugin cache** - `claude plugin install`, at EVERY scope, writes `~/.claude/plugins/cache/...` and `installed_plugins.json`.
- **claude-hud**, when you keep it - its marketplace, registered for the whole account; its install is a user-scope one only when you choose global for it (this project by default).
- **User-scope installs** - every stack plugin row, at `--scope user`.
- **`~/.claude.json`** - never written by the stack. An update over an earlier release removes the local- and user-scope registrations that release recorded, through the CLI.
- **`/alfred-code:init`** additionally writes:
  - claude-hud's `statusLine`, for a claude-hud installed globally (one installed for this project alone gets it in the project, above);
  - claude-hud's own `plugins/claude-hud/config.json` (add-only keys);
  - a `settings.json.bak.<time>` backup, taken before that run's first account write.
- **No memory database.** The stack ships no MCP server since 2.10.1; a database an earlier release left (`~/.alfred-memory/`, `~/.memory-mcp`) stays where it is, and the update that took the server out names it.

Nothing is written outside the project and the account-dir writes named above, and nothing is deleted that the run did not install.

## What runs

At install:

- One `claude plugin install` call per plugin: the optional third-party picks the project kept - `claude-hud` among them, marked recommended in every walk - and the core `alfred-code`.
- No `claude mcp add` registration at all - the stack ships no MCP server.

At every session start: the enabled plugins load, an LSP plugin starts its language server, and the hooks run. No package is downloaded or launched by the stack.

Nothing else executes from the package itself. The package itself is six command bodies, one skill (the `/alfred-code` router; none ships a script), forty-five agents, sixteen references and twenty hooks - the core's own two (`guard-layer-table.js`, the table-before-question gate on the walk's asks and on its next `node` call, and `library-stamp.js`, the startup line saying the library copies are older than the stack) and the eighteen stack hooks, ten of them run in-process by one dispatcher (`shell-guards.js`) on the shell tools, seven by another (`file-guards.js`) on the file tools and the turn build check (`check-turn-build.js`) inside `history-session.js`'s Stop - with no MCP server, no `bin/` and no dependencies of its own.

## What you install by hand

- `csharp-ls` and `typescript-language-server`, for the two LSP plugins - each plugin names its server and ships none. `/alfred-code:init` offers both, through its one machine-install ask: `dotnet tool install --global csharp-ls` (the .NET 10 SDK first) and `npm install -g typescript-language-server typescript@6` - TypeScript 6, since TypeScript 7 ships no `tsserver.js`, the file the server reads; it needs Node 22.22.2 or later.

## Cost per message

The whole per-message floor - Claude Code's own prompt and tools, every plugin's share (and any MCP server you registered), and the stack's pathless rules plus every agent and skill description - was measured at 87k-134k tokens across nine installs. The stack's own always-on text was 12.6k-13.8k of it. `/alfred-code:status` reports your own install's number.

## Under managed settings

- **`strictKnownMarketplaces`** - the allowlist registers nothing, and Claude Code refuses to register a managed marketplace whose source it does not admit (code.claude.com/docs/en/plugins/org). Allow each source the stack installs from - `{ "source": "github", "repo": "envoydev/alfred-code" }`, `{ "source": "github", "repo": "anthropics/claude-plugins-official" }` for the `*-lsp` pair, and `{ "source": "github", "repo": "jarrodwatts/claude-hud" }` if you keep claude-hud (optional, recommended) - and register the same marketplaces in `extraKnownMarketplaces`: `envoydev`, `claude-plugins-official` and `claude-hud`, each with its matching `source`.
- **`enabledPlugins`** - one key for each plugin the project keeps; `alfred-code@envoydev` always, `claude-hud@claude-hud` when you keep it.
- **`allowManagedHooksOnly`** - silently disables all eighteen house hooks. The plugin still installs and enables, but no guard ever fires, and nothing reports it. Decide this one before rolling the stack out under a managed policy.

`ALFRED_CODE_HOOKS_OFF` is the supported way to switch individual hooks off.
