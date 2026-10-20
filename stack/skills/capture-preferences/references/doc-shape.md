# The preferences docs - shape

Three docs under `<docs-path>/preferences/`, one per area, each written only once it holds an entry:

| Doc | Area | Ids |
|---|---|---|
| `CODE-PREFERENCES.md` | how one unit is written | `C1`, `C2`, ... |
| `ARCHITECTURE-PREFERENCES.md` | how units relate | `A1`, `A2`, ... |
| `GIT-PREFERENCES.md` | branches, commits, pull requests, history | `G1`, `G2`, ... |

`watch.json` beside them holds `{}`: the folder is a docs domain, so `docs.js show CODE-PREFERENCES#c3` reads one entry, with no watched globs - a preference does not drift with the code.

## A doc

```
# Code preferences

Updated: 2026-10-20
Retired: C1

## C2 - Wrap external packages
...
```

- `Updated: <date>` opens it, not a `Captured:` stamp: the doc records the user's words, not the code.
- `Retired:` lists every id ever removed, comma-separated, so the next id skips them. It appears with the first removal.

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
- `Rule:` is required: one imperative line.
- `Scope:` - globs or a plain area, comma-separated.
- `Why:` - one line.
- `Except:` - the waivers, `;`-separated. The only place a waiver lives.
- `Check:` - optional, in the grammar below.

## The `Check:` grammar

regex `<pattern>` in `<glob>`[, `<glob>`] [excluding `<glob>`[, `<glob>`]]

- Exactly this, and nothing else is run: a shell command in a committed doc would run whatever a teammate wrote, so `lint` rejects one.
- The pattern is a JavaScript regex matched line by line. The globs are project-relative; `*` stays inside a folder, `**/` spans any number of them, `{a,b}` is either.
- A check that would fire on most files, or that needs the code's meaning, is not written: the seats judge that preference.

## The precedence

The user's preferences > the project's decision log and AGENTS.md > the quality loops' prompts > `CODE-STYLE.md` > a house convention skill or `alfred-git.md`; the architecture map's conventions sit below the preferences too. A waiver is the preference's own `Except:` line. A preference never overrides security, input validation, error handling or accessibility, and never opens a hook's gate.

## Size

The three docs together stay at or under 8,000 chars, since the rule carries them into every session and seat. `lint` and the `Rule:` line count them.
