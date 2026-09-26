---
description: House baseline - the generated-docs root. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Generated docs root

- EVERY doc file the assistant creates lives under ONE root, each capture in its own domain
  folder: the architecture map (`architecture/`), the code-style capture (`code-style/CODE-STYLE.md`),
  ADRs with no existing home (`decisions/`), the related-projects orientation doc
  (`related-projects/RELATED-PROJECTS.md`), the quality-loop prompts (`loops/`), the coverage capture
  (`test-coverage/`), the usage-audit bundles (`alfred-code-usage-report/`), implementation plans and
  design specs (`superpowers/plans/`, `superpowers/specs/`, whatever wrote them),
  the instrumentation ledgers (`tools-usage/`), and the task cards handed to another repo
  (`cross-project-tasks/`). Two folders hold no domain, by design: `quality/ASSESSMENT.md` and `quality/CODE-ASSESSMENT.md` are
  recomputed fresh every run rather than versioned (no `watch.json`, so the engine never sections or
  asks about them), and `related-context/` is a plain drop box for every OTHER sibling-repo doc - a
  cross-repo plan, a change request, an issue note, a run recipe - filed there by any session that
  produces one, with no `watch.json` either. Anything else generated lands under this root too. A doc
  outside it - or outside its own domain's folder - is invisible to every capture, status and prune
  step that reads `<docs-path>`, and to the next session.
- Creating a doc OUTSIDE this root - a committed `docs/`, the repo root - happens only on the
  user's asked-first approval of that exact location, through AskUserQuestion; never silently,
  however conventional the spot looks. A sibling repo is never
  written from this session unless the user allows it in the cross-project write guard's own
  ask - its `<docs-path>/flow/CROSS-WRITE-ALLOW` receipt, this session only; by default a doc
  about it lives in `related-context/`, a change it must make is a task card in
  `cross-project-tasks/`. Editing an EXISTING first-class repo doc where it already lives (the top-level
  `README.md`, an established ADR home) is not a generated doc and needs no ask.
- **This install's root: `__DOCS_ROOT__`** - stamped by every install, update and configure run from
  the `ALFRED_CODE_DOCS_PATH` env value in `.claude/settings.json`; absent = `.alfred/docs`, outside
  `.claude/` because Claude Code prompts for every write there and no allow rule lifts it. Edited
  by hand since the last run, the env value wins. Wherever an instruction names a doc as
  `<docs-path>/<name>` - or as legacy shorthand `docs/<name>` - it means this root.
- To move the docs, change that env value and nothing else - forward slashes on every OS. Existing
  docs do not move with it: they stay under the old root until moved by hand or re-captured.
- Reading a capture doc: every one opens with `Captured: <branch>@<short-sha>, <date>` (`+dirty` =
  the tree held uncommitted work), and every capture's docs follow the checked-out branch through the docs hook
  (`docs.js status` says how), so the stamp says which code the doc describes. A foreign-branch stamp, or `+dirty`, means approximate at best -
  verify against the code before relying on it, never as ground truth for HEAD. Nothing re-captures
  automatically: a flow SUGGESTS a capture at close only when that capture's output is missing or no
  longer reflects what the run changed - never as a default next step, and never the capture that
  just ran. The user decides, and how a doc is refreshed is the owning capture skill's own contract.

<!-- Operator note: the root carries its own .gitignore, written by the installer from
     ALFRED_CODE_DOCS_VERSIONING: under `local` the whole root stays out of git (nothing survives a
     fresh clone, so the captures are re-run after a re-clone); under `git` the docs are committed and
     only the hooks' machine state (flow/, hook-blocks/, history/, tools-usage/) stays out. A committed
     root shares the generated docs with the team; then track <docs-path>/superpowers/ too.
     Configuration, not model behaviour, so it is not injected - the
     installer's next-steps say the same thing at install time. -->

<!-- Maintainer note: the env value is read as process.env.ALFRED_CODE_DOCS_PATH by the hooks and
     the installer; both also read the pre-0.2.43
     CLAUDE_DOCS_PATH spelling as a fallback, and an install/update renames the key in place. That
     history changed no model behaviour, so it is not injected - meta/shared-rules.json's
     docs-root-resolution entry is where the fallback is recorded. -->
