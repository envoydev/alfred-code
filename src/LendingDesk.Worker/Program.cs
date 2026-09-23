using LendingDesk.Data;
using LendingDesk.Worker;
using LendingDesk.Worker.Notices;
using LendingDesk.Worker.Outbox;
using LendingDesk.Worker.Reminders;
using Microsoft.EntityFrameworkCore;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddDbContext<LendingDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Lending")));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.Configure<WorkerOptions>(builder.Configuration.GetSection(WorkerOptions.Section));
builder.Services.AddScoped<NoticeSender>();
builder.Services.AddScoped<OutboxProcessor>();
builder.Services.AddScoped<ReminderScanner>();
builder.Services.AddHostedService<LendingWorker>();

var host = builder.Build();
host.Run();
