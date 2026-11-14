# Commit guard review proof - evidence (2026-11-13)

What a receipt write proves about a review: the file-time proof (D3), the kinds a receipt speaks for (D2), and the
runs that hold them. Counts only - nothing read from a real transcript is kept here.

## D1 - the vendor page

The vendor documents why a review's text is missing from the transcript's thinking blocks. The Claude API thinking
page (<https://platform.claude.com/docs/en/build-with-claude/thinking>, read 2026-11-13):

> On Claude 5 and later models and Claude Mythos Preview, thinking is already on and needs no configuration.
> `display` defaults to `"omitted"` on these models, so the thinking text is hidden until you opt in.

> `"omitted"`: thinking blocks are returned with an empty `thinking` field. The `signature` field still carries the
> encrypted full thinking for multi-turn continuity.

The Claude Code sessions page (<https://code.claude.com/docs/en/sessions>, read 2026-11-13) says the transcript is JSONL
and 'The entry format is internal to Claude Code and changes between versions'; it says nothing of how thinking is
stored. So a thinking block in the transcript is empty by the API's default on these models, and a review's six-field
block is in the transcript only when the model wrote it as a text block.

The design does not depend on the cause (D1); nothing waits on this.

## Corpus counts

Re-measured 2026-11-13 by the replay script over the 200 newest local session transcripts under 80MB, main session
rows only. Regex classifiers: read the numbers as sizes, not exact counts (the design's own table was taken the same
morning; a session or two newer moves a count by one).

| What | Count |
|---|---|
| Assistant rows / text blocks | 69,578 / 9,381 |
| Thinking blocks stored with empty text / with text | 21,019 (84%) / 4,014 |
| Sessions with a review skill call (verify-code, review-code, review-security) | 80 |
| ... holding a `Findings:` line in assistant text after it | 19 |
| `receipt.js commit` calls with `--findings`, no `--dry-run` | 118 |
| ... piped through `tail` / `head` / `grep` / `sed` / `cat` | 28 |
| ... output sent to `/dev/null` | 8 |
| ... whose result holds no `wrote ...COMMIT-GATE` line | 22 |
| ... whose `--verified` value names one review / two / none | 82 / 3 / 33 |
| ... carrying `--security` | 62 |
| ... whose call row and result row both carry a `timestamp` | 118 |

## Replay

Old: the guard at 704d7532 (the tests-only commit, so the hooks before the change). New: the working tree with the
change. Method, in four lines:

1. Each guard runs as a debug copy that writes its `transcriptScan()` result when the process exits.
2. A cut is a corpus transcript truncated just before a `git commit` call that follows a receipt call - one per such
   commit call; both copies get the same cut, payload and scratch repo.
3. The scratch receipt's mtime is the last receipt call row's own time when that call's result holds no `wrote` line,
   no error and no `receipt:` refusal (a (b) candidate), else a day before the cut's first row. No row time is shifted.
4. The fields are compared per cut as multisets against the pass criteria of the design's Proof section.

First, the replay was shown able to fail: 20 transcripts against a new copy whose `speaksFor` returns an empty set
gave `closed` 35, `coverage (code)` 113, `coverage (security)` 5, `newly-counted` 8, exit 1.

| Count | Value |
|---|---|
| Transcripts read / cuts | 200 / 108 |
| Cuts identical | 45 |
| Cuts differing only by plan reviews left open | 55 |
| Cuts differing only by a write now counted through its file time | 8 |
| Cuts differing any other way | 0 |
| (b) candidates (hidden-output calls modelled as written) / of them newly counted / held by a seat | 14 / 8 / 0 |
| Copies that wrote no scan (`unread`) | 0 |
| FAIL `consent` / `coverage (code)` / `coverage (security)` / `closed` / `newly-counted` / `hint` | 0 / 0 / 0 / 0 / 0 / 0 |

The 55 counts cuts, not reviews: a plan review left open is in every later cut of its session. Its limit: a written
receipt with hidden output and a refused writer whose refusal was also hidden read the same in a transcript; the
replay models all 14 as written.

## Timing probe

One data point, Claude Code 2.1.322 on macOS: a shell call slept 1s, wrote a file, slept 1s. The file's mtime was
1,267 ms after the call row's `timestamp` and 1,069 ms before the result row's - the call row is stamped before the
command starts and the result row after it ends.

- Linux (2026-11-14, Claude Code 2.1.325 in a `node:22` container, the same sleep / write / sleep call): the file's
  mtime was 1,061 ms after the call row's `timestamp` and 1,016 ms before the result row's - 0 ms outside either end,
  inside today's 2s slack, so nothing changes on Linux.
- Windows (2026-11-14, Claude Code 2.1.325 on a Windows 11 VM, Git Bash as the shell, the same call): the file's mtime
  was 10,482 ms after the call row's `timestamp` and 1,362 ms before the result row's - 0 ms outside either end, inside
  today's 2s slack, so nothing changes on Windows. The wide front gap is the shell's start on Windows, inside the window.

The rule for the owner's probe on those systems (the design's Assumptions): measure how far the file's time lies
before the call row's time or after the result row's. Within 2s: inside today's slack, nothing changes. More than 2s
and up to 4s: that end's slack, on that system only, becomes the distance rounded up to a whole second plus 1s - so 4s
or 5s. More than 4s: the file-time proof is dropped on that system and the `wrote` line decides there - the stricter
side, so nothing unreviewed passes either way.

## Temp-project matrix

Run from this working tree's clean export (`--source <export>`) and the 3.11.0 tree (`git archive ea2ac679`), in
throwaway sandboxes with HOME, CLAUDE_CONFIG_DIR and the global git config inside each, the API keys unset; the
selection carries the commit checkpoint, so the project's own installed `receipt.js` writes every receipt, through
a real shell. Command: `node matrix.js <repo> <scratch>` (a scratch harness, not committed). Result: 58 PASS, 0 FAIL,
0 NOT RUN.

- M1 (fresh install, project scope, the plugin route and the copy route): the export's guard and the copied guard
  hash to this tree's; the installed writer is in place; the control write (no pipe) prints its `wrote` line and
  passes; the `| tail -n 3` write leaves the receipt with its time inside the call's window and a stdout with no
  `wrote` line, and passes; the refused leg (no row times) is refused naming review-code, so the guard is live in
  both routes.
- M2 (3.11.0 on the copy route, then update from this tree): before the update the copied 3.11.0 guard refuses the
  piped write naming review-code; the update delivers this tree's guard and leaves the receipt untouched; the SAME
  receipt and transcript then pass. On the plugin route, in a project installed on it, the 3.11.0 export refuses the
  state and this export passes it.
- M3 (M1's projects, the install run again): the file listing with hashes is identical, both routes.
- M4 (a hand-added hook entry and settings key in `.claude/settings.json`, a hand-added server in `.mcp.json`): all
  three unchanged after the install and after the re-run.
- M5 (no `transcript_path`; a garbage transcript - not JSON, a torn row, a JSON array; the piped rows with no
  `timestamp`; the piped rows with the receipt removed): this tree's guard and 3.11.0's give the same exit code and
  the same first refusal line, neither exits 1 nor prints a stack trace, both routes.
- M6 (fresh installs at project, user and local scope): the control, the piped write and the refused leg as in M1,
  in each scope.
- M7 (the receipt stamped to a whole second M): through the installed guard, 0, 2, 0 at the call end (M + 2000,
  + 2001, + 1999) and 0, 2, 0 at the result end (M - 2000, - 2001, - 1999), both routes.
- The real account's plugin records, settings and git config hash the same before and after.

Two harness defects were fixed before this run, neither in the guard: the refused leg re-stamped the receipt in the
same millisecond its transcript was created (read as written before the session - stamped 2s ahead now), and the
3.11.0 plugin-route check ran in a copy-route project, where the plugin's guard yields to the copied one (it has its
own plugin-route install now).

## Windows leg

`npm run gate -- --legs win --tests scripts/guard-commit-gate.test.js,scripts/commit-receipt.test.js --ref <sha>`, a
Windows 11 VM on Node 22 as `ci.yml` pins, found stopped and stopped again after each run.

- RED, 704d7532: 123 tests, 6 failed (tests 113, 114, 116, 118, 122 and 123) - the 'review proof 3.12' tests the
  guard change answers, the same six as on macOS.
- GREEN, 17df86fa: one failure, 'a receipt write whose output a pipe cut or hid' at 'A12 flow/ only'. The A12 repos
  were made after five commits, about 6 s on Windows, so their `a.txt` was newer than the receipt the test stamps 2 s
  ahead of its start, and the gate read the receipt as stale. The guard was right; the test was timing-dependent.
- 3d8fffb1 makes both A12 repos and their transcripts before any commit. Rerun on it: 123 tests, 0 failed, 0
  skipped (node v22.23.3, 14m16s).

## Commits

- 704d7532 - the tests alone, red by design (6 of the 11 'review proof 3.12' tests): the Windows leg's red ref.
- 17df86fa - the guard change (`stack/hooks/guard-ungated-commit.js` alone), committed after the matrix ran green.
- 3d8fffb1 - the A12 test setup moved before the commits, so the Windows leg reads it the same as macOS; this file.
- d6f743f9 - the rule in `repo-hooks.md` and the after-3.11.0 note in `update-history.md`.
- The docs commit that fills the Windows leg above.

Rollback: revert the guard commit listed here; nothing stored changes shape, so no receipt, ledger or transcript
needs a fix. `guard-ungated-commit` in `ALFRED_CODE_HOOKS_OFF` is the last resort, since it switches off the whole
commit and push gate.
