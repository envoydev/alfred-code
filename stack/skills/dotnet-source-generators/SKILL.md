---
name: dotnet-source-generators
description: "Use when writing or reviewing a Roslyn source generator, weighing compile-time codegen against reflection, or when the user says source generator, IIncrementalGenerator, ISourceGenerator, GeneratedRegex, LoggerMessage, or ForAttributeWithMetadataName. Covers both sides of the line - reaching first for the framework generators that exist (GeneratedRegex, LoggerMessage, the System.Text.Json context) and authoring your own only when none fits. Floors at .NET 8 / C# 12. Do NOT use for ordinary code that ships no generator."
---

# .NET source generators

A source generator is a compiler plugin: it runs during the build, reads the code being compiled, and adds *new* C# to that same compilation. It cannot mutate what you wrote - it only appends partial members, new types, or attributes. The payoff is moving work that would otherwise happen with runtime reflection (or by hand) to compile time, where it is faster, AOT-safe, and visible to the IDE. Baseline is .NET 8 / C# 12; the generator's own language conventions follow the C# language baseline.

## First question: does a framework generator already do this?

Most teams never need to write a generator. The .NET BCL ships several, and each replaces a reflection-heavy pattern with generated, trim-friendly code. Reach for these before authoring anything:

- **`[GeneratedRegex]`** - a `partial` method returning `Regex`, compiled at build time. Use it over `new Regex(pattern)` for any pattern that lives in source. The generated `Regex` skips the interpreter and the static-cache lookup, and the pattern is validated at build, not on first call.
- **`[LoggerMessage]`** - a `partial` logging method that emits the `ILogger` call with zero boxing and no message-template parsing at runtime. Use it for hot or structured log paths instead of `logger.LogInformation("...", a, b)`.
- **The `System.Text.Json` context** - a `partial class : JsonSerializerContext` annotated with `[JsonSerializable(typeof(T))]`, passed to serialize/deserialize. This removes the reflection metadata walk and is what makes JSON work under Native AOT and trimming.

These are configuration, not engineering. Add the attribute, mark the member or type `partial`, and the compiler fills in the body. Write a custom generator only when no built-in covers the shape you need.

## Authoring: the non-negotiable foundation

If you do author one, the rules below are not stylistic - violating them produces a generator that is slow in the IDE, breaks in CI, or silently caches stale output. The mechanics that satisfy them - project file, packaging layout, the trigger pipeline, model shapes, emit details - are in `references/authoring.md`; load it when actually writing or reviewing generator code.

- **Implement `IIncrementalGenerator`, never `ISourceGenerator`.** The legacy interface re-runs whole-hog on every keystroke and has been effectively deprecated since the incremental API arrived; the incremental pipeline caches each step and re-executes only what changed. There is no reason to write a new `ISourceGenerator`.
- **Package it as a `netstandard2.0` analyzer.** The generator assembly is loaded into the compiler, so it targets what Roslyn runs on regardless of what the consuming project targets (`LangVersion=latest` still allows modern C# inside it).
- **Trigger with `ForAttributeWithMetadataName`.** Roslyn indexes attribute usages, so the predicate sees only the handful of nodes that carry your marker attribute instead of you filtering every `SyntaxNode` in the compilation.
- **Carry value-equatable `record` models; never let `Compilation`, `ISymbol`, `SyntaxNode`, or `SyntaxTree` past the `transform` step.** Caching compares step outputs by value - symbols are reference-equal, mutable, and enormous, so holding one defeats the cache and pins compiler memory across edits. A bare array field breaks it the same way (arrays compare by reference) - wrap collections in an equatable type. Get this wrong and the generator re-emits on every keystroke.
- **Report a `Diagnostic`; do not throw.** A throw crashes the generation pass as an opaque build warning; a `Diagnostic` built from a `DiagnosticDescriptor` with a real `Location` lands the squiggle on the offending code - the same throw-vs-report split the C# baseline draws for application code.
- **Emit clean, attributable output** - raw string literals, `partial` members, `[GeneratedCode(...)]` stamps, stable hint names, fixed scaffolding via `RegisterPostInitializationOutput` (details in the reference).

## Testing

Snapshot-test the generator: it is the only way to see exactly what it emits and to catch drift. Three steps, in order:

1. Run the generator over a known input with `CSharpGeneratorDriver` and quote the run result.
2. Verify BOTH the generated sources and the reported diagnostics - Verify.SourceGenerators turns the result into a reviewable `.verified.cs` that fails the test on any change. The `.verified.cs` diff is the evidence; quote it when the output changed.
3. Assert diagnostics explicitly, including the case where the generator should stay silent.

The broader test-project setup belongs to the .NET testing hub.
