# Coverage mechanics - exclusions, collection, the CRAP ranking

Read before measuring coverage or adding an exclusion - the .NET exclusion catalog, the coverlet collector, report formats, and ranking risk hotspots by CRAP.

## Standard exclusions (via `[ExcludeFromCodeCoverage]` or coverlet filters)

- `Program.cs`, `Main`, generic host bootstrap
- DI registration extensions
- Pure DTOs / records / POCOs with no behavior; plain auto-properties
- EF Core migrations and `DbContext.OnModelCreating`
- Generated code and framework configuration

## Coverage collection

- **coverlet** is the default collector (msbuild or runsettings). Combined with `dotnet test --collect:"XPlat Code Coverage"`.
- Reports via `ReportGenerator` for HTML / Cobertura / OpenCover formats.
- For CRAP-score risk hotspots, pair the coverage report with a complexity pass: CRAP = cyclomatic complexity weighed against that method's coverage, so a long, branchy, thinly-covered method ranks above a simple uncovered one. ReportGenerator emits complexity per method beside coverage, which is enough to rank; where the repo has a dedicated analysis for it, use that instead, and with neither, rank by uncovered branches alone.
