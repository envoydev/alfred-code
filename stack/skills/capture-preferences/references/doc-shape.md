# The preferences docs - shape

Four docs of the user's words under `<docs-path>/preferences/`, one per area, each written only once it holds an entry - the git doc from the install on, which seeds it:

| Doc | Area | Ids |
|---|---|---|
| `PERSONAL-PREFERENCES.md` | how the user wants the assistant to work with them - pushed at every session start and after each compaction | `P1`, `P2`, ... |
| `PERSONAL-CODE-PREFERENCES.md` | how one unit is written | `C1`, `C2`, ... |
| `ARCHITECTURE-PREFERENCES.md` | how units relate | `A1`, `A2`, ... |
| `GIT-PREFERENCES.md` | branches, commits, pull requests, history | `G1`, `G2`, ... |

`PROJECT-CODE-PREFERENCES.md` beside them is the code-style capture's doc - a section per language, read on the same trigger, never written here. `watch.json` holds the folder's docs domain, so `docs.js show PERSONAL-CODE-PREFERENCES#c3` reads one entry; a preference of the user's own carries no watched globs - it does not drift with the code.

## A doc

```
# Code preferences

Updated: 2026-10-20
Retired: C1

## C2 - Wrap external packages
...
```

- `Updated: <date>` opens it, not a `Captured:` stamp: the doc records the user's words, not the code.
- `Retired:` lists every id ever removed, comma-separated, so the next id skips them. It appears with the first removal, above the first entry; one inside an entry is that entry's text.

## An entry

```
## C3 - No static classes
<!-- id: c3 -->
- Rule: model behaviour as instances behind an interface; a static class only where the language requires one.
- Scope: src/**/*.cs
- Why: testable and replaceable without touching callers.
- Except: extension-method holders; source-generator output.
- Check: regex `\bstatic class\b` in `src/**/*.cs`, excluding `**/*Extensions.cs`
```

- The heading is `## <id> - <title>`, then the id line in lower case - the docs engine reads one entry by it.
- `<!-- locked: <key> -->` - after the id line, on the git doc's seeded consent, scope, checkpoint and safety entries only. A locked entry keeps every field word for word (`lint` compares each with the seed); a merged copy may carry another id and title, and an unlocked entry under a locked one's title is a weakened copy `lint` names.
- `Rule:` is required: one imperative line.
- `Scope:` - globs or a plain area, comma-separated.
- `Why:` - one line.
- `Except:` - the waivers, `;`-separated. The only place a waiver lives.
- `Check:` - optional, in the grammar below; never on a personal entry (`lint` flags one).
- The field names stay English - `lint` and the hooks read them; the text is the user's words, in their language. A fenced block is the entry's text: a `## ` line or a field inside one is an example, never read.

## The `Check:` grammar

regex `<pattern>` in `<glob>`[, `<glob>`] [excluding `<glob>`[, `<glob>`]]

- Exactly this, and nothing else is run: a shell command in a committed doc would run whatever a teammate wrote, so `lint` rejects one.
- The pattern is a JavaScript regex matched line by line. The globs are project-relative; `*` stays inside a folder, `**/` spans any number of them, `{a,b}` is either.
- A check that would fire on most files, or that needs the code's meaning, is not written: the seats judge that preference.

## The precedence

The preferences docs rank above every skill, house convention, quality-loop prompt and the architecture map, in this order: the personal code and architecture docs, the project doc, the decision log and AGENTS.md, a loop prompt, a convention skill. Where an entry and a skill or another instruction disagree, ask the user which wins, the entry's side marked (Recommended) - a seat names the clash in its report and carries on with the entry's side. A breach of a recorded decision (an ADR) is a Proposed decision naming both, never a Must-fix. A waiver is the preference's own `Except:` line. A preference never overrides security, input validation, error handling or accessibility, never opens a hook's gate, and no entry weakens a `locked` one.

## Size

Each doc a hook hands over has a cap per hold: the personal code and architecture docs together at or under 5,000 chars (the first edit's hold hands both over), the git doc at or under 5,000 (the first git write's hold). The personal doc stays at or under 3,000 on its own: the hook pushes it into every session's start and again after each compaction, so it is paid on every session. `lint` counts all three; `PROJECT-CODE-PREFERENCES.md` is held by the docs engine's own section cap instead.
