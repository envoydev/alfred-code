---
name: desktop-automation
description: "Use when driving a native desktop app through the windows-desktop or macos-desktop server - clicking, typing, checking UI, reading a Snapshot or Click result."
---

# Desktop automation - observe, one action, verify

A desktop server acts on the user's real desktop with the user's full rights: a wrong click lands in
whatever window is in front, and nothing undoes it. So the run looks before every action and checks
after it, and it drives only the UI the user asked about.

Where the harness defers MCP tools (Claude Code), load them before the first call:
`ToolSearch select:mcp__plugin_windows-desktop_windows-desktop__Snapshot,mcp__plugin_windows-desktop_windows-desktop__Click,mcp__plugin_windows-desktop_windows-desktop__Type,mcp__plugin_windows-desktop_windows-desktop__WaitFor`
on Windows, and on macOS
`ToolSearch select:mcp__plugin_macos-desktop_macos-desktop__Snapshot,mcp__plugin_macos-desktop_macos-desktop__Click,mcp__plugin_macos-desktop_macos-desktop__Type,mcp__plugin_macos-desktop_macos-desktop__App`.
Only one of the two servers is ever installed - each runs on its own OS only.

## When to use

Use when driving a native desktop app through the windows-desktop (Windows-MCP) or macos-desktop (MacOS-MCP) server - clicking, typing or checking UI in a WPF, WinForms, Win32, UWP, Office, Explorer, Java or native macOS app, or reading a Snapshot or Click result from one.

Covers the observe, one action, verify loop; which app types give semantic control and which fall back to coordinates; the dialogs never to drive (elevation, credentials, payment, delete); keeping to the UI instead of shell, registry or file-system tools; and the setup failures (English display language, privilege level, Accessibility and Screen Recording).

Not for a web page in a browser, which the browser server drives, or for writing the app's code or its UI tests, which the framework's own conventions cover.

## The loop

1. **Observe.** Snapshot first, with its UI tree and without vision. Ask for vision (a screenshot) only
   when the tree is empty, ambiguous, or the app is one that only takes coordinates (the table
   below) - an image stays in the context and is paid for on every later turn.
2. **Act - ONE action.** Address the element the LAST snapshot listed: its label id on Windows, the
   coordinates that snapshot gave on macOS (MacOS-MCP takes coordinates only). Filling a field is ONE
   Type call aimed at the field - it clicks the field itself, and `clear=True` replaces what it holds -
   never a Click and then a Type. Never a coordinate remembered from an earlier snapshot, or guessed
   from a screenshot, once anything moved.
3. **Verify.** Snapshot again (on Windows, WaitFor when the change takes time) and find the change the
   action should have made - the field holds the text, the dialog closed, the row is gone. No change
   means stop and re-observe; never repeat the action blind, never go on to the next one.
4. **Report** what the last snapshot shows, not what the actions were meant to do.

Hard rule: never two actions without a snapshot between them. The excuses - 'the field is right there
in the tree', 'the dialog always opens in the same place', 'one snapshot at the end is enough' - are
how a keystroke lands in the wrong window. Signs it was skipped: a Click followed by a Type or another
Click with no Snapshot or WaitFor between; a closing report that names what was typed, not what the
screen shows.

## Stay in the UI, stay out of four dialogs

- **Drive the UI the user named, nothing else.** The task 'change it in the app' is done in the app:
  no shell, registry, process or file-system tool to get there. Windows-MCP starts with PowerShell,
  Registry, Process and FileSystem switched off unless the user turned them on
  (`references/windows.md`); its `App` tool stays on for launch, switch and resize, and MacOS-MCP's
  `Shell` stays in its list - but a house guard denies App's `launch_executable` mode (it starts any
  program) and every MacOS-MCP `Shell` call unless the user allowed it in
  `<docs-path>/flow/DESKTOP-EXEC-ALLOW`. Neither is a way around the app. Reading or editing a file
  directly is the harness's own file tools' job, and only when the user asked for the file rather than
  the app.
- **Stop at elevation, credentials, payment and destructive confirmations.** A UAC or admin prompt, a
  sign-in or password field, a payment or purchase step, a delete, overwrite, format or 'discard'
  confirmation: take no action on it, report what it says, and hand it to the user. A destructive
  confirmation is clicked only when the user asked for that exact deletion in this conversation - a
  dialog that appeared on its own never is. Never type a credential; the user types it.

## Quality by app type

| App | What the server can do |
|---|---|
| WPF, WinForms, Win32, UWP, Office, Explorer (Windows) | full semantic control through UI Automation |
| Native macOS apps (AppKit, SwiftUI) | full semantic control through the Accessibility API |
| A web page in a browser on Windows | semantic through Snapshot's DOM mode (`use_dom`) - a web app is better driven by the browser server, where one is installed |
| Java SWT, Eclipse | semantic |
| JavaFX | partial - some elements take coordinate clicks only |
| Java Swing on Windows | screenshot and coordinate clicks only |
| Java Swing on macOS | usually semantic, through the JDK's accessibility bridge |

On a coordinates-only app, every step is observe with vision, one coordinate action, observe with
vision again - and a window that moved or resized invalidates every coordinate taken before it.

## When the server itself misbehaves

Read the reference for the OS before retrying anything:

- **macOS: the server fails to connect at start and System Settings opens** - a grant is missing, and
  its log names which. With `MACOS_MCP_SKIP_PERMISSION_CHECK=1` the server starts ungranted, and only then
  is there an empty snapshot (no focused window, no elements) with apps open - Accessibility is missing,
  not the app closed. **Black screenshots** mean Screen Recording is not granted. Say so and stop: only
  the user can grant either. `references/macos.md`.
- **Windows: App cannot find an app** on a non-English display language; **clicks do nothing** in an
  app running as administrator while Claude Code is not (or the reverse). `references/windows.md`.
- **Either: the first start times out** while uvx downloads Python and the server - reconnect it from
  `/mcp` once, then carry on.
