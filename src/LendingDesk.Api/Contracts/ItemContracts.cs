using System.ComponentModel.DataAnnotations;
using LendingDesk.Domain.Items;

namespace LendingDesk.Api.Contracts;

public sealed record ItemDto(
    int Id,
    string Name,
    string Category,
    string Sku,
    int TotalStock,
    int Available,
    ItemCondition Condition,
    bool IsRetired);

public sealed class ItemQuery : PageQuery
{
    [StringLength(100)]
    public string? Category { get; init; }

    [StringLength(100)]
    public string? Search { get; init; }

    public bool IncludeRetired { get; init; }
}

public sealed class ItemRequest
{
    [Required]
    [StringLength(200, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    [Required]
    [StringLength(100, MinimumLength = 1)]
    public string Category { get; init; } = string.Empty;

    [Required]
    [RegularExpression("^[A-Z0-9-]{3,64}$", ErrorMessage = "SKU is 3-64 upper-case letters, digits or dashes.")]
    public string Sku { get; init; } = string.Empty;

    [Range(0, 10_000)]
    public int TotalStock { get; init; }

    [EnumDataType(typeof(ItemCondition))]
    public ItemCondition Condition { get; init; } = ItemCondition.Good;
}
