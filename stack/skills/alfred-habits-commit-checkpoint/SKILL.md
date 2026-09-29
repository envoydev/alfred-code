---
name: alfred-habits-commit-checkpoint
description: "Use before a non-trivial git commit, git push or gh pr merge - 'commit this', 'push it', 'open the PR'. Not for the done gate, which proves the change works."
---

# Commit checkpoint - the gate before a commit or a publish

The protocol `baseline-git.md` points at: what runs before a non-trivial commit, the exemptions, the receipt the `guard-ungated-commit` hook reads at commit time, and the same ceremony for `git push` / `gh pr merge`. The commit-message shape and the branch discipline stay in the rule. The measurements behind these rules live in `references/evidence.md` - an audit appendix, not a run-time load.

## When to use

- Fires before any non-trivial git commit, git push or gh pr merge - 'commit this', 'ready to commit', 'push it', 'open the PR', 'merge it' - or when the commit guard denies one for a missing COMMIT-GATE or PUSH-GATE receipt.
- The pre-commit checkpoint (formatter, code review, the security review on auth, secret, crypto, payment and data-access paths) and the receipts the commit guard reads.
- Not for the done gate before it, which proves the change works, or the commit message's shape, which the git baseline owns.

## Pre-commit checkpoint

On any non-trivial diff, before committing or presenting, in order:

1. **Format.** The formatter half is never skipped, and it must be FRESH: a formatter run from
   earlier in the session does not cover files edited since - re-run it after the last edit, before
   the commit. One unformatted commit is a red CI run and a fixup commit.
2. **Review.** Run the house review `alfred-task-verify-code` - model-invocable, so the gate holds
   in autonomous flows too (`/code-review` is a user-run parallel sweep, not this gate; `/simplify`
   applies its quality findings in place) - plus any diff gates named in the project's `CLAUDE.md`.
   The review half may also run as a DISPATCHED domain-verifier pass over exactly this diff - the
   right call when the session's carried context is already heavy, since the seat reviews from a
   clean context - and its sign-off satisfies the checkpoint the same way. Either way the review is
   a real invocation THIS session: a receipt claiming 'alfred-task-verify-code inline' with no Skill
   call in the transcript is a replay from memory, not the gate.
3. **Security review** when the diff touches auth, crypto, secrets, payment or data-access paths
   (`baseline-security.md` owns the trigger) - the security half below.
4. **Done gate.** Satisfy the Definition-of-done gate.
5. **Receipt.** Write the receipt below, then commit, then clear it.

Findings caught here land in the same commit; found later they become fixup noise or shipped
defects.

**Scope - the session's own change.** What was untracked before this change began is not part of
it: the docs hook lists it at session start, once per HEAD (`<docs-path>/flow/untracked-at-start-<HEAD
sha>`, named in the start block), so a later session on the same HEAD keeps the earlier one's files. Stage the session's own paths by name, review and count only those in
`spec:`, and name the pre-existing ones in one line as outside the change. One goes in only when the
user names it - the commit guard blocks a `git add` that would sweep it in (`-A`, `.`, a directory)
until `<docs-path>/flow/UNTRACKED-ALLOW` lists it.

**Exemptions.** Skip the checkpoint for typos / one-line / formatting-only diffs - and for a diff an
equivalent-or-stronger check just cleared: the active quality-loop's own dispatched re-verify plus
final gate, or the cross-task flow's domain-verifier sign-offs plus the integration-reviewer final
gate (a self-granted skip on any other reasoning is not this exemption; the security half has its
own narrower carve-out, below). The formatter half runs even then. A quality-loop stage-boundary
commit may exceed the one-logical-change size guidance when its stages share touched files - name
the stages in the commit body rather than splitting an unverifiable diff.

## The security half

`baseline-security.md` owns the trigger (crypto / secret / auth / payment / data-access work), the
honesty rules and the `VERIFIED` bar; this is how the review runs. **Do the scoped review yourself,
first:** compute `git diff HEAD` (or the staged diff, or `git diff <base>..HEAD` for a range) and
apply the vulnerability checklist to exactly that - a read-only general-purpose seat where dispatch
exists, inline otherwise, and inline inside a stamped flow where the dispatch guard blocks generic
seats. Feed it the FULL change set with the reset chained into the SAME call, the spelling that rule
carries, so untracked files appear in the diff and the intent-to-add entries never outlive it.

`/security-review` is the UNBOUNDED route, and the bound is not yours to set: it recomputes a
whole-branch diff whatever base it is handed, so an explicit base does not scope it, and a branch
level with origin on a clean tree overflows the same way - 'long-lived branch' is not the trigger
either. Reach for it only when the whole branch really is the review scope and the diff is small.

The checkpoint exemption above skips this half only when the gate that cleared the diff carried a
security pass - the integration-reviewer gate does, the quality loop's does not, so a loop diff on
these paths still runs the review before `VERIFIED`.

## The receipt

The checkpoint ends by writing its receipt: `<docs-path>/flow/COMMIT-GATE`, five lines -

```
VERIFIED <what was reviewed, one phrase>
authorized: "<the user's words asking for THIS commit, verbatim>"
head: <the sha the review ran against>
spec: <N files - the set it covered>
live-probe: <what was actually run, or NOT RUN - <reason>>
```

(the quality-loop and cross-task gate exemptions count as VERIFIED - name the loop or gate); or
`WAIVED - "<the user's words, verbatim>"` alone on their explicit waiver - 'commit it' is an
instruction to commit, never a waiver of the review. Each line answers a way the receipt once
passed while recording nothing: the VERIFIED line proves the review ran, `authorized:`
proves the user asked, `head:` proves it reviewed THIS tree, `spec:` proves it covered the whole
diff and `live-probe:` proves it ran the thing. The quoted words must carry a commit verb and must
not be an option label this run wrote: consent given by picking an option is spelled `answered: <the
chosen label>` instead, which is a different claim and reads as one. A review carried from an
earlier cycle says so: `carried: <cycle id>, reviewed <date>`.

On a security-relevant diff the receipt adds an extra line: `security:` naming each category
checked and its verdict (`security: auth ok, secrets ok, injection ok, data-access n/a`). A
VERIFIED line that claims a security review with no `security:` line, or one that just repeats
'no findings' with no categories named, is the one-line nod `baseline-security.md` rejects - the
guard reads it as no review at all. A review carried from an earlier cycle names its categories in
THAT session's receipt, not this one - the `carried:` line above is enough.

Write the receipt as its OWN tool call, before the call that runs `git commit` - the enforcing
hook checks the file at commit time, so a receipt written inside the same compound command is
invisible to a stricter gate and unauditable in the ledger. The shipped hook still ACCEPTS the atomic
write+commit shape (blocking it would reject the receipt discipline itself), so nothing stops you
mechanically - which is exactly why the rule is the binding one. Own-call receipt, then
the commit, then clear it.

The `guard-ungated-commit` hook blocks a non-trivial `git commit` without a fresh receipt. It
judges 'trivial' mechanically - at most 2 files and 15 changed lines - so a prose-exempt diff
above that bar (a formatting-only sweep) still writes `VERIFIED` naming the exemption; never
split a real change into small commits to slip under it. Clear the file once the commit lands -
after the LAST commit when one receipt covers a reviewed batch - a leftover receipt is the
stale-stamp failure the hook's 2h age cap exists for.

A commit in a second tree this session may write (the cross-project guard's own allowance, for a
tree the project owns) gets its own receipt in THAT tree's docs root, written and cleared the same
way. A sibling repo is never committed, branched, pushed or PR'd from here - its change is a task
card under `<docs-path>/cross-project-tasks/`, and it is never OFFERED as an option in an ask of
the run's own making. The one place it IS offered is the guard's own denial - 'Allow writes into
<root> for this session', never the recommended option - and only because that answer is
honoured: it writes the `<docs-path>/flow/CROSS-WRITE-ALLOW` receipt (one root per line; this
session's own, under 8h) that the guard reads before it judges.

## Discarding uncommitted work

The same receipt shape. `git checkout --` / `restore` / `reset --hard` / `clean -f` over a DIRTY
path is blocked, and the denial's three-option ask (keep, recommended / discard / narrow to one
file) is the user's to answer - never yours. Only after they answer 'Discard it', never
pre-emptively, write `<docs-path>/flow/DISCARD-ALLOW` - one path per line spelled exactly as the
blocked command spells them, or a single `*` for everything; this session's own, under 8h - and
then retry the SAME command.

## Publishing - push and PR merge

The same ceremony. `git push` and `gh pr merge` are where the work leaves this machine - other
people and CI get it, and a shared branch cannot be un-pushed quietly - so they carry their own
receipt, `<docs-path>/flow/PUSH-GATE`, in the SAME five-line shape - `VERIFIED <what is being
published, one phrase>`, `authorized: "<the user's words asking for THIS publish, verbatim>"`,
`head:`, `spec: <the commit set going out>` and `live-probe:` - or `WAIVED - "<their words>"`. Only
the spec differs in kind: a publish's spec names what LEAVES the machine, not what is uncommitted
here, so it is required and never counted against the working tree.

1. Name what is going out and to which branch, then confirm it through ONE AskUserQuestion - a picked
   option is the receipt's `answered: <the chosen label>` line, words the user typed its `authorized:`:

   ```ask
   Publish <the commit set> to <remote>/<branch>? It leaves this machine for CI and everyone on the branch.
   - 'Publish (Recommended)' - push or merge exactly the set named above
   - 'Hold' - nothing leaves the machine and no receipt is written
   ```

2. Write the receipt as its own call.
3. Publish, then clear the receipt.

`guard-ungated-commit` enforces this half too. A push that publishes nothing - a dry run, or a
branch already level with its upstream - is never gated, and a repo whose remote is already gated
by branch protection or a required review turns the half off for good with
`ALFRED_CODE_PUSH_GATE=0` in the settings.json env block.

When the probe actually ran something and the commit set touches more than one identifiable
project, the receipt adds an extra line - `scope: <workspace, or the project list the probe ran>`:
name the whole workspace run (`nx affected`, a full suite) or every project the diff touches, never
just the one that was convenient to test - a narrow run passes both gates and leaves CI to find the
rest. A single-project or
docs-only push, or a probe that genuinely ran nothing (`NOT RUN - <reason>`), needs no `scope:` line.

**A no-fast-forward publish (`git merge --no-ff`, or a PR merge) creates a NEW head.** Run the
merge first, then write the receipt: `head:` names the resulting merge commit, never the pre-merge
tip - a receipt minted before the merge still reads the pre-merge tip, the guard correctly reads it
as reviewing a different tree than what actually pushes, and the retry costs a full edit-and-redo.
Probe, write the receipt naming the merge commit, then push.
