# WPF interaction layer - routed events, behaviors, drag-drop and clipboard payloads

Everything the View still owns once commands have taken the intent. The SKILL.md body carries the
three rules an ordinary edit needs; open this file before writing a routed-event handler, reaching
for a behavior, or putting a custom type on the clipboard or a drag payload.

## Routed events vs commands

Commands are the default for intent. Routed events are for the low-level interactions commands cannot
express - drag-drop, mouse capture, manipulation. When a routed-event handler is unavoidable in
code-behind, it does one thing: forward to a ViewModel method through a thin private wrapper. No
branching, no domain logic, no state in the handler.

## Behaviors over code-behind wiring

- Reach for `Microsoft.Xaml.Behaviors.Wpf` for cross-cutting interaction - drag-drop, focus
  management, data-triggered animation, event-to-command glue.
- One behavior per concern; compose several on one element rather than building one omni-behavior.
- This replaces `Loaded` / `Unloaded` subscriptions in code-behind for cross-cutting work. If you
  find yourself adding plumbing in code-behind to react to interaction, a behavior is the home.

## Clipboard and drag-drop payloads

- Custom types no longer ride onto the clipboard or a drag payload through `BinaryFormatter` - from
  .NET 9, a non-intrinsic type through `Clipboard.SetData`, `SetDataObject`, `DoDragDrop`, or
  navigation-journal state hits the removed `BinaryFormatter` fallback: a `PlatformNotSupportedException`,
  or on the clipboard's read side a 'BinaryFormatter removed' string in place of the object (the runtime status and replacement are
  `dotnet-security`'s A08).
- Put a serializable shape across the boundary instead: a string, an intrinsic type, or your object
  serialized to JSON or a `byte[]` you re-hydrate yourself. The
  `System.Runtime.Serialization.Formatters` compatibility shim is a migration bridge, not a
  destination.
