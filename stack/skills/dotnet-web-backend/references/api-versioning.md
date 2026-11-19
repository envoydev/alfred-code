# API contract versioning and approval

Contract-stability discipline for a surface other people consume - a REST API or a published NuGet / shared-library API. The web hub (dotnet-web-backend) owns the runtime concerns - versioned routes, OpenAPI, the 'add a v2, never break v1' rule; this reference owns how you hold that line: evolve the contract additively, and let a test in CI catch any accidental break.

## Extend-only evolution

The one rule: once a contract ships, it is frozen. Never remove or repurpose an existing member or field - only add. Old callers keep working, new and old paths coexist, and consumers upgrade on their own schedule.

- **REST surface:** add fields to a response and add new versioned routes; never change the meaning of, or drop, a field a client already reads. When a break is unavoidable, stand up a `/api/v2/...` alongside v1 and keep v1 serving until consumers migrate.
- **Shared library:** never change the signature, return type, or access modifier of a public member. Add an overload or a new type instead.

| Safe in any release | Break - major version only |
|---|---|
| add a new overload | remove or rename a public member |
| add a new type / interface / enum | change a parameter type, order, or return type |
| add a member to an existing type | narrow an access modifier (public -> internal) |
| | add a required parameter |

The subtle trap: adding an optional parameter to an existing method looks additive but breaks binary compatibility - the default is compiled into the *caller's* assembly, so a caller built against the old signature throws `MissingMethodException` at runtime. Add a new overload instead.

```csharp
// existing member - frozen, do not touch
public void Process(Order order) { }

// SAFE: a new overload delegates to it
public void Process(Order order, CancellationToken ct) { }

// BREAKS binary compat - looks additive, is not
public void Process(Order order, CancellationToken ct = default) { }
```

## API-approval testing

This is the enforcement mechanism - the reason an accidental break gets caught instead of shipping. Snapshot the public API surface to a checked-in file with PublicApiGenerator, and gate it with Verify: any change to the surface fails the test in CI, so a reviewer must consciously approve the new `.verified.txt`. The packages and the test are `dotnet-testing`'s public-API approval snapshot - load it and write the test from there, so the Verify adapter matches the project's runner.

The verified snapshot is the human-readable API surface; a diff to it in a PR is exactly the set of contract changes, breaking ones included.

## Deprecation and SemVer

Removal is a multi-release process, never a single edit.

1. Mark the member `[Obsolete]` with a message that names the replacement and the migration path - this ships in any minor release and only warns.
2. Keep it working for at least one minor version so consumers have a window to move.
3. Remove only in the next major version.

```csharp
[Obsolete("Obsolete since v1.5. Use ProcessAsync instead.")]
public void Process(Order order) => ProcessAsync(order).GetAwaiter().GetResult();

public Task ProcessAsync(Order order, CancellationToken ct = default) { }
```

SemVer is the signal a consumer reads to know whether an upgrade is safe:

| Bump | What it may carry |
|---|---|
| patch (1.0.x) | bug and security fixes only |
| minor (1.x.0) | new APIs, new `[Obsolete]` marks |
| major (x.0.0) | the only place a break - a removal or signature change - is allowed |

A major bump is permission to break, not a surprise: announce it, document the migration path, and never ship a silent behavior change - a flipped default is a break even when the signature is identical.
