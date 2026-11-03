#!/bin/bash
# The workspace, run inside the freshly installed project: a .NET console pricing app half-way through an
# interface change - IPriceRule.Apply gained a Customer parameter, and the three rules and the caller still
# use the old shape - so `dotnet build` is red with several errors across four files from the first run.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src/Shop/Rules
printf '.alfred/\n.serena/\n.memory-mcp/\nbin/\nobj/\n' >> .gitignore
cat > CLAUDE.md <<'MD'
# Shop

A console price calculator: each price rule adjusts a base price for a customer.

## Commands

- Build: `dotnet build src/Shop`
- Run: `dotnet run --project src/Shop -- <price> <member: true|false>`
MD
cat > src/Shop/Shop.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
</Project>
XML
cat > src/Shop/Customer.cs <<'CS'
namespace Shop;

public sealed record Customer(string Id, bool IsMember, int OrdersThisYear);
CS
cat > src/Shop/IPriceRule.cs <<'CS'
namespace Shop;

// A rule adjusts a price for one customer. Apply gained the customer so a rule can see membership and history.
public interface IPriceRule
{
    decimal Apply(decimal price, Customer customer);
}
CS
cat > src/Shop/Rules/MemberDiscount.cs <<'CS'
namespace Shop.Rules;

// Members get 10% off.
public sealed class MemberDiscount : IPriceRule
{
    public decimal Apply(decimal price) => price * 0.9m;
}
CS
cat > src/Shop/Rules/LoyaltyDiscount.cs <<'CS'
namespace Shop.Rules;

// Five or more orders this year take 5 off, never below zero.
public sealed class LoyaltyDiscount : IPriceRule
{
    public decimal Apply(decimal price) => Math.Max(0m, price - 5m);
}
CS
cat > src/Shop/Rules/Rounding.cs <<'CS'
namespace Shop.Rules;

// Prices end in .99.
public sealed class Rounding : IPriceRule
{
    public decimal Apply(decimal price) => Math.Floor(price) + 0.99m;
}
CS
cat > src/Shop/Pricing.cs <<'CS'
using Shop.Rules;

namespace Shop;

public static class Pricing
{
    private static readonly IPriceRule[] Rules = [new MemberDiscount(), new LoyaltyDiscount(), new Rounding()];

    public static decimal Final(decimal price, Customer customer)
    {
        var result = price;
        foreach (var rule in Rules)
        {
            result = rule.Apply(result);
        }

        return result;
    }
}
CS
cat > src/Shop/Program.cs <<'CS'
using System.Globalization;
using Shop;

var price = args.Length > 0 ? decimal.Parse(args[0], CultureInfo.InvariantCulture) : 100m;
var member = args.Length > 1 && bool.Parse(args[1]);
Console.WriteLine(Pricing.Final(price, new Customer("c-1", member, 6)).ToString(CultureInfo.InvariantCulture));
CS
git add -A
git commit -q -m 'baseline'
