# DI composition (Add* extensions, keyed services, factories)

How a feature's registrations are grouped and composed, and the three registration shapes beyond a plain `AddScoped<I, T>`: idempotent (`TryAdd`), keyed, and factory. The lifetime rules (Singleton / Scoped / Transient), the captive-dependency ban, and constructor injection are the language baseline in `csharp` - this file does not restate them. Typed-options binding depth (`IOptionsSnapshot` / `IValidateOptions`) is the ASP.NET Core web hub skill's; scope-per-unit-of-work in a `BackgroundService` is the hosted-worker skill's - each where installed.

## Contents

- Group a feature behind one Add* extension
- TryAdd for idempotent and multi-implementation registration
- Keyed services (.NET 8+)
- Factory registration and runtime arguments
- Binding options into DI
- The shapes at a glance

## Group a feature behind one Add* extension

Never let `Program.cs` accumulate a wall of registrations. Each feature owns a static `Add{Feature}` extension on `IServiceCollection` that registers everything the feature needs and returns the collection so calls chain. Place it in the feature's own project, next to the services it wires, named `{Feature}ServiceCollectionExtensions`.

```csharp
namespace MyApp.Orders;

public static class OrderServiceCollectionExtensions
{
    public static IServiceCollection AddOrderServices(this IServiceCollection services)
    {
        services.AddScoped<IOrderRepository, OrderRepository>();
        services.AddScoped<IOrderService, OrderService>();

        return services;
    }
}
```

```csharp
// Program.cs stays a table of contents
builder.Services
    .AddOrderServices()
    .AddPaymentServices()
    .AddEmailServices();
```

Rules that make the pattern pay off: take configuration as an explicit parameter (a connection string, a config section name) rather than hard-coding it inside the method; keep the name specific (`AddOrderServices`, never a catch-all `AddServices`); and reuse the same extension in tests, overriding only the doubles with `RemoveAll<T>` + a re-register. Compose hierarchically for larger apps - an `AddDomainServices` that chains the per-feature extensions.

## TryAdd for idempotent and multi-implementation registration

A plain `Add*` appends unconditionally, so a library that self-registers a default can silently stack a duplicate or clobber the host's override. In library code that ships a default, register with `TryAdd*` - it no-ops when the service type is already present, letting the consumer win.

```csharp
services.TryAddSingleton<IPricingRules, DefaultPricingRules>();  // consumer's registration wins if set
services.TryAddEnumerable(                                 // add to the set, dedup by impl type
    ServiceDescriptor.Singleton<IValidator, OrderValidator>());
```

`TryAddEnumerable` is the one to reach for when many implementations of an interface are all meant to resolve together (`IEnumerable<IValidator>`) - it dedupes by implementation type, so re-running the registration is safe.

## Keyed services (.NET 8+)

When several implementations of one interface coexist and the consumer picks by a known constant, register them keyed and resolve by key - no marker interfaces, no factory.

```csharp
services.AddKeyedSingleton<INotificationSender, EmailSender>("email");
services.AddKeyedSingleton<INotificationSender, SmsSender>("sms");
```

```csharp
public sealed class Dispatcher(
    [FromKeyedServices("email")] INotificationSender email)
{
    // or resolve dynamically:
    // provider.GetRequiredKeyedService<INotificationSender>(channel);
}
```

Reach for a key when the choice is a fixed, enumerable set known at registration time. Reach for a factory instead when the choice depends on a runtime value the container can't see (per-request tenant, a value off the message).

## Factory registration and runtime arguments

Register with a `Func<IServiceProvider, T>` when construction needs other services or config resolved at build time - resolve dependencies off the provider inside the factory.

```csharp
services.AddSingleton<IPaymentProcessor>(sp =>
{
    var options = sp.GetRequiredService<IOptions<StripeOptions>>().Value;
    var logger = sp.GetRequiredService<ILogger<StripeProcessor>>();

    return new StripeProcessor(options.ApiKey, logger);
});
```

When a type mixes DI-supplied dependencies with an argument only known at call time, do not capture the argument in a factory - use `ActivatorUtilities.CreateInstance<T>`, which fills constructor parameters from the provider and takes the rest positionally.

```csharp
public sealed class ReportFactory(IServiceProvider provider)
{
    public ReportGenerator Create(ReportSpec spec) =>
        ActivatorUtilities.CreateInstance<ReportGenerator>(provider, spec);
}
```

## Binding options into DI

Register configuration as validated options in the feature's `Add*` extension rather than reading `IConfiguration` inside services. Validate on start so a bad config fails at boot, not on first use.

```csharp
services.AddOptions<EmailOptions>()
    .BindConfiguration("Email")
    .ValidateDataAnnotations()
    .ValidateOnStart();
```

Services then inject `IOptions<EmailOptions>` (singleton config) - the snapshot/monitor variants and custom `IValidateOptions<T>` are the ASP.NET Core web hub skill's, where installed.

## The shapes at a glance

| Need | Registration |
|---|---|
| group a feature's services | `AddMyFeature(this IServiceCollection)` returning the collection |
| ship a default a consumer can override | `TryAddSingleton` / `TryAddEnumerable` |
| pick one impl of many by a fixed constant | `AddKeyedSingleton(..., key)` + `[FromKeyedServices]` |
| build from other services / config | `Add*(sp => new T(...))` factory |
| build with a runtime argument | `ActivatorUtilities.CreateInstance<T>(provider, arg)` |
| bind validated config | `AddOptions<T>().BindConfiguration(...).ValidateOnStart()` |
