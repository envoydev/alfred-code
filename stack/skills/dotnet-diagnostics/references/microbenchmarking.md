# Microbenchmarking with BenchmarkDotNet

The BenchmarkDotNet nucleus - a Release console project, one benchmark method, reading the table, comparing two implementations. Whether to benchmark at all (measure-first) lives in `SKILL.md`; the design choices a result justifies live in `dotnet-performance`.

## Contents

- Project setup
- Writing a benchmark
- Running and reading results
- Comparing two implementations

## Project setup

Benchmarks run in their own console project, never in a test project or the app - the harness needs a Release build with its own optimizations and a stable entry point.

```bash
dotnet new console -o Benchmarks
cd Benchmarks
dotnet add package BenchmarkDotNet          # no version - let NuGet resolve the latest
dotnet add reference ../src/MyLib/MyLib.csproj
```

Pin no version on the package: BDN versions in training data are stale and may not support the current runtime. `Program.cs` is one line:

```csharp
using BenchmarkDotNet.Running;

BenchmarkSwitcher.FromAssembly(typeof(Program).Assembly).Run(args);
```

`BenchmarkSwitcher` forwards CLI flags (`--filter`, `--job`) and lets you select cases; always pass `--filter` so it never hangs on an interactive prompt. To compare across runtimes, the `.csproj` must list them plural - `<TargetFrameworks>net8.0;net9.0</TargetFrameworks>` - or a multi-runtime run fails at build.

## Writing a benchmark

Annotate the class with `[MemoryDiagnoser]` so allocation shows up next to time - the two numbers that matter on a hot path. The method mistakes below silently produce wrong numbers, so they are not optional.

```csharp
[MemoryDiagnoser]
public class ParseBenchmark
{
    private string _input = null!;

    [Params(10, 1000)]                       // one case per value; stored in a field, not a literal
    public int Length { get; set; }

    [GlobalSetup]                            // runs once per case, not measured
    public void Setup() => _input = new string('7', Length);

    [Benchmark]                              // returns a value - a void body can be optimized away (DCE)
    public int Parse() => int.Parse(_input);
}
```

The rules that keep the measurement honest:

| Rule | Why |
|---|---|
| Return a value from the method | a `void` body with no observable effect can be eliminated by the JIT |
| Read inputs from a field or `[Params]`, never a literal or `const` | the JIT folds constant inputs and you measure a precomputed answer |
| Put initialization in `[GlobalSetup]` | setup inside the method is measured |
| No manual `for` loop in the method | BDN picks the invocation count; a loop adds overhead and hides variance |
| Materialize deferred sequences (`.ToList()`) | returning an `IEnumerable<T>` measures only building the query, not running it |
| `[IterationSetup]` only to reset mutated state | it forces one invocation per iteration, so the op must be long enough to measure |

Vary inputs with `[Params]` (a property, applies to every method in the class) or `[Arguments]` (method-level); use `[ParamsSource]`/`[ArgumentsSource]` when the values are computed. Async methods returning `Task`/`ValueTask` work with no extra attribute - but never wrap a synchronous op in `async`, the state machine lands in the measurement.

## Running and reading results

BDN console output is hundreds of verbose lines per case. Build once, then run filtered subsets with output redirected and `--noOverwrite` so a re-run does not clobber the previous report - BDN appends a unique suffix to each result filename instead of overwriting it:

```bash
dotnet build -c Release
dotnet run -c Release --no-build -- --filter "*Parse*" --noOverwrite > benchmark.log 2>&1
```

Validate with `--job Dry` (each case runs once, under a second) before committing to a real run - it catches compile and setup errors for free. Use `--job Short` while iterating on design, default for final numbers. Each case takes 15-25 seconds at default settings, and `[Params]` multiplies out as a Cartesian product, so estimate the case count before a long run.

After a run, read the Markdown summary (`*-report-github.md`) from the results directory - not `benchmark.log`, which is only for chasing an error. The three columns to read:

- **Mean** - time per operation. Absolute value is machine-specific; trust the comparison, not the number.
- **Allocated** - managed bytes per operation (needs `[MemoryDiagnoser]`). Zero is the target on a hot path.
- **Ratio** - each case relative to the baseline, present only when a baseline is marked. `0.85` is ~15% faster; `1.00` is the baseline itself.

## Comparing two implementations

A single number confirms only an order of magnitude - a benchmark earns its keep by comparing. The simplest comparison keeps both implementations in the same class and marks one baseline, so BDN runs them under identical conditions and prints the ratio:

```csharp
[MemoryDiagnoser]
public class SortBenchmark
{
    private int[] _data = null!;

    [GlobalSetup]
    public void Setup() => _data = Enumerable.Range(0, 1000).Reverse().ToArray();

    [Benchmark(Baseline = true)]
    public int[] Bubble()
    {
        var a = (int[])_data.Clone();
        Sorting.Bubble(a);
        return a;
    }

    [Benchmark]
    public int[] Quick()
    {
        var a = (int[])_data.Clone();
        Sorting.Quick(a);
        return a;
    }
}
```

Both cases pay the clone, so the Ratio understates the gap - add a clone-only baseline when the gap matters.

Prefer this side-by-side form whenever both versions compile together - it controls for environmental variance that separate runs cannot. To compare the same code across runtimes, mark no method baseline; pass `--runtimes net8.0 net9.0` (first listed is the baseline) with the plural `<TargetFrameworks>` set. To compare against a version you have already changed past, build and save the old output first (`dotnet build -o ./baseline`) and reference the saved DLL from a second job.
