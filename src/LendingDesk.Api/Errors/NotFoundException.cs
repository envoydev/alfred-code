namespace LendingDesk.Api.Errors;

public sealed class NotFoundException(string resource, int id) : Exception($"{resource} {id} was not found.");
