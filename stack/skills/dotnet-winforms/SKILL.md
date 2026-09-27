---
name: dotnet-winforms
description: "WinForms conventions for maintenance and modernization. Load before editing any Form, UserControl, code-behind, presenter, or .Designer.cs. Covers logic out of code-behind (MVP passive view for legacy, the .NET 8 MVVM binding engine for new), DI-resolvable forms, async/await with no UI-thread blocking, BindingSource + INotifyPropertyChanged binding, control/component/GDI disposal, PerMonitorV2 high-DPI, virtual-mode grids, presenter unit tests. Floors new work at .NET 8 / C# 12 and covers 4.8 as the supported-but-frozen maintenance surface. Do NOT load for WPF - that is the WPF conventions skill - nor for WinUI 3, MAUI, Avalonia, or Uno."
---

# WinForms conventions

For any WinForms or NuGet API surface not pinned down here, resolve signatures with the `documentation` MCP rather than memory - never by grepping the NuGet cache or decompiled sources.

WinForms is an immediate-mode, control-tree desktop UI whose realistic work is maintenance and modernization: new work floors at .NET 8 / C# 12, and .NET Framework 4.8 is a supported-but-frozen maintenance surface. The version mechanics: `references/net-framework-48.md` (4.8) and `references/modern-net.md` (.NET 8+). Naming, `*.Designer.cs` round-trips and resx: read `references/winforms-style.md` first. A project's own `.editorconfig` and its `<docs-path>/code-style/CODE-STYLE.md` win where they diverge. Out of scope: the C# baseline (`csharp`), deeper MVP and command orchestration (`csharp-design-patterns`), test mechanics (`dotnet-testing`), the upgrade playbook (`dotnet-migrate`).

**Each rule below is one line; `references/winforms-in-full.md` carries it with its reason and worked code - read it before a new form, a binding setup, or async UI work.**

## Architecture
- Code-behind translates a UI event into a presenter or ViewModel call and nothing else - no business rules, data access or branching on domain state.
- MVP passive view by default (the Form implements a narrow `IView`; the presenter owns every decision and tests against a mocked view); the .NET 8+ binding engine (`DataContext` / `Command`) only on the modern runtime. One presenter or ViewModel per view, injected through the constructor.
- Forms are resolved from the container, never `new`ed; a transient child form arrives through a factory delegate (`Func<OrderForm>`), never the container itself.

## Async and the UI thread
- `async void` only on event handlers, their bodies in `try` / `catch`; `Task` everywhere else.
- Never `.Result`, `.Wait()` or `.GetAwaiter().GetResult()` on the UI thread; no `ConfigureAwait(false)` in a UI handler.
- Progress through `IProgress<T>` with a `CancellationToken`; marshal back with `Control.Invoke` / `BeginInvoke` (`InvokeAsync` on .NET 9+). `BackgroundWorker` is legacy - `await` for I/O, awaited `Task.Run` for CPU work.

## Binding, validation, secrets
- Bind through a `BindingSource` over a `BindingList<T>`, the bound types implementing `INotifyPropertyChanged` (without it the binding pins the source for the app's lifetime); `Format` / `Parse` for conversions; unhook and dispose on teardown.
- Validate through an `ErrorProvider` on `Validating` or `INotifyDataErrorInfo` - never the UI constraint alone (`dotnet-security` owns the boundary).
- A desktop app cannot keep a secret from its user: broker high-value credentials through a service; what must stay local uses DPAPI (`ProtectedData`, `CurrentUser`).

## Disposal, performance, DPI
- Unsubscribe a shorter-lived subscriber from a longer-lived publisher; every `System.Drawing` object you create in `using`; a `ShowDialog()` form in `using`; a custom control disposes its `IDisposable` fields in `Dispose(bool)`. Read `references/disposal-and-leaks.md` before owner-draw code, a dynamic control, or a leak hunt.
- Prove it: open and close the affected form twenty times and quote the GDI and USER handle counts at start and end - a climbing count is the leak.
- `SuspendLayout` / `ResumeLayout` and `BeginUpdate` / `EndUpdate` around bulk changes; double buffering (a subclass on `DataGridView`); a grid populated through `DataSource`; `VirtualMode` for large sets (`dotnet-performance` for the rest).
- Per-Monitor V2 DPI awareness; one `AutoScaleMode` across every container; test on a genuinely mixed-DPI setup.

## Tests and the forbidden list
- Presenters, ViewModels and services unit-test with a mocked `IView`; UI automation stays at smoke and the critical path on FlaUI (`references/ui-automation.md`), never a fresh WinAppDriver.
- Never in a presenter or ViewModel: a `Form`, `UserControl` or `Control` reference, or `MessageBox.Show` - go through an injected dialog abstraction.
