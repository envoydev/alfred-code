---
paths:
  - "stack/mcp/**"
  - "meta/mcp-*.json"
  - "scripts/install/mcp.js"
  - "scripts/lint-mcp-tools.js"
  - "scripts/refresh-mcp-pins.js"
  - "scripts/build-marketplace.js"
---

# MCP servers - the record and the retire path

The stack ships, registers and launches no MCP server since 2.10.1 (the user's ruling of 2026-10-24). This part holds what is left: the record of what it shipped, the retire path that takes an older install's servers out, the name checks, and the pinned tool lists the tool preferences read. The machinery the servers needed (one plugin per server, the launchers, the pinned Python, Serena's anchoring, the copy route) is in git history before 2.10.1 and summarised in the record - never rebuild it from memory.

## The record (read only)

- `stack/mcp/original-mcps.json` - each server under the ORIGINAL name it came from (`serena`, `context7`, `memory`, `playwright-<engine>`, `windows-desktop`, `macos-desktop`, `appium-mcp`), a paste-ready `.mcp.json` entry. The add-back lines register these names.
- `stack/mcp/shipped-mcps.json` - how each server shipped up to f779a349: the stack name and its original, the plugin-route entry, the copy-route templates (`@TOKEN@` placeholders, `rootBoot`, the hosted `remotes`), the pins and cut-off, the Python, the launchers, the navigation context. Only `scripts/install/mcp.js` reads it, for the shapes the retire path vouches for.
- `meta/stack-manifest.json` `retired.mcps` and one `meta/retired-plugins.json` row per id an install can still hold (`retiredIn: '2.10.1'`, `addBack`) - the 2.0.0 and 2.2.0 renamed ids included, each with its successor's add-back.
- `setup-plugin/references/update-history.md` 'after 2.10.0 - the stack ships no MCP server' is the user-facing record; lint 67 exempts that file alone.

## The retire path (update and uninstall)

The first update onto 2.10.1 or later (`mcp.dueRetired`, the stamp's release before the row's `retiredIn`) takes out what an earlier release left; `scripts/install-mcp-retire.test.js` and `scripts/install-mcp-migrate.test.js` pin it.

- **Plugins:** each retired server plugin is uninstalled as `name@<row's marketplace>` at the scopes the stack put it (`plugins.prunedRetired`); a row at another scope is kept and named, and a stale `enabledPlugins` key no record reaches leaves the project's settings (`plugins.dropStaleRetired`).
- **Registrations** (`alfred-code.js retireMcps`): a copy-route row goes only where the stack vouches for it - the ledger's row unchanged, or with no ledger, and at local and user scope, the release template's exact shape (`mcp.exactStack`). Anything else under the name is the user's: kept and named once with `claude mcp remove <name> -s <scope>`. A registration under an original name (`mcp.ADD_BACK_NAMES`) is the user's add-back, never pruned or named.
- **The account `.claude.json` is never hand-edited:** local- and user-scope rows go through `claude mcp remove`; a file the CLI replaced since the stamp is read through its backups (`mcp.accountLoss`).
- **`.mcp.json` is a tracked file:** a run that touches it gives back its bytes, BOM, line ends, indent and key order (`mcp.keepMcpOrder`); one the prune empties goes (`dropEmptiedMcpJson`); one that cannot be read is left as it is, every approval with it.
- **The rest** (`retiredServersStep`, spec N4): every name the stack ever registered leaves `enabledMcpjsonServers` / `disabledMcpjsonServers` unless `.mcp.json` still holds it (`retiredApprovals`); the `deniedMcpServers` rows lift unless a broader registration remains (`liftMcpDenied`); Claude's own `autoMemoryEnabled: false` the memory level wrote lifts from the run's settings file (`liftMemorySwitchOff`, update and uninstall, only for a stamp before 2.10.1 - so a matrix case for it runs from a bumped export); the retired env keys go.
- **One block says it** (`sayRetiredServers`): the names that went, `stack/mcp/original-mcps.json`, one `claude mcp add-json` line per server (none for a name this scope already registers) and the server data left in place - the navigation index, the browser profiles, the mobile captures, the memory database. Nothing is moved or deleted.

## Name checks and pinned tool lists

- `scripts/lint-mcp-tools.js` holds three checks, and a deliberate line carries `mcp-fixture` in a comment:
  - 54 - a bare `mcp__<server>__` of a name the stack ever shipped, renamed or retired, under `stack/`, `setup-plugin/`, `meta/`, `scripts/`;
  - 59 - a plugin spelling `mcp__plugin_<p>_<s>` whose plugin ships no server - with none shipped, every concrete one;
  - 67 - an MCP tool spelling or a retired server id (`retiredServerIds`: `retired.mcps` meeting the newest `retiredIn` rows) in a shipped skill, rule, seat or command body (spec N8); placeholders like `mcp__<server>__` and the release record are not findings.
- `meta/mcp-pins.json` and `meta/mcp-tools.json` stay as the KNOWN TYPES' data: each server type's pinned version and tool list, folded into `meta/tool-adapters.json`'s built copy (`npm run tool-adapters`), so the hooks and the tool preferences capture know a registered server by its tools without starting it. `node scripts/refresh-mcp-pins.js --write` moves them deliberately, never an install; its serena gate (R7) refuses a bump whose upstream `claude-code.yml` no longer hashes as the serena adapter row's `upstream` field records. That row's `off` list - the six tools upstream `claude-code` turns off - makes the table list what the record's add-back launch serves; the stack's own context left with its launcher in 2.10.1, its text kept in `shipped-mcps.json` (`navigationContext`).
- `scripts/build-marketplace.js` lists no MCP entry: `mcpEntry` drops every server entry an older marketplace held.
