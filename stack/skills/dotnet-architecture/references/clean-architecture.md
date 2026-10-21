# Clean architecture

Layered internal structure. Load when the chosen internal style is clean. The shared dependency rule and the pick-one meta-rule are in `SKILL.md`; domain mechanics (records, Result, naming) are in `csharp`; endpoint/validation wiring in the ASP.NET Core web hub; boundary enforcement in the architecture fitness-test skill.

## Four projects, dependencies inward

`Domain` (zero project refs) <- `Application` (refs Domain) <- `Infrastructure` (refs Application + Domain) <- `Api` (refs all). Project references make the compiler enforce direction.

- **Domain** - entities with behavior, domain services, enums, domain exceptions, base `Entity`/`Result`. No EF, no framework types.
- **Application** - one class per use case (command/query handler) + validators + the infrastructure abstractions it needs (interfaces only).
- **Infrastructure** - EF `DbContext`, EF configs, migrations, and implementations of the Application interfaces.
- **Api** - thin endpoints mapping HTTP <-> use case, nothing more.

The folders follow the reference layout in `layered-architecture.md` - one layout for every internal style.

## Rules that keep it clean

- A use case is the unit of work - one command or query = one handler class. No 'service' classes with 20 methods.
- Where a query lives is the data-access skill's call: Application declares purpose-built read and write stores with named methods, Infrastructure implements them on the `DbContext`. Never a repository per entity, never a generic one.

```csharp
// Application declares the port, named for what the use case needs:
public interface IOrderReadStore
{
    Task<IReadOnlyList<OrderSummaryDto>> ListRecentAsync(CustomerId customer, int limit, CancellationToken ct);
}
// Infrastructure implements it on the DbContext - no tracking, a projection, the required limit.
// DI: services.AddScoped<IOrderReadStore, OrderReadStore>();
```

## Anti-patterns

- **Anemic domain** - entity is a data bag, the handler mutates its fields. Encapsulate rules behind a `static Create` factory + private setters (see `ddd`).
- **`DbContext` referenced from Domain** - Domain defines interfaces, never depends on EF.
- **Fat endpoints** - business logic inline in the endpoint; delegate to a use case.
- **A repository for every entity, or a generic one** - purpose-built stores (the data-access skill).
