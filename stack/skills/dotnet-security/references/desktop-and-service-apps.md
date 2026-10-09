# Desktop, console and Windows-service apps - the same Top 10, other boundaries

A WPF, WinForms, console or Windows-service app has no browser and usually no HTTP surface, so the web-only controls drop out: CORS, antiforgery, HSTS, the response security headers, output encoding against XSS and the rate-limited login endpoint. The rule under them does not: every byte that crossed a trust boundary is hostile until validated. The boundaries move to the files the user opens, the clipboard and drag-drop, IPC (named pipes, sockets, COM), config files and registry keys another account can write, the update feed, and every network service the app calls.

## A01 - access control is the OS's

- The app runs as the user, so the controls are ACLs: a file, directory, registry key or named pipe the app creates is never writable by other users (set the pipe's security explicitly rather than taking the default).
- A Windows service runs under the least-privileged account that works - a virtual account (`NT SERVICE\<name>`), LocalService or NetworkService - not LocalSystem unless it needs it.
- A service, or an elevated helper, that takes commands over IPC authorizes each caller: an elevated endpoint any local user can drive is a privilege escalation.
- Elevation: the manifest requests `asInvoker`; the one admin action runs in a separate elevated helper, never the whole UI.

## A02 - secrets on the user's machine

- A client binary is the attacker's to decompile: no secret is compiled in or shipped in `app.config` / `appsettings.json`.
- Per-user secrets go to DPAPI (`ProtectedData.Protect` with `DataProtectionScope.CurrentUser`) or the Windows Credential Manager; a service's go to DPAPI machine scope or a vault.
- A desktop client holding a connection string to a shared database hands every user that credential - put a service between them.

## A03 - injection without a browser

- SQL is parameterized exactly as on the web, local SQLite included.
- A process started from input uses `ProcessStartInfo.ArgumentList` with `UseShellExecute = false`, never `cmd /c` plus a concatenated string. A URI or path from input passed to the shell (`UseShellExecute = true`) opens whatever handler it names - allowlist the scheme first.
- A path from input is canonicalized (`Path.GetFullPath`) and checked against the allowed root before use; reject UNC paths (`\\host\share`), which also send the user's NTLM credentials to that host.
- XAML from input is code: `XamlReader.Load` instantiates the types it names. Its restrictive mode is defense in depth only (MS Learn: do not treat a restrictive parse of untrusted XAML as safe) - do not load untrusted XAML.
- A WebView2 or WebBrowser control that shows remote or user content brings the web rules back (encoding, a CSP) - expose host objects to its script (`AddHostObjectToScript`) only for content you ship.

## A08 - the files users open and the code you load

- A document, save file or settings file is untrusted input: it gets emailed, synced and downloaded. `BinaryFormatter`, `SoapFormatter`, `NetDataContractSerializer`, `LosFormatter` and `ObjectStateFormatter` all deserialize without a type restriction and are unsafe on it (MS Learn: BinaryFormatter is insecure and cannot be made secure; from .NET 9 it throws). Json.NET's `TypeNameHandling` other than `None` on such input is the same hole. Migrate to `System.Text.Json`, `XmlSerializer` or `DataContractSerializer`.
- An update is downloaded over HTTPS and its signature (Authenticode or a pinned key) is verified before it runs; your own binaries and installers are signed.
- A native library is loaded by full path, and an elevated process never loads code from a directory a standard user can write.

## A06, A09

- A06 is unchanged: the same NuGet Audit restore gate (SKILL.md).
- A09: logs go to a per-user or ACL-protected directory, or the Windows Event Log for a service; never a secret or PII.

## Review output

The same `category | surface | risk | fix` table as SKILL.md, the surface naming the boundary (opened file, pipe, update feed, process start). A web category that does not apply is marked n/a with the reason, never left blank.
