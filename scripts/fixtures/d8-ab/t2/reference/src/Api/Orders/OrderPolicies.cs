namespace Api.Orders;

public static class OrderPolicies
{
    /// <summary>The policy a refund requires.</summary>
    public const string RefundsApprover = "RefundsApprover";

    /// <summary>The role that policy asks for.</summary>
    public const string RefundsApproverRole = "refunds-approver";
}
