# The stack's settings in settings.local.json - mode v2 stage 2 evidence

What an install and an update do with the two settings files once the stack writes `.claude/settings.local.json` at
every scope, measured on throwaway projects from this working tree before the commit.

- Date: 2026-11-13. macOS, Node 22.23.3, git 2.56.0, Claude Code 2.1.323 (not started: the matrix runs the installer
  only).
- The older install is the 3.10.0 release tree (`git archive ee3dae1c`, with its `RELEASE-SOURCE`); this tree is the
  working tree through `scripts/clean-export.js`. Each row is a temp project with its own HOME and `CLAUDE_CONFIG_DIR`,
  removed after; the real account's plugin records and `settings.json` were hashed before and after, unchanged.
- A row reads the files written - both settings files, the stamp's `managed-*` ledger lines, `.alfred/.variables` -
  never the exit code alone.

Result words: `PASS`, `FAIL`, `NOT RUN - <reason>`, `FACT` (a value read, for a page that quotes it).

## The matrix - 201 PASS, 0 FAIL, 2 NOT RUN

| Row | Case | Checks | Result |
|---|---|---|---|
| M1 | fresh install at project, user and local scope | 12 | PASS - `settings.json` absent; every row and ledger row in the local file |
| M2 | update over 3.10.0 at project, user and local scope | 24 | PASS - the move, its one report line, `attribution`, `worktree.baseRef` and the windows in the local file after this one run; local scope moves nothing |
| M3 | a re-run of each M2 update | 6 | PASS - every file under `.claude` and `.alfred/.variables` byte-identical, no move line |
| M4 | the user's own config in both files, the account's `autoCompactWindow`, a hand-added `.mcp.json` server | 7 | PASS - all untouched, a hand-changed ledgered row named |
| M5 | malformed input: the local file absent, empty, garbage, a folder, tracked; `.variables` garbage; `settings.json` garbage; `CLAUDE_CONFIG_DIR` unset | 33 | PASS |
| M6 | the move with an unusable local file (tracked, garbage, not writable), and a workspace child whose local file git tracks | 30 | PASS - nothing moved, `settings.json` byte-identical, the `!!` line names the cause; the run after the fix moves everything |
| M7 | a clone, plugin route and hooks copy route, with no local file and with one holding only `permissions.allow` | 26 | PASS - seeds, secret-file denies, seat denies and (copy route) hook rows rebuilt; `settings.json` untouched; a re-run changes nothing |
| M8 | a personal override in the local file at project scope | 4 | PASS |
| M9 | a same-repository child | - | NOT RUN - the installer places every install at the git top level, so neither 3.10.0 nor this tree installs a project below its repository root |
| M10 | hooks copy route and skills copy route, fresh and over 3.10.0, project and user scope | 32 | PASS - every hook row in the local file, none in `settings.json` |
| M11 | scope switches, local to project and project to local over 3.10.0 | 11 | PASS |
| M12 | uninstall after the move, and of a 3.10.0 install with no update between | 6 | PASS - the stack's rows leave, the user's keys stay |
| M13 | rollback: the 3.10.0 installer over a moved install | 1 | PASS, and the FACT below |
| M14 | boundaries: a ledger row at its hash and one character off, a `settings.json` left `{}`, a move of exactly one row, a 0-byte local file | 8 | PASS |
| M14 | a ledger holding only the `ALFRED_CODE_DOCS_PATH` row | - | NOT RUN - a 3.10.0 install retires the key before such a ledger can stand; the unit tests of `moveToLocal` pin the rule |

## Facts read

- M2: after the move `settings.json` reads `{}` plus a newline at project and at user scope - every row in it was
  the stack's.
- M5: with `.variables` holding garbage, the update re-seeds it (`ALFRED_CODE_INSTRUMENT`, `ALFRED_CODE_CORRECTION_NUDGE`,
  `ALFRED_CODE_TURN_CHECK`).
- M8: an `ALFRED_CODE_AUTO_COMPACT=0` override drops the per-model window rows on the first update after it is set
  (20 rows to 0) - the override is the off switch; every run after that is byte-identical.
- M13 (rollback): the 3.10.0 update over a moved install writes `env.ALFRED_CODE_DATA_PATH`, the 8 secret-file
  denies, `attribution` and `worktree` back into `settings.json`; `settings.local.json` keeps its 52 denies,
  `attribution`, `worktree` and `ALFRED_CODE_HOOKS_OFF`. The ledger then names 13 rows in `settings.json` and 57 in
  the local file. Both files apply, so nothing breaks; the next update from 3.11.0 moves the rows again.

## The review and its fix pass

One fresh review of the whole stage found two Important defects, both fixed test-first:

- A decision the move carried out of `settings.json` was dropped when `.variables` could not be written on that
  run. It now stays in the local file with its ledger row.
- A seed the stack had written in the local file (while `.variables` was ignored or unwritable) read as the
  developer's override and never moved. A row at its ledger hash whose value is a shipped seed now moves; any other
  value stays the developer's.

The matrix's own finding (M5 above): a garbage `settings.json` skipped the move, as it should, but the run's ledger
dropped the deny and hook rows naming it, so they stayed behind after the fix. The stamp now carries those rows while
the file still holds them or cannot be read; the run after the fix moves them.

## Size and suite

- Net over `scripts/install`: -175 lines (321 added, 496 deleted) against a ceiling of +60; no added line over 160
  characters.
- `npm test`: 6169 tests, 6165 pass, 0 fail, 4 skipped - three Windows-only cases (they run on the Windows CI leg)
  and one that needs a plugin absent from this account.
- `npm run lint`: clean.
