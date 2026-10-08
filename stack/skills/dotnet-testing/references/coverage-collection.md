# Coverage collection

The collection commands and the CRAP ranking the skill body's Coverage section cites. The % bar itself is the user's, recorded by the coverage capture - this file sets no number.

- **coverlet** is the default collector (msbuild or runsettings). Combined with `dotnet test --collect:"XPlat Code Coverage"`.
- Reports via `ReportGenerator` for HTML / Cobertura / OpenCover formats.
- For CRAP-score risk hotspots, pair the coverage report with a complexity pass: CRAP = cyclomatic complexity weighed against that method's coverage, so a long, branchy, thinly-covered method ranks above a simple uncovered one. ReportGenerator emits complexity per method beside coverage, which is enough to rank; where the repo has a dedicated analysis for it, use that instead, and with neither, rank by uncovered branches alone.
