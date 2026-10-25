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
