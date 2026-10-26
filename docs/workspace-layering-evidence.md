# Workspace layering - probe evidence

Probes for the workspace layering design. Each probe is a logged-out `claude -p hi --debug --debug-file <one file per run>`
run with a throwaway `CLAUDE_CONFIG_DIR` and an allow-list environment, so it loads everything before it stops at auth
and nothing is billed. `<S>` is the throwaway tree and `<R>` its real path.

## A9 - `--settings` hooks fire logged out (2026-10-25, Claude Code 2.1.310, macOS)

Tree: `<S>/ws/.claude/rules/r1.md`, `r3.md` (the control), `<S>/ws/.claude/AGENTS.md`, `<S>/ws/a (b) [c]/.claude/rules/r2.md`,
and a git child `<S>/ws/a (b) [c]/kid`. Command, run from the kid:

```bash
env -i PATH="$PATH" HOME=<S>/home CLAUDE_CONFIG_DIR=<S>/acct TMPDIR="$TMPDIR" \
  claude -p hi --debug --debug-file <S>/<run>.log --settings <S>/hooks-<run>.json
```

`hooks-<run>.json` holds one `InstructionsLoaded` command hook. The hook writes each payload to its own file in `<S>/ev-<run>/`.

- The baseline, with no excludes, gave the events `session_start <S>/ws/.claude/rules/r1.md` and
  `session_start <S>/ws/a (b) [c]/.claude/rules/r2.md`. So A9 holds: hooks from `--settings` fire before the auth stop.
- The ancestor AGENTS.md raises no `InstructionsLoaded` event. The built-in plugin logs it instead.
- The debug-log strings `check-loads` reads, verbatim:
  - no credentials: `[Bootstrap] Skipped: no usable OAuth, WIF, or API key`
  - each hook run: `InstructionsLoaded:session_start [<command>] completed with status 0`
  - AGENTS.md: `[cc-plugin-agents-md] $.ui.log (to debug): no CLAUDE.md found; AGENTS.md loaded: <path>`
  - nothing found: `$.fs.ancestors (cc-plugin-agents-md): AGENTS.md, .claude/AGENTS.md found 0 of 10 directories`

## The AGENTS.md lines with and without the account key (2026-10-26, Claude Code 2.1.310, macOS)

The release 1 matrix (AC30) ran `check-loads` with the real CLI on a root `<S>/ws` (a filled `AGENTS.md`, the seeded
`.claude/AGENTS.md`) and its git child `<S>/ws/api` (its own `.claude/AGENTS.md`), no CLAUDE.md anywhere:

- No `pluginConfigs` key: one line names every file loaded, `', '`-separated -
  `[cc-plugin-agents-md] $.ui.log (to debug): no CLAUDE.md found; AGENTS.md loaded: <S>/ws/AGENTS.md, <S>/ws/api/.claude/AGENTS.md`.
- The account's `instructionFiles: claude-md-and-agents-md` passed through `--settings`: no `loaded:` line and no
  CLAUDE.md scan line, only the count the scan kept after the excludes -
  `$.fs.ancestors (cc-plugin-agents-md): AGENTS.md, .claude/AGENTS.md found 2 of 9 directories` with the child's
  excludes, `found 3 of 9` with the seed's row taken out. The project is 10 folders deep: the filesystem root is not
  scanned.

So `check-loads` splits the list, and with no list compares the count with the files on disk the excludes leave.

## The exclude-glob escape (2026-10-25 22:08Z, Claude Code 2.1.310, macOS)

`claudeMdExcludes` in the kid's `.claude/settings.local.json` named `r1.md`, `.claude/AGENTS.md` and `r2.md`, all by
real path (`<R>`, with `/private/tmp`):

| Form | r1 | AGENTS.md | r2 (under `a (b) [c]`) | r3 (control) |
|---|---|---|---|---|
| none | loaded | loaded | loaded | loaded |
| a class per letter, metacharacters as `[(]` `[[]` | excluded | excluded | excluded | loaded |
| backslash escape (`\(` `\[`) | excluded | excluded | LOADED | loaded |

The verdict: write a metacharacter as a one-character class, never as a `\` escape. The space and the `.` need nothing.

## Plain folder versus git child - skills (2026-10-25 21:59Z, Claude Code 2.1.310, macOS)

- A plain sub-folder logs `Loading skills from: ... project=[<child>/.claude/skills, <root>/.claude/skills]` and then
  `Loaded 2 unique skills`.
- A git child logs only `<child>/.claude/skills`, and then `Loaded 1`.

## Windows (2026-10-25, Claude Code 2.1.309, Windows 11 VM)

The same tree sat under `C:\wsprobe\Ünï dir\`: a space, a non-ASCII letter, and `a (b) [c]` below it. The run was
`claude -p hi --debug --debug-file "<log>" --settings "<hooks>"`, through `cmd` with every argument quoted. An unquoted
path with a space failed with `Settings file not found`. The environment held only `PATH`, `SystemRoot`, `TEMP`,
`TMP`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` and `CLAUDE_CONFIG_DIR`. Every run logged the no-credentials line.

| cwd typed | Form | Loaded (`InstructionsLoaded`) | AGENTS.md loaded |
|---|---|---|---|
| lowercase | none | r1, r2, r3 | yes |
| lowercase | a class per cased letter (`[üÜ]` too), metacharacters as `[(]` `[[]` | r3 | no |
| lowercase | backslash escape, real case | r1, r2, r3 | yes |
| all caps | none | r1, r2, r3 | yes |
| all caps | class form | r3 | no |
| all caps | backslash escape, real case | r2, r3 | no |

The verdict matches macOS. The class form excludes from either typed case, non-ASCII letters included. The backslash
form misses on case and on brackets. A9 holds on Windows too.

## Release 2 - MCP probes A7, A8, A10, A11 (2026-10-26, Claude Code 2.1.310 macOS, 2.1.309 Windows 11 VM)

`docs/workspace-layering-matrix/mcp-probe.js`, each run in a throwaway `CLAUDE_CONFIG_DIR` and `HOME`, logged out. `<S>`
is the throwaway tree. The test server writes its cwd and whether `ALFRED_CODE_DATA_PATH` is in its env, and speaks no
protocol.

macOS:

```text
PASS A7: 'add-json -s local probe <json>' exit 0, entry under key '/private<S>/ws/api'
RESULT A7: stored entry vs sent - added [], dropped [], changed []
RESULT A7/A8 (darwin): child typed as '<S>/ws/api', real '/private<S>/ws/api', key '/private<S>/ws/api'
RESULT A7: option last ('add-json probe2 <json> -s local') exit 0, stored
RESULT A10: claude -p exit 1 (auth stop); server started yes, cwd the child, settings env ALFRED_CODE_DATA_PATH present
  log: [DEBUG] MCP server "a10": Starting connection with timeout of 30000ms
RESULT A11 control: project server alone started [project] (exit 1) - valid
RESULT A11: both registered, started [local] (exit 1)
```

Windows (run as SYSTEM through `prlctl exec`, `TEMP` inside the work folder; the A8 rows `--keys` from a typed cwd):

```text
PASS A7: 'add-json -s local probe <json>' exit 0, entry under key 'C:/mcpw/tmp/<S>/ws/api'
RESULT A7: stored entry vs sent - added [], dropped [], changed []
RESULT A7: option last ('add-json probe2 <json> -s local') exit 0, stored
RESULT A10: claude -p exit 1 (auth stop); server started yes, cwd the child, settings env ALFRED_CODE_DATA_PATH present
RESULT A11 control: project server alone started [project] (exit 1) - valid
RESULT A11: both registered, started [local] (exit 1)
RESULT A8: add-json from 'C:\mcpw\keys\child' exit 0
RESULT A8: projects key stored as 'C:/mcpw/keys/child'
RESULT A8: add-json from 'C:\MCPW\KEYS\CHILD' exit 0
RESULT A8: projects key stored as 'C:/MCPW/KEYS/CHILD'
```

Verdicts:

- A7 holds: `-s local` before the name is accepted (and after it), and the entry is stored exactly as sent on both.
- A8: the `projects` key is the cwd Claude Code starts in - the REAL path on macOS (`/private/var/...` for a `/var/...`
  cwd), the path AS TYPED on Windows with `\` written as `/` and the typed case kept. The parent matcher compares each
  key and the parent root by real path, case-folded on darwin and win32, `\` as `/`; two matches change nothing.
- A10 holds: a stdio server starts before the logged-out auth stop, in the session's project folder, with the project
  settings' `env` in its environment. No logged-in run was needed (R7).
- A11 holds: with the project server approved, the LOCAL entry of the same name starts.
- A3 NOT RUN - needs an interactive approval: open a session in a child under a root whose .mcp.json holds a server,
  approve it, then open one in a second child and see whether it asks again.
