using LendingDesk.Data;
using LendingDesk.Domain.Notices;
using LendingDesk.Worker.Notices;
using Microsoft.EntityFrameworkCore;

namespace LendingDesk.Worker.Reminders;

/// <summary>Finds loans due tomorrow and loans past due, and sends each its notice once.</summary>
public sealed class ReminderScanner(LendingDbContext db, NoticeSender notices, TimeProvider clock)
{
    /// <returns>How many notices were sent.</returns>
    public async Task<int> ScanAsync(CancellationToken cancellationToken)
    {
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var tomorrow = today.AddDays(1);

        var dueSoon = await db.Loans
            .Where(l => l.ReturnedAt == null && l.DueDate == tomorrow)
            .Where(l => !db.Notices.Any(n => n.LoanId == l.Id && n.Kind == NoticeKind.DueSoon))
            .Select(l => l.Id)
            .ToListAsync(cancellationToken);
        var overdue = await db.Loans
            .Where(l => l.ReturnedAt == null && l.DueDate < today)
            .Where(l => !db.Notices.Any(n => n.LoanId == l.Id && n.Kind == NoticeKind.Overdue))
            .Select(l => l.Id)
            .ToListAsync(cancellationToken);

        var sent = 0;
        foreach (var loanId in dueSoon)
        {
            sent += await notices.SendAsync(loanId, NoticeKind.DueSoon, cancellationToken) ? 1 : 0;
        }

        foreach (var loanId in overdue)
        {
            sent += await notices.SendAsync(loanId, NoticeKind.Overdue, cancellationToken) ? 1 : 0;
        }

        return sent;
    }
}
