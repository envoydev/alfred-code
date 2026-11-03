---
description: House baseline - the generated-docs root. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Generated docs root

- EVERY doc the assistant creates - an instruction file (AGENTS.md, a rule, a skill) excepted - lives under ONE root, each capture in the domain folder its skill names (`preferences/`, `awareness/`, `quality/`; a structural doc such as the module boundaries goes into the architecture map as a section through `/capture-awareness architecture`), and the rest in their homes: ADRs with no home (`decisions/`), ticket drafts (`tickets/`), the explainer's saved walkthroughs (`explanations/`), and the flow docs under `work/` (`plans/`, `specs/`, diagnosis findings in `diagnoses/`, and `cross-project-tasks/` - every doc for another repo, task cards included). A doc outside the root, or outside its domain folder, is invisible to every capture, status and prune step and to the next session.
- Creating a doc outside this root (a committed `docs/`, the repo root) happens only on the user's asked-first approval of that exact location, through AskUserQuestion. A sibling repo is written only when the user allows it in the cross-project write guard's ask - its `<data root>/state/approvals/CROSS-WRITE-ALLOW` receipt, this session only; by default any other doc about it, and a change it must make (a task card), lives in `work/cross-project-tasks/`. A hand-off to another repo prints ONE fenced block: `Open in: <its root, absolute>`, then `Task card: <this card's absolute path> - section '<heading>'`, then the section's text. Editing an existing repo doc where it lives (`README.md`, an established ADR home) needs no ask.
- **This install's root: `__DOCS_ROOT__`** - always `<data root>/docs`, where `<data root>` is `ALFRED_CODE_DATA_PATH` (default `.alfred`), which holds the docs, the hooks' `state/` and `statistics/` and the project's `.secrets`. `<docs-path>/<name>` means this root.
- The hooks' ledgers (`<data root>/statistics/`, and the session history in `<data root>/state/history/`) are the only record of what ran and what the guards denied, and the rest of `<data root>/state/` is live per-session state: a cleanup keeps them, or its ask names that loss - never 'regenerable'.
- Search the root with `docs.js` or `/usr/bin/grep -r`, never a bare `grep -r`: the Bash tool's `grep` honours `.gitignore`, and a machine-local root ignores itself, so the search returns nothing, silently.
- Every capture doc opens with `Captured: <branch>@<short-sha>, <date>` (`+dirty` = uncommitted work) - the user's own preference docs with `Updated: <date>`, as they record the user's words, not the code - and follows the checked-out branch (`docs.js status` says how): a foreign-branch or `+dirty` stamp is approximate - verify against the code. Nothing re-captures automatically; a flow suggests a capture at close only when its output is missing or no longer matches this run's change, never the capture that just ran.

<!-- Operator note: the data root's one .gitignore (`<data root>/.gitignore`) carries the docs rules, written by
     the installer from ALFRED_CODE_DOCS_VERSIONING (a docs root outside the data root keeps its own): under `local`
     the whole root stays out of git (nothing survives a
     fresh clone, so the captures are re-run after a re-clone); under `git` the docs are committed, the
     hooks' state/ and statistics/ beside them in the data root never are. A committed root shares the
     generated docs with the team; its work/plans/ and work/specs/ are committed with it.
     Configuration, not model behaviour, so it is not injected - the
     installer's next-steps say the same thing at install time. -->

<!-- Maintainer note: ALFRED_CODE_DOCS_PATH is retired (2.8.0); every reader defaults to <data root>/docs and, for the
     2.x line, still reads a leftover key first, which an update moves and removes - meta/shared-rules.json's
     docs-root-resolution entry pins every reader. -->
