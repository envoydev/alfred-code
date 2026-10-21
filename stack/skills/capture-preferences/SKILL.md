---
name: capture-preferences
description: "Use when asked to capture or change the user's personal, code, architecture or git preferences ('answer briefly', 'avoid static classes'). Manual, /-only."
disable-model-invocation: true
---

# User preferences - capture, check, attach (Deliberate)

You record the user's own wants in the docs every session and seat reads, and ranks them above every other source. The artifacts are four docs under `<docs-path>/preferences/`: `PERSONAL-PREFERENCES.md` (how the user wants the assistant to work with them - pushed into every session's start and again after each compaction), `PERSONAL-CODE-PREFERENCES.md`, `ARCHITECTURE-PREFERENCES.md` and `GIT-PREFERENCES.md` (read before any code, design, code discussion or git job) - one `##` entry per preference, ids `P<n>`, `C<n>`, `A<n>`, `G<n>`, in the shape `references/doc-shape.md` lays out. No rule is written: the shipped `alfred-preferences.md` names the docs and says when each is read, so an edit binds at the next session start (the personal doc) or the next read (the others). The two personal docs (`PERSONAL-` and `PERSONAL-CODE-PREFERENCES.md`) stay out of git where the docs are committed - the data root's ignore lines keep them on this machine - so a linked worktree reads them from the main checkout.

The install seeds `GIT-PREFERENCES.md` from `references/git-seed.md`: the house git lines, its consent, commit scope, checkpoint and safety entries marked `<!-- locked: <key> -->`. A locked entry is never removed or changed, and no entry weakens a `locked` one; `lint` fails a doc missing one or carrying one edited. `PROJECT-CODE-PREFERENCES.md`, the fifth doc there, is the code-style capture's - this skill reads it in the conflict check and never writes it.

## When to use

- `/capture-preferences <text>` - one or more preferences, split on `;` or new lines: `/capture-preferences answer with the verdict first; avoid static classes; branches are feature/<ticket>`.
- `/capture-preferences personal` (or `code`, `architecture`, `git`) - walk that area's entries with the user: keep, change or remove each; a locked entry is shown as locked, never offered for change.
- `/capture-preferences remove <id>` - drop one entry; a locked one is refused in one line.
- No arguments - one ask per area, the personal rules first; the user types theirs or skips the area.
- Not for the style the code already follows (the code-style capture reads that off the code) or the architecture map. A preference is what the user WANTS, in their words.

## The run

`<script>` is `node .claude/skills/capture-preferences/scripts/preferences.js`, run from the project root.

With no arguments, the four area asks go in ONE AskUserQuestion call, one question per area - personal, code, architecture, git, in that order; the personal one asks for the personal rules the user wants added (how to answer, which language, when to ask, what to never do):

```ask
Any <area> preferences to record? Type them via Other - one per line, or split on `;`.
- 'Skip <area> (Recommended)' - nothing is written for this area; a later run can add them
- 'I have some' - I ask for them next, in plain text
```

`/capture-preferences <area>` walks that area's entries that are not locked, up to four per AskUserQuestion call:

```ask
<id> - <title>. Rule: <its Rule: line>. Keep it?
- 'Keep (Recommended)' - the entry stays as written
- 'Change it' - I ask for the new wording next, in plain text
- 'Remove it' - the entry is deleted and its id joins `Retired:`
```

### 1. CLASSIFY

Each preference goes to one area:

- **personal** - how the user wants the assistant to work with them, whatever the task: answer shape and length, language, when to ask and when to go on, words or habits to avoid.
- **code** - how ONE unit is written: a class, a function, naming, error handling inside it.
- **architecture** - how units relate: dependencies, boundaries, layers, packages, what may call what.
- **git** - branches, commits, pull requests, history.

One that genuinely reads as two areas is asked as one question naming both readings - never split silently:

```ask
'<the preference>' reads two ways: <area> - <reading>, or <area> - <reading>. Which did you mean?
- '<the reading its words fit best> (Recommended)' - the entry lands in that area's doc
- '<the other reading>' - the entry lands in the other area's doc
```

### 2. NORMALIZE

Read the area's doc first; it may not exist. Write each preference as one entry in `references/doc-shape.md`'s shape: a short title, `Rule:` in the imperative, `Scope:`, `Why:` in the user's words when they gave one (else the plain consequence - never invented history). Its id is what `<script> next --area <area>` prints - one past the highest the doc has used, its `Retired:` line included, so an id is never reused; a second entry in the same area takes the number after it. Add a `Check:` only when a regex over named globs catches a violation with few false hits; a preference no regex catches has none and stays a seat's judgment. A personal entry never has one - there is no code to grep - and its `Scope:` is a plain area (`every answer`, `commit messages`). Field names stay English (`Rule:`, `Scope:`, `Why:`, `Except:`, `Check:`) - `lint` and the hooks read them; the text is the user's words, in their language.

### 3. CONFLICT CHECK

Read what the preference could contradict: for a personal entry, the house answer and interaction rules (`alfred-interaction.md`), the personal doc itself and the git doc's locked entries ('just commit when you are done' weakens the consent entry); for the others, the house convention skills for the files in its scope, `<docs-path>/preferences/PROJECT-CODE-PREFERENCES.md`, the architecture map, the git doc's locked entries and the project's AGENTS.md. A preference that would weaken security, input validation, error handling or accessibility, or open a hook's gate, never binds there, and no entry weakens a `locked` one - `alfred-preferences.md` says so - so tell the user in one line before writing it, and never record it as if it would. A clash the language or a tool forces (C# extension methods must sit in a static class) is asked once per clash:

```ask
'<the preference>' clashes with <what forces it>: <the case, one line>. Record an exception?
- 'Add the Except: line (Recommended)' - the entry keeps its rule and names <the case> as its one waiver
- 'Keep it absolute' - no exception; code that needs <the case> breaks the preference
- 'Drop the preference' - nothing is written for it
```

A clash with a convention or style the project merely follows is no ask: the preference wins, and the report's `Docs:` line names what it overrides.

### 4. WRITE

Write each touched doc whole: its title, `Updated: <today>` (not a `Captured:` stamp - the docs record the user's words, not the code), `Retired:` once an id has been removed, then the entries in id order, each locked entry byte for byte as it stands. A removal deletes the entry and adds its id to `Retired:`. Write `watch.json` holding `{}` beside the docs when it is absent - the folder is a docs domain. Then `<script> lint`; every `PROBLEM` line is fixed before the next step. Each hold has its own cap, since a hook hands its docs over in one denial: the personal code and architecture docs together 5,000 chars (the first edit's hold), the git doc 5,000 (the first git write's hold). Over one, ask what to cut - for the git doc, the longest list names entries that are not locked, since a locked one is never cut:

```ask
<the docs over the cap> hold <n> chars, over the 5,000 cap. Longest: <id> (<n> chars), <id> (<n>), <id> (<n>). What gets cut?
- 'Tighten those three (Recommended)' - I shorten their Scope:, Why: and Except: lines, keep each Rule: as written, and show the new text before it is written
- 'Remove entries' - I ask which ids next, in plain text; each joins `Retired:`
```

The personal doc's cap is 3,000 on its own - a hook pushes it into every session's start and again after each compaction, so every session pays it:

```ask
The personal doc holds <n> chars, over its 3,000 cap - every session start pays it. Longest: <id> (<n> chars), <id> (<n>), <id> (<n>). What gets cut?
- 'Merge two entries (Recommended)' - I fold the two closest entries into one, show the new text before it is written, and the dropped id joins `Retired:`
- 'Tighten those three' - I shorten their Scope: and Why: lines, keep each Rule: as written, and show the new text first
- 'Remove entries' - I ask which ids next, in plain text; each joins `Retired:`
```

### 5. MEASURE

`<script> check --all --area <area>` for each area the run touched but personal (it has no `Check:`): count each new or changed entry's `violation:` lines - how many places break it today. Fix none of them here; the quality loops and the next task do.

### 6. REPORT

```
Docs: <doc> - <ids added | changed | removed>; overrides <what a preference beats, or none>
Conflicts: <the sources step 3 read> - <each clash asked and its answer | none>
Check: <id> <n> violations[, <id> <n> violations] | none with a Check:
Lint: <the script's lint: line, verbatim>
```

Close with one line: a new or changed personal entry binds from the next session start or compaction (or now, once this session reads the doc), the others at the next read of their doc - every seat and every new session reads them before its first edit or git write.
