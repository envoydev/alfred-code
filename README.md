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
  <img alt="node 26 recommended" src="https://img.shields.io/badge/node-26%20recommended-339933">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#what-changes">What changes</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#workflows">Workflows</a> ·
  <a href="#faq">FAQ</a>
</p>

Alfred Code reads your project, picks what it needs from a catalog of skills, agents, rules, hooks and plugins, and installs it for [Claude Code](https://claude.com/claude-code). From then on Claude follows your conventions without being asked, and risky moves are stopped before they run.

## Quick start

You need Node 26 (update to it - the release is tested on 26; 22.12 is the oldest that still runs), Claude Code 2.1.296
or newer, the `claude` CLI and git.

**1. Install the plugin** - in your project folder:

```bash
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin marketplace add envoydev/alfred-code
claude plugin install alfred-code@envoydev --scope local
```

`local` keeps the plugin and everything the stack writes to you alone. Use `--scope project` to give the plugin to
everyone who clones the project ([which scope?](#faq)).

**2. Set it up** - inside Claude Code:

```text
/alfred-code:init
```

It scans the project, shows what it recommends and why, and installs what you keep. Restart, then type it again: the
second run finishes the one-time set-up.

**3. Restart Claude Code, then finish:**

```text
/alfred-code:init
```

A one-time step: it installs the language servers the LSP plugins need, sets up the status line and writes the first project docs. That's it - work as usual.

## What changes

### Conventions load by themselves

Open a `.cs`, `.ts` or template file and the matching house style attaches on its own, through a path-scoped rule. Claude writes code the way your stack expects - no prompt needed.

### Mistakes are stopped, not just warned about

| When Claude tries to | Alfred Code |
| --- | --- |
| `git push --force` to `main`, `master` or `develop` | blocks it |
| `git reset --hard` over uncommitted work | blocks it and names what would be lost |
| `cat .env` | shows the keys, with the values masked |
| read the project's secrets in `.alfred/.secrets` | can't read the file, and a printed value is masked (its exact text - leak protection, not a wall) - a command that needs one gets it in its environment |
| commit a large change that was never reviewed | blocks it until the review runs |
| loosen `.eslintrc` so a failing check passes | blocks it - fix the code, not the check |
| write into another repository | blocks it and writes a task card instead |
| read a whole 2,000-line file to find one method | blocks it and points to symbol search |

When a block needs your decision, it ends in one question to you.

### Specialist agents plan, build and check

Each stack has three seats: a **designer** plans the change, an **implementer** builds it after you approve, a **verifier** reviews the result. Work that spans backend and frontend ends with a read-only integration review.

## Commands

The first time: **init**, restart, **init** again. After that: **update** when a release lands.

| Command | What it does |
| --- | --- |
| `/alfred-code:init` | First install: scan, recommend, install - then, after the restart, the one-time finish |
| `/alfred-code:update` | Move to the newest release |
| `/alfred-code:configure` | Add or remove skills, agents, rules, hooks and plugins |
| `/alfred-code:status` | Show what is on and what gets used |
| `/alfred-code:validate` | Match the install to the project again |
| `/alfred-code:uninstall` | Remove what the install wrote, nothing else |

Not sure which one? Type `/alfred-code` and it names the command to run. Three more commands switch a mode on
until you switch it off: see [Modes](#modes). To go back to an earlier release - every project on the machine moves
with it: [`docs/rolling-back.md`](docs/rolling-back.md).

## Workflows

Skills you start by name. Every install has these.

| Run | When |
| --- | --- |
| `/task-solve` | A change you want to approve step by step |
| `/task-solve-cross` | A feature across backend and frontend |
| `/issue-diagnoser` | Find the cause of a failure |
| `/task-version-upgrade` | A breaking upgrade, like .NET 10 |
| `/capture-awareness` | The architecture docs, code style, run book, what is installed, sibling repos |
| `/loop-code-quality` | Find and fix code-quality issues in rounds |
| `/mode-auto-run` | Any request, start to finish, while you are away |

Add what you want after the name:

```text
/task-solve add paging to GET /api/loans
/issue-diagnoser the CI build on main fails since yesterday
/task-version-upgrade move the web app to Angular 20
```

More on the two task flows: [`docs/solve-skills-guide.md`](docs/solve-skills-guide.md).

## Modes

A mode is a switch you type once. Type its command alone on a line, with `on` or `off`. It stays on - in this
session and every new one in the same checkout - until you type its `off`:

| Command | What it does |
| --- | --- |
| `/alfred-code:mode:auto-run on` | Each question takes its recommended option, so runs go on without you. No fresh-session question either: the session compacts instead |
| `/alfred-code:mode:scoring on` | A fresh grader scores plans and root-cause verdicts before they are released. `on 80` also sets the pass level (60 to 100, default 80) |
| `/alfred-code:mode:auto-compact on` | Only stops the fresh-session question: a long session compacts and goes on |

```text
/alfred-code:mode:auto-run on
/task-solve add paging to GET /api/loans
```

A mode command with no word after it says whether that mode is on. A new session says the modes left on in its first
line, and each prompt shows them (`Modes ON: auto-run, scoring (level 80), auto-compact`).

**Where a mode is kept.** In the `env` of the checkout's own `.claude/settings.local.json`, which git never shares, so
a teammate's clone starts with every mode off. A project below its repository's top uses the top's file, and a git
worktree uses its main checkout's. The four keys are `ALFRED_CODE_AUTO_RUN`, `ALFRED_CODE_AUTO_COMPACT`,
`ALFRED_CODE_SCORING` and `ALFRED_CODE_SCORING_LEVEL`; `/alfred-code:configure` shows them but changes them only
through the commands.

**Auto-run.** `auto-run on` puts every session in the checkout under auto-run, a second window included. Nothing
outward happens unasked: no push, merge, deploy or publish. A guard's question (a discard, a write outside the
project, a guard switched off) is still yours: its answer opens the gate only when Claude Code records that a person
gave it, so on Claude Code older than 2.1.296 no such answer opens anything - update Claude Code. `/mode-auto-run
<request>` turns auto-run on for one session and runs the request in one go.

**Auto-compact.** `auto-compact on` also turns on Claude Code's own compaction for the checkout
(`autoCompactEnabled: true`, with a compaction point per model), from the next session. `auto-compact off` writes
`autoCompactEnabled: false`: Claude Code no longer compacts by itself there, and `/compact` still works. Only the typed
`off` does that - a `0` you set by hand switches nothing in Claude Code.

**No command here?** Where the core plugin is not installed (or its hooks are off), set the keys by hand in that
file's `env` (`"ALFRED_CODE_SCORING": "1"`), and add `"autoCompactEnabled": false` beside a hand-set
`"ALFRED_CODE_AUTO_COMPACT": "0"`. Going back to 3.10 leaves the keys in the file; remove `autoCompactEnabled` and
`modelSettings` there by hand. The `--mode-*` flags of 3.0 to 3.10 are gone - typed after a command they print a
pointer to the commands above and switch nothing.

## Settings

Most projects need none. `/alfred-code:configure` shows each setting and writes it for you; these are the places, if
you set one by hand:

| File | What goes there | In git? |
| --- | --- | --- |
| `.alfred/.variables` | the stack's values, one `KEY=value` per line - e.g. `ALFRED_CODE_INSTRUMENT=1` (record tool use), `ALFRED_CODE_DOCS_VERSIONING=git` (commit the docs), `ALFRED_CODE_WORKSPACE=0` (no workspace) | at `project` scope |
| `.claude/settings.local.json`, its `env` | `ALFRED_CODE_HOOKS_OFF` (guards switched off), `ALFRED_CODE_ALLOW_WRITE_OUTSIDE` (trees a write may reach), and the mode keys the [mode commands](#modes) write | never |
| `.alfred/agents.json` | a seat's model for this project: `{ "claude": { "agents": { "aspnet-verifier": { "model": "opus" } } } }` - `sonnet`, `opus`, `haiku` or `fable` | your choice - the installer never writes it |
| `.alfred/workspace.json` | in a project below a workspace root, what it should not take from the root: `{ "ignore": { "rules": ["csharp-conventions"] } }` | at `project` scope |

Outside the project:

- **Node 26.** Older Node 22.12+ still runs, untested.
- **Claude Code 2.1.296 or newer.** Older clients record no 'a person answered' mark, so under auto-run no answer to a
  guard's question opens it.
- **Cursor.** Keep Cursor Settings -> Agents -> Third-Party Imports ('Include Third-Party Plugins, Skills, and Other
  Configs') on, its default: that is how Cursor reads the stack's guards from `.claude/settings.local.json`.

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
| **Skills** | 88 | house conventions and workflows |
| **Agents** | 45 | designers, implementers, verifiers, reviewers |
| **Rules** | 18 | always-on basics and per-file conventions |
| **Hooks** | 18 | the guards, plus the docs, preferences, history and rules hooks |
| **Plugins** | 3 | optional: claude-hud (recommended) and the C# and TypeScript language servers |

The full inventory is [`docs/alfred-code.html`](docs/alfred-code.html) - open it in a browser.

## Where it writes

| Place | What goes there |
| --- | --- |
| `.claude/` in your project | a link per picked skill, the generated rules, the install stamp, and the stack's settings in `settings.local.json` |
| `.alfred/` in your project | the picked skills and rules (`stack/`), docs, the hooks' state, the seats' handoff notes - all but the docs stay out of git |
| `~/.claude/` | the plugin cache, the status line |

`/alfred-code:uninstall` removes only what the install recorded. Every file, process and token, in detail: [`docs/install-footprint.md`](docs/install-footprint.md).

## Workspaces

A folder of several projects can share one install's skills, rules, hooks and seats.

- Run `/alfred-code:init` at the workspace root first, then in each project below; init asks each one to join.
- In a project below, install with `--scope local` (or `user`): `--scope project` writes the core into the child's committed `.claude/settings.json`.
- Unattended, init runs only its second (bootstrap) phase: install in an interactive session and restart first, then run `ALFRED_CODE_UNATTENDED=1 claude -p "/alfred-code:init" --permission-mode auto` - print mode without a permission mode refuses every Bash call.
- Before a project joins, its first session can ask 'allow external imports?' for the root's awareness rule. 'No' is safe: after the join that rule is excluded there.
- A joined project keeps only its own values in `.alfred/.variables`; the rest it reads from the root. A skill or seat it picks is kept once, in the root's `.alfred/stack/`.
- A session may write anywhere in the workspace without asking; past it, the main session asks and a subagent is refused.
- A session started at the root gets a project's own rules and docs the first time it touches a file there.
- To keep a project below the root out of the workspace, mark it ignored in `/alfred-code:configure` (the workspace role): it keeps what it had and stands alone.
- At the root, `/alfred-code:status` and the usage audit cover every joined project, one table each; in a project below they cover that project alone.

## FAQ

<details>
<summary><strong>Does it change my settings without telling me?</strong></summary>

No. Every write is listed in [`docs/install-footprint.md`](docs/install-footprint.md), and the install stamp records each one. `/alfred-code:uninstall` removes exactly those and nothing of yours.

</details>

<details>
<summary><strong>A browser login types the key name instead of its value - why?</strong></summary>

The stack ships no browser server since 2.10.1, so a Playwright server is one you registered yourself. Playwright
puts a value in place of a key name from `.alfred/.secrets` only when it was started with `--secrets <that file>`.
`/alfred-code:status` names each registration missing it and prints the two args to add, for example:

```json
"args": ["-y", "@playwright/mcp@latest", "--browser", "chrome", "--secrets", "/abs/path/to/project/.alfred/.secrets"]
```

Then reconnect the server with `/mcp`. Use the absolute path, and keep the file in place: Playwright reads it when it
starts and fails to start once it is gone.

</details>

<details>
<summary><strong>How do I turn a guard off?</strong></summary>

Name it in `ALFRED_CODE_HOOKS_OFF`, a comma list in the `env` block of `.claude/settings.local.json`:

```json
{ "env": { "ALFRED_CODE_HOOKS_OFF": "guard-answer,guard-read-whole-file" } }
```

Or run `/alfred-code:configure` and it writes the key for you.

</details>

<details>
<summary><strong>Project, local or user scope?</strong></summary>

- **local** (the default) - the plugin is enabled for you alone, and `git status` shows nothing of the stack's.
- **project** - the plugin is enabled for everyone who clones the project, and `.alfred/.variables` and the copies are tracked in git.
- **user** - the plugins are enabled for your whole account. The copies and the stamp still live in the project.

The stack writes its settings to `.claude/settings.local.json`, which never leaves your machine. A teammate who clones
the project gets the plugin (at project scope), the tracked `.variables` and the copies under `.claude/`, and none of
the stack's settings - no deny rows, no seat denies, no hook switches. Their first `/alfred-code:update` writes the
deny rows, the seat denies and the seeded keys into their own local file. Where the hooks ride the plugin (the
default), the hooks your team switched off (`ALFRED_CODE_HOOKS_OFF`) are recorded in no tracked file, so they run for
a teammate until that teammate switches them off in `/alfred-code:configure`. A cloud session reads no local file and
gets none of the settings at all. Cursor reads the stack's hook rows from the same file as long as its 'Include
Third-Party Plugins, Skills, and Other Configs' setting (Cursor Settings -> Agents -> Third-Party Imports) is on,
which is its default.

That scope covers the core. Each optional item - a language server plugin, claude-hud - has its own: global (every project on your account) or this project, this project
by default. `/alfred-code:configure` moves one.

</details>

<details>
<summary><strong>What does it cost per message?</strong></summary>

The stack's own always-on text, and the whole per-message floor around it, is measured in [the install footprint](docs/install-footprint.md). `/alfred-code:status` shows your install's number.

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
| `--add 'skill dotnet'` | add one skill, agent, rule, hook or plugin |
| `--drop 'plugin claude-hud'` | remove one |
| `--scope-of claude-hud=global` | one optional item's own scope: `global` or `project` |
| `--print-plan` | show what would change, write nothing |

</details>

<details>
<summary><strong>Rolling out in an organisation?</strong></summary>

Under managed settings:

- `strictKnownMarketplaces` registers nothing, and Claude Code refuses an `extraKnownMarketplaces` entry it does not admit: allow `{ "source": "github", "repo": "envoydev/alfred-code" }`, `anthropics/claude-plugins-official` (the LSP pair) and `jarrodwatts/claude-hud` if you keep it, then register the same three (`envoydev`, `claude-plugins-official`, `claude-hud`) in `extraKnownMarketplaces`.
- Enable `alfred-code@envoydev` in `enabledPlugins`, and `claude-hud@claude-hud` if you want its status line.
- `allowManagedHooksOnly` silently switches off all eighteen hooks - the guards never fire.

Details: [`docs/install-footprint.md`](docs/install-footprint.md#under-managed-settings).

</details>

<details>
<summary><strong>How do I see what it actually did?</strong></summary>

`/alfred-code:status` shows what is installed and what the recent sessions used. The usage audit, `/capture-usage-report`
(add it in `/alfred-code:configure`), audits sessions one by one and writes a report per session plus a `SUMMARY.md`
under `.alfred/statistics/usage-report/`.

Set `ALFRED_CODE_INSTRUMENT` to `"1"` to record tool, skill and MCP use, then turn a session into a token report:

```bash
node scripts/analyze-usage.js ~/.claude/projects/<encoded-project>/<session-id>.jsonl
```

</details>

## License

[MIT](LICENSE) © 2026 envoydev and Alfred Code contributors. Third-party material and its licences: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
