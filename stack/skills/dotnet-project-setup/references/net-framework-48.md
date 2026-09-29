# .NET project configuration on .NET Framework 4.8

The solution build spine in SKILL.md targets modern .NET; on a net48 project the dependency, language,
and runtime knobs differ. Several of these are worth doing even if you never migrate - they are also
migration prerequisites.

## packages.config -> PackageReference (do this first)

- Convert every project from `packages.config` to `PackageReference`: top-level-only project files, a
  global package cache, per-TFM conditioning, and - critically - it unlocks NuGet vulnerability
  auditing (the security-hardening skill's own 4.8 notes carry the audit detail) and is a prerequisite
  for SDK-style / modern-.NET migration. Use the VS 'Migrate packages.config to PackageReference' command (VS 2017
  15.7+). Blocker: this migration is not available for ASP.NET (System.Web) or C++ projects.
- Central Package Management (`Directory.Packages.props` with `<PackageVersion>`) works with
  PackageReference on net48 - adopt it as in `references/central-package-management.md`.

## Language version

- Pin `<LangVersion>` explicitly in Directory.Build.props (e.g. `8.0` / `9.0`), never `latest` - C# 7.3
  is the official net48 ceiling and higher versions only work for a subset. The
  compiler-only-vs-CLR-dependent feature matrix and the polyfill packages are in the `csharp` baseline's
  own 4.8 notes.

## Runtime configuration (app.config / web.config)

- **Server GC** is the highest-impact server knob and is off by default. Set
  `<gcServer enabled="true"/>` (with `<gcConcurrent enabled="true"/>`) under `<runtime>` - one heap plus
  one GC thread per CPU, far better server throughput. Keep Workstation GC for UI apps and for
  many-process boxes (per-CPU heaps multiply memory). The SDK-style `<ServerGarbageCollection>` MSBuild
  property does not work for full-Framework projects - use the app.config element. Hex tuning values
  (`GCHeapCount`) need the `0x` prefix on 4.8.
- Enable `<AutoGenerateBindingRedirects>` to tame Fusion binding-redirect churn (moving to
  PackageReference reduces it further by flattening transitive dependencies).
- Tiered compilation is a .NET Core / .NET 5+ feature and does not exist on 4.8 - do not look for a
  `TieredCompilation` knob; the startup lever here is NGen, not tiered JIT.

Migrating off 4.8 entirely (SDK-style conversion, multi-target, the blocker map) is the skill covering
target-framework and SDK upgrades, in its .NET Framework 4.8 notes, where the install has it.
