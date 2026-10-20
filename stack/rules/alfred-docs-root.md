---
description: House baseline - the generated-docs root. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Generated docs root

- EVERY doc the assistant creates - an instruction file (AGENTS.md, a rule, a skill) excepted - lives under ONE root, each capture in its own domain folder: `architecture/`, `code-style/CODE-STYLE.md`, the user's preferences (`preferences/`), ADRs with no home (`decisions/`), the awareness docs (`awareness/` - the install's inventory, the run book, the sibling repos), the flow docs under `work/` (`plans/`, `specs/`, diagnosis findings in `diagnoses/`, and `cross-project-tasks/` - every doc for another repo, task cards included), and the quality docs under `quality/` (`loops/`, `test-coverage/`; `quality/ARCHITECTURE-ASSESSMENT.md` and `quality/CODE-ASSESSMENT.md` are recomputed every run). A doc outside the root, or outside its domain folder, is invisible to every capture, status and prune step and to the next session.
- Creating a doc OUTSIDE this root (a committed `docs/`, the repo root) happens only on the user's asked-first approval of that exact location, through AskUserQuestion. A sibling repo is written only when the user allows it in the cross-project write guard's ask - its `<data root>/state/approvals/CROSS-WRITE-ALLOW` receipt, this session only; by default any other doc about it, and a change it must make (a task card), lives in `work/cross-project-tasks/`. A hand-off to another repo prints ONE fenced block: `Open in: <its root, absolute>`, then `Task card: <this card's absolute path> - section '<heading>'`, then the section's text. Editing an EXISTING repo doc where it lives (`README.md`, an established ADR home) needs no ask.
- **This install's root: `__DOCS_ROOT__`** - always `<data root>/docs`, where `<data root>` is `ALFRED_CODE_DATA_PATH` (default `.alfred`), which holds the docs, the servers' data and the hooks' `state/` and `statistics/`. `<docs-path>/<name>`, or the legacy `docs/<name>`, means this root.
- Moving it is `/alfred-code:configure`'s data-root question; a hand edit to `ALFRED_CODE_DATA_PATH` moves the docs at the next `/alfred-code:update`.
- The hooks' ledgers (`<data root>/statistics/`, and the session history in `<data root>/state/history/`) are the only record of what ran and what the guards denied, and the rest of `<data root>/state/` is live per-session state: a cleanup keeps them, or its ask names that loss - never 'regenerable'.
- Search the root with `docs.js` or `/usr/bin/grep -r`, never a bare `grep -r`: the Bash tool's `grep` honours `.gitignore`, and a machine-local root ignores itself, so the search returns nothing, silently.
- Every capture doc opens with `Captured: <branch>@<short-sha>, <date>` (`+dirty` = uncommitted work) - the preferences docs with `Updated: <date>`, as they record the user's words, not the code - and follows the checked-out branch (`docs.js status` says how): a foreign-branch or `+dirty` stamp is approximate - verify against the code. Nothing re-captures automatically; a flow suggests a capture at close only when its output is missing or no longer matches this run's change, never the capture that just ran.

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
