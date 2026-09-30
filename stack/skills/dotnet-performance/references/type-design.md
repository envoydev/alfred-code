# Allocation-aware type design

Defaults for a type on a hot path - a tight loop, a high-throughput pipeline, a serializer inner loop. Whether the hot-path test even applies, and the measure-first rule, live in `SKILL.md`; the language baseline (records, async, disposal, DI) is `csharp`.

## Seal by default

Seal any class not deliberately designed for inheritance. A sealed type lets the JIT devirtualize calls, and it states 'this is not an extension point' so a refactor can't silently break a subclass. Records are classes - seal them too.

```csharp
public sealed class OrderProcessor { public void Process(Order order) { } }
public sealed record OrderCreated(OrderId Id, CustomerId CustomerId);
```

An unsealed class with `virtual` members is then a deliberate design decision, not an accident.

## readonly struct vs class

Reach for a struct only for a small, immutable, short-lived value; everything else is a class. Mark it `readonly` so the compiler skips a defensive copy on every member access. A mutable struct is a well-known footgun - a write through a copy is silently lost.

```csharp
public readonly record struct OrderId(Guid Value)
{
    public static OrderId New() => new(Guid.NewGuid());
}
```

| Struct when | Class when |
|---|---|
| small (roughly <=16 bytes) | larger |
| short-lived, frequently allocated | long-lived |
| value semantics, immutable | identity semantics, shared references, mutable |

A large struct copied around costs more than a heap allocation - measure before making something a struct 'for speed'.

## Prefer static pure functions

A method that only maps inputs to an output should be `static`: no vtable lookup, no hidden state, trivially testable and thread-safe. Pass dependencies as parameters instead of hiding them in fields.

```csharp
public static Money CalculateTotal(IReadOnlyList<OrderItem> items, decimal taxRate) => /* ... */;
```

Keep instance methods where you genuinely need state or polymorphism - do not force everything static.

## Defer enumeration

Materialize a query once, at the end. Each `ToList` walks the sequence and allocates a list; a chain of them iterates repeatedly.

```csharp
// one materialization
_orders.Where(o => o.IsActive).OrderBy(o => o.CreatedAt).ToList();
```

Return `IEnumerable<T>` when the caller may not need every item; return a materialized `IReadOnlyList<T>` when you already walked it. For async, never a bare `Select(async ...)` left unawaited (that allocates a `Task` per item) - stream with `IAsyncEnumerable<T>` (plus `[EnumeratorCancellation]`), or fan out deliberately with `Task.WhenAll`.

## ValueTask for synchronous hot paths

Return `ValueTask<T>` from a hot method that usually completes synchronously (a cache hit) - it skips the `Task` allocation on that path. For a method that always does real I/O, return `Task`: it is simpler and carries none of the footguns.

```csharp
public ValueTask<User?> GetUserAsync(UserId id) =>
    _cache.TryGetValue(id, out var user) ? new(user) : new(FetchAsync(id));
```

`ValueTask` rules: await it at most once, and never read `.Result` before it completes. In doubt, use `Task`.

## Span and Memory for bytes

Take `ReadOnlySpan<T>` for synchronous slicing/parsing and `ReadOnlyMemory<T>` for the async equivalent, rather than forcing a `byte[]` or `string` allocation. Slice without copying; `stackalloc` a small scratch buffer; rent a large one from `ArrayPool<T>` and always return it.

```csharp
Span<byte> scratch = stackalloc byte[256];

var buffer = ArrayPool<byte>.Shared.Rent(4096);
try { /* use buffer */ }
finally { ArrayPool<byte>.Shared.Return(buffer); }
```

## Immutable and frozen return types

Return an interface the caller cannot mutate - `IReadOnlyList<T>` or `IReadOnlyCollection<T>` - even when you built it in a mutable `List<T>` internally. For static lookup data built once and read forever, freeze it: `FrozenDictionary` and `FrozenSet` (.NET 8+) trade slower construction for the fastest reads.

```csharp
private static readonly FrozenDictionary<string, Handler> Handlers =
    new Dictionary<string, Handler> { ["create"] = new CreateHandler() }.ToFrozenDictionary();
```

## The defaults, and the anti-patterns they replace

| Default | Anti-pattern |
|---|---|
| `sealed` class / record | unsealed with no inheritance reason |
| readonly struct for a small value | mutable struct (defensive copies, lost writes) |
| static pure function | instance method carrying no real state |
| one `ToList` at the end | `ToList().OrderBy().ToList()` |
| `ValueTask` only for sync-completing hot paths | `ValueTask` on an always-async method |
| return `IReadOnlyList<T>` | return `List<T>` from a public API |
| `FrozenDictionary` for static lookups | rebuilding a `Dictionary` on every call |
