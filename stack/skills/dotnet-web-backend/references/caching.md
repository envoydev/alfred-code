# Caching

Match the cache to the topology, and always set an expiry.

- `IMemoryCache` for a single-process, short-TTL cache - fastest, but invisible to other instances.
- `HybridCache` (the `Microsoft.Extensions.Caching.Hybrid` package) when you want both an in-process L1 and a distributed L2 behind one API, with stampede protection and tag-based invalidation built in. It is now GA and the default for any multi-instance service; the package targets down to .NET Standard 2.0, so it runs on the floor and below it:

```csharp
builder.Services.AddHybridCache();

// in a service:
var order = await cache.GetOrCreateAsync(
    $"order:{id}",
    async ct => await repo.GetOrderAsync(id, ct),
    cancellationToken: ct);
```

If you would rather not add the dependency, fall back to `IDistributedCache` (the Redis implementation) for the distributed tier and `IMemoryCache` for the local tier directly - but `HybridCache` is the better default now that it runs on the floor.

- Redis (StackExchange.Redis) is the distributed store behind either path. Always set an expiry; never cache forever.
- Put a version or schema marker in the cache key so a deploy invalidates stale entries automatically, and never cache user-specific data without partitioning the key by user identifier.
- For whole-response caching, use output caching (`AddOutputCache`), not response caching - response caching is header-driven and browsers routinely defeat it. Output caching caches only `200` responses to unauthenticated `GET`/`HEAD` requests by default. Do not back it with `IDistributedCache` (no atomic operations for tag eviction); to scale out across instances use the built-in Redis output-cache provider (`AddStackExchangeRedisOutputCache`, on the floor) and evict grouped entries by tag via `IOutputCacheStore.EvictByTagAsync`.
