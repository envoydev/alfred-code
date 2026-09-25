---
description: House baseline - git, pull requests, and the pre-commit checkpoint. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Git and pull requests

- Conventional Commits - or the ticket-id header shape below; the two are the only valid headers. Branch `<type>/<short-description>` or `<type>/<ticket-id>`.
- Do NOT commit or push until the user explicitly says to - not when a task looks finished or seems done. Show the diff and let them review first.
- The scope shown at a commit ask is derived FRESH at ask time - `git add -N . && git diff HEAD --stat; git reset -q`, ONE Bash call with the reset chained on the end, so untracked files count and the intent-to-add entries never outlive the stat - never an earlier turn's stat; the same ask names anything still owed on the diff (a gate not yet run, a review skipped) rather than leaving it to a private receipt.
- Never mention yourself: no AI/assistant attribution in commits, branches, or PR text (deliberate override of the platform default).
- One logical change per PR, under 400 LOC. Body: what / why / how to test. Link the ticket; screenshots if UI.
- Squash or rebase, no merge commits on feature branches; prefer `--force-with-lease`. Non-trivial git (rebase, cherry-pick, recovery): know the undo before you run it.

## Commit message shape

- **Header** - the ticket id (`PROJ-142`) or the feature delivered (a Conventional-Commits subject such as `feat(auth): token refresh` counts as the feature). One line.
- Then a blank line, then the body: one short, understandable sentence per thing done, each on its own line, indented two spaces, with NO blank line between them.
- A critical caveat (a constraint a later change must not break, a footgun, a silent tradeoff) goes LAST, after a blank line, indented, prefixed `Critical:`. Omit it when there is none.

```
PROJ-142

  Added a /healthz endpoint to the orders API.
  Wired it into the container readiness probe.
  Updated the deployment runbook.

  Critical: the probe path must stay /healthz or the readiness probe breaks the rollout.
```

## Pre-commit checkpoint and publishing

A non-trivial commit, a `git push` or a `gh pr merge` is next - the FIRST action is the
`alfred-habits-commit-checkpoint` Skill call, before the command runs. The skill runs the checks and
writes the `<docs-path>/flow/COMMIT-GATE` receipt, or the same-shaped `<docs-path>/flow/PUSH-GATE`
receipt for a publish; `guard-ungated-commit` blocks all three without a fresh one, and its denial
names the skill.
