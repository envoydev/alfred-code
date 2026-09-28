<p align="center">
  <img src="docs/assets/alfred-code-logo.png" width="320" alt="Alfred Code - a butler in black and white">
</p>

<h1 align="center">Alfred Code</h1>

<p align="center">
  <em>The house rules, the right tools and the checks - set up before Claude Code starts work.</em>
</p>

<p align="center">
  <a href="https://github.com/envoydev/alfred-code/releases"><img alt="release" src="https://img.shields.io/github/v/release/envoydev/alfred-code"></a>
  <a href="LICENSE"><img alt="license: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <img alt="node >= 22.12" src="https://img.shields.io/badge/node-%E2%89%A5%2022.12-339933">
</p>

Alfred Code is an installable stack for [Claude Code](https://claude.com/claude-code): house skills, subagents, rules, hooks and MCP servers, applied to the projects you actually work in. This repo is the single source of truth - a project pulls from it and never owns a copy. Its twin for Cursor is [`cursor-stack`](https://github.com/envoydev/cursor-stack), a separate repo with its own skills, agents and installers.

## What you get

- **Conventions that attach themselves.** A rule glob-attaches the right house-style skill when you open a `.cs`, `.ts` or template file - no prompting for it.
- **Deterministic guards, not reminders.** Hooks block a force-push to a protected branch, a catastrophic `rm`, a whole-file dump, a secret value read, an unapproved dispatch and an ungated commit.
- **Build workflows with a gate.** A designer, implementer and verifier seat per stack; cross-domain work ends at a read-only integration reviewer.
- **Wired tools.** Symbol navigation, current library docs, shared memory and browser automation, one plugin per server.
- **A guided install.** It reads your manifests, shows what the project needs and why, and writes one stamp recording the exact source revision.

## Stacks

| Stack | Covers |
| ----- | ------ |
| .NET / C# | ASP.NET web and API, WPF, WinForms, console workers, bots, daemons and CLIs, Windows services |
| Angular / TypeScript | web frontend, Ionic / Capacitor hybrid mobile, browser extensions |
| SQL | PostgreSQL, SQLite, SQL Server: schema, migrations, query conventions |
| DevOps | Docker, GitHub Actions |

## Install

```
cd <your-project>
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin marketplace add envoydev/alfred-code
claude plugin install alfred-code@envoydev --scope project
```

Then, in Claude Code: `/alfred-code:setup`, restart, `/alfred-code:init`. Per-project is the default to prefer - each repo pins exactly what it uses. Requires **node >= 22.12**, the **claude** CLI and **git**; the run checks the rest and warns, never fails.

## Commands

| Command | What it does |
| ------- | ------------ |
| `/alfred-code:setup` | fresh install: reads the project, shows what it needs and why, walks the selection layer by layer, ends on a restart |
| `/alfred-code:init` | one-time bootstrap in the new session: services the MCP servers need, memory level and note import, captures, CLAUDE.md fill |
| `/alfred-code:update` | refresh an install to the newest release and prune what upstream removed |
| `/alfred-code:configure` | add or drop items, at any scope |
| `/alfred-code:validate` | reconcile an install to this project: drop what its stacks do not use, add what they lack |
| `/alfred-code:status` | read-only view: what is enabled, whether it runs, what was used |
| `/alfred-code:uninstall` | remove what the install ledger says the stack wrote, and nothing of yours |

## What is inside

| Surface | Count | What it is |
| ------- | ----- | ---------- |
| **Skills** | 89 | house conventions + workflow skills: every pick, the always-on ones included, is a copy in `.claude/skills/` - switchable per project |
| **Agents** | 44 | model/effort-pinned subagents: all ride the core plugin, and every seat the project did not pick is denied in `permissions.deny` |
| **Rules** | 20 | always-on baselines + path-scoped conventions, `.claude/rules/` |
| **Hooks** | 17 | deterministic guards (a weakened check config among them), a log-only session monitor, a turn-end build check (off by default), the architecture docs hook, the shared-memory session hook, a machine-local session history, and an env-gated usage instrument (off by default), shipped inside the core `alfred-code` plugin; only the three engines and the model-window table land in `.claude/hooks/` |
| **MCP servers** | 4 | one plugin each, named for its role - navigation (Serena), documentation (Context7), memory, browser (Playwright MCP) - 7 entries, the browser one per engine; plus two opt-in desktop servers, windows-desktop (Windows-MCP, seeded for WPF and WinForms) and macos-desktop (MacOS-MCP), each offered on its own OS only; the project's closure enables its own |
| **Plugins** | 2 + the stack's own | two optional third-party picks via the `claude` CLI, the LSP pair, each suggested on evidence (a `*.csproj`, a `tsconfig.json`) - plus `claude-hud`, which every install carries beside the core (`claude-hud` at user scope - its status line is account-wide), and the core `alfred-code` itself - every seat, the `/alfred-code` router and every hook |

The full inventory of every skill, agent, rule and hook is [`docs/alfred-code.html`](docs/alfred-code.html).

## How it works

- **One source per run.** Every surface comes from one snapshot (the plugin cache, else the release archive, else a shallow clone), so an install is a single revision, recorded in `.claude/alfred-code.stamp`.
- **Skills in the project, seats in the core.** Every skill you pick, the always-on ones included, is a copy in `.claude/skills/` you can switch off per project; every seat and hook rides the `alfred-code` plugin, and a seat you did not pick is denied.
- **Evidence over guesses.** A manifest scan (`*.csproj`, `package.json`) pre-selects the specialist skills the project provably uses, with the matched signal as the reason.
- **Nothing hidden.** The table below is the whole trust surface.

## What a run actually touches

| | |
| --- | --- |
| **Writes, in the project** | at every scope: `.claude/{skills,agents,rules,hooks}/` (hooks: the three engines and the model-window table only - the seventeen wired hooks come from the core `alfred-code` plugin; skills and rules: the copies of this project's picks - the seats come from the core plugin), `permissions.deny` in `.claude/settings.json` (one `Agent(alfred-code:<seat>)` per seat the project did not pick), the `env` block of `.claude/settings.json` and its `attribution` keys (commit, PR and session-link attribution off, each only where the project set none) (`settings.local.json` at local scope - and at project or user scope too, for a stack key that file already holds, since it applies over `settings.json`), `.serena/project.yml`, `.playwright/.gitignore` (`*` - the browser profiles hold session cookies) when a browser engine is kept, and `alfred-code.stamp`; `/alfred-code:init` then imports Claude's old memory notes once and, only after that import succeeds, writes `autoMemoryEnabled: false` into that same project file - never the account file; `<repo>/.mcp.json` only on the `ALFRED_CODE_MCPS_VIA_PLUGIN=false` route, which the default run instead PRUNES of every stack server |
| **Writes, in the account dir** | `~/.claude/settings.json`'s `env` keys (`CONTEXT7_API_KEY` - a secret is logged by length, never by value, and never asked for through the chat) - `autoMemoryEnabled` never lands here, whatever the install scope; every run's own CLI calls also write there - `claude plugin install` at EVERY scope writes the account's plugin cache (`~/.claude/plugins/cache/...`) and `installed_plugins.json`, the `claude-hud` marketplace add and its user-scope install, and, on a user-scope install, every stack plugin row at `--scope user`; the MCP copy route (`ALFRED_CODE_MCPS_VIA_PLUGIN=false`) at user or local scope writes the registration into the account's own `~/.claude.json`; `/alfred-code:init` additionally writes the account `statusLine`, claude-hud's own `plugins/claude-hud/config.json` (add-only keys), a `settings.json.bak.<time>` backup taken before that run's first account write, and, at the `global` or `scoped` memory level, `~/.memory-mcp/memory.db` (or `memory_<space>.db` under a `--space` profile) - `project` level stays inside the project |
| **Starts** | one `claude plugin install` call per plugin (the optional third-party picks the project kept, `claude-hud`, installed beside the core on every run, the stack's own core `alfred-code`, and one plugin per MCP server the project keeps), no `claude mcp add` registration at all (the servers ride their own plugins; the opt-out route still makes up to eight), and - once, in `/alfred-code:init`, to import old notes into the shared memory - a `uvx ... memory server` launch plus a `node scripts/memory-import.js` importer talking to it; nothing else executes from the package itself, which is seven command bodies, one skill (the `/alfred-code` router; none ships a script), forty-four agents, three references and nineteen hooks - the core's own two (`guard-layer-table.js`, the table-before-question gate, and `library-stamp.js`, the startup line saying the library copies are older than the stack) and the seventeen stack hooks, eight of them run in-process by one dispatcher (`shell-guards.js`) - with no MCP server, no `bin/` and no dependencies of its own |
| **You install by hand** | `csharp-ls` and `typescript-language-server` for the two LSP plugins |
| **Costs, per message** | the always-on floor - the pathless rules plus every agent and skill description - measured at 87k-134k tokens across nine installs. `/alfred-code:status` reports your own install's number |

Nothing is written outside the project and the account-dir writes named above, and nothing is
deleted that the run did not install.

### Under managed settings

An organisation enforcing `strictKnownMarketplaces` needs two `extraKnownMarketplaces` rows -
`envoydev` and `claude-hud`, both on every run since `claude-hud` is required - because only
`claude-plugins-official` is known by default, plus an `enabledPlugins` key for each plugin above the
project keeps (`alfred-code` and `claude-hud` always). And
`allowManagedHooksOnly` silently disables all seventeen house hooks: the plugin still installs and
enables, but no guard ever fires, so the stack's deterministic gates are gone with nothing reporting
it. `ALFRED_CODE_HOOKS_OFF` is the supported way to switch individual hooks off. Decide that one before rolling the stack out under a managed
policy.

## Install - with the script

The installer is one `node` command on every OS. Download the release archive, run the seed out of it, and point `--source` back at the extraction so a later `update` reuses it:

```bash
cd /path/to/your/project
mkdir -p .claude/alfred-code-src
curl -fsSL https://github.com/envoydev/alfred-code/releases/latest/download/alfred-code.tar.gz \
  | tar -xz -C .claude/alfred-code-src

node .claude/alfred-code-src/scripts/install/alfred-code.js install --source .claude/alfred-code-src
node .claude/alfred-code-src/scripts/install/alfred-code.js update --source .claude/alfred-code-src --installed-only
```

Named flags: `--space`, `--scope` (project | user | local), `--memory-level`, `--browsers`, `--browser-enabled`, `--docs-versioning`, `--github-cli`, `--keep-pins`, `--selection`, `--installed-only`, `--add`, `--drop`, `--print-plan`, `--plan-out`, `--skills-only`, `--source`.

## FAQ

**Does it change my settings without telling me?** No. Every write is listed in 'What a run actually touches'; `/alfred-code:uninstall` removes only what the install ledger recorded.

**Does it touch my account settings?** Only the `env` keys and the plugin cache the CLI itself writes; the table above lists each one.

**Can I turn a hook off?** Yes: `ALFRED_CODE_HOOKS_OFF` takes a comma list, and `/alfred-code:configure` writes it for you.

**What does it cost per message?** The always-on floor was measured at 87k-134k tokens across nine installs; `/alfred-code:status` reports your own.

**Cursor?** Use [`cursor-stack`](https://github.com/envoydev/cursor-stack).

## Measuring it

The `instrument-tool-usage` hook (off until `ALFRED_CODE_INSTRUMENT` is `"1"`) records tool, skill and MCP use, and [`scripts/analyze-usage.js`](scripts/analyze-usage.js) turns a session transcript into a token report with an efficiency scorecard.

```bash
node scripts/analyze-usage.js ~/.claude/projects/<encoded-project>/<session-id>.jsonl
```

## License

[MIT](LICENSE) © 2026 envoydev
