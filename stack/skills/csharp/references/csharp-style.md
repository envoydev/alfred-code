# Modern C# code style (.NET 8 / 9 / 10, C# 12 / 13 / 14)

The authoritative house style for modern C#: formatting, naming, and language-feature usage only. No architecture, no design patterns, no project structure - those stay in `SKILL.md` and route through the .NET router skill, where the install has one. This is the general baseline; a project's own `.editorconfig` and its `<docs-path>/code-style/CODE-STYLE.md` are HIGHER priority - where a project diverges, the project wins and this document yields.

Baseline: Microsoft/.NET runtime conventions with pragmatic senior-level overrides, aligned to the Roslyn analyzers and JetBrains Rider default inspections. Enforce via the canonical `.editorconfig` at the end of this document.

Language version assumption: `<LangVersion>` set to `latest` or pinned per target (`12` for .NET 8, `13` for .NET 9, `14` for .NET 10). Nullable reference types are `enable` project-wide.

## Contents
1. File layout
2. Formatting
3. Naming
4. Language feature usage
5. XML documentation
6. Canonical `.editorconfig`

---

## 1. File layout

- One top-level type per file. File name matches the type name.
- Use file-scoped namespaces. No block namespace, no extra indentation level.
- Enable and use global usings for framework namespaces (`System`, `System.Collections.Generic`, `System.Linq`, `System.Threading.Tasks`) via `<ImplicitUsings>enable</ImplicitUsings>`. Keep project-specific global usings in a single `GlobalUsings.cs`.
- `using` directives outside the namespace, sorted: `System.*` first, then other namespaces alphabetically, then aliases, then `static` usings. Remove unused usings.
- No BOM. UTF-8. LF or CRLF consistently per repo (pick one in `.editorconfig`).

```csharp
// File: OrderProcessor.cs
using System.Text.Json;
using Acme.Domain;

namespace Acme.Orders;

public sealed class OrderProcessor
{
    // ...
}
```

---

## 2. Formatting

### Indentation and braces
- 4 spaces, no tabs.
- Allman braces (opening brace on its own line) for types, methods, properties, and control blocks. This is the Microsoft/Rider default; keep it.
- Always use braces for `if`/`else`/`for`/`foreach`/`while`, even single-statement bodies. No exceptions. Prevents the goto-fail class of bug.

```csharp
if (order is null)
{
    return;
}
```

### Switch case blocks

Every `switch` case body sits in its own `{ }` block, even a one-statement case - the house rule `SKILL.md` states - so each case gets its own scope and no variable leaks into the next. A blank line goes before `break` / `return` when another statement precedes it, and none when the transfer is the only statement after `{` (the `default` below).

```csharp
switch (x)
{
    case A:
    {
        DoA();

        break;
    }
    case B:
    {
        var y = Compute();
        Use(y);

        return;
    }
    default:
    {
        return;
    }
}
```

### Line length and wrapping
- Soft limit 120 columns. Wrap long member access chains and long argument lists one item per line.
- When wrapping a chain, put each `.` on a new line aligned under the receiver.

```csharp
var result = source
    .Where(x => x.IsActive)
    .Select(x => x.Id)
    .ToList();
```

### Spacing
- One space after keywords (`if (`, `while (`), none after method names (`Foo(`).
- Spaces around binary operators. No space around unary or `.`.
- No trailing whitespace. One blank line between members. Never more than one consecutive blank line - that is the formatter's to catch, or IDE2000 (experimental: `dotnet_style_allow_multiple_blank_lines_experimental = false`).

### Member order and StyleCop
The house member order (SKILL.md's 'Class member ordering') has no SDK analyzer behind it, and StyleCop is no stand-in: its SA1201 puts constructors before properties and SA1202 puts public members before private, so adding that pack flags the house order rather than holding it.

### `this.` qualification
- Do not qualify with `this.` unless required to disambiguate (e.g. constructor parameter shadowing when not using primary constructors). Rider flags redundant `this.` by default.

### `var` usage
- Use `var` when the type is apparent from the right-hand side (`new`, casts, obvious factory methods, literals).
- Use an explicit type when the RHS type is not obvious from reading the line, or when it aids readability for numeric widths.
- Be consistent within a file. Do not mix `var x = new Foo()` and `Foo y = new()` arbitrarily.

```csharp
var user = new User();                    // apparent
var count = items.Count;                   // apparent enough
Dictionary<string, int> map = BuildMap();  // not apparent -> explicit
```

### Target-typed `new`
- Prefer target-typed `new()` when the type is stated on the left. Do not use it when it makes the type unclear.

```csharp
private readonly List<string> _names = new();
User user = new("Ada", active: true);
```

### Expression-bodied members
- Use expression bodies for single-expression methods, properties, and getters where they improve readability.
- Do not use expression bodies for multi-statement logic or where a block reads clearer. Constructors and complex methods stay block-bodied.

```csharp
public string FullName => $"{First} {Last}";
public int Square(int n) => n * n;
```

### Namespace and using sorting
- `System` directives first. Enforced by `dotnet_sort_system_directives_first = true`.

---

## 3. Naming

| Element | Convention | Example |
|---|---|---|
| Namespace, type, method, property, event, enum member | PascalCase | `OrderProcessor`, `TotalAmount` |
| Interface | PascalCase, `I` prefix | `IOrderRepository` |
| Type parameter | PascalCase, `T` prefix | `TKey`, `TResult`, `T` |
| Local variable, parameter | camelCase | `orderId`, `retryCount` |
| Private/internal instance field | `_camelCase` | `_repository` |
| Private/internal static field | `_camelCase` (or `s_camelCase` if following runtime style) | `_cache` |
| Constant (any accessibility) | PascalCase | `MaxRetries` |
| Static readonly | PascalCase | `DefaultTimeout` |
| Async method | PascalCase, `Async` suffix | `LoadAsync` |
| Boolean | affirmative `Is`/`Has`/`Can` prefix | `IsActive`, `HasItems` |
| Local function | PascalCase | `void ValidateInput()` |

Rules:
- No Hungarian notation. No `m_` prefix. No underscores in the middle of names.
- Acronyms: two letters both caps (`IOStream`, `dbId` local), three or more caps only first letter (`HtmlParser`, `JsonReader`, `HttpClient`). Follow the framework: it is `HttpClient`, not `HTTPClient`.
- Do not abbreviate unless the abbreviation is more common than the full word (`Id`, `Db`, `Ui`, `Json`, `Html` are fine). No `usr`, `mgr`, `cnt`.
- Async suffix `Async` on any method returning `Task`/`ValueTask`/`Task<T>`. Omit only for well-known exceptions like entry points or where an interface (e.g. controller actions) makes it noise; be consistent.
- Prefix private fields with `_`. This is near-universal in modern C# and is what Rider defaults to. Do not use `this.` as a substitute.

---

## 4. Language feature usage

### Nullable reference types
- `<Nullable>enable</Nullable>` everywhere. Treat nullable warnings as errors in CI (`<WarningsAsErrors>nullable</WarningsAsErrors>` or full `TreatWarningsAsErrors`).
- Do not use `!` (null-forgiving) to silence warnings unless you can justify it with a comment. It is an escape hatch, not a fix.
- Annotate intent: `string?` means genuinely optional. Use `ArgumentNullException.ThrowIfNull(x)` at public boundaries rather than manual checks.

```csharp
public void Process(Order order)
{
    ArgumentNullException.ThrowIfNull(order);
    // ...
}
```

### Records
- Use `record` (reference) for immutable data carriers and DTOs. Use `record struct` for small immutable value aggregates.
- Prefer positional records for pure data; switch to init-only properties when you need doc comments, attributes, or validation.
- Do not use records for entities with identity-based equality where you want reference semantics - records give value equality by default.

```csharp
public record OrderLine(string Sku, int Quantity, decimal UnitPrice);
```

### Primary constructors (C# 12+)
- Use primary constructors on classes to capture dependencies and reduce boilerplate, but be aware the captured parameters are mutable and in scope for the whole type. For DI dependencies, assign to a `private readonly` field if you want immutability guarantees, or accept the captured-parameter style consistently across the codebase.
- Prefer primary constructors on records and simple classes. For services with many dependencies, a primary constructor is cleaner than the classic field-and-assign pattern.

```csharp
public sealed class OrderService(ILogger<OrderService> logger, IOrderRepository repository)
{
    public async Task<Order> GetAsync(int id)
    {
        logger.LogInformation("Loading order {Id}", id);
        return await repository.GetAsync(id);
    }
}
```

### Collection expressions (C# 12+)
- Use `[]` collection expressions for array, `List<T>`, `Span<T>` initialization. Use the spread `..` operator to compose.
- Target types: arrays, spans, `List<T>`, `ImmutableArray<T>`, the collection interfaces (`IEnumerable<T>`, `IReadOnlyList<T>`, `IList<T>`, ...) and any collection-builder type - all C# 12; C# 13 adds `params` collections (`params ReadOnlySpan<T>`), so a collection expression flows into those too. A newer target type or context is verified via the documentation server at adoption, never assumed from a release headline.

```csharp
int[] primes = [2, 3, 5, 7];
List<string> all = [.. defaults, .. overrides];
IEnumerable<int> GetNumbers() => [1, 2, 3, 4];   // interface target - C# 12
```

### Pattern matching
- Prefer pattern matching over type-check-then-cast and over long `if/else` ladders.
- Use `is null` / `is not null` rather than `== null` / `!= null` for reference and nullable checks. This cannot be broken by an overloaded `==`.
- Use switch expressions for value-returning branching. Keep arms short; extract to methods if an arm grows.
- Use property, list, and relational patterns where they read clearly.

```csharp
var label = order switch
{
    { Status: OrderStatus.Paid } => "paid",
    { Total: > 1000 } => "large",
    null => "none",
    _ => "other",
};

if (value is not null)
{
    // ...
}
```

### `field` keyword (C# 13 preview / C# 14 stable)
- Use `field` in property accessors to add lightweight logic (normalization, guards) without declaring an explicit backing field. Do not overuse it to hide heavy logic in a property.

```csharp
public string Name
{
    get;
    set => field = value?.Trim() ?? throw new ArgumentNullException(nameof(value));
} = "";
```

### Extension members (C# 14)
- Prefer the new `extension` block syntax for grouping related extensions (methods, properties, operators, static members). Use extension properties for state-like checks that were previously helper methods.
- Keep extensions in a clearly named `static` class. Do not add extensions to types you own where an instance member belongs.

```csharp
public static class StringExtensions
{
    extension(string? s)
    {
        public bool IsBlank => string.IsNullOrWhiteSpace(s);
    }
}
```

### Null-conditional assignment (C# 14)
- Use `?.` / `?[]` on the left side of assignment to skip the explicit null check where it reads clearly.

```csharp
customer?.Order = newOrder;   // no-op if customer is null
```

### Async
- Use `async`/`await` end to end. Do not block with `.Result` or `.Wait()`.
- Return `Task`/`Task<T>`; use `ValueTask` only for hot paths that frequently complete synchronously, and never await a `ValueTask` twice.
- Do not use `async void` except for event handlers.
- Prefer `await foreach` with `IAsyncEnumerable<T>` for async streaming rather than materializing lists.
- Suffix async methods with `Async`.

### LINQ
- Use method syntax by default. Query syntax is acceptable for complex joins/`group by` where it reads better; do not mix both styles in one expression.
- Prefer explicit, readable chains over dense one-liners. One operator per line when wrapping.
- Avoid multiple enumeration of the same `IEnumerable`. Materialize with `ToList()`/`ToArray()` once if you enumerate more than once.
- Prefer specific terminal operators (`FirstOrDefault`, `SingleOrDefault`, `Any`) with intent; `Any()` over `Count() > 0`.

### String handling
- Use string interpolation `$"..."` over `string.Format` and concatenation.
- Use raw string literals `"""..."""` for JSON, SQL, regex, and any multi-line or quote-heavy content.
- Use `nameof(...)` instead of string literals for member names (arguments, logging, exceptions). C# 14 allows `nameof` on unbound generics (`nameof(List<>)`).

```csharp
var json = """
    {
        "id": 1,
        "name": "order"
    }
    """;
```

### Modifiers and immutability
- Mark classes `sealed` by default unless designed for inheritance. Sealed is the correct default; unseal deliberately.
- Order modifiers: `public`/`private`/... , `static`, `virtual`, `abstract`, `sealed`, `override`, `readonly`, `async`. Enforced by `csharp_preferred_modifier_order`.
- Prefer `readonly` fields and `readonly struct` where the data does not mutate. Prefer `init` accessors over `set` for construct-time-only properties.
- Make explicit access modifiers everywhere; do not rely on implicit `private`. (Rider flags missing modifiers as a style choice; be explicit.)

### `using` declarations
- Prefer `using` declarations (`using var x = ...;`) over `using (...) { }` blocks when the scope is the enclosing block.

```csharp
using var stream = File.OpenRead(path);
```

### Miscellaneous
- Use `switch` expressions and target-typed `throw` expressions where they simplify code.
- Use tuple deconstruction for multiple return values; name tuple elements.
- Prefer `is` patterns and `and`/`or`/`not` combinators over chained comparisons.
- Do not use `#region`. If a file needs regions to be navigable, it is too big.
- Prefer `const` for true compile-time constants, `static readonly` for runtime-initialized shared values.

---

## 5. XML documentation

- Public and protected members carry XML docs; internal and private ones only when the name and signature leave the contract unclear.
- The tag set, when a doc comment is written: `<summary>`, `<param>` for every parameter, `<typeparam>` for every type parameter, `<returns>` for non-void, `<exception>` for exceptions thrown by contract (argument validation, domain rules), `<inheritdoc/>` on overrides and interface implementations. A partial set trips CS1573.
- Form and content - one line per tag, the shortest accurate phrase, a summary in domain terms, no ticket ids - are the house code-comments skill's, and the project's own doc-comment convention wins over both.

---

## 6. Canonical `.editorconfig`

Drop this at the repo root. It encodes the rules above for both the compiler analyzers and Rider.

```ini
root = true

[*.cs]
indent_style = space
indent_size = 4
tab_width = 4
end_of_line = crlf   # repo-wide pick per section 1 - flip to lf where the repo standardizes on LF
insert_final_newline = true
trim_trailing_whitespace = true
charset = utf-8
max_line_length = 120

# Language / feature preferences
csharp_style_namespace_declarations = file_scoped:error
csharp_using_directive_placement = outside_namespace:warning
dotnet_sort_system_directives_first = true
dotnet_separate_import_directive_groups = false

csharp_prefer_braces = true:warning
csharp_style_var_for_built_in_types = false:suggestion
csharp_style_var_when_type_is_apparent = true:suggestion
csharp_style_var_elsewhere = false:suggestion

csharp_style_expression_bodied_methods = when_on_single_line:suggestion
csharp_style_expression_bodied_properties = true:suggestion
csharp_style_expression_bodied_accessors = true:suggestion
csharp_style_expression_bodied_constructors = false:suggestion

csharp_style_prefer_primary_constructors = true:suggestion
dotnet_style_object_initializer = true:suggestion
dotnet_style_collection_initializer = true:suggestion
csharp_style_prefer_collection_expression = true:suggestion

dotnet_style_prefer_is_null_check_over_reference_equality_method = true:warning
csharp_style_prefer_pattern_matching = true:suggestion
csharp_style_pattern_matching_over_is_with_cast_check = true:warning
csharp_style_pattern_matching_over_as_with_null_check = true:warning
csharp_style_prefer_switch_expression = true:suggestion

csharp_prefer_simple_using_statement = true:suggestion
csharp_style_prefer_index_operator = true:suggestion
csharp_style_prefer_range_operator = true:suggestion

dotnet_style_qualification_for_field = false:warning
dotnet_style_qualification_for_property = false:warning
dotnet_style_qualification_for_method = false:warning
dotnet_style_require_accessibility_modifiers = always:warning
csharp_preferred_modifier_order = public,private,protected,internal,file,static,extern,new,virtual,abstract,sealed,override,readonly,unsafe,required,volatile,async:warning

dotnet_style_prefer_conditional_expression_over_assignment = true:suggestion
dotnet_style_null_propagation = true:suggestion
dotnet_style_coalesce_expression = true:suggestion

# Nullable
dotnet_diagnostic.CS8600.severity = warning
dotnet_diagnostic.CS8602.severity = warning
dotnet_diagnostic.CS8618.severity = warning

# Naming: private fields _camelCase
dotnet_naming_rule.private_fields_underscore.symbols = private_fields
dotnet_naming_rule.private_fields_underscore.style = underscore_camel
dotnet_naming_rule.private_fields_underscore.severity = warning
dotnet_naming_symbols.private_fields.applicable_kinds = field
dotnet_naming_symbols.private_fields.applicable_accessibilities = private,internal
dotnet_naming_style.underscore_camel.capitalization = camel_case
dotnet_naming_style.underscore_camel.required_prefix = _

# Naming: interfaces I-prefixed PascalCase
dotnet_naming_rule.interfaces_i_prefix.symbols = interfaces
dotnet_naming_rule.interfaces_i_prefix.style = i_pascal
dotnet_naming_rule.interfaces_i_prefix.severity = warning
dotnet_naming_symbols.interfaces.applicable_kinds = interface
dotnet_naming_style.i_pascal.capitalization = pascal_case
dotnet_naming_style.i_pascal.required_prefix = I

# Naming: async methods Async-suffixed
dotnet_naming_rule.async_suffix.symbols = async_methods
dotnet_naming_rule.async_suffix.style = async_style
dotnet_naming_rule.async_suffix.severity = suggestion
dotnet_naming_symbols.async_methods.applicable_kinds = method
dotnet_naming_symbols.async_methods.required_modifiers = async
dotnet_naming_style.async_style.capitalization = pascal_case
dotnet_naming_style.async_style.required_suffix = Async
```
