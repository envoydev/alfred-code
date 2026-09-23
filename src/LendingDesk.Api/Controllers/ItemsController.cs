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
            .Select(i => new ItemDto(i.Id, i.Name, i.Category, i.Sku, i.TotalStock, i.TotalStock, i.IsRetired))
            .ToPageAsync(query, cancellationToken);
    }

    [HttpGet("{id:int}")]
    public async Task<ItemDto> Get(int id, CancellationToken cancellationToken) =>
        ToDto(await Find(id, cancellationToken));

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
            CreatedAt = clock.GetUtcNow(),
        };
        db.Items.Add(item);
        await db.SaveChangesAsync(cancellationToken);
        return CreatedAtAction(nameof(Get), new { id = item.Id }, ToDto(item));
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
        await db.SaveChangesAsync(cancellationToken);
        return ToDto(item);
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

    private static ItemDto ToDto(Item item) =>
        new(item.Id, item.Name, item.Category, item.Sku, item.TotalStock, item.TotalStock, item.IsRetired);

    private async Task<Item> Find(int id, CancellationToken cancellationToken) =>
        await db.Items.FindAsync([id], cancellationToken) ?? throw new NotFoundException("Item", id);
}
