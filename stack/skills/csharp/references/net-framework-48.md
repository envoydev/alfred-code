# C# on .NET Framework (C# 7.3 on .NET Framework 4.6.x / 4.7.x / 4.8)

The authoritative house style for C# on .NET Framework: formatting, naming, and language-feature usage only. `SKILL.md` and `references/csharp-style.md` floor at .NET 8 / C# 12; this file is the delta for a Framework codebase, where the C# 7.3 language ceiling, the polyfill packages, and the `SynchronizationContext` async model differ - the modern conventions otherwise still apply. As everywhere, a project's own `.editorconfig` / `<docs-path>/code-style/CODE-STYLE.md` is higher priority than this general baseline. 4.8 is supported (tied to the Windows lifecycle) but frozen: write to these constraints, and treat the move to modern .NET as debt reduction (the migration path is `dotnet-migrate`).

Baseline: Microsoft/.NET Framework conventions with pragmatic senior-level overrides, aligned to legacy StyleCop + Rider default inspections.

Language version reality: .NET Framework tops out at C# 7.3 by default with the classic Roslyn toolchain. Newer C# language versions can be forced with `<LangVersion>` on the modern SDK-style project + newer compiler, but many features fail at runtime because they need runtime/BCL support (`Index`/`Range`, `IAsyncEnumerable`, default interface members, ref-struct interop, records without an `IsExternalInit` shim). This guide assumes plain C# 7.3. Where a feature needs a shim to work on Framework, it is called out explicitly. Pin an explicit `<LangVersion>` (e.g. `8.0`), never `latest` or `default`, so a build is not machine-dependent - the property lives in `Directory.Build.props` (the .NET solution and package setup skill's file).

Nullable reference types are NOT available on C# 7.3. Use `[NotNull]`/`[CanBeNull]` JetBrains annotations or `[ValidatedNotNull]` plus disciplined null checks instead.

---

## Contents

1. File layout
2. Formatting
3. Naming
4. Language feature usage
5. Modern BCL APIs are available - via NuGet, not in-box
6. Notes on forcing a newer LangVersion

## 1. File layout

- One top-level type per file. File name matches the type name.
- Block-scoped namespaces only. File-scoped namespaces are C# 10 and unavailable. Everything inside the type is indented one extra level.
- No implicit/global usings (C# 10 feature). Every file declares its own `using` directives.
- `using` directives inside or outside the namespace - pick one per repo and enforce it. Classic Framework/StyleCop convention puts them inside the namespace; the modern convention puts them outside. Be consistent. `System.*` sorted first.
- Remove unused usings. Sort alphabetically within groups.

```csharp
using System;
using System.Collections.Generic;
using System.Linq;

namespace Acme.Orders
{
    public sealed class OrderProcessor
    {
        // ...
    }
}
```

---

## 2. Formatting

Formatting rules are essentially identical to modern C# (`references/csharp-style.md`). The differences are all in features, not layout.

### Indentation and braces
- 4 spaces, no tabs.
- Allman braces for types, methods, properties, control blocks.
- Always use braces on `if`/`else`/`for`/`foreach`/`while`, even single-statement bodies.

### Line length and wrapping
- Soft limit 120 columns. One item per line for long argument lists and chains.
- Wrap LINQ/fluent chains one `.` per line.

### Spacing
- Space after keywords, none after method names. Spaces around binary operators. No trailing whitespace. Single blank line between members.

### `var` usage
- Same rule as modern: `var` when the type is apparent from the RHS, explicit type otherwise. Available since C# 3, so no constraint here.

### Expression-bodied members
- Expression-bodied methods, properties, accessors, constructors, and indexers are all available (C# 6 / 7). Use them for single-expression members.

### `this.` qualification
- Do not qualify with `this.` unless disambiguating. Rely on the `_` field prefix to distinguish fields from locals/parameters.

---

## 3. Naming

Identical to modern C#. Naming conventions have not changed across C# versions.

| Element | Convention | Example |
|---|---|---|
| Namespace, type, method, property, event, enum member | PascalCase | `OrderProcessor`, `TotalAmount` |
| Interface | PascalCase, `I` prefix | `IOrderRepository` |
| Type parameter | PascalCase, `T` prefix | `TKey`, `TResult`, `T` |
| Local variable, parameter | camelCase | `orderId`, `retryCount` |
| Private/internal instance field | `_camelCase` | `_repository` |
| Private/internal static field | `_camelCase` (or `s_camelCase`) | `_cache` |
| Constant | PascalCase | `MaxRetries` |
| Static readonly | PascalCase | `DefaultTimeout` |
| Async method | PascalCase, `Async` suffix | `LoadAsync` |
| Boolean | `Is`/`Has`/`Can` prefix | `IsActive`, `HasItems` |
| Local function (C# 7+) | PascalCase | `void ValidateInput()` |

Rules:
- No Hungarian notation. No `m_` prefix (still seen in old Framework code - do not carry it forward in new code). No mid-name underscores.
- Acronyms: two letters both caps (`IOStream`), three or more first letter only (`HtmlParser`, `HttpClient`).
- No unnecessary abbreviations. `Id`, `Db`, `Ui`, `Xml` are fine.
- Prefix private fields with `_`.
- `Async` suffix on `Task`-returning methods.

---

## 4. Language feature usage

The key difference from modern C#: a smaller feature set (C# 7.3 ceiling) and no nullable reference types. Below is what is available and how to use it, plus what is NOT available so nobody wastes time reaching for it.

### Null handling (no NRT)
- No `?`/`!` nullable-reference annotations. The compiler does no null-flow analysis.
- Guard public boundaries manually. Framework has no `ArgumentNullException.ThrowIfNull` (that is .NET 6+), so write the check or a small helper.
- Use `??` null-coalescing and `?.` null-conditional operators freely (C# 6). Use `??=` only if on C# 8+ via forced LangVersion; on 7.3 it is unavailable, so write `x = x ?? value`.
- Use JetBrains `[NotNull]` / `[CanBeNull]` annotations (from `JetBrains.Annotations`) to get Rider null-flow inspections that partially substitute for NRT.

```csharp
public void Process(Order order)
{
    if (order is null)
    {
        throw new ArgumentNullException(nameof(order));
    }
    // ...
}
```

### `out` variables and discards (C# 7.0/7.1)
- Use inline `out var` declarations. Use discards `_` for unused outs. (This is consuming a BCL `out` API; the house rule against `out`/`ref` in your OWN signatures still holds - return a tuple or result object.)

```csharp
if (int.TryParse(input, out var value))
{
    // use value
}
```

### Tuples (C# 7.0)
- Use value tuples for multiple returns. Name the elements. Deconstruct at the call site.
- `ValueTuple` ships in Framework 4.7+; on 4.6.x you need the `System.ValueTuple` NuGet package.

```csharp
public (string Name, int Count) GetSummary() => ("orders", 42);
var (name, count) = GetSummary();
```

### Pattern matching (C# 7.0 / 7.3)
- Available: `is` type patterns, `switch` statement with `case Type x:` and `when` guards, constant patterns.
- NOT available on 7.3: switch expressions (C# 8), property/tuple/positional patterns (C# 8), `and`/`or`/`not` combinators (C# 9), relational patterns (C# 9), list patterns (C# 11).
- Use `is null` / `is not null` - `is null` works on 7.0+, but `is not null` needs C# 9. On 7.3 write `!(x is null)` or `x != null`.

```csharp
switch (shape)
{
    case Circle c when c.Radius > 0:
    {
        return Area(c);
    }
    case Rectangle r:
    {
        return r.Width * r.Height;
    }
    default:
    {
        return 0;
    }
}
```

### Local functions (C# 7.0)
- Use local functions over `Func`/`Action` locals when you need a named helper scoped to one method, recursion, or `out`/`ref` capture.

### `ref` returns, `in` params, `ref readonly` (C# 7.2)
- Available. Use `in` parameters for large readonly structs to avoid copies. Use `ref readonly` returns where appropriate. These are fully supported on Framework.

### Expression-bodied everything (C# 7.0)
- Constructors, finalizers, accessors, and indexers can all be expression-bodied. Use where a single expression.

### `async`/`await`
- Fully supported. `Task`/`Task<T>`/`ValueTask` all available (`ValueTask` via `System.Threading.Tasks.Extensions` NuGet on older Framework).
- NOT available: `IAsyncEnumerable<T>` / `await foreach` (C# 8 + needs `Microsoft.Bcl.AsyncInterfaces` to even compile, awkward on Framework - avoid; add `System.Linq.Async` for LINQ over async streams if you must).
- **`ConfigureAwait(false)` on every library `await` is load-bearing here, not an optimization.** Unlike ASP.NET Core (no `SynchronizationContext`), classic ASP.NET (`AspNetSynchronizationContext`), WPF, and WinForms each install a real single-threaded context - it is your defense against the sync-over-async deadlock a blocking caller imposes.
- Do not block with `.Result` / `.Wait()` / `.GetAwaiter().GetResult()` from a context-bound thread - it deadlocks far more readily than on .NET Core. The fix is always async-all-the-way, never a blocking bridge; the `SemaphoreSlim`/cancellation mechanics are this skill's `references/concurrency.md`.
- In app-level code (a classic-ASP.NET controller, a UI event handler) keep the default so the continuation resumes on the context that owns `HttpContext.Current`, culture, and the UI thread. `async void` stays for event handlers only.

```csharp
public async Task<Order> GetAsync(int id)
{
    return await _repository.GetAsync(id).ConfigureAwait(false);
}
```

### LINQ
- Same guidance as modern: method syntax by default, query syntax for complex joins/grouping, avoid multiple enumeration, `Any()` over `Count() > 0`. No feature difference here.

### String handling
- String interpolation `$"..."` available (C# 6). Use it over `string.Format`.
- `nameof(...)` available (C# 6). Use it for member names in exceptions, logging, `INotifyPropertyChanged`.
- NO raw string literals (`"""..."""` is C# 11). For multi-line JSON/SQL/regex use verbatim strings `@"..."` and double the quotes, or external resource files.

```csharp
var sql = @"
    SELECT Id, Name
    FROM Orders
    WHERE Status = @status";
```

### Modifiers and immutability
- Mark classes `sealed` by default. Order modifiers consistently.
- Use `readonly` fields. Use `readonly struct` (C# 7.2) for immutable value types.
- No `init` accessors (C# 9). For construct-time-only properties use `{ get; }` set from the constructor, or `{ get; private set; }`.
- `required` members are C# 11 - unavailable. Enforce required construction via constructor parameters.

### Features explicitly NOT available on C# 7.3 (do not reach for these)
- Nullable reference types (C# 8)
- Switch expressions, property/positional patterns, `and`/`or`/`not` (C# 8/9)
- `using` declarations `using var x = ...;` (C# 8) - use `using (...) { }` blocks instead
- Records (C# 9) - use classes/structs with manual equality, or an `IsExternalInit` shim if you force LangVersion (fragile; avoid on Framework)
- Target-typed `new()` (C# 9)
- Top-level statements (C# 9)
- File-scoped namespaces, global usings (C# 10)
- Primary constructors (C# 12)
- Collection expressions `[...]` (C# 12)
- `field` keyword, extension members (C# 13/14)
- `Index`/`Range` (`x[^1]`, `x[1..3]`) - syntax is C# 8 and the types need a BCL shim; avoid on Framework

For all of the above, use the pre-feature equivalent:

```csharp
// using block instead of using declaration
using (var stream = File.OpenRead(path))
{
    // ...
}

// classic new instead of target-typed
private readonly List<string> _names = new List<string>();

// switch statement instead of switch expression
string label;
switch (order.Status)
{
    case OrderStatus.Paid:
    {
        label = "paid";
        break;
    }
    default:
    {
        label = "other";
        break;
    }
}
```

---

## 5. Modern BCL APIs are available - via NuGet, not in-box

- `Span<T>` / `Memory<T>` (`System.Memory`), `System.Text.Json`, and `ValueTask` (`System.Threading.Tasks.Extensions`) all target net462+ and run on 4.8. Adopting `IAsyncEnumerable` or `ValueTask` on net48 is a package reference plus `<LangVersion>` 8+, not a runtime upgrade.
- You get the API and the safety but not always the speed - which package supplies what, and why `Span<T>` is a 'slow span' on 4.8, is the .NET performance and memory-layout skill's.

---

## 6. Notes on forcing a newer LangVersion

If a Framework project sets `<LangVersion>` higher than 7.3 (possible on an SDK-style csproj with a modern compiler), these are safe because they are compiler-only:
- Target-typed `new()`, switch expressions, property patterns, `and`/`or`/`not`, `using` declarations, static local functions, `??=`.

These need runtime/BCL support and will NOT work or need a shim:
- Nullable reference types (works as compiler-only warnings, but no BCL annotations on Framework so accuracy is poor; the `[MaybeNull]`/`[NotNullWhen]` attributes need the `Nullable` NuGet package)
- Records (need `System.Runtime.CompilerServices.IsExternalInit` shim)
- `init` / `required` (need `IsExternalInit` / `RequiredMemberAttribute` shims)
- `Index`/`Range` (need `System.Index`/`System.Range` shims)
- `IAsyncEnumerable` (needs `Microsoft.Bcl.AsyncInterfaces`)
- Default interface members, static abstract interface members (need runtime support - not on Framework)

Recommendation for new Framework code: stay on 7.3 and keep it clean rather than shimming. If you want the modern feature set, that is the signal to target .NET 8+ instead.

Route out: pooling / `Span` speed / serialization -> the .NET performance and memory-layout skill; packages, `<LangVersion>`, and runtime config -> the .NET solution and package setup skill; the migration path off Framework -> `dotnet-migrate`.
