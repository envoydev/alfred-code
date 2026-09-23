using System.Text.Json.Serialization;
using LendingDesk.Api.Auth;
using LendingDesk.Api.Errors;
using LendingDesk.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<LendingDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Lending")));
builder.Services.AddSingleton(TimeProvider.System);

builder.Services
    .AddAuthentication(DemoHeaderAuthenticationHandler.SchemeName)
    .AddScheme<AuthenticationSchemeOptions, DemoHeaderAuthenticationHandler>(DemoHeaderAuthenticationHandler.SchemeName, null);
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build())
    .AddPolicy(Policies.Staff, policy => policy.RequireRole(Roles.Staff, Roles.Admin))
    .AddPolicy(Policies.Admin, policy => policy.RequireRole(Roles.Admin));

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
    app.MapOpenApi().AllowAnonymous();
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<LendingDbContext>().Database.Migrate();
}

app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.Run();
