using System.Text.Json.Serialization;
using Api.Orders;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddSingleton<IOrderStore, InMemoryOrderStore>();
builder.Services.AddAuthentication().AddBearerToken();
builder.Services.AddAuthorization(options =>
    options.AddPolicy(OrderPolicies.RefundsApprover, policy => policy.RequireAuthenticatedUser().RequireRole(OrderPolicies.RefundsApproverRole)));

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();

app.MapOrders();

app.Run();

/// <summary>The entry point, public so the tests' <c>WebApplicationFactory</c> can host it.</summary>
public partial class Program;
