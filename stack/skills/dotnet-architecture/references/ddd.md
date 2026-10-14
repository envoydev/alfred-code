# DDD tactical patterns

Layers onto a clean layout or across vsa slices when the domain has real invariants - it is not a competing style. Load when modeling a rich domain. Value-object/record mechanics, the `Result` pattern, `TimeProvider`, and naming are owned by `csharp` - this holds the DDD framing, not the C# syntax.

## Aggregates

- An **aggregate** is a cluster of entities + value objects treated as one unit for changes; all its invariants hold inside a single transaction. Cross-aggregate consistency is eventual.
- The **aggregate root** is the sole entry point - external code touches children only through the root, which enforces every invariant.
- Keep aggregates small: typically 1 root + 0-3 children; load the whole aggregate every time. Logic spanning multiple aggregates goes in a domain service.
- Method shape: guard the invariant first, mutate, recalculate, raise an event - e.g. `Confirm()` returns `Result.Failure` if status isn't `Placed` or there are no lines, else sets status and raises `OrderConfirmed`.

## Value objects, IDs, events

- **Value object over primitive** - `Money`, `EmailAddress`, `OrderNumber` carry validation + equality, not `string`. Immutable, defined by attributes not identity (a value object with an `Id` is secretly an entity). Mechanics: `readonly record struct` / `sealed record` - see `csharp`.
- **Strongly-typed IDs** stop cross-entity GUID mix-ups - always for root IDs that cross boundaries, optional for child IDs. Map with an EF value converter.
- **Domain events** decouple side effects - raise on something meaningful (`OrderPlaced`); subscribers handle email / read-model / notifications. Never use events for logic inside the same aggregate - just call the private method.
- **Domain vs integration events**: domain events stay within the bounded context in the same transaction; integration events cross contexts via a message bus - the .NET messaging skill's territory (broker, outbox, versioned contracts).

```csharp
public readonly record struct CustomerId(Guid Value)
{ public static CustomerId New() => new(Guid.CreateVersion7()); }  // below the floor, .NET 8 has no CreateVersion7 - use Guid.NewGuid()

public abstract class AggregateRoot : Entity
{
    private readonly List<IDomainEvent> _events = [];
    public IReadOnlyList<IDomainEvent> DomainEvents => _events.AsReadOnly();
    protected void RaiseDomainEvent(IDomainEvent e) => _events.Add(e);
    public void ClearDomainEvents() => _events.Clear();
}
// EF converter: builder.Property(o => o.CustomerId).HasConversion(id => id.Value, v => new CustomerId(v));
// Dispatch: in SaveChangesAsync, collect events off tracked AggregateRoots, base.SaveChangesAsync, publish, then Clear.
```

## Repositories

- One repository per **aggregate root** (not per entity); it loads and saves the whole aggregate. Implemented over `DbContext` internally - it's a boundary marker, not a generic CRUD wrapper.

## Anti-patterns

- **Oversized aggregate** - `Customer` owning `Orders`/`Payments`/`Cart`. Split into separate aggregates linked by ID.
- **Anemic aggregate** - public setters, a service mutates state with no invariant check.
- **Value object with an identity** - then it's an entity, model it as one.
- **Domain events for intra-aggregate logic** - call the method directly.
