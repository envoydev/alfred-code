# OpenID Connect and API keys

## OpenID Connect for delegated identity

When an external provider owns sign-in, pair a cookie scheme for the local session with the OIDC handler for the challenge:

```csharp
builder.Services
    .AddAuthentication(options =>
    {
        options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = OpenIdConnectDefaults.AuthenticationScheme;
    })
    .AddCookie()
    .AddOpenIdConnect(options =>
    {
        options.Authority = config["Oidc:Authority"];
        options.ClientId = config["Oidc:ClientId"];
        options.ClientSecret = config["Oidc:ClientSecret"];
        options.ResponseType = "code";          // authorization code flow
        options.Scope.Add("openid");
        options.Scope.Add("profile");
        options.SaveTokens = true;
    });
```

Use the authorization code flow (`response_type=code`), not the deprecated implicit flow. The client secret is a secret like any other.

## API keys

API keys are the weakest credential - a single static string with no identity, expiry, or scope - so use them only for service-to-service or webhook callers that cannot do a real handshake, and never as your primary user auth. When you must:

- Store a **hash** of the key, not the key itself; a leaked database must not leak working credentials.
- Compare in **constant time** so the check leaks no timing information about how many characters matched.

Hash with `SHA256.HashData` (an API key is high-entropy, so a fast hash is enough) and compare with `CryptographicOperations.FixedTimeEquals` - the .NET cryptography skill owns their correct use; reimplement neither. Implement the check as an authentication handler or a small middleware that sets a `ClaimsPrincipal` on success, so the rest of the pipeline treats an API-key caller exactly like any other authenticated principal.
