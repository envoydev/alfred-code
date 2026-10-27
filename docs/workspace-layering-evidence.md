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

## Release 3 - A5, the memory folder's name (2026-10-27, Claude Code 2.1.311 macOS, 2.1.309 Windows 11 VM)

`node docs/workspace-layering-matrix/memory-probe.js <claude>`: one logged-out `claude -p hi` per case in a fresh git
project, a throwaway `CLAUDE_CONFIG_DIR` and `HOME`, an `InstructionsLoaded` hook from `--settings` (A9) writing its
payload. The folder its `transcript_path` names under `<config>/projects/` is compared with R6's name for the git top
(every character outside `[A-Za-z0-9]` as `-`, NFC; past 200 the first 200 plus `-*`). `<P>` below is the sanitized
throwaway folder (`-private-var-folders-...-T-mem-probe-<x>` on macOS, `C--Windows-Temp-memprobe-run-mem-probe-<x>` on
Windows); `x...` stands for the padding.

| Case | Typed cwd | macOS folder | Windows folder |
|---|---|---|---|
| plain | `Plain` | `<P>-Plain` | `<P>-Plain` |
| lowercase-typed | `mixedcase` (real `MixedCase`) | `<P>-MixedCase` | `<P>-mixedcase` |
| all-caps-typed | `MIXEDCASE2` (real `MixedCase2`) | `<P>-MixedCase2` | `<P>-MIXEDCASE2` |
| a space and an e-acute | `my projé` | `<P>-my-proj-` | `<P>-my-proj-` |
| sanitized 199 | `len199-x...` | exact, 199 | exact, 199 |
| sanitized 200 | `len200-x...` | exact, 200 | exact, 200 |
| sanitized 201 | `len201-x...` | `<first 200>-88hs3i` | `<first 200>-as0pke` |
| sanitized 201, lowercase-typed | `len201b-x...` (real `LEN201B-X...`) | `<first 200>-q93z7i`, real case | `<first 200>-b4yysy`, typed case |

macOS 8/8 PASS against R6 as written. Windows 8/8 PASS once the names are compared case-folded; the first run, which
compared them exactly, failed the two typed-case rows.

Verdicts:

- R6 holds on macOS: the folder is keyed by the real path's case, whatever was typed.
- On Windows Claude Code keys the folder by the cwd's case AS TYPED (A8's finding for the `projects` key, again here).
  NTFS opens a folder under any case, and each row up to 200 characters printed `R6's spelling opens it: yes` - so the
  computed path reaches the folder the session made, and the hooks' comparisons, which fold case on win32, match it.
  The one place a name is compared as text is the past-200 listing: it now ignores case on win32
  (`layout.memoryDirsOf`, the test 'memoryDirsOf past 200 on win32 lists a folder named in another case'). This is the
  plan's 'Revisit when' ask, taken in auto-run on its recommended answer: R6 stands, with that case-folded listing.
- Past 200 characters the suffix is a 6-character hash the stack cannot compute, so it lists `<first 200>-*`. A child
  shares its root's first 200 characters, so its own list holds every root candidate: such a child gets no memory line
  unless its own `autoMemoryDirectory` sets its folder apart (`layout.workspaceMemoryOf`). For the same reason neither
  the Edit deny nor the write guard protects the root's memory there: both leave out the child's own folders, and these
  are all of them. The same `autoMemoryDirectory` restores both, and the deny then covers every match.
- A4 (a Read under `additionalDirectories` asks no permission) PASS, 2026-10-28, Claude Code 2.1.312, one logged-in
  `claude -p` run ($0.08 reported). The child was built as R3-1 builds it - a root install, `workspace.js role --answer
  child`, the child install with `--parent-plan` - from a clean export of develop e48e6ea3; its `settings.local.json`
  listed only the root's `.alfred/docs` in `permissions.additionalDirectories`. The run set no permission mode and no
  allowed tools, so it ran in Manual mode (`permissionMode: default`), where a call that would prompt is denied:
  - a Read of a file in the root's docs folder returned its marker line with no denial;
  - the control, a Read of a sibling folder no setting lists, was denied - `permission_denied`, 'Path is outside allowed
    working directories' - so the run can tell the two apart.
