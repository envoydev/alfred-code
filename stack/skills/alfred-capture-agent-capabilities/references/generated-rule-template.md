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
One row per server that reaches the session - registered in `.mcp.json`, or provided by an enabled
plugin (the default route, where `.mcp.json` holds none) - from the routing map below; an unknown
server gets its name + 'routing: see project docs'. Never write 'None registered' over a plugin-provided
server: that rule made 0 MCP calls in 12 pilot cells. EVERY row ends with
its `first call:` line - the exact `ToolSearch select:...` that loads that server's load-bearing
tools; the locked servers share one row whose first call is the select line each of their
always-on baselines already carries, so the rule never pays for it twice. MCP tools arrive DEFERRED in this harness: the names exist, the schemas do not, and a
deferred tool cannot be called until it is loaded. A row that says WHEN to use a server and not HOW
to load it describes a capability the session cannot reach - naming a server is not loading it,
and the `first call:` line is the row's load-bearing half. Copy each one VERBATIM.

`scripts/capabilities-inventory.js` prints these rows already filled, one per server and one for
the locked servers present - its `MCP ROUTING rows` block is the paste source, and `--verify` fails
the rule when a row reached it without a `first call:` or with a slot left unfilled. The map below is
what the script reads; `<server>` in a row is substituted with the server's name (`browser` ships as
one plugin, and one server, per kept browser), and `<data root>`, `<engine>` and `<docs-path>` with
this project's literal values. The map names the
plugin spelling, `mcp__plugin_<server>_<server>__<tool>`, which is what a plugin-provided server
answers; a `.mcp.json` registration answers `mcp__<server>__<tool>`, so the script re-spells a
registered server's row to that form. A registration wins a name a plugin also provides.

The routing map (only for servers actually present):
- `navigation`, `documentation`, `memory` - the locked servers load and route as their baselines say (`alfred-navigation.md`, `alfred-quality-gates.md`, `alfred-memory.md`); the navigation server keeps symbol lookup, `rename_symbol`, `safe_delete_symbol` and the seat memory handoff, and every other edit goes through Edit / Write. first call: the `ToolSearch select:` line its baseline names.
- `browser` - the browser server (Playwright MCP): drive a browser for visual checks / large HTML reports - don't text-read them. Screenshots: omit `filename` (auto-names land in the engine's registered output dir, `<data root>/browser/<engine>/output/`), or prefix an explicit name with that dir - the server resolves explicit filenames against the repo ROOT, so a bare name litters the repo. Readback discipline: verify UI state via `browser_snapshot` / `browser_evaluate` (DOM assertions), or a `target`-scoped screenshot for a localized visual check - a full-page PNG Read is for the FINAL accepted state only, never the iteration loop. first call: `ToolSearch select:mcp__plugin_<server>_<server>__browser_snapshot,mcp__plugin_<server>_<server>__browser_evaluate,mcp__plugin_<server>_<server>__browser_wait_for`, plus the other `mcp__plugin_<server>_<server>__*` names the session's own listing shows.
- `windows-desktop` - the Windows desktop server (Windows-MCP): drive a native Windows app (WPF, WinForms, Win32, UWP, Office, Explorer) through its UI Automation tree - Snapshot, ONE action on an element that snapshot listed, Snapshot or WaitFor again before the next; stop at an elevation, credential, payment or destructive dialog and hand it to the user; stay in the UI - `PowerShell`, `Registry`, `Process` and `FileSystem` are off by default, and a house guard denies `App` in `launch_executable` mode unless `<docs-path>/flow/DESKTOP-EXEC-ALLOW` allows it. The skill covering desktop automation arrives with this server and holds the loop. first call: `ToolSearch select:mcp__plugin_<server>_<server>__Snapshot,mcp__plugin_<server>_<server>__Click,mcp__plugin_<server>_<server>__Type,mcp__plugin_<server>_<server>__WaitFor`, plus the other `mcp__plugin_<server>_<server>__*` names the session's own listing shows.
- `macos-desktop` - the macOS desktop server (MacOS-MCP): drive a native macOS app through its Accessibility tree - Snapshot, ONE coordinate action taken from that snapshot, Snapshot again. A server that fails to connect at start while System Settings opens is missing a grant, its log names which, and only the user can give it (`MACOS_MCP_SKIP_PERMISSION_CHECK=1` starts it ungranted, and only then is a snapshot empty); a black vision snapshot (Snapshot with use_vision - MacOS-MCP has no Screenshot tool) means the Screen Recording grant. Stop at an elevation, credential, payment or destructive dialog; a house guard denies `Shell` unless `<docs-path>/flow/DESKTOP-EXEC-ALLOW` allows it. The skill covering desktop automation arrives with this server and holds the loop. first call: `ToolSearch select:mcp__plugin_<server>_<server>__Snapshot,mcp__plugin_<server>_<server>__Click,mcp__plugin_<server>_<server>__Type,mcp__plugin_<server>_<server>__App`, plus the other `mcp__plugin_<server>_<server>__*` names the session's own listing shows.
- an issue-tracker connector - tracker read-write; ticket skills write the content, the connector files it - confirm before filing. It reaches the session from the account or the harness, so it has no `.mcp.json` row and no row here: the script prints it under the live list, and it earns a row only when the project registered it. first call: `ToolSearch select:` plus that connector's own `mcp__*` names the session's listing shows.

## Plugins
ONE line, comma-separated, each entry exactly `<name> (<state>)` - the script's `PLUGINS` line,
already deduped and already in that shape. No WHY clause: `claude plugin list` is machine-global,
so this line reports STATE and never cause. Omit the section entirely when the script printed
`CLI absent` instead of a count.
