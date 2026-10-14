# Migrating off .NET Framework 4.8

SKILL.md's Flow B raises a target framework the routine way (bump the TFM, match packages, read the
breaking changes). A .NET Framework 4.8 -> modern .NET move is bigger than a TFM bump for anything
non-trivial: the programming models differ and some pieces have no in-place path. This reference is the
net48-specific stance and blocker map; the four rules (preview, rollback, re-verify,
one-change-per-step) still govern.

## The stance

- 4.8 is supported (tied to the Windows lifecycle) but frozen - no features, APIs, or perf work, only
  security through Windows Update. Safe to run, a poor place to invest. Treat migration as debt
  reduction, not an emergency, and target the current LTS directly (.NET 10 - .NET 8 leaves support 2026-11-10), skipping STS releases.
- Migration is incremental, never big-bang. Do the prerequisites first - they pay off even if you stop
  there: `packages.config` -> `PackageReference` and SDK-style conversion (the solution-build-spine skill's own
  4.8 notes carry the conversion mechanics), then multi-target shared libraries
  (`<TargetFrameworks>net48;net10.0-windows</TargetFrameworks>`), upgraded leaf-first.

## The blocker map - upgrade vs replace

- **Mechanical (port):** class libraries, console apps, WPF, and WinForms - to `net10.0-windows` with
  `<UseWPF>` / `<UseWindowsForms>`; swap the `WebBrowser` control for WebView2 and replace AppDomain
  isolation. WPF and WinForms specifics belong to the desktop skills for each toolkit, where the project installed them.
- **Architectural (redesign):** classic ASP.NET (System.Web MVC / Web API) has no in-place path - stand
  up an ASP.NET Core entry point with a YARP reverse proxy and
  `Microsoft.AspNetCore.SystemWebAdapters`, then strangle routes one at a time (the Strangler Fig
  pattern). The adapters let shared libraries using `HttpContext` compile against .NET Framework, .NET
  Core, and .NET Standard 2.0 at once and bridge session / auth between the two apps, so keeping
  `HttpContext` at the edges and logic in POCO services (the classic-ASP.NET references' advice) is what
  makes the strangle mechanical.
- **Rewrite:** WebForms has no modern-.NET support (move to Blazor / MVC / Razor Pages) and is the
  single biggest blocker. Server-side WCF is not in modern .NET - port to CoreWCF (which reuses the
  contracts and much of the config) or rewrite to gRPC / REST. .NET Remoting, Code Access Security,
  AppDomains, and XBAP are unsupported (`AppDomain` members throw `PlatformNotSupportedException`; use
  `AssemblyLoadContext` or separate processes for isolation).
- **Data:** the current EF Core does not run on 4.8 (only EF Core 3.1 and earlier do), so stage it -
  4.8 + EF6 -> modern .NET + EF6 -> modern .NET + EF Core. Plan for the EF Core breaks (no `ObjectContext`, no EDMX, opt-in lazy loading, no silent
  client evaluation, incompatible migrations). The query and configuration mechanics belong to the skill covering the ORM layer.

## Tooling

- The generic upgrade sweep and the Upgrade Assistant vs Copilot tool choice are in SKILL.md's Flow B.
  Add the .NET Portability Analyzer / API Port to inventory unavailable APIs before you start.
