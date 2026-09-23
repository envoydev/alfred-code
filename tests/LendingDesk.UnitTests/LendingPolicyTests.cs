using LendingDesk.Domain;
using LendingDesk.Domain.Items;
using LendingDesk.Domain.Loans;
using LendingDesk.Domain.Members;

namespace LendingDesk.UnitTests;

public class LendingPolicyTests
{
    private static readonly DateOnly Today = new(2026, 3, 10);

    private static Member ActiveMember() => new() { Id = 1, Name = "Ada Lovelace", Email = "ada@example.com" };

    private static Item Drill(int stock = 2) => new() { Id = 7, Name = "Cordless drill", Category = "Tools", Sku = "DRL-1", TotalStock = stock };

    private static string CodeOf(Action act) => Assert.Throws<DomainException>(act).Code;

    [Fact]
    public void Lends_when_every_rule_holds()
    {
        LendingPolicy.EnsureCanLend(ActiveMember(), Drill(), Today, Today.AddDays(7), Today, copiesOut: 1);
    }

    [Fact]
    public void Refuses_a_suspended_member()
    {
        var member = ActiveMember();
        member.Suspend();
        Assert.Equal("member_suspended", CodeOf(() => LendingPolicy.EnsureCanLend(member, Drill(), Today, Today.AddDays(1), Today, 0)));
    }

    [Fact]
    public void Refuses_a_retired_item()
    {
        var item = Drill();
        item.Retire();
        Assert.Equal("item_retired", CodeOf(() => LendingPolicy.EnsureCanLend(ActiveMember(), item, Today, Today.AddDays(1), Today, 0)));
    }

    [Fact]
    public void Refuses_a_damaged_item()
    {
        var item = Drill();
        item.Condition = ItemCondition.Damaged;
        Assert.Equal("item_damaged", CodeOf(() => LendingPolicy.EnsureCanLend(ActiveMember(), item, Today, Today.AddDays(1), Today, 0)));
    }

    [Fact]
    public void Refuses_a_start_in_the_past()
    {
        Assert.Equal("start_in_past", CodeOf(() => LendingPolicy.EnsureCanLend(ActiveMember(), Drill(), Today.AddDays(-1), Today.AddDays(3), Today, 0)));
    }

    [Fact]
    public void Refuses_a_due_date_before_the_start()
    {
        Assert.Equal("due_before_start", CodeOf(() => LendingPolicy.EnsureCanLend(ActiveMember(), Drill(), Today.AddDays(3), Today.AddDays(2), Today, 0)));
    }

    [Theory]
    [InlineData(LendingPolicy.MaxLoanDays, false)]
    [InlineData(LendingPolicy.MaxLoanDays + 1, true)]
    public void Caps_the_loan_length(int days, bool refused)
    {
        void Lend() => LendingPolicy.EnsureCanLend(ActiveMember(), Drill(), Today, Today.AddDays(days), Today, 0);
        if (refused)
        {
            Assert.Equal("loan_too_long", CodeOf(Lend));
        }
        else
        {
            Lend();
        }
    }

    [Fact]
    public void Refuses_when_every_copy_is_out()
    {
        Assert.Equal("item_unavailable", CodeOf(() => LendingPolicy.EnsureCanLend(ActiveMember(), Drill(stock: 2), Today, Today.AddDays(1), Today, copiesOut: 2)));
    }

    [Theory]
    [InlineData(1, 5, 5, 9, true)]
    [InlineData(1, 5, 6, 9, false)]
    [InlineData(6, 9, 1, 5, false)]
    [InlineData(1, 9, 3, 4, true)]
    public void Overlap_is_inclusive_of_both_ends(int startA, int endA, int startB, int endB, bool expected)
    {
        var day = (int d) => new DateOnly(2026, 3, d);
        Assert.Equal(expected, LendingPolicy.Overlaps(day(startA), day(endA), day(startB), day(endB)));
    }
}
