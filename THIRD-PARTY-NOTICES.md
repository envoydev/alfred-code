# Third-party notices

Alfred Code is MIT-licensed (see [LICENSE](LICENSE)). The material below is not original to this repository or is referenced from another project. Each row names where it sits here and under which licence its source is published.

| Material | Where | Source and licence |
|---|---|---|
| The navigation server's context file that 2.10.0 shipped | `stack/mcp/shipped-mcps.json` (its `navigationContext` field, kept as the record of that release; no install writes it since 2.10.1) | Derived from Serena's `claude-code` context (`src/serena/resources/config/contexts/claude-code.yml`, serena-agent 2.1.0, byte-identical to 1.7.0's and 2.0.0's; the text records the upstream hash). That path belongs to the Serena application, which Oraios AI publishes under GPL-3.0-or-later; the derived text stays under those terms. Serena's texts: `LICENSES/` in [oraios/serena](https://github.com/oraios/serena). |
| claude-hud setup shapes | `scripts/hud-statusline.js` | The command and layout shapes of claude-hud 0.8.0 are read and written, not copied. claude-hud is MIT, Copyright (c) 2026 Jarrod Watts ([jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud)). The plugin itself is installed from its own marketplace and is not shipped here. |

Since 2.10.1 the stack installs no MCP server; the servers earlier releases installed (Serena, Context7, Playwright MCP, the memory service, the desktop servers and appium-mcp) are named in `stack/mcp/original-mcps.json` so a user can add one back from its own package. The optional LSP plugins are installed from their own packages at pinned versions. None is redistributed in this repository, and each keeps its own licence.
