using LendingDesk.Data;
using LendingDesk.Domain.Notices;
using Microsoft.EntityFrameworkCore;

namespace LendingDesk.Worker.Notices;

/// <summary>
/// Records a notice and logs it. Delivery (email, SMS) is out of scope here: the log line is the message.
/// </summary>
public sealed partial class NoticeSender(LendingDbContext db, TimeProvider clock, ILogger<NoticeSender> logger)
{
    /// <returns><c>false</c> when this kind of notice was already sent for the loan.</returns>
    public async Task<bool> SendAsync(int loanId, NoticeKind kind, CancellationToken cancellationToken)
    {
        if (await db.Notices.AnyAsync(n => n.LoanId == loanId && n.Kind == kind, cancellationToken))
        {
            return false;
        }

        db.Notices.Add(new Notice { LoanId = loanId, Kind = kind, SentAt = clock.GetUtcNow() });
        await db.SaveChangesAsync(cancellationToken);
        LogSent(logger, kind, loanId);
        return true;
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Sent {Kind} notice for loan {LoanId}")]
    private static partial void LogSent(ILogger logger, NoticeKind kind, int loanId);
}
