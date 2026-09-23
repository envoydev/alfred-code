using LendingDesk.Domain.Members;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LendingDesk.Data.Configurations;

internal sealed class MemberConfiguration : IEntityTypeConfiguration<Member>
{
    public void Configure(EntityTypeBuilder<Member> builder)
    {
        builder.Property(m => m.Name).HasMaxLength(200);
        builder.Property(m => m.Email).HasMaxLength(320);
        builder.HasIndex(m => m.Email).IsUnique();
    }
}
