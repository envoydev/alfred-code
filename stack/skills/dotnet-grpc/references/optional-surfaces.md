# gRPC optional surfaces

SKILL.md owns the core service and client conventions; these surfaces are opt-in.

## The gRPC health-checking protocol

- Expose the standard gRPC health-checking protocol (`Grpc.AspNetCore.HealthChecks`) and wire it to orchestrator probes - Kubernetes can health-check gRPC natively, so the liveness/readiness gate speaks the same protocol as the service.

## Browsers can't speak raw gRPC - use gRPC-Web

A browser cannot make a raw gRPC/HTTP-2 call (no access to the required frames), so a browser client needs **gRPC-Web**: enable `UseGrpcWeb()` on the server (and `.EnableGrpcWeb()` per service or globally), give the JS/TS client the gRPC-Web transport, and configure CORS to expose the gRPC-specific headers. Note gRPC-Web does not support client or bidirectional streaming - live bidirectional browser push is SignalR, owned by the skill covering real-time server push. Service-to-service traffic stays on plain gRPC where HTTP/2 is end to end.
