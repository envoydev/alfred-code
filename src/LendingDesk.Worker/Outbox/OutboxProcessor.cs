using System.Text.Json;
using LendingDesk.Data;
using LendingDesk.Data.Outbox;
using LendingDesk.Domain.Events;
using LendingDesk.Domain.Notices;
using LendingDesk.Worker.Notices;
using Microsoft.EntityFrameworkCore;

namespace LendingDesk.Worker.Outbox;

/// <summary>Handles the events the API left in the outbox, oldest first.</summary>
public sealed partial class OutboxProcessor(LendingDbContext db, NoticeSender notices, TimeProvider clock, ILogger<OutboxProcessor> logger)
{
    public const int BatchSize = 50;

    /// <summary>A message that failed this many times is set aside with its last error.</summary>
    public const int MaxAttempts = 5;

    /// <returns>How many messages were handled successfully.</returns>
    public async Task<int> ProcessPendingAsync(CancellationToken cancellationToken)
    {
        var pending = await db.OutboxMessages
            .Where(o => o.ProcessedAt == null)
            .OrderBy(o => o.Id)
            .Take(BatchSize)
            .ToListAsync(cancellationToken);

        var handled = 0;
        foreach (var message in pending)
        {
            try
            {
                await HandleAsync(message, cancellationToken);
                message.ProcessedAt = clock.GetUtcNow();
                message.LastError = null;
                handled++;
            }
            catch (Exception ex) when (ex is JsonException or InvalidOperationException or DbUpdateException)
            {
                message.Attempts++;
                message.LastError = ex.Message.Length > 2000 ? ex.Message[..2000] : ex.Message;
                if (message.Attempts >= MaxAttempts)
                {
                    message.ProcessedAt = clock.GetUtcNow();
                    LogGaveUp(logger, message.Id, message.Type, message.Attempts, ex);
                }
                else
                {
                    LogFailed(logger, message.Id, message.Type, message.Attempts, ex);
                }
            }

            await db.SaveChangesAsync(cancellationToken);
        }

        return handled;
    }

    private Task<bool> HandleAsync(OutboxMessage message, CancellationToken cancellationToken) => message.Type switch
    {
        EventTypes.LoanCreated => notices.SendAsync(Read<LoanCreated>(message).LoanId, NoticeKind.Confirmation, cancellationToken),
        EventTypes.LoanReturned => notices.SendAsync(Read<LoanReturned>(message).LoanId, NoticeKind.ReturnReceipt, cancellationToken),
        _ => throw new InvalidOperationException($"No handler for outbox message type '{message.Type}'."),
    };

    private static T Read<T>(OutboxMessage message) =>
        JsonSerializer.Deserialize<T>(message.Payload, OutboxExtensions.PayloadOptions)
        ?? throw new JsonException($"Outbox message {message.Id} has an empty payload.");

    [LoggerMessage(Level = LogLevel.Warning, Message = "Outbox message {Id} ({Type}) failed on attempt {Attempts}")]
    private static partial void LogFailed(ILogger logger, long id, string type, int attempts, Exception exception);

    [LoggerMessage(Level = LogLevel.Error, Message = "Outbox message {Id} ({Type}) set aside after {Attempts} attempts")]
    private static partial void LogGaveUp(ILogger logger, long id, string type, int attempts, Exception exception);
}
