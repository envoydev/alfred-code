using LendingDesk.Domain.Notices;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LendingDesk.Data.Configurations;

internal sealed class NoticeConfiguration : IEntityTypeConfiguration<Notice>
{
    public void Configure(EntityTypeBuilder<Notice> builder)
    {
        builder.Property(n => n.Kind).HasConversion<string>().HasMaxLength(32);
        builder.HasOne(n => n.Loan).WithMany().HasForeignKey(n => n.LoanId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(n => new { n.LoanId, n.Kind }).IsUnique();
    }
}
