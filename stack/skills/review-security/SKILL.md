---
name: review-security
description: "Use when a change touches auth, crypto, secrets, payment or data access - 'security review', 'is this safe'. Not for a full audit (security-auditor)."
---

# Review Security - the stack's own security review

The stack's security review of a change set, a branch, a pull request or a path. It learns the project's own security helpers, traces each new input to the sensitive call it reaches, scores every candidate, refutes each finding against `references/not-a-finding.md`, and hands back a findings table plus a short list of leads. It fixes nothing. It is the commit checkpoint's security half: its verdict is the receipt's `security:` line.

## When to use

- 'security review', 'is this safe', 'review this for security', 'check the auth change', 'review PR 42 for security'.
- Before a commit whose change touches authentication, authorization, crypto, secrets, payment, file or network input, or data access (the commit checkpoint sends you here).
- Not for a whole-project posture audit - dispatch the security-auditor seat for that. Not for correctness bugs - `review-code`. Not for fixing - the close asks; the fix is the session's own edit.

## Target

The first argument picks what is read; everything else is out of scope. Never an unbounded whole-branch read.

- **None - the change set.** Feed it the FULL change set, read without touching the index - `git diff HEAD` plus, for each file `git ls-files -o --exclude-standard` lists, `git diff --no-index -- /dev/null <file>`, so a brand-new file is reviewed too. The list is taken minus the paths in `<data root>/state/sessions/untracked-at-start-<HEAD sha>` (the record the session start wrote and named in its block; absent = none to subtract): a file untracked before the change began is not part of it - name those in one line as outside the change. First the tracked diff and the untracked list:

  ```bash
  git diff HEAD; git ls-files -o --exclude-standard
  ```

  then ONE call naming each listed file, `|| true` because `--no-index` exits 1 whenever the files differ:

  ```bash
  git diff --no-index -- /dev/null <file-1> || true; git diff --no-index -- /dev/null <file-2> || true
  ```

  Name every file; never a loop or `xargs` over the list - the secret guard masks only a `git diff` whose path it can read. Never `git add -N` and never `git reset` in a review or scope read.
- **A branch.** `git diff <base>...<branch>`, `<base>` the remote's default branch (`git symbolic-ref --short refs/remotes/origin/HEAD`, e.g. `origin/main`), else whichever of `main` and `master` exists - never the branch's own upstream, which holds the same commits and diffs to nothing.
- **A change request number** (a PR or an MR). Read with plain git first, the same on every forge: `git fetch <remote> refs/pull/<n>/head` (GitHub, Gitea) or `refs/merge-requests/<n>/head` (GitLab), its head the sha `git rev-parse FETCH_HEAD` prints right after, then `git diff <base>...<head>`. Only when the remote publishes no such ref (Azure DevOps, Bitbucket) read it through the forge tool the session's `Forge:` line names - `gh pr diff <n>`, `glab mr diff <n>`, an MCP diff read.
- **One or more paths.** The change set under them: `git diff HEAD -- <path-1> <path-2>`, and each untracked file under them through `--no-index` as above; a path named here is in scope even when the start record lists it. The commit checkpoint hands over the paths its commit takes in this way.

Code is read where the target lives. The change set and a path are the checkout. A branch or a pull request is read at its head: the checkout only when that head is checked out (`git rev-parse HEAD` equals it), otherwise each file as `git show <head>:<path>` - a branch's head is `<branch>`, a change request's the fetched sha above (with no such ref, the forge tool's head field - `gh pr view <n> --json headRefOid -q .headRefOid` - then `git fetch <remote> <head>` when `git show` cannot find it) - since the navigation tools, the LSP and Read see only the checkout.

## Dispatch

Run inline. First count the target from its own diff: changed lines (the change set `git diff HEAD --shortstat` plus each untracked file's lines, a path the same under `-- <path>`, a branch `git diff --shortstat <base>...<branch>`, a change request `git diff --shortstat <base>...<head>` over its fetched head, the forge tool's own counts - `gh pr view <n> --json additions,deletions` - only when no ref exists) and touched stacks (the convention rules the changed files attach). Over 600 changed lines, or two or more stacks, open with one ask:

```ask
This change is <n> changed lines over <stacks> - review it in a seat to keep this context light?
- 'Dispatch the seat (Recommended)' - security-auditor reviews the target in its own context and reports in this skill's table
- 'Review it here' - the method runs in this chat; its reads land in this context
```

The seat is security-auditor, dispatched exactly as the roster spells it (`alfred-code:security-auditor` where the core plugin carries it), with a diff brief naming the target's read commands, this skill's method and `references/not-a-finding.md`, and the report shape below. Under the bar, run inline without asking. Inside the solve flows dispatch stays explicit-only: inline unless the stop that led here offered the seat and the user picked it.

## Run

1. Read the target (above).
2. Run the six steps of `references/method.md` in order over the target only: repo context, departures, taint trace, categories, confidence, refute pass.
3. Sort what survives by confidence: 8-10 is a finding, 5-7 a lead, under 5 dropped as noise. A refuted candidate is dropped, never moved to the leads.

A factual claim is checked before it is stated: 'X is unreachable' gets one search for a caller first, and a quoted value is read from its source in the same turn. A candidate no installed skill owns stays: when no installed skill matches, keep the finding in this report tagged with its surface and mark it UNVERIFIED.

## Report

Findings, most severe first (HIGH, then MEDIUM; a LOW is a lead):

```text
file:line | severity | category | exploit scenario | fix
```

A filled row: `src/api/orders.ts:57 | HIGH | injection | an order id of '1 OR 1=1' returns every customer's orders | bind the id as a query parameter`.

Then the leads, one line each:

```text
file:line - suspected issue - what proves or clears it
```

Last, one line: `Findings: <n> HIGH, <m> MEDIUM, <k> leads` (or `Findings: none`) - the line the commit gate reads as this review's end; a run without it is no review there.

Leads are shown and counted, and they never block the commit receipt's VERIFIED. There is no cap and no padding: 'no findings' - with the categories checked and the files read named - is a valid result, and a category never looked at is UNVERIFIED, never a pass.

## Receipt

The verdict is the commit receipt's `security:` line - a verdict per category, then the file count:

```text
security: auth ok, secrets ok, injection 1 finding, data-access n/a - over <N> files
```

`<N>` is the target's file list - the files the review covers, never the context read around them; the commit gate refuses a count below what the commit takes in. With leads, add `, <k> leads` before ` - over`. Inside the commit checkpoint, hand `receipt.js` the verdict without the over-clause: it appends `- over <N> files` from the commit's own list.

## Close

Inside the commit checkpoint the checkpoint's own ask follows, not this one. Run on its own, close on one ask:

```ask
Fix the <n> security findings now?
- 'Fix the findings (Recommended)' - every finding in the table is fixed in this session, the leads listed for you
- 'Fix the findings and the leads' - the leads are proven or cleared first, then fixed where real
- 'Leave them' - the table stays as the record and nothing changes
```

With no findings, no ask: say so with the receipt line, and list the leads if any.
