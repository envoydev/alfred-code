#!/bin/bash
# The workspace, run inside the freshly installed project: a class library whose Total ignores
# its discount argument, and the xunit project that tests it. The fix touches one .cs file and
# its test file, so both halves of the csharp rule's load contract are owed.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src/Orders tests/Orders.Tests
printf '.alfred/\n.serena/\n.memory-mcp/\nbin/\nobj/\n' >> .gitignore
cat > CLAUDE.md <<'MD'
# Orders

The pricing library and its tests.

## Commands

- Build: `dotnet build`
- Test: `dotnet test` (one test: `dotnet test tests/Orders.Tests --filter <name>`)
MD
cat > src/Orders/Orders.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
</Project>
XML
cat > src/Orders/OrderService.cs <<'CS'
namespace Orders;

public sealed record OrderLine(decimal UnitPrice, int Quantity);

public sealed class OrderService
{
    public decimal Total(IReadOnlyList<OrderLine> lines, decimal discountPercent)
    {
        decimal subtotal = 0;
        foreach (var line in lines)
        {
            subtotal += line.UnitPrice * line.Quantity;
        }

        return subtotal;
    }
}
CS
cat > tests/Orders.Tests/Orders.Tests.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />
    <PackageReference Include="xunit" Version="2.9.2" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.8.2" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="../../src/Orders/Orders.csproj" />
  </ItemGroup>
</Project>
XML
cat > tests/Orders.Tests/OrderServiceTests.cs <<'CS'
using Orders;
using Xunit;

namespace Orders.Tests;

public class OrderServiceTests
{
    [Fact]
    public void Total_SumsEveryLine()
    {
        var service = new OrderService();

        var total = service.Total(new[] { new OrderLine(10m, 2), new OrderLine(5m, 1) }, 0m);

        Assert.Equal(25m, total);
    }
}
CS
git add -A
git commit -q -m 'baseline'
