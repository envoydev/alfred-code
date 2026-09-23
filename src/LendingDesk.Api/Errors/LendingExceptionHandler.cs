using LendingDesk.Domain;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LendingDesk.Api.Errors;

/// <summary>Maps the exceptions the API throws on purpose to the problem-details envelope.</summary>
internal sealed class LendingExceptionHandler(IProblemDetailsService problemDetails) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var (status, code, title) = exception switch
        {
            NotFoundException => (StatusCodes.Status404NotFound, "not_found", "Not found"),
            DomainException domain => (StatusCodes.Status409Conflict, domain.Code, "Lending rule violated"),
            DbUpdateException { InnerException: PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } } =>
                (StatusCodes.Status409Conflict, "duplicate", "Duplicate value"),
            _ => (0, string.Empty, string.Empty),
        };
        if (status == 0)
        {
            return false;
        }

        httpContext.Response.StatusCode = status;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            Exception = exception,
            ProblemDetails =
            {
                Status = status,
                Title = title,
                Detail = exception is DbUpdateException ? "A record with the same unique value already exists." : exception.Message,
                Extensions = { ["code"] = code },
            },
        });
    }
}
