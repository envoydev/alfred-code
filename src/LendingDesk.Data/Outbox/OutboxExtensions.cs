using System.Text.Json;

namespace LendingDesk.Data.Outbox;

public static class OutboxExtensions
{
    public static readonly JsonSerializerOptions PayloadOptions = new(JsonSerializerDefaults.Web);

    /// <summary>Adds an event to the outbox; it is saved in the same transaction as the change it describes.</summary>
    public static void Enqueue<T>(this LendingDbContext db, string type, T payload, DateTimeOffset occurredAt)
    {
        ArgumentNullException.ThrowIfNull(db);
        db.OutboxMessages.Add(new OutboxMessage
        {
            Type = type,
            Payload = JsonSerializer.Serialize(payload, PayloadOptions),
            OccurredAt = occurredAt,
        });
    }
}
