# Coverage collection

The collection commands and the CRAP ranking the skill body's Coverage section cites. The % bar itself is the user's, recorded by the coverage capture - this file sets no number.

- **Read the runner first.** `global.json` naming `"test": { "runner": "Microsoft.Testing.Platform" }` (or `DOTNET_TEST_RUNNER=Microsoft.Testing.Platform` on .NET 11), or a test project run as an executable, is Microsoft.Testing.Platform (MTP); with neither, `dotnet test` runs VSTest. The VSTest collectors (`coverlet.collector`, `coverlet.msbuild`) cannot be used under MTP - the run passes and writes no coverage.
- **VSTest:** `coverlet.collector` is the default, run with `dotnet test --collect:"XPlat Code Coverage"` (or `coverlet.msbuild` with `/p:CollectCoverage=true`).
- **MTP:** reference `coverlet.MTP` and run `dotnet test --coverlet --coverlet-output-format cobertura`, or `Microsoft.Testing.Extensions.CodeCoverage` and run `dotnet test --coverage --coverage-output-format cobertura` (it leaves the test assembly out by default). An option whose package the test project does not reference fails the run with exit code 5.
- Reports via `ReportGenerator` for HTML / Cobertura / OpenCover formats.
- For CRAP-score risk hotspots, pair the coverage report with a complexity pass: CRAP = cyclomatic complexity weighed against that method's coverage, so a long, branchy, thinly-covered method ranks above a simple uncovered one. ReportGenerator emits complexity per method beside coverage, which is enough to rank; where the repo has a dedicated analysis for it, use that instead, and with neither, rank by uncovered branches alone.
