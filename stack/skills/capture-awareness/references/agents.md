# Agents awareness - the inventory, the stamped usage policy, the routing map

Read when the agents part runs, then run `node "<caps>" --write` - `--write --refresh` when the arguments say
`refresh` - with `<caps>` the path the router's step 0 printed. Its printed block is the whole inventory and its
verdict lines say what happened; this reference says how to read each one. No questions.

`AGENTS-AWARENESS.md` is the one awareness file no person writes: `node "<caps>" --write` composes it from the copy
target below and the inventory it prints, compares it, writes it on differs and verifies what it wrote. The run adds no row, count or sentence of its own. The measurements behind these rules
are the stack repo's `docs/capture-awareness-evidence.md` - an audit appendix, never a run-time load.

## Contents

- **Read, never assumed** - why the inventory comes from disk and the CLI
- **The verdict lines** - PRECHECK, COMPARE, VERIFY and the refusals
- **The copy target** - the doc's shape and the usage policy stamped into it
- **How each section is filled** - the rules the script implements
- **The routing map** - one row per server the script can meet
- **The report's agents lines** - the flags and the four prose points

## Read, never assumed

Every project trims the stack differently - skills left out of the pick, MCP servers the user registered or never
did (the stack ships none), seats it never picked (each denied in `permissions.deny`). A predefined list would name
capabilities the project does not have; the script reads the REAL inventory - the slash-only orchestration
skills, the subagent seats, the MCP servers, the plugins - so every session knows exactly what this project can
do and is never steered at a capability that is not there.

**Its printed block is the whole inventory.** Re-grepping, re-Reading or hand-tallying anything it printed is a
defect, not diligence - every count and every row of the report comes off one of its lines, and a claim with no
printed line behind it does not go in the report. It probes the `claude` CLI without laundering a failure into an
empty result (`<cmd> || echo none`, banned in `alfred-navigation.md`) and without `| head -N`, so `CLI absent` and
`0 plugins` stay different report fields.

A thin `.claude/agents` is not by itself a broken install: the core carries the seats (every skill is a copy under
`.claude/skills`), so when a layer comes from plugins the script prints `SOURCE: PLUGIN-COVERED` and reports the
UNION - what the enabled plugins carry plus whatever is copied locally. Stop and say so only when it printed
neither a local nor a plugin source.

## The verdict lines

### PRECHECK - the script's first lines

- `PRECHECK: FIRST` - no doc yet; the run writes it.
- `PRECHECK: empty` - nothing under the inventory sources changed since the doc was written. The script still
  composes and compares, and writes only under `--refresh`. `COMPARE: identical` is the answer: one report line
  naming the `Captured:` date PRECHECK quotes, and the part is done. A `differs ... NOT WRITTEN` line names the sections
  that moved - two things the precheck cannot see: the PLUGIN list is machine-global (an enable or disable changes
  no file in this tree), and the USER may ask for a refresh outright. Either one is the only reason to re-run as
  `node "<caps>" --write --refresh` - say which one you are acting on.
- `PRECHECK: drift - <n> file(s)` - that is the drift. The run goes on, and the report names those paths.

### COMPARE, VERIFY and the refusals

- `COMPARE: identical - not rewritten` - nothing is written and there is nothing to verify. An identical rewrite
  pays a full write, and the next session pays the changed mtime.
- `COMPARE: differs - WRITTEN` - the whole file in one write, never an in-place Edit, `sed -i` or partial upsert:
  an edit keeps stale policy wording the skill has since changed. Do NOT `rm` it first and never hand-edit it
  after - the auto-mode classifier denies that delete, which costs exactly the blocked round trip the delete was
  meant to save. Its `VERIFY:` lines follow.
- `VERIFY: FAIL` or `COMPOSE: FAIL` - the copy target or the script is broken, a stack defect: report the line as
  it stands and stop. Never patch the doc by hand to make it pass.
- `WRITE: refused` - no local or plugin source: say so and stop.
- `IGNORED: no` - git would commit the doc. It names this machine's plugins, so it never belongs in a shared
  commit: the line names the path, and the report's Flags carry it with `/alfred-code:update`, which writes the
  data root's ignore line.

The verify checks that the policy-rev stamp and the policy block came over verbatim, that the inventory headings
are present, that every MCP row carries its `first call:` line, and - run alone - that the Plugins line matches a
fresh `claude plugin list`. `node "<caps>" --verify <docs-path>/awareness/AGENTS-AWARENESS.md` re-runs it alone.

## The copy target

The block below is a COPY TARGET the script fills, never prose to retype: each `<...>` slot from its own printed
lines, every `<docs-path>` with the LITERAL `DOCS ROOT` value (the doc is a deterministic pointer and cannot itself
carry the placeholder it exists to resolve), and the Plugins section dropped when the CLI probe failed:

```markdown
# Agents awareness - this project's capabilities

Captured: <the script's CAPTURED line>

## Usage policy (fixed - stamped verbatim, every run)
<!-- policy-rev: 508df73f -->
- Load a skill for the work at hand - a file you are about to edit, a command you are about to
  run, a diff you are about to show - never to answer a question the code or the conversation
  already answers.
- One home per rule: the project instruction file (AGENTS.md or CLAUDE.md) routes only what an auto-injected description does not
  cover; path-scoped rules own per-file-type routing, hooks own deterministic gates.
- Subagent dispatch is explicit, never automatic: a user @agent-<name> mention, an orchestration
  skill routing to it, or a repair-loop rule naming its resolver - never self-delegation off a
  description match. For multi-agent work, suggest the matching orchestration skill below, never one
  this project does not carry.
- A slash-only skill or plugin command (`disable-model-invocation` - listed below) is the USER's to
  type - never call it yourself or retry it under another spelling, and never spend the turn explaining
  that you cannot: name the command, say in one line what it does, hand the turn back
  (`guard-fresh-session-start.js` denies the call).
- A skill the user names that is not installed here (`Unknown skill`): say so and offer
  `/alfred-code:configure` to add it - never load another project's or a plugin cache's copy.
- A deliberate orchestration skill (a capture, a quality loop, a build flow) starts in a fresh
  session when this one already carries another run's history; `guard-fresh-session-start.js` blocks
  the call past the window trigger, answered with one AskUserQuestion (fresh session recommended).

## Orchestration skills (slash-only - invisible until invoked)
<the script's `/name - clause` rows, one per row>

## Subagent seats
<the script's SEATS name line - each seat under the name that RESOLVES: a seat from a plugin is
addressable only as `<plugin>:<seat>`, and a bare name returns 'Agent type not found'>

## MCP routing
<the script's `MCP ROUTING rows` block, pasted verbatim>

## Plugins
<the script's PLUGINS name line; omit the section when it printed `CLI absent`>
```

The usage-policy section is the house skill/agent policy's ONE home - it ships verbatim from this file (a policy
wording change lands here and reaches projects on their next re-run). The script copies the
`<!-- policy-rev: ... -->` line with it, unchanged: it is a content stamp over the block, recomputed by the stack's
own lint whenever the policy text moves, and it is the ONLY way to tell a project carrying a current copy from one
carrying a two-release-old one. `/alfred-code:validate` compares a project's stamp against the snapshot's.

## How each section is filled

The fill rules the script implements - read them to audit a row, never on a normal run. Every character written
into the doc is paid by every session and every subagent of the project (the rule imports it), so keep the rows
lean.

- **Orchestration skills** - one line per detected `disable-model-invocation` skill: `/name - <first clause, max
  120 chars>`. The row is a ROUTER, not the skill's documentation - the skill's own description is loaded anyway.
  House first sentences run 460-588 chars, so 'the first sentence' is not the cap; the first CLAUSE at 120 chars
  is. The inventory marks the model-invocable-by-design captures - listed with this set, marked as such.
- **Subagent seats** - one line: the installed seat names, comma-separated - dispatch is explicit only (@agent-,
  an orchestration skill, or a repair-loop rule); each seat's description says when it applies.
- **MCP routing** - one row per server that reaches the session - registered in `.mcp.json`, or provided by an
  enabled plugin (the default route, where `.mcp.json` holds none) - from the routing map below; an unknown server
  gets its name + 'routing: see project docs'. Never write 'None registered' over a plugin-provided server: that
  rule made 0 MCP calls in 12 pilot cells. EVERY row ends with its `first call:` line - the exact
  `ToolSearch select:...` that loads that server's load-bearing tools.
  MCP tools arrive DEFERRED in this harness: the names exist, the schemas do not, and a deferred tool cannot be
  called until it is loaded. A row that says WHEN to use a server and not HOW to load it describes a capability the
  session cannot reach - naming a server is not loading it, and the `first call:` line is the row's load-bearing
  half. The script's `MCP ROUTING rows` block is what `--write` puts in the doc, and `--verify` fails the doc when
  a row reached it without a `first call:` or with a slot left unfilled. `<server>` in a row is substituted with the
  server's name (a browser server registered once per engine, `playwright-<engine>`, takes the `playwright` row),
  and `<data root>` and `<docs-path>` with this project's literal values. The map names the plugin spelling,
  `mcp__plugin_<server>_<server>__<tool>`, which is what a plugin-provided server answers; a `.mcp.json`
  registration answers `mcp__<server>__<tool>`, so the script re-spells a registered server's row to that form. A
  registration wins a name a plugin also provides.
- **Plugins** - ONE line, comma-separated, each entry exactly `<name> (<state>)` - the script's `PLUGINS` line,
  already deduped and already in that shape. No WHY clause: `claude plugin list` is machine-global, so this line
  reports STATE and never cause. The section is omitted entirely when the script printed `CLI absent` instead of a
  count.

## The routing map

The routing map (only for servers actually present; keyed by the name each one has in the record of the servers
the stack once shipped, `stack/mcp/original-mcps.json` - a server registered under another name gets the
unknown-server row):
- `playwright` - the browser server (Playwright MCP): drive a browser for visual checks / large HTML reports - don't text-read them. Screenshots: omit `filename` (auto-names land in the server's `--output-dir`), or prefix an explicit name with that dir - the server resolves explicit filenames against the repo ROOT, so a bare name litters the repo. Readback discipline: verify UI state via `browser_snapshot` / `browser_evaluate` (DOM assertions), or a `target`-scoped screenshot for a localized visual check - a full-page PNG Read is for the FINAL accepted state only, never the iteration loop. first call: `ToolSearch select:mcp__plugin_<server>_<server>__browser_snapshot,mcp__plugin_<server>_<server>__browser_evaluate,mcp__plugin_<server>_<server>__browser_wait_for`, plus the other `mcp__plugin_<server>_<server>__*` names the session's own listing shows.
- `windows-desktop` - the Windows desktop server (Windows-MCP): drive a native Windows app (WPF, WinForms, Win32, UWP, Office, Explorer) through its UI Automation tree - Snapshot, ONE action on an element that snapshot listed, Snapshot or WaitFor again before the next; stop at an elevation, credential, payment or destructive dialog and hand it to the user; stay in the UI - `PowerShell`, `Registry`, `Process` and `FileSystem` stay excluded (`--exclude-tools`), and a house guard denies `App` in `launch_executable` mode unless `<data root>/state/approvals/DESKTOP-EXEC-ALLOW` allows it. The skill covering desktop automation holds the loop, where the install has it. first call: `ToolSearch select:mcp__plugin_<server>_<server>__Snapshot,mcp__plugin_<server>_<server>__Click,mcp__plugin_<server>_<server>__Type,mcp__plugin_<server>_<server>__WaitFor`, plus the other `mcp__plugin_<server>_<server>__*` names the session's own listing shows.
- `macos-desktop` - the macOS desktop server (MacOS-MCP): drive a native macOS app through its Accessibility tree - Snapshot, ONE coordinate action taken from that snapshot, Snapshot again. A server that fails to connect at start while System Settings opens is missing a grant, its log names which, and only the user can give it (`MACOS_MCP_SKIP_PERMISSION_CHECK=1` starts it ungranted, and only then is a snapshot empty); a black vision snapshot (Snapshot with use_vision - MacOS-MCP has no Screenshot tool) means the Screen Recording grant. Stop at an elevation, credential, payment or destructive dialog; a house guard denies `Shell` unless `<data root>/state/approvals/DESKTOP-EXEC-ALLOW` allows it. The skill covering desktop automation holds the loop, where the install has it. first call: `ToolSearch select:mcp__plugin_<server>_<server>__Snapshot,mcp__plugin_<server>_<server>__Click,mcp__plugin_<server>_<server>__Type,mcp__plugin_<server>_<server>__App`, plus the other `mcp__plugin_<server>_<server>__*` names the session's own listing shows.
- `appium-mcp` - the mobile server (appium-mcp): drive an Android or iOS app on an emulator, a simulator or a device - `select_device` when more than one is attached, then `appium_session_management` action=create with the platform; per step, `appium_find_element` (accessibility id first), ONE action (`appium_gesture` tap, `appium_set_value`), then verify with `appium_get_text` or `appium_get_page_source` saveToFile=true (it lands in the server's `PAGE_SOURCES_DIR`) - a screenshot (in its `SCREENSHOTS_DIR`) is Read for the FINAL state only; action=delete ends the session. An app installs from a local build path - keep `ALLOW_REMOTE_APP_URLS` false and `REMOTE_SERVER_URL_ALLOW_REGEX` on localhost unless the user set them; stop at a login, credential, payment or destructive dialog and hand it to the user. first call: `ToolSearch select:mcp__plugin_<server>_<server>__appium_session_management,mcp__plugin_<server>_<server>__appium_find_element,mcp__plugin_<server>_<server>__appium_gesture,mcp__plugin_<server>_<server>__appium_get_page_source`, plus the other `mcp__plugin_<server>_<server>__*` names the session's own listing shows.
- an issue-tracker connector - tracker read-write; ticket skills write the content, the connector files it - confirm before filing. It reaches the session from the account or the harness, so it has no `.mcp.json` row and no row here: the script prints it under the live list, and it earns a row only when the project registered it. first call: `ToolSearch select:` plus that connector's own `mcp__*` names the session's listing shows.

## The report's agents lines

The part's field template, one line per field (a table where a field lists several items):

```text
Agents:      <the script's Doc: line>; Verify: <its Verify: line>
Inventory:   <the script's Inventory: line>; Drift: <its Drift: line>
Flags:       <one row each, or none>
```

The script's `REPORT` block prints the `Doc:`, `Verify:`, `Inventory:` and `Drift:` lines filled - copy them as
they stand, the `Inventory:` figures included (never re-add or re-pick a count). Then, each its own line so none
is skimmed past:

- **The flags are MECHANICAL - read them off the block, do not eyeball them**: the script's `seat families` line
  against its path-scoped rule rows is the convention-rule cross-check (a family whose stack no rule names); a
  slash-only skill whose seats are not installed is the second; and each `FLAG:` line - a plugin whose CLI row and
  settings disagree, or one this project's settings enable with no CLI row for this path - is a row as it stands
  (its `decided by` line names the row the state came from).
- **Never infer causation from a machine-global listing** - state observed facts plainly ('typescript-lsp: listed
  disabled'), and never assert WHY something is installed or disabled: `claude plugin list` is machine-global, so
  install-scope causation read off it is a guess.
- **The doc is MACHINE-LOCAL** - the data root's ignore file keeps `AGENTS-AWARENESS.md` out of git, so a fresh
  clone does not carry it and this capture has to be re-run there.
