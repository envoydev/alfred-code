using LendingDesk.Worker.Outbox;
using LendingDesk.Worker.Reminders;
using Microsoft.Extensions.Options;

namespace LendingDesk.Worker;

public sealed class WorkerOptions
{
    public const string Section = "Worker";

    public int PollSeconds { get; set; } = 10;
}

public sealed partial class LendingWorker(IServiceScopeFactory scopes, IOptions<WorkerOptions> options, ILogger<LendingWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(options.Value.PollSeconds));
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var handled = await scope.ServiceProvider.GetRequiredService<OutboxProcessor>().ProcessPendingAsync(stoppingToken);
                var reminded = await scope.ServiceProvider.GetRequiredService<ReminderScanner>().ScanAsync(stoppingToken);
                if (handled + reminded > 0)
                {
                    LogCycle(logger, handled, reminded);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogCycleFailed(logger, ex);
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Handled {Handled} outbox messages and sent {Reminded} reminders")]
    private static partial void LogCycle(ILogger logger, int handled, int reminded);

    [LoggerMessage(Level = LogLevel.Error, Message = "Worker cycle failed")]
    private static partial void LogCycleFailed(ILogger logger, Exception exception);
}
