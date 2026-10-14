# WinForms on .NET Framework 4.8 (the frozen world)

.NET Framework 4.8 is fully supported but **frozen** - it receives servicing, not features. Every
modern WinForms capability below is *absent* here, so 4.8 is the maintenance surface: keep it correct
and disposed, and plan the move to modern .NET (see **modern-net.md**) rather than investing in new
4.8-only patterns. The version-agnostic conventions in the parent SKILL.md all still apply.

## What is simply not available on 4.8

Do not reach for these - they do not exist on this runtime:

- `Control.InvokeAsync` - marshal with `Control.Invoke` (synchronous) or `BeginInvoke` (async post).
- `Form.ShowAsync` / `Form.ShowDialogAsync` / `TaskDialog.ShowDialogAsync` - dialogs are synchronous.
- The MVVM binding engine (`DataContext`, `ButtonBase.Command`, `BindableComponent`) - it is a .NET 7+
  feature. **MVP is the only separation pattern on 4.8** - lean on it fully.
- Integrated dark mode (`Application.SetColorMode`) - any dark theme is hand-rolled owner-draw.
- `Application.SetDefaultFont` / the modern `ApplicationConfiguration.Initialize()` bootstrap.

## Dependency injection without the generic host

There is no `Host.CreateApplicationBuilder` integration, but `Microsoft.Extensions.DependencyInjection`
runs on 4.8. Build the container by hand:

- Construct a `ServiceCollection`, register forms and services, `BuildServiceProvider()` once at
  startup, resolve the main form, and pass it to `Application.Run`.
- Keep the same discipline as modern .NET: forms take collaborators through the constructor, transient
  child forms come from an injected `Func<T>` factory, and nothing reaches a static locator.
- There is no built-in message-loop lifetime integration - own the `ServiceProvider`'s disposal
  yourself when the app exits.

## Async on 4.8

- `async` / `await` works on 4.8 - use it, and keep the parent skill's no-blocking rule (`.Result` /
  `.Wait()` on the UI thread still deadlocks the `WindowsFormsSynchronizationContext`).
- Marshal to the UI thread with `Invoke` / `BeginInvoke` only. Report progress with `IProgress<T>` -
  `Progress<T>` exists on 4.8 and captures the UI `SynchronizationContext`.
- Legacy code leans on `BackgroundWorker`; it is supported, but migrate new work to `Task` +
  `IProgress<T>` rather than extending it.

## High-DPI: app.config plus a manifest

PerMonitorV2 is declared through configuration, not a build property:

- Set the WinForms DPI keys in **app.config**, under
  `System.Windows.Forms.ApplicationConfigurationSection`, e.g. a `DpiAwareness` value of
  `PerMonitorV2`.
- Declare Windows 10+ compatibility in **app.manifest** (the supportedOS GUID) so the OS honors the
  awareness.
- A `dpiAware` / `dpiAwareness` entry in the manifest **overrides** the app.config keys - prefer
  app.config for the WinForms values and do not set both. Even correctly configured, some controls
  still mis-scale under per-monitor DPI, so test on a mixed-DPI multi-monitor rig.

## Serialization and the clipboard

- `BinaryFormatter` still works on 4.8, so legacy clipboard / drag-drop payloads and settings may ride
  it. It remains a remote-code-execution risk on untrusted input - prefer JSON for any new payload
  even here, and treat existing `BinaryFormatter` use as debt to retire on the move to modern .NET
  (where it is removed - see **modern-net.md**).

## Default font

The 4.8 default is **MS Sans Serif 8.25pt**. This is the baseline that shifts to Segoe UI 9pt on
modern .NET and drives the designer re-serialization covered in **modern-net.md** - note it now so
the layout diff during migration is expected, not alarming.

## Secrets on 4.8

- Windows DPAPI (`System.Security.Cryptography.ProtectedData`) is **in-box** on 4.8 - no package
  needed. Apply the desktop trust-boundary rule from the parent SKILL.md: protect only the secret
  fields, with `CurrentUser` scope (not `LocalMachine`, which lets any process on the box decrypt).

## UI automation: FlaUI, not WinAppDriver

- **FlaUI** (over UI Automation) is the choice for new WinForms UI tests - try the UIA2 backend for
  WinForms. Keep to smoke and critical-path scope.
- **WinAppDriver is effectively dead** - its last release was v1.2.1 (November 2020), development was
  paused indefinitely, and its issue backlog is unmaintained. Keep existing WinAppDriver assets if you
  have them, but do not build new tests on it - steer new coverage to FlaUI.

## Project format

4.8 apps are typically classic (non-SDK) `.csproj` with `packages.config`. The first migration move is
to **convert to SDK-style while still targeting 4.8** and switch `packages.config` to
`PackageReference` - it shrinks the diff before any runtime change. That conversion and the full path
to the .NET 10 floor live in **modern-net.md**; the upgrade safety playbook is the `dotnet-migrate` skill's.
