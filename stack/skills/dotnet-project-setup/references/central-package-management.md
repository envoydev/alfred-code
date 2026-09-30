# Central package management (CPM)

One file, `Directory.Packages.props` at the solution root, owns every NuGet version; projects reference packages without a version. That kills version drift across projects. The spine points here and does not restate it.

## Enable it

```xml
<!-- Directory.Packages.props -->
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
    <CentralPackageTransitivePinningEnabled>true</CentralPackageTransitivePinningEnabled>
  </PropertyGroup>

  <!-- one version variable per related family -->
  <PropertyGroup>
    <OpenTelemetryVersion>1.11.0</OpenTelemetryVersion>
  </PropertyGroup>

  <ItemGroup Label="App">
    <PackageVersion Include="Serilog" Version="4.2.0" />
    <PackageVersion Include="Microsoft.Extensions.Hosting" Version="8.0.1" />
  </ItemGroup>

  <ItemGroup Label="OpenTelemetry">
    <PackageVersion Include="OpenTelemetry.Extensions.Hosting" Version="$(OpenTelemetryVersion)" />
    <PackageVersion Include="OpenTelemetry.Instrumentation.AspNetCore" Version="$(OpenTelemetryVersion)" />
  </ItemGroup>

  <ItemGroup Label="Test">
    <PackageVersion Include="xunit" Version="2.9.3" />
    <PackageVersion Include="Microsoft.NET.Test.Sdk" Version="17.12.0" />
  </ItemGroup>
</Project>
```

Projects reference the packages with no version:

```xml
<!-- src/MyApp/MyApp.csproj -->
<ItemGroup>
  <PackageReference Include="Serilog" />
  <PackageReference Include="Microsoft.Extensions.Hosting" />
</ItemGroup>
```

## Rules

- **Add and remove through the CLI.** `dotnet add package <name>` writes both the central `PackageVersion` and the versionless `PackageReference`, and validates the package resolves; hand-adding invites typos and a malformed manifest. A version bump or a transitive pin is a one-line edit of `Directory.Packages.props`.
- Never inline a `Version` on a `PackageReference` while CPM is on - restore fails (NU1008); use `VersionOverride` for the rare exception, so the drift CPM exists to stop stays visible.
- Group a related family under one version variable (the OpenTelemetry block above) so a single edit moves them together; mismatched versions inside a family are a common break.
- CPM blocks floating versions (`1.0.*`) by default (NU1011) - restore stays deterministic; a fixed bracket range like `[8.5.2,9.0.0)` is still allowed, and `CentralPackageFloatingVersionsEnabled` lifts the block if you truly need one.

```bash
dotnet add package Serilog                 # both files, in sync
dotnet add package Serilog --version 4.2.0 # pin a specific version
dotnet remove package Serilog
dotnet restore                             # apply a version bump edited in Directory.Packages.props
```

## Transitive pinning

With `CentralPackageTransitivePinningEnabled` on, a `PackageVersion` entry pins that version even when the package arrives only as a transitive dependency - no direct `PackageReference` needed. This is the clean way to force a patched build of a vulnerable transitive package: add its `PackageVersion` and restore.

## Dev-only packages - PrivateAssets

A build-time or analyzer package should not flow to projects that reference yours. Keep its version central and mark the reference private:

```xml
<!-- Directory.Packages.props -->
<PackageVersion Include="SomeAnalyzer" Version="1.5.0" />

<!-- csproj: consumed here only, not exposed downstream -->
<PackageReference Include="SomeAnalyzer" PrivateAssets="all" />
```

Analyzer selection and config are `dotnet-code-quality`; SourceLink and packaging are the CI-and-deploy skill's.

## Escape hatch - VersionOverride

When one project genuinely needs a different version (rare):

```xml
<PackageReference Include="Serilog" VersionOverride="3.1.1" />
```

Use sparingly - each override is a pocket of the drift CPM prevents.

## Audit the dependency graph

```bash
dotnet list package --outdated                        # newer versions available
dotnet list package --vulnerable --include-transitive # known CVEs, including transitive
dotnet list package --deprecated                      # deprecated packages
```

`--vulnerable --include-transitive` is the report - it exits 0 on a finding, so it gates nothing in CI. The gate is restore-time NuGet Audit with `NU1903;NU1904` in `WarningsAsErrors` (and `NuGetAuditMode` `all` below net10.0, so transitive packages are audited too); a vulnerability usually rides in transitively, and transitive pinning (above) is how you pin the fix.
