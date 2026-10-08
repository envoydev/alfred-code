# WinForms disposal and leak hunting

The per-case disposal rules, both leak families, and the acceptance bar. The SKILL.md body carries
the four rules an ordinary edit needs; open this file before writing owner-draw or `OnPaint` code,
before adding a dynamically created control or non-visual component, and whenever you are hunting a
handle or memory leak. Runtime-independent - these rules are identical on .NET Framework 4.8 and
modern .NET.

## Contents

- Event-handler leaks (the top managed leak)
- GDI / USER object leaks (the top native leak)
- Control and component disposal
- The acceptance bar

## Event-handler leaks (the top managed leak)

A `publisher.Event += handler` is a strong reference from publisher to subscriber. It leaks only when
the **publisher outlives the subscriber** - a long-lived service or main form raising events into
short-lived child forms or controls that should have been collected.

- You do **not** need to detach a child control's handler from its parent - their lifetimes are tied
  and they die together.
- You **do** need to unsubscribe when a shorter-lived object subscribed to a longer-lived one -
  detach in `OnFormClosed` (a Form) or `Dispose` - `OnClosed` / `Closed` are obsolete from .NET 10
  (WFDEV004), and `OnFormClosed` exists on 4.8 too, so one form serves both runtimes.
- Weak-event patterns and messenger/event-aggregator abstractions are a safety net, not a substitute
  for correct lifetime management - a still-subscribed handler can run on a logically dead object.

## GDI / USER object leaks (the top native leak)

`System.Drawing` types - `Pen`, `Brush`, `Font`, `Graphics`, `Bitmap`, `Icon`, `Region` - each wrap a
native handle and are `IDisposable`. A process has a bounded GDI-handle quota (the widely cited
default is roughly 10,000; the real ceiling is a configurable session quota), and exhausting it
throws or renders windows with missing content.

- Wrap every created drawing object in `using`, especially inside `OnPaint` / owner-draw where they
  are created per paint.
- **Do not dispose `SystemPens` / `SystemBrushes`** - they are cached. **Do dispose `SystemFonts`** -
  each access is a live OS fetch.
- **Never dispose `PaintEventArgs.Graphics`** - you do not own it. **Do dispose** a `Graphics` you got
  from `CreateGraphics()`, `Graphics.FromImage`, or `Graphics.FromHwnd`.
- In a `DataGridView`, share one `DataGridViewCellStyle` across rows and columns; never allocate a new
  `Font` or `Brush` per cell in `CellFormatting` / `CellPainting` without disposing it - a classic
  font leak.

## Control and component disposal

- A disposed control disposes its children, but automatic disposal only reaches the top-level form
  started by `Application.Run(new Form())`. Everything below inherits from that or must be handled.
- **A modal dialog shown with `ShowDialog()` is not auto-disposed** (so you can read its state after
  close) - wrap it in `using`.
- **Dynamically added and removed controls dispose manually** - dispose the topmost one (disposing a
  swapped-out `Panel` disposes its children).
- A non-visual `IComponent` dropped in the designer (a `Timer`, `ToolTip`, `ImageList`,
  `ErrorProvider`) auto-registers with the `IContainer components` field and is auto-disposed; **the
  same component created in code must be disposed by hand** - an undisposed `Timer` keeps firing and
  holding handles.
- A custom control that owns `IDisposable` fields overrides `Dispose(bool disposing)`, disposes them
  inside `if (disposing)`, and always calls `base.Dispose(disposing)` (analyzers `CA1063` / `CA2215`).
- Unhook bindings and dispose the `BindingSource` when a dynamically created form tears down.

## The acceptance bar

Watch live GDI and USER handle counts (Task Manager's Details tab has both columns) across an
open/close stress test - flat counts are the acceptance bar before shipping or migrating. Managed
allocation profiling is the `dotnet-diagnostics` skill's.
