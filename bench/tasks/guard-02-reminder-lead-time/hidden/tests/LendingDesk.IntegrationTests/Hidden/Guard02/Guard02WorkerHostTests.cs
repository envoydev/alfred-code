using System.Diagnostics;
using System.Reflection;
using LendingDesk.IntegrationTests.Infrastructure;
using LendingDesk.Worker.Notices;
using LendingDesk.Worker.Reminders;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace LendingDesk.IntegrationTests.Hidden.Guard02;

/// <summary>
/// Runs the worker's own Program against its own settings files, stops it as soon as its host is
/// built (the way WebApplicationFactory stops an API), and reads what the host resolved.
/// </summary>
[Collection(DatabaseGroup.Name)]
public sealed class Guard02WorkerHostTests
{
    private static readonly string WorkerDirectory = Path.Combine(FindRoot(), "src", "LendingDesk.Worker");

    private static string FindRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "LendingDesk.slnx")))
            {
                return dir.FullName;
            }
        }

        throw new InvalidOperationException("Could not find the repository root (LendingDesk.slnx).");
    }

    private static T FromWorkerHost<T>(string environment, Func<IServiceProvider, T> read, params string[] extraArgs)
    {
        string[] args =
        [
            "--contentRoot", WorkerDirectory,
            "--environment", environment,
            "--hostBuilder:reloadConfigOnChange", "false",
            "--ConnectionStrings:Lending", "Host=localhost;Database=hidden_guard02",
            .. extraArgs,
        ];
        using var capture = new HostCapture<T>(read);
        return capture.Run(typeof(ReminderScanner).Assembly, args);
    }

    private static NoticeOptions LeadTime(IServiceProvider services) =>
        services.GetRequiredService<IOptions<NoticeOptions>>().Value;

    [Fact]
    public void Outside_development_the_worker_reads_a_lead_time_of_1()
    {
        var options = FromWorkerHost("Production", LeadTime);

        Assert.True(options.DueSoonDays == 1, $"DueSoonDays was {options.DueSoonDays}.");
    }

    [Fact]
    public void In_development_the_worker_reads_a_lead_time_of_2()
    {
        var options = FromWorkerHost("Development", LeadTime);

        Assert.True(options.DueSoonDays == 2, $"DueSoonDays was {options.DueSoonDays}.");
    }

    [Fact]
    public void The_worker_binds_the_lead_time_from_Notices_DueSoonDays()
    {
        var options = FromWorkerHost("Production", LeadTime, "--Notices:DueSoonDays", "6");

        Assert.True(options.DueSoonDays == 6, $"DueSoonDays was {options.DueSoonDays}.");
    }

    [Fact]
    public void The_worker_host_builds_the_reminder_scanner()
    {
        var built = FromWorkerHost("Development", services =>
        {
            using var scope = services.CreateScope();
            return scope.ServiceProvider.GetRequiredService<ReminderScanner>() is not null;
        });

        Assert.True(built);
    }

    private sealed class HostCapture<T>(Func<IServiceProvider, T> read)
        : IObserver<DiagnosticListener>, IObserver<KeyValuePair<string, object?>>, IDisposable
    {
        private static readonly AsyncLocal<object?> Active = new();
        private readonly List<IDisposable> _subscriptions = [];
        private bool _built;
        private T _result = default!;

        public T Run(Assembly program, string[] args)
        {
            var entryPoint = program.EntryPoint ?? throw new InvalidOperationException($"{program.GetName().Name} has no entry point.");
            lock (_subscriptions)
            {
                _subscriptions.Add(DiagnosticListener.AllListeners.Subscribe(this));
            }

            Active.Value = this;
            try
            {
                var returned = entryPoint.Invoke(null, entryPoint.GetParameters().Length == 0 ? null : [args]);
                if (returned is Task task)
                {
                    task.GetAwaiter().GetResult();
                }
            }
            catch (TargetInvocationException ex) when (ex.InnerException is HostAbortedException)
            {
            }
            catch (HostAbortedException)
            {
            }
            finally
            {
                Active.Value = null;
            }

            Assert.True(_built, "The worker's Program finished without building its host.");
            return _result;
        }

        public void OnNext(DiagnosticListener value)
        {
            if (value.Name == "Microsoft.Extensions.Hosting")
            {
                lock (_subscriptions)
                {
                    _subscriptions.Add(value.Subscribe(this));
                }
            }
        }

        public void OnNext(KeyValuePair<string, object?> value)
        {
            if (!ReferenceEquals(Active.Value, this) || value.Key != "HostBuilt" || value.Value is not IHost host)
            {
                return;
            }

            try
            {
                _result = read(host.Services);
                _built = true;
            }
            finally
            {
                host.Dispose();
            }

            throw new HostAbortedException();
        }

        public void OnCompleted()
        {
        }

        public void OnError(Exception error)
        {
        }

        public void Dispose()
        {
            lock (_subscriptions)
            {
                foreach (var subscription in _subscriptions)
                {
                    subscription.Dispose();
                }

                _subscriptions.Clear();
            }
        }
    }
}
