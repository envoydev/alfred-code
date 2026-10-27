---
name: review-code
description: "Use when reviewing a diff, branch, PR or path for bugs - 'review this', 'review my changes', 'code review'. Not for a planned build (task-verify-code)."
---

# Review Code - the stack's own code review

The stack's code review of a change set, a branch, a pull request or a path. It reads the target, runs the passes in `references/passes.md`, votes each candidate in a refute pass, and hands back one ranked table. It fixes nothing. It is the commit checkpoint's review when no plan built the change; `task-verify-code` reviews a planned build against its plan and uses the same passes.

## When to use

- 'review this', 'review my changes', 'code review', 'look over this branch', 'review PR 42', 'review src/orders'.
- Before a commit with no plan behind it (the commit checkpoint sends you here), or any time a second look is wanted.
- Not for a build a plan produced - `task-verify-code` gates it against the plan. Not for security - `review-security`. Not for fixing - the close asks; the fix is the session's own edit.

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

## Depth

`--depth quick|standard|deep` anywhere in the arguments; `standard` is the default.

- `quick` - passes 1, 4 and 6 over the touched functions only (no callers, no wrappers); no refute pass. For a small change and a fast answer.
- `standard` - all eight passes, then the refute pass.
- `deep` - `standard`, then the gap sweep in `references/passes.md`: one fresh read looking only for what the table does not hold yet.

## Dispatch

Run inline. First count the target from its own diff: changed lines (the change set `git diff HEAD --shortstat` plus each untracked file's lines, a path the same under `-- <path>`, a branch `git diff --shortstat <base>...<branch>`, a change request `git diff --shortstat <base>...<head>` over its fetched head, the forge tool's own counts - `gh pr view <n> --json additions,deletions` - only when no ref exists) and touched stacks (the convention rules the changed files attach - C# and TypeScript are two). Over 600 changed lines, or two or more stacks, and the roster lists a `<stack>-verifier` for every touched stack, open with one ask:

```ask
This change is <n> changed lines over <stacks> - review it in a seat to keep this context light?
- 'Dispatch the seat (Recommended)' - the touched stack's verifier reviews the diff in its own context, one per stack
- 'Review it here' - the passes run in this chat; its reads land in this context
```

The seat is the touched stack's `<stack>-verifier`, dispatched exactly as the roster spells it (`alfred-code:<seat>` where the core plugin carries it), with a diff brief: the target's read commands, the depth, and the report shape below. Otherwise - under the bar, or a touched stack with no verifier on the roster (verifiers cover ten stacks, and an install holds only the ones it picked) - run inline without asking. Inside the solve flows dispatch stays explicit-only: inline unless the stop that led here offered the seat and the user picked it.

## Run

1. Read the target (above). The preferences hook hands the code preferences over before the first read; where no hook ran, read `PERSONAL-CODE-`, `ARCHITECTURE-` and `PROJECT-CODE-PREFERENCES.md` that exist under `<docs-path>/preferences/` first.
2. Run the passes in `references/passes.md` the depth asks for, each over the target only. Each candidate is a row: `file:line`, what is wrong, the failure scenario (the input or state that makes it fail, and what the user sees), a one-word category (null-deref, dropped-guard, race, contract-break, pitfall, convention, cleanup ...).
3. The refute pass (`references/passes.md`) on every candidate, `quick` excepted.
4. At `deep`, the gap sweep.

A factual claim in a finding is checked before it is stated: 'X cannot happen' gets one search for a counter-example first, and a quoted value is read from its source in the same turn.

## Report

One table, most severe first - BLOCKER rows, then MATERIAL, then MINOR, CONFIRMED before PLAUSIBLE within each:

```text
file:line | summary | failure scenario | category | verdict
```

`verdict` is CONFIRMED or PLAUSIBLE (REFUTED rows are gone). BLOCKER is a CONFIRMED wrong result, crash, data loss or broken contract; MATERIAL is any other correctness row, a PLAUSIBLE one of those shapes included; MINOR is convention and cleanup. There is no cap and no padding: list what the passes found, and 'no findings' - with the passes run and the files read named - is a valid result. Under the table, two lines: `Findings: <n> BLOCKER, <m> MATERIAL, <k> MINOR` (or `Findings: none`) - the field the commit checkpoint's receipt copies - and `Reviewed: <n> files, <m> changed lines, depth <level>`. This skill fixes nothing.

## Close

Inside the commit checkpoint the checkpoint's own ask follows, not this one. Run on its own, close on one ask:

```ask
Fix the <n> findings now?
- 'Fix the confirmed ones (Recommended)' - CONFIRMED findings are fixed in this session, PLAUSIBLE ones listed for you
- 'Fix all, plausible too' - every finding in the table is fixed
- 'Leave them' - the table stays as the record and nothing changes
```

With no findings, no ask: say so with the `Reviewed:` line.
