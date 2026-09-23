using LendingDesk.Domain;
using LendingDesk.Domain.Loans;

namespace LendingDesk.UnitTests;

public class LoanTests
{
    private static Loan LoanDue(DateOnly due) => new() { Id = 3, StartDate = due.AddDays(-7), DueDate = due };

    [Fact]
    public void Is_active_up_to_and_including_the_due_date()
    {
        var due = new DateOnly(2026, 3, 10);
        Assert.Equal(LoanState.Active, LoanDue(due).StateOn(due));
        Assert.Equal(LoanState.Overdue, LoanDue(due).StateOn(due.AddDays(1)));
    }

    [Fact]
    public void Is_returned_once_returned_even_after_the_due_date()
    {
        var loan = LoanDue(new DateOnly(2026, 3, 10));
        loan.Return(new DateTimeOffset(2026, 3, 12, 9, 0, 0, TimeSpan.Zero));
        Assert.Equal(LoanState.Returned, loan.StateOn(new DateOnly(2026, 3, 20)));
    }

    [Fact]
    public void Cannot_be_returned_twice()
    {
        var loan = LoanDue(new DateOnly(2026, 3, 10));
        loan.Return(DateTimeOffset.UnixEpoch);
        Assert.Equal("loan_already_returned", Assert.Throws<DomainException>(() => loan.Return(DateTimeOffset.UnixEpoch)).Code);
    }
}
