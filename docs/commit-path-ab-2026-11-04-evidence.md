# Commit-path A/B - the checkpoint's receipt writer as the reviews' result line (2026-11-04)

No `habits-commit-checkpoint` run committed in the prose A/B round (`docs/prose-ab-2026-11-04-evidence.md`, group D,
receipt-cleared 0/3 in both arms twice): the commit guard refused every receipt naming review-code and
review-security because no review's `Findings:` line reached the transcript. This round measured two fixes for it.
Audit material: read it to learn why the guard counts the receipt writer, never to run a skill.

## Method

- Claude Code 2.1.318, Sonnet 5.5 at `--effort high`, one `claude -p` per run on the subscription login, a throwaway
  account dir and project per run under `<R>` = `<os.tmpdir()>/alfred-commit-path-ab`, a `--max-budget-usd 1.5` cap on
  every call - the prose round's driver and harness (`scripts/skill-comply.js replay`), its fixtures
  `habits-commit-checkpoint` and `habits-commit-checkpoint-split` at the plain level, three runs per arm.
- **Arms.** Before = `develop` at `810669dc` (the prose round's winners landed, 2a429343's refusal text in). After =
  the same plus the hook's receipt-writer change (arm `f6523566`); the hook committed with this file is that change
  tightened after review (see 'The fix pass'). `habits-commit-checkpoint/SKILL.md` equal in both arms.
- **Owned step.** `habits-commit-checkpoint/receipt-cleared` (the receipt removed after the last commit - reached only
  by a run that commits). Every other step of both fixtures is a guard step.

## The first fix, measured in the smoke and dropped

The guard counted one `Findings:` line per reply, so one reply carrying both reports closed one review. Fix 1 counted
every line, the refusal said 'one `Findings:` line per review', and the checkpoint's Step 2 told the model to print
each review's report before the next skill loads. Smoke, one run per arm and fixture: no commit in any of the four
(refusals 2, 3, 4, 4). The after arm's refusal reached the model with the new wording and it still printed no line -
it loaded both reviews again and committed again. The reports stay in thinking: 20 of 25 thinking blocks of one run
are stored empty, and the one stored with text reads 'I'm reprinting both reports and then retrying the commit'. No
wording reaches a line the model believes it already printed. Every run, though, called the receipt writer
(`node "$R" commit ... --findings '<field>'`) after the reviews.

## The fix measured

The guard counts that call as the reviews' result line: a main-session Bash or PowerShell call running
`node <receipt.js> commit` with a `--findings` value, not a `--dry-run` and not refused, closes every review still open
before it whose line is `Findings:` (never a loop's `Outcome:`). The refusal names the route. Fix 1 went back whole -
its skill text to `810669dc` (measured not to help, and its stated reason would be false), its count of every line
after review (below).

| Fixture - step | Before | After | Verdict |
|---|---|---|---|
| habits-commit-checkpoint - receipt-cleared (owned) | 0/3 | 3/3 | better |
| every other checkpoint step (9) and split step (3) | 3/3 | 3/3 | same |

Commits per run, read from each transcript:

| Arm | Runs that committed | Refused commits | Refusals on the review proof |
|---|---|---|---|
| Before | 0 of 6 | 18 | 18 |
| After | 6 of 6 (the split fixture's two commits each) | 2 | 0 - both the preferences-read gate, by design |

## The fix pass

A fresh review of the change found the measured matcher too loose, and it was tightened before the commit:

- **One result line per text block again.** Counting every line let one report close two reviews: its
  `**Findings:**` header and its closing `Findings:` line. No measured committing run printed a `Findings:` line
  before its commit, so the count carried no result.
- **The writer itself, and its success line.** The script is `receipt.js` by its path, or a variable the same command
  set to that path. An echo, `cat receipt.js; node build.js commit` and an unset variable no longer count. The result
  must carry the writer's `wrote ...COMMIT-GATE` line, because `; echo rc=$?` makes a refused writer's call read as no
  error. Node flags, `node.exe` and a continued line are allowed.
- **No seat still running.** A seat sent after a review must have reported before the receipt call.
- **The refusal.** It asks for each report in a reply of its own. It offers the writer in its own call, with its
  output shown, and says to commit in the next call. A loop is asked for its `Outcome:` line.

The fix pass was checked on the round's own transcripts, free:

- The tightened matcher counts every `receipt.js commit` call of all six after-arm runs, and each one's result
  carries its `wrote` line. The one call it skips is a before-arm run's, after three refusals: it hid the output with
  `>/dev/null; echo rc=$?`. No after-arm run sent a seat.
- The six after-arm transcripts were cut just before each of their 11 commit calls and judged by both the measured
  arm's hook and the committed one. Each run used a scratch repo and the test file's receipt helpers. Both hooks
  passed the review-proof check at all 11 cuts, and every cut stopped at the same later check, on the scratch repo's
  paths.
- The paid re-run was skipped: the committed hook gives the measured runs the same verdicts.

## Spend

| Phase | Runs | Spent |
|---|---|---|
| Smoke, fix 1 (both arms) | 4 | $1.53 |
| Smoke, the receipt writer (after arm; the before arm's runs reused, same key) | 2 | $0.47 |
| Reps | 8 | $2.41 |
| Round | 14 | $4.41, under the $10 stop |

## Reading

- CP ships: the owned step went 0/3 to 3/3 and no step got worse.
- What the rule still catches: a review loaded after the receipt was written, a receipt the writer refused or whose
  output was hidden, a receipt written while a seat the review sent was still running, and a receipt written by hand
  with no writer call; what it no longer catches is a review the model abandoned before
  running the writer - the speed bump moves from a printed line to the writer's call. The model can write either
  without the review; the rule was never a wall against a forged result.
- Not measured: the adverse level, an interactive session (the reports may print there), and a receipt written in the
  same shell call as the commit (the guard runs before that call writes anything or reaches the transcript, so the
  commit is judged on the receipt already on disk, as before).
