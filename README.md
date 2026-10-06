<p align="center">
  <img src="assets/alfred-code-logo.png" width="280" alt="Alfred Code - a butler in black and white">
</p>

<h1 align="center">Alfred Code</h1>

<p align="center">
  <em>The house rules, the right tools and the checks - set up before Claude Code starts work.</em>
</p>

<p align="center">
  <a href="https://github.com/envoydev/alfred-code/releases"><img alt="release" src="https://img.shields.io/github/v/release/envoydev/alfred-code"></a>
  <a href="LICENSE"><img alt="license: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <img alt="node 22.12 or newer" src="https://img.shields.io/badge/node-%E2%89%A5%2022.12-339933">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#what-changes">What changes</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#workflows">Workflows</a> ·
  <a href="#faq">FAQ</a>
</p>

Alfred Code reads your project, picks what it needs from a catalog of skills, agents, rules, hooks and MCP servers, and installs it for [Claude Code](https://claude.com/claude-code). From then on Claude follows your conventions without being asked, and risky moves are stopped before they run.

## Quick start

You need Node 22.12 or newer, the `claude` CLI and git.

**1. Install the plugin** - in your project folder:

```bash
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin marketplace add envoydev/alfred-code
claude plugin install alfred-code@envoydev --scope project
```

**2. Set it up** - inside Claude Code:

```text
/alfred-code:setup
```

It scans the project, shows what it recommends and why, and installs what you keep.

**3. Restart Claude Code, then finish:**

```text
/alfred-code:init
```

A one-time step: it prepares the MCP servers, sets up memory and writes the first project docs. That's it - work as usual.

## What changes

### Conventions load by themselves

Open a `.cs`, `.ts` or template file and the matching house style attaches on its own, through a path-scoped rule. Claude writes code the way your stack expects - no prompt needed.

### Mistakes are stopped, not just warned about

| When Claude tries to | Alfred Code |
| --- | --- |
| `git push --force` to `main`, `master` or `develop` | blocks it |
| `git reset --hard` over uncommitted work | blocks it and names what would be lost |
| `cat .env` | shows the keys, with the values masked |
| commit a large change that was never reviewed | blocks it until the review runs |
| loosen `.eslintrc` so a failing check passes | blocks it - fix the code, not the check |
| write into another repository | blocks it and writes a task card instead |
| read a whole 2,000-line file to find one method | blocks it and points to symbol search |

When a block needs your decision, it ends in one question to you.

### Specialist agents plan, build and check

Each stack has three seats: a **designer** plans the change, an **implementer** builds it after you approve, a **verifier** reviews the result. Work that spans backend and frontend ends with a read-only integration review.

### The right tools are wired in

| Server | Claude uses it to |
| --- | --- |
| navigation (Serena) | find a symbol and its references without reading whole files |
| documentation (Context7) | read current library docs instead of guessing from memory |
| memory | keep your preferences and corrections across sessions |
| browser (Playwright MCP) | open the app and check it, for web stacks |
| windows-desktop, macos-desktop | drive desktop apps - opt-in, on their own OS only |

## Commands

The first time: **setup**, restart, **init**. After that: **update** when a release lands.

| Command | What it does |
| --- | --- |
| `/alfred-code:setup` | First install: scan, recommend, install |
| `/alfred-code:init` | One-time finish after the restart |
| `/alfred-code:update` | Move to the newest release |
| `/alfred-code:configure` | Add or remove skills, agents and servers |
| `/alfred-code:status` | Show what is on and what gets used |
| `/alfred-code:validate` | Match the install to the project again |
| `/alfred-code:uninstall` | Remove what the install wrote, nothing else |

Not sure which one? Type `/alfred-code` and it names the command to run.

## Workflows

Skills you start by name. Every install has these.

| Run | When |
| --- | --- |
| `/task-solve` | A change you want to approve step by step |
| `/task-solve-cross` | A feature across backend and frontend |
| `/issue-diagnoser` | Find the cause of a failure |
| `/task-version-upgrade` | A breaking upgrade, like .NET 10 |
| `/capture-first-look` | A quick map of an unfamiliar project |
| `/capture-architecture` | Write or refresh the architecture docs |
| `/capture-project-capabilities` | A run book: build, start, log in |
| `/loop-quality` | Find and fix code-quality issues in rounds |

Add what you want after the name:

```text
/task-solve add paging to GET /api/loans
/issue-diagnoser the CI build on main fails since yesterday
/task-version-upgrade move the web app to Angular 20
```

More on the two task flows: [`docs/solve-skills-guide.md`](docs/solve-skills-guide.md).

## Supported stacks

| Stack | Covers |
| --- | --- |
| .NET / C# | ASP.NET web and API, WPF, WinForms, console apps, Windows services |
| Angular / TypeScript | web apps, Ionic / Capacitor mobile, browser extensions |
| SQL | PostgreSQL, SQLite, SQL Server: schema, migrations, queries |
| DevOps | Docker, GitHub Actions |

## What's inside

| | Count | What it is |
| --- | --- | --- |
| **Skills** | 91 | house conventions and workflows |
| **Agents** | 44 | designers, implementers, verifiers, reviewers |
| **Rules** | 20 | always-on basics and per-file conventions |
| **Hooks** | 18 | the guards, plus the docs, memory and history hooks |
| **MCP servers** | 4 | alfred-navigation, alfred-documentation, alfred-memory (required) and the browser (optional), plus the two opt-in desktop servers |
| **Plugins** | 3 | optional: claude-hud (recommended) and the C# and TypeScript language servers |

The full inventory is [`docs/alfred-code.html`](docs/alfred-code.html) - open it in a browser.

## Where it writes

| Place | What goes there |
| --- | --- |
| `.claude/` in your project | the picked skills and rules, settings, the install stamp |
| `.alfred/` in your project | docs, the navigation index, browser profiles - all but the docs stay out of git |
| `~/.claude/` | the plugin cache, an optional API key, the status line |
| `~/.alfred-memory/` | the shared memory database |

`/alfred-code:uninstall` removes only what the install recorded. Every file, process and token, in detail: [`docs/install-footprint.md`](docs/install-footprint.md).

## FAQ

<details>
<summary><strong>Does it change my settings without telling me?</strong></summary>

No. Every write is listed in [`docs/install-footprint.md`](docs/install-footprint.md), and the install stamp records each one. `/alfred-code:uninstall` removes exactly those and nothing of yours.

</details>

<details>
<summary><strong>How do I turn a guard off?</strong></summary>

Name it in `ALFRED_CODE_HOOKS_OFF`, a comma list in the `env` block of `.claude/settings.json`:

```json
{ "env": { "ALFRED_CODE_HOOKS_OFF": "guard-config-protection,guard-read-whole-file" } }
```

Or run `/alfred-code:configure` and it writes the key for you.

</details>

<details>
<summary><strong>Project, local or user scope?</strong></summary>

- **project** (recommended) - settings go in `.claude/settings.json` and are shared through git.
- **local** - the same, in `.claude/settings.local.json`, for you only.
- **user** - the plugins are enabled for your whole account. The copies and the stamp still live in the project.

That scope covers the core and the three required servers. Each optional item - a browser, a desktop server, a
language server, claude-hud - has its own: global (every project on your account) or this project, this project
by default. `/alfred-code:configure` moves one.

</details>

<details>
<summary><strong>What does it cost per message?</strong></summary>

The stack's own always-on text is about 13k tokens. `/alfred-code:status` shows your install's number.

</details>

<details>
<summary><strong>Can I install without the plugin?</strong></summary>

Yes. The installer is one `node` command on every OS:

```bash
cd /path/to/your/project
mkdir -p .claude/alfred-code-src
curl -fsSL https://github.com/envoydev/alfred-code/releases/latest/download/alfred-code.tar.gz \
  | tar -xz -C .claude/alfred-code-src

# install
node .claude/alfred-code-src/scripts/install/alfred-code.js install --source .claude/alfred-code-src

# later: update what is installed
node .claude/alfred-code-src/scripts/install/alfred-code.js update --source .claude/alfred-code-src --installed-only
```

The flags you are most likely to want:

| Flag | Does |
| --- | --- |
| `--scope project\|user\|local` | where the install is enabled |
| `--memory-level global\|scoped\|project` | which memory database to use |
| `--browsers chrome,firefox` | which browsers the browser server gets: chrome, msedge, firefox, webkit |
| `--add 'skill dotnet'` | add one skill, agent, rule, hook, mcp or plugin |
| `--drop 'mcp browser'` | remove one |
| `--scope-of browser=global` | one optional item's own scope: `global` or `project` |
| `--print-plan` | show what would change, write nothing |

</details>

<details>
<summary><strong>Rolling out in an organisation?</strong></summary>

Under managed settings:

- With `strictKnownMarketplaces`, add `envoydev` and `claude-hud` to `extraKnownMarketplaces`.
- Enable `alfred-code` in `enabledPlugins`, and `claude-hud` if you want its status line.
- `allowManagedHooksOnly` silently switches off all eighteen hooks - the guards never fire.

Details: [`docs/install-footprint.md`](docs/install-footprint.md#under-managed-settings).

</details>

<details>
<summary><strong>How do I see what it actually did?</strong></summary>

Set `ALFRED_CODE_INSTRUMENT` to `"1"` to record tool, skill and MCP use, then turn a session into a token report:

```bash
node scripts/analyze-usage.js ~/.claude/projects/<encoded-project>/<session-id>.jsonl
```

</details>

## License

[MIT](LICENSE) © 2026 envoydev and Alfred Code contributors. Third-party material and its licences: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
