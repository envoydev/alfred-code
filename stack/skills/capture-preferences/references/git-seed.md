# Git preferences

Updated: __TODAY__

## G1 - Ask before any commit or push
<!-- id: g1 -->
<!-- locked: consent -->
- Rule: Do NOT commit or push until the user explicitly says to, however done the task looks - a picked ask option is that word. A commit ask recommends the local commit (`git reset --soft HEAD~1` undoes it) and offers the diff first; when it names anything still owed, 'Show the diff first' takes the mark, and every push or publish ask marks holding.
- Scope: every commit, push, merge and publish
- Why: the user owns what leaves the working tree.

## G2 - Run the pre-commit checkpoint first
<!-- id: g2 -->
<!-- locked: checkpoint -->
- Rule: when a non-trivial commit, a `git push` or a `gh pr merge` is next, the FIRST action is the `habits-commit-checkpoint` Skill call, before the command runs. It writes the `<data root>/state/approvals/COMMIT-GATE` receipt, or the same-shaped `<data root>/state/approvals/PUSH-GATE` receipt for a publish.
- Scope: commits, pushes, pull request merges
- Why: `guard-ungated-commit` blocks all three without a fresh receipt.

## G3 - Never lose work
<!-- id: g3 -->
<!-- locked: safety -->
- Rule: ask before any git command that discards or rewrites work - `git reset --hard`, `git clean`, a checkout or restore over uncommitted changes, `git branch -D`, `git stash drop`, an amend or rebase of a pushed commit; force-push only with `--force-with-lease`; know the undo before any non-trivial git (rebase, cherry-pick, recovery).
- Scope: discards, history rewrites and recovery
- Why: a forced push or a botched rebase loses work nobody can get back.

## G4 - No AI attribution
<!-- id: g4 -->
<!-- locked: attribution -->
- Rule: never mention yourself - no AI or assistant attribution in commits, branches or pull request text.
- Scope: commit messages, branch names, pull request text
- Why: a deliberate override of the platform default.

## G5 - Never bypass a check
<!-- id: g5 -->
<!-- locked: checks -->
- Rule: never skip a hook or a signature - no `--no-verify`, `--no-gpg-sign` or `-c core.hooksPath=` - unless the user says so for that command.
- Scope: commits, pushes, merges
- Why: a hook or a signature is the project's own check; skipping it ships what the check exists to stop.
