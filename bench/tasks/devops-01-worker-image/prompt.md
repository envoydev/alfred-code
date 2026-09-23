The worker has no container image yet. Please add one, the same way the API has one, and build it in CI next to the API image.

The image:

- Lives at `src/LendingDesk.Worker/Dockerfile` and builds from the repository root with `docker build -f src/LendingDesk.Worker/Dockerfile -t lendingdesk-worker .`
- Multi-stage: the .NET 10 SDK image restores and publishes the worker in Release, and the final image carries only the published output, in `/app` - no SDK and no source code.
- The worker serves no HTTP, so the final stage is based on the plain .NET runtime image (`mcr.microsoft.com/dotnet/runtime:10.0`), not the ASP.NET one, and the image exposes no port.
- It runs as the non-root user the .NET base images ship, like the API image does.
- Working directory `/app`, entry point `["dotnet", "LendingDesk.Worker.dll"]`.
- Configuration comes from the environment, as with the API image: `ConnectionStrings__Lending` for the database and `Worker__PollSeconds` for the poll interval. The image does not run migrations. Pointed at a migrated database, the container processes the outbox and sends reminders just as `dotnet run --project src/LendingDesk.Worker` does. With no database reachable it keeps running and logs the failed cycles instead of exiting.

CI: add a `worker-image` job to `.github/workflows/ci.yml`, shaped like the `api-image` job (same runner, same checkout step), that runs exactly the build command above. Leave the other jobs as they are.

README: add the worker image's build and run commands next to the API image's.
