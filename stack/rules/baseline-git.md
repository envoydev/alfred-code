---
description: House baseline - git, pull requests, and the pre-commit checkpoint. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Git and pull requests

- Conventional Commits - or the ticket-id header shape below; the two are the only valid headers. Branch `<type>/<short-description>` or `<type>/<ticket-id>`.
- Do NOT commit or push until the user explicitly says to - not when a task looks finished, not proactively because it seems done. Show the diff and let them review; commit only on their explicit word, and push only when they ask.
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

On any non-trivial diff the checkpoint runs BEFORE the commit - the formatter fresh after the last
edit, the house review, and the security review `baseline-security.md` defines for its paths (that
rule owns which review runs and how it is bounded) - and ends by writing the
`<docs-path>/flow/COMMIT-GATE` receipt; `git push` and `gh pr merge` carry the
same-shaped `<docs-path>/flow/PUSH-GATE` receipt. The protocol - what runs, the exemptions, the
receipt's five lines and when it is cleared - is the `alfred-habits-commit-checkpoint` skill: load it when
a commit or a publish is the next act. `guard-ungated-commit` blocks both verbs without a fresh
receipt, and its denial names the skill.
