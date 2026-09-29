using System.Diagnostics;
using System.Reflection;

using LendingDesk.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace LendingDesk.IntegrationTests.Hidden.Cross03;

/// <summary>
/// Runs the real worker: its own Program builds the host (so every service it registers is there), the test
/// database and clock are swapped in the way WebApplicationFactory does it for the API, and the hosted
/// worker loop runs until the outbox has nothing pending. No worker type is named, so any correct worker
/// design compiles and runs.
/// </summary>
public static class Cross03WorkerHost
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(90);

    public static async Task DrainOutboxAsync(string connectionString, TimeProvider clock)
    {
        using var host = await BuildAsync(connectionString, clock);
        await host.StartAsync();
        try
        {
            var watch = Stopwatch.StartNew();
            while (await PendingAsync(connectionString) > 0)
            {
                if (watch.Elapsed > Timeout)
                {
                    throw new TimeoutException($"The worker left outbox messages pending after {Timeout.TotalSeconds} seconds.");
                }

                await Task.Delay(100);
            }
        }
        finally
        {
            await host.StopAsync();
        }
    }

    private static async Task<int> PendingAsync(string connectionString)
    {
        await using var db = new LendingDbContext(new DbContextOptionsBuilder<LendingDbContext>().UseNpgsql(connectionString).Options);
        return await db.OutboxMessages.CountAsync(o => o.ProcessedAt == null);
    }

    private static async Task<IHost> BuildAsync(string connectionString, TimeProvider clock)
    {
        var entryPoint = Assembly.Load(new AssemblyName("LendingDesk.Worker")).EntryPoint
            ?? throw new InvalidOperationException("LendingDesk.Worker has no entry point.");
        var built = new TaskCompletionSource<IHost>(TaskCreationOptions.RunContinuationsAsynchronously);
        var settings = new Dictionary<string, string?>
        {
            ["ConnectionStrings:Lending"] = connectionString,
            ["Worker:PollSeconds"] = "1",
            ["Logging:LogLevel:Default"] = "Warning",
        };

        var thread = new Thread(() =>
        {
            try
            {
                entryPoint.Invoke(null, entryPoint.GetParameters().Length == 0 ? null : [Array.Empty<string>()]);
                built.TrySetException(new InvalidOperationException("The worker's Program returned without building a host."));
            }
            catch (TargetInvocationException ex) when (ex.InnerException is HostAbortedException)
            {
                // Expected: the host was captured and its Run() skipped.
            }
            catch (TargetInvocationException ex)
            {
                built.TrySetException(ex.InnerException ?? ex);
            }
        })
        {
            IsBackground = true,
        };
        var hostThreadId = thread.ManagedThreadId;

        var listenerSubscriptions = new List<IDisposable>();
        using (DiagnosticListener.AllListeners.Subscribe(new Observer<DiagnosticListener>(listener =>
        {
            if (listener.Name != "Microsoft.Extensions.Hosting")
            {
                return;
            }

            listenerSubscriptions.Add(listener.Subscribe(new Observer<KeyValuePair<string, object?>>(pair =>
            {
                if (Environment.CurrentManagedThreadId != hostThreadId)
                {
                    return;
                }

                if (pair.Key == "HostBuilding" && pair.Value is IHostBuilder builder)
                {
                    builder.ConfigureAppConfiguration(config => config.AddInMemoryCollection(settings));
                    builder.ConfigureServices(services =>
                    {
                        services.RemoveAll<TimeProvider>();
                        services.AddSingleton(clock);
                    });
                }
                else if (pair.Key == "HostBuilt" && pair.Value is IHost host)
                {
                    built.TrySetResult(host);
                    throw new HostAbortedException();
                }
            })));
        })))
        {
            thread.Start();
            try
            {
                return await built.Task.WaitAsync(Timeout);
            }
            finally
            {
                foreach (var subscription in listenerSubscriptions)
                {
                    subscription.Dispose();
                }
            }
        }
    }

    private sealed class Observer<T>(Action<T> onNext) : IObserver<T>
    {
        public void OnCompleted()
        {
        }

        public void OnError(Exception error)
        {
        }

        public void OnNext(T value) => onNext(value);
    }
}
