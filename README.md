# Lending Desk

A small equipment-lending service: staff lend items to members, track due dates, and a background
worker sends due and overdue notices.

## Layout

| Path | What |
|---|---|
| `src/LendingDesk.Domain` | entities and lending rules |
| `src/LendingDesk.Data` | EF Core `DbContext`, configurations, migrations (PostgreSQL) |
| `src/LendingDesk.Api` | ASP.NET Core API |
| `src/LendingDesk.Worker` | background worker that processes the outbox |
| `tests/` | unit and integration tests (integration tests start PostgreSQL in Docker) |
| `web/` | Angular front end |

## Run it

```bash
docker compose up -d                      # PostgreSQL on localhost:5432 (LENDING_DB_PORT overrides)
dotnet run --project src/LendingDesk.Api  # applies migrations on start in Development
cd web && npm ci && npm start             # http://localhost:4200, proxies /api to the API
```

## Test it

```bash
dotnet build -c Release && dotnet test -c Release --no-build
cd web && npm ci && npm run lint && npm test -- --watch=false
```

Integration tests need Docker running.

## CI and the API image

`.github/workflows/ci.yml` builds and tests the API, builds its container image, and lints, tests and
builds the web app on every push and pull request.

```bash
docker build -f src/LendingDesk.Api/Dockerfile -t lendingdesk-api .
docker run -p 8080:8080 -e ConnectionStrings__Lending='Host=...;Database=lending;Username=...;Password=...' lendingdesk-api
```

The image does not run migrations outside Development; apply them first:

```bash
dotnet tool restore
dotnet ef database update --project src/LendingDesk.Data --connection '<the same connection string>'
```
