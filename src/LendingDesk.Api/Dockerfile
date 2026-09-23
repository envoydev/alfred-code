# Build from the repository root: docker build -f src/LendingDesk.Api/Dockerfile -t lendingdesk-api .
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY global.json Directory.Build.props .editorconfig ./
COPY src/LendingDesk.Domain/LendingDesk.Domain.csproj src/LendingDesk.Domain/
COPY src/LendingDesk.Data/LendingDesk.Data.csproj src/LendingDesk.Data/
COPY src/LendingDesk.Api/LendingDesk.Api.csproj src/LendingDesk.Api/
RUN dotnet restore src/LendingDesk.Api/LendingDesk.Api.csproj
COPY src/LendingDesk.Domain/ src/LendingDesk.Domain/
COPY src/LendingDesk.Data/ src/LendingDesk.Data/
COPY src/LendingDesk.Api/ src/LendingDesk.Api/
RUN dotnet publish src/LendingDesk.Api/LendingDesk.Api.csproj -c Release --no-restore -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
# The base image listens on 8080 and ships a non-root user it does not switch to by itself.
USER $APP_UID
# Supply the database as ConnectionStrings__Lending; migrations run only in Development.
EXPOSE 8080
ENTRYPOINT ["dotnet", "LendingDesk.Api.dll"]
