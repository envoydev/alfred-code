# Cross-cutting concerns live in interceptors

Read when adding logging, an auth check, exception-to-status mapping, validation or metrics to a service or a client.

## Cross-cutting concerns live in interceptors
Put logging, authentication checks, exception-to-status mapping, validation, and metrics in `Interceptor` subclasses (server and client side), not copied into every method.
- A **server interceptor** is the single place to log calls with their method and status, translate an unhandled exception into a clean `Internal`/mapped status, and enforce request-level concerns - the gRPC analogue of middleware.
- A **client interceptor** is where you stamp outgoing metadata (auth tokens, correlation IDs) and observe call outcomes uniformly.
- Register server interceptors in `AddGrpc(o => o.Interceptors.Add<T>())`; add client interceptors via `.AddInterceptor<T>()` on the client registration.
