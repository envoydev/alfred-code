---
description: House baseline - code navigation and reading. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Navigation and code reading

## What to read

- Read only what's needed: Read is for code already located, never a whole file to find a symbol - `guard-read-whole-file.js` blocks that Read (and the same dump via cat/sed) on a large source file, so it only costs the round trip. A BLOCKED read is answered with the ranged read its denial names, never the same read in another shape or against a second path. Before editing, read the body end-to-end and any function it depends on.
- **Everything on this page holds when the session is working through the SHELL.** Reading a file with `cat`, `sed`, `head`, `awk`, python or a heredoc is the same read, answering to the same ladder and the same ranged discipline - the tool used is not the rule. This is also where the path-scoped rules stop attaching, which is why `guard-read-whole-file.js` names the governing rule on the first shell write to a governed file.
- Never fetch what is already in context, BY ANY ROUTE: no repeat `find_symbol` for a symbol fetched this session, and no second read - a `Read` or any shell form above - of a file or range already in context and unchanged since. Re-check an edit at the edited range only.
- The ranged discipline covers background-task output too: poll a running task through the harness's own task tool when available (`Monitor`), else tail or ranged-Read the log's NEW lines - never re-Read the whole growing file per check.
- **Never Read a screenshot mid-loop.** An image result is base64 in the transcript and is re-sent as cache-read on every later turn, so one iteration read is paid for the rest of the session: verify UI state with DOM assertions (a snapshot / evaluate call) while iterating, and reserve an image read for the FINAL accepted state, target-scoped rather than full-page.
- **Orient from the project's own architecture docs before deriving the project by reading code.** When the question is structure, boundaries, patterns in use, or where a change belongs, the map is `<docs-path>/architecture/ARCHITECTURE.md` with its deep dives under `architecture/references/`, and the pros/cons read is `quality/ASSESSMENT.md` (`baseline-docs-root.md` names this install's resolved root). Read by section - `node .claude/hooks/docs.js where <path>` names the sections covering a file and `show <file>#<id>` prints one - which replaces re-deriving the project from its source. For a specific symbol the CODE wins: a doc contradicting what the navigation server resolves is stale rather than authoritative. No `architecture/` under the docs root means the capture has never run - say so once and navigate from code.
- **A question about what the STACK does or wants is READ from the stack's own artifacts, never guessed or inferred by hand-comparing files.** A reconcile - 'does X need updating after Y', 'should this file be regenerated', 'what does the update prune' - is defined by the owning command's doc, one cheap read; what a setting does and when it takes effect, by the rule or hook that reads it.

## Locating symbols

- Locate symbols, callers, and resolved types with the `navigation` server (Serena) - inline, never delegated to `Explore` / `general-purpose` (the dispatch guard blocks a symbol-shaped brief to those seats); reserve those for genuinely broad multi-file sweeps. An installed `LSP` plugin adds compiler-exact lookups and inline diagnostics for its language. The boundary is the QUESTION, not the command: a scoped grep for a literal you already located (a config key in a known file, a log marker) is fine; a symbol question - who calls this, where is it declared, what type resolves here - goes through the navigation server/LSP, because grep answers it by name-match and name-matches lie.
- The navigation-server tools are DEFERRED behind tool search in this harness - naming them is not having them. Load the three the ladder above depends on with one call: `ToolSearch select:mcp__plugin_navigation_navigation__find_symbol,mcp__plugin_navigation_navigation__find_referencing_symbols,mcp__plugin_navigation_navigation__get_symbols_overview`. A rung you never loaded is a rung you will skip.
- If the navigation server's language server can't resolve a symbol - a large or SDK-heavy solution where it indexes slowly or not at all (notably C# / Roslyn) - fall back to the installed `LSP` plugin for that language for the lookup; with no LSP plugin for the language either, a scoped grep is the last resort and the answer is reported as name-matched, not resolved. The navigation server still owns symbol edits and the memory handoff, neither of which depends on its language server.
- **`Active language servers: []` is a run-level fact, not a per-call failure.** The first navigation-server
  symbol call that comes back with an empty server list means the LSP is not up for this project:
  say so ONCE, switch to the fallback ladder above, and never re-issue the same class of call for
  the rest of the run. Repeating it is the waste: every repeat costs a round trip to learn what the first call already
  said. A dispatching skill passes the fact to the seats it fans out next, so they start on the
  fallback instead of rediscovering it one by one.
- **Where the navigation server has nothing to serve** - a language `.serena/project.yml` does not list, or a large JSON / YAML / lock / fixture file - the ranged discipline still holds: the language takes the LSP-then-grep ladder above from its first call, and a data file is queried (`jq '.path'`, `grep -n` to the key, then a ranged Read), never read whole.
- The navigation server is the cheap path only while the symbol is small: for a large body, fetch the symbol WITHOUT its body first (signature/children), then Read the range you need - a multi-thousand-token symbol body costs more than the ranged Read it was meant to avoid.
- `get_symbols_overview` takes ONE file, never a directory - enumerate a module with a directory listing or Glob first, then overview the files that matter (a directory call only errors and costs the round trip).
- An EMPTY reference result for a symbol that plausibly has callers is suspect, not proof: in a multi-tsconfig monorepo without composite project references, the navigation server and the LSP share the same cross-lib blind spot - cross-check with a grep before concluding 'no callers'.
- Navigation-server memories are name-addressed: `write_memory` replaces a note whole, `read_memory` / `list_memories` fetch it. An in-place EDIT of one memory is not a shape to recall - the tool list is the authority, so check it before the first edit call and, on a repeated schema error, read the tool's own parameter list instead of guessing again.

## Compaction

- **When compacting, keep verbatim what the next turn would otherwise re-read**: the list of files modified this session, the live plan file's path and the step it is on, the build and test commands with their last result, and every open ask with the user's answer. Drop tool output and file contents - they are on disk. Measured: two sessions each re-read 18 files after a compaction, one of them the plan the summary should have carried; the analyzer's compaction re-read row is where this line is checked.

## Shell commands

- A glob that belongs to the TOOL is single-quoted: `grep --include='*.cs'`, `rg --glob '*.ts'`, `find . -name '*.md'`. Left bare, the SHELL expands it first - and zsh aborts the whole command on an unmatched glob (`zsh:1: no matches found: --include=*.cs`) with status 1, which is EXACTLY what a genuine no-match returns, and `2>/dev/null` does not suppress the message. The command never ran, the harness flags no error, and the run reads the empty result as 'nothing there'. Measured many times, including a security scan whose 'no secrets found' was an aborted command.
- A splice - `sed -i`, a python or perl in-place replace - asserts its anchor appears EXACTLY ONCE before it replaces anything: count first, and only then substitute.
- **A command's exit status is read immediately or it is gone.** Capture `$?` (or `${PIPESTATUS[0]}` when the command you care about is not the last in a pipe) on the very next line. And never write `<cmd> || echo none`: the fallback launders a FAILURE into the same output an empty result gives. A scan used as evidence of ABSENCE runs a must-match positive control in the same call, and resolves its tool absolutely or checks it with `type` first.
- On Windows, a Git Bash `/tmp/x` path is a mount spelling native `node` cannot open - it resolves against the current drive: pass it through `cygpath -w`, or write the file under `$TEMP`.
- Throwaway probe/scratch code (a diagnostic dump, a hypothesis check) is written OUTSIDE the tracked tree - the harness scratchpad (the OS temp dir - the outside tree the cross-project write guard keeps open for scratch) or a gitignored dir inside the repo - never into the project's source or test folders. One known trap: an ESM scratch script cannot `import` the project's `node_modules` from outside the repo (NODE_PATH is ignored by ESM) - the fallback is a GITIGNORED dir inside the repo, never the tracked root. And an interrupted compound write (heredoc, chained command) may have already executed before the interrupt - existence-check the target instead of trusting the rejection.

## When the target is ambiguous

- Ambiguous reference with multiple matches: put the matches through AskUserQuestion (one option each, the likely one marked). Do not guess.
- Pasted code in chat is illustrative unless stated otherwise; confirm the target file before editing.
