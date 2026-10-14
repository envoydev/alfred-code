# .NET application security on .NET Framework 4.8

This skill floors at .NET 10 / C# 14; the OWASP mitigations in SKILL.md still apply on net48, but several
high-risk areas have Framework-specific mechanics and defaults. 4.8 is supported but frozen, and
security is the strongest reason to move - hardening it in place is the interim.

## TLS: let the OS choose, do not hard-code

- Do not pin `ServicePointManager.SecurityProtocol` or a specific `SslProtocols`. Instead set two
  registry DWORDs to `1` under **both** `HKLM\SOFTWARE\Microsoft\.NETFramework\v4.0.30319` and its
  `WOW6432Node` path (for 32-bit apps on 64-bit Windows): `SystemDefaultTlsVersions` (defers protocol
  choice to the OS, so TLS 1.2/1.3 and future protocols work without a recompile) and
  `SchUseStrongCrypto`.
- `SchUseStrongCrypto` already defaults on for apps targeting 4.6+, but set `SystemDefaultTlsVersions`
  explicitly. Avoid `SslProtocols.Default` (it means SSL3 / TLS1.0); for WCF bindings use
  `SslProtocols.None` to defer to the OS.

## BinaryFormatter still ships here - that is the trap

- Unlike .NET 9 (where the in-box implementation throws), `BinaryFormatter` still works on 4.8, so
  vulnerable code keeps running. It cannot be made safe (CWE-502). The do-not-use list from SKILL.md
  applies with force: also `SoapFormatter`, `NetDataContractSerializer`, `LosFormatter`,
  `ObjectStateFormatter`, and Newtonsoft `TypeNameHandling.All` / `Auto`. Replace with
  `System.Text.Json` / `XmlSerializer` / `DataContractSerializer` for trusted contracts, or MessagePack
  / protobuf-net for compact binary. Enable the deserialization analyzers `CA2300`-`CA2302`; on Web
  Forms, ViewState is the in-the-wild instance of this attack, covered next.

## Classic ASP.NET has no security middleware

- There is no HSTS or headers middleware. Add `Strict-Transport-Security`, `X-Content-Type-Options:
  nosniff`, `X-Frame-Options`, and a CSP through `<customHeaders>` in web.config, an `HttpModule`, or the
  NWebsec library. Keep request validation on, use `@Html.AntiForgeryToken()` +
  `[ValidateAntiForgeryToken]` on POST, and set cookies `httpOnlyCookies` / `requireSSL` / `SameSite`.
- **SameSite is version-sensitive on 4.8.** The 2019 draft works on 4.7.2+ only after the December 2019
  rollups: `SameSiteMode.None` then emits `SameSite=None` (pair it with `Secure`) and `(SameSiteMode)(-1)`
  omits the attribute. Upgrading to 4.8 RTM can drop the patched behavior until you reapply the rollups.

## ViewState and the machineKey (Web Forms)

- The `machineKey` (ValidationKey / DecryptionKey) signs and encrypts ViewState, forms-auth tickets, and
  antiforgery tokens - it is a crown-jewel secret. Keep `enableViewStateMac="true"` (never set it false,
  nor the `AspNetEnforceViewStateMac` registry hack to 0 - that directly enables ViewState-forgery RCE),
  and set `ViewStateUserKey` (to the session id or an anti-CSRF token in `Page_Init`) to bind ViewState
  to the user.
- On a web farm, pin an explicit static `machineKey` and encrypt it at rest (below). Its compromise is
  catastrophic: a stolen key lets an attacker forge a signed `__VIEWSTATE` payload for unauthenticated
  RCE, as the 2025 SharePoint 'ToolShell' incident showed. The lesson: **patching alone does not revoke
  a stolen key** - rotate the `machineKey` and `iisreset` as a first-class incident-response step.

## Secrets in web.config

- Never store secrets in `web.config` in cleartext. Encrypt config sections at rest with
  `aspnet_regiis -pe` (DPAPI `DataProtectionConfigurationProvider` for a single server, RSA
  `RsaProtectedConfigurationProvider` for a web farm with exportable keys).
- On 4.7.1+, configuration builders (`AzureKeyVaultConfigBuilder`, `EnvironmentConfigBuilder`,
  `UserSecretsConfigBuilder`) inject config from Key Vault / env / user-secrets while code keeps calling
  `ConfigurationManager.AppSettings[...]` unchanged - the classic-ASP.NET analog of Core's chained
  providers. Use `EnvironmentConfigBuilder` in containers, and Managed Identity for Key Vault so no
  credential lives in config.

## Dependency auditing needs PackageReference

- `dotnet list package --vulnerable --include-transitive` and NuGet Audit (automatic during restore,
  warnings NU1901-NU1904) both effectively require the PackageReference format - a `packages.config`
  project cannot run the CLI audit. The conversion itself belongs to the skill covering the solution build
  spine, in its own 4.8 notes; both commands then work even for a net48 target, checking the GitHub
  Advisory Database.

Algorithm choice and the Framework crypto defaults (PBKDF2's SHA-1 default, the RNG API) belong to the
skill covering .NET crypto primitives, in its own 4.8 notes; general secret placement is SKILL.md's, and
the classic-ASP.NET web.config mechanics are above.
