# Windows-MCP on Windows

The desktop server for Windows, what it needs from the machine, and the switches around it.
Checked against Windows-MCP 0.8.8, the release the stack shipped until 2026-10-24.

## Tools

- **Observe:** `Snapshot` (windows, focused app, interactive elements with labels and coordinates,
  scrollable areas; `use_vision=True` adds an annotated screenshot, `use_dom=True` reads a browser's
  page instead of its chrome, `use_ui_tree=False` skips the tree for speed, `display=[0]` limits it
  to one monitor), `Screenshot` (the image plus a short desktop and window summary, no tree;
  `display=[0]` limits it too), `DisplayInventory` (monitors, resolution, DPI).
- **Act:** `Click`, `Type`, `Scroll`, `Move` (also drag) - each by coordinates or by an element label
  from the snapshot; `Shortcut` (key combinations, `ctrl+s`), `MultiSelect`, `MultiEdit`.
- **Wait:** `WaitFor` (polls the accessibility tree until a text, window, element or focus condition
  holds) over a fixed `Wait`.
- **Apps:** `App` (launch, switch, resize - and `launch_executable`, which starts any program with the
  arguments and working folder given).
- **Control:** `ControlStatus` (read-only: who holds the desktop - the AI or the user - and the user's
  idle wait left, in seconds).
- **Other:** `Clipboard`, `Scrape`, `Notification`, and - switched off by the gate below - `PowerShell`,
  `Registry`, `Process`, `FileSystem` (read, write, copy, move, delete).

## The tool gate

Register Windows-MCP with `--exclude-tools PowerShell,Registry,Process,FileSystem` (the shape the stack shipped,
kept as `windows-desktop` in the record of its old servers an update prints): shell, registry, process control and
file writes, moves and deletes are not there unless the user turns them on. What stays on: the observe, input and wait tools, `ControlStatus`, `App`, `Clipboard`, `Scrape` and `Notification`.
Windows-MCP gates by tool name, never by mode, so `App` stays whole - and its `launch_executable` mode
starts any program (`powershell.exe -Command ...` included): a house guard denies that mode unless the
user allowed it and the lines the denial prints are written into `<data root>/state/approvals/DESKTOP-EXEC-ALLOW`, while `launch`, `switch` and `resize` pass.
The server reads the list at start, so reconnect it from `/mcp` after a change. Windows-MCP matches the names
case-sensitively and skips an unknown one silently, so spell each as the Tools list above does. Its own
`WINDOWS_MCP_TOOLS` (its `--tools`) OVERRIDES the exclude list: leave it unset. Turning a tool on is the user's
decision, never a way around a blocked step.

## The user's takeover

The user's own mouse or keyboard takes the desktop back: while they hold it, a tool call is refused with
`USER_CONTROL`, `TAKEOVER_PENDING` or `PHYSICAL_INPUT_HELD`, and an indicator shows who has control. Read
`ControlStatus`, wait out the idle time it gives, then observe again before the next action - the screen
may have changed under the user's hands. Never race the user for the input.

## What the machine needs

- **An active, unlocked desktop at start.** The server watches physical input and refuses to start without
  the signed-in user's input desktop: a locked screen, a disconnected remote session, a service or an SSH
  shell leaves it unable to connect. Unlock, then reconnect it from `/mcp`.

- **English display language.** The `App` tool finds apps by their English names; on another display
  language launching and switching by name fails. Launch the app another way the user agrees to, or
  add `App` to the gate's list above.
- **The same privilege level as the app.** Windows keeps a normal process from sending input to an
  elevated one: an app started as administrator takes no clicks from a Claude Code that is not, and
  the reverse. A UAC prompt runs on the secure desktop and can never be automated - the user answers
  it.
- **Screenshot size.** `WINDOWS_MCP_SCREENSHOT_SCALE` (0.1 to 1.0, default 1.0) shrinks every
  screenshot; 0.5 keeps a 4K or multi-monitor desktop readable and cheap. Set it in the server's
  `env`, or the shell that starts Claude Code. An image costs its area in
  28x28-pixel patches, capped per model (platform.claude.com vision docs, read 2026-10-11): a
  1728x1046 screenshot is about 2.4k tokens at 1.0, 1.4k at 0.75 and 0.6k at 0.5, and every later
  turn re-sends it - 56 full-size screenshots were about a third of one session's cache reads (audit
  2026-10-11). How far a 1080p and a 4K desktop can shrink and stay readable is not measured yet.
- **First start.** uvx downloads Python and Windows-MCP the first time; a timeout on that start clears
  with one reconnect from `/mcp`. uv must be on PATH.
- **Telemetry.** Windows-MCP sends anonymous usage events unless `ANONYMIZED_TELEMETRY` is
  `false` - set it in the server's `env` (the shipped shape did), so nothing leaves the machine.
