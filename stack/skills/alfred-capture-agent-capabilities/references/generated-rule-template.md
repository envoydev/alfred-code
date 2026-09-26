# Generated rule - fill rules for the inventory sections, plus the house MCP routing map

Read at step 2 GENERATE, before the rule body is composed. The SHAPE of the generated rule
(frontmatter, `Captured:` line, the stamped usage policy, the four inventory headings) is the copy
target in SKILL.md; this file says how each inventory section is FILLED. Every character written
into the generated rule is paid by every session and every subagent of the project - keep the rows
lean.

## Orchestration skills (slash-only - invisible until invoked)
One line per detected `disable-model-invocation` skill: `/name - <first clause, max 120 chars>`.
The row is a ROUTER, not the skill's documentation - the skill's own description is loaded anyway.
House first sentences run 460-588 chars, so 'the first sentence' is not the cap; the first CLAUSE
at 120 chars is. The inventory step marks the one model-invocable-by-design exception - list it
with this set, marked as such.

## Subagent seats
One line: the installed seat names, comma-separated - dispatch is explicit only (@agent-, an
orchestration skill, or a repair-loop rule); each seat's description says when it applies.

## MCP routing
One row per REGISTERED server only, from the routing map below - a server absent from `.mcp.json`
gets no row, and an unknown server gets its name + 'routing: see project docs'. EVERY row ends with
its `first call:` line - the exact `ToolSearch select:...` that loads that server's load-bearing
tools. MCP tools arrive DEFERRED in this harness: the names exist, the schemas do not, and a
deferred tool cannot be called until it is loaded. A row that says WHEN to use a server and not HOW
to load it describes a capability the session cannot reach - naming a server is not loading it,
and the `first call:` line is the row's load-bearing half. Copy each one VERBATIM.

`scripts/capabilities-inventory.js` prints these rows already filled, one per registered server -
its `MCP ROUTING rows` block is the paste source, and `--verify` fails the rule when a row reached
it without a `first call:`. The map below is what the script reads; `<server>` in a row is
substituted with the registered name (`browser` ships as one plugin, and one server, per kept
browser). The map names the plugin spelling, `mcp__plugin_<server>_<server>__<tool>`; a `.mcp.json`
registration answers `mcp__<server>__<tool>`, so the script prints every row in that form.

The routing map (only for servers actually present):
- `navigation` - the navigation server (Serena): default symbol navigator + symbol-level editor; `find_symbol` / `find_referencing_symbols` before any whole-file Read; also holds the per-project handoff memory (`.serena/memories/`). first call: `ToolSearch select:mcp__plugin_navigation_navigation__find_symbol,mcp__plugin_navigation_navigation__find_referencing_symbols,mcp__plugin_navigation_navigation__get_symbols_overview` (add `,mcp__plugin_navigation_navigation__write_memory,mcp__plugin_navigation_navigation__read_memory,mcp__plugin_navigation_navigation__list_memories` for a seat handoff).
- `documentation` - the documentation server (Context7): up-to-date docs for any API you don't own; resolve + query before writing against a third-party or version-sensitive surface, never from recall - and through these tools, not a shell fallback (`npx`, a registry `curl`), which answers a different question and leaves the registered server unused. first call: `ToolSearch select:mcp__plugin_documentation_documentation__resolve-library-id,mcp__plugin_documentation_documentation__query-docs`.
- `memory` - the shared memory (required, not a routing option): preferences, corrections, project
  facts and agent lessons, one database per install's chosen level (`baseline-memory.md` names what
  belongs and when); search before asking the user something they may have already said, or before
  reading a related project's repo. first call: `ToolSearch select:` plus the `mcp__plugin_memory_memory__*` names the session's own listing shows.
- `browser` - the browser server (Playwright MCP): drive a browser for visual checks / large HTML reports - don't text-read them. Screenshots: omit `filename` (auto-names land in the registered output dir, `.playwright/output/`), or prefix an explicit name with `.playwright/output/` - the server resolves explicit filenames against the repo ROOT, so a bare name litters the repo. Readback discipline: verify UI state via `browser_snapshot` / `browser_evaluate` (DOM assertions), or a `target`-scoped screenshot for a localized visual check - a full-page PNG Read is for the FINAL accepted state only, never the iteration loop. first call: `ToolSearch select:mcp__plugin_<server>_<server>__browser_snapshot,mcp__plugin_<server>_<server>__browser_evaluate,mcp__plugin_<server>_<server>__browser_wait_for`, plus the other `mcp__plugin_<server>_<server>__*` names the session's own listing shows.
- an issue-tracker connector - tracker read-write; ticket skills write the content, the connector files it - confirm before filing. It reaches the session from the account or the harness, so it has no `.mcp.json` row and no row here: the script prints it under the live list, and it earns a row only when the project registered it. first call: `ToolSearch select:` plus that connector's own `mcp__*` names the session's listing shows.

## Plugins
ONE line, comma-separated, each entry exactly `<name> (<state>)` - the script's `PLUGINS` line,
already deduped and already in that shape. No WHY clause: `claude plugin list` is machine-global,
so this line reports STATE and never cause. Omit the section entirely when the script printed
`CLI absent` instead of a count.
