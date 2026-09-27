---
name: dotnet-wpf
description: "WPF conventions - strict MVVM on the data-binding engine. Load before editing any XAML, code-behind, or ViewModel. Covers the one-way View-knows-ViewModel dependency, CommunityToolkit.Mvvm source generators over hand-rolled INotifyPropertyChanged, async commands carrying a CancellationToken, explicit binding modes, generic-host composition, off-UI-thread work via IProgress, list virtualization, styling/theming with the .NET 9 Fluent ThemeMode, and resx localization. Floors at .NET 8 / C# 12. Do NOT load for WinForms, UWP, WinUI 3, MAUI, Avalonia, or Uno - different frameworks."
---

# WPF conventions

For any WPF or NuGet API surface not pinned down here, resolve signatures with the `documentation` MCP rather than memory - never by grepping the NuGet cache or decompiled sources.

WPF is a retained-mode XAML UI on the data-binding engine; everything below keeps view concerns (visuals, the visual tree, the dispatcher) on one side of a line and application state on the other, a plain testable C# object. Floor .NET 8 / C# 12; .NET Framework 4.8 is `references/net-framework-48.md`. XAML formatting and naming are `references/xaml-style.md`; the C# baseline is `csharp`. A project's own `Settings.XamlStyler` / `.editorconfig` and its `<docs-path>/code-style/CODE-STYLE.md` win where they diverge.

**Each rule below is one line; `references/wpf-in-full.md` carries it with its reason and worked code - read it before a new View / ViewModel pair, an async command, or the app's composition.**

## MVVM and composition
- View (`.xaml` + view-only code-behind), ViewModel (observable state + `ICommand`s, a plain CLR object), Model (the domain). The View knows the ViewModel, never the reverse - a ViewModel naming `Window`, `Dispatcher`, `Visibility` or any visual-tree type has crossed the line.
- `DataContext` by convention or DI, never `new SomeViewModel()` in code-behind.
- Compose through the generic host in `App.xaml.cs` (windows, ViewModels and services registered, the main window resolved in `OnStartup`, no `StartupUri`), with `ValidateScopes` and `ValidateOnBuild`; never `BuildServiceProvider` during registration.
- A Windows Service companion shares only a contract (a pipe, a socket, a file, a database) - never a UI thread; its worker and SCM layers are the hosted-worker and Windows Service skills'.
- `OrderListView.xaml` + `OrderListViewModel.cs` in the same feature folder.

## State and commands
- `CommunityToolkit.Mvvm`: `ObservableObject`, `[ObservableProperty]`, `[NotifyPropertyChangedFor]`, `[NotifyCanExecuteChangedFor]` - never hand-written `INotifyPropertyChanged`.
- Controls bind `Command` from `[RelayCommand]`, never a `Click` handler; parameters through `CommandParameter`. Undo stacks and command queues are plain C# (`csharp-design-patterns`).
- An async command is a `Task`-returning `[RelayCommand]` with a `CancellationToken` last, bound to `IsRunning` for busy state, cancelled on teardown - never `.Result` / `.Wait()`. It catches its own faults and surfaces them through an injected `IDialogService`, on the default (rethrowing) fault model.
- Code-behind forwards only what commands cannot express (drag-drop, capture) through a thin wrapper; cross-cutting interaction is a `Microsoft.Xaml.Behaviors.Wpf` behavior; never a custom type on the clipboard or a drag payload (.NET 9+ throws) - read `references/interaction-layer.md` first.

## Bindings, properties, threading
- Every binding states its `Mode`; `UpdateSourceTrigger=PropertyChanged` only for per-keystroke validation; `ElementName` / `RelativeSource`, never `VisualTreeHelper` walks; `{Binding}` - WPF has no `x:Bind`.
- A `DependencyProperty`, an attached property, a long-lived subscription or ViewModel validation: read `references/mvvm-advanced.md` first.
- A ViewModel never touches `Application.Current.Dispatcher` - work runs off the UI thread and reports through `IProgress<T>` (or an injected dispatcher abstraction). Big lists bind `ListView` / `ListBox` / `DataGrid`, never a non-virtualizing `ItemsControl`; read `references/threading-and-lists.md` before mutating a bound collection off the UI thread.

## Tests, styling, localization
- ViewModels test with no UI host (`dotnet-testing` owns the mechanics): `PropertyChanged` by name, `Execute` then state, `CanExecute` apart; a test that needs a `Dispatcher` is the failure - quote the run. End-to-end UI tests stay at smoke and the critical path on FlaUI (`references/ui-automation.md`).
- Styling is View-only: keyed styles with `BasedOn`, one dictionary per concern merged in `App.xaml`, tokens not literals, `DynamicResource` for theme-dependent values, the Fluent `ThemeMode` on .NET 9+ (`references/styling-theming.md`).
- Every user-facing string from `resx`; `{x:Static}` or a runtime-resolving extension; composite format strings, never concatenation.
- Never in a ViewModel: `MessageBox.Show` (use `IDialogService`), `Application.Current.Dispatcher`, `FindResource`, or business logic in a code-behind handler.
