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
- `<!-- locked: <key> -->` - after the id line, on the git doc's seeded consent, checkpoint, safety, attribution and checks entries only. A locked entry keeps every field word for word (`lint` compares each with the seed); a merged copy may carry another id and title, and an unlocked entry under a locked one's title is a weakened copy `lint` names.
- `Rule:` is required: one imperative line.
- `Scope:` - globs or a plain area, comma-separated. Globs decide which edits the first-edit hold hands the entry over for - a glob with no `/` matches the file name (`*.cs`), a path with no glob character everything under it (`api/`); a plain area, or no `Scope:`, is handed over for every edit. A glob that reaches no file hides its entry from every edit, so `lint` notes one and every update names it; `reach` shows what each pattern takes - a count, the file types, a few paths - so one aimed at the wrong existing folder shows, the capture asks the user to confirm each new glob's reach, and `lint` and every update name a `Check:` that measures files its `Scope:` does not reach.
- `Why:` - one line.
- `Except:` - the waivers, `;`-separated. The only place a waiver lives.
- `Check:` - optional, in the grammar below; never on a personal entry (`lint` flags one). It is the script's data: the hook never hands it over.
- The field names stay English - `lint` and the hooks read them; the text is the user's words, in their language. A fenced block is the entry's text: a `## ` line or a field inside one is an example, never read.

## The `Check:` grammar

regex `<pattern>` in `<glob>`[, `<glob>`] [excluding `<glob>`[, `<glob>`]]

- Exactly this, and nothing else is run: a shell command in a committed doc would run whatever a teammate wrote, so `lint` rejects one.
- The pattern is a JavaScript regex matched line by line. The globs are project-relative; `*` stays inside a folder, `**/` spans any number of them, `{a,b}` is either.
- A check that would fire on most files, or that needs the code's meaning, is not written: the seats judge that preference.

## The precedence

The preferences docs rank above every skill, house convention, quality-loop prompt and the architecture map, in this order: the personal code and architecture docs, the project doc, the decision log and AGENTS.md, a loop prompt, a convention skill. Where an entry and a skill or another instruction disagree, ask the user which wins, the entry's side marked (Recommended) - a seat names the clash in its report and carries on with the entry's side. A breach of a recorded decision (an ADR) is a Proposed decision naming both, never a Must-fix. A waiver is the preference's own `Except:` line. A preference never overrides security, input validation, error handling or accessibility, never opens a hook's gate, and no entry weakens a `locked` one.

## Size

The personal code and architecture docs have no doc cap (the user's ruling of 2026-10-22: the hook caps what it hands over, never the user's words). The first edit's hold hands each entry over where its `Scope:` reaches, without its `Check:` line, and what does not fit one room comes with the retry; one entry stays at or under 5,000 chars, since no hold hands a longer one over whole, and past 5,000 together `lint` prints a `note:` line - every editing actor reads them, and a seat that judges without editing - a solution designer, a verifier, the code-quality analyzer, the security auditor, the integration reviewer, and the architecture analyzer in an architecture quality run (the architecture doc alone) - is handed them at its start and the rest with its first reads (a Read, a Grep, an LSP call, a symbol lookup or a shell read of a file); a review of the main session's is handed them before it starts. The git doc stays at or under 5,000: the first git write's hold hands it over whole. The personal doc stays at or under 3,000 on its own: the hook pushes it into every session's start and again after each compaction, so it is paid on every session. `PROJECT-CODE-PREFERENCES.md` is held by the docs engine's own section cap instead.

## The tools doc

`TOOLS-PREFERENCES.md` holds which tools each job uses first, what each job is for, and which servers stay with the main session. `tools.js` owns it (`lint`, `next`, `order`), and the start line every session and seat gets is built from it.

```markdown
# Tools preferences

Updated: 2026-10-23

## T1 - Code navigation
<!-- id: t1 -->
- Job: navigation
- Order: own:jetbrains find_usages, get_symbol_info > serena find_symbol, find_referencing_symbols > LSP > Grep
- Purpose: locate symbols, callers and types before reading or editing code

## T2 - Not for agents
<!-- id: t2 -->
- Job: deny
- Deny: own:postgres, own:jetbrains execute_terminal_command
- Why: database access stays with the main session
```

- `Job:` - the machine key; the heading is the user's words. `navigation`, `documentation`, `memory`, `browser`, `desktop` and `mobile` are the table's jobs, any other lower-case name is the user's own, and `deny` holds the agents' deny list. One entry per job.
- `Order:` - ranks separated by ` > `, the first used before the next. A rank is a server type followed by the tools of it that serve the job (`serena find_symbol, find_referencing_symbols`), or one built-in alone (`LSP`, `Grep`, `Glob`, `Read`, `Bash`, `WebFetch`, `WebSearch`). A type is a known one from the adapter table (`serena`, `context7`, `memory-service`, `playwright`, `windows-mcp`, `macos-mcp`, `appium`) or `own:<label>` for a server the stack does not know - never a local registration name, so a committed doc works on another machine; this machine's inventory maps each `own:` label to its server. Behaviour words ('say it is unverified') belong in `Purpose:`, never in a rank.
- `Purpose:` - what the job is for, one line; the start line carries it.
- `Held:` - optional, navigation only: which fallbacks a later release holds (by default Grep and a shell grep).
- `Deny:` - on the `deny` entry: types or `type tool` pairs every agent's tool order leaves out (no hook blocks the call). A ranked tool that is also denied is a `note:` - the main session keeps it, agents skip that rank.
- `Why:` - one line.
- With no doc, every session is told the adapter table's defaults: `serena` > `LSP` > `Grep` for navigation, `context7` > `WebFetch` for documentation, `memory-service` for memory - a server rank only where this machine registers that type, an absent one left out unnamed, since the stack ships no server. A doc that does not lint never falls back to them: the start line names its problems.
- The doc stays at or under 3,000 chars: the main session gets every entry at every start. An `own:` type this machine never captured is a `note:`, not a problem - the doc may be a teammate's; run `/capture-preferences tools` here to record it.
