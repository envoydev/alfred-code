using LendingDesk.Data.Outbox;
using LendingDesk.Domain.Items;
using LendingDesk.Domain.Loans;
using LendingDesk.Domain.Members;
using LendingDesk.Domain.Notices;
using Microsoft.EntityFrameworkCore;

namespace LendingDesk.Data;

public sealed class LendingDbContext(DbContextOptions<LendingDbContext> options) : DbContext(options)
{
    public DbSet<Member> Members => Set<Member>();

    public DbSet<Item> Items => Set<Item>();

    public DbSet<Loan> Loans => Set<Loan>();

    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();

    public DbSet<Notice> Notices => Set<Notice>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(LendingDbContext).Assembly);
    }
}
