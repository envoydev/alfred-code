---
name: ilspy-decompile
description: "Use to decompile a .NET .dll or NuGet package with ilspycmd - 'what does this package actually do', 'where is this implemented'. Not for source you have."
---

# ilspy-decompile

Decompile a compiled assembly when you need the real implementation - a framework internal, a NuGet package you have no source for, or the exact behavior of a method before you upgrade across it. For source you already have, navigate with the navigation server / the LSP instead; this is only for compiled `.dll` you cannot open otherwise. An API signature is the documentation server's question; decompile only for implementation behavior.

## When to use

- Reads a compiled assembly's real implementation when you need ground truth from a .dll or NuGet package - also 'did behavior change before an upgrade'.
- Not for source you already have - navigate that with the navigation server or the LSP.

## Tool

`ilspycmd`, pinned. It is a third-party tool, so running it is the user's call - ONE AskUserQuestion before any dnx or install command:

```ask
Decompiling needs ilspycmd, a third-party tool. Run it once through dnx, pinned: nothing is installed and the version is fixed.
- 'Run it once through dnx (Recommended)' - `dnx ilspycmd@<version> --yes -- ...`; the package lands only in the NuGet cache
- 'Pin it per-repo' - `.config/dotnet-tools.json` commits the version and the machine stays clean
- 'Install it globally' - `dotnet tool install --global ilspycmd --version <version>`
- 'Skip the decompile' - report the question UNANSWERED
```

Where `dnx` is unavailable (an SDK before .NET 10), drop the first option and recommend the per-repo pin. Where the harness has no AskUserQuestion tool, ask the same options in plain text and wait. Never download or install on your own judgement.

Once approved, the no-install form (the .NET 10 SDK; nothing lands on `PATH`):

```bash
dnx ilspycmd@<version> --yes -- -h    # <version>: the ilspycmd release you checked on NuGet at use
```

Arguments after `--` go to the tool - without it, `-h` prints dnx's own help. `dnx` asks before it downloads and runs a package: in a shell with no terminal it stops with 'Tool package download needs confirmation' (measured on the 10.0.203 SDK). `--yes` answers it for the user, which is why it rides only on the approval above. A release built for a newer runtime than the machine has needs `--allow-roll-forward`. Flags vary by version - confirm with the `-h` run; with dnx, run each command below as `dnx ilspycmd@<version> --yes -- <arguments>`.

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

Confirm the output before you reason from it: a `-t` run that prints only a namespace and an empty type body means the assembly is ReadyToRun, trimmed, or a reference assembly - the implementation is not in that file. Re-run against a non-trimmed build, or the runtime `.dll` rather than the ref, before quoting anything as the real behavior. Report the assembly path and package version, the command, and the decompiled member quoted - never a paraphrase alone.

## Modern-build caveats

ReadyToRun images, trimmed builds, and NativeAOT all reduce or omit decompilable code - prefer a non-trimmed Debug/Release build when you have the choice. Decompiling third-party code may be license-restricted; use it to understand, not to redistribute.
