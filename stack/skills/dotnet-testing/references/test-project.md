# Test project layout and test data builders

Read when creating a test project or fixture, or before writing test data for an aggregate.

## Test project conventions

- One test project per production project, mirroring namespace and folder structure.
- Folder layout inside test project mirrors the SUT's folder layout.
- Shared fixtures live in `*.TestSupport` / `*.Testing` projects when reused across multiple test projects; otherwise inline.
- Run the suite at minimal verbosity so the captured output stays lean: `dotnet test -v minimal` (or `--logger "console;verbosity=minimal"`), and read a failure by windowing to the first error / failed assertion, not the whole log - test output is context every seat that runs the gate pays for.

## Test data builders

Test data via one canonical builder per aggregate, not literal-soup constructors. Prefer a `record` builder with `init` defaults; when the type under test is itself a `record`, derive case variations with a `with` expression from a canonical instance (`var large = baseOrder with { Total = new(1500m, "USD") };`) instead of re-running setup. Use a fluent `OrderBuilder().WithCustomer(...).Build()` only when a setter needs computation or validation.
