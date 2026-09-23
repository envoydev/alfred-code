using LendingDesk.Data.Outbox;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LendingDesk.Data.Configurations;

internal sealed class OutboxMessageConfiguration : IEntityTypeConfiguration<OutboxMessage>
{
    public void Configure(EntityTypeBuilder<OutboxMessage> builder)
    {
        builder.Property(o => o.Type).HasMaxLength(100);
        builder.Property(o => o.Payload).HasColumnType("jsonb");
        builder.Property(o => o.LastError).HasMaxLength(2000);
        builder.HasIndex(o => o.Id).HasFilter("\"ProcessedAt\" IS NULL").HasDatabaseName("IX_OutboxMessages_Pending");
    }
}
