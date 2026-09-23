using LendingDesk.Api.Auth;
using LendingDesk.Api.Contracts;
using LendingDesk.Api.Errors;
using LendingDesk.Data;
using LendingDesk.Domain.Items;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LendingDesk.Api.Controllers;

[ApiController]
[Route("api/items")]
public sealed class ItemsController(LendingDbContext db, TimeProvider clock) : ControllerBase
{
    [HttpGet]
    public Task<PagedResult<ItemDto>> List([FromQuery] ItemQuery query, CancellationToken cancellationToken)
    {
        var today = clock.Today();
        var items = db.Items.AsNoTracking();
        if (!query.IncludeRetired)
        {
            items = items.Where(i => !i.IsRetired);
        }

        if (!string.IsNullOrWhiteSpace(query.Category))
        {
            items = items.Where(i => i.Category == query.Category);
        }

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            items = items.Where(i => EF.Functions.ILike(i.Name, $"%{query.Search}%"));
        }

        return items
            .OrderBy(i => i.Name)
            .ThenBy(i => i.Id)
            .Select(i => new ItemDto(
                i.Id,
                i.Name,
                i.Category,
                i.Sku,
                i.TotalStock,
                i.TotalStock - db.Loans.Count(l => l.ItemId == i.Id && l.ReturnedAt == null && l.StartDate <= today),
                i.Condition,
                i.IsRetired))
            .ToPageAsync(query, cancellationToken);
    }

    [HttpGet("{id:int}")]
    public async Task<ItemDto> Get(int id, CancellationToken cancellationToken) =>
        await ToDto(await Find(id, cancellationToken), cancellationToken);

    [HttpPost]
    [Authorize(Policy = Policies.Staff)]
    public async Task<ActionResult<ItemDto>> Create(ItemRequest request, CancellationToken cancellationToken)
    {
        var item = new Item
        {
            Name = request.Name.Trim(),
            Category = request.Category.Trim(),
            Sku = request.Sku,
            TotalStock = request.TotalStock,
            Condition = request.Condition,
            CreatedAt = clock.GetUtcNow(),
        };
        db.Items.Add(item);
        await db.SaveChangesAsync(cancellationToken);
        return CreatedAtAction(nameof(Get), new { id = item.Id }, await ToDto(item, cancellationToken));
    }

    [HttpPut("{id:int}")]
    [Authorize(Policy = Policies.Staff)]
    public async Task<ItemDto> Update(int id, ItemRequest request, CancellationToken cancellationToken)
    {
        var item = await Find(id, cancellationToken);
        item.Name = request.Name.Trim();
        item.Category = request.Category.Trim();
        item.Sku = request.Sku;
        item.TotalStock = request.TotalStock;
        item.Condition = request.Condition;
        await db.SaveChangesAsync(cancellationToken);
        return await ToDto(item, cancellationToken);
    }

    [HttpDelete("{id:int}")]
    [Authorize(Policy = Policies.Admin)]
    public async Task<IActionResult> Retire(int id, CancellationToken cancellationToken)
    {
        var item = await Find(id, cancellationToken);
        item.Retire();
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    private async Task<ItemDto> ToDto(Item item, CancellationToken cancellationToken)
    {
        var today = clock.Today();
        var lentOut = await db.Loans.CountAsync(l => l.ItemId == item.Id && l.ReturnedAt == null && l.StartDate <= today, cancellationToken);
        return new ItemDto(item.Id, item.Name, item.Category, item.Sku, item.TotalStock, item.TotalStock - lentOut, item.Condition, item.IsRetired);
    }

    private async Task<Item> Find(int id, CancellationToken cancellationToken) =>
        await db.Items.FindAsync([id], cancellationToken) ?? throw new NotFoundException("Item", id);
}
