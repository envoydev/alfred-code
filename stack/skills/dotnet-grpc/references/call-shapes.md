# The four call shapes

Read when a method's shape is being chosen - a stream instead of unary, or which stream.

Four shapes, one decision per method:
- **Unary** - one request, one response. The default; use it unless a stream earns its keep.
- **Server streaming** - one request, a stream of responses. Feeds, progress, paged or live result sets the client reads to completion.
- **Client streaming** - a stream of requests, one response. Uploads and batch ingestion where the server aggregates.
- **Bidirectional streaming** - independent request and response streams over one call. Live, conversational exchange; the two directions are not lock-step.
