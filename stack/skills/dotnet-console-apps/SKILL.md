---
name: dotnet-console-apps
description: "Use when building a .NET CLI tool or chat/trading bot - System.CommandLine, Spectre.Console, Telegram.Bot. Not for host lifecycle, web APIs or GUIs."
---

# .NET console apps - the CLI and bot interface surface

A console binary is one of two things by its external interface: a **one-shot CLI tool** (parse arguments, do the work, return an exit code) or a **long-running gateway app** (a bot or consumer that stays connected and reacts to events). The generic host that runs the long-running kind - lifecycle, `BackgroundService`, graceful shutdown, and the 24/7 hardening: `HttpClient` pooling, resilience pipelines, rate limiting, `ClientWebSocket` reconnect, deployment - is the hosted-worker skill's. This skill assumes that skill is loaded alongside and, where the install lacks it, holds a bot to the floors under 'Bots and gateway consumers'. This skill owns the interface layer on top: how a CLI parses its command surface, and how each bot platform's SDK plugs into that host. Floor is .NET 8 / C# 12.

## When to use

- Also fires on: SlackNet, CryptoExchange.Net, a bot's command surface.
- Covers the console binary's interface: a one-shot CLI (argument parsing, subcommands, exit codes) or a long-running gateway bot or consumer run inside a BackgroundService.
- Do NOT use for the host lifecycle itself - that is the hosted-worker skill covering the generic host and `BackgroundService` - nor for a web API or webhook endpoint, or a desktop GUI.

## CLI argument parsing

Three libraries; pick by how much command surface you have.

- **System.CommandLine** - the parser Microsoft's own `dotnet` CLI is built on; reached stable **2.0.0 GA in November 2025**. The default for a real command tree (subcommands, options, arguments, shell tab-completion). **Migration warning:** the API churned hard through the betas - `2.0.0-beta5` (June 2025) landed major breaking changes, and four sub-packages are now deprecated and excluded from all future releases (DragonFruit, Hosting, Rendering, NamingConventionBinder). Treat any tutorial older than beta5 as stale, and do not adopt the deprecated `Hosting` package to bridge to the generic host - wire the host yourself.
- **Spectre.Console.Cli** - opinionated, type-safe command/settings model (`[CommandArgument]` / `[CommandOption]`), DI support, and rich rendering (tables, prompts, progress bars). The best default for a polished, interactive CLI.
- **Cocona** - minimal, attribute/convention-based, ASP.NET-Core-like ergonomics; fastest to stand up a small command surface.

A CLI tool that also needs config, DI, and logging builds the generic host and drives the parser from it - `Host.CreateApplicationBuilder`, resolve the command handler from DI, return its exit code. Do not reach for a parser's abandoned hosting shim to do it. The GA shape - `SetAction` on the command, values read from the `ParseResult` (the beta-era `SetHandler` surface is gone):

```csharp
var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddSingleton<IngestCommand>();
using var host = builder.Build();

var fileOption = new Option<FileInfo>("--file") { Description = "Input file" };
var root = new RootCommand("Ingests a data file");
root.Options.Add(fileOption);
root.SetAction((parseResult, ct) =>
    host.Services.GetRequiredService<IngestCommand>()
        .RunAsync(parseResult.GetValue(fileOption)!, ct));   // Task<int> -> exit code

return await root.Parse(args).InvokeAsync();
```

Signal handling and graceful shutdown for a tool that does real work are the hosted-worker skill's; without it, the floor is `Host.CreateApplicationBuilder` + `RunAsync` so Ctrl-C and SIGTERM cancel the handler's token.

## Bots and gateway consumers

A bot is a long-running gateway client, so it *is* a hosted service: run the platform client inside a `BackgroundService`, keep command handlers in DI, and lean on the hosted-worker skill for the lifecycle plus the reconnect / rate-limit / idempotency hardening its I/O reference carries. Where the install lacks that skill, these floors still hold: the client runs in a `BackgroundService` whose `ExecuteAsync` catches and logs per cycle (an escaped exception stops the host); every call threads the stopping token; one `HttpClient` over a `SocketsHttpHandler` with `PooledConnectionLifetime`, never `new HttpClient()` per call; reconnect with exponential backoff plus jitter and re-subscribe every channel on a fresh socket; honor `429` / `Retry-After`; persist an idempotency key before each send and reuse it on the retry. The per-platform library choice and integration shape live in `references/bot-sdks.md`:

| Building... | Library | Also load |
|---|---|---|
| a Telegram bot | `Telegram.Bot` (long-polling or webhook) | `references/bot-sdks.md` |
| a Discord bot | `Discord.Net` or `DSharpPlus` (gateway) | `references/bot-sdks.md` |
| a Slack bot | `SlackNet` (Socket Mode or Events API) | `references/bot-sdks.md` |
| a trading / exchange bot | `CryptoExchange.Net` + a venue client | `references/bot-sdks.md` |
| a broker queue worker | per-broker client | the broker-messaging skill (the delivery contract - outbox, idempotent consumers), where installed + `references/bot-sdks.md` |

The one rule that spans all of them: **decouple the receive loop from the work.** The websocket/poll loop writes to a bounded `System.Threading.Channels` channel; a consumer drains it at a controlled concurrency. That keeps a slow handler from stalling the gateway and gives you backpressure - the channel-drained-by-a-hosted-service pattern is the hosted-worker skill's; the floor here is a bounded channel (`FullMode = Wait`) drained by one `BackgroundService` loop.

## Prove it runs before calling it done

A console binary's contract is its exit code and its argument surface, and neither is proven by a build:

1. `dotnet build -warnaserror` - exit 0.
2. `dotnet run -- --help` - the command tree renders, every subcommand and option you added is listed.
3. `dotnet run -- <the real invocation>` then `echo $?` (`$LASTEXITCODE` on PowerShell) - 0 on success, non-zero on the failure path you defined. A tool that returns 0 on failure is broken in CI and nowhere else.

Quote the command and its output line for each; a success claim with no exit code behind it is not evidence.

## Testing and time

A bot's timed logic (poll intervals, backoff windows, rate limits) is tested by injecting `TimeProvider` and advancing a `FakeTimeProvider` - never real waits. Integration tests run the host against a fake gateway (a fake client, an in-memory channel), never the live Telegram / Discord / exchange endpoint. The full approach belongs to the .NET testing hub.
