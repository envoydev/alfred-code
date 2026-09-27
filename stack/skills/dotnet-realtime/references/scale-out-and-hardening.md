# SignalR scale-out and hardening

SKILL.md owns the single-node SignalR baseline; this file is the delta when you scale out or harden transport/auth.

## The query-string token wiring for WebSockets

- The browser WebSocket API cannot set an `Authorization` header, so the JWT travels in the **query string** and the bearer handler must be taught to read it for hub paths only:

```csharp
options.Events = new JwtBearerEvents
{
    OnMessageReceived = ctx =>
    {
        var token = ctx.Request.Query["access_token"];
        if (!string.IsNullOrEmpty(token) && ctx.HttpContext.Request.Path.StartsWithSegments("/hubs"))
            ctx.Token = token;
        return Task.CompletedTask;
    }
};
```

The full JWT/policy setup belongs to the skill covering .NET authentication; this is only the hub-specific wiring.

## The MessagePack protocol

- Prefer the **MessagePack** protocol (`AddMessagePackProtocol`) over JSON when message size and serialization cost matter; it is binary and compact.

## Scale-out: a backplane, and what it does not give you

One server keeps every connection's state in its own memory, so the moment you run more than one instance a message sent from server A never reaches a client connected to server B. Two fixes:

- **Self-hosted: a Redis backplane** (`AddStackExchangeRedis`). Every server publishes outgoing messages to Redis pub/sub and subscribes to the same channel, so a broadcast reaches all connections. You still need **sticky sessions** (the negotiate response and the connection must hit the same server).
- **On Azure: the Azure SignalR Service.** It holds the connections itself, which removes the sticky-session requirement and the backplane wiring.

```csharp
builder.Services.AddSignalR()
    .AddMessagePackProtocol()
    .AddStackExchangeRedis(builder.Configuration.GetConnectionString("redis")!);
```

Crucially, a backplane is a **fan-out layer, not a store** - it does not persist messages or deliver to absent clients; the durability rule from the top of SKILL.md stands here too. Connection strings come from configuration via the options pattern, never a literal - same rule as every other transport.
