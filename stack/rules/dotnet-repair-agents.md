---
paths: ["**/*.cs", "**/*.csproj", "**/*.sln", "**/*.slnx", "**/*.xaml", "**/Directory.Build.props", "**/Directory.Packages.props", "**/*.targets", "**/nuget.config", "**/NuGet.Config"]
---

<!-- Fires on every .NET file touch by design: build state has no glob, and this soft router
     replaced the retired require-convention-skill hard gate. The rent is these two lines: the
     resolver ask, the contract stop, the status-less return and the seat boundary live in
     habits-root-cause's broken-build section, loaded on every red build (audit 2026-10-30 RU-08);
     the seat names stay here because the graph's rule -> seat edge is what installs them. -->

A broken .NET build or red test suite is routed by the `habits-root-cause` skill's broken-build section, loaded first: here the build goes to `dotnet-build-error-resolver` (MC#### errors = WPF XAML markup compile are its scope too) and, once it is green, the tests to `dotnet-test-failure-resolver` - dispatch each exactly as the roster spells it.

A package change in a project file (a version bump, central package alignment in
`Directory.Packages.props`) is a migration step, not a repair: before its first edit, load the .NET
skill whose description covers updating NuGet packages, where the install has one.
