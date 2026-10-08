---
name: devops
description: "Load when authoring or reviewing a Dockerfile, compose file, workflow, deploy pipeline or env/secret template. Not for app or schema code or the Aspire AppHost."
---

# DevOps - containers, CI/CD, and safe deploys for the .NET/Angular house

For any action, image, or tool flag not pinned down here, resolve it with the `alfred-documentation` MCP rather than memory.

The pipeline is production code - a broken workflow blocks every merge and a leaked secret is an incident, not a warning. This is the delivery-surface map for the house stacks (ASP.NET Core, Angular, and their SQL/data layer). With no companion skill present for orchestration, migrations or hardening, the rules here are the whole guidance and any check one would have run is reported UNVERIFIED. The rule under all of it - the build is reproducible, the secret never touches an image or a log, and every deploy is reversible.

## When to use

Load when authoring or reviewing a Dockerfile, a compose file, a workflow, a deploy pipeline, or an env/secret template - also on a delivery-stack review of the pipeline itself.

Scoped to .NET / Angular / SQL delivery surfaces - on another runtime take the container and pipeline rules and treat the examples as illustrative - and organized by the surface a change touches: container builds, Compose local topology, GitHub Actions CI/CD, and safe deploys (immutable artifact promotion, gated expand-contract migrations, health-gated cutover with rollback).

Do NOT load for application or schema code, or for editing the Aspire AppHost itself (the .NET orchestration skill owns it).

## Docker - reproducible, minimal, non-root

- Multi-stage build - an SDK stage compiles and publishes, a slim runtime stage copies only the published output; the SDK image never ships.
- Order the layers for the cache - copy the project and lock files and restore BEFORE copying the source, so a source edit does not bust the restore layer. A Dockerfile that copies everything then restores never hits the cache.
- Mount a persistent package cache in the restore layer - `RUN --mount=type=cache,target=/root/.nuget/packages dotnet restore` (and the npm cache) - so the cache survives even when the copy-lockfile-then-restore layer is busted.
- When a build genuinely needs a secret - a private NuGet-feed PAT during restore - pass it with `RUN --mount=type=secret,id=...` so it never lands in a layer or image history, distinct from the runtime secrets pulled from the store.
- Pin the base image by digest, never a floating :latest or a bare major tag - a moving tag makes the build non-reproducible and is a supply-chain hole. Prefer a chiseled or distroless .NET runtime image (no shell, minimal CVE surface).
- Pin the BuildKit frontend on the Dockerfile's first line - `# syntax=docker/dockerfile:1` (to a digest for a fully locked build) - so an untrusted or moving frontend cannot run build-time code you never vetted; and treat `buildx` `--sbom` / `--provenance` attestations as metadata, not signatures - sign the image with cosign if you need provenance you can verify.
- Build multi-arch images with `buildx --platform linux/amd64,linux/arm64` when developers are on Apple Silicon but production runs x64 - a locally-built image is otherwise the wrong architecture for the server.
- Run as a non-root USER, mount the root filesystem read-only where the app allows, and keep a .dockerignore that excludes bin, obj, node_modules, .git, and every secret-bearing file.
- Harden past non-root at runtime - drop all Linux capabilities, set no-new-privileges, cap memory / CPU / PID count, and keep the default seccomp profile plus an AppArmor or SELinux profile instead of reaching for `--privileged`, so a compromised or leaking process cannot escalate, exhaust PIDs, or starve the host. The full checklist with the compose keys: `references/docker-hardening.md`.
- Give the container a health check and proper PID-1 signal handling (an init shim) so the orchestrator can tell ready from dead and a SIGTERM drains rather than kills. A chiseled or distroless image has no shell and no `curl`, so `HEALTHCHECK CMD curl ...` cannot run there: under Kubernetes use the orchestrator's HTTP probe against the app's health endpoint; where Docker or Compose judges health itself, publish a small probe executable (GET the URL, exit 0 on a 2xx, 1 otherwise) in the build stage and call it in exec form, as below.

The shape in one Dockerfile - multi-stage, cache-ordered, digest-pinned, non-root, health-checked:

```dockerfile
# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:8.0@sha256:<digest> AS build
WORKDIR /src
COPY ["App/App.csproj", "App/"]
RUN --mount=type=cache,target=/root/.nuget/packages dotnet restore App/App.csproj
COPY . .
RUN --mount=type=cache,target=/root/.nuget/packages dotnet publish App/App.csproj -c Release -o /app
RUN --mount=type=cache,target=/root/.nuget/packages dotnet publish HealthProbe/HealthProbe.csproj -c Release -o /probe

FROM mcr.microsoft.com/dotnet/aspnet:8.0-noble-chiseled@sha256:<digest>
WORKDIR /app
COPY --from=build /app .
COPY --from=build /probe /probe
USER $APP_UID
HEALTHCHECK --interval=30s --timeout=3s CMD ["dotnet", "/probe/HealthProbe.dll", "http://localhost:8080/healthz"]
ENTRYPOINT ["dotnet", "App.dll"]
```

## Compose - local topology, not a secret store

- Express service dependencies with a health condition, and give every backing service (Postgres, SQL Server, Redis) its own healthcheck, so a dependent waits for ready and not merely started.
- Keep state in named volumes; never bind-mount or inline a secret in the compose file - pull it from a gitignored env-file that never enters source control.
- Segment the network - put backing services on an `internal: true` network with no published host ports, expose only the edge service and bind its port to `127.0.0.1` rather than `0.0.0.0`, and give each service only the networks it needs - two services that never talk share no network - so a compromised service cannot reach the rest. Before reaching for a driver-level switch to do it, read the inter-container-traffic section of `references/docker-hardening.md`: the obvious knobs do not mean what they look like.

## GitHub Actions - the CI/CD contract

Pin every third-party action to a full commit SHA, keep secrets in GitHub Secrets behind a least-privilege `permissions` block, and federate to the cloud with OIDC; the full contract - job graph, lockfile-keyed caches, real service containers, the scan stage, timeouts, concurrency, failure artifacts - is `references/github-actions.md`. Read it before writing or reviewing a workflow.

## Deploy and release - reversible and health-gated

One immutable artifact promoted through the environments, migrations as a gated step before the app rolls, a health-gated cutover, every deploy with a rollback path, secrets pulled at runtime and never baked in; the mechanics are `references/deploy.md`. Read it before writing or reviewing a deploy step.

## Prove the pipeline change

A workflow that parses is not a workflow that runs. Before any done word on a change here:

1. `docker build` on the Dockerfile you touched - an image that does not build is the whole finding.
2. `actionlint` on the workflow you touched.
3. `gitleaks` over the diff.

Quote each result line. Where a tool is not installed, name it and report that leg UNVERIFIED rather than skipping it silently.

## .NET Aspire - orchestration

- The Aspire AppHost is the composition root for the local run; service discovery and connection strings flow through it, not hardcoded per service. This house deploys through CI and container tooling; `aspire publish` and `aspire deploy` exist, and adopting them is a deliberate pipeline decision, never a default - one this skill makes with the pipeline, never a side effect of adding an AppHost. Depth belongs to the skill covering local cloud-native orchestration, where the install has it; without it, the rules in this section are the whole guidance.
