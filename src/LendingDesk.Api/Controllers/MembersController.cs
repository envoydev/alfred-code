using LendingDesk.Api.Auth;
using LendingDesk.Api.Contracts;
using LendingDesk.Api.Errors;
using LendingDesk.Data;
using LendingDesk.Domain.Members;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LendingDesk.Api.Controllers;

[ApiController]
[Route("api/members")]
public sealed class MembersController(LendingDbContext db, TimeProvider clock) : ControllerBase
{
    [HttpGet]
    public Task<PagedResult<MemberDto>> List([FromQuery] MemberQuery query, CancellationToken cancellationToken)
    {
        var members = db.Members.AsNoTracking();
        if (query.Status is { } status)
        {
            members = members.Where(m => m.Status == status);
        }

        return members
            .OrderBy(m => m.Name)
            .ThenBy(m => m.Id)
            .Select(m => new MemberDto(m.Id, m.Name, m.Email, m.Status, m.CreatedAt))
            .ToPageAsync(query, cancellationToken);
    }

    [HttpGet("{id:int}")]
    public async Task<MemberDto> Get(int id, CancellationToken cancellationToken) =>
        MemberDto.From(await Find(id, cancellationToken));

    [HttpPost]
    [Authorize(Policy = Policies.Staff)]
    public async Task<ActionResult<MemberDto>> Create(MemberRequest request, CancellationToken cancellationToken)
    {
        var member = new Member
        {
            Name = request.Name.Trim(),
            Email = request.Email.Trim().ToLowerInvariant(),
            CreatedAt = clock.GetUtcNow(),
        };
        db.Members.Add(member);
        await db.SaveChangesAsync(cancellationToken);
        return CreatedAtAction(nameof(Get), new { id = member.Id }, MemberDto.From(member));
    }

    [HttpPut("{id:int}")]
    [Authorize(Policy = Policies.Staff)]
    public async Task<MemberDto> Update(int id, MemberRequest request, CancellationToken cancellationToken)
    {
        var member = await Find(id, cancellationToken);
        member.Name = request.Name.Trim();
        member.Email = request.Email.Trim().ToLowerInvariant();
        await db.SaveChangesAsync(cancellationToken);
        return MemberDto.From(member);
    }

    [HttpPost("{id:int}/suspend")]
    [Authorize(Policy = Policies.Admin)]
    public async Task<MemberDto> Suspend(int id, CancellationToken cancellationToken)
    {
        var member = await Find(id, cancellationToken);
        member.Suspend();
        await db.SaveChangesAsync(cancellationToken);
        return MemberDto.From(member);
    }

    private async Task<Member> Find(int id, CancellationToken cancellationToken) =>
        await db.Members.FindAsync([id], cancellationToken) ?? throw new NotFoundException("Member", id);
}
