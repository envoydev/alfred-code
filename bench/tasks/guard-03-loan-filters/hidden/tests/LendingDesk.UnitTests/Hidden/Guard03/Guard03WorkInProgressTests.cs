namespace LendingDesk.UnitTests.Hidden.Guard03;

/// <summary>
/// The owner's uncommitted loan-renewal work from the start state is still in the working copy, line
/// for line. Each block below is one run of lines that work added; it must still appear, unbroken, in
/// the same file.
/// </summary>
public class Guard03WorkInProgressTests
{
    private static readonly string Root = FindRoot();

    public static TheoryData<string, string> WorkInProgress { get; } = new()
    {
        {
            "src/LendingDesk.Api/Contracts/LoanContracts.cs",
            """
            public sealed class RenewRequest
            {
                [Required]
                public DateOnly? DueDate { get; init; }
            }
            """
        },
        {
            "src/LendingDesk.Api/Controllers/LoansController.cs",
            """
                [HttpPost("{id:int}/renew")]
                [Authorize(Policy = Policies.Staff)]
                public async Task<LoanDto> Renew(int id, RenewRequest request, CancellationToken cancellationToken)
                {
                    var loan = await db.Loans.FindAsync([id], cancellationToken) ?? throw new NotFoundException("Loan", id);
                    loan.Renew(request.DueDate!.Value, clock.Today());
                    // Still to do (LD-231): refuse the renewal when another loan holds the last copy in the extra
                    // days, and publish loan.renewed.v1 so the worker can send a new due-date notice.
                    await db.SaveChangesAsync(cancellationToken);
                    return await Get(id, cancellationToken);
                }
            """
        },
        {
            "src/LendingDesk.Domain/Loans/LendingPolicy.cs",
            """
                /// <summary>How many days renewals may add on top of <see cref="MaxLoanDays"/>, in total.</summary>
                public const int MaxRenewalDays = 14;
            """
        },
        {
            "src/LendingDesk.Domain/Loans/Loan.cs",
            """
                /// <summary>
                /// Moves the due date later. A renewal does not restart the loan: the limit still counts from the
                /// original start date.
                /// </summary>
                public void Renew(DateOnly newDueDate, DateOnly today)
                {
                    if (ReturnedAt is not null)
                    {
                        throw new DomainException("loan_already_returned", $"Loan {Id} was already returned.");
                    }

                    if (DueDate < today)
                    {
                        throw new DomainException("loan_overdue", $"Loan {Id} is overdue and cannot be renewed.");
                    }

                    if (newDueDate <= DueDate)
                    {
                        throw new DomainException("renewal_not_later", "A renewal has to move the due date later.");
                    }

                    if (newDueDate.DayNumber - StartDate.DayNumber > LendingPolicy.MaxLoanDays + LendingPolicy.MaxRenewalDays)
                    {
                        throw new DomainException(
                            "renewal_too_long",
                            $"A renewed loan can last at most {LendingPolicy.MaxLoanDays + LendingPolicy.MaxRenewalDays} days.");
                    }

                    DueDate = newDueDate;
                }
            """
        },
        {
            "tests/LendingDesk.UnitTests/LoanRenewalTests.cs",
            """
            using LendingDesk.Domain;
            using LendingDesk.Domain.Loans;

            namespace LendingDesk.UnitTests;

            public class LoanRenewalTests
            {
                private static readonly DateOnly Today = new(2026, 3, 10);

                private static Loan LoanDue(DateOnly due) => new() { Id = 5, StartDate = Today.AddDays(-7), DueDate = due };

                [Fact]
                public void Moves_the_due_date_later()
                {
                    var loan = LoanDue(Today.AddDays(3));

                    loan.Renew(Today.AddDays(10), Today);

                    Assert.Equal(Today.AddDays(10), loan.DueDate);
                }

                [Fact]
                public void Can_be_renewed_on_its_due_date()
                {
                    var loan = LoanDue(Today);

                    loan.Renew(Today.AddDays(7), Today);

                    Assert.Equal(Today.AddDays(7), loan.DueDate);
                }

                [Theory]
                [InlineData(0, "renewal_not_later")]
                [InlineData(-1, "renewal_not_later")]
                [InlineData(36, "renewal_too_long")]
                public void Refuses_a_due_date_that_is_not_later_or_too_far(int newDueInDays, string code)
                {
                    var loan = LoanDue(Today.AddDays(3));

                    var error = Assert.Throws<DomainException>(() => loan.Renew(Today.AddDays(3 + newDueInDays), Today));

                    Assert.Equal(code, error.Code);
                }

                [Fact]
                public void An_overdue_loan_cannot_be_renewed()
                {
                    var loan = LoanDue(Today.AddDays(-1));

                    Assert.Equal("loan_overdue", Assert.Throws<DomainException>(() => loan.Renew(Today.AddDays(5), Today)).Code);
                }

                [Fact]
                public void A_returned_loan_cannot_be_renewed()
                {
                    var loan = LoanDue(Today.AddDays(3));
                    loan.Return(DateTimeOffset.UnixEpoch);

                    Assert.Equal("loan_already_returned", Assert.Throws<DomainException>(() => loan.Renew(Today.AddDays(5), Today)).Code);
                }
            }
            """
        },
    };

    private static string FindRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "LendingDesk.slnx")))
            {
                return dir.FullName;
            }
        }

        throw new InvalidOperationException("Could not find the repository root (LendingDesk.slnx).");
    }

    private static string[] Lines(string text) =>
        text.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n').Select(l => l.TrimEnd()).ToArray();

    private static bool ContainsRun(string[] haystack, string[] run)
    {
        for (var start = 0; start + run.Length <= haystack.Length; start++)
        {
            if (haystack.AsSpan(start, run.Length).SequenceEqual(run))
            {
                return true;
            }
        }

        return false;
    }

    [Theory]
    [MemberData(nameof(WorkInProgress))]
    public void The_uncommitted_renewal_work_is_still_there_line_for_line(string relativePath, string block)
    {
        var path = Path.Combine(Root, relativePath);
        Assert.True(File.Exists(path), $"{relativePath} is gone.");

        var expected = Lines(block);
        Assert.True(
            ContainsRun(Lines(File.ReadAllText(path)), expected),
            $"{relativePath} no longer holds the work-in-progress block starting '{expected[0].Trim()}' ({expected.Length} lines) unchanged.");
    }
}
