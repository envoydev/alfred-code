---
name: dotnet-openapi
description: "Use before adding API docs, editing the spec or standing up Swagger/Scalar on ASP.NET Core - Swashbuckle, NSwag, AddOpenApi. Not for non-HTTP code or auth."
---

# ASP.NET Core OpenAPI - the document and the docs UI

OpenAPI is two separate concerns that get conflated: producing a faithful machine-readable description of the API, and rendering that description as something a human can click through. This skill owns both. The endpoint declarations the document is generated *from* - route groups, filters, `.WithName()`, the typed results - belong to whichever skill covers your endpoint surface; here we assume those exist and concentrate on turning them into an accurate spec and a usable UI. Floor is .NET 8 / C# 12.

The single discipline that runs through everything below: the document is generated, never hand-written. You shape the endpoints and the metadata, and the pipeline derives the spec. A spec edited by hand drifts from the running code the first time anyone forgets to update it.

## When to use

- Also fires on: editing the generated spec, declaring a security scheme, transformers, versioned documents, MapOpenApi.
- Do NOT use for non-HTTP code, internal APIs with no published contract, or the auth pipeline the scheme describes (the .NET authentication skill).

## Pick one generator, by framework floor

- **On .NET 8**, use Swashbuckle - `AddSwaggerGen()` at startup, `UseSwagger()` to expose the JSON. Reach for NSwag instead only when the same toolchain must also generate strongly-typed clients (C# or TypeScript) from the spec; that client story is NSwag's reason to exist. For a service that just publishes a contract, Swashbuckle is the lighter default.
- **On .NET 9 and up**, prefer the framework's own `Microsoft.AspNetCore.OpenApi`: `builder.Services.AddOpenApi()` and `app.MapOpenApi()`, which serves the document at `/openapi/v1.json`. It is maintained in lockstep with the framework, carries no third-party dependency, and generates at build or first request without Swashbuckle's reflection overhead. This is the choice for any new .NET 9+ service.
- Do not run two generators side by side, and do not migrate an existing project's generator without a concrete reason - a project already on Swashbuckle stays on Swashbuckle until there's a payoff. Match what the repo already does.

Built-in wiring, the common path end to end - a document transformer adds the bearer scheme, `MapOpenApi` serves the JSON, and Scalar renders it behind a dev gate. The model types follow the `Microsoft.OpenApi` major the framework ships (1.x on .NET 9, 2.x on .NET 10, 3.x on .NET 11), so the snippet below is the .NET 10 shape; for any other target fetch the current transformer sample through the documentation server rather than adapting it by hand:
```csharp
using Microsoft.OpenApi;   // 2.x on .NET 10; 1.x (.NET 9) uses Microsoft.OpenApi.Models

builder.Services.AddOpenApi("v1", options =>
{
    options.AddDocumentTransformer((document, context, ct) =>
    {
        document.Components ??= new OpenApiComponents();
        document.Components.SecuritySchemes = new Dictionary<string, IOpenApiSecurityScheme>
        {
            ["Bearer"] = new OpenApiSecurityScheme
            {
                Type = SecuritySchemeType.Http,
                Scheme = "bearer",
                BearerFormat = "JWT",
            },
        };
        return Task.CompletedTask;
    });
});

var app = builder.Build();
app.MapOpenApi();                    // document at /openapi/v1.json
if (app.Environment.IsDevelopment())
    app.MapScalarApiReference();     // UI at /scalar, dev only
```

## Make the schemas accurate

A document is only as good as the type information it can see, and most thin specs are thin because the endpoints hide their types.

- Return `TypedResults` from handlers, not the untyped `Results`. `TypedResults.Ok<T>()`, `TypedResults.Created<T>()`, `TypedResults.ValidationProblem()` each carry the payload type and the status code into the document; `Results.Ok()` returns `IResult` and infers nothing. This is also the house minimal-API default, so it usually comes for free.
- Declare every outcome an endpoint can produce with `.Produces<T>(StatusCodes.Status200OK)`, `.ProducesValidationProblem()`, `.ProducesProblem(StatusCodes.Status404NotFound)`, and so on. The error bodies are RFC 9457 `ProblemDetails`, owned by the skill covering HTTP error handling; the metadata here just advertises which statuses appear.
- Write XML doc comments (`<summary>`, `<param>`, `<returns>`) and set `<GenerateDocumentationFile>true</GenerateDocumentationFile>`, then wire the generator to read them - the property alone only writes the XML file, it does not put anything in the spec. On Swashbuckle (.NET 8) the wiring is `o.IncludeXmlComments(Path.Combine(AppContext.BaseDirectory, $"{Assembly.GetExecutingAssembly().GetName().Name}.xml"))` inside `AddSwaggerGen`. The built-in `Microsoft.AspNetCore.OpenApi` generator reads XML comments from .NET 10; on .NET 9 the file is produced and ignored, so the summaries never reach the document. Confirm the current gate through `documentation` before relying on it. Either way the XML pipeline reads named methods, not inline lambdas - one more reason endpoints should delegate to named handler methods rather than carrying their bodies in the route registration.

## Shape the document with transformers

When the generated spec needs adjusting - a server URL, a global response, consistent tags, a tweaked schema - reach for a transformer rather than mutating output.

- **Built-in (.NET 9+):** three composable hooks. `IOpenApiDocumentTransformer` (or `.AddDocumentTransformer(...)`) for whole-document edits like info, servers, and security; operation transformers via `.AddOperationTransformer(...)` for per-endpoint tags and shared responses; schema transformers for type-level adjustments. They run in registration order and stack cleanly.
- **Swashbuckle (.NET 8):** the same three levels are `IDocumentFilter`, `IOperationFilter`, and `ISchemaFilter`, registered inside `AddSwaggerGen(o => o.DocumentFilter<...>())`.
- The per-endpoint `.WithOpenApi(...)` modifier is deprecated from .NET 10 under the built-in generator (`ASPDEPR002`); it still works on .NET 9. Move that logic into an operation transformer so the customization lives in one place instead of scattered across route registrations.

## Declare security schemes in the document

The spec has to describe how to authenticate, or the docs UI has no Authorize button and generated clients can't attach credentials. Declaring the scheme is documentation only - it changes nothing about how requests are actually authorized.

- **Built-in:** add an `OpenApiSecurityScheme` (typically HTTP `bearer` with `bearerFormat: JWT`) to the document's components via a document transformer, and a matching security requirement so protected operations reference it (on .NET 10, `new OpenApiSecuritySchemeReference("Bearer", document)` as the requirement's key).
- **Swashbuckle:** `AddSecurityDefinition("Bearer", ...)` plus `AddSecurityRequirement(...)`.
- The real authentication and authorization pipeline - the handlers, the token validation, the policies - belongs to the skill covering .NET authentication. Keep the two in sync by hand: the scheme in the spec must name the scheme the app actually enforces, but the spec never enforces anything itself.

## Split versioned or grouped documents

When the API carries more than one version, or you want public and internal surfaces separated, emit more than one document.

- **Built-in:** `AddOpenApi("v1")` and `AddOpenApi("v2")`, then tag each endpoint with `.WithGroupName("v1")` so it lands in the right document; each is served at `/openapi/{name}.json`.
- **Swashbuckle:** one `SwaggerDoc("v1", ...)` per group, with an `ApiExplorer` group name on the endpoints.
- The actual API-versioning strategy - URL segment versus header versus query, and how versions are deprecated - belongs to the ASP.NET Core cross-cutting hub. This skill only routes endpoints into the documents that strategy implies.

## Serve the docs UI with Scalar

- Add the `Scalar.AspNetCore` package and call `app.MapScalarApiReference()` (UI at `/scalar`) pointing at the document endpoint. Scalar runs on .NET 8 and up, so it's the recommended UI regardless of generator. The floor fallback, when a project is committed to the Swashbuckle stack and wants the familiar surface, is Swagger UI via `UseSwaggerUI()`.
- Gate the UI: either wrap it in `if (app.Environment.IsDevelopment())` or attach `.RequireAuthorization()` in production. A docs page is a map of the internal surface - parameter names, status codes, schema shapes - and shipping it open invites scanning.
- Theme with `.WithTheme(...)`. For convenience during local testing, prefill auth with `AddHttpAuthentication`, but only ever with a throwaway dev token - the UI renders credentials into the browser, so a real or production token there is leaked the moment the page loads. For a sensitive API, do not route the UI's calls through a request proxy - leave `.WithProxyUrl(...)` unset (the Aspire Scalar integration enables its own proxy by default; `DisableDefaultProxy()` turns it off there) - a proxy relays every call through another host.

## Prove the document

A generator that is wired is not a document that is right. Run the app, fetch `/openapi/v1.json` (or the Swashbuckle path), and quote two results: the count of `paths` against the endpoint list you expected, and one operation's `summary` and response schema. An empty `summary` block is the XML gate above not being wired; a missing path is an endpoint the generator cannot see.

## Consumers generate their types from the document

The document is half the contract; the other half is every consumer of it - a web front end, another service, a published client. Their request and response types are GENERATED from this document, never re-typed by hand: a hand-copied `OrderDto` compiles against the shape the API had on the day it was copied, and nothing fails when the server moves.

- Emit the document at build time, so a consumer generates without running the service: on the built-in generator, reference `Microsoft.Extensions.ApiDescription.Server` and set `<OpenApiGenerateDocumentsOnBuild>true</OpenApiGenerateDocumentsOnBuild>` (the file lands in `obj/` unless `OpenApiDocumentsDirectory` says otherwise).
- Pick the generator by what the consumer needs: TypeScript types only - `npx openapi-typescript <document> -o <file>.ts`; a full typed client - NSwag (C# and TypeScript from one toolchain) or Kiota (`kiota generate -l CSharp -d <document> -c OrdersClient -o ./Client`, with its `kiota-lock.json` committed).
- Generated output is marked generated, never edited, and left out of coverage; a CI step regenerates it from the current document and fails on a diff (`openapi-typescript --check` does that for the types) - the drift check a hand-copied type never gets.

## Anti-patterns

- Returning untyped `Results.Ok()` and wondering why the schema is empty - the document can only describe the types it can see (§Make the schemas accurate).
- Dropping `.WithName()` and then finding generated clients have meaningless method names - the operation id comes from the route name.
- Treating the document as hand-editable: an OpenAPI file checked in and edited by hand drifts from the code the moment an endpoint changes, and nothing fails when it does. The document is generated output; fix the endpoint, not the spec.
