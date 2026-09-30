# Manual OpenTelemetry instrumentation

Owns hand-authored spans and metrics - the layer beyond the provider wiring. Provider registration, auto-instrumentation, and the OTLP exporter for traces / metrics / logs live in `dotnet-web-backend`; load this only when you emit your own `Activity` or metric instrument.

In .NET the instrumentation API is the framework's own `System.Diagnostics` types - `ActivitySource` / `Activity` for traces, `Meter` plus instruments for metrics. OpenTelemetry is only the collection / export layer. A library emits telemetry with `System.Diagnostics.*` and takes no OpenTelemetry package; the consuming app wires the export (that wiring is `dotnet-web-backend`). Never let a telemetry call throw into business logic - `activity?.` guards every access.

## Contents

- Custom spans
- Choosing a metric instrument
- Manual context propagation

## Custom spans

```csharp
private static readonly ActivitySource ActivitySource = new("MyApp.Orders", "1.0.0");

if (ActivitySource.HasListeners())
{
    using var activity = ActivitySource.StartActivity("ProcessOrder", ActivityKind.Internal);
    if (activity?.IsAllDataRequested == true)
        activity.SetTag("myapp.order_id", orderId);
}
```

- One static `ActivitySource` per component, name matching the component, SemVer version.
- Guard with `HasListeners()` for the zero-allocation fast path, then null-check the returned `Activity` - a sampler may have dropped it. Put expensive tag work (string interpolation) behind `IsAllDataRequested`.
- Never start an activity in a fire-and-forget task: the `using` scope disposes before the detached work runs and the `AsyncLocal` parent is lost. In-process nesting is automatic via `AsyncLocal` - do not set `parentId` by hand.
- Tag keys use your own namespace, lowercase, underscore delimiter, singular (`myapp.order_id`). Reach for OpenTelemetry semantic conventions only when you manually instrument an HTTP / database / messaging boundary the SDK does not cover.

Status and exceptions:

```csharp
try
{
    await ProcessAsync();
    activity?.SetStatus(ActivityStatusCode.Ok);
}
catch (Exception ex)
{
    activity?.SetStatus(ActivityStatusCode.Error, ex.Message);
    activity?.AddEvent(new ActivityEvent("exception", tags: new ActivityTagsCollection
    {
        ["exception.type"] = ex.GetType().FullName,
        ["exception.message"] = ex.Message,
    }));
    throw;
}
```

`SetStatus` is the modern API - the SDK maps it to OTel span status, so drop the legacy `otel.status_code` tags. `exception.stacktrace` is recommended; omit it for high-volume handled exceptions and log via `ILogger` with trace correlation instead.

### SpanKind

Pick the kind that states the span's role in the trace; one span serves one purpose.

| ActivityKind | When |
|---|---|
| `Internal` | Default - work entirely in-process, no remote boundary |
| `Server` | Processing an incoming request/response call (custom HTTP / RPC listener; ASP.NET Core auto-creates these) |
| `Client` | Making an outgoing request/response call (custom transport; HttpClient auto-creates these) |
| `Producer` | Publishing deferred work - queue publish, event emit, job enqueue |
| `Consumer` | Processing deferred work a producer handed off - queue receive, job dequeue |

### Tags vs baggage

Tags describe the current span and stay local to it. Baggage is a name/value pair propagated to every downstream span across process boundaries - for observability correlation only (tenant id, request source), never application data transport, never secrets, string-valued and size-limited. Library code sets it via `Activity.Current?.SetBaggage("tenant.id", id)`; it rides the same `traceparent` / `baggage` headers the SDK already propagates.

## Choosing a metric instrument

```csharp
private readonly Meter _meter = new("MyApp.Orders", "1.0.0");
private readonly Counter<long> _processed =
    _meter.CreateCounter<long>("myapp.order.processed", unit: "{order}");
```

```
Cumulative total that only goes up?
  → increment on every event?  yes → Counter        no → ObservableCounter
Need a distribution / percentiles (p95, p99)?  → Histogram
Value moves up and down?
  → update on every event?     yes → UpDownCounter  no → ObservableGauge
```

| Instrument | Behavior | Typical use |
|---|---|---|
| `Counter<T>` | monotonic, `Add(+n)` per event | request / error counts, bytes sent |
| `UpDownCounter<T>` | up or down, `Add(+1)`/`Add(-1)` | queue depth, active connections |
| `Histogram<T>` | distribution, `Record(v)` | durations, response sizes |
| `ObservableGauge<T>` | async callback, last value | CPU / memory read on the collection interval |

Names are singular and dotted (`myapp.order.processing.duration`); always set a UCUM unit (`s`, `ms`, `By`, `%`, `{order}`).

### Cardinality discipline

Each unique combination of tag values is a separate time series. Bound every tag value to a small finite set - outcome, region, order type. Never tag with a user id, order id, email, or raw exception message: unbounded values explode the series count and take the backend's memory and storage with them. The SDK caps at 2000 combinations per instrument and folds the overflow into a single `otel.metric.overflow=true` series (1.10+; earlier SDKs dropped it) - a safety valve, not a design target. If a high-cardinality dimension is genuinely needed, gate it behind config opt-in.

### Zero-allocation tags on hot paths

Pass tags as a `TagList` (a struct), not a `KeyValuePair` array or dictionary - no heap allocation per record.

```csharp
var tags = new TagList { { "myapp.order_type", orderType }, { "outcome", "success" } };
_processed.Add(1, tags);
```

Time with `Stopwatch.GetTimestamp()` / `Stopwatch.GetElapsedTime(start)` (no allocation), never `Stopwatch.StartNew()`.

## Manual context propagation

Only for a boundary the SDK does not auto-instrument (raw TCP, a custom broker) - HTTP and ASP.NET Core propagate automatically once wired. Create the outgoing `Client` / `Producer` span before injecting, or the parent's context leaks and the new span dangles.

```csharp
using var activity = ActivitySource.StartActivity("SendMessage", ActivityKind.Client);
if (activity != null)
{
    var headers = new Dictionary<string, string>();
    Propagators.DefaultTextMapPropagator.Inject(
        new PropagationContext(activity.Context, Baggage.Current), headers,
        static (carrier, k, v) => ((Dictionary<string, string>)carrier)[k] = v);
    await SendAsync(payload, headers);
}
```

```csharp
var parent = Propagators.DefaultTextMapPropagator.Extract(default, incomingHeaders,
    static (carrier, k) =>
        ((Dictionary<string, string>)carrier).TryGetValue(k, out var v) ? new[] { v } : null);

using var activity = ActivitySource.StartActivity(
    "ReceiveMessage", ActivityKind.Server, parent.ActivityContext);
```

The `Client` / `Server` kinds above fit a raw request-reply hop; a broker hop uses `Producer` / `Consumer`.

`Propagators` and `PropagationContext` come from `OpenTelemetry.Context.Propagation`, so this lives at the application root; pure library code uses `DistributedContextPropagator.Current` for the same `traceparent` format with no OpenTelemetry package.
