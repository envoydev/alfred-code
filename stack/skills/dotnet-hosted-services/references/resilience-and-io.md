# Outbound I/O hardening for a 24/7 worker

The cross-cutting I/O baseline the ASP.NET Core web hub skill gives an HTTP service - `IHttpClientFactory`, resilience, rate limiting - is off-limits to a console worker (that skill does not load for a non-web host). A long-running worker or bot that calls out to HTTP APIs and websocket gateways needs the same hardening, so it lives here. These are the failures that kill a process that has been up for weeks, not minutes.

## HttpClient and socket exhaustion

Never `new HttpClient()` per request. A disposed `HttpClient` leaves its socket in `TIME_WAIT`; under load the process runs out of ephemeral ports and every outbound call starts failing. Two correct shapes:

1. **A singleton `HttpClient` over a `SocketsHttpHandler` with `PooledConnectionLifetime`** - the simplest fit for a worker, which has no request scope to hang a factory off:

   ```csharp
   builder.Services.AddSingleton(_ => new HttpClient(
       new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(2) }));
   ```

   Per Microsoft's guidance this 'solves both the port exhaustion and DNS changes problems without adding the overhead of IHttpClientFactory' - the pooled-connection lifetime recycles connections so a DNS change is picked up within the interval.

2. **`IHttpClientFactory` (`AddHttpClient`, named/typed clients)** when you want per-endpoint config, a typed client, or the resilience handler below. It pools and rotates the handler on `HandlerLifetime` (default two minutes; `InfiniteTimeSpan` to disable).

The trap that bites a worker: **do not inject a typed client into a singleton** (a `BackgroundService`). A typed client is transient, so the singleton captures the first instance for the whole process and stops reacting to DNS. If a singleton must hold a client, give it the `SocketsHttpHandler` + `PooledConnectionLifetime` shape and set `HandlerLifetime` to infinite. Cap `MaxConnectionsPerServer` for HTTP/1.1 bursts, and prefer HTTP/2 multiplexing where the endpoint supports it.

## Resilience - Polly v8

For a typed/named client, one line adds retry-with-jitter, a circuit breaker, and a timeout:

```csharp
builder.Services.AddHttpClient<ExchangeClient>()
    .AddStandardResilienceHandler();   // Microsoft.Extensions.Http.Resilience
```

Defaults: 30s total timeout, up to 3 retries with exponential backoff + jitter, a circuit breaker. This is the console analog of the resilience the ASP.NET Core web hub skill wires for a web service.

For non-HTTP work (a broker call, a custom gateway), build a pipeline with `ResiliencePipelineBuilder`: `AddRetry` (`DelayBackoffType.Exponential`, `UseJitter = true`), `AddCircuitBreaker`, `AddTimeout`, `AddRateLimiter`. Strategy order matters - the standard handler nests them outside-in as rate limiter -> total timeout -> retry -> circuit breaker -> per-attempt timeout, so retry wraps the breaker (an open circuit short-circuits each attempt) rather than the other way round. The v7 `Policy.WaitAndRetryAsync` static API still works but is legacy; `Microsoft.Extensions.Http.Resilience` supersedes the old `Microsoft.Extensions.Http.Polly`.

## Rate limiting outbound calls

`System.Threading.RateLimiting` provides `TokenBucketRateLimiter`, `FixedWindowRateLimiter`, `SlidingWindowRateLimiter`, `ConcurrencyLimiter`, and `PartitionedRateLimiter<TResource>` for per-key limits (one bucket per exchange endpoint, per bot chat, per tenant). Enforce a venue's quota by wrapping the `HttpClient` in a `DelegatingHandler` that acquires a lease before sending, or use Polly's `AddRateLimiter` (a thin layer over the same package). On rejection, `RateLimiterRejectedException.RetryAfter` tells you when to retry - honor it, and honor a server `429` + `Retry-After` the same way.

## Raw ClientWebSocket - reconnect is yours to build

The server side (SignalR pushing to browsers) is the realtime skill's, where installed. A bot or trading client is the other direction: a `ClientWebSocket` connecting *out* to an external gateway (Discord, an exchange), and raw `ClientWebSocket` has **no reconnect**. Build it:

- **Liveness.** `ClientWebSocketOptions.KeepAliveTimeout` (on the floor; added in .NET 9) (default `InfiniteTimeSpan`, i.e. disabled). Set it plus `KeepAliveInterval` to switch from the passive unsolicited-PONG heartbeat to active PING/PONG - 'if no PONG response arrived after KeepAliveTimeout elapsed, the remote endpoint is deemed unresponsive, and the WebSocket connection is automatically aborted.' There must be an outstanding `ReceiveAsync` at all times for PONGs to be processed. Below the floor, .NET 8 has only the unsolicited-PONG strategy - it keeps the TCP connection from idling out but detects a dead peer only through TCP timeouts - so a bot still on 8 owns its own liveness check: a timer that aborts the socket when no frame arrived within the window.
- **Reconnect loop.** On disconnect: dispose the socket (a disposed `ClientWebSocket` cannot be reused), wait an exponential backoff with jitter, create a **new** `ClientWebSocket`, reconnect, and **re-subscribe every channel** - gateways create a fresh session per connection, so the old subscriptions are gone.
- **Or wrap it.** `Websocket.Client` (Marfusios) provides `ReconnectTimeout` (inactivity-based), `ErrorReconnectTimeout`, and `ReconnectionHappened` / `DisconnectionHappened` / `MessageReceived` observables; internally it pools buffers with `ArrayPool<byte>` and queues sends on a channel. For an exchange, `CryptoExchange.Net` and its venue clients already do reconnect, client-side rate limiting, and order-book maintenance - the per-venue client notes are the CLI-and-bot interface skill's, where installed.

## Idempotency across a retry

Every retry above is at-least-once by nature: a call can succeed on the server and still surface as a timeout on the client, so a blind retry double-acts. Generate and persist an idempotency key *before* the network call (a `clientOrderId`, a message id) and reuse it on every retry; on timeout, query by that key before retrying so the server dedupes. The durable-delivery version of this - the outbox, the inbox/dedup table, at-least-once consumers - is the broker-messaging skill's, where installed; this note only fixes that a per-call retry needs a stable key.
