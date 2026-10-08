# `ApiBehaviorOptions` - when an action keeps the built-in 400

The house path suppresses `ModelStateInvalidFilter` and lets the FluentValidation filter own the one 400 envelope. These are the related knobs for an action that keeps the built-in path instead:

- `InvalidModelStateResponseFactory` - the delegate that builds the automatic 400. Override it to reshape the body or log the failure; by default it uses `ProblemDetailsFactory` to emit a `ValidationProblemDetails`.
- `SuppressMapClientErrors` - stops `[ApiController]` from converting bare error status codes (a `NotFound()` with no body) into `ProblemDetails`. Leave it off; the mapping is what gives every 4xx/5xx an RFC-shaped body for free.
- If you do keep model-state validation on a given action and need a *custom* 400 that matches the automatic one, call `ValidationProblem()` (which returns a `ValidationProblemDetails`), never `BadRequest(...)` with an ad-hoc object - that is how the two paths stay shape-consistent.
