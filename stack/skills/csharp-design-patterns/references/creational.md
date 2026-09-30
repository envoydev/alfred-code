# Creational Patterns in C#

Each entry: Intent, When to use, Modern C# form, .NET-native form, Pros/Cons. Code targets .NET 8+, nullable enabled.

## Contents

Factory Method, Abstract Factory, Builder, Prototype, Singleton.

## Factory Method

**Intent**: define an interface for creating an object, but let subclasses (or registered implementations) decide which class to instantiate.

**When to use**: creation logic varies by context; client code must not depend on concrete types; `new SomeType(...)` calls with conditionals are spreading through the codebase.

**Modern C# form** - in DI-era code, the 'creator hierarchy' from the classic UML usually collapses into a factory delegate or a small factory service:

```csharp
public interface INotificationSender { Task SendAsync(string to, string body); }

public sealed class EmailSender : INotificationSender { /* ... */ }
public sealed class SmsSender : INotificationSender { /* ... */ }

public interface ISenderFactory
{
    INotificationSender Create(Channel channel);
}

public sealed class SenderFactory(IServiceProvider serviceProvider) : ISenderFactory
{
    public INotificationSender Create(Channel channel) => channel switch
    {
        Channel.Email => serviceProvider.GetRequiredService<EmailSender>(),
        Channel.Sms => serviceProvider.GetRequiredService<SmsSender>(),
        _ => throw new ArgumentOutOfRangeException(nameof(channel))
    };
}
```

**.NET-native form**: keyed services (.NET 8) often remove the factory class entirely:

```csharp
services.AddKeyedScoped<INotificationSender, EmailSender>(Channel.Email);
services.AddKeyedScoped<INotificationSender, SmsSender>(Channel.Sms);

// consumer - the attribute sits on the primary constructor parameter
public sealed class Notifier([FromKeyedServices(Channel.Email)] INotificationSender sender);
// or resolve dynamically: serviceProvider.GetRequiredKeyedService<INotificationSender>(channel)
```

Classic subclass-based Factory Method (abstract `Creator.FactoryMethod()`) is still right when the creator itself has business logic that uses the product, e.g. framework base classes.

**Pros**: decouples client from concrete types; single place for creation logic; Open/Closed for new products.
**Cons**: more types; with DI keyed services the pattern can be invisible to readers unfamiliar with the registration.

## Abstract Factory

**Intent**: produce families of related objects without specifying concrete classes, guaranteeing the family is consistent.

**When to use**: products come in matched sets (per cloud provider, per database engine, per UI theme) and mixing sets is a bug.

**Modern C# form**:

```csharp
public interface IStorageFactory
{
    IBlobStore CreateBlobStore();
    IQueue CreateQueue();
}

public sealed class AzureStorageFactory(AzureOptions options) : IStorageFactory
{
    public IBlobStore CreateBlobStore() => new AzureBlobStore(options);
    public IQueue CreateQueue() => new AzureQueue(options);
}

public sealed class AwsStorageFactory(AwsOptions options) : IStorageFactory { /* same shape: S3 + SQS */ }

// registration picks the family once:
services.AddSingleton<IStorageFactory>(sp =>
    config["Cloud"] == "Azure"
        ? new AzureStorageFactory(sp.GetRequiredService<AzureOptions>())
        : new AwsStorageFactory(sp.GetRequiredService<AwsOptions>()));
```

**.NET-native form**: `DbProviderFactory` in ADO.NET is the canonical example (creates matched `DbConnection`, `DbCommand`, `DbDataAdapter`). Point users to it as a real-world reference.

**Pros**: family consistency is enforced by the type system; swapping the family is one registration change.
**Cons**: adding a new product type to the family forces changes in every factory; heavy if the 'family' has one member (that is just Factory Method).

## Builder

**Intent**: construct a complex object step by step, separating construction from representation.

**When to use**: many optional parts, construction order matters, or the same construction process must yield different representations.

**First check**: C# `required` members + `init` setters + object initializers solve the 'telescoping constructor' problem without any pattern:

```csharp
public sealed record HttpJob
{
    public required Uri Url { get; init; }
    public HttpMethod Method { get; init; } = HttpMethod.Get;
    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(30);
}
```

Use a real Builder only when construction has logic: validation across fields, conditional steps, accumulating collections, or fluent configuration of a complex graph.

**Modern C# form** (fluent builder with validation at `Build()`):

```csharp
public sealed class ReportBuilder
{
    private readonly List<Section> _sections = [];
    private string? _title;

    public ReportBuilder WithTitle(string title) { _title = title; return this; }
    public ReportBuilder AddSection(Section s) { _sections.Add(s); return this; }

    public Report Build()
    {
        if (_title is null) throw new InvalidOperationException("Title is required.");
        if (_sections.Count == 0) throw new InvalidOperationException("At least one section.");
        return new Report(_title, [.. _sections]);
    }
}
```

**.NET-native form**: `StringBuilder`, `ConfigurationBuilder`, `WebApplicationBuilder`, `IHostBuilder`, EF Core `ModelBuilder`. When explaining Builder to a .NET dev, these are the references they already use daily.

**Pros**: readable construction of complex objects; immutable products; validation in one place.
**Cons**: doubles the type count per product; overkill when object initializers suffice.

## Prototype

**Intent**: create new objects by copying an existing instance instead of constructing from scratch.

**When to use**: construction is expensive (loaded config, parsed templates) or the concrete type is only known at runtime via a base reference.

**Modern C# form**: records give shallow copy via `with` for free:

```csharp
public sealed record PipelineConfig(string Name, IReadOnlyList<string> Steps, RetryPolicy Retry);

var nightly = baseConfig with { Name = "nightly", Retry = RetryPolicy.Aggressive };
```

For deep copies of mutable graphs, implement an explicit `Clone()` (avoid `ICloneable` - its contract does not specify deep vs shallow, which makes it useless as an abstraction):

```csharp
public interface IDeepCloneable<T> { T DeepClone(); }
```

Serialization-based cloning (`System.Text.Json` round-trip) is acceptable for DTO-like graphs but flag the cost and the loss of non-serialized state.

**Pros**: avoids re-running expensive initialization; copy polymorphically without knowing concrete type.
**Cons**: deep copy of object graphs with cycles or unmanaged resources is error-prone; `ICloneable` is a trap.

## Singleton

**Intent**: ensure a class has one instance with a global access point.

**The rule for modern .NET**: do not hand-roll it. Register with the container:

```csharp
services.AddSingleton<IPricingRules, DefaultPricingRules>();
```

This gives single-instance semantics plus testability (swap in tests) plus visible dependencies (constructor injection). The container guarantees thread-safe lazy creation.

**When hand-rolling is still legitimate**: no DI container exists (library code, console utilities, WPF apps without Generic Host). Then use `Lazy<T>`:

```csharp
public sealed class TelemetryHub
{
    private static readonly Lazy<TelemetryHub> _instance = new(() => new TelemetryHub());
    public static TelemetryHub Instance => _instance.Value;
    private TelemetryHub() { }
}
```

`Lazy<T>` defaults to `LazyThreadSafetyMode.ExecutionAndPublication` - correct and simpler than double-checked locking. Never present the lock-based double-check variant as the default; it is interview trivia, not production guidance.

**Pros**: controlled single instance, lazy init.
**Cons**: global state, hidden coupling, test pollution, concurrency hazards if the instance is mutable. Treat every Singleton request as a prompt to suggest DI singleton lifetime instead.