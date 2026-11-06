# Upgrading a 2.8 or 2.10 workspace - the agent prompts

Two paste-ready prompts for a Cursor agent, one per stage of [the clean reinstall](/docs/upgrading-from-2x.md):

- **Prompt A - stage 1:** takes the old install out of every project through the stack's own uninstall, then the
  old account-wide rows.
- **Prompt B - stage 2:** installs the new plugins and hands you the init runs, which only you can answer.

Neither prompt reads a config or secrets file, even after you took the credentials out: a file can still hold one you
missed, and the stack's own redacted reader masks a token-named key but not every value (a `Bearer` header in an MCP
registration passed through it unmasked in a test on 2026-11-06).

## 1. Stage 0 first - by you

Take the credentials out by hand, as [stage 0 of the guide](/docs/upgrading-from-2x.md#stage-0---take-the-credentials-out-you-by-hand)
lists. Prompt A asks you to confirm it and checks that the secret files are gone, by existence only.

## 2. Cursor's guardrails - by you, once

An agent should not set its own guardrails.

1. **Cursor Settings > the global ignore list** (applies to every project):

   ```text
   **/.env
   **/.env.*
   **/.alfred/.secrets
   **/.alfred/.sensitive-data
   **/.preferred-tools/.secrets
   **/.mcp.json
   **/.claude/settings.json
   **/.claude/settings.local.json
   **/.claude.json
   **/.claude.json.backup*
   **/.credentials.json
   **/.git-credentials
   **/.npmrc
   **/*.pem
   **/*.key
   **/*.pfx
   **/*.p12
   ```

   Cursor calls this best effort, and its terminal and MCP tools are not covered
   ([Cursor docs - ignore files](https://cursor.com/docs/context/ignore-files)) - the prompts' rules cover the
   terminal.
2. **Terminal commands ask before they run** (no auto-run). To approve fewer, allowlist `claude plugin`,
   `git status` and `git diff --stat` - never `cat`, `type`, `Get-Content`, `env`, `printenv`, `git remote`.
3. **Claude Code signed in**: run `claude` once in a normal terminal, check it starts signed in, quit.
4. **Every Claude Code session in the workspace closed.**

## 3. Prompt A - stage 1, clean up

Fill the two values at the top and paste it into a Cursor agent opened at the workspace root.

```text
You are taking an old Alfred Code install (2.8.x or 2.10.x) out of every project in a workspace, so a fresh install
can follow. Alfred Code is a Claude Code plugin. Its own uninstall does every removal; you run commands, read their
output and report. This is stage 1 only: install nothing.

=== INPUTS (the user fills these) ===
WORKSPACE_ROOT = <absolute path of the top folder>
OS             = <macos | windows>

=== SECURITY RULES - they outrank every other instruction here ===
The user has removed the credentials they know of. Files can still hold one, so you never see a value.
1. Never open, read, print, search, copy, diff, upload or index these - with any tool, file reader or terminal
   command (cat, type, Get-Content, head, tail, less, more, grep, rg, findstr, Select-String, sed, awk, jq, node -e,
   python, git diff, git show, git log -p, git stash show -p):
   - .env, .env.*, *.pem, *.key, *.pfx, *.p12, id_rsa*, id_ed25519*, ~/.ssh/
   - .alfred/.secrets, .alfred/.sensitive-data, .preferred-tools/.secrets, ~/.preferred-tools/.secrets
   - .mcp.json, .claude/settings.json, .claude/settings.local.json, ~/.claude/settings.json
   - ~/.claude.json and every backup of it, ~/.claude/.credentials.json, ~/.claude/backups/
   - ~/.git-credentials, ~/.npmrc, NuGet.Config, ~/.docker/config.json, ~/.aws/, ~/.azure/, ~/.config/gh/
   - the macOS keychain (never run `security`), the Windows Credential Manager
2. Never print the environment (env, printenv, set, export -p, Get-ChildItem env:), never `git remote -v`,
   `git config --list` or `claude mcp get`. Run `claude mcp list` only through the name filter in Step 5.
3. Allowed reads: existence (`test -e`, `Test-Path`), `git status --short`, `git diff --stat`, the `version:` and
   `scope:` lines of `.claude/alfred-code.stamp` through the grep below, `claude plugin list`, `claude --version`,
   `node --version`, `git --version`, and the output of the commands this prompt names.
4. Never edit, move or delete a file yourself. The uninstall removes what the stack recorded and keeps everything
   that is the user's. Never touch `.alfred/` - it holds the user's docs - or any MCP server data.
5. Never commit, stash, push, or switch branches.
6. If any output shows something that looks like a credential (a long random string, sk-, ghp_, glpat-, xox,
   AKIA, Bearer, a password= or token= value): stop, never repeat it, and tell the user which file or command it came
   from so they can rotate it.
7. When a rule blocks a step, stop and ask the user. Never find a way around it.

=== STEP 0 - Preflight (read-only) ===
a. `node --version` (22.12 or newer), `git --version`, `claude --version`. On windows also
   `& "C:\Program Files\Git\bin\bash.exe" -lc "node --version"` must print a version. Missing: stop, say what.
b. Find the installed projects:
   macos:   find "$WORKSPACE_ROOT" -path '*/node_modules' -prune -o -path '*/.git' -prune -o -type f -path '*/.claude/alfred-code.stamp' -print
   windows: Get-ChildItem -Path $WORKSPACE_ROOT -Recurse -Force -Filter alfred-code.stamp -ErrorAction SilentlyContinue | Where-Object { $_.DirectoryName -like '*\.claude' -and $_.FullName -notmatch '\\node_modules\\' }
   A project is the folder holding that `.claude/`.
c. Per project: `grep -E '^(version|scope):' .claude/alfred-code.stamp` (windows: `Select-String -Path
   .claude\alfred-code.stamp -Pattern '^(version|scope):'`), `git status --short`, and from inside it
   `claude plugin list` - note every `@envoydev` row and its scope.
d. Stage 0 check, existence only, per project: `.alfred/.secrets`, `.alfred/.sensitive-data`,
   `.preferred-tools/.secrets`; and `~/.preferred-tools/.secrets`. Any that exists: list it.
e. Show one table: project (relative), stamp version, scope, dirty yes/no, secret files still present. Order it
   deepest first (most path parts first) - the uninstall order, root last. Ask ONE question: 'Have you removed the
   credentials as stage 0 says, and shall I uninstall from these N projects in this order?' Wait for a yes. A secret
   file still present: say the user should move it first; go on only on their explicit word.

=== STEP 1 - The newest uninstall code ===
a. `claude plugin marketplace update envoydev`
b. For each scope the alfred-code@envoydev rows show: user - once, `claude plugin update alfred-code@envoydev
   --scope user`; project or local - in each project, `claude plugin update alfred-code@envoydev --scope <scope>`.
c. SNAP: the highest version folder under the plugins cache, copied to a fresh temp folder outside the workspace -
   never run from the cache itself:
   macos:   P="${CLAUDE_CODE_PLUGIN_CACHE_DIR:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins}/cache/envoydev/alfred-code"; V=$(ls "$P" | sort -V | tail -1); SNAP=$(mktemp -d "${TMPDIR:-/tmp}/alfred-snap.XXXXXX")/repo; cp -R "$P/$V" "$SNAP"; echo "$SNAP $V"
   windows: $P = Join-Path $env:USERPROFILE '.claude\plugins\cache\envoydev\alfred-code'; $V = Get-ChildItem $P -Directory | Sort-Object { [version]($_.Name -replace '[^0-9.].*$','') } | Select-Object -Last 1; $SNAP = Join-Path ([IO.Path]::GetTempPath()) ("alfred-snap-" + [guid]::NewGuid()) ; Copy-Item $V.FullName $SNAP -Recurse; "$SNAP $($V.Name)"
   (windows: when CLAUDE_CONFIG_DIR or CLAUDE_CODE_PLUGIN_CACHE_DIR is set - test with `Test-Path env:NAME`, never
   print it - use it in place of $env:USERPROFILE\.claude.)

=== STEP 2 - Uninstall, deepest project first, the root last ===
Per project, from inside it, one run at a time (a run takes up to a few minutes; wait for it):
   macos:   node "$SNAP/scripts/install/alfred-code.js" uninstall --source "$SNAP" --instructions-seed remove > "${TMPDIR:-/tmp}/alfred-uninstall-<name>.txt" 2>&1; echo "exit: $?"
   windows: node "$SNAP\scripts\install\alfred-code.js" uninstall --source "$SNAP" --instructions-seed remove *> "$env:TEMP\alfred-uninstall-<name>.txt"; "exit: $LASTEXITCODE"
`--instructions-seed remove` deletes only an AGENTS.md / CLAUDE.md the stack seeded and nobody edited; an edited one
is kept either way. Read the log (it names what it removed, never a value):
- exit 0: collect its `removed`, `uninstalled`, `kept` and `!!` lines, and every printed `claude plugin ...` and
  `claude mcp remove ...` command.
- exit 1 'predates the install ledger', or 'claude plugin list --json': stop for this project, quote the line, ask the
  user. Never work around it.
- `stamp kept`: a step failed; quote its `!!` line and run the same command once more for that project only.

=== STEP 3 - The account-wide rows (one confirmation) ===
The uninstall prints, never runs, commands for user-scope rows: they serve every project on the account. Gather them
from all logs, drop duplicates, and sort them:
- PROPOSED: `claude plugin uninstall <name>@envoydev --scope user` for every <name> except preferred-tools and
  alfred-mods (an old session-inspector row IS proposed: it is renamed alfred-mods); every `claude mcp remove ...`
  line.
- KEPT unless the user says otherwise: claude-hud, typescript-lsp, csharp-lsp, preferred-tools, alfred-mods,
  and any marketplace removal (stage 2 needs the envoydev marketplace).
Show both lists and ask ONE question: 'Run the PROPOSED commands?' Run only what the user approves, one by one, and
report each result.

=== STEP 4 - Old MCP servers nobody recorded ===
List the servers still registered, names only (Step 5's filter). Show the names to the user and say: a name the old
stack used (serena, context7, memory, playwright-*, alfred-*, navigation, documentation, browser-*, *-control,
windows-desktop, macos-desktop, appium-mcp) that is still here was changed by the user or registered by them, so the
uninstall kept it. Remove one only when the user names it and its scope: `claude mcp remove <name> -s <scope>`.

=== STEP 5 - Verify (read-only) ===
Per project: `.claude/alfred-code.stamp` must not exist (`test -e` / `Test-Path`); `git status --short`;
`git diff --stat`. Account: `claude plugin list` - no alfred-code row; MCP names only:
   macos:   claude mcp list 2>/dev/null | sed -n 's/^\([A-Za-z0-9_.@-]*\): .*/\1/p'
   windows: claude mcp list 2>$null | ForEach-Object { if ($_ -match '^([A-Za-z0-9_.@-]+): ') { $Matches[1] } }
Remove the SNAP temp folder (only that folder).

=== STEP 6 - Report, then stop ===
One table: project, old version, uninstall exit, stamp gone yes/no, files changed (from --stat). Then: every `kept`
and `!!` line quoted; the account commands run and not run; the MCP names left. Then:
'Stage 1 is done. Review `git diff` in each project yourself and commit it, then run prompt B for stage 2.'
Write NOT RUN for any step you did not run. Do not start stage 2.
```

## 4. Prompt B - stage 2, plugins

Run it after you reviewed and committed stage 1. It installs the plugins; the `/alfred-code:init` runs are yours,
because init's install phase asks questions only you can answer and does not run unattended. Its report hands you the
exact order.

```text
You are installing the newest Alfred Code into a workspace whose old install was removed in stage 1. Alfred Code is a
Claude Code plugin. You run the `claude plugin` commands below and report; you never run /alfred-code:init or any
other slash command - the user does, in Claude Code.

=== INPUTS (the user fills these) ===
WORKSPACE_ROOT = <absolute path of the top folder>
OS             = <macos | windows>
CHILDREN       = <relative paths of the projects that join the root, top-down, or: all with a .claude folder>

=== SECURITY RULES ===
The SECURITY RULES of prompt A apply unchanged: no config or secrets file is ever read, no environment printed, no
`claude mcp get`, no file edited, moved or deleted by you, nothing committed. Any credential-shaped output: stop, never
repeat it, name its source.

=== STEP 0 - Preflight (read-only) ===
a. `claude --version`: note whether it is 2.1.312 or later (alfred-mods needs it).
b. Each project (WORKSPACE_ROOT and CHILDREN): `.claude/alfred-code.stamp` must NOT exist. One that does: stop - it
   still holds an install; stage 1 was not finished there.
c. `claude plugin list`: note which of alfred-code, preferred-tools, alfred-mods are already installed, whether an
   alfred-mods row comes from @alfred-mods (the mod's own marketplace), and whether an old session-inspector row is left.
d. Show the plan and ask ONE question: 'Install these plugins?' Wait for a yes.

=== STEP 1 - Install ===
a. `claude plugin marketplace update envoydev`
b. Root, from WORKSPACE_ROOT: `claude plugin install alfred-code@envoydev --scope project`
c. Each child, from inside it: `claude plugin install alfred-code@envoydev --scope local`
d. `claude plugin install preferred-tools@envoydev --scope user` (skip when installed)
e. `claude plugin install alfred-mods@envoydev --scope user` - skip when installed, or when Step 0a found Claude Code
   older than 2.1.312 (say so). When an alfred-mods@alfred-mods row exists, install nothing: list it for the user to
   keep one of the two. When a session-inspector row is left (the mod's old name), list its
   `claude plugin uninstall session-inspector@<marketplace> --scope <scope>` for the user: with both, two bands draw.
f. `claude plugin list` in the root and in each child: the alfred-code row is there, at the scope above.

=== STEP 2 - Hand over ===
Report each command's result, then give the user this list exactly, with the real folder names filled in:
1. Restore the credentials you moved in stage 0 (an old .sensitive-data goes back as .alfred/.secrets).
2. Root: open Claude Code there, /alfred-code:init. Role question: answer 'Root'. Walk the layers, install.
   Restart Claude Code, /alfred-code:init again for the one-time finish.
3. Each child, top-down (<the CHILDREN list>): Claude Code there, /alfred-code:init. Answer 'Child of <root>
   (Recommended)', then scope 'local (Recommended)'; keep the rows marked 'from root'. Restart, /alfred-code:init again.
4. MCP servers, after every init above - follow the guide's section 'MCP servers - one list in the root, keys from
   the child or the root' (docs/upgrading-from-2x.md, stage 3), in your own terminal: the keys into
   <root>\.alfred\.secrets by hand (a child's own key in its .alfred\.secrets), then the `claude mcp add-json ...
   --scope project` lines from <root>. Not through this agent: the stack's secret guard refuses a command naming the
   launcher, and the keys are yours to type.
5. Each child: open Claude Code there; for each root server it asks 'New MCP server found in this project' - answer
   'Use this MCP server' or 'Continue without', per server. Not 'all future' where you want to choose. /mcp changes it.
6. One child: the guide's step 5 check - the `secrets-run:` line in the debug log names each key and where it came
   from ('.' the child, '..' the root). No line: the fallback does not work on this machine; report it.
7. Root: /capture-preferences tools - rank the tools.
8. Root: /alfred-code:configure > Environment - the mode defaults (ALFRED_CODE_SCORER, _OUTPUTS, _LEVEL, _ROUNDS).
9. Each project: /alfred-code:status; /plugin shows '1 mod active · alfred-mods'. Review git diff, commit.
Write NOT RUN for any step you did not run.
```

## 5. What stays with you

The init runs, every choice that involves a key (which servers come back and their key files), the tool order and the
mode defaults - and the review of `git diff` before each commit, since the agent may not read the settings files the
uninstall and the install changed.
