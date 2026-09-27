# The Dockerfile shape

Read when writing a new Dockerfile or restructuring one: the rules in SKILL.md's Docker section, in one file.

Multi-stage, cache-ordered, digest-pinned, non-root:

```dockerfile
# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:8.0@sha256:<digest> AS build
WORKDIR /src
COPY ["App/App.csproj", "App/"]
RUN --mount=type=cache,target=/root/.nuget/packages dotnet restore App/App.csproj
COPY . .
RUN --mount=type=cache,target=/root/.nuget/packages dotnet publish App/App.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:8.0-noble-chiseled@sha256:<digest>
WORKDIR /app
COPY --from=build /app .
USER $APP_UID
ENTRYPOINT ["dotnet", "App.dll"]
```

## Multi-arch builds

Build multi-arch images with `buildx --platform linux/amd64,linux/arm64` when developers are on Apple
Silicon but production runs x64 - a locally-built image is otherwise the wrong architecture for the server.
