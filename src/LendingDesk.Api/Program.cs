using System.Text.Json.Serialization;
using LendingDesk.Api.Errors;
using LendingDesk.Data;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<LendingDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Lending")));
builder.Services.AddSingleton(TimeProvider.System);

builder.Services.AddProblemDetails(options => options.CustomizeProblemDetails = ProblemEnvelope.Customize);
builder.Services.AddExceptionHandler<LendingExceptionHandler>();

builder.Services
    .AddControllers()
    .AddJsonOptions(options => options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()))
    .ConfigureApiBehaviorOptions(options => options.InvalidModelStateResponseFactory = ProblemEnvelope.InvalidModelState);
builder.Services.AddOpenApi();

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<LendingDbContext>().Database.Migrate();
}

app.UseAuthorization();
app.MapControllers();

app.Run();
