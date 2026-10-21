# What each release changed for an install - read through `release-notes.js`, never whole

`/alfred-code:update` prints only the sections THIS install owes - those for the releases between its stamp's
version and the snapshot - with `node "$TMP/repo/scripts/install/release-notes.js" --root .` (step 2), so a run
carries none of the releases its install already passed. Report what a printed section says alongside the
installer's own lines for it. A heading names its release: `## in <version>` is owed below that version,
`## after <version>` at or below it (the next release carries it), and the `## table` section prints only with
`--table`. A new section goes at the end of its release's group, under one of those two forms.

## in 2.0.0 - the project-* skills and the diagnosers take grouped names

The `project-*` skills and the two failure diagnosers take grouped `alfred-*`
names. Update carries every pick, seat deny, `skillOverrides` value and selection line across and
prunes the old copies, printing one `renamed: <kind> <old> -> <new>` line each - report them. The
docs they write keep their paths (`<docs-path>/architecture/`, `code-style/`, `test-coverage/`,
`related-projects/`, `quality/`, `loops/`).

## in 2.1.0 - three more habits-* names; the plugin authoring skill leaves the catalog

Three more skills took `habits-*` names (the last skill rows of the table below); the plugin
authoring skill left the shipped catalog, and a retired copy git tracks in a project is kept and named, never pruned.

## in 2.1.6 - the rules drop baseline- for alfred-

The seven shipped rules and the generated ones lost their `baseline-` prefix for
`alfred-` (`baseline-git.md` -> `alfred-git.md`, `baseline-project-related-context.md` ->
`alfred-related-context.md`). Update prunes each old library copy (`rule pruned (retired
upstream)`), writes the new one, and MOVES each generated file with its content kept (`moved: rule ...`) -
their captures do not re-run by themselves. Report both kinds of line; a `!!` line means the old and the new
generated file both exist, and the old one is the user's to remove.

## in 2.2.0 - skills and diagnoser seats drop alfred-, the locked servers take it

The library skills and the two diagnoser seats drop the `alfred-` prefix and keep
their family (`/alfred-<family>-<name>` -> `/<family>-<name>`, the same for a seat; the table below gives each
old name its current one); the rules keep it. The three locked MCP servers take it (`navigation` -> `alfred-navigation`, `documentation` ->
`alfred-documentation`, `memory` -> `alfred-memory`): each plugin is installed under its new id before the old one
goes, and on the copy route each `.mcp.json` key is re-keyed with its memory database kept. Update carries every
pick, seat deny, `skillOverrides` value and instruction file across, prunes each old copy (`skill pruned (retired
upstream)`) - a copy edited since the stack wrote it is kept and named, the user's to merge - and prints one
`renamed:` line each. An optional item (a browser engine, a desktop server, mobile-control, an LSP, claude-hud) stays at the scope
it is installed at; only configure moves it. Report the `renamed:`, `pruned` and `!!` lines.

## in 2.4.0 - the generated rules take awareness names; the control servers are renamed

The generated rules take their awareness names - `alfred-project-architecture.md` ->
`alfred-architecture.md`, `alfred-project-related-context.md` -> `alfred-related-context.md`,
`alfred-project-agent-capabilities.md` -> `alfred-agent-awareness.md`, `alfred-project-run-book.md` ->
`alfred-project-awareness.md` - each MOVED with its content kept.
The desktop servers are `windows-control` and
`macos-control` (were `windows-desktop` / `macos-desktop`): update swaps the plugin with its on/off kept, re-spells
their tools in the generated rules, and `ALFRED_CODE_WINDOWS_CONTROL_EXCLUDE` is the gate key - the old
`ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE` is still read while the new one is unset, with a line saying to rename it.
Each browser server is `<engine>-control` (was `browser-<engine>`): update swaps the plugin with its on/off kept,
and the profile moves from `.alfred/browser/<engine>` to `.alfred/<engine>-control` at that server's next start,
unasked - `.alfred/browser` goes once its last engine has moved.

## in 2.5.0 - the code-quality loop, one .gitignore, auto-mode, the tools skip the data root

The code-quality loop is `/loop-code-quality` (its row is in the table below): update
carries its pick and `skillOverrides` value, prunes the old copy and prints its `renamed: skill` line.
The architecture assessment is `<docs-path>/quality/ARCHITECTURE-ASSESSMENT.md`: update moves an existing
`quality/ASSESSMENT.md` there (`docs migration (architecture quality)`) and re-points a generated rule naming it.
`/loop-code-quality` now works a code-quality assessment by tier, with the `loops/`
prompts as its rules; `/loop-code-quality staged` is the stage-by-stage run a project may rely on.

**One `.gitignore`.** The data root's file carries every rule, the docs' included: update rewrites it and
removes the stack's own nested ones (`docs root: ... removed`, `gitignore: ... removed`) - the docs root's, `history/`'s,
the run book's and the project memory folder's - while each holds exactly the stack's text; a file the user edited is
kept and named, and serena's own `.alfred/serena/.gitignore` stays (serena writes it). A docs root outside the data root
keeps its own. Every install also writes the project's sensitive data, `.alfred/.sensitive-data`, when absent - one
comment line, no key (`sensitive data: ... written`); report the line.

**auto-mode.** `--auto-mode` as the first word after a `/task-*`, `/capture-*`, `/loop-*` or `/issue-*` command runs it unattended (each stop's Recommended
answer, nothing pushed, merged, deployed or sent out). `ALFRED_CODE_AUTO_COMPACT` (seeded `0`) chooses what a long session does at its
fresh-session trigger: `0` offers a fresh session as before, `1` compacts there instead - no fresh-session ask, and each
model's `modelSettings.<model>.autoCompactWindow` set in the project's own settings file, add-only (a top-level
`autoCompactWindow` the user set anywhere wins, and a model another settings file names is left alone). Configure
switches it; report the `autoCompactWindow per model` line when one prints.

**The project's tools skip the data root.** Prettier reads no nested `.gitignore`, so `prettier --check .`
walked `.alfred/` and the stack's copies in `.claude/`: every run now writes one marked block naming both (the data
root's path, and a folder the project's own lines already ignore left out) into `.prettierignore` - made where Prettier
is in use - and into an existing `.eslintignore`, `.stylelintignore` or `.markdownlintignore`. Report each
`tool ignores:` line; a block the user takes out stays out.

## after 2.5.0 - one awareness capture; --auto-mode is a flag

The three awareness captures are one, `/capture-awareness`, and their docs share one
domain, `<docs-path>/awareness/`: the run book moves there from `project-capabilities/PROJECT-CAPABILITIES.md` (or
`project-awareness/PROJECT-AWARENESS.md`) with its `watch.json` and branch versions, the section ids re-spelled; the
sibling doc from `related-projects/RELATED-PROJECTS.md` as `RELATED-PROJECTS-AWARENESS.md`; and the inventory rule's
body becomes `AGENTS-AWARENESS.md`. ONE generated rule, `alfred-awareness.md`, `@`-imports them, so every session
loads them at its start; it replaces `alfred-agent-awareness.md`, `alfred-project-awareness.md` and
`alfred-related-context.md`, each removed only while it still holds the capture's own text - one the user changed is
named and kept. Report the `docs migration (awareness)` and `awareness:` lines.

auto-mode starts with the flag `--auto-mode` as the first word after the command
(`/task-solve --auto-mode <the request>`); the bare `auto-mode` of 2.4.0-2.5.0 starts nothing now, and the run's
banner says so. `/capture-*` commands run in auto-mode too. Say both in the close - nothing on disk changes.

## in 2.8.0 - the folders move to state/, statistics/, work/ and quality/; /capture-preferences

Update moves an older project's folders onto the 2.8.0 layout, with no ask: `flow/` splits into
`<data root>/state/approvals/` and `state/sessions/`, `history/` goes to `state/history/`; `hook-blocks/`,
`tools-usage/`, `usage-report/` and `docs-log.jsonl` to `<data root>/statistics/` (machine-local, kept out of git);
`plans/`, `specs/`, `diagnoses/` and `cross-project-tasks/` - `related-context/`'s files with them - to
`<docs-path>/work/`; `test-coverage/` and `loops/` to `<docs-path>/quality/`; an empty `.branches/` goes. A tracked
doc moves as a git rename. Report every `layout:` line; each held shape leaves its own action (the close's LAYOUT
bullet): a file already at the new path is the live one, a kept `.branches/` holds live doc versions to prune first,
and raw session copies wait until the new folder is out of git.

The docs root is always `<data root>/docs`: `ALFRED_CODE_DOCS_PATH` is retired, and this update moves the stack's docs
from a root the stack wrote (or from the pre-2.0.0 `.claude/docs`) with no ask, then takes the key out of the settings.
A root the user set by hand is asked once, naming every folder that would move: they all move (recommended), or the
user marks the team's own, which stay. There is no keep - to put the docs elsewhere, change the data root. The project's own files there stay - report the `docs root: ... keeps` line; a `!!` docs-root line means nothing moved and names what
the user decides or clears first. The docs are no longer part of the data-move ask.

An approval belongs to its plan: the stamp is `<data root>/state/approvals/<plan id>/APPROVAL`, and a brief names its
plan on a `plan:` line, so two sessions on two plans no longer share one approval.

`/capture-preferences` is new and always shipped, so this update adopts it: it records the user's code, architecture
and git preferences under `<docs-path>/preferences/` and generates `alfred-preferences.md`, which carries them inline
into every session and every seat it dispatches, ahead of every other source. A hand-off to a sibling repo now prints
the task card's absolute path. Say each in the close.

The navigation server moves to serena-agent 2.1.0 and the memory server to mcp-memory-service 12.1.1; the memories
need no migration, and both start on the new pin at the next session. The `typescript-lsp` plugin's language server is
now a prerequisite `/alfred-code:init` offers - `typescript-language-server` with TypeScript 6, since TypeScript 7 ships
no `tsserver.js` - and `csharp-lsp`'s `csharp-ls` 0.28 needs the .NET 10 SDK. An empty `settings.json` is read as no
settings yet and written, never refused as bad JSON. Say the two plugin prerequisites in the close only where the
project picked that plugin.

## table - every renamed command, was -> now

The installer's `renamed:` lines name each rename this install carried; this table is the whole list, for a user
who asks about a name the log did not print.

| was | now |
|---|---|
| `/project-solve-task` | `/task-solve` |
| `/project-solve-cross-task` | `/task-solve-cross` |
| `/project-build-from-scratch` | `/task-build-from-scratch` |
| `/project-solution-design` | `/task-design` |
| `/project-implementer` | `/task-implement` |
| `/project-verify-plan` | `/task-verify-plan` |
| `/project-verify-code` | `/task-verify-code` |
| `/project-version-upgrade` | `/task-version-upgrade` |
| `/project-diagnose-failure` | `/issue-diagnoser` |
| `/project-ci-failure-signatures` | `/issue-signatures-ci` |
| `/project-runtime-failure-signatures` | `/issue-signatures-runtime` |
| `/project-architecture-analyzer` | `/capture-architecture` |
| `/project-architecture-quality-analyzer` | `/capture-architecture-quality` |
| `/project-code-style-analyzer` | `/capture-project-code-style` |
| `/project-test-coverage-analyzer` | `/capture-test-coverage` |
| `/project-related-context` | `/capture-awareness` |
| `/project-agent-capabilities` | `/capture-awareness` |
| `/project-stack-usage-analyzer` | `/capture-usage-report` |
| `/project-first-look` | `/capture-first-look` |
| `/project-quality-loop` | `/loop-code-quality` |
| `/project-architecture-quality-loop` | `/loop-architecture-quality` |
| `/project-test-coverage-loop` | `/loop-test-coverage` |
| `/project-commit-checkpoint` | `/habits-commit-checkpoint` |
| `/alfred-capture-claude-md` | `/habits-adjust-agents-md` |
| `/alfred-habits-adjust-claude-md` | `/habits-adjust-agents-md` |
| `/alfred-capture-stack-usage` | `/capture-usage-report` |
| `/create-ticket` | `/habits-create-ticket` |
| `/explain-code-tutor` | `/habits-explain-code` |
| seat `ci-failure-diagnoser` | seat `issue-diagnoser-ci` |
| seat `runtime-failure-diagnoser` | seat `issue-diagnoser-runtime` |
| `/capture-agent-capabilities` | `/capture-awareness` |
| `/capture-project-capabilities` | `/capture-awareness` |
| `/alfred-capture-agent-capabilities` | `/capture-awareness` |
| `/alfred-capture-architecture` | `/capture-architecture` |
| `/alfred-capture-architecture-quality` | `/capture-architecture-quality` |
| `/alfred-capture-code-quality` | `/capture-code-quality` |
| `/alfred-capture-code-style` | `/capture-project-code-style` |
| `/capture-code-style` | `/capture-project-code-style` |
| `/alfred-capture-first-look` | `/capture-first-look` |
| `/alfred-capture-project-capabilities` | `/capture-awareness` |
| `/alfred-capture-related-projects` | `/capture-awareness` |
| `/alfred-capture-test-coverage` | `/capture-test-coverage` |
| `/alfred-capture-usage-report` | `/capture-usage-report` |
| `/alfred-habits-adjust-agents-md` | `/habits-adjust-agents-md` |
| `/alfred-habits-clarify` | `/habits-clarify` |
| `/alfred-habits-code-comments` | `/habits-code-comments` |
| `/alfred-habits-commit-checkpoint` | `/habits-commit-checkpoint` |
| `/alfred-habits-create-ticket` | `/habits-create-ticket` |
| `/alfred-habits-done-gate` | `/habits-done-gate` |
| `/alfred-habits-execution-strategy` | `/habits-execution-strategy` |
| `/alfred-habits-explain-code` | `/habits-explain-code` |
| `/alfred-habits-plan-writing` | `/habits-plan-writing` |
| `/alfred-habits-root-cause` | `/habits-root-cause` |
| `/alfred-habits-skill-writing` | `/habits-skill-writing` |
| `/alfred-habits-test-first` | `/habits-test-first` |
| `/alfred-issue-diagnoser` | `/issue-diagnoser` |
| `/alfred-issue-signatures-ci` | `/issue-signatures-ci` |
| `/alfred-issue-signatures-runtime` | `/issue-signatures-runtime` |
| `/alfred-loop-architecture-quality` | `/loop-architecture-quality` |
| `/alfred-loop-quality` | `/loop-code-quality` |
| `/alfred-loop-test-coverage` | `/loop-test-coverage` |
| `/alfred-task-build-from-scratch` | `/task-build-from-scratch` |
| `/alfred-task-design` | `/task-design` |
| `/alfred-task-implement` | `/task-implement` |
| `/alfred-task-solve` | `/task-solve` |
| `/alfred-task-solve-cross` | `/task-solve-cross` |
| `/alfred-task-verify-code` | `/task-verify-code` |
| `/alfred-task-verify-plan` | `/task-verify-plan` |
| `/alfred-task-version-upgrade` | `/task-version-upgrade` |
| `/loop-quality` | `/loop-code-quality` |
| `/capture-agent-awareness` | `/capture-awareness` |
| `/capture-project-awareness` | `/capture-awareness` |
| `/capture-related-projects` | `/capture-awareness` |
| seat `alfred-issue-diagnoser-ci` | seat `issue-diagnoser-ci` |
| seat `alfred-issue-diagnoser-runtime` | seat `issue-diagnoser-runtime` |
