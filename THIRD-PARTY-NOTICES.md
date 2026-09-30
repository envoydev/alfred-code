# Third-party notices

Alfred Code is MIT-licensed (see [LICENSE](LICENSE)). The material below is not original to this repository or is referenced from another project. Each row names where it sits here and under which licence its source is published.

| Material | Where | Source and licence |
|---|---|---|
| The navigation server's context file | `stack/mcp/navigation-context.yml` | Derived from Serena's `claude-code` context (`src/serena/resources/config/contexts/claude-code.yml`, serena-agent 1.7.0; the file records the upstream hash). That path belongs to the Serena application, which Oraios AI publishes under GPL-3.0-or-later; the derived file stays under those terms. Serena's texts: `LICENSES/` in [oraios/serena](https://github.com/oraios/serena). |
| claude-hud setup shapes | `scripts/hud-statusline.js` | The command and layout shapes of claude-hud 0.8.0 are read and written, not copied. claude-hud is MIT, Copyright (c) 2026 Jarrod Watts ([jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud)). The plugin itself is installed from its own marketplace and is not shipped here. |

The MCP servers (Serena, Context7, Playwright MCP, the memory service and the desktop servers) and the optional LSP plugins are installed from their own packages at pinned versions; none is redistributed in this repository, and each keeps its own licence.
