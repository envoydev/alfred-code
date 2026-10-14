---
description: House baseline - code navigation and reading. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Navigation and code reading

## What to read

- Read only what is needed: `Read` is for code already located, never a whole file to find a symbol (`guard-read-whole-file.js` blocks it). Answer a blocked read with the ranged read its denial names - never the same read in another shape or against a second path; before editing, read the body and what it calls.
- A shell read (`cat`, `sed`, `head`, `awk`, python, a heredoc) is the same read under the same rules; path-scoped rules do not attach on the shell route, so the read guard names the governing rule on the first shell write.
- Never fetch what is already in context, by any route - no repeat `find_symbol`, no second read of an unchanged file or range; re-check an edit at the edited range only.
- Orient from the architecture docs before deriving the project from code: `<docs-path>/architecture/ARCHITECTURE.md` (deep dives in `architecture/references/`, pros and cons in `quality/ARCHITECTURE-ASSESSMENT.md`), read by section - `node .claude/hooks/docs.js where <path>`, then `show <file>#<id>`. For a specific symbol the code wins; no `architecture/` means the capture never ran - say so once and navigate from code.
- What the STACK does or wants is read from its own artifacts - the owning command's doc for a reconcile, the rule or hook that reads a setting for what it does - never guessed by hand-comparing files.

## Locating symbols

- Symbols, callers and resolved types go through the `alfred-navigation` server (Serena) inline, never an `Explore` / `general-purpose` dispatch (the dispatch guard blocks a symbol brief); an installed `LSP` plugin adds compiler-exact lookups. A scoped grep for a literal you already located is fine; a symbol question is not, because name-matches lie.
- The navigation-server tools are DEFERRED - naming them is not having them. Load them in one call: `ToolSearch select:mcp__plugin_alfred-navigation_alfred-navigation__find_symbol,mcp__plugin_alfred-navigation_alfred-navigation__find_referencing_symbols,mcp__plugin_alfred-navigation_alfred-navigation__get_symbols_overview`. A seat whose `tools:` list names them has them loaded already - it calls them directly, with no ToolSearch.
- A symbol its language server cannot resolve (a large or SDK-heavy C# solution indexes slowly) falls back to the `LSP` plugin, then to a scoped grep reported as name-matched, not resolved. The navigation server keeps symbol lookup, `rename_symbol` and `safe_delete_symbol`; every other edit goes through Edit / Write, the tools the edit hooks watch.
- `Active language servers: []` is a run-level fact: say so once, take that fallback, never re-issue the call class this run, and hand the fact to the seats you dispatch next.
- A language the navigation server's `project.yml` (`<data root>/serena/`) does not list takes the fallback from its first call.
- A large JSON / YAML / lock / fixture file is queried (a `node -e` projection - Git for Windows ships no `jq` - or `grep -n`, then a ranged Read), never read whole.
- A large symbol is fetched WITHOUT its body first (signature, children), then read by range.
- `get_symbols_overview` takes ONE file, never a directory - list the directory first; on C# pass `depth: 2` (the default stops at the namespace, so it returns only its name; 2 reaches the type members, nested-type members need 3; a top-level-statements file returns `{}` at any depth).
- An EMPTY reference result for a symbol that plausibly has callers is suspect (a multi-tsconfig monorepo hides cross-lib callers): cross-check with a grep before saying 'no callers'.
- The navigation server is navigation only: its memory tools are off, and every note - a seat's handoff included - goes to the `alfred-memory` MCP (`alfred-memory.md`).

## Compact Instructions

- When compacting, keep verbatim what the next turn would otherwise re-read - the files modified, the live plan file's path and step, the build and test commands with their last result, every open ask with its answer - and drop tool output and file contents (measured: 18-file re-reads after a compaction).

## Shell commands

- zsh aborts the WHOLE command on an unmatched bare glob, status 1 like a genuine no-match, so an aborted scan reads as 'nothing there': single-quote a glob the TOOL owns (`grep --include='*.cs'`, `find . -name '*.md'`), and list a path glob that may match nothing with `find <dir> -name '<pat>'`.
- zsh also aborts on a bare word opening with `=` (`echo =====` looks up a command `====`): quote it, `echo '====='`. It never word-splits `$VAR`, so a command plus flags held in one variable runs as one word - use a function or an array.
- A splice (`sed -i`, an in-place python or perl replace) is for a mechanical rename across many sites, never an edit Edit / Write can make; it counts its anchor first and replaces only when the count is the one it expects.
- Read `$?` on the very next line, with `set -o pipefail` before a pipe (bash and zsh both honour it; `${PIPESTATUS[0]}` reads empty in zsh); never `<cmd> || echo none`, which launders a failure into an empty result. A scan used as evidence of ABSENCE runs a must-match positive control in the same call, and resolves its tool absolutely or checks it with `type` first.
- On Windows (Git Bash): pass a `/tmp/x` path to native `node` through `cygpath -w` (or write under `$TEMP`); prefix a `git show <rev>:<path>` with `MSYS2_ARG_CONV_EXCL='*'`, or path conversion rewrites it; run PowerShell as a quoted-heredoc (`<<'EOF'`) `.ps1` via `-File "$(cygpath -w <file>)"`, never a double-quoted `-Command` (Bash expands its `$_`).
- Scratch code goes outside the tracked tree (the session scratchpad or the OS temp dir), or into a gitignored dir inside the repo when an ESM script must import the project's `node_modules`. An interrupted compound write may already have run - check the target before trusting the rejection.

## When the target is ambiguous

- Ambiguous reference with multiple matches: put the matches through AskUserQuestion (one option each, the likely one marked). Do not guess.
- Pasted code in chat is illustrative unless stated otherwise; confirm the target file before editing.
