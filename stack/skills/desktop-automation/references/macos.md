# macos-desktop - MacOS-MCP on macOS

The server behind macos-desktop, the two grants it cannot work without, and what their absence looks
like. Checked against MacOS-MCP 0.4.6, the release the stack pins; macOS 12 or later.

## Tools

- **Observe:** `Snapshot` (focused window, open apps, interactive elements with their coordinates,
  scrollable areas; `use_vision=True` adds a screenshot with numbered elements).
- **Act:** `Click`, `Type`, `Scroll`, `Move` (also drag) - all by coordinates, taken from the last
  snapshot; `Shortcut` (`command+s` - `command`, never `ctrl`).
- **Apps and spaces:** `App` (launch, switch, resize, move), `Desktop` (Mission Control spaces).
- **Other:** `Wait`, `Scrape`, `Notification`, and `Shell` (shell commands and AppleScript through
  osascript).

## Shell stays on

MacOS-MCP has no flag to switch a tool off, so `Shell` is always in the list: the skill's rule is what
keeps a UI task in the UI. A user who wants it gone can list it in MacOS-MCP's own
`~/.macos-mcp/config.toml`, under `[tools]`, as `exclude = ['Shell']`.

## The two grants

Both live in System Settings > Privacy & Security, and only the user can give them.

- **Accessibility** lets the server read the UI tree and send input. The grant belongs to the process
  that runs the server - the uv-managed Python - not to Claude Code or the terminal that started it,
  so nothing named after the server ever appears in the list. On its first start the server asks macOS
  for it, and approving the '... would like to control this computer' dialog registers the right
  process; adding the uv Python by hand is unreliable (the file picker often greys it out, and a uv
  update breaks the entry). Grant the terminal or IDE running Claude Code too.
- **Screen Recording** lets `Snapshot` take screenshots.

What their absence looks like:

- An **empty snapshot** - no focused window, no elements - while apps are open: Accessibility is
  missing. It is not a closed app, and launching the app again changes nothing.
- **Black screenshots**: Screen Recording is missing.
- On a start with either missing, the server opens System Settings by itself;
  `MACOS_MCP_SKIP_PERMISSION_CHECK=1` in the shell that starts Claude Code stops that.

Restart the server (reconnect from `/mcp`) after a grant.

## First start and telemetry

uvx downloads Python and MacOS-MCP the first time; a timeout on that start clears with one reconnect
from `/mcp`. MacOS-MCP sends anonymous usage telemetry unless `ANONYMIZED_TELEMETRY=false` is set in the
shell that starts Claude Code.
