# MCP servers the stack used to ship

The stack ships, registers and launches no MCP server since 2.10.1 (the user's ruling of 2026-10-24). This is the list of
what it shipped until then, so a server can be added back by hand. Read only - nothing in the stack loads this file.

- `original-mcps.json` - each server under its ORIGINAL name, a paste-ready `.mcp.json` entry. Register one with
  `claude mcp add-json <original name> '<entry>' -s <scope>`.
- `shipped-mcps.json` - how each one shipped up to `f779a349`: the plugin-route entry, the copy-route template, the
  pins, the launchers and the navigation context. Only the retire path in `scripts/install/mcp.js` reads it.
- `setup-plugin/references/update-history.md` 'after 2.10.0 - the stack ships no MCP server' - the user-facing record.

## The servers

| Stack name | Original name | Job | Package at the cut-off | Data it left |
|---|---|---|---|---|
| `alfred-navigation` | `serena` | code navigation: symbols, references, reference-aware rename and delete | `serena-agent` 2.1.0 (PyPI) | `.alfred/serena/` index |
| `alfred-documentation` | `context7` | library documentation, hosted at `https://mcp.context7.com/mcp` | none (HTTP, key `CONTEXT7_API_KEY`) | none |
| `alfred-memory` | `memory` | persistent memory and the seats' handoff notes (sqlite-vec) | `mcp-memory-service` 12.1.1 (PyPI) | `~/.alfred-memory/memory.db` |
| `chrome-control` | `playwright-chrome` | browser control, Chrome | `@playwright/mcp` 0.0.83 (npm) | `.alfred/chrome-control/` profile |
| `msedge-control` | `playwright-msedge` | browser control, Edge | `@playwright/mcp` 0.0.83 (npm) | `.alfred/msedge-control/` profile |
| `firefox-control` | `playwright-firefox` | browser control, Firefox | `@playwright/mcp` 0.0.83 (npm) | `.alfred/firefox-control/` profile |
| `webkit-control` | `playwright-webkit` | browser control, WebKit | `@playwright/mcp` 0.0.83 (npm) | `.alfred/webkit-control/` profile |
| `windows-control` | `windows-desktop` | Windows desktop control (PowerShell, Registry, Process, FileSystem tools off) | `windows-mcp` 0.8.8 (PyPI, Python 3.14) | none |
| `macos-control` | `macos-desktop` | macOS desktop control | `macos-mcp` 0.4.6 (PyPI) | none |
| `mobile-control` | `appium-mcp` | Android / iOS control through Appium | `appium-mcp` 1.97.1 (npm) | `.alfred/mobile-control/` captures |

Ten servers, ten entries in `original-mcps.json` (the four browsers are one package under four profiles). The data stays where it was when an install updates onto 2.10.1 or later; delete it only once no server added
back and no other project on an older release still reads it.

## Where it goes now

- Navigation: the `LSP` tool, then a scoped grep. Library docs: the vendor's page through `WebFetch`. Handoff notes:
  files under `<data root>/state/handoff/`. A registered server can be ranked first with `/capture-preferences tools`.
- The mechanism notes are in `.claude/rules/repo-mcp.md`.
