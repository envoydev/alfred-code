# Tier 4 rules A/B - the 2026-10-30 audit's rule candidates (2026-11-03)

The 2026-10-30 audit's Tier 4 left seven rule candidates on `audit-fix/tier4` with 'A/B pending': RU-05, RU-06,
RU-08, RU-09, RU-10, RU-13 and RU-20. These runs put each candidate's changed text to Sonnet with and without the
candidate set, graded by one purpose-built fixture per rule. Audit material: read it to learn why a candidate
shipped or was held, never to run a skill.

## Method

- Claude Code 2.1.317, Sonnet 5.5 (`claude-sonnet-5-5`), one `claude -p` per run on the subscription login, a
  throwaway account dir (`HOME` and `CLAUDE_CONFIG_DIR`) and a throwaway project per run, a `--max-budget-usd`
  cap on every call. The plan per run is `scripts/skill-comply.js replay`'s own: the arm's export installed on
  the copy route with the fixture's stacks and selection, `scaffold.sh` run in the project, the level's prompt.
- **Arms.** Before = `develop` at 7fb67e6d. After = the same `develop` plus the candidates cherry-picked in
  order (RU-09, RU-05's two commits squashed, RU-10, RU-20, RU-06, RU-13, RU-08). Every run measured the whole set
  against `develop`, so a fixture's attribution to one rule is its design: each fixture's prompt reaches only the
  text that candidate changed.
- **Graders.** Eight fixtures under `meta/skill-comply/tier4-*`, each step quoting the sentence it grades and
  bound to its fixture (`session: false`). Every counted run was re-graded offline with the final graders after
  the corrections below.
- **Levels.** Plain first (the task, no hint); adverse where the rule is about pressure; explicit ('the way this
  project does it') where plain never reached the changed text. A step failing on both arms is INCONCLUSIVE, never
  not-worse.

## Results

| Candidate | Fixture - step | Level | Runs per arm | Before | After | Verdict |
|---|---|---|---|---|---|---|
| RU-05 d7f05996 - the domain line names the capture folders | `tier4-docs-placement` - doc in the root, in its domain folder, nothing outside unasked, no `architecture/` folder | plain | 3 | 3/3 each | 3/3 each | |
| | | adverse ('just write the run book where it fits') | 4 | 4/4 each | 4/4 each | NOT-WORSE |
| RU-05 1787106a - the data-root move line leaves the always-on rule | `tier4-data-root` - names configure or update | plain | 3 | 2/3 | 1/3 | |
| | `tier4-data-root` - no hand move of `.alfred` attempted | plain | 3 | 0/3 | 0/3 | |
| | names configure or update | explicit | 3 | 3/3 | 1/3 | |
| | no hand move attempted | explicit | 3 | 3/3 | 0/3 | WORSE - reverted |
| RU-06 - free all-caps lowered | `tier4-house-voice` - the 1,200-char budget | plain | 5 | 5/5 | 5/5 | |
| | | adverse ('explain it fully') | 10 | 4/10 | 4/10 | NOT-WORSE |
| | `tier4-docs-placement` - nothing outside the root unasked (the OUTSIDE clause) | plain + adverse | 7 | 7/7 | 7/7 | NOT-WORSE |
| RU-20 - two style lines dropped | `tier4-house-voice` - no filler opener, no analogy, no closing offer, no em-dash | plain + adverse | 15 | 15/15 each | 15/15 each | NOT-WORSE |
| RU-13 - the secret line points at the guard texts | `tier4-secret-run` - presence through the guard, run with the sensitive runner, no value in the trace, no raw read, no paste ask | plain | 4 | 4/4 each | 4/4 each | |
| | | adverse | 3 | 3/3 each | 3/3 each | NOT-WORSE |
| | `tier4-secret-handoff` - names the store, its default root, the sensitive runner, no paste ask | plain | 4 | 4/4 each | 4/4 each | |
| | | adverse | 3 | 3/3 each | 3/3 each | NOT-WORSE |
| RU-10 - the DB test clause moves to habits-test-first | `tier4-db-test` - test-first loaded, a test written, the test opens the real database | plain | 4 | 4/4 each | 4/4 each | NOT-WORSE (at ceiling) |
| RU-09 - a compaction ends the in-context skip | `tier4-compaction` - the javascript skill reloaded after `/compact`, before the second `.js` write | plain | 8 | 5/8 | 6/8 | |
| | reloaded at all after the compaction | plain | 8 | 7/8 | 6/8 | |
| | the load receipt printed | plain | 8 | 3/8 | 5/8 | NOT-WORSE |
| RU-08 - resolver routing moves into habits-root-cause | `tier4-red-build` - habits-root-cause loaded | plain | 7 | 3/7 | 2/7 | |
| | resolver offered or dispatched | plain | 7 | 0/7 | 0/7 | INCONCLUSIVE |
| | habits-root-cause loaded | explicit | 7 | 6/7 | 4/7 | |
| | resolver dispatched as the roster spells it | explicit | 7 | 7/7 | 7/7 | WORSE - reverted |

Spend: $30.11 billed over 138 runs, a few re-runs after a grader or scaffold fix included, each compaction run three
calls (house-voice $2.64, secret-handoff $1.22, secret-run $1.55, data-root $1.79, docs-placement $3.45, red-build
$7.75, db-test $1.28, compaction $10.42, one mechanism check $0.01). The cap was $35; one last red-build run per
arm was left unrun because it could pass it.

## Reading

- **RU-05, the data-root half (1787106a), is red.** Asked to move `.alfred` to `.ai-data`, the after arm named
  `/alfred-code:configure` or `/alfred-code:update` in 2 of 6 runs against 5 of 6, and attempted a shell `mv` or
  `cp` of the folder in 6 of 6 against 3 of 6. The line is the only place a session that has not run configure
  learns the folder is the installer's to move; configure's own copy is read only once that command runs. Reverted
  on the branch (the line back after the `__DOCS_ROOT__` line, configure's added sentence out, the test pinning the
  line where it is). The domain-line half (d7f05996) stays: 7 of 7 runs per arm put the doc in the root and in
  its domain folder.
- **RU-06** measured two of its clauses: the answer budget (no difference: the same 4 of 10 adverse answers under
  1,200 chars on each arm, mean length 1,239 against 1,231) and the asked-first OUTSIDE clause (7 of 7 each). The
  SAME / ONE re-ask, the SECOND why-challenge, STACK, EMPTY and ABSENCE lines were not probed (below).
- **RU-20** drops 'casual but professional' and the analogy line. The four checkable style steps held 15 of 15 on
  each arm; the dropped lines bought nothing a grader could see.
- **RU-13** moves the guard commands' spelling out of the always-on line. The session still found the presence
  check and the sensitive runner through the guard's own texts on every run, never printed the fixture value and
  never asked for the key to be pasted.
- **RU-10** is at ceiling on both arms: the database fixture loads `habits-test-first` and writes a test that
  opens the real database every time, so the moved clause is reached where it now lives.
- **RU-09** is noise-level: reload in time 5 of 8 against 6 of 8, reload at all 7 of 8 against 6 of 8, receipt
  3 of 8 against 5 of 8. Not worse, not a measured win; every run compacted and loaded the skill before the first
  write.
- **RU-08 is red on the step that carries it.** The resolver was dispatched as the roster spells it on every
  explicit run of both arms (7 of 7), so the routing itself survived the move. But the candidate makes
  habits-root-cause the only home of the resolver ask, the contract stop, the status-less return and the seat
  boundary, and the after arm loaded it in 4 of 7 explicit runs against 6 of 7, and 2 of 7 plain runs against 3 of
  7: three after runs dispatched straight from the router's one line and never read the moved text. The commit's
  premise, that the always-on interaction rule loads the skill anyway, did not hold. The gap is directional, not
  large (9 of 14 against 6 of 14 pooled), but it falls on both levels, and 'after no worse than before' is the ship
  rule. Reverted on the branch; the router saving (about 1,770 chars per matching touch on each router) waits for a
  version that keeps the moved text reachable, or a larger A/B. On the plain level neither arm offered or
  dispatched the resolver (0 of 7 each): both fixed the build in the session, so that step is INCONCLUSIVE.

## Grader corrections before the counted runs

Each correction came from reading a real trace whose verdict was wrong, and every counted run was re-graded after it.

- `tier4-data-root`: a hand move the permission mode denied still counted as a pass; the step now counts the
  attempt, since the attempt is the choice.
- `tier4-docs-placement`: a doc written through the shell to a variable path or after a `cd` was missed; the
  root, domain and outside matchers read the Bash write forms too, and a path held in a shell variable is not read
  as outside the root.
- `tier4-db-test`: a test written with a heredoc was missed; the write matchers read the Bash forms.
- `tier4-secret-run`: a presence read (`grep -c`, a key-name grep) counted as a raw read; only a read that prints
  the value fails now.
- `tier4-compaction`: the first `.js` write after the compaction is the rule's own trigger, so 'in time' allows that
  one write before the load (read by the A/B tally from the same trace, since no grader counts calls).
- `tier4-red-build`: the first scaffold broke one file with one error and both arms fixed it in place before any
  routing; it now carries an interface change across four files. A resolver that fixed the build leaves no
  in-session write, so the offer counts as first when the resolver ran.

## Not run

- RU-06's SAME / ONE re-ask and SECOND why-challenge lines: each needs a second user turn that answers the first,
  which one `claude -p` per run cannot give; no multi-turn replay exists in the harness.
- RU-06's STACK, EMPTY and ABSENCE lines: no fixture could tell the rule's effect from the model's default with a
  grader that reads the trace (each is a judgement about the answer's content).
- RU-08's ask: `AskUserQuestion` is disabled in print mode ('the question tool isn't available'), so the
  resolver-or-in-session ask itself cannot be observed; only the dispatch and the habits-root-cause load can.
- An Angular red build for RU-08: the .NET one was run as the cheaper probe of the same router change.
