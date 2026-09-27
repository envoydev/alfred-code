# Clean architecture

Layered internal structure. Load when the chosen internal style is clean. The shared dependency rule and the pick-one meta-rule are in `SKILL.md`; domain mechanics (records, Result, naming) are in `csharp`; endpoint/validation wiring in the ASP.NET Core web hub; boundary enforcement in the architecture fitness-test skill.

## Four projects, dependencies inward

`Domain` (zero project refs) <- `Application` (refs Domain) <- `Infrastructure` (refs Application + Domain) <- `Api` (refs all). Project references make the compiler enforce direction.

- **Domain** - entities with behavior, domain services, enums, domain exceptions, base `Entity`/`Result`. No EF, no framework types.
- **Application** - one class per use case (command/query handler) + validators + the infrastructure abstractions it needs (interfaces only).
- **Infrastructure** - EF `DbContext`, EF configs, migrations, and implementations of the Application interfaces.
- **Api** - thin endpoints mapping HTTP <-> use case, nothing more.

```
Domain/          Entities/ Enums/ Exceptions/ Interfaces/ Common/(Entity, Result)
Application/     Common/(Behaviors, Interfaces/IAppDbContext)  {Feature}/Commands|Queries/{UseCase}/(Command, Handler, Validator, Dto)
Infrastructure/  Persistence/(DbContext, Configurations, Migrations)  Services/  DependencyInjection.cs
Api/             Endpoints/  Program.cs
```

## Rules that keep it clean

- A use case is the unit of work - one command or query = one handler class. No 'service' classes with 20 methods.
- Prefer an `IAppDbContext` abstraction over a repository-per-entity: EF's `DbSet<T>` already is a repository, so a wrapper adds indirection with no value. Add a repository interface only for complex query logic you want to test in isolation or reuse across use cases.

```csharp
// Application defines the abstraction:
public interface IAppDbContext
{
    DbSet<Order> Orders { get; }
    Task<int> SaveChangesAsync(CancellationToken ct = default);
}
// Infrastructure implements it on the real DbContext:
public class AppDbContext(DbContextOptions<AppDbContext> o) : DbContext(o), IAppDbContext { /* DbSets */ }
// DI: services.AddScoped<IAppDbContext>(sp => sp.GetRequiredService<AppDbContext>());
```

## Anti-patterns

- **Anemic domain** - entity is a data bag, the handler mutates its fields. Encapsulate rules behind a `static Create` factory + private setters (see `ddd`).
- **`DbContext` referenced from Domain** - Domain defines interfaces, never depends on EF.
- **Fat endpoints** - business logic inline in the endpoint; delegate to a use case.
- **A repository for every entity** - use `IAppDbContext`.
