---
description: House baseline - code navigation and reading. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Navigation and code reading

## What to read

- Read only what is needed: `Read` is for code already located, never a whole file to find a symbol (`guard-read-whole-file.js` blocks it). Answer a blocked read with the ranged read its denial names - never the same read in another shape or against a second path; before editing, read the body and what it calls.
- A shell read (`cat`, `sed`, `head`, `awk`, python, a heredoc) is the same read under the same rules. Only a plain one-file view (`cat`, `head`, `tail`, `sed -n`, `grep`, no pipe or redirect) attaches path-scoped rules; a shell write never does, so the read guard names the governing rule on the first shell write.
- Never fetch what is already in context, by any route - no repeat symbol lookup, no second read of an unchanged file or range; re-check an edit at the edited range only.
- No docs block at session start means no capture ran: say so once and navigate from code.
- What the STACK does or wants is read from its own artifacts - the owning command's doc for a reconcile, the rule or hook that reads a setting for what it does - never guessed by hand-comparing files.

## Locating symbols

- A job's tools are the ones the session-start tool order ranks for it, first rank first - for navigation the `LSP` tool when nothing else is registered (`workspaceSymbol` for a symbol, `findReferences` for its callers, `goToDefinition`, `documentSymbol` for a file's outline), then a scoped grep. The navigation tools and the documentation tools named across the stack are those ranks.
- Symbols, callers and resolved types go through the navigation tools inline, never an `Explore` / `general-purpose` dispatch (the dispatch guard blocks a symbol brief). A scoped grep for a literal you already located is fine; a symbol question is not, because name-matches lie - a grep answer is reported as name-matched, not resolved.
- Deferred tools are not held until loaded - naming them is not having them. Load a rank's tools with the `ToolSearch select:` line the tool order gives it, in one call; a seat whose tools grant them calls them directly.
- A symbol the first rank cannot resolve (a large or SDK-heavy C# solution indexes slowly) takes the next rank, down to the scoped grep. A tool that reports no language server for the file is a run-level fact: say so once, take the next rank, never re-issue the call class this run, and hand the fact to the seats you dispatch next.
- Edits go through Edit / Write, the tools the edit hooks watch; of a navigation server's own edit tools only a symbol rename or a safe delete is used.
- A large JSON / YAML / lock / fixture file is queried (a `node -e` projection - Git for Windows ships no `jq` - or `grep -n`, then a ranged Read), never read whole.
- A large file is outlined first (`documentSymbol`: its symbols and their line ranges), then read by range. `documentSymbol` takes ONE file, never a directory - list the directory first.
- An EMPTY reference result for a symbol that plausibly has callers is suspect (a multi-tsconfig monorepo hides cross-lib callers): cross-check with a grep before saying 'no callers'.

## Compact Instructions

- When compacting, keep verbatim what the next turn would otherwise re-read - the files modified, the live plan file's path and step, the build and test commands with their last result, every open ask with its answer - and drop tool output and file contents (measured: 18-file re-reads after a compaction).

## Shell commands

<!-- Kept in this file, not split into a rule of its own: these lines govern the same reads and writes as the sections above, and a separate pathless rule would add only frontmatter and a heading (HTML comments are stripped before injection, so this note costs nothing). -->

- A splice (`sed -i`, an in-place python or perl replace) is for a mechanical rename across many sites, never an edit Edit / Write can make; it counts its anchor first and replaces only when the count is the one it expects.
- Read `$?` on the very next line, with `set -o pipefail` before a pipe (bash and zsh both honour it; `${PIPESTATUS[0]}` reads empty in zsh); never `<cmd> || echo none`, which launders a failure into an empty result. A scan used as evidence of ABSENCE runs a must-match positive control in the same call, and resolves its tool absolutely or checks it with `type` first.
- Scratch code goes outside the tracked tree (the session scratchpad or the OS temp dir), or into a gitignored dir inside the repo when an ESM script must import the project's `node_modules`. An interrupted compound write may already have run - check the target before trusting the rejection.

## When the target is ambiguous

- Ambiguous reference with multiple matches: put the matches through AskUserQuestion (one option each, the likely one marked). Do not guess.
- Pasted code in chat is illustrative unless stated otherwise; confirm the target file before editing.
