---
name: ilspy-decompile
description: "Use to decompile a .NET .dll or NuGet package with ilspycmd - 'what does this package actually do', 'where is this implemented'. Not for source you have."
---

# ilspy-decompile

Decompile a compiled assembly when you need the real implementation - a framework internal, a NuGet package you have no source for, or the exact behavior of a method before you upgrade across it. For source you already have, navigate with the navigation server / the LSP instead; this is only for compiled `.dll` you cannot open otherwise.

## When to use

- Reads a compiled assembly's real implementation when you need ground truth from a .dll or NuGet package - also 'did behavior change before an upgrade'.
- Not for source you already have - navigate that with the navigation server or the LSP.

## Tool

`ilspycmd`. Default to the no-install form:

```bash
dnx ilspycmd -h                       # needs the .NET 10 SDK, installs nothing
```

Where `dnx` is unavailable, the tool has to be installed, and that is the user's call, never yours. Ask ONE AskUserQuestion before running any install, with these options: pin it per-repo in `.config/dotnet-tools.json` (recommended - the version is committed and the machine stays clean), install it globally (`dotnet tool install --global ilspycmd`), or skip the decompile and report the question UNANSWERED. Where the harness has no AskUserQuestion tool, ask the same three options in plain text and wait. Never install on your own judgement.

Flags vary by version - confirm with `ilspycmd -h`.

## Locate the assembly

- NuGet package: `~/.nuget/packages/<package-name>/<version>/lib/<tfm>/`
- Build output: `./bin/Debug/net8.0/<AssemblyName>.dll` (or `Release/.../publish/`)
- Runtime libraries: the shared-framework folder under the SDK (`dotnet --list-runtimes` shows the paths). Reference assemblies hold no implementation - decompile the runtime `.dll`, not the ref.

## Commands

```bash
ilspycmd MyLibrary.dll                       # whole assembly to stdout
ilspycmd -o ./decompiled MyLibrary.dll       # to a folder
ilspycmd -p -o ./project MyLibrary.dll       # reconstruct a .csproj
ilspycmd -t Namespace.ClassName MyLibrary.dll # one type only (fastest)
ilspycmd -il MyLibrary.dll                   # raw IL
```

Workflow: identify what you want to understand, locate the assembly, decompile the one type (`-t`) rather than the whole thing.

Confirm the output before you reason from it: a `-t` run that prints only a namespace and an empty type body means the assembly is ReadyToRun, trimmed, or a reference assembly - the implementation is not in that file. Re-run against a non-trimmed build, or the runtime `.dll` rather than the ref, before quoting anything as the real behavior.

## Modern-build caveats

ReadyToRun images, trimmed builds, and NativeAOT all reduce or omit decompilable code - prefer a non-trimmed Debug/Release build when you have the choice. Decompiling third-party code may be license-restricted; use it to understand, not to redistribute.
