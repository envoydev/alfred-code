# WinForms on modern .NET - the .NET 10 floor and below it

Modern .NET is the strategic target and it changes real things for WinForms. Floor new work at
**.NET 10 (LTS, supported to 2028-11-14)**; .NET 8 and 9 leave support on 2026-11-10, so an app on
either is below the floor - the per-version rows below mark what it lacks.
The version-agnostic conventions live in the parent SKILL.md; this reference is the modern-runtime
mechanics plus the WinForms-specific migration deltas. The frozen 4.8 counterpart is
**net-framework-48.md**.

## Contents

- Project shape
- Dependency injection through the generic host
- Secrets
- The MVVM binding engine (stable in .NET 8)
- Async: InvokeAsync and async forms
- High-DPI as a build property
- Dark mode (experimental .NET 9, stable .NET 10)
- BinaryFormatter is gone - move payloads to JSON
- Version timeline (what lands where)
- WinForms-specific migration deltas
- Deployment and packaging
- Analyzers to keep on

## Project shape

- SDK-style `.csproj`: `<TargetFramework>net10.0-windows</TargetFramework>` and
  `<UseWindowsForms>true</UseWindowsForms>`. `packages.config` becomes `<PackageReference>`;
  generated `AssemblyInfo` is off by default.
- Bootstrap in `Program.cs` with `ApplicationConfiguration.Initialize()` - it consumes the DPI,
  default-font, and visual-styles build properties so they stay in one place. General SDK-project and
  packaging conventions are the `dotnet-project-setup` skill's.
- The designer runs **out-of-process** on modern .NET - a different architecture from 4.8's in-proc
  designer, which is why some legacy UITypeEditors were missing at first and have been ported back
  progressively.

## Dependency injection through the generic host

```csharp
ApplicationConfiguration.Initialize();
var builder = Host.CreateApplicationBuilder();
builder.Services.AddTransient<MainForm>();
builder.Services.AddSingleton<IGreetingService, GreetingService>();
using var host = builder.Build();
host.Start();
Application.Run(host.Services.GetRequiredService<MainForm>());
```

- Forms take services through the constructor. A transient child form that needs a runtime argument
  gets an injected `Func<ChildForm>` (or a typed factory), never the provider itself.
- The community `WindowsFormsLifetime` package integrates the host lifetime with the message loop and
  captures the `WindowsFormsSynchronizationContext` - use it when you want host start/stop to own the
  app lifetime.

## Secrets

- Windows DPAPI is available on modern .NET but **not in-box** - reference the
  `System.Security.Cryptography.ProtectedData` package (also pulled in by the Windows Compatibility
  Pack, see the migration deltas). It is Windows-only. Apply the desktop trust-boundary rule from the
  parent SKILL.md: `CurrentUser` scope, protect only the secret fields, and prefer brokering
  high-value credentials through a service or token endpoint over any local scheme.

## The MVVM binding engine (stable in .NET 8)

A WPF-style binding engine is fully enabled from .NET 8: `Control.DataContext` (with propagation to
children), `ButtonBase.Command` / `CommandParameter` over `System.Windows.Input.ICommand`, and the
`BindableComponent` base (so components, including `ToolStripItem`, can bind).

- Build a ViewModel implementing `INotifyPropertyChanged`; the `CommunityToolkit.Mvvm` source
  generators (`[ObservableProperty]`, `[RelayCommand]`) remove nearly all of the boilerplate. Wire
  values with `control.DataBindings.Add(...)` and actions with `button.Command = vm.SomeCommand`.
- Know the ceiling: no XAML, classic value binding still flows through `Binding` / `BindingSource`,
  and there are no data templates, no rich converters, and no `DependencyProperty`. **XAML is not
  coming to WinForms** - a ViewModel shared with WPF/MAUI is the payoff, not visual parity. When you
  want real MVVM fidelity, that is a WPF decision (the WPF conventions skill), not a WinForms one.

## Async: InvokeAsync and async forms

- **`Control.InvokeAsync` (new in .NET 9)** is the modern marshaling primitive and removes a class of
  deadlocks. It has four overloads - `Action`, `Func<T>`, `Func<CancellationToken, ValueTask>`,
  `Func<CancellationToken, ValueTask<T>>`. Analyzer `WFO2001` warns when a `Task`-returning method is
  passed to a synchronous overload without a token (an accidental fire-and-forget).
- **`Form.ShowAsync` / `Form.ShowDialogAsync` / `TaskDialog.ShowDialogAsync`** arrived experimentally
  in .NET 9 behind compiler error `WFO5002` (suppress via `<NoWarn>`) and are **stable in .NET 10**,
  where the async task also holds a weak reference to the form for responsive multi-window UIs.
- .NET 8 added the finer-grained `ConfigureAwait(ConfigureAwaitOptions)` overload for library code.
  The UI-handler rule from the parent skill is unchanged: no `ConfigureAwait(false)` on the UI thread.

## High-DPI as a build property

- Set `<ApplicationHighDpiMode>PerMonitorV2</ApplicationHighDpiMode>` (consumed by
  `ApplicationConfiguration.Initialize()`), or call `Application.SetHighDpiMode(HighDpiMode.PerMonitorV2)`
  as the first line of `Main`. From .NET 6 the DPI mode is a shared build-time property used by both
  runtime and designer.
- The out-of-process designer serializes layout by the current display's DPI, which drifts across
  developers on different-DPI machines. `ForceDesignerDpiUnaware` (VS 2022 17.8+) forces all WinForms
  designers in a project to DPI-unaware mode for stable serialization while VS itself stays
  per-monitor aware.

## Dark mode (experimental .NET 9, stable .NET 10)

- `Application.SetColorMode(SystemColorMode.System | Dark | Classic)` - experimental in .NET 9 behind
  `WFO5001`, stable in .NET 10.
- It is **usable but imperfect**: `Button`, `DateTimePicker`, `MonthCalendar`, and `TabControl` have
  known rendering gaps, and fully finalized visual styles were deferred to the .NET 11 timeframe.
  Treat it as an offer, not a guarantee, and test the controls you actually use.

## BinaryFormatter is gone - move payloads to JSON

- The runtime status and replacement are `dotnet-security`'s (A08). The WinForms delta: .NET 8 still
  allowed it behind a compat switch; .NET 9 removed the implementation (`PlatformNotSupportedException`;
  a compat NuGet package plus a config switch re-enables it narrowly for clipboard / drag-drop).
- .NET 10 redesigned the clipboard and `DataObject` (shared with WPF) with JSON APIs - `SetDataAsJson`,
  `TryGetData<T>` - so a custom clipboard or drag payload should serialize to JSON rather than lean on
  the compat shim, which is a bridge, not a destination.

## Version timeline (what lands where)

| Version | WinForms-relevant change |
| --- | --- |
| .NET 5 | `BinaryFormatter` marked obsolete (SYSLIB0011). |
| .NET 6 | `ApplicationConfiguration.Initialize()` bootstrap; DPI mode unified as a shared build property (runtime + designer). |
| .NET 7 | Preview of the MVVM binding engine; `ErrorProvider.HasErrors`; `TreeView` double-buffering fix. |
| .NET 8 (LTS) | MVVM binding engine fully enabled; `BinaryFormatter` throws (WinForms compat switch); `ConfigureAwait(ConfigureAwaitOptions)`. |
| .NET 9 (STS) | `BinaryFormatter` removed; experimental dark mode (`WFO5001`) and async forms (`WFO5002`); `Control.InvokeAsync`. |
| .NET 10 (LTS) | Dark mode and async forms stable; redesigned clipboard shared with WPF (`SetDataAsJson` / `TryGetData<T>`); `Form.ScreenCaptureMode`; more ported UITypeEditors. |

## WinForms-specific migration deltas

The general upgrade playbook - baseline build, smoke tests, dependency inventory, staged move,
rollback - is the `dotnet-migrate` skill's. These are the deltas particular to WinForms:

1. **Convert to SDK-style while still on 4.8**, then `packages.config` -> `PackageReference`, to
   isolate the project-system change from the runtime change. Multi-target `net48;net10.0-windows`
   during the transition; port shared class libraries first.
2. **Add the Windows Compatibility Pack** (`Microsoft.Windows.Compatibility`) for Windows-only APIs
   (Registry, WMI), preferring modern replacements where feasible.
3. **VB projects need TFM fixes the upgrade tools miss.** Which tool to drive the upgrade - the .NET
   Upgrade Assistant or the GitHub Copilot app-modernization agent - is the `dotnet-migrate` skill's
   call. The WinForms/VB delta: the Assistant does not recognize `System.Configuration` settings files
   or `My.*` extensions, so migrated VB libraries need manual `net10.0-windows` + `<UseWindowsForms>`
   fixes.
4. **The default-font re-serialization trap.** The WinForms default moved from MS Sans Serif 8.25pt to
   **Segoe UI 9pt**, so opening a form in the new designer re-serializes `AutoScaleDimensions`, control
   `Location` / `Size`, and `Margin` - which shifts layouts, breaks apps that persist window sizes, and
   can stomp user-set `DataGridView` font styles. Mitigate with `Application.SetDefaultFont(...)` and
   review every designer diff.
5. **x86 -> x64.** Modern templates default to x64 - verify 64-bit versions of native / COM / OCX /
   ODBC dependencies, use `IntPtr` for handles, and drop `Wow6432Node` / `Program Files (x86)`
   assumptions.
6. **Nullable is opt-in per file.** Designer-generated files are treated as generated and are
   nullable-oblivious, so `InitializeComponent` will not flood warnings - annotate your own code
   incrementally and remove `null!` silencers once real initialization is in place.

## Deployment and packaging

- **ClickOnce** (VS 2019 16.8+) is supported for modern .NET desktop, framework-dependent or
  self-contained - the usual choice for auto-updating internal apps. **MSIX** is the modern
  Store/enterprise format.
- **Trimming is risky for WinForms** - it leans on reflection and designer serialization, so
  `PublishTrimmed` can strip runtime-needed types; it is also only valid for self-contained apps
  (trimming a framework-dependent build errors with `NETSDK1102`). Prefer `PublishReadyToRun` for
  startup and avoid trimming unless you test exhaustively. General CI / release orchestration is the
  CI-and-deploy skill's.

## Analyzers to keep on

`CA2007` (ConfigureAwait), `CA1063` / `CA2215` (dispose correctness), `WFO2001` (InvokeAsync
fire-and-forget), `WFO5001` / `WFO5002` (experimental dark mode / async forms), `WFDEV004` / `WFDEV005`
(.NET 10 obsoletions), and the `BinaryFormatter` analyzers that flag unknowing binary serialization.
