---
name: database-security
description: "Load when hardening or security-reviewing SQL or data-layer code - 'is this query injectable', 'can one tenant read another's rows'. Not for schema design."
---

# SQL / data-layer security

The database is the crown jewels and the last line of defense - by the time a request reaches it, every app-layer control has either held or failed. This is the persistence-layer map: how injection, over-privilege, tenant leakage, and secret handling show up at the SQL boundary and what to do about each. The rule under all of it: the database enforces its own security, because an app bug should not become a full-table breach.

## When to use

Load when hardening or reviewing a SQL / data-persistence feature, when a security sweep reaches the data stack, or on asks like 'is this query injectable' or 'can one tenant read another's rows'.

Covers, by persistence threat surface: SQL injection closed at every sink, least-privilege database accounts, row-level security and tenant isolation (the data-layer IDOR), secrets kept out of connection strings, encryption at rest and in transit, sensitive-data exposure and masking, and audit logging that never records the secret. The body names each deeper route and what to do when the project installed none of them.

Do NOT load for non-security work.

## Injection - close every sink

- **Parameterize, always.** Never build SQL by string concatenation or interpolation (any driver: bound placeholders - `$1`, `?`, `@p` - never a formatted string). In EF Core, `FromSqlInterpolated` / `FromSql` parameterize the interpolated values; raw `FromSqlRaw` / `ExecuteSqlRaw` with a concatenated string does not - a `FromSqlRaw($"... {userInput}")` is injection. ADO.NET uses `SqlParameter` / `NpgsqlParameter`, never a formatted command text.

```csharp
var bad  = db.Users.FromSqlRaw("select * from users where name = '" + name + "'"); // injection - the string is built before the API sees it
var safe = db.Users.FromSql($"select * from users where name = {name}");           // safe - each interpolated value becomes a DbParameter
```
- **Dynamic SQL in a stored procedure** is still injectable: build it with `sp_executesql` (SQL Server) or `EXECUTE ... USING` (Postgres) passing parameters, never `EXEC(@sql)` on a concatenated string. A proc is not a safe boundary by virtue of being a proc.
- **Identifiers can't be parameterized** - a table or column name chosen from user input must be validated against an allowlist, never interpolated.
- **ORDER BY / dynamic filters** from the client map to a fixed allowlist of columns and directions, never passed through as text.

## Least privilege - the account, not just the query

- The application login is **never** `sa`, `db_owner`, `sysadmin`, or a superuser. Grant only the CRUD it needs on the objects it touches; deny DDL at runtime.
- Split logins by job: a migration/deploy login that can alter schema, a runtime login that cannot. A runtime account that can `DROP TABLE` turns any injection into a catastrophe.
- Prefer stored-procedure or view-scoped access over table-wide grants where the model allows it. Revoke `PUBLIC` grants.

## Tenant isolation - the data-layer IDOR

- In a multi-tenant database, the tenant filter must be enforced where it cannot be forgotten: **Row-Level Security** policies (SQL Server security policies, Postgres `CREATE POLICY` + `ENABLE ROW LEVEL SECURITY`) keyed to a session/context tenant id, or an EF Core **global query filter** (`HasQueryFilter`) - never a `WHERE TenantId = ...` an author must remember to add on every query. A single missed filter is a cross-tenant read.
- Set the tenant/user context on the connection (a session variable / `SESSION_CONTEXT`) that the RLS policy reads, and make sure a pooled connection cannot leak one tenant's context into another's request.

## Secrets - out of the connection string

- No plaintext password in `appsettings.json`, source, or a committed `.env`. Prefer **integrated auth / managed identity** (Azure AD / Entra, `Authentication=Active Directory Default`) so no password exists; otherwise pull it from a secret store (Key Vault, user-secrets in dev) at runtime.
- Set `Encrypt=true` and do **not** set `TrustServerCertificate=true` in production - that disables the TLS validation `Encrypt` bought you, opening a MITM on the wire.

## Encryption and exposure

- **At rest:** TDE for whole-database encryption; column-level encryption / **Always Encrypted** (SQL Server) or `pgcrypto` for the few highly-sensitive columns (national id, card data). Hash - never reversibly encrypt - anything you only need to compare (the cryptography-primitives skill covers the KDF choice; without it, Argon2id or PBKDF2 with a per-record salt).
- **Minimize exposure:** `SELECT` only the columns needed; do not pull PII into a query that does not use it. Consider **dynamic data masking** for support/read roles. Keep secrets and PII out of computed columns and error text.

## Audit and integrity

- Audit who-changed-what on sensitive tables - temporal (system-versioned) tables, an audit trigger, or `created/modified by+at` columns - but the audit record must **never** store the secret it is tracking (log the fact of a password change, not the password).
- A migration or seed that inserts a default admin credential, grants a broad role, or disables a constraint is a finding - flag it (safe migration mechanics are the .NET migration-workflow skill's where the install has one, else the project's own migration tool).

## Probe before you report

Two checks turn this from an opinion into a finding, and both are one query, run as the runtime login. List the login's grants and quote the result - a login that can `CREATE`, `DROP` or read another schema is the finding, whatever the queries look like. Then confirm row-level security is enabled on every tenant-scoped table and quote the policy count; zero policies on a tenant table is the IDOR. A check you did not run is reported UNVERIFIED.

```sql
-- PostgreSQL: grants, then RLS state and policy count per table
SELECT table_schema, table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = '<runtime login>';
SELECT c.relname, c.relrowsecurity, count(p.polname) AS policies FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid WHERE c.relkind = 'r' GROUP BY 1, 2;

-- SQL Server: the login's database permissions, then the security policies and whether each is on
SELECT * FROM fn_my_permissions(NULL, 'DATABASE');
SELECT name, is_enabled FROM sys.security_policies;
```

## Review output

Report findings as `surface | risk | fix`, ordered by risk - e.g. `runtime login is db_owner | any injection becomes schema-level compromise | split a CRUD-only runtime login from the migration login`. Findings on the app-layer EF/access-control surface route to the .NET application-security hardening skill, crypto-primitive misuse to the .NET cryptography-primitives skill - name whichever the install has as the route, do not restate their content here; when neither is installed, keep the finding here with its fix stated in full.
