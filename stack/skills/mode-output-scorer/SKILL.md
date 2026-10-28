---
name: mode-output-scorer
description: "Use when a 'scorer: on' or 'scorer: stacked' line is in context and a plan, verdict or answer is drafted - grade it with a fresh seat before releasing it."
---

# Output scorer - grade before release

A drafted output is graded by a fresh, read-only output-scorer seat that never saw the conversation, against the rubric of its kind, and released only when `scripts/scorecard.js` says it passed. The script does every sum, every verdict and every next move; the model writes the draft and TASK, dispatches the grader and does what the script prints. The level is a target, not a wall: when the draft cannot reach it, the user decides.

## When to use

- The scorer grades what a producer made and never stands in for one: a request to write, draft or produce a plan loads the plan-writing skill first, and its plan file is graded as `designer-plan`; `inline-plan` is only the execution strategy's plan for work this session builds now.
- A `scorer: on (level <n>, rounds <r>, ...)` line is in context and a producer is about to release an output it names - a designer plan file, a root-cause verdict, an inline plan.
- A `scorer: stacked for this request (...)` line is in context: whatever this request releases is graded, under its own rubric, or as `custom` when no producer ran.
- No such line in context: do nothing; the producer releases as today.
- The switch: `--mode-output-scorer-on` / `--mode-output-scorer-off` right after a task-, capture-, loop-, issue- or mode- command turns the scorer on or off for the session. Typed with only mode flags (`/mode-output-scorer --mode-output-scorer-on`), this skill grades nothing: say in one line what the flag switched, and stop.
- Each producer carries the line that brings it here, in one of two shapes:
  - automatic outputs: 'Where a `scorer: on` line naming <output> or a `scorer: stacked` line is in context, the FIRST action before releasing <output> is the `mode-output-scorer` Skill call with output `<name>`.'
  - typed-only outputs: 'Where a `scorer: stacked` line is in context, the FIRST action before releasing <output> is the `mode-output-scorer` Skill call with output `<name>`.'
- Not for a code diff - the review skills own those - and never inside a seat: the session that receives a seat's report grades what it writes or acts on.

## The loop

The script, resolved from this skill's own folder (Node.js built-ins only; run from the project):

```bash
S="${CLAUDE_SKILL_DIR}/scripts/scorecard.js"
[ -f "$S" ] || S=.claude/skills/mode-output-scorer/scripts/scorecard.js
node "$S" start --root "${CLAUDE_PROJECT_DIR}" --session "${CLAUDE_SESSION_ID}" --slug <slug> --output <output>
```

Every later call passes the same `--root`, `--session` and `--slug`.

1. The output must be an automatic output a producer marked this cycle, or the cycle carries a `scorer: stacked` line. An ordinary reply is never graded and gets no line. Pick the output by what the request asked for before `start`; a `kind:` line that does not fit the request means a new slug under the right output.
2. `start`: `<slug>` from the output's subject, lower-case `[a-z0-9-]`, at most 40 characters, one slug per output. `--output` is the producer line's name. For `designer-plan` add `--target <docs-path>/work/plans/<feature>.md`, the path the plan will be written to; for `inline-plan` add `--target` the plan file the draft names, when it names one. It prints `id:`, `draft:`, `score-file:`, `task:`, `inputs:`, `rubric:`, `attempt:` and `round:` (and `kind:` for `inline-plan`), and on the slug's first start writes `inputs.md`, the docs the grader is handed.
3. Write TASK to the printed `task:` path before the first dispatch: the user's request and hard constraints verbatim (typos kept) and their answers to any question, never the author's reasoning, the alternatives weighed or a self-assessment. For a typed stack TASK is the text after the stacked skills, plus any constraint the user stated earlier for this request.
4. Write the draft with the Write tool to the printed `draft:` path - round 0 the original, each later round the revision.
5. Dispatch ONE new output-scorer seat per grade, exactly as the roster spells it (`alfred-code:output-scorer` on the plugin route) - never a fork, never resumed, never told an earlier score, a finding or that this is a revision. The brief names the `task.md` path, the `inputs.md` path, the rubric path, the draft path, the seat's return format, and as its last line `score-file: <the printed score-file path>`. The hand-back hook writes the score file with its seal; never write or edit one. The seat runs in the background: the turn that dispatches it ends with the one line `Scoring <output> - the grader is running` and releases nothing; the loop resumes at the completion notification, and a message the user types meanwhile is answered without releasing the output.
6. `node "$S" grade <score file> --output <output> --level <n>`, the level from the injected line. Exit 2 (malformed) or 3 (no seal, or a broken one) is a failed grade: the Fallback's retry.
7. `node "$S" next --root ... --session ... --slug <slug> --level <n> --rounds <r>`, plus `--auto` when auto-run is on (the `scorer: on` line names auto-run, or an `auto-run: on` line is in context), and do exactly what its first line says:
   - `release <id>` - the pass below;
   - `revise` - step 8, then `start` again (a new round), step 4 and step 5; a `From:` line under it names an earlier, higher-scoring draft and its findings - the revision starts from that draft and those findings, never the lower last one;
   - `offer-fix <id> recommend <choice>` - Fix on a pass below; nothing is released yet;
   - `fix <id>` - step 8 over the findings its `Fixable:` line names, then `start` (a new round), step 4 and step 5;
   - `ask-continue <id> recommend <choice>` or `withhold-final <id> recommend <choice>` - Release and withhold below;
   - `final <id>` - the output stays withheld; say so with the lines it printed;
   - `incomplete <id>` - the Fallback's retry.
8. Revise: fix every BLOCKER, then every MATERIAL, a MINOR only when trivial; each finding gets one disposition - fixed, rejected with the evidence, or needs-human. Never delete substance to dodge a check, never add an empty section to satisfy one, never edit a rubric during a run. In a designer plan, a fix that would add behaviour `Asked:` does not name - a new guard, rule or card - is a Decision that keeps today's behaviour plus one `## Optional` line for the change, marked Recommended; never card work, which fails P11 in the next grade.
9. Nothing of a grade's table goes into the reply; the files hold it. Never state a total or a verdict the script did not print.

The files, under `<data root>/state/sessions/scorer/<session id>/<slug>/`: `task.md`, `inputs.md`, `<id>.draft.md` and `<id>.score.md` per grade, `rounds.log` (written by the script) and `answers.md`. A folder is swept 7 days after its newest file, so a withheld draft keeps that long.

## Outputs

The outputs, their producers, rubrics, runs and docs are the table in `references/outputs.md`. Each output runs up to the `rounds` of the injected line per attempt, `inline-plan` once; every grade counts as a run, a retry included. The rubric files sit beside it in `references/`; the seat reads them, the script reads their json block.

## Typed stack

- The form: `/<producer> /mode-output-scorer <request>` at the start of a message, the producer first (a slash-only producer cannot be loaded later; this skill can) - `/habits-explain-topic /mode-output-scorer explain closures like for a 6-year-old`. `/mode-output-scorer <request>` alone works too, and so does the bare name right after 'using', 'with', 'via', 'run', 'stack' or 'through'; the bare name in other prose ('why did it not run?') is talk about the tool.
- What is graded: every output the stacked producer releases in this request, under its own rubric, listed or not; with no producer stacked, the output of the producer skill that loads in the request; with none, the reply as `custom`.
- A stack naming `habits-adjust-agents-md` grades nothing: say so in one line.

## Release and withhold

- `release`: the output goes where it goes today - the plan file to its path, the verdict into the findings file and the reply, the plan or the answer into the reply - followed by the `Scored:` line `next` printed and, when it printed one, the `Open:` line. After a fix, what goes out is the draft at the path its `Fix:` line names, and that line follows the others. A SELF grade's pass adds 'independent review recommended before acting on it'.
- `ask-continue` / `withhold-final`: nothing is released or acted on - the plan file is not written to its real path, the work does not start, a flow does not route on the report, a pick's or an upgrade's ask is not put. The reply holds the `Scored: ... NOT PASSED ...` line `next` printed, then ONE AskUserQuestion call of at most 4 questions (plain-text options where the harness lacks the tool): the continue question first, then the open BLOCKERs, then the MATERIALs in rank order, one question each. Findings past the fourth are listed in the reply one line each with their fix, and go into `answers.md` as `recommended fix applied` unless the user's Other text says otherwise.

The continue question, its numbers from `next`'s `Ceiling:` and `Findings:` lines:

```ask
The <output> scored <S>/100 (level <n>); the next revision can reach at most <ceiling> - <the needs line, or nothing closable left>. How should it go on?
- 'Answer the open decisions (Recommended)' - your answers join the task and one more attempt runs
- 'Accept it at <S>, marked' - it goes out now, its score and open findings named
- 'Revise once more' - one more revision and grade, about one seat run
- 'Keep it withheld' - the best draft stays where it is
```

- The option `next`'s `recommend` word names is the one marked `(Recommended)` and listed first; never pick it yourself.
- 'Answer the open decisions' is left out in attempt 2 and under auto-run. On `withhold-final` the one question offers 'Accept it at <S>, marked' and 'Keep it withheld' only.
- Under auto-run (pass `--auto` to `next`) the call carries the continue question alone, with the `Findings:` line's count in place of the needs text: a finding's free text can carry a word that sends the whole ask to a person. On 'Revise once more' the revision applies each finding's recommended fix.

Each finding question, BLOCKERs first, at most three:

```ask
<the finding, as the decision it needs>?
- '<the fix the finding names> (Recommended)' - <why, from the finding's cost>
- '<the other way>' - <what it costs>
```

Record the continue answer with `decide --choice <accept|revise|answer|keep>` - `node "$S" decide --choice <choice> --root ... --session ... --slug <slug>` - then run `next` again:

- `accept` - `next` prints the release, marked `accepted below the level`;
- `revise` - one bought run; `next` prints `revise`, and the ask comes back after it;
- `answer` - write the answers to `answers.md`; the next `start` joins them to TASK and opens attempt 2, a full run of its own; there is no attempt 3;
- `keep` - the best draft stays withheld at the path `next` printed.

## Fix on a pass

`offer-fix` comes on a pass under the level plus 15 that holds a MATERIAL finding one revision can close; a pass of 95 or over at the defaults, or one with nothing closable, is released at once. Nothing is released while it is asked: the reply holds the `Scored: ... fix offered ...` and `Open:` lines `next` printed, then ONE AskUserQuestion call (plain-text options where the harness lacks the tool):

```ask
The <output> passed at <S>/100 (level <n>) with <k> MATERIAL finding(s) one revision can close - <the Fixable line>. Fix them before it goes out?
- 'Fix them first (Recommended)' - one revision and one more grade; the revision goes out only if it still passes with fewer MATERIAL findings, else this draft does
- 'Use it as it is' - it goes out now at <S>, the findings named on its Open line
```

- On `recommend release` (no run left under the cap) 'Use it as it is' carries the mark and comes first, and 'Fix them first' says it buys one run past the cap.
- Record the answer with `decide --choice <fix|release>`, then run `next` again: `fix` prints `fix <id>` (step 7), `release` the release.
- Under auto-run no ask is put: `next` takes its own recommendation and prints `fix <id>` or the release.

## Fallback

- `start` exits 4 (no session id, or `${CLAUDE_SESSION_ID}` reached you unsubstituted): rerun it with `--session self`, which prints `session: self-<hex>` - pass that id to every later call - and grade with `--self`.
- No dispatch is available (no subagents, the seat not installed or denied), or a typed stack ran with no injected line: grade in a separate step that reads only TASK, the docs `inputs.md` lists, the rubric and the draft, looking for the reason to answer no before yes. Write the score file yourself in the seat's return format, its first line `self: <why no seat graded it>` in place of the seal, and run `grade --self`. The total stops at 99, and the `Scored:` line says `SELF`.
- `incomplete <id>`, or a `grade` exit 2 or 3: `start --retry-of <id>` and one re-dispatch; a second failure goes to the self grade above.

## Signs it was skipped

- A plan file written, a verdict stamped or an answer sent while the line was in context, with no `Scored:` line.
- A score file the author wrote with no `self:` line, or a total in the reply the script did not print.
- A revise after `next` printed an ask, or an option marked `(Recommended)` that `next` did not name.
- A plan file written or an output sent between an `offer-fix` and its `decide`.
