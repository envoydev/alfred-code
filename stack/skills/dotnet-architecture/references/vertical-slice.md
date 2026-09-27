# Vertical-slice architecture

Feature-sliced internal structure - slice by feature, not by technical layer. Load when the chosen internal style is vsa. The shared dependency rule is in `SKILL.md`; endpoint/validation wiring in the ASP.NET Core web hub; slice-isolation enforcement in the architecture fitness-test skill.

## The slice

- One feature = one directory holding its handler, request/response, validator, and test. Maximize coupling *within* a slice, minimize it *between* slices.
- **One entry point per feature** - a single public registration function; in .NET a `static Map(IEndpointRouteBuilder app)`. Everything else in the folder stays `internal`.
- **No cross-slice imports** - they create hidden coupling. A slice must evolve independently.
- **No premature abstractions** - no generic `Repository<T>`, `BaseHandler`, or pass-through service layer 'just in case'. Start each slice as a plain handler (transaction script).

```
Features/
  Orders/
    CreateOrder/  CreateOrderEndpoint.cs (static Map)  CreateOrderCommand.cs (+ handler)  CreateOrderValidator.cs  CreateOrderResponse.cs
    GetOrder/     GetOrderEndpoint.cs  GetOrderQuery.cs  GetOrderResponse.cs
Infrastructure/  Persistence/  Middleware/
Program.cs        // composition root: CreateOrderEndpoint.Map(app); GetOrderEndpoint.Map(app); ...
```

## Where shared code goes when it emerges

Only on genuine duplication ('3+ slices' is guidance, not a gate):

- A duplicated business rule -> a domain entity / value object (see `ddd`).
- A shared type that is a real domain concept -> `Features/{domain}/Model`.
- A cross-cutting concern (auth, logging, DB pooling, error handling) -> `Infrastructure/`.
- Never put domain types in `Infrastructure/` - it is for plumbing, not business concepts.

## .NET idioms

- Dependencies resolve via the DI container inside the handler - not passed to `Map()`.
- MediatR / Mediator is optional; a plain minimal-API handler works.
- CQRS falls out naturally: commands = create/update/delete slices, queries = get/list/search slices, each free to pick its own data-access strategy - the ORM / data-access skill owns the read-store vs write-store split.
