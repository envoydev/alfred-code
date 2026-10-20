---
name: capture-preferences
description: "Use when asked to capture or change the user's code, architecture or git preferences ('avoid static classes', 'branches are feature/<ticket>'). Manual, /-only."
disable-model-invocation: true
---

# User preferences - capture, check, attach (Deliberate)

You record the user's own code, architecture and git preferences and regenerate the rule that loads them, so every session and seat reads them before any code, architecture or git job and ranks them above every other source. Two artifacts come out of a run:

1. `<docs-path>/preferences/CODE-PREFERENCES.md`, `ARCHITECTURE-PREFERENCES.md` and `GIT-PREFERENCES.md` - one `##` entry per preference, ids `C<n>`, `A<n>`, `G<n>`, in the shape `references/doc-shape.md` lays out.
2. `.claude/rules/alfred-preferences.md` - generated and pathless, carrying every entry inline under one header per doc that names its path, written by the script from `references/rule-template.md`. A seat loads the rule, not the docs, so an edit to a doc binds only once `<script> rule` runs; `lint` and `check` print a `stale:` line until then.

## When to use

- `/capture-preferences <text>` - one or more preferences, split on `;` or new lines: `/capture-preferences avoid static classes; wrap external packages behind a project interface; branches are feature/<ticket>`.
- `/capture-preferences code` (or `architecture`, `git`) - walk that area's entries with the user: keep, change or remove each.
- `/capture-preferences remove <id>` - drop one entry.
- No arguments - one ask per area; the user types theirs or skips the area.
- Not for the style the code already follows (the code-style capture reads that off the code) or the architecture map. A preference is what the user WANTS, in their words.

## The run

`<script>` is `node .claude/skills/capture-preferences/scripts/preferences.js`, run from the project root.

With no arguments, the three area asks go in ONE AskUserQuestion call, one question per area:

```ask
Any <area> preferences to record? Type them via Other - one per line, or split on `;`.
- 'Skip <area> (Recommended)' - nothing is written for this area; a later run can add them
- 'I have some' - I ask for them next, in plain text
```

`/capture-preferences <area>` walks that area's entries, up to four per AskUserQuestion call:

```ask
<id> - <title>. Rule: <its Rule: line>. Keep it?
- 'Keep (Recommended)' - the entry stays as written
- 'Change it' - I ask for the new wording next, in plain text
- 'Remove it' - the entry is deleted and its id joins `Retired:`
```

### 1. CLASSIFY

Each preference goes to one area:

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

Read the area's doc first; it may not exist. Write each preference as one entry in `references/doc-shape.md`'s shape: a short title, `Rule:` in the imperative, `Scope:`, `Why:` in the user's words when they gave one (else the plain consequence - never invented history). Its id is what `<script> next --area <area>` prints - one past the highest the doc has used, its `Retired:` line included, so an id is never reused; a second entry in the same area takes the number after it. Add a `Check:` only when a regex over named globs catches a violation with few false hits; a preference no regex catches has none and stays a seat's judgment.

### 3. CONFLICT CHECK

Read what the preference could contradict: the house convention skills for the files in its scope, `<docs-path>/code-style/CODE-STYLE.md`, the architecture map, `alfred-git.md` and the project's AGENTS.md. A clash the language or a tool forces (C# extension methods must sit in a static class) is asked once per clash:

```ask
'<the preference>' clashes with <what forces it>: <the case, one line>. Record an exception?
- 'Add the Except: line (Recommended)' - the entry keeps its rule and names <the case> as its one waiver
- 'Keep it absolute' - no exception; code that needs <the case> breaks the preference
- 'Drop the preference' - nothing is written for it
```

A clash with a convention or style the project merely follows is no ask: the preference wins, and the report's `Docs:` line names what it overrides.

### 4. WRITE

Write each touched doc whole: its title, `Updated: <today>` (not a `Captured:` stamp - the docs record the user's words, not the code), `Retired:` once an id has been removed, then the entries in id order. A removal deletes the entry and adds its id to `Retired:`. Write `watch.json` holding `{}` beside the docs when it is absent - the folder is a docs domain with no watched globs. Then `<script> lint`; every `PROBLEM` line is fixed before the next step. Over the 8,000-char cap, ask what to cut before the rule is written - every session and seat pays for the three docs:

```ask
The three preferences docs hold <n> chars, over the 8,000 cap. Longest: <id> (<n> chars), <id> (<n>), <id> (<n>). What gets cut?
- 'Tighten those three (Recommended)' - I shorten their Scope:, Why: and Except: lines, keep each Rule: as written, and show the new text before the rule is written
- 'Remove entries' - I ask which ids next, in plain text; each joins `Retired:`
```

### 5. MEASURE

`<script> check --all --area <area>` for each area the run touched: count each new or changed entry's `violation:` lines - how many places break it today. Fix none of them here; the quality loops and the next task do.

### 6. RULE

`<script> rule` writes the rule and prints its `Rule:` line. Never write or edit the rule by hand: the next run replaces it whole. A removal that empties every doc still runs it - the rule then carries none.

### 7. REPORT

```
Docs: <doc> - <ids added | changed | removed>; overrides <what a preference beats, or none>
Conflicts: <the sources step 3 read> - <each clash asked and its answer | none>
Check: <id> <n> violations[, <id> <n> violations] | none with a Check:
Rule: <the script's Rule: line, verbatim>
```

Close with one line: the rule loads at session start and carries the entries into every seat that session dispatches, so a new or changed preference binds from the NEXT session.
