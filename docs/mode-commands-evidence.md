# The mode commands - evidence

What the three `/alfred-code:mode:*` commands do once their modes live in the checkout's own
`.claude/settings.local.json`, measured on throwaway projects from this working tree before the commit.

Result words: `PASS`, `FAIL`, `NOT RUN - <reason>`, `FACT` (a value read, for a page that quotes it).

## Stage 3 - the modes are variables

- Date: 2026-11-13. macOS, Node 22.23.3, Claude Code 2.1.323; Windows 11 in a Parallels VM for the gate's leg and
  the Windows rows; Linux in a `node:22` container for the gate's leg.
- The older install is the 3.10.0 release tree (`git archive ee3dae1c`, with its `RELEASE-SOURCE`); this tree is the
  working tree through `scripts/clean-export.js`. Each row is a temp project with its own HOME and
  `CLAUDE_CONFIG_DIR`, removed after; the real account's plugin records and `settings.json` were hashed before and
  after, unchanged.
- A row reads the files written - the mode block, Claude Code's `autoCompactEnabled` and `modelSettings` windows,
  `.alfred/.variables`, the stamp - and the `[mode]` line each command prints, never the exit code alone.

### The first checks

| Check | Result |
|---|---|
| A7 - the readers of the four mode keys are the ones the plan lists | PASS |
| A11, safety - an ask answered by a hook is written with `permissionDecision.source` `hook` | PASS - 3 of 3 runs, through the terminal (pty) |
| A11, availability - a person's pick is written with a source opening `user` | PASS - `user_temporary`, 3 of 3 runs |
| A4 - the terminal shows a SessionStart hook's `systemMessage` | PASS - shown at startup and after `/clear`; the session-start line is built |
| Print mode offers `AskUserQuestion` to a scripted tool call | FACT - it does not (2.1.323): the probe's hook leg runs through the pty |
| An answer row under v1's stamp | NOT RUN - no answer row in print mode or in the terminal under v1's stamp |

### The matrix - 165 PASS, 0 FAIL, 2 NOT RUN on macOS; 16 PASS, 0 FAIL, 1 NOT RUN on Windows

| Row | Case | Checks | Result |
|---|---|---|---|
| M1 | fresh install at `local`, `project`, `user`, then the eight command lines in order | 42 | PASS - each line's block and `[mode]` line, Claude Code's two keys with `1`, `false` with a typed `0` |
| M2 | update over 3.10.0 at each scope, with `ALFRED_CODE_AUTO_COMPACT=1` in `.variables` and with a seeded `0` | 18 | PASS |
| M3 | a re-run of M2's update, and of M1 after the eight lines | 9 | PASS - every file byte-identical |
| M4 | the user's own config: settings rows, the account's `autoCompactWindow`, a hand-added hook and MCP server, their own `env` key and `permissions` | 6 | PASS - all untouched, the account's window named and left |
| M5 | the local file absent, empty, garbage, a folder, tracked; `.variables` garbage; `model-windows.json` missing | 6 | PASS - nothing refused is written, the `[mode]` line names the cause |
| M6 | the first command of each kind in a project with no local file | 6 | PASS - created with the block alone; in a repository the unignored line once |
| M7 | no repository | 4 | PASS - no git call recorded by a logging shim |
| M8 | git off the hook's PATH, and a `.claude` that is a link | 6 | PASS - `auto-run on` refused with `git cannot say the file is yours alone`, the other two written |
| M9 | a `0` from before this release: ledgered (local scope, tracked `.variables`) and personal (project scope over a team's `1`) | 9 | PASS |
| M10 | the copied `1` and `--auto-compact off` | 4 | PASS |
| M11 | a mode command, then an update, each scope | 3 | PASS - the block byte-identical |
| M12 | a same-repository child (macOS): `auto-compact on` typed in the child | 4 | PASS - the keys in the root's file with the root's tier windows, the child's file untouched, the child's update leaves the root's file byte-identical |
| M13 | a linked worktree | 3 | PASS - the main checkout's file |
| M14 | a child in its own repository | 2 | PASS - its own block |
| M15 | boundaries: level 59, 60, 100, 101; triggers 0, 99,999, 100,000, at and past the window; a tier removed and garbage | 6 | PASS |
| M16 | two sessions, the variable on, then `off` in one | 4 | PASS - both asks answered, then the other's next ask goes to its user |
| M17-M21 | the stamp, receipts and discards under the standing variable | - | NOT RUN in the matrix - held by `probe-answer-source`, `audit-2026-10-30-fixpass-receipts`, `guard-commit-gate` and `guard-hooks` in the full suite |
| M22 | the skills and hooks copy routes, fresh and over 3.10.0 | 10 | PASS - `mode-settings.js` and `json-file.js` copied; the copied hook writes and reads the block |
| M23 | hooks off, the minimal profile, a Cursor payload | 3 | PASS - nothing written, no `[mode]` line |
| M24 | the model's write of `ALFRED_CODE_AUTO_RUN=1` through Edit, Write and the shell | 7 | PASS - each denied with the guard's line, a removal passes, the file byte-identical |
| M25 | uninstall at each scope, and from a same-repository child | 8 | PASS - the block leaves, the user's keys stay |
| M26 | the revert: the base hooks over a full block | 4 | PASS - every run exits 0 |
| M27 | the real account's files | 1 | PASS - the hashes equal |
| M12w | the Windows half of M12: a project below its repository's top keeps its own block | 3 | PASS on Windows - the keys in the child's own file, the root's file byte-identical, a root session reads no auto-compact; NOT RUN on macOS |

On Windows the VM ran M5, M6 (inside M5's case), M8 and M12w from a clone of the commit: 16 PASS, 0 FAIL; M8 is NOT
RUN there, a POSIX PATH and symlink row. Claude Code reads a start folder's own local file below the top on Windows
(`layout.localSettingsFile`), so the suite's sub-folder windows case is POSIX-only and M12w holds the Windows half.

The first run read 148 PASS and 10 FAIL. Nine were the rows' own errors (a `git` call without the sandbox's env, a
`0` prepared where 3.10.0's migration already removed it, tiers set in the launch env that the loader's order puts
under `.variables`, an `on` typed before the guard's write test). One was a bug: `auto-compact on` typed in a
sub-folder session seeded the root's windows from the start folder's variables, which hold no tier, so the root's
next update rewrote them; the writer now reads the tiers from the mode file's own folder. A same-repository child has
no install of its own (the installer takes a sub-folder run to the git top), so its 'uninstall' is the root's.

### The cells - real sessions on the local stand-in, no model request

| Cell | Result |
|---|---|
| C1 - a second session, nothing typed, under the standing variable: its marked ask is answered by the hook | PASS |
| C3 - that answer row reads `source: hook`, never `user` | PASS |
| C2 - after `off`, the next session's marked ask waits for a person | PASS |
| C4 - the ON line in a live terminal | NOT RUN - no screen read; M1 reads the `systemMessage` from the hook output |
| C5 - the session-start line in a live terminal | NOT RUN - A4 proved the line shows; its text is unit-tested |

### Timing - `guard-answer.js` on a plain prompt, the variable on against off, 20 against 20 interleaved

| Platform | Repository | On (median) | Off (median) | Difference |
|---|---|---|---|---|
| macOS | one staged file | 39.4 ms | 39.9 ms | -0.5 ms - within 50 ms |
| macOS | a bare `git init`, no index | 47.1 ms | 39.9 ms | 7.2 ms - within 50 ms (before the fix below: 43.7 against 37.2) |
| Windows | one staged file | 110.1 ms | 108.2 ms | 1.9 ms - within 50 ms |
| Windows | a bare `git init`, no index | 172.5 ms | 100.5 ms | 72.0 ms - over 50 ms (before the fix: 73.3) |

The first Windows run read 73.3 ms: with the variable on, each prompt asked `git ls-files` whether the file is
tracked, and a git process costs about 70 ms there. The read now looks in the repository's index first
(`mode-settings.js indexMisses`): an index git can be read without (version 2 or 3, not split, not sparse, under
8 MB) that names no `settings.local.json` answers 'yours alone' with no git call, and every other shape still asks git.
The sandbox's repository was a bare `git init`, which has no index file, so the first re-run still paid the git call;
with one staged file - the shape of any project with a commit - the difference is under 2 ms. A repository with
nothing ever staged still pays it on Windows.

### The review and its fix pass

One fresh review of the whole stage passed all five focus items and found five things fixed test-first in one pass:

- `--auto-compact off` from the installer over a block that never held the key took the user's own
  `autoCompactEnabled` and windows; Claude Code's keys now move only when the block held the key.
- `/alfred-code:mode:auto-run off` whose save failed left the run going; off now ends this session's run first and
  says the file is unchanged.
- The write reset a `0600` local file to `0644`; the file keeps its permission bits.
- The banner, the ON contract and the Stop hold said auto-run lasts 'for the session'; they now say it carries into
  new sessions and name the settings file.
- The catalog said unset and `0` both compact at Claude Code's own point; `0` writes `autoCompactEnabled: false`.

After the pass the matrix, the cells and the macOS timing were run again with the results above.

### The gate and the suite

- `npm test` (macOS, Node 22.23.3): 6,304 tests, 6,300 pass, 0 fail, 4 skipped (on the tree with the index read).
- `npm run lint`: clean.
- `npm run gate -- --legs win,linux` on the five touched suites (`mode-settings`, `auto-mode`, `guard-answer`,
  `hook-prelude`, `install-modes`): Windows 283 tests, 0 failed, 30 skipped; Linux 283 tests, 0 failed, 1 skipped.

### Size

The stage adds 498 lines and nets 223 outside the tests (`measure.sh`), with 8 added lines over 160 characters - for
information: the line ceilings were dropped on 2026-11-13.

### Not run

- Every live Cursor run.
- A real compaction at the written window.
- That Claude Code applies the root file's value over a start-folder file's in a same-repository child (the settings
  documentation's sentence).
- The command bodies' no-hook branches in a live session.
- C4 and C5 above, and M17-M21 in the matrix (the suites hold them).
