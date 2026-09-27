---
name: alfred-task-verify-code
description: "Use to review an assembled build in this chat without dispatching agents: reruns build + tests, checks the code against its plan, runs the app on failing inputs, traces changed contracts, returns a ranked punch-list. Triggers on review the build, check the code, review before done. Not the plan audit (alfred-task-verify-plan)."
---

# Verify Code - review the assembled code in one chat, no dispatch

The review step, run inline. `alfred-task-design` planned it, `alfred-task-verify-plan` audited the plan, `alfred-task-implement` built it - this reviews the built code against that plan and the stack's real traps, and it does the whole review in your context: it dispatches nothing. It is the single-chat form of the `<stack>-verifier` seat and the deliberate alternative to `/code-review`, which always fans out to subagents. Same review protocol as the seat; you just keep it here.

## The choice this skill is, and when not

The flow's two house reviewers: this skill (inline - predictable cost, no agents, but its reads land in THIS chat's context) or the `<stack>-verifier` seat (the same protocol dispatched, its reads kept out of your chat). `/code-review` is the CLI's own parallel sweep - available, never a flow default (`references/reviewer-choice.md` weighs the three). Not the plan audit (`alfred-task-verify-plan`, before the build) and not the fixer: it flags and hands back; a verifier authors nothing.

## The review - in order, all inline

Load the stack's house skill FIRST, so you check against ITS trap list. Dispatch nothing. `references/review-in-full.md` carries every step unabridged.

1. **Build + tests, rerun and quoted** this session - never a pasted or prior-run result.
2. **Plan conformance.** Every task present, nothing outside a task's boundary, each `## Decisions` entry honored, each task's `log_points` placed through the repo's logging seam (level and identifiers as the card says, nothing beyond them), each acceptance criterion DEMONSTRATED by a run this session (`alfred-habits-done-gate`).
3. **Stack-trap audit** - the diff against the loaded skills' trap lists; a named trap the code hits is a finding.
4. **Run it, and check nothing existing broke.** Probe the new failable inputs (a malformed query param, a bad route value) through the app, with at least one REAL end-to-end call through the production composition root - test hosts wire their own. For a web API an in-process run through the real `Program` IS that call: a `WebApplicationFactory<Program>` test (the suite's, or a scratch one) that sends those inputs - quote it as the probe, unless it swaps out a service the diff touches. Otherwise ONE boot attempt: an environment that refuses it (a blocked background process, port, `ps`/`kill`, egress) is `Live-probe: NOT RUN - environment: <what refused>` - no second launch form, no Monitor retry. Never write to a database or service this run did not start. Read `references/live-probe.md` before the first probe run. A failure path the probe trips leaves its planned log line, or that is a finding. Audit REMOVED behavior through the changed symbols' callers, and check each new test can FAIL - an assertion that holds regardless is a finding.
5. **Wire-contract cross-consumer trace** - a changed public or wire contract traced to its consumers, siblings in `.claude/rules/baseline-project-related-context.md` included (a standalone repo has none - the trace then stays in-repo); a consumer still expecting the old shape is a break.
6. **Reuse + the working set**, with build, tests and quality green: a rebuilt helper the codebase or framework already ships; the seven decision-level rules `alfred-task-design` decides against, on the diff; the write-time bar (a comment that narrates or lies, a missing why, a name outside the repo's vocabulary, a dead branch, a magic number, an undisposed handle). SOLID is the vocabulary of the finding, never its basis - name what breaks. A finding, never a block. Never flag as over-build: input validation at a trust boundary, error handling that prevents data loss, a security measure, accessibility basics, anything the plan or the user explicitly asked for, or the one smallest test of non-trivial logic.

A factual claim in a finding is verified before it is stated: 'X cannot do Y' gets a one-grep precedent check, a value from a doc or config is read in the same turn - unverified is never a pass.

## Output

**Five named fields, every run, each with a value:**

```
Build:      <the command and its verdict line, quoted>
Live-probe: <the quoted probe output, or NOT RUN - <reason>>
Findings:   <count by severity, or `none`>
Probe code: <deleted: <what>, or `none written`>
Next run:   <what the next pass must cover, or `nothing owed`>
```

`none`, `none written` and `nothing owed` are answers; an omitted line is not. `NOT RUN -
environment: <what refused>` after the one boot attempt is an accepted verdict, beside the tests
that covered the path; a NOT RUN with no attempt and no in-process run is never a pass. Scratch
probe code is deleted as soon as its check passes. Then a ranked punch-list, most severe first -
`severity | the defect (file:symbol) | the fix` - or 'sound', naming what you checked and ran.
Hand it back; this skill applies no fixes.

As the pre-commit checkpoint, a sound verdict writes `<docs-path>/flow/COMMIT-GATE` as its OWN tool
call: `VERIFIED <what was reviewed, one phrase>`, `authorized: "<the user's words asking for THIS commit, verbatim>"`
(or `answered: <the option label>`), `head: <sha>`, `spec: <N files>`, `live-probe: <what ran, or NOT
RUN - <reason>>`; a security-relevant diff first passes the review `baseline-security.md` requires.
Unresolved BLOCKER or MATERIAL findings write no receipt. `references/review-in-full.md` has the
receipt rules in full.

## Example

`references/worked-example.md` reviews one build inline, one line per finding - read it before the first review of a session.
