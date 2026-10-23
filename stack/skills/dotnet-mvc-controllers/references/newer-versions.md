# Version-gated additions

SKILL.md owns the rules on the .NET 10 / C# 14 floor; this file carries what .NET 9 / 10 changed, each item marked with the runtime it needs, so a project below the floor (.NET 8 / 9) skips the ones its runtime lacks.

- **.NET 9+:** the built-in OpenAPI generator (`AddOpenApi()` / `MapOpenApi()`) covers controllers too and supersedes Swashbuckle - the OpenAPI document skill owns the generator pick and the switch.
- **.NET 10+:** the unified validation APIs move to the `Microsoft.Extensions.Validation` package and OpenAPI generation from controllers improves (form-data enum types, merged XML docs from referenced assemblies). The built-in rule surface moves per release (class-level `IValidatableObject`, async `IAsyncValidatableObject`) - verify the current capability set via the documentation tools before adopting it; the FluentValidation-in-a-filter convention stays the house default regardless (it works below the floor too and keeps one rule language per surface, the pick the web hub owns).
- **.NET 10+:** `IActionContextAccessor` / `ActionContextAccessor` are obsoleted - where an action genuinely needs ambient request context outside its parameter list, inject `IHttpContextAccessor` instead. Preferring an explicit action parameter over either accessor remains the rule.
