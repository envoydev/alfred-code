---
description: House baseline - the generated-docs root. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Generated docs root

- EVERY doc the assistant creates lives under ONE root, each capture in its own domain folder: `architecture/`, `code-style/CODE-STYLE.md`, ADRs with no home (`decisions/`), `related-projects/RELATED-PROJECTS.md`, the run book (`project-capabilities/PROJECT-CAPABILITIES.md`), `loops/`, `test-coverage/`, `usage-report/`, diagnosis findings (`diagnoses/`), plans and specs (`plans/`, `specs/`), `tools-usage/`, and task cards for another repo (`cross-project-tasks/`). `quality/ASSESSMENT.md` and `quality/CODE-ASSESSMENT.md` are recomputed every run (no `watch.json`), and `related-context/` is a plain drop box for any other sibling-repo doc. A doc outside the root, or outside its domain folder, is invisible to every capture, status and prune step and to the next session.
- Creating a doc OUTSIDE this root (a committed `docs/`, the repo root) happens only on the user's asked-first approval of that exact location, through AskUserQuestion. A sibling repo is written only when the user allows it in the cross-project write guard's ask - its `<docs-path>/flow/CROSS-WRITE-ALLOW` receipt, this session only; by default a doc about it lives in `related-context/`, a change it must make is a task card in `cross-project-tasks/`. Editing an EXISTING repo doc where it lives (`README.md`, an established ADR home) needs no ask.
- **This install's root: `__DOCS_ROOT__`** - the `ALFRED_CODE_DOCS_PATH` env value, `.claude/settings.local.json` over `.claude/settings.json`; absent = `.alfred/docs`. Where the settings differ from this line, the settings win. `<docs-path>/<name>`, or the legacy `docs/<name>`, means this root; `<data root>` is `ALFRED_CODE_DATA_PATH` (default `.alfred`), which holds the docs and the servers' data.
- Moving them is `/alfred-code:configure`'s data-root question; a hand edit to either value moves nothing - existing docs stay put until moved or re-captured.
- Every capture doc opens with `Captured: <branch>@<short-sha>, <date>` (`+dirty` = uncommitted work) and follows the checked-out branch (`docs.js status` says how): a foreign-branch or `+dirty` stamp is approximate - verify against the code. Nothing re-captures automatically; a flow suggests a capture at close only when its output is missing or no longer matches this run's change, never the capture that just ran.

<!-- Operator note: the root carries its own .gitignore, written by the installer from
     ALFRED_CODE_DOCS_VERSIONING: under `local` the whole root stays out of git (nothing survives a
     fresh clone, so the captures are re-run after a re-clone); under `git` the docs are committed and
     only the hooks' machine state (flow/, hook-blocks/, history/, tools-usage/) stays out. A committed
     root shares the generated docs with the team; its plans/ and specs/ are committed with it.
     Configuration, not model behaviour, so it is not injected - the
     installer's next-steps say the same thing at install time. -->

<!-- Maintainer note: the env value is read as process.env.ALFRED_CODE_DOCS_PATH by the hooks and
     the installer; both also read the pre-0.2.43
     CLAUDE_DOCS_PATH spelling as a fallback, and an install/update renames the key in place. That
     history changed no model behaviour, so it is not injected - meta/shared-rules.json's
     docs-root-resolution entry is where the fallback is recorded. -->
