using LendingDesk.Api.Auth;
using LendingDesk.Api.Contracts;
using LendingDesk.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LendingDesk.Api.Controllers;

[ApiController]
[Route("api/reports")]
[Authorize(Policy = Policies.Staff)]
public sealed class ReportsController(LendingDbContext db, TimeProvider clock) : ControllerBase
{
    [HttpGet("overdue")]
    public async Task<IReadOnlyList<OverdueRowDto>> Overdue(CancellationToken cancellationToken)
    {
        var today = clock.Today();
        var rows = await db.Loans
            .AsNoTracking()
            .Where(l => l.ReturnedAt == null && l.DueDate < today)
            .OrderBy(l => l.DueDate)
            .ThenBy(l => l.Id)
            .Select(l => new { l.Id, ItemName = l.Item.Name, MemberName = l.Member.Name, l.DueDate })
            .ToListAsync(cancellationToken);
        return rows
            .Select(r => new OverdueRowDto(r.Id, r.ItemName, r.MemberName, r.DueDate, today.DayNumber - r.DueDate.DayNumber))
            .ToList();
    }
}
