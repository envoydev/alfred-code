using LendingDesk.Api.Auth;
using LendingDesk.Api.Contracts;
using LendingDesk.Api.Errors;
using LendingDesk.Data;
using LendingDesk.Domain.Loans;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LendingDesk.Api.Controllers;

[ApiController]
[Route("api/loans")]
public sealed class LoansController(LendingDbContext db, TimeProvider clock) : ControllerBase
{
    [HttpGet]
    public Task<PagedResult<LoanDto>> List([FromQuery] LoanQuery query, CancellationToken cancellationToken)
    {
        var today = clock.Today();
        var loans = db.Loans.AsNoTracking();
        if (query.MemberId is { } memberId)
        {
            loans = loans.Where(l => l.MemberId == memberId);
        }

        loans = query.Status switch
        {
            LoanState.Returned => loans.Where(l => l.ReturnedAt != null),
            LoanState.Overdue => loans.Where(l => l.ReturnedAt == null && l.DueDate < today),
            LoanState.Active => loans.Where(l => l.ReturnedAt == null && l.DueDate >= today),
            _ => loans,
        };

        return Project(loans.OrderBy(l => l.DueDate).ThenBy(l => l.Id), today).ToPageAsync(query, cancellationToken);
    }

    [HttpGet("{id:int}")]
    public async Task<LoanDto> Get(int id, CancellationToken cancellationToken) =>
        await Project(db.Loans.AsNoTracking().Where(l => l.Id == id), clock.Today()).SingleOrDefaultAsync(cancellationToken)
        ?? throw new NotFoundException("Loan", id);

    [HttpGet("/api/members/{memberId:int}/loans")]
    public async Task<IReadOnlyList<LoanDto>> ForMember(int memberId, CancellationToken cancellationToken)
    {
        if (!await db.Members.AnyAsync(m => m.Id == memberId, cancellationToken))
        {
            throw new NotFoundException("Member", memberId);
        }

        return await Project(db.Loans.AsNoTracking().Where(l => l.MemberId == memberId).OrderByDescending(l => l.StartDate), clock.Today())
            .ToListAsync(cancellationToken);
    }

    [HttpPost]
    [Authorize(Policy = Policies.Staff)]
    public async Task<ActionResult<LoanDto>> Create(LoanRequest request, CancellationToken cancellationToken)
    {
        var item = await db.Items.FindAsync([request.ItemId], cancellationToken) ?? throw new NotFoundException("Item", request.ItemId);
        var member = await db.Members.FindAsync([request.MemberId], cancellationToken) ?? throw new NotFoundException("Member", request.MemberId);
        var start = request.StartDate!.Value;
        var due = request.DueDate!.Value;

        var copiesOut = await db.Loans.CountAsync(
            l => l.ItemId == item.Id && l.ReturnedAt == null && l.StartDate <= due && start <= l.DueDate,
            cancellationToken);
        LendingPolicy.EnsureCanLend(item, start, due, clock.Today(), copiesOut);

        var loan = new Loan
        {
            Item = item,
            Member = member,
            StartDate = start,
            DueDate = due,
            CreatedAt = clock.GetUtcNow(),
        };
        db.Loans.Add(loan);
        await db.SaveChangesAsync(cancellationToken);
        return CreatedAtAction(nameof(Get), new { id = loan.Id }, await Get(loan.Id, cancellationToken));
    }

    [HttpPost("{id:int}/return")]
    [Authorize(Policy = Policies.Staff)]
    public async Task<LoanDto> Return(int id, CancellationToken cancellationToken)
    {
        var loan = await db.Loans.FindAsync([id], cancellationToken) ?? throw new NotFoundException("Loan", id);
        loan.Return(clock.GetUtcNow());
        await db.SaveChangesAsync(cancellationToken);
        return await Get(id, cancellationToken);
    }

    private static IQueryable<LoanDto> Project(IQueryable<Loan> loans, DateOnly today) =>
        loans.Select(l => new LoanDto(
            l.Id,
            l.ItemId,
            l.Item.Name,
            l.MemberId,
            l.Member.Name,
            l.StartDate,
            l.DueDate,
            l.ReturnedAt,
            l.ReturnedAt != null ? LoanState.Returned : l.DueDate < today ? LoanState.Overdue : LoanState.Active));
}
