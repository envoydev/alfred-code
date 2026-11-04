#!/bin/bash
# The workspace, run inside the freshly installed project: a small .NET worker (files only, never built)
# that keeps orders behind an IOrderStore seam and serves an admin API through one route table. The
# architecture preferences hold one entry, A1 - orders go through that seam - and the brief is the
# order-export card, whose export must read the orders. The seat's report is what is graded: the
# Decisions row the preference decides names A1, no row names an id that does not exist, and each
# Verify bullet of the card lands on a task's test line.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src/OrdersWorker/Orders src/OrdersWorker/Api tests/OrdersWorker.Tests .alfred/docs/preferences .alfred/docs/work/briefs
printf '.alfred/\nbin/\nobj/\n' >> .gitignore
cat > CLAUDE.md <<'MD'
# orders worker

A .NET worker that keeps the orders and serves the admin console's API from one route table.

## Commands

- Build: `dotnet build`
- Test: `dotnet test`
MD
cat > src/OrdersWorker/OrdersWorker.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk.Worker">
  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
</Project>
XML
cat > src/OrdersWorker/Program.cs <<'CS'
using OrdersWorker.Api;
using OrdersWorker.Orders;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddSingleton<IOrderStore, InMemoryOrderStore>();
builder.Services.AddSingleton<RouteTable>();
builder.Services.AddHostedService<AdminApiService>();
builder.Build().Run();
CS
cat > src/OrdersWorker/Orders/Order.cs <<'CS'
namespace OrdersWorker.Orders;

public sealed record Order(int Id, string Sku, int Quantity, string Note);
CS
cat > src/OrdersWorker/Orders/IOrderStore.cs <<'CS'
namespace OrdersWorker.Orders;

// The one way in and out of the order list.
public interface IOrderStore
{
    Order Add(string sku, int quantity, string note);
    IReadOnlyList<Order> All();
}
CS
cat > src/OrdersWorker/Orders/InMemoryOrderStore.cs <<'CS'
namespace OrdersWorker.Orders;

public sealed class InMemoryOrderStore : IOrderStore
{
    private readonly List<Order> _orders = new();
    private readonly object _gate = new();

    public Order Add(string sku, int quantity, string note)
    {
        lock (_gate)
        {
            var order = new Order(_orders.Count + 1, sku, quantity, note);
            _orders.Add(order);
            return order;
        }
    }

    public IReadOnlyList<Order> All()
    {
        lock (_gate) return _orders.ToList();
    }
}
CS
cat > src/OrdersWorker/Api/ApiRequest.cs <<'CS'
namespace OrdersWorker.Api;

public sealed record ApiRequest(string Method, string Path, string Role, IReadOnlyDictionary<string, string> Form);

public sealed record ApiResponse(int Status, string ContentType, string Body);
CS
cat > src/OrdersWorker/Api/RouteTable.cs <<'CS'
using OrdersWorker.Orders;

namespace OrdersWorker.Api;

// Every route the admin API answers is registered here, once.
public sealed class RouteTable
{
    private readonly Dictionary<(string Method, string Path), Func<ApiRequest, ApiResponse>> _routes = new();

    public RouteTable(IOrderStore store)
    {
        _routes[("POST", "/orders")] = request =>
        {
            var order = store.Add(request.Form["sku"], int.Parse(request.Form["quantity"]), request.Form.GetValueOrDefault("note", ""));
            return new ApiResponse(201, "text/plain", order.Id.ToString());
        };
    }

    public ApiResponse Dispatch(ApiRequest request) =>
        _routes.TryGetValue((request.Method, request.Path), out var handle)
            ? handle(request)
            : new ApiResponse(404, "text/plain", "not found");
}
CS
cat > src/OrdersWorker/Api/AdminApiService.cs <<'CS'
using System.Net;

namespace OrdersWorker.Api;

// Serves the admin console on localhost through the route table.
public sealed class AdminApiService(RouteTable routes, ILogger<AdminApiService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var listener = new HttpListener();
        listener.Prefixes.Add("http://localhost:5080/");
        listener.Start();
        logger.LogInformation("admin api listening on {Prefix}", "http://localhost:5080/");
        while (!stoppingToken.IsCancellationRequested)
        {
            var context = await listener.GetContextAsync().WaitAsync(stoppingToken);
            var request = new ApiRequest(context.Request.HttpMethod, context.Request.Url!.AbsolutePath,
                context.Request.Headers["X-Role"] ?? "", new Dictionary<string, string>());
            var response = routes.Dispatch(request);
            context.Response.StatusCode = response.Status;
            context.Response.ContentType = response.ContentType;
            await using var writer = new StreamWriter(context.Response.OutputStream);
            await writer.WriteAsync(response.Body);
        }
    }
}
CS
cat > tests/OrdersWorker.Tests/OrdersWorker.Tests.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.12.0" />
    <PackageReference Include="xunit" Version="2.9.2" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.8.2" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="../../src/OrdersWorker/OrdersWorker.csproj" />
  </ItemGroup>
</Project>
XML
cat > tests/OrdersWorker.Tests/RouteTableTests.cs <<'CS'
using OrdersWorker.Api;
using OrdersWorker.Orders;

namespace OrdersWorker.Tests;

public class RouteTableTests
{
    [Fact]
    public void An_order_is_created()
    {
        var routes = new RouteTable(new InMemoryOrderStore());
        var form = new Dictionary<string, string> { ["sku"] = "A-1", ["quantity"] = "2" };
        Assert.Equal(201, routes.Dispatch(new ApiRequest("POST", "/orders", "admin", form)).Status);
    }
}
CS
cat > .alfred/docs/preferences/ARCHITECTURE-PREFERENCES.md <<'MD'
# Architecture preferences

Updated: 2026-11-03

## A1 - Orders are stored only through the IOrderStore seam
<!-- id: a1 -->
- Rule: read and write orders only through `IOrderStore`; no other type holds or walks the order list.
- Scope: src/**/*.cs
- Why: the store moves to a database next quarter, behind the same seam.
MD
cat > .alfred/docs/work/briefs/order-export.md <<'MD'
# Card - order export

Type: feature

The admin console needs every order as a CSV file.

## Parts

1. The export - `GET /orders/export` answers `text/csv` with the header `id,sku,quantity,note` and one row per
   order; the note is quoted, and a quote inside it is doubled (RFC 4180). Register the route in
   `src/OrdersWorker/Api/RouteTable.cs`.
2. The export link - `GET /admin/export-link` answers the export's URL for the console's download button.
   Register the route in `src/OrdersWorker/Api/RouteTable.cs`.

Both routes are for admins only (the request's `Role` is `admin`).

## Verify

- an export of zero orders is a header row only
- a quote in a note is doubled
- the route answers 403 to a non-admin
MD
git add -A
git commit -q -m 'baseline'
