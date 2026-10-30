# Snapshot testing with Verify

Snapshot (approval) testing captures an output and compares it against a human-approved baseline file checked into source control. Load it from SKILL.md when the thing under test is a large or structural output - a rendered document, an HTTP response, a public API surface, a serialized payload - where hand-writing per-field assertions is noise. For a scalar or a single business rule, use an explicit assertion instead; a snapshot there only hides intent.

How it works: the first run writes a `.received.` file with the actual output; you review it and promote it to `.verified.` (the diff tool does this on approval); every later run compares against `.verified.` and fails, showing a diff, on any change. Intended changes are approved explicitly, unintended ones fail the build.

## Contents

- Install and initialize (xUnit)
- Basic usage
- Approve a public API surface
- Snapshot an HTTP response
- Scrub non-deterministic values
- Source control and CI
- When not to snapshot

## Install and initialize (xUnit)

```bash
dotnet add package Verify.XunitV3
```

`Verify.XunitV3` is the adapter for xUnit v3; a v2 project keeps `Verify.Xunit`.

Configure once via a module initializer, mainly to scrub the values that differ every run:

```csharp
using System.Runtime.CompilerServices;

public static class ModuleInitializer
{
    [ModuleInitializer]
    public static void Init()
    {
        VerifierSettings.ScrubMembersWithType<DateTime>();
        VerifierSettings.ScrubMembersWithType<Guid>();
    }
}
```

## Basic usage

A test returns the `Verify(...)` task; the method name becomes the file name.

```csharp
[Fact]
public Task UserDto_Matches_Approved_Snapshot()
{
    var user = new UserDto("user-123", "John Doe", "john@example.com");
    return Verify(user);
}
```

For non-text output, pass the extension so the verified file opens in its native tool:

```csharp
await Verify(html, extension: "html");   // -> VerifyRenderedPage.verified.html
```

## Approve a public API surface

The highest-value use: gate accidental breaking changes to a library's public surface. `PublicApiGenerator` renders that surface to text and Verify holds it to an approved baseline, so any added, removed, or changed public member fails the test until it is re-approved.

```bash
dotnet add package PublicApiGenerator
```

```csharp
[Fact]
public Task Public_Api_Is_Unchanged()
{
    var api = typeof(MyLibrary.PublicClass).Assembly.GeneratePublicApi();
    return Verify(api);
}
```

## Snapshot an HTTP response

Capture status, selected headers, and body together so a route's whole contract lives in one baseline:

```csharp
[Fact]
public async Task GetUser_Returns_Expected_Response()
{
    var client = _factory.CreateClient();
    var ct = TestContext.Current.CancellationToken;
    var response = await client.GetAsync("/api/users/123", ct);

    await Verify(new
    {
        response.StatusCode,
        Headers = response.Headers
            .Where(h => h.Key.StartsWith("X-"))   // custom headers only
            .ToDictionary(h => h.Key, h => h.Value.First()),
        Body = await response.Content.ReadAsStringAsync(ct)
    });
}
```

## Scrub non-deterministic values

Timestamps, GUIDs, and tokens differ every run and would fail a snapshot on noise. Scrub them to a stable placeholder, per-test or globally:

```csharp
return Verify(order)
    .ScrubMember("Id")
    .ScrubMember("CreatedAt");
```

Global scrubbing (in the initializer) covers whole types at once - `VerifierSettings.ScrubMembersWithType<Guid>()` - plus regex scrubbers for patterns such as bearer tokens.

## Source control and CI

Commit `.verified.` files; ignore `.received.`:

```gitignore
*.received.*
```

Collapse verified files in PR diffs by marking them generated:

```gitattributes
*.verified.txt linguist-generated=true
*.verified.html linguist-generated=true
```

On CI, fail on a mismatch instead of launching a diff tool - disable the diff runner so a missing or changed baseline breaks the build:

```csharp
[ModuleInitializer]
public static void CiInit()
{
    if (Environment.GetEnvironmentVariable("CI") == "true")
        DiffRunner.Disabled = true;
}
```

## When not to snapshot

| Snapshot it | Assert explicitly instead |
|---|---|
| Rendered HTML / documents, serialized payloads | A single scalar or a count |
| Public API surface | One business rule or branch |
| Large object graphs where per-field asserts are noise | Anything where the expected literal states intent better |
