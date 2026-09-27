---
name: dotnet-openapi
description: "Use before adding API docs, editing the generated spec, declaring a security scheme, or standing up a Swagger / Scalar docs UI on an ASP.NET Core service - Swashbuckle, NSwag, Microsoft.AspNetCore.OpenApi (AddOpenApi / MapOpenApi), transformers, versioned documents. Floors at .NET 8 / C# 12. Do NOT use for non-HTTP code, internal APIs with no published contract, or the auth pipeline the scheme describes (the .NET authentication skill)."
---

# ASP.NET Core OpenAPI - the document and the docs UI

Two concerns this skill owns together: a faithful machine-readable description of the API, and a docs UI a human can click through. The endpoint declarations it is generated from belong to whichever skill covers your endpoint surface. Floor .NET 8 / C# 12. The discipline under everything: the document is generated, never hand-written - shape the endpoints and metadata, and let the pipeline derive the spec.

**Each rule below is one line; `references/openapi-in-full.md` carries it with its reason and worked code (the .NET 10 wiring end to end included) - read it before wiring a generator, a security scheme, or a consumer's generated types.**

## The rules
- **One generator, by framework floor:** .NET 8 - Swashbuckle (`AddSwaggerGen`, `UseSwagger`; NSwag only when the same toolchain generates clients); .NET 9+ - the built-in `Microsoft.AspNetCore.OpenApi` (`AddOpenApi()`, `MapOpenApi()` at `/openapi/v1.json`). Never two side by side; an existing project keeps its generator. The `Microsoft.OpenApi` model types move per major - fetch the current transformer sample through the documentation server for any target but .NET 10.
- **Accurate schemas:** `TypedResults`, never untyped `Results`; every outcome declared (`.Produces<T>()`, `.ProducesValidationProblem()`, `.ProducesProblem(404)`) - the `ProblemDetails` bodies are the HTTP error-handling skill's; XML doc comments with `<GenerateDocumentationFile>` AND the generator wired to read them (the built-in one reads them from .NET 10 - confirm the gate through `documentation`); `.WithName()` on every endpoint (the client's method names).
- **Transformers, not mutation:** document, operation and schema transformers on the built-in generator (`IDocumentFilter` / `IOperationFilter` / `ISchemaFilter` on Swashbuckle); `.WithOpenApi(...)` is deprecated from .NET 10 - move it into an operation transformer.
- **Security schemes:** a document transformer (or `AddSecurityDefinition` + `AddSecurityRequirement`) declares the scheme the app actually enforces - documentation only; the pipeline is the .NET authentication skill's.
- **Versions and groups:** one document per version (`AddOpenApi("v1")`, `.WithGroupName("v1")`); the versioning strategy is the web hub's.
- **The UI:** Scalar (`Scalar.AspNetCore`, `MapScalarApiReference()`) on any runtime, Swagger UI only on a committed Swashbuckle stack; gated to Development or behind `.RequireAuthorization()`; a prefilled token only ever a throwaway dev one; no request proxy for a sensitive API.
- **Consumers generate their types** from the document emitted at build (`Microsoft.Extensions.ApiDescription.Server`, `<OpenApiGenerateDocumentsOnBuild>`) - the openapi-typescript CLI for types, NSwag or Kiota for a client; generated output is never edited, left out of coverage, and regenerated in CI with a diff check.

## Prove the document

Run the app, fetch the document, and quote two results: the `paths` count against the endpoints expected, and one operation's `summary` and response schema. An empty `summary` is the XML wiring missing; a missing path is an endpoint the generator cannot see.
