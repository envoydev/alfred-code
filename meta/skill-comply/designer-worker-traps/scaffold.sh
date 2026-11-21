#!/bin/bash
# The workspace, run inside the freshly installed project: a small .NET worker (files only, never built) whose
# Program.cs registers IOrderStore as a scoped service over a SQL-backed store, and a brief that asks for an inbox
# poller with a producer/consumer pair and a clean shutdown. The seat's report is what is graded: its seam names a
# scope per unit of work, the stopping token and a bounded channel, Program.cs sits on exactly one task's files,
# the plan carries a Decisions ledger (or says none), and it opens with Oriented: and closes on status: PLAN_READY.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src/Orders.Worker tests/Orders.Worker.Tests .alfred/docs/work/briefs
printf '.alfred/\nbin/\nobj/\n' >> .gitignore
cat > CLAUDE.md <<'MD'
# orders worker

A .NET worker that stores orders through one seam, IOrderStore.

## Commands

- Build: `dotnet build`
- Test: `dotnet test`
MD
cat > src/Orders.Worker/Orders.Worker.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk.Worker">
  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Extensions.Hosting" Version="9.0.0" />
    <PackageReference Include="Microsoft.Data.SqlClient" Version="5.2.2" />
  </ItemGroup>
</Project>
XML
cat > src/Orders.Worker/Program.cs <<'CS'
using Orders.Worker;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddScoped<IOrderStore, SqlOrderStore>();
builder.Build().Run();
CS
cat > src/Orders.Worker/IOrderStore.cs <<'CS'
namespace Orders.Worker;

public sealed record Order(string Id, string Sku, int Quantity);

// The one way into the order table.
public interface IOrderStore
{
    Task SaveAsync(Order order, CancellationToken cancellationToken);
}
CS
cat > src/Orders.Worker/SqlOrderStore.cs <<'CS'
using Microsoft.Data.SqlClient;

namespace Orders.Worker;

public sealed class SqlOrderStore(IConfiguration configuration) : IOrderStore, IAsyncDisposable
{
    private readonly SqlConnection _connection = new(configuration.GetConnectionString("Orders"));

    public async Task SaveAsync(Order order, CancellationToken cancellationToken)
    {
        if (_connection.State != System.Data.ConnectionState.Open) await _connection.OpenAsync(cancellationToken);
        await using var command = _connection.CreateCommand();
        command.CommandText = "INSERT INTO Orders (Id, Sku, Quantity) VALUES (@id, @sku, @quantity)";
        command.Parameters.AddWithValue("@id", order.Id);
        command.Parameters.AddWithValue("@sku", order.Sku);
        command.Parameters.AddWithValue("@quantity", order.Quantity);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public ValueTask DisposeAsync() => _connection.DisposeAsync();
}
CS
cat > tests/Orders.Worker.Tests/Orders.Worker.Tests.csproj <<'XML'
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
    <ProjectReference Include="../../src/Orders.Worker/Orders.Worker.csproj" />
  </ItemGroup>
</Project>
XML
cat > tests/Orders.Worker.Tests/OrderTests.cs <<'CS'
using Xunit;
using Orders.Worker;

namespace Orders.Worker.Tests;

public class OrderTests
{
    [Fact]
    public void An_order_keeps_its_quantity()
    {
        Assert.Equal(2, new Order("o-1", "A-1", 2).Quantity);
    }
}
CS
cat > .alfred/docs/work/briefs/order-inbox.md <<'MD'
# Card - order inbox

Type: feature

Orders arrive as JSON files in an inbox folder. Poll it every 30 seconds, parse each file and store the order through IOrderStore; for every stored order, post a summary to the billing webhook. Parsing and posting run as a producer/consumer pair so a slow webhook never blocks the poll. The worker stops cleanly on shutdown without losing a parsed order.
MD
git add -A
git commit -q -m 'baseline'
