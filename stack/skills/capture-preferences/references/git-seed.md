# Git preferences

Updated: __TODAY__

## G1 - Ask before any commit or push
<!-- id: g1 -->
<!-- locked: consent -->
- Rule: Do NOT commit or push until the user explicitly says to, however done the task looks - a picked ask option is that word. A commit ask recommends the local commit (`git reset --soft HEAD~1` undoes it) and offers the diff first; when it names anything still owed, 'Show the diff first' takes the mark, and every push or publish ask marks holding.
- Scope: every commit, push, merge and publish
- Why: the user owns what leaves the working tree.

## G2 - Derive the commit scope fresh
<!-- id: g2 -->
<!-- locked: scope -->
- Rule: the scope at a commit ask is derived FRESH - `git diff HEAD --stat; git ls-files -o --exclude-standard`, which counts untracked files and never moves the index (a `git reset` after `git add -N` unstages work already staged) - and the ask comes after the checkpoint's review, naming anything still owed on the diff (a gate not run, a review skipped); an answer given before any review ran is voided.
- Scope: every commit ask
- Why: the scope the user approves is the scope that lands.

## G3 - Run the pre-commit checkpoint first
<!-- id: g3 -->
<!-- locked: checkpoint -->
- Rule: when a non-trivial commit, a `git push` or a `gh pr merge` is next, the FIRST action is the `habits-commit-checkpoint` Skill call, before the command runs. It writes the `<data root>/state/approvals/COMMIT-GATE` receipt, or the same-shaped `<data root>/state/approvals/PUSH-GATE` receipt for a publish.
- Scope: commits, pushes, pull request merges
- Why: `guard-ungated-commit` blocks all three without a fresh receipt.

## G4 - Keep history recoverable
<!-- id: g4 -->
<!-- locked: safety -->
- Rule: squash or rebase, no merge commits on feature branches; prefer `--force-with-lease`; know the undo before non-trivial git (rebase, cherry-pick, recovery).
- Scope: history rewrites and recovery
- Why: a forced push or a botched rebase loses work nobody can get back.

## G5 - Branch names
<!-- id: g5 -->
- Rule: name a branch `<type>/<short-description>` or `<type>/<ticket-id>`.
- Scope: new branches

## G6 - No AI attribution
<!-- id: g6 -->
- Rule: never mention yourself - no AI or assistant attribution in commits, branches or pull request text.
- Scope: commit messages, branch names, pull request text
- Why: a deliberate override of the platform default.

## G7 - One logical change per pull request
<!-- id: g7 -->
- Rule: one logical change per pull request, under 400 LOC; the body says what, why and how to test, links the ticket, and carries screenshots for a UI change.
- Scope: pull requests

## G8 - Commit message shape
<!-- id: g8 -->
- Rule: the header is one line - the ticket id (`PROJ-142`) or a Conventional-Commits subject for the feature delivered (`feat(auth): token refresh`); then a blank line and one short sentence per thing done, each on its own line, indented two spaces, with no blank line between them; a critical caveat (a constraint a later change must not break, a footgun, a silent tradeoff) goes last, after a blank line, indented, prefixed `Critical:`, only when there is one.
- Scope: every commit message

```
PROJ-142

  Added a /healthz endpoint to the orders API.
  Wired it into the container readiness probe.

  Critical: the probe path must stay /healthz or the readiness probe breaks the rollout.
```
