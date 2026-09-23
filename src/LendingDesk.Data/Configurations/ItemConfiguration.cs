using LendingDesk.Domain.Items;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LendingDesk.Data.Configurations;

internal sealed class ItemConfiguration : IEntityTypeConfiguration<Item>
{
    public void Configure(EntityTypeBuilder<Item> builder)
    {
        builder.Property(i => i.Name).HasMaxLength(200);
        builder.Property(i => i.Category).HasMaxLength(100);
        builder.Property(i => i.Sku).HasMaxLength(64);
        builder.HasIndex(i => i.Sku).IsUnique();
        builder.ToTable(t => t.HasCheckConstraint("CK_Items_TotalStock", "\"TotalStock\" >= 0"));
    }
}
