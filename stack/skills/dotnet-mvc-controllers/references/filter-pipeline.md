# Where an action filter sits, and how filters order

Where filters live in the request pipeline, outermost first: authorization filters, then resource filters, then model binding, then **action filters**, then the action, then result filters; exception filters wrap unhandled action faults. An action filter therefore sees bound arguments but runs inside authorization - it is the wrong place for an auth decision (that is `[Authorize]`, configured by the authentication skill).

Filter **ordering** is two-dimensional. By default, scope decides: global filters wrap controller filters wrap action filters - so a global filter's *before* runs first and its *after* runs last. To override that, implement `IOrderedFilter` and set `Order`; a lower `Order` runs its before-code earlier and its after-code later, and `Order` always beats scope. Register a filter globally in `AddControllers(o => o.Filters.Add<T>())`, or attach it as an attribute on a controller or action for narrower scope.
