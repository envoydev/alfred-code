# Upgrading a 2.8 or 2.10 workspace - a clean reinstall

This guide moves a folder of projects that each hold an old Alfred Code install (2.8.x or 2.10.x) to the newest
release, on macOS and Windows, as a clean reinstall: the old install is taken out first, then the newest one goes in
fresh as a workspace - the top folder the root, every project below it a child that inherits the root's set.

| Stage | Who | What |
| --- | --- | --- |
| 0. Credentials out | you, by hand | Every token and key leaves the files an agent could touch |
| 1. Clean up | Cursor ([prompt A](/docs/upgrading-from-2x-agent.md#3-prompt-a---stage-1-clean-up)) or you | The stack's own uninstall in each project, then the old account-wide rows |
| 2. Install fresh | you in Claude Code, Cursor for the plugin commands ([prompt B](/docs/upgrading-from-2x-agent.md#4-prompt-b---stage-2-plugins)) | `/alfred-code:init` at the root, then in each child |
| 3. Tools, mods, modes | you | MCP servers back, tool order, alfred-mods, mode defaults |

Why a reinstall rather than an update in place: a fresh init joins each child to the root properly - it inherits the
root's skills, rules and values, keeps only its own extras and installs at `local` scope - and every pick is chosen
against today's catalog. The cost is stage 2: init's install phase does not run unattended, so you answer its
questions in each project. To keep your old picks with no questions instead, see
[Updating in place instead](#updating-in-place-instead).

## Before you start

- Node 22.12 or newer, git, and an up-to-date `claude` CLI (`claude --version`; `claude update` if behind).
- Windows: Git for Windows, and Git Bash must find the same Node (`node --version` in Git Bash) - Claude Code runs its
  shell through it.
- Close every Claude Code session open in the workspace.
- Commit or stash in each project, so each stage's changes show as their own diff.
- Teammates on the same repos: the uninstall changes committed files (`.claude/settings.json`, copied skills). Agree
  on the day; whoever pulls in between has no stack until stage 2 lands.

## Stage 0 - take the credentials out (you, by hand)

Do this yourself, in your own editor and terminal - never ask an agent to do it. Save each value in your password
manager first: stage 3 puts them back.

1. **Secret files** - move them out of the workspace folder (not into a folder Cursor opens):
   - `<project>/.alfred/.secrets` and `<project>/.alfred/.sensitive-data` (the stack's store)
   - `<project>/.preferred-tools/.secrets` and `~/.preferred-tools/.secrets`
   - optional, belt and braces: `.env`, `.env.*`, `*.pem`, `*.key`, `*.pfx`, `*.p12` in the projects
2. **MCP servers that hold a key** - in your own terminal, `claude mcp get <name>` shows a server's env and headers.
   Save the key, then remove the whole server: `claude mcp remove <name> -s <project|local|user>`. Stage 3 adds the
   ones you want back. Do not edit the key out of a registration by hand: an edited row no longer matches what the
   stack recorded, so the uninstall keeps it as yours.
3. **Settings env values** - in `.claude/settings.json`, `.claude/settings.local.json` and `~/.claude/settings.json`,
   delete any key that holds a token or password (`GITHUB_TOKEN`, `*_API_KEY`, `apiKeyHelper` and the like). Leave
   every `ALFRED_CODE_*` key as it is: none holds a secret, and the uninstall removes them by what it recorded.
4. **Your shell's environment** - a token exported in `~/.zshrc`, `~/.bash_profile` or the Windows user environment
   variables reaches every terminal Cursor opens. Comment it out, or start Cursor from a shell without it.
5. **What stays** - Claude Code's own login (the macOS keychain; `~/.claude/.credentials.json` on Windows), which the
   `claude` CLI needs, and your git, npm, NuGet, Docker, cloud and SSH credentials in your home folder. The agent
   rules forbid reading any of them.

## Stage 1 - clean up the old install

Hand it to Cursor with [prompt A](/docs/upgrading-from-2x-agent.md#3-prompt-a---stage-1-clean-up), or run it by hand:

1. Put the newest release in the plugin cache - its uninstall knows how to take out what 2.8 and 2.10 left:

   ```bash
   claude plugin marketplace update envoydev
   claude plugin update alfred-code@envoydev --scope <the scope `claude plugin list` shows>
   ```

2. In each project, **children first, the root last**: Claude Code there, `/alfred-code:uninstall`. It removes only
   what its install record lists - the stack's plugin rows at this project's scope (the old MCP server plugins
   included), the MCP registrations it wrote, its settings entries, hook wirings and copied files, the stamp - and
   lifts the memory switch-off the old release set on Claude Code. It keeps anything you changed since, and `.alfred/`
   with your docs.
3. It prints, never runs, the commands for rows at `user` scope - they serve every project on the account. Run the
   ones for `@envoydev` rows other than `preferred-tools` and `alfred-mods`, and its `claude mcp remove` lines. An old
   `session-inspector` row goes too: it is the mod's old name, installed again as `alfred-mods` in stage 3.
   Keep `claude-hud` and the `*-lsp` plugins unless you want them gone: stage 2 offers them again.
4. Restart nothing yet. Check: no `.claude/alfred-code.stamp` left in any project, and `claude plugin list` shows no
   stack row. Review the diff and commit it as its own change.

The old servers' data stays where it was - the navigation index, the memory database (`~/.alfred-memory/` or
`~/.memory-mcp`), the browser profiles. Stage 3 can point the new servers at it.

## Stage 2 - install fresh

Cursor can run the plugin commands for you with
[prompt B](/docs/upgrading-from-2x-agent.md#4-prompt-b---stage-2-plugins); the init runs are yours.

### The root

1. Install the core for the root, in a terminal in the root folder:

   ```bash
   claude plugin install alfred-code@envoydev --scope project
   ```

2. Open Claude Code in the root and run `/alfred-code:init`. Its first question is the role - answer **Root**, not the
   Standalone it may recommend: a root is what the projects below can join. Walk the layers it shows (rules, skills,
   agents, hooks, plugins; keep the marked rows unless you know better) and let it install.
3. Restart Claude Code, then `/alfred-code:init` again: the one-time finish - language servers, the status line, the
   first docs, AGENTS.md, and once per account the marketplace auto-update question (a yes keeps the stack's
   marketplace current by itself).

### Each child, top-down

1. Install the core for this checkout only, in a terminal in the child folder:

   ```bash
   claude plugin install alfred-code@envoydev --scope local
   ```

2. Claude Code in the child, `/alfred-code:init`. The role question offers **Child of `<root>` (Recommended)** - take
   it, then **local (Recommended)** for the scope. The layer tables mark what the root already gives as `from root`:
   keep those, add only what this project needs on top.
3. Restart, `/alfred-code:init` again.

The first session in a child may ask 'allow external imports?' for the root's awareness rule. 'No' is safe: after the
join that rule is excluded there.

From now on one `/alfred-code:update` at the root updates the whole workspace: it asks 'Update the projects below
this one as well?' - 'Yes' runs each child top-down.

## Stage 3 - tools, mods and modes

### Put the credentials back

Restore the secret files you moved in stage 0 (an old `.sensitive-data` goes back under the new name `.secrets`), and
your `.env` files and shell exports. MCP keys get their own home in the next section.

### MCP servers - one list in the root, keys from the child or the root

The design: every server lives once in the root's `.mcp.json`, each child picks the ones it uses, and a server that
needs a key reads the child's own key when the child has one, else the root's. No key is ever written into
`.mcp.json` or `~/.claude.json`.

**How it works.** Every project the stack is installed in holds the stack's MCP launcher at
`.claude/hooks/secrets-run.js`. A server registered as `node .claude/hooks/secrets-run.js -- <its command>` starts
with the workspace's keys in its environment: the project's own `.alfred/.secrets` first, then each parent's up to the
root - the nearest value of a key wins. Measured on macOS (Claude Code 2.1.319, 2026-11-06): a server from the root's
`.mcp.json` starts in the CHILD's folder when the session is in a child, and the relative path reaches the child's own
launcher, so the child's lookup runs; in the root's session it is the root's. That held with the root a git repo and
with the root a plain folder, each child its own git repo. Not yet measured on Windows - step 5 checks it on your
machine.

1. **Keys.** In the root, add each key to `<root>\.alfred\.secrets`, one `NAME=value` per line, by hand in your editor.
   A child that needs a different key adds the same NAME to its own `.alfred\.secrets`; a child with none uses the
   root's. The names are what each server reads:

   | Server | Key name |
   | --- | --- |
   | context7 (optional key) | `CONTEXT7_API_KEY` |
   | github | `GITHUB_PERSONAL_ACCESS_TOKEN` |
   | sentry (token route) | `SENTRY_ACCESS_TOKEN` |

2. **Register the servers in the root** - in your own terminal, from the root folder, in Git Bash or PowerShell 7 (Windows
   PowerShell 5.1 strips the inner quotes). Run these yourself, not through an agent: the stack's secret guard refuses
   any shell command that names the launcher, and these commands carry no key, so they are safe to paste.
   - Servers WITH a key go through the launcher (pins from the `preferred-tools` catalog of 2026-11-04):

     ```bash
     claude mcp add-json context7 '{"type":"stdio","command":"node","args":[".claude/hooks/secrets-run.js","--","npx","-y","@upstash/context7-mcp@4.4.4"]}' --scope project
     claude mcp add-json github '{"type":"stdio","command":"node","args":[".claude/hooks/secrets-run.js","--","docker","run","-i","--rm","-e","GITHUB_PERSONAL_ACCESS_TOKEN","ghcr.io/github/github-mcp-server:v2.0.3","stdio"]}' --scope project
     claude mcp add-json sentry '{"type":"stdio","command":"node","args":[".claude/hooks/secrets-run.js","--","npx","-y","@sentry/mcp-server@0.42.0"]}' --scope project
     ```

   - Servers WITHOUT a key skip the launcher - it would hand them every key in the chain for nothing. On Windows an
     `npx` server needs `cmd /c` in front:

     ```bash
     claude mcp add-json serena '{"type":"stdio","command":"uvx","args":["--python","3.13","--from","serena-agent@2.1.0","serena","start-mcp-server","--context","claude-code","--enable-web-dashboard","false","--project-from-cwd","--agent-interface","tools"],"env":{"SERENA_USAGE_REPORTING":"false"}}' --scope project
     claude mcp add-json playwright-chrome '{"type":"stdio","command":"cmd","args":["/c","npx","-y","@playwright/mcp@0.0.83","--browser","chrome","--no-webmcp","--user-data-dir",".alfred/chrome-control","--output-dir",".alfred/chrome-control/output"]}' --scope project
     ```

     serena's `--project-from-cwd` and Playwright's relative profile folder follow the folder the server starts in, so
     each child gets its own index and browser profile. For any other server, take its launch line from the
     `preferred-tools` catalog (`catalog/tools.json`, its `local` route).
   - The hosted servers that sign in with OAuth (atlassian, gitlab, sentry's hosted route) hold no key in any file:
     `claude mcp add --transport http --scope project atlassian https://mcp.atlassian.com/v2/mcp`, then sign in once
     through `/mcp`.
3. **Choose per child.** Open Claude Code in each child: for every server in the root's `.mcp.json` it asks once -
   'New MCP server found in this project: `<name>`'. Answer 'Use this MCP server' or 'Continue without using this MCP
   server'. Avoid 'Use this and all future MCP servers in this project' where you want to choose: it takes every
   server the root adds later. The answer is that child's own (`enabledMcpjsonServers` in its
   `.claude/settings.local.json`); another child's answer, or the root's, does not carry over. Change it later with
   `/mcp` in that child.
4. **Rank the tools:** `/capture-preferences tools` in the root writes
   `.alfred/docs/preferences/TOOLS-PREFERENCES.md`, which every session and seat reads as its tool order. A child
   without its own reads the root's; a child that declined a ranked server runs it there for its own order.
5. **Check which key a child got** - names only, never a value. Start `claude --debug` in the child, let `/mcp` show
   the server connected, quit, then search the newest file in `~/.claude/debug/` (`%USERPROFILE%\.claude\debug\`) for
   `secrets-run:`. The launcher's line reads like `1 value(s) in the environment (CONTEXT7_API_KEY from ..)`: `.` is
   the child's own store, `..` the root's. No `secrets-run:` line, or `no chain value passed`, means the server did not
   start in the child's folder on your machine - stop and report it before relying on the fallback.

Two things to know:

- **A launched server receives every key in the chain**, not only its own: the github server also sees the sentry
  token. Keep only the keys your servers need in `.alfred/.secrets`.
- **Updates are by hand:** `/preferred-tools:update` does not manage these entries. Move a pin by running its
  `add-json` line again with the new version (`claude mcp remove <name> -s project` first).

### alfred-mods - the session inspector

`alfred-mods` (the plugin `session-inspector` until 0.5.0) is a band under the prompt and an `/inspect` pane with
context, usage, cost, tool failures, agents, cache and plan progress - with Alfred Code also the modes that are on, the
context runway and the resume prompt. It needs Claude Code 2.1.312 or later and adds nothing to each session's context.

```bash
claude plugin install alfred-mods@envoydev --scope user
```

Then `/reload-plugins` or a new session: `/plugin` shows `1 mod active · alfred-mods`. Install it through the
`envoydev` marketplace only - with the `alfred-mods` marketplace also added, keep one of the two installs. Updates:
`claude plugin marketplace update envoydev`, then `claude plugin update alfred-mods@envoydev`. A
`session-inspector` row still installed is the old name, no longer in the catalog and no longer loading: uninstall it
(`claude plugin uninstall session-inspector@envoydev --scope <its scope>`).

### Modes

Three modes, each switched for the session by its own command, typed alone on a line with `on` or `off`. Once on, a
mode stays on until its `off` command or the session ends; each prompt shows `Modes ON: ...`.

| Command | Effect |
| --- | --- |
| `/alfred-code:mode:auto-run on` / `off` | Every question takes its recommended option; nothing outward (push, merge, deploy, publish) runs unasked; no fresh-session question |
| `/alfred-code:mode:scoring on` / `off` | A fresh grader scores plans and root-cause verdicts before you see them |
| `/alfred-code:mode:auto-compact on` / `off` | No fresh-session question: the session compacts instead |

```text
/alfred-code:mode:auto-run on
/task-solve add paging to GET /api/loans
/mode-auto-run fix the failing lint rules one by one
```

The 2.x `--auto-mode` flag and the `--mode-auto-run-on` family of 3.0 to 3.10 are gone - each prints a pointer to the
commands.

The defaults live in `.alfred/.variables`. Set them once at the root in `/alfred-code:configure` (Environment area);
the children read them through the workspace unless they set their own:

| Key | Default | Means |
| --- | --- | --- |
| `ALFRED_CODE_SCORING` | `1` | The grader is on; `0` turns it off |
| `ALFRED_CODE_SCORING_OUTPUTS` | `designer-plan` | What is graded; add `root-cause,inline-plan` for everything |
| `ALFRED_CODE_SCORING_LEVEL` | `80` | The score an output must reach, 60-100 |
| `ALFRED_CODE_SCORING_ROUNDS` | `3` | Most grading runs per output, 1-10 |

3.11.0 renamed these four from `ALFRED_CODE_SCORER`, `_SCORER_LEVEL`, `_SCORER_OUTPUTS` and `_SCORER_ROUNDS`; an update
renames them in place.

Unattended runs pair the stack's mode with Claude Code's permission mode - print mode without one refuses every Bash
call: `ALFRED_CODE_UNATTENDED=1 claude -p "/alfred-code:update" --permission-mode auto` (PowerShell: set
`$env:ALFRED_CODE_UNATTENDED = '1'` first). On macOS prefix a long run with `caffeinate -s -i`.

## Check the result

In each project: `/alfred-code:status` (version, plugin health, the values and where each came from, a child's
`docs:` and `memory:` lines from the root), `claude mcp list` (only the servers you chose), and `/plugin` (one mod
active). Then commit `.claude/` and `.alfred/.variables`; at `local` scope `.variables` stays out of git by design.

## Updating in place instead

To keep the old picks and values with no questions: skip stages 1 and 2, move the plugin with
`claude plugin update alfred-code@envoydev --scope <scope>`, then run `/alfred-code:update` twice in each project -
root first, then each child, which it asks to join. The second run finishes the `.sensitive-data` to `.secrets` rename,
which takes two updates by design. The update also takes out the old MCP servers and prints one `add it back:` line
each. A child joined this way keeps its old scope and its old picks as its own.

## See also

- [The agent prompts for stages 1 and 2](/docs/upgrading-from-2x-agent.md)
- [README - Workspaces](/README.md#workspaces)
- [What the install writes](/docs/install-footprint.md)
- [preferred-tools](https://github.com/envoydev/preferred-tools)
