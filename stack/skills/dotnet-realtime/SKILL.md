---
name: dotnet-realtime
description: "Use for chat, notifications, live dashboards, or any real-time server push in .NET - or when the user names SignalR, hub, server-side WebSocket push, or live updates. ASP.NET Core SignalR conventions: server-to-client push over a persistent connection, connection-scoped and not durable, covering the strongly-typed hub (Hub of TClient), sending via IHubContext, group/user targeting, reconnection, JWT-over-query-string auth, additive client contracts, MessagePack, and scale-out (Redis backplane / Azure SignalR Service). Floors at .NET 8 / C# 12. Do NOT use for broker-backed durable messaging (that is the broker-messaging skill), plain request/response HTTP, in-process reactive streams (Rx / System.Reactive), or an outbound ClientWebSocket."
---

# .NET real-time - ASP.NET Core SignalR

SignalR is server-push over a persistent connection: the server can call methods on connected clients (and they on it) without the client polling. The transport negotiates down a ladder - WebSockets first, then Server-Sent Events, then long-polling. Reach for it for chat, notifications, live dashboards, presence, and collaborative editing - anything where the server has something to say *now* and a client is connected to hear it. Baseline is .NET 8 / C# 12.

The defining trait, and the thing that sets every rule below: a SignalR message is **connection-scoped and best-effort**. The server holds no durable copy; a client that is offline, mid-reconnect, or on another server simply misses it. That is the opposite of broker-backed messaging, where the broker persists the message and redelivers until acknowledged. If a notification *must* arrive, the durable guarantee lives in the broker, and SignalR is only the last hop - see the seam below. This skill does not cover broker-backed messaging, request/response HTTP, or in-process reactive streams (Rx / System.Reactive) - each has its own skill where the project installed one.

## The seam with messaging: broker delivers, SignalR pushes

The common architecture is not 'SignalR instead of a broker' - it is both. A durable integration event arrives on the bus, a consumer handles it inside its transaction, and *then* it pushes a notification to the relevant browsers. The consumer belongs to the broker-messaging and hosted-worker skills; the push is here. The bridge is `IHubContext` - the supported way to send from outside a hub, where no `Clients` property exists:

```csharp
public sealed class OrderPlacedConsumer(IHubContext<OrdersHub, IOrdersClient> hub)
{
    // runs inside the durable consumer; the broker already guaranteed delivery to us
    public Task Handle(OrderPlaced placed) =>
        hub.Clients.Group($"customer-{placed.CustomerId}")
           .OrderConfirmed(placed.OrderId, placed.PlacedAt);
}
```

Never inject a `Hub` subclass to send messages - hubs are transient (below). `IHubContext<THub, TClient>` is the injected, long-lived surface.

## Hubs: strongly-typed and thin

Default to the strongly-typed `Hub<TClient>`, where `TClient` is an interface of the methods the server may call on clients. The compiler then checks every client call, so a renamed or mistyped client method fails the build instead of silently never arriving.

```csharp
public interface IOrdersClient                 // the client contract
{
    Task OrderConfirmed(Guid orderId, DateTimeOffset at);
    Task OrderFailed(Guid orderId, string reason);
}

public sealed class OrdersHub : Hub<IOrdersClient>
{
    public override async Task OnConnectedAsync()
    {
        var customerId = Context.User?.FindFirst("sub")?.Value;
        if (customerId is not null)
            await Groups.AddToGroupAsync(Context.ConnectionId, $"customer-{customerId}");
        await base.OnConnectedAsync();
    }
}
```

- **Keep hub methods thin** - translate the call and delegate to an injected application service, exactly as a thin controller or gRPC service does. Business logic does not live in the hub.
- **A hub instance is per-invocation** - it is created for one method call and disposed after. Never store connection or session state in hub fields; it is gone on the next call. Hold per-connection state in a store keyed by `Context.ConnectionId` (or `IMemoryCache` / a database), not on the instance.
- **Always `await` the send.** A fire-and-forget `Clients.X.Method(...)` can let the hub method complete before the message is dispatched.

## Targeting: callers, groups, users

`Clients` selects who receives a call: `All`, `Caller`, `Others`, `Group(name)`, `User(userId)`, `Client(connectionId)`. Two house rules:

- Use **groups** for any fan-out narrower than everyone (a chat room, a tenant, a customer's open tabs). Manage membership with `Groups.AddToGroupAsync` / `RemoveFromGroupAsync`.
- Use **`Clients.User(id)`** rather than tracking connection ids yourself when you want 'this person on all their devices' - SignalR maps a user to all their connections via the authenticated `NameIdentifier`.

## Reconnection: group membership is not restored

The single most common SignalR bug. When a dropped connection re-establishes, it is a **new connection with a new `ConnectionId`**, and SignalR does **not** re-add it to any groups it was in. You must rejoin explicitly - server-side in `OnConnectedAsync` (as above), and the client must re-request anything tied to the old connection. Configure automatic reconnection and treat reconnect as a fresh join:

```javascript
const connection = new signalR.HubConnectionBuilder()
    .withUrl("/hubs/orders", { accessTokenFactory: () => getToken() })
    .withAutomaticReconnect([0, 2000, 5000, 10000])
    .build();

connection.onreconnected(() => rejoinRoomsAndResync());   // groups are gone - rejoin
```

Reconnection only spans a brief window; past it the connection closes and the client must start a new one. Because messages sent while disconnected are simply lost, a client that needs the current state after a gap should **re-fetch over REST**, not assume SignalR replayed anything.

## Auth: at connect, over the query string, and re-validated per message

- SignalR authenticates **once, at connection time**, then the connection is trusted for its lifetime. So authorize the hub (`[Authorize]` on the hub or method, policies as for any endpoint) *and* validate the inputs of every hub method - a connection authenticated as a low-privilege user must not be able to call a method it shouldn't.
- The browser WebSocket API cannot set an `Authorization` header, so the JWT travels in the **query string** - the bearer-handler wiring that reads it for hub paths only is in `references/scale-out-and-hardening.md`.

## Contracts evolve additively

The client interface is a published contract - clients on old versions stay connected. Evolve it the way a durable message contract is evolved: add new optional fields (prefer a single request/response object parameter so a new field is not a new method signature), never repurpose or retype an existing one, and version the hub name (a `OrdersHubV2` at a new path) for a genuinely breaking change. Stamp any server-set timestamps from an injected `TimeProvider`, never `DateTime.Now` - the clock-seam rule is the C# baseline's.

## Payloads, throughput, transport

- **SignalR carries notifications, not bulk data.** Push the fact that something changed plus an id; let the client pull the heavy payload over REST/gRPC. Large frames create memory pressure and head-of-line stalls.
- **Throttle high-frequency events** (typing indicators, cursor positions, telemetry) on the client - debounce or sample before sending.
- When message size and serialization cost matter, the **MessagePack** protocol setup is in `references/scale-out-and-hardening.md`.
- Set the server's size and timeout limits deliberately, and detailed errors in development only - `references/scale-out-and-hardening.md` names the options.

## Scale-out

Running more than one server instance? A message sent from server A never reaches a client connected to server B without a backplane - the Redis / Azure SignalR Service setup, sticky sessions, and the fan-out-not-a-store caveat are in `references/scale-out-and-hardening.md`.

## Anti-patterns

- Not `await`ing a send, so the hub method returns before the message goes out and an exception surfaces on no caller.
- Exposing ORM entities directly as hub payloads - over-serialization and leak risk; send an explicit DTO instead.

## Prove the push

Connect two clients, send to a group holding both, and quote what each received. Then drop one connection, reconnect it, send again and quote the result - a client that stops receiving after a reconnect is the group membership that was never re-added, and it is invisible to any test with one client.
