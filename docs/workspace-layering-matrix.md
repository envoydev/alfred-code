# Workspace layering - the release matrices

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

## Release 2 - roles and variables

Run 2026-10-27 on `develop` at `6c0996bb` (3.0.0, unreleased) against the roles-and-variables design of 2026-10-27 (a
machine-local spec; its AC numbers are the rows below). The setup is release 1's: a clean export of this tree as
every `--source`, a throwaway tree, `CLAUDE_CONFIG_DIR` and `HOME` per case, the `claude` stub. The old trees are
`git archive v2.12.0` and `git archive v2.10.0`.

### The runs - release 2

| Key | Command | Result |
|---|---|---|
| S | `node --test` over the 24 suites the change touches, inside the export | 889: 874 pass, 14 skipped (the cases that need a release tag or an 8.3 name), 1 environmental (`variables-readers` runs `git ls-files`, and the export has no `.git`; 3/3 in the tree) |
| S' | `node --test scripts/setup-plugin.test.js`, in the tree | 89/89 |
| F | the review's fix pass, in the tree: `install-workspace`, `workspace`, `install-settings-writer`, `install-variables-move`, `install-variables`, `workspace-cli`, `check-turn-build`, `one-gitignore`, `git-hygiene`, `install-data-root`, `docs-move` | 279/279, 133/133, 247/247 |
| M | `node docs/workspace-layering-matrix/ws-matrix-r2.js <export> <v2.12.0 tree> <v2.10.0 tree>` | 81/81 (77 acceptance rows, 4 fix-pass rows) |
| Gate | `npm run gate` on the final commit | not run for this release alone - the 3.0.0 release runs one gate over releases 2 and 3 on its final commit |

### Found and fixed - release 2

Each fix has its regression test; the runs above are from after the last fix.

- **AC24 - `7bd376c`.** The update walk's 'Join' runs before the installer moves the values, so a 2.12.0
  standalone's settings seeds landed in its `.variables` as its own and hid the root's. The installer now names
  those seeds at their ledger hash and drops them.
- **AC24 - `b14b286`.** `variables.js show` labelled every inherited value `env`: the CLI loads the hook prelude,
  which applies the variables to the process env. The entry now passes the launch env it took before the prelude.
- **The final review - `7e011bc`.** A 2.12.0 child registered while its switch was off had never been pruned, and
  the update pruned it anyway. The prune now marks the stamp, and only a marked project loses seeds. The prune also
  dropped an installer answer that matched the stamp (`--auto-compact on`). Now only a value equal to the catalog
  default counts as a seed. And a child's settings pass ignored the `AUTO_COMPACT` / `MEMORY` it inherits, so
  Claude Code compacted and remembered as if they were unset. The members' values are now its lowest layer.
- **The final review - `0ae1716`.** A data-root `.gitignore` the user wrote was read as the stack's own, so the
  keys moved into a file git ignores. Only a file with the stack's head counts as its own. The `!!` hint now says
  to add `!/.variables` to that file.
- **The final review - `9eaeae1`.** A local-scope run rewrote the team's committed data-root `.gitignore` and
  dropped its `!/.variables` line. A tracked file that has the line keeps it.
- **The final review - `6c0996b`.** The turn check's block message pointed to the settings.json env, which the
  loader no longer reads for that key. It now names `.variables`.

### Per acceptance criterion - release 2

| AC | Result | Where |
|---|---|---|
| AC1 the workspace file's lines round-trip; `wsLine` and `parseLine` agree | PASS | S (workspace.test AC1) |
| AC2 init's role ask | PASS | M (AC2, AC2b, AC2c) |
| AC3 a quiet update after any answer | PASS | M (AC3, three projects) |
| AC4 tree changes: one ask, and the first option unattended | PASS | M (AC4, AC4b, AC4c) |
| AC5 configure's role changes; root to standalone refused with a child | PASS | M (AC5) |
| AC6 status's five role words | PASS | M (AC6) |
| AC7 fresh install at each scope; git-hygiene's line rewritten; the user's own line stops the move | PASS | M (AC7 at project, user and local; AC7-hygiene; AC7-own-line) |
| AC8 update over v2.12.0 at each scope; the user's own line stops it | PASS | M (AC8 at each scope; AC8-own-line) |
| AC9 update over v2.10.0 at each scope | PASS | M (AC9 at each scope) |
| AC10 the user's config is kept | PASS | M (AC10, AC10-local) |
| AC11 missing, empty and garbage input; two writers | PASS | M (AC11) |
| AC12 the loader's order; AC13 no copy | PASS | M (AC12, AC13 inside it) |
| AC14 a 2.12.0 tree with the switch on | PASS | M (AC14) |
| AC15 leaving keeps the values; with the root gone | PASS | M (AC15, AC15-gone) |
| AC16 a tracked `.variables` and a local-scope run | PASS | M (AC16) |
| AC17 the secret guard, `HOOKS_OFF` in settings | PASS | M (AC17, AC17-update) |
| AC18 the MCP hint | PASS | M (AC18) |
| AC19 the switch | PASS | M (AC19, AC19-copy) |
| AC20 boundaries and cost | PASS | M (AC20: standalone 27.5 ms vs 2.12.0 26.7 ms, depth 8 30.8 ms) |
| AC21 lint, suites, matrix, gate | PASS; the gate runs at the 3.0.0 release | `npm run lint` clean; S, S', F, M; Gate |
| AC22 no direct settings reader | PASS | S (variables-readers, 3/3 in the tree; stamp-docs-root; update-preflight) |
| AC23 Claude Code's own settings follow the file | PASS | M (AC23 at project and local) |
| AC24 a join inherits | PASS after `7bd376c`, `b14b286` | M (AC24 via update and via configure) |
| The review's I1-I4 | PASS after `7e011bc`, `0ae1716`, `9eaeae1` | M (FX-I1 to FX-I4; each FAIL on `b14b286`) |
| Windows | NOT RUN | this release's matrix runs on macOS only; the gate's Windows leg runs the suites |
