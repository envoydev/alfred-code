# Resilience for a non-HTTP call

A database command or a broker publish has no `HttpClient` handler to hang the standard resilience handler off, so build a Polly v8 `ResiliencePipeline` directly and invoke through it:

```csharp
var pipeline = new ResiliencePipelineBuilder()
    .AddRetry(new RetryStrategyOptions { MaxRetryAttempts = 3, BackoffType = DelayBackoffType.Exponential })
    .AddTimeout(TimeSpan.FromSeconds(10))
    .Build();

await pipeline.ExecuteAsync(async ct => await broker.PublishAsync(message, ct), ct);
```

The same timing rule as the HTTP handler holds: let the pipeline own the timing, and never stack a per-attempt timeout under a shorter outer one.
