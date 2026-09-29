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

## Shell stays in the list, behind a guard

MacOS-MCP has no flag to switch a tool off, so `Shell` is always in the list. A house guard denies every
`Shell` call - shell commands and AppleScript alike - unless the user allowed it in
`<docs-path>/flow/DESKTOP-EXEC-ALLOW`, and the skill's rule keeps a UI task in the UI either way. A user
who wants it gone can list it in MacOS-MCP's own `~/.macos-mcp/config.toml`, under `[tools]`, as
`exclude = ['Shell']`.

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

- **The server fails to connect at start, and System Settings opens by itself.** MacOS-MCP 0.4.6 checks
  its grants before it serves and exits when one is missing; its log (`/mcp`) names which - 'Required
  permissions not granted: Accessibility'.
- `MACOS_MCP_SKIP_PERMISSION_CHECK=1` in the shell that starts Claude Code makes it start ungranted: a
  warning in place of the exit, and no System Settings. Only then does an **empty snapshot** - no
  focused window, no elements, while apps are open - mean Accessibility is missing; it is not a closed
  app, and launching the app again changes nothing.
- **Black screenshots**: Screen Recording is missing. The start check does not catch it - its Screen
  Recording test only asks System Events for its version - so a server that started cleanly can still
  return them.

Restart the server (reconnect from `/mcp`) after a grant.

## First start and telemetry

uvx downloads Python and MacOS-MCP the first time; a timeout on that start clears with one reconnect
from `/mcp`. MacOS-MCP sends anonymous usage events unless `ANONYMIZED_TELEMETRY` is `false`, and the
stack starts it with `false` on both routes (the plugin entry's `env`, the copy route's registration), so
telemetry is off with nothing to set.
