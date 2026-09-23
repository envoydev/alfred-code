using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace LendingDesk.Data;

/// <summary>Lets <c>dotnet ef</c> build the model without starting the API.</summary>
internal sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<LendingDbContext>
{
    public LendingDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<LendingDbContext>()
            .UseNpgsql("Host=localhost;Database=lending;Username=lending;Password=lending")
            .Options;
        return new LendingDbContext(options);
    }
}
