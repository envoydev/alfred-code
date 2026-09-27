# Auth on .NET Framework 4.8 (OWIN / Katana)

SKILL.md is ASP.NET Core auth. On .NET Framework 4.8 the modern backbone is the OWIN / Katana middleware
pipeline, not the old `SqlMembershipProvider` / `FormsAuthentication` stack. The OWIN pipeline itself belongs to the skill covering the ASP.NET Core web surface, which carries its own
.NET Framework reference; with none installed, wire the pipeline from the OWIN docs and treat the shape below as the auth half only.

## The OWIN auth stack

- Configure auth in an `OwinStartup` class through Katana middleware (`Microsoft.Owin.*`). Server-rendered
  apps use `app.UseCookieAuthentication` with **ASP.NET Identity 2.x** (`UserManager` / `SignInManager`,
  account confirmation, lockout, a real password policy) - not the legacy membership providers.
- Web API 2 bearer tokens: issue with `Microsoft.Owin.Security.OAuth`
  (`OAuthAuthorizationServerProvider`, `GrantResourceOwnerCredentials`, `ValidateClientAuthentication`)
  and validate with `Microsoft.Owin.Security.Jwt` (`UseJwtBearerAuthentication`). For an external IdP
  (Azure AD, Auth0, IdentityServer) prefer RS256 asymmetric signing with an `IssuerSigningKeyResolver`
  fetching the JWKS from the OIDC discovery endpoint, over a symmetric HS256 key embedded in code - the
  same validate-every-field discipline as SKILL.md.
- **Do not pack a JWT into the auth cookie's claims** - the cookie doubles in size and can blow past
  IIS's ~8-16 KB header limit; use a server-side session store if you must keep the token. Windows
  Authentication stays appropriate for intranet LOB apps (configured at IIS), combined with role /
  claims `[Authorize]`.

The named-policy and authorization-handler model from SKILL.md still applies. Anti-forgery for
cookie-authenticated endpoints is the controller-based Web API skill's net48 reference; key
primitives (RS256 vs HS256, constant-time compare) are the .NET cryptography skill's net48
reference; where secrets live is the .NET application-security skill's.
