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

## in 2.9.0 - the code style joins the preferences docs; a personal doc; the fresh-session trigger follows the model

Update moves the code style into the preferences docs, with no ask: `code-style/CODE-STYLE.md` becomes
`<docs-path>/preferences/PROJECT-CODE-PREFERENCES.md`, `CODE-PREFERENCES.md` becomes `PERSONAL-CODE-PREFERENCES.md`,
their section ids and `watch.json` entries are re-spelled, and `code-style/` goes once empty. The code-style capture is
`/capture-project-code-style` now (the table below). The generated `project-code-style.md` goes when it holds the capture's text; one the user
wrote is kept and named. A doc already at the new path wins: the old one stays where it is, named, for the user to merge.
Report every `docs migration (preferences)`, `renamed:` and `!!` line.

`alfred-git.md` and the generated `alfred-preferences.md` give way to a shipped `alfred-preferences.md` that names each
preferences doc and when to read it, nothing inlined. The install seeds `GIT-PREFERENCES.md` from the former git rule,
its consent, scope, checkpoint and safety entries locked: a git doc the user already has keeps its entries and gains the
locked ones it lacks, and an edited locked entry is restored from the seed, the replaced text logged. Report the
`preferences:` line.

`/capture-preferences` also writes `PERSONAL-PREFERENCES.md` now - how the user wants the assistant to work. A new hook
pushes it into every main session's start, again after each compaction, and hands the other preferences docs over at an
actor's first edit and first git write. Under git versioning the two personal docs stay out of git. The hook takes effect
from the next session - name the restart.

The env switches fold into `ALFRED_CODE_HOOKS_OFF`: a `0` for `ALFRED_CODE_PUSH_GATE`, `ALFRED_CODE_DOCS_GATE` and the
like becomes a `<hook>:<part>` entry, a `1` is dropped, and `ALFRED_CODE_CONFIG_PROTECT` goes. A stack-seeded
`ALFRED_CODE_HISTORY` of 1 becomes 3 (the sessions read back; 0 is off, at most 10). The fresh-session trigger follows the
session model's capacity tier, and `ALFRED_CODE_CONTEXT_WINDOW_DEFAULT` is the trigger of a session with no tier (seeded
180000): the old 300000 seed moves, and where the three tiers are already 0 the DEFAULT is set to 0 too, so all four at 0
stays the off switch. Say the env changes in the close.

## after 2.9.0 - the git doc keeps only the crucial lines

The seeded `GIT-PREFERENCES.md` keeps only the crucial git lines, each locked: ask before any commit or push, run the
commit checkpoint first, never lose work (no discard or history rewrite without asking, `--force-with-lease` only), no AI
attribution, and never bypass a check (`--no-verify` and the like). Update removes each entry an earlier seed wrote and
this one dropped - the commit scope, branch names, pull request size and the commit message shape with its `Critical:`
line - while it is still as seeded, its id joining `Retired:`; it locks the attribution entry in place, moves the safety
entry to the new text and adds the bypass entry. An entry the user changed stays theirs, and a changed scope entry loses
its lock, named with `!!`. Report the `preferences:` lines; branch, pull request and commit-message rules are the user's
to add through `/capture-preferences`.

## after 2.9.0 - AGENTS.md lists no rules

The AGENTS.md template has no `## Rules` section now: every file in `.claude/rules/` loads itself, so the list only
repeated them in every session. Update refreshes a seed nobody filled from the new template. In a filled file the
AGENTS.md check names the old list as a `stack-rules` row, and the improve step offers its removal like any other
change, shown first - the project's own lines under that heading stay.

## after 2.9.0 - the instruction file can be CLAUDE.md

Init's install and `/alfred-code:configure` (step 12) now ask which name the project's instruction file carries -
AGENTS.md or CLAUDE.md - beside the place ask (root or `.claude/`). The seed, the fill, its check and each part's own
file follow the answer, and the stamp keeps it. A switch renames the root, `.claude/` and part files with `git mv`, since
Claude Code reads no AGENTS.md at all while a CLAUDE.md sits at or above the working directory. The first update asks
the name once, since an install from 2.9.0 or earlier never answered it - 'Rename to AGENTS.md' recommended where the
file is still `.claude/CLAUDE.md`, as before, and 'Keep CLAUDE.md' where a root CLAUDE.md sits, which no update renamed -
and CLAUDE.md is recorded unasked beside a CLAUDE.local.md, which keeps any AGENTS.md unread, while no name was answered.
An AGENTS.md answer there is never written over: the update asks to keep CLAUDE.md, or to keep the answer and rename
nothing. The old 'rename .claude/CLAUDE.md' ask and its `--rename-claude-md` flag are gone: the name ask does both.

## after 2.9.0 - the code and architecture preferences have no size cap

`PERSONAL-CODE-PREFERENCES.md` and `ARCHITECTURE-PREFERENCES.md` lose their shared 5,000-char cap: the first edit's hold
hands each entry over where its `Scope:` reaches, without its `Check:` line, and what does not fit one denial comes with
the retry; a seat that judges without an edit tool - a solution designer, a verifier, the code-quality analyzer, the
security auditor, the integration reviewer - is handed them at its start and what one room cannot hold with its first reads (a Read, a Grep, an LSP call, a symbol lookup or a shell `cat` / `grep` of a file); the architecture analyzer is handed the architecture doc alone, and only inside an architecture quality run, never the map capture's; a review run of the main session - `/review-code`, `/review-security`, Claude Code's built-in reviews when the user types one, a quality capture or loop - is handed the code docs first, typed or called; a run ends at the user's next typed message other than a go-on reply such as continue. A copied seat counts by the install stamp's record, so a project's own agent of the same name is handed nothing. `preferences.js lint` prints a `note:` line past 5,000 together instead of a problem, and fails only one entry
past 5,000. Nothing changes on disk; an entry cut earlier to fit can be written in full again through
`/capture-preferences`. The git doc keeps its 5,000 and the personal doc its 3,000. Since a `Scope:` glob now decides
which edits see an entry, every update names one that reaches no file in the project (`!! preferences: ... reaches no
file`) - report each; a typo is fixed through `/capture-preferences`, a glob for files still to come stays. `preferences.js reach`
shows what each entry's `Scope:` takes (a count, the file types, a few paths), so one aimed at the wrong existing folder
shows, `/capture-preferences` asks you to confirm each new glob's reach, and `lint` and every update name a `Check:` that measures files its `Scope:` does not reach (`!! preferences: ... Check: reaches N files its Scope: does not`) - report each; it is fixed through `/capture-preferences`.

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
| `/project-architecture-quality-analyzer` | `/capture-quality` |
| `/project-code-style-analyzer` | `/capture-project-code-style` |
| `/project-test-coverage-analyzer` | `/capture-quality` |
| `/project-related-context` | `/capture-awareness` |
| `/project-agent-capabilities` | `/capture-awareness` |
| `/project-stack-usage-analyzer` | `/capture-usage-report` |
| `/project-first-look` | `/capture-first-look` |
| `/project-quality-loop` | `/loop-code-quality` |
| `/project-architecture-quality-loop` | `/loop-architecture-quality` |
| `/project-test-coverage-loop` | `/loop-test-coverage-quality` |
| `/project-commit-checkpoint` | `/habits-commit-checkpoint` |
| `/alfred-capture-claude-md` | `/habits-adjust-agents-md` |
| `/alfred-habits-adjust-claude-md` | `/habits-adjust-agents-md` |
| `/alfred-capture-stack-usage` | `/capture-usage-report` |
| `/create-ticket` | `/habits-create-ticket` |
| `/explain-code-tutor` | `/habits-explain-topic` |
| seat `ci-failure-diagnoser` | seat `issue-diagnoser-ci` |
| seat `runtime-failure-diagnoser` | seat `issue-diagnoser-runtime` |
| `/capture-agent-capabilities` | `/capture-awareness` |
| `/capture-project-capabilities` | `/capture-awareness` |
| `/alfred-capture-agent-capabilities` | `/capture-awareness` |
| `/alfred-capture-architecture` | `/capture-architecture` |
| `/alfred-capture-architecture-quality` | `/capture-quality` |
| `/alfred-capture-code-quality` | `/capture-quality` |
| `/alfred-capture-code-style` | `/capture-project-code-style` |
| `/capture-code-style` | `/capture-project-code-style` |
| `/alfred-capture-first-look` | `/capture-first-look` |
| `/alfred-capture-project-capabilities` | `/capture-awareness` |
| `/alfred-capture-related-projects` | `/capture-awareness` |
| `/alfred-capture-test-coverage` | `/capture-quality` |
| `/alfred-capture-usage-report` | `/capture-usage-report` |
| `/alfred-habits-adjust-agents-md` | `/habits-adjust-agents-md` |
| `/alfred-habits-clarify` | `/habits-clarify` |
| `/alfred-habits-code-comments` | `/habits-code-comments` |
| `/alfred-habits-commit-checkpoint` | `/habits-commit-checkpoint` |
| `/alfred-habits-create-ticket` | `/habits-create-ticket` |
| `/alfred-habits-done-gate` | `/habits-done-gate` |
| `/alfred-habits-execution-strategy` | `/habits-execution-strategy` |
| `/alfred-habits-explain-code` | `/habits-explain-topic` |
| `/alfred-habits-plan-writing` | `/habits-plan-writing` |
| `/alfred-habits-root-cause` | `/habits-root-cause` |
| `/alfred-habits-test-first` | `/habits-test-first` |
| `/alfred-issue-diagnoser` | `/issue-diagnoser` |
| `/alfred-issue-signatures-ci` | `/issue-signatures-ci` |
| `/alfred-issue-signatures-runtime` | `/issue-signatures-runtime` |
| `/alfred-loop-architecture-quality` | `/loop-architecture-quality` |
| `/alfred-loop-quality` | `/loop-code-quality` |
| `/alfred-loop-test-coverage` | `/loop-test-coverage-quality` |
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
| `/habits-explain-code` | `/habits-explain-topic` |
| `/task-auto` | `/mode-auto-run` |
| `/habits-output-scorer` | `/mode-output-scorer` |

## after 2.9.0 - the stack's own code and security reviews

Two skills join the always-installed set: `/review-code` (a change set, branch, PR or path - eight passes, a refute
pass, one ranked table) and `/review-security` (the project's own helpers first, a taint trace, confidence bands - 8-10
a finding, 5-7 a lead - and a refute pass against its not-a-finding list). The commit checkpoint runs them -
`task-verify-code` for a planned build, else `review-code`; `review-security` is its security half, the verdict the
receipt's `security:` line - and the commit guard counts both as the review. The model's call to Claude Code's built-in
`code-review` / `security-review` is denied with a pointer to ours once this update has copied them (until then, or with
ours switched off in `skillOverrides`, the built-in still runs); a project skill of that name passes, and
`guard-fresh-session-start:builtin-review` in `ALFRED_CODE_HOOKS_OFF` switches the denial off. Typing a built-in review
yourself still works. A commit receipt whose `VERIFIED` line names a review now needs a run of that review in the
session that reached its result line - `Findings:` (a loop's `Outcome:`), in the answer or in the report of an agent it
dispatched - so a launched, refused or abandoned review, or another skill's load, no longer passes for one, and the
tool-usage log is no evidence. A commit `VERIFIED` line that names no review needs some review of the code in the
session (a review skill or a verifier or reviewer agent), unless the review is `carried:` or you waived it - a
formatting-only sweep above the trivial bar included, since spacing inside a string or between two shell words is code.
That review must have started after the last edit to every committed file: a fix made after it gets a short
`review-code` over the fixed files first. A file rewritten since with its bytes unchanged (a stash and pop) still
passes: the review records what each changed file held when it started, and a staged copy must match it too - a
formatter's spacing is a change. A review pointed at files or folders covers those alone, and a verifier or reviewer
agent covers what its brief names - `git diff HEAD` in the brief for the whole change; the rest still need a review that
read them. An agent counts once it has reported - one still running, or in the background, does not.

## after 2.9.0 - explain any topic

The code explainer is `habits-explain-topic` now (the rename table above names its old name). A depth ask still
fires it - 'teach me', 'ELI5', 'in detail', 'step by step', 'walk me through', and 'teach me' and 'ELI5' now lift the
answer budget too; a bare 'explain X' or 'what is X' stays a short answer. This project's code keeps the real-file walkthrough; any other topic gets a layered
answer - the short answer, an analogy and where it breaks, steps, a worked example, the common mix-ups, a recap,
check-yourself questions and a glossary - and, when the topic has a shape, one offline HTML diagram under
`<docs root>/tutorial/`. Update carries a pick and a `skillOverrides` key to the new name and prunes the old copy.

## after 2.9.0 - skill writing leaves the stack

The skill-writing habit and its `skill-authoring.md` rule no longer ship: they serve authoring the stack itself, which
happens in its own repo, and a project that writes skills of its own keeps nothing from them but the cost of a listed
description. Update prunes both copies as retired upstream; a copy edited since the stack wrote it stays
and is named, to merge what you need and remove by hand. Report those lines.

## after 2.9.0 - uninstall asks before deleting the instruction file

`/alfred-code:uninstall` asks before it deletes the AGENTS.md or CLAUDE.md the stack seeded, and only while that file is
still exactly as the stack wrote it - an edited one is kept unasked, as before. 'Delete it' is recommended, since an
unedited seed only describes the tools the uninstall removes. Run without the command, the installer keeps it and names
`--instructions-seed remove`. Nothing changes for an update.

## after 2.10.0 - the tools start line, /capture-preferences tools and its refresh

Every session and seat start carries a tool order now: for each job (navigation, library docs, memory, the browser) the
tools to use first, from the stack's defaults or from `preferences/TOOLS-PREFERENCES.md` once `/capture-preferences tools`
ranks them. The defaults are `LSP` and `Grep` for navigation and `WebFetch` for library docs, with a known server type
ranked first where this machine registers one (serena, context7, memory-service - the record's add-back lines below
register each); a type it does not register is left out unnamed. An update from v2.10.0 writes no doc and takes no
inventory, so the order is the stack's defaults until the capture runs.
Every update after a capture refreshes its inventory (`<data root>/state/tools-inventory.json`): a known type at its pin
is re-read from the table and never started, a registration whose launch changed is listed again
(at most a minute), and one that is gone leaves. Report every `tools:` and `!! tools:` line; a `!!` line names a server
that could not be re-listed or a ranked tool that is gone, and `/capture-preferences tools` settles both.

## after 2.10.0 - the stack ships no MCP server

No skill, seat, rule or hook depends on an MCP server now. The session-start tool order's defaults are the `LSP` tool
and a scoped grep for navigation and the vendor's own page (`WebFetch`) for library docs; the seats' handoff notes
are files under `<data root>/state/handoff/`, and lessons go into Claude Code's own memory.
The first update onto 2.10.1 or later takes out what an earlier release's servers left - their plugins at this run's scope, the stack's registrations, the memory tool denies, `alfred-memory.md` and the memory
hook - and prints ONE `mcp servers:` block: what it removed, where each server is recorded as it shipped
(`stack/mcp/original-mcps.json`), and one `add it back:` line per server, which registers the upstream server under its
original name. A registration changed since the stack wrote it is the user's and stays (`mcp <name>: kept`). The
servers' data stays where it was (the `mcp data:` line) - the stack no longer reads it, but a server added back does,
and so may another project still on an older release. Where the stack had switched Claude Code's own memory off, the
update switches it back on; a switch-off the user set stays. Report the block verbatim, and put the add-back lines on
the card as the user's to run - only when they want that server again.

## after 2.10.1 - grade before release: the output scorer

A designer's plan file, a diagnoser's root-cause verdict and an inline plan can be graded by a fresh, read-only
`output-scorer` seat before they are released (the `mode-output-scorer` skill, always installed). It is OFF by
default: `ALFRED_CODE_SCORER=1` turns it on, `ALFRED_CODE_SCORER_LEVEL` sets the pass mark (60-100, default 80),
`ALFRED_CODE_SCORER_ROUNDS` the grades per attempt (1-10, default 3) and `ALFRED_CODE_SCORER_OUTPUTS` narrows the three
outputs (a csv; empty means all three). `--mode-output-scorer-on` / `--mode-output-scorer-off` right after a flow command switch it for the session (the modes section below). A typed
stack - `/habits-explain-topic /mode-output-scorer <request>` - grades that one request's output even while it is off,
an explainer answer, a ticket, an upgrade plan or a pick included. An output that cannot reach the level is withheld and
the user decides: answer the open decisions, accept it marked, one more revision, or keep it withheld.
`guard-answer:scorer` or `guard-stop-contract:scorer` in `ALFRED_CODE_HOOKS_OFF` switches the whole scorer off. Update
seeds the four keys absent-only, so a value the project set stays; report the seeded lines.

## after 2.10.1 - .sensitive-data becomes .secrets

The project's secrets file is `<data root>/.secrets` now (`.alfred/.secrets` by default); `.sensitive-data` was its
name. Every 2.x release reads both, `.secrets` first, and the shipped deny carries `Read(.secrets)` beside
`Read(.sensitive-data)`. The rename takes two updates, so a session opened before it never loses the file mid-run: the
first update beside an old file records `secrets: dual` in the stamp, writes no `.secrets` and prints
`sensitive: .sensitive-data becomes .secrets at the next update` - only once the core plugin reads back at this release
or later (or the hooks are copies), else it prints `sensitive: .sensitive-data stays - the core plugin reads back at
<version>, ...` and records nothing, since an older guard knows only the old name; the next update, from another session, renames the
file (its bytes unchanged), re-points the run book's path and prints `sensitive: renamed .sensitive-data -> .secrets -
restart any session opened before this update`. Report that line and tell the user to restart those sessions. An `!!`
line - both files present, `.secrets` not a file, or a `.secrets` git would not ignore - keeps the old file: report it,
since the next update tries again only once the user has merged the two and deleted the old one, cleared the path or
ignored it. A project's own `.secrets` outside the data root is not touched. There is no way back by downgrading: an
older release reads only `.sensitive-data`, so a renamed file would sit unguarded under it - the way back is a forward
fix in a later release.
The guard judges the store behind a computed prefix too - a print through `"$(pwd)/..."` or `"$(git rev-parse
--show-toplevel)/..."` is masked like the literal path's, `$R/...` and a script's own string are refused - and a `find`
that hands it to a reader, and its name or the data root in any letter case; a refusal there is the guard working - the
command that needs the values runs through `--with-sensitive`. `cat "$(pwd)/.env"` is the dotenv it names, masked too.

## after 2.10.1 - capture-first-look leaves the stack

The provisional-map skill no longer ships: `/alfred-code:init` runs the architecture capture, which writes the real
map, and the scan behind the old skill stays - `node <stack>/scripts/scan-evidence.js --orientation --root .` prints
the same provisional `ORIENTATION.md` for a project with no capture yet. Update prunes an unchanged copy as retired
upstream; a copy edited since the stack wrote it stays and is named with `!!`, to merge what you need and remove by
hand. Report those lines.

## after 2.10.1 - a drafted ticket is also a file

`habits-create-ticket` also writes each ticket to `<docs root>/tickets/<slug>.md` (`.alfred/docs/tickets/` by default) -
the title, `Type:`, `Created:`, `Status: draft` (`filed <ID or URL>` once filed through the connector) and the
Description - and names the file on a `Saved:` line below the chat block. `tickets/` is a stack docs folder: it moves
with the data root, and in a hand-set docs root a team's own `tickets/` is named among the moves and stays only with
`--docs-root-leave tickets`. Update refreshes the skill copy; nothing else to report.

## after 2.10.1 - the explainer gains a child level and saves every walkthrough

`habits-explain-topic` has a child level now ('like I'm six': a short story in sentences of about 8-10 words, an
everyday name before every technical word). Every run saves two files under `<docs root>/explanations/`:
`<topic-slug>.<level>.md`, the walkthrough as sent, and `<topic-slug>.<level>.html`, an offline page with the
steps, the diagram when the topic has a shape and Check yourself as questions to click - no script, nothing loaded.
Update moves an older `<docs root>/tutorial/` there (a `layout:` line); a file already at its path under
`explanations/` stays where it was and is named. Report the layout line.

## after 2.10.1 - designers read the recorded weaknesses, and a design load is handed the preferences

A plan card's `traps:` names each recorded weakness in the files its slice touches (the assessment entry's title and
`path:line`), so the implementer meets it without reading the assessments. `task-design` orients on the related-projects
awareness doc for a sibling-repo seam, the ten designer seats name all four doc families, and a greenfield design
reads `PERSONAL-CODE-PREFERENCES.md` and `ARCHITECTURE-PREFERENCES.md` before drawing its options. A design run loaded
in the chat (`task-design`, `issue-diagnoser`, `task-build-from-scratch`) is handed the code preferences beside the
skill's text - nothing is held or asked. Update refreshes the skill copies; the core brings the seats and the hook.
Nothing to report.

## after 2.10.1 - the usage report grades the stack's claims

`capture-usage-report`'s skeleton gains a machine-written `## Conformance - expected vs observed` section: each claim
the stack makes (`meta/conformance.json` - navigation, scoring, preferences, awareness, questions, answers, flow,
decisions) and every graded skill step, counted applied, held, violated or not visible over the session, with the
transcript locators of each violation. The batch copies each session's history record, scorer folder and block ledger
into its bundle's `data/` and points the analyzer at the copy (`--data-root`), so a state claim still reads after the
scorer folder is swept; a session with none of the three prints those claims `not visible`, never held. The verdict
cites the rows and never recounts them. A `--from` / `--to` report grades the same window and says so in the section's
note, and task-solve's design steps are graded only for a run that stated `Size: standard`. Update refreshes the skill
copy; nothing else to report.

## after 2.10.1 - modes: four flags that last the session

Auto-run and the output scorer are modes now, each switched by a flag right after a `/task-*`, `/capture-*`,
`/loop-*`, `/issue-*` or `/mode-*` command, before the request: `--mode-auto-run-on`, `--mode-auto-run-off`,
`--mode-output-scorer-on` and `--mode-output-scorer-off`. `--auto-mode` is now `--mode-auto-run-on`. A mode once on
stays on for the rest of the session - every later typed flow command runs unattended too - until its `-off` flag; a
new session starts with both off. The old flag switches nothing: typed, it gets a one-line pointer to the new one and
that run is attended, so a flow skill copied before this update never runs unattended by it. `/mode-auto-run <request>`
turns auto-run on and runs the request start to finish; `/mode-auto-run --mode-auto-run-off` switches it off and runs
nothing. While a mode is on, each prompt shows `Modes ON: ...`. Update refreshes the flow skill copies; nothing else
to report.

## in 3.0.0 - the stack's values move to .variables; the workspace is on, with a role

Update together: every teammate on a project moves to 3.0.0 in the same sitting. The stack's values - every catalog key
but `ALFRED_CODE_DATA_PATH` and the guard key `ALFRED_CODE_HOOKS_OFF`, `ALFRED_CODE_SCORER_LEVEL`,
`ALFRED_CODE_DOCS_VERSIONING` and `ALFRED_CODE_MAXIMUM_RUN_AGENTS` among them - leave the settings `env` for
`<data root>/.variables`, and 2.12.0 or older reads none of them: a teammate who has not updated runs on the stack's
defaults until they do. The way back, for anyone who must stay on 2.12.0 a while, is the values copied into their
settings.json by hand.

The update moves each key out of `settings.json` into `.variables`, one `.variables env:` line per key, and keeps
`ALFRED_CODE_HOOKS_OFF` and `ALFRED_CODE_DATA_PATH` where they were. At project and user scope git tracks the file
(the data root's `.gitignore` gains `!/.variables`) - commit it with the update; at local scope it stays out of git,
and a key typed into `settings.local.json` still wins over it. Configure and validate write values through
`scripts/variables.js set`, and status shows each value with the file it came from.

The workspace is on by default: `ALFRED_CODE_WORKSPACE` unset now reads on, and only `0` turns it off. Each project
has a role - standalone, a root that projects below can join, or a child of the installed folder above - asked at
init, offered in configure's Environment area, and asked by an update only when the installed folders around the
project change. A child holds no copies of its parent's values or local MCP servers any more: the hooks read the
values through the chain, and the update prints one `mcp <name>:` line per parent's local-scope server the child
cannot see; a copy an earlier release made stays as your own registration. A parent's uninstall writes every value
each child read from it into the child's own `.variables` first, so nothing a child reads changes.

A project 2.12.0's init installed below an installed folder was registered as its child then (its `.alfred/workspace`
names a `parent`), and the switch kept the link idle. From 3.0.0 it is a live child with no new ask: every value it
held stays its own, the chain fills only the keys it never set, and each update brings the parent's later set changes.
To keep such a project apart, take configure's 'Leave and become standalone' (it keeps every value), or set
`ALFRED_CODE_WORKSPACE=0` with `scripts/variables.js set` in that project.

A child now reads what sits above it, read-only. Each session start names the workspace root's docs (`Workspace root
docs (read-only):`, the folders and their areas) and pushes the root's memory index (`Workspace root memory
(read-only):`, its first 60 lines inside the start's budget); a preference doc the child does not have is read from
the root's preferences folder after its own. The update adds the root's docs folder to the child's
`settings.local.json` `permissions.additionalDirectories` and an Edit deny over it and over every member's memory
folder, and the write guard refuses a write into a member's memory. `ignore docs root` or `ignore memory root` in the
child's workspace file takes either out; status prints the child's `docs:` and `memory:` lines.

A memory folder you choose with `autoMemoryDirectory` outside the account folder is now writable by the write guard -
when your account `settings.json` or the managed settings name it. The same setting in a project's `settings.json` or
`settings.local.json` opens nothing, since a repo can commit either file to name any folder: set a per-project folder in
the account settings or in `ALFRED_CODE_ALLOW_WRITE_OUTSIDE`, or memory saves there still stop at the guard's ask.

## after 3.0.0 - the memory folder in an untracked settings.local.json

The write guard now also opens the `autoMemoryDirectory` named in the `.claude/settings.local.json` Claude Code reads
for the project - the repository root's, the main checkout's in a linked worktree, the project folder's on Windows -
when that file is your own: git does not track it and `.claude` is a real folder, not a link or a nested repository.
A tracked or staged file, a sub-folder's own file, a project outside any git repository and the project's
`settings.json` still open nothing; the managed settings still outrank the local file, and a folder holding the
project or the home folder opens nothing.

## after 3.0.0 - the output scorer revises from its best round

When a revised draft scores lower than an earlier round and the scorer asks for one more revision, its `revise` line
now names the best round's draft and that round's findings to revise from, so the lower draft is not built on.

## after 3.1.0 - update asks whether the projects joined below update too

With projects joined below this one, `/alfred-code:update` now asks once whether they update too (recommended, as
before) or only this project. Where a child has questions of its own, the same question carries them. 'No, only this
project' changes nothing in the folders below: the close lists each one as `held`, and `/alfred-code:update` here
again, answering yes, updates them. Where the core plugin is installed for your whole account, it still moves for every
project, so a held one runs the new hooks and agents beside its older skill and rule copies - and may say its copies
are older than the stack - until it is updated. An unattended run updates them, as before.

## after 3.1.0 - the output scorer meets an unasked guard with a Decision

When a graded designer plan's finding would add a guard or rule the request did not ask for, the revision now keeps
today's behaviour as a Decision and puts the guard on one `## Optional` line, marked Recommended or Not worth it - a
card only when you asked for it or the request cannot be met safely without it.

## after 3.2.0 - a held child keeps its folder, not an account-wide core

'No, only this project' changes nothing in the folders below, but the core plugin moves wherever it is installed: where
it is installed for your whole account, a held project runs the new hooks and agents beside its older skill and rule
copies, and may say its copies are older than the stack, until `/alfred-code:update` runs there. The close now lists a
held child whose folder no longer holds an install as `gone-kept`, apart from the held count.

## after 3.2.1 - the three quality captures become capture-quality

The architecture assessment, the code assessment and the coverage capture are now the three parts of ONE skill,
`capture-quality`, and the coverage loop takes the `-quality` ending. Update carries every pick, `skillOverrides` value
and selection line across and prunes the old copies, one `renamed:` line each - report them.

| Before | Now |
|---|---|
| `/capture-architecture-quality` | `/capture-quality` |
| `/capture-code-quality` | `/capture-quality` |
| `/capture-test-coverage` | `/capture-quality` |
| `/loop-test-coverage` | `/loop-test-coverage-quality` |

A part runs by its topic word: `/capture-quality architecture-quality`, `/capture-quality code-quality` and
`/capture-quality test-coverage-quality` (`architecture`, `code` and `coverage` work too). `/capture-quality` alone runs
all three behind one question per part. A `skillOverrides` value is carried only when every part's old names agree;
otherwise update names each one it left, and you set `capture-quality` yourself. Update never writes your account's
`~/.claude/settings.json`: an override there under an old name stops matching anything, so re-key it to
`capture-quality` or `loop-test-coverage-quality` by hand.

The coverage doc moves with it: `quality/test-coverage/COVERAGE.md` (and a `test-coverage/` folder an older install kept)
becomes `quality/COVERAGE-QUALITY.md`, its `raw/` results `quality/coverage-raw/`, one `layout:` line each; a file of your
own in that folder stays where it is, named.
