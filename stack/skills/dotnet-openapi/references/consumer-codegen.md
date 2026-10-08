# Consumers generate their types from the document

The document is half the contract; the other half is every consumer of it - a web front end, another service, a published client. Their request and response types are GENERATED from this document, never re-typed by hand: a hand-copied `OrderDto` compiles against the shape the API had on the day it was copied, and nothing fails when the server moves.

- Emit the document at build time, so a consumer generates without running the service: on the built-in generator, reference `Microsoft.Extensions.ApiDescription.Server` and set `<OpenApiGenerateDocumentsOnBuild>true</OpenApiGenerateDocumentsOnBuild>` (the file lands in `obj/` unless `OpenApiDocumentsDirectory` says otherwise).
- Pick the generator by what the consumer needs: TypeScript types only - `npx openapi-typescript <document> -o <file>.ts`; a full typed client - NSwag (C# and TypeScript from one toolchain) or Kiota (`kiota generate -l CSharp -d <document> -c OrdersClient -o ./Client`, with its `kiota-lock.json` committed).
- Generated output is marked generated, never edited, and left out of coverage; a CI step regenerates it from the current document and fails on a diff (`openapi-typescript --check` does that for the types) - the drift check a hand-copied type never gets.
