# Workspace layering - release 1 matrix

Run 2026-10-26 on `develop` at `64c381c6` (2.10.1, unreleased) against the workspace layering design of 2026-10-25
(a machine-local spec; its AC numbers are the rows below). Every `--source` is a clean export of
this tree (`node scripts/clean-export.js . <export>`). Every case runs in a throwaway tree under the temp dir, with a
throwaway `CLAUDE_CONFIG_DIR` and `HOME`. The installer's `claude` calls go to a stub: an sh script on macOS, an
npm-style `.cmd` shim handing `%*` to node on Windows. `check-loads` runs the real CLI, logged out: Claude Code 2.1.310
on macOS, and the same on the Windows 11 VM, run as SYSTEM with `TEMP` inside the work folder. AC28's old tree is
`git archive v2.10.0`.

## The runs

| Key | Command | Result |
|---|---|---|
| S | `node --test scripts/install-workspace.test.js scripts/workspace.test.js scripts/workspace-cli.test.js scripts/workspace-checkloads.test.js scripts/update-preflight.test.js scripts/init-plan.test.js scripts/matrix-smoke.test.js scripts/stack-select.test.js scripts/git-hygiene.test.js`, inside the export | 264/264 |
| S' | `node --test scripts/setup-plugin.test.js`, in the tree (it loads `js-yaml`, which the export has no `node_modules` for) | 83/83 |
| G | `node docs/workspace-layering-matrix/ws-matrix.js <export> <v2.10.0 tree>` | 29/29 |
| R | `node docs/workspace-layering-matrix/checkloads-ac30.js <export> <claude>` | 12/12 |
| W | Windows: `node --test scripts\workspace.test.js scripts\workspace-cli.test.js scripts\workspace-checkloads.test.js scripts\git-hygiene.test.js scripts\install-runtime.test.js`, inside the export | 116: 113 pass, 3 POSIX-only skipped |
| W' | Windows: `node docs\workspace-layering-matrix\ws-win.js <export> <claude.exe>` | 8/8 |
| Gate | `npm run gate`: lint and the whole suite on the committed tree, on macOS, Linux (Docker) and the Windows VM | PASS - 4289 tests, 0 failed on each leg (1 / 12 / 386 skipped) |

## Found and fixed during the run

Each fix has its regression test. The runs above are from after the last fix.

- **AC8 - `eb7d4dc1`.** A local child left the data root and a `.prettierignore` it created untracked in the team's
  repo. `git-hygiene.js` answered `none` for a root whose docs are versioned (the default), and nothing offered the
  `.prettierignore`. `--local-child`, which only `init-child.md`'s local template passes, now offers both. Update and
  configure stay as they were. The same commit fixes the references count in `docs/install-footprint.md`, which T15
  left at thirteen.
- **AC30 - `034fb40c`.** `check-loads` misread the AGENTS.md lines the real CLI writes:
  - the default mode lists every loaded file in one `', '`-separated line, which was read as one path;
  - with the account's `instructionFiles` key set, the plugin names no file, only the count it kept, so a seed
    loaded twice read clean.

  The list is now split, and the count is checked against the files on disk
  (`docs/workspace-layering-evidence.md`).
- **Windows - `5f8b4b0b`.** `resolveWin` joined a full path onto each PATH entry. On Windows that broke three
  things: every `process.execPath` spawn the workspace makes (the parent read-back, the cascade, the preflight asks)
  and `check-loads --claude <path>`. A drive or UNC path now resolves as that file. On Windows the check-loads unit
  tests start their fake through a `.cmd` shim.

## The final review's fix pass - `64c381c6`

A fresh reviewer read `b9aaedc3..5f8b4b0b`. Each Important finding got a test that failed first:

- A child's `--drop` of an item its parent holds (validate, a hand-run update) came back on the next update. It now
  writes that `ignore` line, and an `--add` of an ignored item lifts it.
- A child install trusted the walk to copy every from-root row into its selection. With `--parent-plan` the installer
  now adds the parent's set minus the child's ignores itself.
- A child that moved its data root in the same run read its workspace file at the new, empty path.
- Uninstalling a root stripped the lines of a listed child that names another parent. That child is now left as it is.
- `ALFRED_CODE_WORKSPACE=0` still asked D5. It now asks nothing.
- The cascade held every row until it exited, so a call that outran the Bash tool's 10 minutes left an empty
  `cascade.txt`. Each row is now written as it finishes, and the walk waits for a backgrounded cascade instead of
  starting a second one.

## Per acceptance criterion

| AC | Result | Where |
|---|---|---|
| AC1 init in a child writes both lines, its excludes, the root's set kept | PASS | S (AC1); G: every AC7 row |
| AC2 no root rule or seed AGENTS.md loads in a child; a deleted row is named | PASS | R (macOS); W' (a lowercase-typed and an all-caps cwd, under `my ws (team)`) |
| AC3 the root adds X, every child but an ignoring one gets it | PASS | S (AC3) |
| AC4 the root drops X, kept where own | PASS | S (AC4) |
| AC5 a second update changes no file | PASS | S (AC5) |
| AC6 a deleted child, a failed mid-level parent | PASS | S (AC6, two cases) |
| AC7 root at project, local and user by child at local, project and user | PASS | G (9 rows, and a root named `my ws (team)`); W' (3 child scopes under `my ws (team)`); S |
| AC8 a local child with a tracked settings.json, `.eslintignore` and Prettier | PASS after `eb7d4dc1` | G (4 rows); S (git-hygiene AC8); S' (init-child AC8) |
| AC9 D5: the key only on yes, every other key value-equal with indent, EOL and BOM, the last holder | PASS | S and W (workspace.test.js: apply, lastHolder; install-workspace AC9) |
| AC10 uninstall at the root | PASS | S (AC10) |
| AC11 the user's own exclude, server and settings key survive | PASS | S (AC11) |
| AC12 a malformed line kept and named; a missing parent makes the child standalone | PASS | S and W (workspace.test.js: unknown lines byte for byte, a refused parent) |
| AC13 join of a project installed before its root; Stay standalone; `--rescan` | PASS | G (6 rows); S (AC13) |
| AC14 env reaches a fresh local child's settings.local.json; own keys stay | PASS | S (AC14, two cases) |
| AC15 configure in a child: ignore and un-ignore an inherited skill | PASS | G (2 rows) |
| AC16 the kill switch | PASS | S (AC16); S (workspace-cli: plan at 0) |
| AC17 D5 re-ask once the key is removed by hand | PASS | G |
| AC18 two registers at once; a deleted line inherits nothing; Join brings it back | PASS | G (five rounds of concurrent registers); S (AC18; update-preflight rejoin) |
| AC19 - AC23 | NOT RUN | release 2 |
| AC24 - AC26 | NOT RUN | release 3 |
| AC27 standalone compatibility | PASS | S (AC27, two cases; update-preflight: no line standalone, nothing after `parent none`); R (`parent none` check-loads clean); Gate (the existing matrix unchanged) |
| AC28 upgrade from v2.10.0 | PASS | G (3 rows) |
| AC29 depth 7/8/9, rescan 4/5/6, lock 1.9/2.1 s and 29/31 s | PASS | S and W (workspace.test.js) |
| AC29 memory index and SessionStart cap bullets | NOT RUN | release 3 |
| AC30 the probe's env, HOME, no-credentials line, skips, the account key | PASS after `034fb40c` | R (11 rows); W' (the keyed count); S (AC30 units) |
| AC31 | NOT RUN | release 3 |
| AC32 the 'only' halves by path, size and sha256 | PASS | G (2 rows); S (AC32) |
