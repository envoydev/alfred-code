---
name: habits-commit-checkpoint
description: "Use before a non-trivial git commit, git push or gh pr merge - 'commit this', 'push it', 'open the PR'. Not for the done gate, which proves the change works."
---

# Commit checkpoint - the gate before a commit or a publish

The protocol `alfred-git.md` points at: what runs before a non-trivial commit, the exemptions, the receipt the `guard-ungated-commit` hook reads, and the same ceremony for `git push` / `gh pr merge`. The commit-message shape and the branch discipline stay in the rule. Why each rule exists is `references/evidence.md` - an audit appendix, not a run-time load.

## When to use

- Before any non-trivial git commit, git push or gh pr merge - 'commit this', 'push it', 'open the PR', 'merge it' - or when the commit guard denies one for a missing COMMIT-GATE or PUSH-GATE receipt.
- Not for the done gate before it, which proves the change works, or the commit message's shape, which the git baseline owns.

## Pre-commit checkpoint

On any non-trivial diff, before committing or presenting, in order:

1. **Format.** The formatter half is never skipped, and it must be FRESH: a formatter run from
   earlier in the session does not cover files edited since. After the last edit, run the project's
   own format CHECK - the command CI runs (a `format:check` script, the workflow's format step), else
   the formatter's check mode - over EVERY staged path, inherited files included, not only the files
   this session edited; fix what it names with the formatter's write mode, re-stage, check again.
   Its clean verdict is the receipt's `format:` line.
2. **Review.** Run the house review `task-verify-code` - model-invocable, so the gate holds
   in autonomous flows too (`/code-review` - the bundled correctness review of the current diff - is
   not this gate; `/simplify` applies cleanup findings in place) - plus any diff gates named in the
   project's `AGENTS.md`. A DISPATCHED domain-verifier pass over exactly this diff satisfies it the
   same way - the right call when the session's context is already heavy. Either way the review is
   a real invocation THIS session: a receipt claiming 'task-verify-code inline' with no Skill
   call in the transcript is a replay from memory, not the gate.
3. **Security review** when the diff touches auth, crypto, secrets, payment or data-access paths
   (`alfred-security.md` owns the trigger) - the security half below.
4. **Done gate.** Satisfy the Definition-of-done gate.
5. **Ask.** No commit words from the user this conversation: name the paths (the scope derived fresh,
   as the git baseline spells it) and anything still owed, then put ONE AskUserQuestion; a picked
   option is the receipt's `answered:` line. Words the user already typed for THIS commit skip it -
   they are the `authorized:` line. The local commit takes the mark - it stays on this machine and
   `git reset --soft HEAD~1` undoes it; when the question names anything still owed, 'Show the diff first'
   takes the mark instead, listed first:

   ```ask
   Commit <N files - the session's own paths> on <branch>? <VERIFIED phrase | still owed: <gate>>.
   - 'Commit now (Recommended)' - stage exactly the named paths and commit them under the receipt
   - 'Show the diff first' - print the stat and the diff, then ask again; nothing is committed yet
   - 'Hold' - nothing is committed and no receipt is written
   ```

6. **Receipt.** Write the receipt below, then commit, read `git log -1 --stat` back into the close,
   then clear it.

**Scope - the session's own change.** What was untracked before this change began is not part of
it: the docs hook lists it at session start, once per HEAD (`<docs-path>/flow/untracked-at-start-<HEAD
sha>`, named in the start block). Stage the session's own paths by name, review and count only those in
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

`alfred-security.md` owns the trigger (crypto / secret / auth / payment / data-access work), the
honesty rules and the `VERIFIED` bar; this is how the review runs. **Do the scoped review yourself,
first:** apply the vulnerability checklist to exactly the change - a read-only general-purpose seat
where dispatch exists, inline otherwise. Inside a flow whose dispatch is explicit-only (the solve
flows) it runs inline unless the stop that led here offered the seat and the user picked it, and inline
inside a stamped flow whose dispatch guard blocks generic seats.
Feed it the FULL change set, read without touching the index - `git diff HEAD` plus, for each
file `git ls-files -o --exclude-standard` lists, `git diff --no-index -- /dev/null <file>`, so a
brand-new file is reviewed too. First the tracked diff and the untracked list:

```bash
git diff HEAD; git ls-files -o --exclude-standard
```

then ONE call naming each listed file, `|| true` because `--no-index` exits 1 whenever the files differ:

```bash
git diff --no-index -- /dev/null <file-1> || true; git diff --no-index -- /dev/null <file-2> || true
```

Name every file; never a loop or `xargs` over the list - the secret guard masks only a `git diff` whose
path it can read. Never `git add -N` and never `git reset` in a review or scope read. The review's file list is the
set `spec:` counts - hold the two against each other before the verdict - and the `security:` line
ends `- over <N> files`, that count. `/security-review` recomputes a whole-branch diff whatever base it
is handed: use it only when the whole branch really is the scope and the diff is small.

The checkpoint exemption above skips this half only when the gate that cleared the diff carried a
security pass - the integration-reviewer gate does, the quality loop's does not - or when every path
in the diff is a test file: verify that from the diff's file list and name it in the close
(`security review: skipped - test-only diff: <paths>`).

## The receipt

The checkpoint ends by writing its receipt: `<docs-path>/flow/COMMIT-GATE`, five lines, then the `format:` and `findings:` lines -

```
VERIFIED <what was reviewed, one phrase>
authorized: "<the user's words asking for THIS commit, verbatim>"
head: <the sha the review ran against>
spec: <N files - the set it covered>
live-probe: <what was actually run, or NOT RUN - <reason>>
format: <the format CHECK command run> - clean over <N> staged files
findings: <the review's Findings field, copied - a count by severity, or none>
```

The quality-loop and cross-task gate exemptions count as VERIFIED - name the loop or gate. On the
user's explicit waiver the receipt is `WAIVED - "<the user's words, verbatim>"` alone - 'commit it' is
an instruction to commit, never a waiver of the review. `spec:` proves it covered every file the commit takes in:
the index, plus what `-a`, a chained `git add` or the paths it names add. The quoted words must carry a
commit verb left standing in its clause ('push it, don't commit' consents to no commit) and must not be
an option label this run wrote: consent given by picking an option is `answered: <the chosen label>`
instead. A review carried from an earlier cycle says so: `carried: <cycle id>, reviewed <date>`.
A project with no formatter at all writes `format: none configured - clean over <N> staged files,
nothing to check`; a format line without the word `clean` is refused.

On a security-relevant diff the receipt adds an extra line: `security:` naming each category
checked and its verdict (`security: auth ok, secrets ok, injection ok, data-access n/a`). A
security claim with no `security:` line, or one that names no categories, is the one-line nod
`alfred-security.md` rejects - the guard reads it as no review at all.

Write the receipt as its OWN tool call, before the call that runs `git commit` - one written inside
the same compound command is unauditable in the ledger. The shipped hook still ACCEPTS the atomic
write+commit shape (blocking it would reject the receipt discipline itself), so only this rule binds.
Own-call receipt, then the commit, then clear it.

The `guard-ungated-commit` hook blocks a non-trivial `git commit` without a fresh receipt. It
judges 'trivial' mechanically - at most 2 files and 15 changed lines across the session's change - this
commit plus the session's earlier commits that passed without a receipt - so a prose-exempt diff above
that bar (a formatting-only sweep) still writes `VERIFIED` naming the exemption; never split a real
change into small commits to slip under it. One receipt covers a reviewed batch: a later commit passes on
it while its `head:` is an ancestor of HEAD and every commit since touches only files its review
covered; clear it after the LAST commit of the batch. The hook's staged-diff scan (a conflict marker, a
debugger, a focused test, a credential-shaped literal, a hidden character) is a fact check this receipt
never opens: remove the hit and stage again, or, on the user's 'Commit it as is' in the denial's own
ask, write the `<docs-path>/flow/STAGED-SCAN-ALLOW` receipt it names.

A commit in a second tree the cross-project guard allows gets its own receipt in THAT tree's docs
root, written and cleared the same way. A sibling repo is never committed, branched, pushed or PR'd
from here, and never OFFERED as an option in an ask of the run's own making - its change is a task
card under `<docs-path>/cross-project-tasks/`.

## Publishing - push and PR merge

The same ceremony: `git push` and `gh pr merge` leave this machine, so they carry their own
receipt, `<docs-path>/flow/PUSH-GATE`, in the SAME five-line shape - `VERIFIED <what is being
published, one phrase>`, `authorized: "<the user's words asking for THIS publish, verbatim>"`,
`head:`, `spec: <the commit set going out>` and `live-probe:` - or `WAIVED - "<their words>"`; no
`format:` or `findings:` line, since each commit going out carried its own. Its `spec:` names what
LEAVES the machine, so it is required and never counted against the working tree. When the probe
actually ran something and the commit set touches more than one identifiable project, the receipt adds
an extra line - `scope: <workspace, or the project list the probe ran>`, never just the project that
was convenient to test; its edge cases, and when the gate does not apply, are `references/publishing.md`.

**A no-fast-forward publish (`git merge --no-ff`, or a PR merge) creates a NEW head.** Run the merge
first, then write the receipt: `head:` names the resulting merge commit, never the pre-merge tip - a
receipt minted before the merge still reads the pre-merge tip, a different tree from what pushes.

1. Name what is going out and to which branch, then confirm it through ONE AskUserQuestion - a picked
   option is the receipt's `answered: <the chosen label>` line. Words the user already typed for THIS
   publish skip the ask - they are the `authorized:` line. A red the receipt's `live-probe:` records
   on a check CI also runs is named in the question - 'CI runs <check>, red here' - and 'Hold - fix
   the red first' replaces the plain Hold. Holding takes the mark, since a publish leaves the machine:

   ```ask
   Publish <the commit set> to <remote>/<branch>? It leaves this machine for CI and everyone on the branch.
   - 'Hold - push later (Recommended)' - nothing leaves the machine and no receipt is written
   - 'Publish' - push or merge exactly the set named above
   ```

2. Write the receipt as its own call.
3. Publish, read `git status -sb` back into the close (the branch level with its upstream), then
   clear the receipt.
4. **Watch CI once.** Where the repo runs CI on the pushed ref and its CLI resolves (`gh` on GitHub),
   arm ONE background watch on the pushed sha - `gh run list --commit <sha> --limit 1 --json
   databaseId,status`, then `gh run watch <id> --exit-status` as a background task, never a foreground
   sleep loop. The close carries its verdict, or `CI: pending - watching run <id>` when the turn ends first; a red verdict is
   reported when it lands, with the failing job's first error. No CI or no CLI: say so in one line.
