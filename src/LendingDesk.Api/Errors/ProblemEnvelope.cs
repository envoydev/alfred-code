using Microsoft.AspNetCore.Mvc;

namespace LendingDesk.Api.Errors;

/// <summary>
/// Every error leaves the API as problem details carrying a stable <c>code</c> and the <c>traceId</c>.
/// </summary>
internal static class ProblemEnvelope
{
    public static void Customize(ProblemDetailsContext context)
    {
        context.ProblemDetails.Extensions["traceId"] = context.HttpContext.TraceIdentifier;
        context.ProblemDetails.Extensions.TryAdd("code", context.ProblemDetails.Status switch
        {
            StatusCodes.Status401Unauthorized => "unauthenticated",
            StatusCodes.Status403Forbidden => "forbidden",
            StatusCodes.Status404NotFound => "not_found",
            _ => "unexpected",
        });
    }

    public static IActionResult InvalidModelState(ActionContext context)
    {
        var problem = new ValidationProblemDetails(context.ModelState)
        {
            Status = StatusCodes.Status400BadRequest,
            Title = "Validation failed",
        };
        problem.Extensions["code"] = "validation_failed";
        problem.Extensions["traceId"] = context.HttpContext.TraceIdentifier;
        return new BadRequestObjectResult(problem) { ContentTypes = { "application/problem+json" } };
    }
}
