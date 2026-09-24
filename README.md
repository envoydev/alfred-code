# Alfred Code

The Claude Code half of a coding-agent setup - an installable stack of house skills,
subagents, always-on and path-scoped rules, hooks, MCP servers, and plugins that gets applied to
the projects you actually work in. This repo is the single source of truth: everything installs from
ONE source snapshot per run, and the common run downloads nothing - Claude Code's own plugin cache
already holds this whole repo, because every marketplace entry is sourced from the repo root (a
release archive, then a shallow git clone, are the fallbacks for a machine with no cache). Either
way an install is a single source revision, recorded in `.claude/alfred-code.stamp`, and consuming
projects pull from here rather than owning their copy. The **Cursor** twin stack lives in its own repo,
[`cursor-stack`](https://github.com/envoydev/cursor-stack) - its installers clone THIS repo for
the shared skills, so the baseline stays single-sourced here.

What it gives a project: consistent house conventions that attach themselves to the right file
types, single-chat and multi-agent build workflows with quality gates, per-project MCP wiring
(docs lookup, symbol navigation, browser and mobile automation, error monitoring), and a guided
install/update flow.

## Technologies

The stack is built for this house's verticals:

- **.NET / C#** - ASP.NET web/API, WPF desktop, console workers / bots / daemons / CLIs
- **Angular / TypeScript** - web frontend, plus Ionic/Capacitor hybrid mobile
- **SQL** - PostgreSQL, SQLite, SQL Server (schema, migrations, query conventions)
- **DevOps** - Docker, GitHub Actions

## What gets installed

| Surface | Count | What it is |
| ------- | ----- | ---------- |
| **Skills** | 80 | house conventions + workflow skills: the always-on ones ride the core plugin, every other pick is a library copy in `.claude/skills/` |
| **Agents** | 43 | model/effort-pinned subagents: the core seats ride the core plugin, every other pick is a library copy in `.claude/agents/` |
| **Rules** | 19 | always-on baselines + path-scoped conventions, `.claude/rules/` |
| **Hooks** | 17 | deterministic guards (a weakened check config among them), a log-only session monitor, a turn-end build check (off by default), the architecture docs hook, the shared-memory session hook, a machine-local session history, and an env-gated usage instrument (off by default), shipped inside the core `alfred-code` plugin; only the three engines and the model-window table land in `.claude/hooks/` |
| **MCP servers** | 4 | one plugin each, named for the server (7 entries: playwright expands per browser); the project's closure enables its own |
| **Plugins** | 4 + the stack's own | four optional third-party picks via the `claude` CLI, suggested on evidence (a `*.csproj`, a `tsconfig.json`, an auth or payment package, a tracked `CLAUDE.md`), plus `superpowers` and `claude-hud`, which every install carries beside the core (`claude-hud` at user scope - its status line is account-wide), and the core `alfred-code` itself - the always-on skills and seats, and every hook |

The full inventory - what every skill, agent, rule, and hook actually does - lives in the browser
inventory at [`docs/alfred-code.html`](docs/alfred-code.html), not in this README.

## What a run actually touches

Read this before the first install - it is the whole trust surface, and nothing here is hidden
behind a flag.

| | |
| --- | --- |
| **Writes, in the project** | `.claude/{skills,agents,rules,hooks}/` (hooks: the three engines and the model-window table only - the seventeen wired hooks come from the core `alfred-code` plugin; skills and agents: the library copies of this project's picks - the always-on ones come from the core plugin), the `.claude/settings.json` `env` block, the shared memory's `autoMemoryEnabled: false` and one-time note import (always in THIS project's own settings.json - even at global scope, never the account file), `.serena/project.yml`, and `alfred-code.stamp`; `<repo>/.mcp.json` only on the `ALFRED_CODE_MCPS_VIA_PLUGIN=false` route, which the default run instead PRUNES of every stack server |
| **Writes, in the account dir** | `~/.claude/settings.json` `env` keys only (`CONTEXT7_API_KEY` - a secret is logged by length, never by value, and never asked for through the chat) - `autoMemoryEnabled` never lands here, whatever the install scope |
| **Starts** | one `claude plugin install` call per plugin (the optional third-party picks the project kept, `superpowers` and `claude-hud`, installed beside the core on every run, the stack's own core `alfred-code`, and one plugin per MCP server the project keeps), no `claude mcp add` registration at all (the servers ride their own plugins; the opt-out route still makes up to seven), and - once, to import old notes into the shared memory - a `uvx ... memory server` launch plus a `node scripts/memory-import.js` importer talking to it; nothing else executes from the package itself, which is six command bodies, twenty-three skills (only `project-agent-capabilities` ships a script), eight agents, two references and nineteen hooks - the core's own two (`guard-layer-table.js`, the table-before-question gate, and `library-stamp.js`, the startup line saying the library copies are older than the stack) and the seventeen stack hooks - with no MCP server, no `bin/` and no dependencies of its own |
| **You install by hand** | `csharp-ls` and `typescript-language-server` for the two LSP plugins; `security-guidance` fetches its own Python dependency at session start |
| **Costs, per message** | the always-on floor - the pathless rules plus every agent and skill description - measured at 87k-134k tokens across nine installs. `/alfred-code:status` reports your own install's number |

Nothing is written outside the project and that account `env` block, and nothing is deleted that
the run did not install.

### Under managed settings

An organisation enforcing `strictKnownMarketplaces` needs two `extraKnownMarketplaces` rows -
`envoydev` and `claude-hud`, both on every run since `claude-hud` is required - because only
`claude-plugins-official` is known by default, plus an `enabledPlugins` key for each plugin above the
project keeps (`alfred-code`, `superpowers` and `claude-hud` always). And
`allowManagedHooksOnly` silently disables all seventeen house hooks: the plugin still installs and
enables, but no guard ever fires, so the stack's deterministic gates are gone with nothing reporting
it. `ALFRED_CODE_HOOKS_OFF` is the supported way to switch individual hooks off. Decide that one before rolling the stack out under a managed
policy.

## Install - with the marketplace plugin (guided)

Register the marketplace and install the setup plugin **per project** - run both commands from
inside the project, so the plugin binding lands in that project's own config. Per-project is the
default to prefer: each repo pins exactly what it uses, and a machine-wide default never leaks
the plugin into projects that do not want it (a user-scope install works, but choose it
deliberately):

```
cd <your-project>
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin marketplace add envoydev/alfred-code
claude plugin install alfred-code@envoydev
```

The first line matters: the plugin depends on `superpowers`, which lives in the official
marketplace. With that marketplace known, the install pulls `superpowers` in by itself; without it
the install succeeds but reports the dependency as unsatisfied until the marketplace is added.

Then `/alfred-code:init` runs a fresh install (in a project it decides the selection FROM the
project; outside one it offers a global install from the recommended set; `/alfred-code:setup`
stays as its alias for one release),
`/alfred-code:update` refreshes an existing one to the newest release and prunes what the stack
removed upstream, `/alfred-code:configure` adjusts it (add or drop items), and
`/alfred-code:validate` reconciles an install against THIS project - prunes what its frameworks do
not use and adds the detected stacks' missing artifacts, a per-layer walk (project mode only); and
`/alfred-code:status` shows the install read-only, one table per area.
Init and configure walk the selection one layer at a time (rules ->
agents -> skills -> hooks -> MCPs -> plugins) as numbered full-catalog tables, locking only what
something kept still requires - always with the reason shown. A deterministic evidence scan of
the project's package manifests (csproj / package.json) pre-selects the specialist skills the
project provably uses, the matched signal shown as the reason. All detect the OS, the install
commands check prerequisites before anything runs, and `/alfred-code` alone routes by state.

## Install - with the script

The **action** (`install` | `update`) is the one required argument.

The installer is one `node` command on every OS - `node scripts/install/alfred-code.js install
[flags]` - and that is what the `/alfred-code:*` commands run. It is not a single downloadable
file (it needs its sibling modules under `scripts/install/`), so the STANDALONE route - no checkout
kept around long-term - downloads the release archive once, runs the seed out of it, and points
`--source` back at the extraction so a later `update` can reuse the same copy instead of
re-downloading:

```bash
cd /path/to/your/project
mkdir -p .claude/alfred-code-src
curl -fsSL https://github.com/envoydev/alfred-code/releases/latest/download/alfred-code.tar.gz \
  | tar -xz -C .claude/alfred-code-src

node .claude/alfred-code-src/scripts/install/alfred-code.js install --source .claude/alfred-code-src                 # first time
node .claude/alfred-code-src/scripts/install/alfred-code.js update --source .claude/alfred-code-src --installed-only # later refreshes - only what is already installed, from disk
node .claude/alfred-code-src/scripts/install/alfred-code.js install --source .claude/alfred-code-src --skills-only   # just the skills, nothing else

# Named flags (any order): --space, --scope, --docs-versioning, --memory-level, --github-cli, --keep-pins, --selection, --installed-only, --print-plan, --skills-only, --source
node .claude/alfred-code-src/scripts/install/alfred-code.js install --source .claude/alfred-code-src --space work --scope global --memory-level scoped
```

The same command runs verbatim on Windows under `node.exe`, PowerShell or cmd - one program, no
platform branch. `ALFRED_CODE_SEED=shell` (a Phase 7 flag from before 2.0.0) is retired: the frozen
shell and PowerShell twins it used to select are gone, and setting it now refuses with a clear
message instead of installing.

Hard prerequisites: **node ≥ 22.12**, the **claude** CLI (it owns the plugin cache the install
reads from), and **git** (the installers use it to find the repo root, and it is the download
fallback when no plugin cache and no release archive are reachable).
Everything else is per-surface - the script runs a prerequisites check first and warns
(never fails) on what's missing, and the guided plugin flow walks you through the fixes.

Each run stamps the installed source commit into `alfred-code.stamp`;
`/alfred-code:configure` diffs it against `main` to tell you what an update would bring.

## Token & tool usage analysis

The one piece of the stack worth naming here: the `instrument-tool-usage` hook, shipped with the
rest in the core `alfred-code` plugin, records per-run tool / skill / MCP usage - wired by
default behind an env gate, so it costs nothing until you flip `ALFRED_CODE_INSTRUMENT` from `"0"` to
`"1"` in `.claude/settings.json` env (flip it back after the measured run), and
[`scripts/analyze-usage.js`](scripts/analyze-usage.js) mines a session's transcript JSONL (plus
its dispatched subagents) into a token/consumption report - join the two with `--hook-log` to see
what fired and what it cost. Every per-session report carries an efficiency scorecard - the session's cost at list price (main and per seat, from the dated table in `meta/model-prices.json`), cache misses by Claude Code's own rule, compaction re-reads, build-dir reads, scoped against whole-suite test runs, checked commits, green claims with no check behind them, correction streaks, long answers, navigation (located reads against grep-then-read, whole-file denials), MCP calls a server answered with an error, dispatch overhead - each a measured number with its denominator, so a hook or rule change is read from a week of sessions instead of asserted.

```bash
node scripts/analyze-usage.js ~/.claude/projects/<encoded-project>/<session-id>.jsonl
```

## License

[MIT](LICENSE) © 2026 envoydev
