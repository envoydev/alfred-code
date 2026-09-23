using LendingDesk.Domain;
using LendingDesk.Domain.Items;
using LendingDesk.Domain.Members;

namespace LendingDesk.UnitTests;

public class MemberAndItemTests
{
    [Fact]
    public void A_member_is_active_until_suspended_and_cannot_be_suspended_twice()
    {
        var member = new Member { Name = "Grace Hopper", Email = "grace@example.com" };
        Assert.Equal(MemberStatus.Active, member.Status);
        member.Suspend();
        Assert.Equal(MemberStatus.Suspended, member.Status);
        Assert.Equal("member_suspended", Assert.Throws<DomainException>(member.Suspend).Code);
    }

    [Fact]
    public void An_item_is_good_until_told_otherwise_and_cannot_be_retired_twice()
    {
        var item = new Item { Name = "Tripod", Category = "Photo", Sku = "TRP-1", TotalStock = 1 };
        Assert.Equal(ItemCondition.Good, item.Condition);
        item.Retire();
        Assert.True(item.IsRetired);
        Assert.Equal("item_retired", Assert.Throws<DomainException>(item.Retire).Code);
    }
}
