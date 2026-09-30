---
name: alfred-habits-adjust-claude-md
description: "Use when a CLAUDE.md is to be written, filled in or updated - an unfilled seeded one, a stale one, a part needing its own. Not for skills or rules."
---

# Adjust CLAUDE.md - create or improve a project's instruction file

A CLAUDE.md is read into every session and every custom subagent, so every line is paid for on every
message and earns its place only when removing it would make Claude get something wrong. Three homes,
never mixed:

- **The template** (`stack/CLAUDE.template.md`) owns WHAT goes in - its authoring outline (the numbered
  sections, Setup and Key files among them), the keep-out test and the five shapes to keep out (its
  fill-in block), and where the file lives.
- **This skill** owns HOW - which mode, where the facts come from, what is shown before a write.
- **The check** (`scripts/claude-md-check.js`) owns the verdict - every named path exists, every
  command's program resolves, no placeholder, TODO or template text is left. It runs last, every time.

## When to use

- A project's CLAUDE.md written, filled in or brought up to date: the seeded `.claude/CLAUDE.md` still unfilled, a CLAUDE.md gone stale against the code (a moved path, a changed build or test command, a missing setup step), an audit or improvement of the instruction file, a separate part of the repo (web/, api/, a package) that needs its own CLAUDE.md, or what the CLAUDE.md check reported.
- Covers setup, commands, key files and architecture sections, what to keep out, and the deterministic check that closes it.
- Not for a skill, a rule or a hook - the skill-authoring method owns those - nor a README, nor a preference or lesson, which the shared memory server keeps.

## 1. Resolve the stack's files

A run that already holds the stack's snapshot (the `/alfred-code:init` run's `$TMP/repo`) uses that
folder's path as `<stack>`. Otherwise take the newest plugin-cache entry (normally the release these copies
came from; after a core update it can be newer) - the block prints its path, and every later command pastes that literal as `<stack>` (each Bash call is its
own shell, so a variable set here is gone by the next):

```bash
STACK=$(for d in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/alfred-code/*; do
  [ -f "$d/scripts/claude-md-check.js" ] && [ ! -e "$d/.orphaned_at" ] && printf '%s\t%s\n' "$(basename "$d")" "$d"
done 2>/dev/null | sort -V | tail -1 | cut -f2)
echo "stack: ${STACK:-absent}"
```

`stack: absent` (a copy-only install): the check cannot run - say so in the report, and take the
outline from the seeded `.claude/CLAUDE.md` when it still carries its comment blocks; with neither,
stop and name `/alfred-code:update`, which brings the stack's files back.

## 2. Pick the mode - the script says what is on disk

```bash
node "<stack>/scripts/claude-md-check.js" --root . --list
```

- **Create** - it printed `no CLAUDE.md in this project`, or every file it lists is `the seeded
  template (unfilled)`. The target is the seeded `.claude/CLAUDE.md`; with none, write that file
  from `<stack>/stack/CLAUDE.template.md` (the spot the installer seeds, auto-loaded like a root one).
- **Improve** - any listed file holds the project's own text. Every listed file is in scope: the
  root one, `.claude/CLAUDE.md`, and each part's own.

An `AGENTS.md` holding the repo's canonical agent instructions changes both: the CLAUDE.md stays thin
and imports it, as the template's fill-in block spells out - never the same facts written twice.

## 3. Gather the facts - read, never guessed

Every fact a section states comes from a file that states it, in this order:

1. **The first-look scan** - `node "<stack>/scripts/scan-evidence.js" --orientation --root .` prints the
   stack, the modules, the build / test / run commands and the entry points, read from the manifests.
   It is the map; do not re-derive it by reading source.
2. **The architecture docs** when `alfred-capture-architecture` has run (`<docs-path>/architecture/`):
   the docs hook already pushes its orientation into every session, so sections 1 and 6 point at it
   and keep only what it lacks.
3. **Setup** - the SDK pins (`global.json`, `.nvmrc`, `engines`, `<TargetFramework>`), the compose
   file or container package a test run needs, and the env var NAMES a test reads (`.env.example`,
   `appsettings.*.json`, the test fixtures) - names only; a credential is read for presence, never
   its value.
4. **Commands** - the CI workflow's steps are the commands known to work; the manifests' scripts are
   the rest. Beside the full-suite test command, the scoped one (one project, a filter, a spec path).
5. **Key files** - the entry points the scan printed and the configs that decide behaviour, one line
   each on what the file decides.

A separate part is a top-level folder with its own manifest whose stack or commands differ from the
root's (a `web/package.json` beside a .NET solution, an `api/` with its own solution). It gets its own
`<part>/CLAUDE.md` - Claude loads it when it reads a file there - carrying only that part's Setup,
Commands and Key files, which the root file then does not repeat (it points at the part's file); what
two parts share stays in the root file.

## 4. Create - fill the outline

1. Write the sections the template's outline numbers, in its order, only where step 3 found a fact -
   an empty section is not written. The H1 is the project's own name.
2. Trim the `## Rules` table to the rules in `.claude/rules/`, dropping each GENERATED row whose file
   is absent.
3. Delete the template's two comment blocks once the sections are in.
4. Write each part's `<part>/CLAUDE.md`.

The write needs no second ask - the request to fill it is the ask - but the report names every file
written with its line count.

## 5. Improve - show before writing, never rewrite the project's prose

1. Run the check first (step 7's command): its rows are the stale lines.
2. Read each listed file whole - they are small - against the outline, and note the sections it lacks
   that step 3 has facts for (Setup and Key files most often).
3. Draft two kinds of change, nothing else:
   - **a fix per check row** - only the flagged token changes: the path it moved to (the navigation
     server's symbol lookup, or `git log --follow --name-status -- <old path>`), the command the
     manifest or CI now runs. A path that is simply gone comes out of its line, the rule around it
     kept - the whole line only when the path was all it said. A TODO or placeholder in the
     project's own text is the user's to fill: named in the report, never invented;
   - **an addition** - a section the template's outline numbers that the file lacks and step 3 found a
     fact for, a missing line in an existing section, or a separate part's own `<part>/CLAUDE.md` where
     it has none (step 3).

   The project's own wording, order and sections are never reworded, reordered or deleted beyond that,
   and a line the project wrote is never extended - an addition goes on a line of its own.
4. Show every change before writing: per file, a `diff` block and one line saying why it helps a
   future session. Then one AskUserQuestion - apply the additions (recommended), apply the additions
   and the check fixes, apply some (named via Other), or skip. A check fix is never in the recommended
   option: the check is heuristic, and a row can be correct text it could not resolve, so the user
   reads each one and picks - with only check fixes drafted, no option is marked recommended. A
   dispatched seat has no user channel: it returns the diffs in its report instead.
5. Apply exactly the answer.

## 6. What never goes in

Hold every line to the template's keep-out test and its five shapes. On top of them, three things
this file is never the home of:

- **A session's learnings, a correction or a personal preference** - the shared memory server keeps
  them (`alfred-memory.md`), searchable and shared across accounts; a CLAUDE.md line is neither.
- **A `CLAUDE.local.md` of personal notes** - the same server, for the same reason.
- **A score or a grade** of the file - a judgment no check can hold it to; the check's rows are the
  verdict.

## 7. Check last - the file matches the tree

```bash
node "<stack>/scripts/claude-md-check.js" --root .
```

- A row on a line this run wrote is this run's bug: fix it and run the check again.
- A row on a line the user kept (declined in step 5) stays, named in the report.
- A `command` row on a program only another OS runs (a PowerShell-only step on macOS) stays, named.

## 8. Report

The mode, each file written or changed (lines before and after), the check's last output line quoted,
and every row left with its reason. Nothing is committed - the user reviews the diff.
