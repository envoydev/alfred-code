# Local .NET tools

CLI tools pinned per repository in `.config/dotnet-tools.json` rather than installed globally - the version travels with the repo, so every machine and CI runner uses the same one, with no cross-project conflicts. The spine points here and does not restate it.

## The manifest

```bash
dotnet new tool-manifest          # writes .config/dotnet-tools.json
dotnet tool install dotnet-ef     # adds an entry, pinned to the installed version
```

```json
{
  "version": 1,
  "isRoot": true,
  "tools": {
    "dotnet-ef": {
      "version": "8.0.11",
      "commands": ["dotnet-ef"],
      "rollForward": false
    },
    "csharpier": {
      "version": "1.3.0",
      "commands": ["csharpier"],
      "rollForward": false
    },
    "dotnet-reportgenerator-globaltool": {
      "version": "5.4.1",
      "commands": ["reportgenerator"],
      "rollForward": false
    }
  }
}
```

Two fields carry the reproducibility guarantee:

- `isRoot: true` - stop the manifest search at this file, so a stray manifest in a parent directory can't shadow it.
- `rollForward: false` - use the exact pinned version, never silently a newer one. Leave it false.

## The tools here

- **dotnet-ef** - EF Core migrations (`dotnet ef migrations add`, `dotnet ef database update`). The migration workflow around it - preview, rollback, re-verify - is `dotnet-migrate`.
- **csharpier** - the formatter (`dotnet csharpier format .`, `dotnet csharpier check .` in CI). Its config and how formatting is enforced as a build gate live in `dotnet-code-quality`.
- **reportgenerator** - turns coverage output into a report (`dotnet reportgenerator -reports:**/coverage.cobertura.xml -targetdir:coverage`). Coverage collection mechanics and the exclusion catalog live in `dotnet-testing`; the % bar itself is user-set via the `alfred-capture-test-coverage` capture.

## Restore before use - locally and in CI

A freshly cloned repo has the manifest but not the tools; `dotnet tool restore` installs the pinned set. Run it before any tool.

```yaml
# GitHub Actions
- uses: actions/setup-dotnet@v4
  with:
    global-json-file: global.json   # the same SDK the tools were pinned against
- run: dotnet tool restore
- run: dotnet csharpier check .
```

The wider workflow - jobs, caching, gates - is the CI-and-deploy skill's.

## Managing the set

```bash
dotnet tool list                 # installed local tools
dotnet tool update dotnet-ef     # bump the pin
dotnet tool uninstall dotnet-ef
```
