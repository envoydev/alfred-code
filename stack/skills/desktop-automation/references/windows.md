# windows-desktop - Windows-MCP on Windows

The server behind windows-desktop, what it needs from the machine, and the switches around it.
Checked against Windows-MCP 0.8.5, the release the stack pins.

## Tools

- **Observe:** `Snapshot` (windows, focused app, interactive elements with labels and coordinates,
  scrollable areas; `use_vision=True` adds an annotated screenshot, `use_dom=True` reads a browser's
  page instead of its chrome, `use_ui_tree=False` skips the tree for speed, `display=[0]` limits it
  to one monitor), `Screenshot` (image only, no tree), `DisplayInventory` (monitors, resolution, DPI).
- **Act:** `Click`, `Type`, `Scroll`, `Move` (also drag) - each by coordinates or by an element label
  from the snapshot; `Shortcut` (key combinations, `ctrl+s`), `MultiSelect`, `MultiEdit`.
- **Wait:** `WaitFor` (polls the accessibility tree until a text, window, element or focus condition
  holds) over a fixed `Wait`.
- **Apps:** `App` (launch, switch, resize - and `launch_executable`, which starts any program with the
  arguments and working folder given).
- **Other:** `Clipboard`, `Scrape`, `Notification`, and - switched off by the stack - `PowerShell`,
  `Registry`, `Process`, `FileSystem` (read, write, copy, move, delete).

## The tool gate

The stack starts Windows-MCP with `--exclude-tools PowerShell,Registry,Process,FileSystem`: shell,
registry, process control and file writes, moves and deletes are not there unless the user turns them
on. What stays on: the observe, input and wait tools, `App`, `Clipboard`, `Scrape` and `Notification`.
Windows-MCP gates by tool name, never by mode, so `App` stays whole - and its `launch_executable` mode
starts any program (`powershell.exe -Command ...` included): a house guard denies that mode unless the
user allowed it in `<docs-path>/flow/DESKTOP-EXEC-ALLOW`, while `launch`, `switch` and `resize` pass.
`ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE` replaces the list - `none` lifts it, a list of its own
(`PowerShell` alone, or one that adds `App` on a non-English machine) takes its place. It is read from the shell that starts Claude Code, then the
project's `settings.local.json`, its `settings.json` and the account settings `env`; the server reads
it at start, so reconnect it from `/mcp` after a change. Windows-MCP matches the names case-sensitively and
skips an unknown one silently, so each is checked against its tools at the pin: a name in another case is
mended, an unknown one is named and dropped, and a list naming no real tool keeps the default. Windows-MCP's
own `WINDOWS_MCP_TOOLS` (its `--tools`, which OVERRIDES the exclude list) never reaches it from the
environment - the launcher drops it, and the copy route registers it empty. Turning a tool on is the user's decision, never
a way around a blocked step.

## What the machine needs

- **English display language.** The `App` tool finds apps by their English names; on another display
  language launching and switching by name fails. Launch the app another way the user agrees to, or
  exclude `App` through the gate above.
- **The same privilege level as the app.** Windows keeps a normal process from sending input to an
  elevated one: an app started as administrator takes no clicks from a Claude Code that is not, and
  the reverse. A UAC prompt runs on the secure desktop and can never be automated - the user answers
  it.
- **Screenshot size.** `WINDOWS_MCP_SCREENSHOT_SCALE` (0.1 to 1.0, default 1.0) shrinks every
  screenshot; 0.5 keeps a 4K or multi-monitor desktop readable and cheap. Set it in the shell that
  starts Claude Code - a plugin server gets no project settings `env` key.
- **First start.** uvx downloads Python and Windows-MCP the first time; a timeout on that start clears
  with one reconnect from `/mcp`. uv must be on PATH.
- **Telemetry - off.** Windows-MCP sends anonymous usage events unless `ANONYMIZED_TELEMETRY` is
  `false`, and the stack starts it with `false` on both routes (the plugin entry's `env`, the copy
  route's registration), so nothing leaves the machine and nothing needs setting.
