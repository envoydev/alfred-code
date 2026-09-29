# WPF on .NET Framework 4.8

The conventions in SKILL.md hold on net48 - WPF itself is fully supported there. What differs is
tooling plus a few app-composition and app-lifetime defaults; the cross-cutting deltas (the async
mechanism, C# version, security, packages) route to the shared net48 references below. 4.8 is supported
but frozen, so write portable and keep the eventual move to modern .NET cheap.

## CommunityToolkit.Mvvm source generators on net48 (the marquee constraint)

The toolkit's runtime types (`ObservableObject`, `RelayCommand`, `WeakReferenceMessenger`,
`ObservableValidator`) always work on net48 - they ship in the package's .NET Standard 2.0 assembly. The
**source generators** (`[ObservableProperty]`, `[RelayCommand]`) are the catch, and three conditions
must all hold or a generated member silently never appears:

- **PackageReference, not packages.config** - under packages.config the generators do not load at all
  (8.2.1+ at least warns). Converting is the .NET solution-setup skill's (the one covering projects, packages and
  `Directory.Build.props`), in its .NET Framework 4.8 notes, where the install has it.
- **C# 8.0+** - set `<LangVersion>8.0</LangVersion>` or higher; the net48 default of C# 7.3 fails with
  error `MVVMTK0008`. The language-ceiling details and polyfills are in the `csharp` skill's
  .NET Framework 4.8 notes.
- **Build with the .NET 6 SDK or later** (VS 2022 or a modern Rider).

The robust fallback, which also eases migration: put the view models in a separate **.NET Standard 2.0
class library** with C# 8+ enabled and reference it from the net48 WPF app - the generators run there
unconditionally, and that library ports to .NET 8/9 unchanged.

## Composition with the Generic Host

- The WPF Generic Host pattern from SKILL.md is unchanged on net48; the only delta is that
  `Microsoft.Extensions.Hosting` and the DI / Configuration / Logging packages run via their .NET
  Standard 2.0 assemblies (build and start the host in an async `OnStartup`, stop it in `OnExit`).
- Prefer `appsettings.json` + the Options pattern (`IOptions<T>`) over `App.config` - it works on net48
  and is what a future .NET 8 version wants. The toolkit's `Ioc.Default` static provider is a
  service-locator stopgap; constructor injection through the host is the default.

## Threading and app-level exceptions

- The sync-over-async deadlock is live: WPF's `DispatcherSynchronizationContext` runs continuations only
  on the UI thread, so blocking it (`.Result` / `.Wait()`) while awaiting deadlocks. The mechanism and
  the library `ConfigureAwait(false)` rule are in the `csharp` skill's .NET Framework 4.8 and
  concurrency notes; a plain `await` in view-model code correctly resumes on the UI thread. Use `DispatcherTimer` only for UI-thread ticks and a background timer (then
  marshal via `Dispatcher.InvokeAsync`) for polling.
- Wire the app-level handlers in `App`: `Application.DispatcherUnhandledException` (UI thread; set
  `Handled` to keep running), `AppDomain.CurrentDomain.UnhandledException` (any thread, log-only, the
  process still ends), and `TaskScheduler.UnobservedTaskException` (`SetObserved()`). On net48,
  `<ThrowUnobservedTaskExceptions enabled="true"/>` in app.config restores fail-fast for unobserved task
  exceptions. Each fires for its own thread only - worker-thread faults still need local handling.

## Theming and clipboard

- The built-in Fluent `ThemeMode` is a .NET 9+ feature and does not exist on net48 - build dark / light
  with swapped resource dictionaries (the discipline in `references/styling-theming.md`), not the Fluent
  theme.
- `BinaryFormatter` still ships on net48 (unlike .NET 9, where clipboard / drag-drop of a custom type
  throws), so old payload code keeps working - but it is an RCE vector, so keep SKILL.md's
  JSON-payload rule. The deserialization threat model is the .NET application-security skill's (OWASP hardening for .NET
  services), in its .NET Framework 4.8 notes, where the install has it.

## Route out

C# 7.3 ceiling / `Nullable` / `PolySharp` / records -> `csharp`; SDK-style + PackageReference conversion
-> `dotnet-project-setup`; TLS, `BinaryFormatter`, code signing, dependency scanning -> `dotnet-security`;
DPAPI `ProtectedData` for local secrets -> the cryptography-primitives skill, where installed; the migration path (portable .NET
Standard 2.0 libraries, `WebBrowser` -> WebView2, the dead-ends to avoid) -> `dotnet-migrate`; test
framework and structure -> `dotnet-testing`. For WPF UI automation use FlaUI (UIA3 for WPF); WinAppDriver
is abandoned. WPF virtualization, weak events, and `INotifyDataErrorInfo` validation are SKILL.md's,
and theming `references/styling-theming.md`'s - all unchanged on net48.
