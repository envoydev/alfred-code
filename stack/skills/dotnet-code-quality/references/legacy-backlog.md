# Legacy backlog: promote in batches, never all at once

The waves the skill body names, their prerequisites and the per-wave proof.

Flipping `TreatWarningsAsErrors=true` on an existing codebase yields hundreds of errors and floods the context; fix quality collapses. Promote a curated set of IDs via `WarningsAsErrors`, in waves, building green between each:

1. **Trivial hygiene first** - mechanical, near-zero-risk: `IDE0005` (unnecessary using), `CS0219`/`CS0168` (unused variable), `CS1591` (missing XML doc on public API), `CS0612`/`CS0618` (obsolete member). Add `IDE0005;CS0219;CS0168` to `WarningsAsErrors`, fix all, commit. `IDE0005` fires on build only with three prerequisites: `EnforceCodeStyleInBuild=true`, `GenerateDocumentationFile=true`, and `dotnet_diagnostic.IDE0005.severity = warning` in `.editorconfig` - without the second the build prints an `EnableGenerateDocumentationFile` warning and gates nothing. Never `CS8019`, a hidden diagnostic that `WarningsAsErrors` cannot promote (measured on SDK 10.0.203: three unused usings, `0 Warning(s) 0 Error(s)`). `GenerateDocumentationFile` is also what makes `CS1591` fire, on every undocumented public member - a warning flood the moment the property lands (an error flood under `TreatWarningsAsErrors`), so keep `CS1591` out of this wave's `WarningsAsErrors` and promote it in its own. Prove the wave before calling it green: add one deliberate unused using and quote the red `IDE0005` line before removing it.
2. **Code-quality CA rules next, by category** - put the category order to the user through one AskUserQuestion listing the categories, recommending the one with the most findings first: `CA2000` (dispose before scope loss), `CA1062` (validate public args), `CA2007` (`ConfigureAwait`), `CA1822` (mark static), `CA1860`/`CA1861` (LINQ/array perf).
3. **Promote security rules to error** - the `CA3xxx` (injection) and `CA5xxx` (crypto/TLS) families belong at `error` in `.editorconfig`; which rules and why is `dotnet-security`'s (A03 and A02).

Build green and commit between waves; the wave's proof is `dotnet build -warnaserror` at exit 0 with the wave's IDs promoted.
