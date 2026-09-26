---
name: dotnet-wpf
description: "WPF conventions - strict MVVM on the data-binding engine. Load before editing any XAML, code-behind, or ViewModel. Covers the one-way View-knows-ViewModel dependency, CommunityToolkit.Mvvm source generators over hand-rolled INotifyPropertyChanged, async commands carrying a CancellationToken, explicit binding modes, generic-host composition, off-UI-thread work via IProgress, list virtualization, styling/theming with the .NET 9 Fluent ThemeMode, and resx localization. Floors at .NET 8 / C# 12. Do NOT load for WinForms, UWP, WinUI 3, MAUI, Avalonia, or Uno - different frameworks."
---

# WPF conventions

For any WPF or NuGet API surface not pinned down here, resolve signatures with the `documentation` MCP rather than memory - never by grepping the NuGet cache or decompiled sources.

WPF is a retained-mode XAML UI on the data-binding engine. The whole discipline below exists to keep
view concerns (visuals, the visual tree, the dispatcher) on one side of a line and application state
on the other, so the state side stays a plain testable C# object. Floor is .NET 8 / C# 12.

**XAML formatting and naming style - attribute ordering (XAML Styler), `x:Name` vs `Name`, property-element syntax, namespace prefixes, value-converter naming, and binding style - live in `references/xaml-style.md`.** This SKILL.md owns the WPF architecture (strict MVVM, dependency/attached properties, threading); styles, resource dictionaries, and theming are `references/styling-theming.md`; the C# naming baseline is the `csharp` skill. Above these general conventions, a project's own `Settings.XamlStyler` / `.editorconfig` and its `<docs-path>/code-style/CODE-STYLE.md` win where they diverge.

On .NET Framework 4.8 these conventions hold, but the CommunityToolkit.Mvvm source generators, Generic
Host composition, and app-level exception wiring carry net48-specific constraints - see
`references/net-framework-48.md`.

## MVVM is the architecture, not a suggestion

Three layers, with a deliberately one-directional dependency:

- **View** - the `.xaml` plus a code-behind file that holds only view-only mechanics (nothing the
  ViewModel could own).
- **ViewModel** - observable state plus `ICommand`s. A plain CLR object.
- **Model** - the domain. Knows nothing about either layer above it.

The dependency points one way: the View references its ViewModel, the ViewModel never references the
View. The concrete test is types - if a ViewModel mentions `Window`, `UserControl`, `Dispatcher`,
`Visibility`, or any visual-tree element, the line has been crossed. State leaves the ViewModel as
bindable properties and commands; the binding engine does the rest.

Set the binding context by convention (a ViewModel-locator or DI-resolved `DataContext`), not with
`new SomeViewModel()` in code-behind, so the ViewModel's dependencies stay injectable.

## App composition and startup

Compose the app through the .NET generic host, not hand-rolled service location or `new` in code-behind.

- Build a `Microsoft.Extensions.Hosting` host in `App.xaml.cs`, register windows, ViewModels, and services on it, resolve the main window from the container in `OnStartup`, and drop `StartupUri` - the window's dependencies then inject through its constructor.
- Turn on `ValidateScopes` and `ValidateOnBuild` so captive-dependency and disposed-scope mistakes fail at startup instead of at runtime.
- Never call `BuildServiceProvider` inside registration to pull a service early - it stands up a second container and leaks a duplicate set of singletons.

## Pairing with a Windows Service

A WPF desktop is often the front for a Windows Service companion. The service half is not WPF code - the worker model is the hosted-worker skill's (BackgroundService lifecycle, graceful shutdown) and the SCM layer the Windows Service skill's (`AddWindowsService`, start/stop budgets, install and recovery); load those for that process where the install has them, and without them the service half is a plain generic-host worker with `AddWindowsService()`. WPF's own side of the pairing is the boundary: the two processes share only a contract - a named pipe, a local socket, a file or database, an IPC channel - never a UI thread or a `Dispatcher`, and a service-pushed update crosses in as data and marshals onto the UI thread like any other off-thread work.

## Naming and pairing

- View: `OrderListView.xaml` and `OrderListView.xaml.cs`.
- ViewModel: `OrderListViewModel.cs`.
- The pair lives in the same feature folder. Folder-per-feature beats type-per-folder (`Views/`,
  `ViewModels/`) once a screen has more than a couple of files.

## Observable state with the toolkit, not by hand

Use `CommunityToolkit.Mvvm`. Derive the ViewModel from `ObservableObject`, declare backing fields
with `[ObservableProperty]`, and let the source generator emit the property, the `PropertyChanged`
raise, and partial change hooks. Hand-writing `INotifyPropertyChanged` with `SetField` /
`CallerMemberName` boilerplate is wasted code and a place for bugs.

- `[NotifyPropertyChangedFor(nameof(FullName))]` keeps a derived property in sync without a manual
  raise.
- `[NotifyCanExecuteChangedFor(nameof(SaveCommand))]` re-queries a command's `CanExecute` when its
  input changes - cleaner than calling `NotifyCanExecuteChanged()` from a setter.

```csharp
public sealed partial class OrderListViewModel : ObservableObject
{
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SaveCommand))]
    private string? customerName;                 // generates CustomerName + change raise

    [RelayCommand(CanExecute = nameof(CanSave))]
    private void Save()
    {
        // persist through an injected service
    }

    private bool CanSave() => !string.IsNullOrWhiteSpace(CustomerName);
}
```

## Commands, not Click handlers

- Buttons, menu items, and key gestures bind `Command` (an `ICommand`); they do not wire `Click` in
  code-behind. Declare commands with `[RelayCommand]` - the generator produces the `IRelayCommand`
  property and threads `CanExecute` from a named predicate.
- Pass command parameters through `CommandParameter` and a typed `[RelayCommand]` method argument,
  not by reaching into the View.
- Deeper command orchestration - undo/redo stacks, command queues, snapshot/restore - is plain C#
  (Command, Memento, Observer) and routes to `csharp-design-patterns`, not into the ViewModel.

## Async commands carry a token and own their faults

- An async command is a `Task`-returning method under `[RelayCommand]` (which produces an
  `AsyncRelayCommand`), or `AsyncRelayCommand` directly. Never wrap async work behind a synchronous
  `ICommand` and block on `.Result` / `.Wait()` - that deadlocks against the UI `SynchronizationContext`.
- Bind the generated `IsRunning` to button enable-state and a busy indicator. Do not maintain a
  parallel hand-rolled `bool` busy flag.
- Take a `CancellationToken` as the last command parameter (the toolkit supplies one) so long work
  can be cancelled; cancel it on view teardown.

```csharp
[RelayCommand(IncludeCancelCommand = true)]   // also generates LoadOrdersCancelCommand
private async Task LoadOrdersAsync(CancellationToken token)
{
    try
    {
        Orders = await orderService.GetOrdersAsync(token);
    }
    catch (OperationCanceledException)
    {
        // cancelled - nothing to surface
    }
    catch (Exception ex)
    {
        await dialogService.ShowErrorAsync(ex.Message);
    }
}
```
- A faulting `Task` inside a command is silent by default. Catch inside the command and surface the
  failure through an injected `IDialogService` or an error property - never let the `Task` fault
  unobserved. The throw-vs-return baseline and the async rules (`ConfigureAwait`, no blocking) are
  the `csharp` skill's; they apply unchanged here.
- `AsyncRelayCommand` has two fault models - pick one deliberately. The default awaits and rethrows on the UI `SynchronizationContext`, so a try/catch inside the command sees the fault; setting `FlowExceptionsToTaskScheduler` instead routes it to `TaskScheduler.UnobservedTaskException`. Prefer the default and catch locally so the failure reaches the user through your dialog or error surface; reach for the flow option only when a deliberate global handler owns it.

## The interaction layer - what code-behind still owns

- **Commands are the default for intent.** A routed-event handler is only for what commands cannot
  express (drag-drop, mouse capture, manipulation), and it does one thing: forward to a ViewModel
  method through a thin private wrapper. No branching, no domain logic, no state in the handler.
- **Cross-cutting interaction goes in a behavior**, not code-behind plumbing -
  `Microsoft.Xaml.Behaviors.Wpf`, one behavior per concern.
- **No custom type on the clipboard or a drag payload.** From .NET 9 a non-intrinsic type no longer
  round-trips through `Clipboard.SetData`, `SetDataObject` or `DoDragDrop` - the `BinaryFormatter` fallback
  throws `PlatformNotSupportedException`, or the reader gets a 'BinaryFormatter removed' string instead of
  your object. Put a string, an intrinsic, or JSON across the boundary instead.

**Read `references/interaction-layer.md` before writing a routed-event handler, reaching for a
behavior, or moving a payload across the clipboard or a drag operation** - it carries the reasons,
the composition rule, and the `BinaryFormatter` migration bridge.

## Bindings: explicit and direct

- Always state `Mode` (`OneWay`, `TwoWay`, `OneTime`, `OneWayToSource`). Relying on a property's
  default binding mode is a silent foot-gun when the property's default later changes.
- `UpdateSourceTrigger=PropertyChanged` for inputs that validate per keystroke; otherwise leave the
  text-box default of `LostFocus`.
- Reach other elements with `ElementName` or `RelativeSource` (`Self`, `FindAncestor`), not by
  walking `VisualTreeHelper` from code-behind.
- WPF binds with `{Binding}`. Compiled bindings (`x:Bind`) are a UWP/WinUI feature that WPF does not
  have - do not reach for it. Set `x:DataType` only where a tooling analyzer you use consumes it.

## Dependency and attached properties, weak events, validation

**Read `references/mvvm-advanced.md` before registering a `DependencyProperty` or an attached
property, wiring a subscription whose publisher outlives its subscriber, or adding validation to a
ViewModel.** It owns all four mechanics - including why ViewModel state is never a
`DependencyProperty`, the symmetric-undo rule for attached side effects, and the `ObservableValidator`
validate-on-set / revalidate-on-submit cadence.

## Keeping the UI responsive - threading and big lists

Two rules an ordinary edit must not get wrong:

- **A ViewModel never touches `Application.Current.Dispatcher`.** Long work runs off the UI thread
  (`await` an I/O `Task`, or `Task.Run` for CPU-bound work) and reports back through `IProgress<T>`,
  which captures the UI `SynchronizationContext` for you. If a ViewModel truly must marshal, inject a
  dispatcher abstraction so it stays testable.
- **`ItemsControl` does not virtualize.** Any sizeable collection binds to `ListView`, `ListBox`, or
  `DataGrid` instead - they do.

**Read `references/threading-and-lists.md` before mutating a bound collection off the UI thread,
tuning a high-frequency update path, or binding a list past a few hundred rows** - it owns the
`ObservableCollection<T>` UI-thread constraint and its batch-and-replace pattern, the virtualization
properties to keep set, and the `ItemsPanel` swaps that silently defeat them.

## ViewModels are unit tests waiting to happen

A ViewModel is a plain CLR object with no `Window` or `Dispatcher` dependency, so it tests directly
with no UI host - that is the return on holding the MVVM line. Assert change notification by
subscribing to `PropertyChanged` and checking the fired property name; test a command by calling
`Execute(...)` and asserting state or a mocked side effect, with `CanExecute(...)` asserted
separately. Inject every collaborator (`INavigationService`, `IDialogService`, repositories) so the
test substitutes them - a ViewModel never does `new Window().Show()`. Framework, fakes and assertion
mechanics are the `dotnet-testing` skill's. The check is the test run itself: a ViewModel test that needs a `Dispatcher`
to pass is the failure - it proves the View-knows-ViewModel line was crossed - so quote the run and the first failure
rather than asserting the layering holds.

End-to-end UI tests stay at smoke and the critical path, on FlaUI over UI Automation; how they are built -
the UIA3 backend, locator priority, one page object per window, explicit waits, the CI job - is
`references/ui-automation.md`.

## Styling and theming

Styling is a View-only concern, the same line as MVVM: the ViewModel exposes state, resources and
styles decide how it paints. Working defaults: keyed styles composed with `BasedOn`, one resource
dictionary per concern merged into `App.xaml`, design tokens (named brushes / thicknesses) instead of
inline literals, and `DynamicResource` for anything theme-dependent so a runtime theme swap actually
repaints; on .NET 9+ prefer the built-in Fluent theme (`ThemeMode`) over a hand-rolled dark palette.
The full discipline - implicit vs keyed styles, `ControlTemplate` vs `DataTemplate` ownership,
theme-dictionary swapping, visual states, Fluent's experimental caveats - lives in
`references/styling-theming.md`.

## Localization

- Every user-facing string comes from a `resx` file (`Strings.en.resx`, `Strings.uk.resx`). No
  literal sentences in XAML or code.
- Bind with `{x:Static loc:Strings.OrderListTitle}` for static text, or a runtime-resolving markup
  extension where the culture can switch live without a restart.
- Build sentences with composite format strings and named-position placeholders, never string
  concatenation - word order is not the same across languages.

## Forbidden in a ViewModel

The types test from the MVVM section catches all of these; the recurring offenders, each owned by a
section above: `MessageBox.Show` (go through `IDialogService`), `Application.Current.Dispatcher`
(inject a dispatcher abstraction - Threading), `FindResource` / `TryFindResource` (resource lookup is
a View concern), business logic in a code-behind event handler (Routed events).
