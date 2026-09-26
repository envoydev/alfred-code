---
description: House baseline - git, pull requests, and the pre-commit checkpoint. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Git and pull requests

- Conventional Commits, or the ticket-id header below - the only two valid headers. Branch `<type>/<short-description>` or `<type>/<ticket-id>`.
- Do NOT commit or push until the user explicitly says to, however done the task looks. Show the diff for review first.
- The scope at a commit ask is derived FRESH - `git add -N . && git diff HEAD --stat; git reset -q`, ONE Bash call with the reset chained, so untracked files count and no intent-to-add entry outlives it - and the ask names anything still owed on the diff (a gate not run, a review skipped).
- Never mention yourself: no AI/assistant attribution in commits, branches, or PR text (deliberate override of the platform default).
- One logical change per PR, under 400 LOC; the body says what / why / how to test, links the ticket, and carries screenshots if UI.
- Squash or rebase, no merge commits on feature branches; prefer `--force-with-lease`; know the undo before non-trivial git (rebase, cherry-pick, recovery).

## Commit message shape

- **Header** - the ticket id (`PROJ-142`) or the feature delivered (a Conventional-Commits subject such as `feat(auth): token refresh` counts as the feature). One line.
- Then a blank line, then the body: one short, understandable sentence per thing done, each on its own line, indented two spaces, with NO blank line between them.
- A critical caveat (a constraint a later change must not break, a footgun, a silent tradeoff) goes LAST, after a blank line, indented, prefixed `Critical:`. Omit it when there is none.

```
PROJ-142

  Added a /healthz endpoint to the orders API.
  Wired it into the container readiness probe.

  Critical: the probe path must stay /healthz or the readiness probe breaks the rollout.
```

## Pre-commit checkpoint and publishing

A non-trivial commit, a `git push` or a `gh pr merge` is next - the FIRST action is the
`alfred-habits-commit-checkpoint` Skill call, before the command runs. It writes the
`<docs-path>/flow/COMMIT-GATE` receipt, or the same-shaped `<docs-path>/flow/PUSH-GATE` receipt for a
publish; `guard-ungated-commit` blocks all three without a fresh one.
