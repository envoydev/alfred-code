# Structural Patterns in C#

Each entry: Intent, When to use, Modern C# form, .NET-native form, Pros/Cons. Code targets the .NET 10 / C# 14 floor, nullable enabled.

## Contents

Adapter, Bridge, Composite, Decorator, Facade, Flyweight, Proxy.

## Adapter

**Intent**: convert the interface of an existing class into the interface clients expect.

**When to use**: integrating a third-party SDK, legacy API, or generated client whose shape does not match your domain abstractions.

**Modern C# form** (object adapter via composition - prefer this over class adapter via inheritance):

```csharp
public interface IPaymentGateway
{
    Task<PaymentResult> ChargeAsync(Money amount, CardToken token, CancellationToken ct);
}

// Adapts Stripe's SDK to the app's port
public sealed class StripePaymentAdapter(StripeClient stripe) : IPaymentGateway
{
    public async Task<PaymentResult> ChargeAsync(Money amount, CardToken token, CancellationToken ct)
    {
        var intent = await stripe.PaymentIntents.CreateAsync(new()
        {
            Amount = amount.ToMinorUnits(),
            Currency = amount.Currency.Code.ToLowerInvariant(),
            PaymentMethod = token.Value
        }, cancellationToken: ct);

        return PaymentResult.FromStripeStatus(intent.Status);
    }
}
```

This is also the backbone of Ports and Adapters / Clean Architecture: the interface lives in the domain, the adapter in infrastructure.

**.NET-native examples**: `TextReader`/`StreamReader` adapting `Stream` to text, `IDbConnection` wrappers, `LoggerFactory` adapters for third-party log sinks.

**Pros**: isolates third-party churn behind your own interface; enables substitution in tests.
**Cons**: one more layer; leaky if the adapter exposes vendor-specific types in its signatures (never let it).

## Bridge

**Intent**: split a large abstraction-implementation hierarchy into two independent hierarchies so both can vary.

**When to use**: you see class explosion of the form `{Abstraction} x {Platform}` (e.g. `WindowsRenderer`, `LinuxRenderer`, `WindowsVectorRenderer`, ...). The bridge replaces N*M subclasses with N+M classes.

**Modern C# form**: in practice Bridge in C# is just 'abstraction holds an injected interface', which DI makes routine:

```csharp
public abstract class Report(IReportRenderer renderer)
{
    protected IReportRenderer Renderer => renderer;

    public abstract Task<byte[]> GenerateAsync(ReportData data);
}

public sealed class InvoiceReport(IReportRenderer renderer) : Report(renderer)
{
    public override Task<byte[]> GenerateAsync(ReportData data)
        => Renderer.RenderAsync(BuildInvoiceLayout(data));
}

// renderers vary independently: PdfRenderer, HtmlRenderer, XlsxRenderer
```

**Pros**: kills hierarchy multiplication; abstraction and implementation ship/evolve independently.
**Cons**: harder to identify than other patterns (it looks like ordinary DI); applying it pre-emptively when only one axis varies adds indirection for nothing.

## Composite

**Intent**: compose objects into trees and let clients treat individual objects and compositions uniformly.

**When to use**: genuinely recursive structures - org charts, file systems, UI element trees, expression trees, BOMs, menu hierarchies.

**Modern C# form**:

```csharp
public abstract class OrgNode(string name)
{
    public string Name { get; } = name;

    public abstract decimal TotalSalary();
}

public sealed class Employee(string name, decimal salary) : OrgNode(name)
{
    public override decimal TotalSalary() => salary;
}

public sealed class Department(string name) : OrgNode(name)
{
    private readonly List<OrgNode> _children = [];

    public void Add(OrgNode node) => _children.Add(node);
    public override decimal TotalSalary() => _children.Sum(c => c.TotalSalary());
}
```

Decision point to surface: whether `Add`/`Remove` live on the base (uniformity, but leaves get meaningless members) or only on the composite (safety, but clients must type-check). Default to composite-only in C# and use pattern matching when traversal needs it.

**.NET-native examples**: WPF/WinUI visual tree, `Expression` trees, XML/JSON DOM nodes.

**Pros**: uniform treatment of leaf and tree; recursive operations become trivial.
**Cons**: hard to constrain what a composite may contain; overly general designs emerge when the structure was never actually a tree.

## Decorator

**Intent**: attach responsibilities to an object dynamically by wrapping it in objects of the same interface.

**When to use**: cross-cutting additions (caching, logging, retry, metrics, validation) over an existing abstraction without touching its implementations.

**Modern C# form**:

```csharp
public sealed class CachingCatalogService(ICatalogService inner, IMemoryCache cache) : ICatalogService
{
    public async Task<Product?> GetAsync(int id, CancellationToken ct) =>
        await cache.GetOrCreateAsync($"product:{id}", _ => inner.GetAsync(id, ct));
}
```

Registration without a library (decoration is manual in MS.DI):

```csharp
services.AddScoped<CatalogService>();
services.AddScoped<ICatalogService>(sp =>
    new CachingCatalogService(sp.GetRequiredService<CatalogService>(),
                              sp.GetRequiredService<IMemoryCache>()));
```

Scrutor's `services.Decorate<ICatalogService, CachingCatalogService>()` is the standard shortcut - mention it when the user already uses Scrutor or asks for cleaner registration.

**.NET-native examples**: `Stream` wrappers (`BufferedStream`, `GZipStream`, `CryptoStream`), `DelegatingHandler` in HttpClient pipelines.

**Pros**: combine behaviors at runtime; each concern in its own class; Open/Closed.
**Cons**: many small objects; wrapping order matters and is invisible at the call site; debugging through 4 layers of wrappers is unpleasant.

## Facade

**Intent**: provide a simplified interface to a complex subsystem.

**When to use**: client code orchestrates many subsystem calls in the right order, and that orchestration is duplicated or leaking subsystem types upward.

**Modern C# form**: in .NET this is usually just an application service:

```csharp
public sealed class CheckoutFacade(
    IInventoryService inventory,
    IPaymentGateway payments,
    IShippingService shipping,
    IEmailService email)
{
    public async Task<OrderConfirmation> PlaceOrderAsync(Cart cart, CancellationToken ct)
    {
        await inventory.ReserveAsync(cart.Items, ct);
        var payment = await payments.ChargeAsync(cart.Total, cart.CardToken, ct);
        var shipment = await shipping.ScheduleAsync(cart, ct);
        await email.SendConfirmationAsync(cart.CustomerEmail, payment, shipment, ct);

        return new OrderConfirmation(payment.Id, shipment.TrackingNumber);
    }
}
```

Do not present Facade as something exotic - tell the user their 'service layer' classes likely already are facades. The pattern's value is the naming of the boundary, not novel structure.

**Pros**: shields clients from subsystem churn; one obvious entry point.
**Cons**: facades attract responsibilities and bloat into god objects - watch method count; a facade that just forwards single calls 1:1 is noise.

## Flyweight

**Intent**: share immutable intrinsic state between many objects to save memory.

**When to use**: profiler-confirmed memory pressure from huge numbers of similar objects (map tiles, glyphs, game entities, cached metadata). This is an optimization pattern - require measurement before applying.

**Modern C# form**:

```csharp
public sealed record GlyphStyle(string Font, double Size, Color Color); // intrinsic, shared

public static class GlyphStyleFactory
{
    private static readonly ConcurrentDictionary<(string, double, Color), GlyphStyle> _cache = new();
    public static GlyphStyle Get(string font, double size, Color color) =>
        _cache.GetOrAdd((font, size, color), k => new GlyphStyle(k.Item1, k.Item2, k.Item3));
}
```

**.NET-native examples**: string interning, `Array.Empty<T>()`, `Enumerable.Empty<T>()`, `EqualityComparer<T>.Default`.

**Pros**: real memory wins at scale.
**Cons**: complexity for a problem most apps do not have; shared state must be strictly immutable or it becomes a concurrency bug factory.

## Proxy

**Intent**: provide a stand-in object that controls access to another object.

**When to use**: lazy loading, access control, caching, remote access, auditing - same interface, added access logic. (Decorator adds behavior; Proxy controls access. The structure is identical, the intent differs.)

**Modern C# forms**:

- Lazy initialization proxy: `Lazy<T>` covers most cases without a class.
- Virtual proxy / interception: `DispatchProxy` for runtime-generated proxies over interfaces:

```csharp
public class AuditProxy<T> : DispatchProxy where T : class
{
    private T _inner = default!;
    public static T Create(T inner)
    {
        var proxy = Create<T, AuditProxy<T>>() as AuditProxy<T>;
        proxy!._inner = inner;
        return (proxy as T)!;
    }
    protected override object? Invoke(MethodInfo? method, object?[]? args)
    {
        Console.WriteLine($"Calling {method!.Name}");
        return method.Invoke(_inner, args);
    }
}
```

**.NET-native examples**: EF Core lazy-loading proxies, gRPC/WCF client stubs (remote proxy), Castle DynamicProxy in Moq and interception libraries.

**Pros**: access concerns separated from the real subject; client code unchanged.
**Cons**: reflection-based proxies cost performance and break with AOT; the Decorator/Proxy distinction confuses teams - document intent in the class name.