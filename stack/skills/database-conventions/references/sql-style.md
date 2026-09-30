# SQL code style and conventions: PostgreSQL, SQL Server (T-SQL), and SQLite

The authoritative cross-engine SQL *writing* style: casing, formatting and layout, naming style, query construction, data-type choice, NULL handling, dialect portability, and the per-engine cheat-sheet. Precedence is stated once in `SKILL.md`: the project's own SQL style wins over both documents, and this reference wins over `SKILL.md` where the two overlap. Targets hand-written SQL; ORM/EF-generated SQL follows its tool's conventions. These are conventions, not correctness rules - the cited guides genuinely disagree in places and any internally consistent choice is legitimate; version-gated features are noted inline, so confirm them against the deployed engine version.

## Contents

1. [Casing conventions](#1-casing-conventions)
2. [Naming conventions](#2-naming-conventions)
3. [Formatting and layout](#3-formatting-and-layout)
4. [Query construction best practices](#4-query-construction-best-practices)
5. [Data type conventions](#5-data-type-conventions)
6. [NULL handling conventions](#6-null-handling-conventions)
7. [Comments and documentation](#7-comments-and-documentation)
8. [CTEs and subqueries](#8-ctes-and-subqueries)
9. [Transactions and error handling](#9-transactions-and-error-handling)
10. [Dialect-specific gotchas and portability](#10-dialect-specific-gotchas-and-portability)
11. [Performance-adjacent conventions](#11-performance-adjacent-conventions-that-are-also-style)
12. [Security conventions](#12-security-conventions)

Plus [Recommendations](#recommendations) and the [dialect cheat-sheet](#cheat-sheet-dialect-quick-reference).

## Details

### 1. Casing conventions

#### Keyword casing
The prevailing position among traditional/analytics style guides is **UPPERCASE reserved words**:
- **Simon Holywell's sqlstyle.guide**: 'Always use uppercase for the reserved keywords like `SELECT` and `WHERE`.'
- **Mozilla SQL Style Guide**: 'Always use uppercase for reserved keywords like SELECT, WHERE, or AS.'
- **GitLab SQL Style Guide**: 'Keywords should be UPPERCASE'; 'Function names should be UPPERCASE'; 'Field names should all be lowercase.' (Enforced by SQLFluff.) Note this is often confused with the separate lowercase-keyword guides - GitLab is firmly in the uppercase camp.

The dissenting (and increasingly popular in analytics/ELT) position is **lowercase keywords**:
- **dbt Labs style guide**: 'Use lowercase keywords.'
- **mattm/Matt Mazur SQL Style Guide**: `select * from users` is 'Good'; uppercase is 'Bad' - argument is 'It is just as readable as uppercase SQL and you will not have to constantly be holding down a shift key.'

**Tradeoff**: Uppercase visually separates keywords from identifiers in editors without syntax highlighting and is the historical convention (Joe Celko's *SQL Programming Style*). Lowercase is faster to type and, with modern syntax highlighting, the structural distinction is arguably redundant. **Recommended default: UPPERCASE keywords** for hand-written DDL/DML and stored routines (matches the majority of authoritative guides and reads well in migration files and code review), but lowercase is fully defensible for analytics teams standardized on dbt. The only real rule, stated by every guide: never mix them in one codebase.

#### Identifier casing and case folding - the critical engine difference
| Engine | Unquoted identifier behavior | Practical implication |
|---|---|---|
| **PostgreSQL** | Folds unquoted identifiers **to lowercase** (non-standard; the SQL standard folds to uppercase). Per the PostgreSQL docs: `FOO`, `foo`, and `"foo"` are the same, but `"Foo"` and `"FOO"` differ. | If you `CREATE TABLE "UserName"` (quoted), you must quote it forever after. Use lowercase `snake_case` unquoted and the problem disappears. |
| **SQL Server** | **Preserves case** as written, but comparison is **case-insensitive by default** (governed by collation; default is `SQL_Latin1_General_CP1_CI_AS`, where `CI` = case-insensitive). | A case-sensitive collation (`_CS_`) makes even column *names* in queries case-sensitive, which breaks queries written with wrong casing. Do not rely on casing for uniqueness. |
| **SQLite** | Case-insensitive for ASCII identifiers and keywords; case-sensitivity of *data* comparisons depends on collation (`BINARY` default is case-sensitive for data). | Generally forgiving; `snake_case` is still best. |

**Identifier casing style** (independent of folding): the strong majority recommendation is **`snake_case`**.
- sqlstyle.guide: 'Avoid camelCase - it is difficult to scan quickly'; 'Use underscores where you would naturally include a space in the name (first name becomes `first_name`).'
- Mozilla: 'Use lower case names with underscores... Do not use camelCase.'
- GitLab: 'All field names should be snake-cased.'

`PascalCase` is common in the SQL Server / .NET ecosystem (e.g., `dbo.CustomerOrders`), and works there because SQL Server preserves and case-insensitively compares. But for portability and to survive PostgreSQL's lowercase folding, **`snake_case` unquoted is the safest universal default.**

### 2. Naming conventions

#### Tables: singular vs plural - a genuine, unresolved debate
- **sqlstyle.guide (collective/plural)**: 'Use a collective name or, less ideally, a plural form... `staff` instead of `employees`.' It explicitly says to avoid `tbl` prefixes.
- **GitLab / dbt / Mozilla ecosystem**: plural table names (`users`, `orders`, `visit_logs`) - the mattm guide marks `select * from user` (singular) as 'Bad' and `users` as 'Good.'
- **The singular camp** (common with ORMs): a table models an entity set; a row is one `customer`, so some teams use singular `customer`.

**Tradeoff**: Plural reads naturally in `FROM users` and is the dominant web-application convention. Singular pairs cleanly with class names in ORM-heavy shops. **Recommended default: plural (or collective) table names**, because it is the majority convention across the cited guides - but this is a low-stakes choice; pick one and be consistent.

#### Columns
- Always singular (sqlstyle.guide: 'Always use the singular name').
- Avoid bare `id` per sqlstyle.guide ('Where possible avoid simply using `id`'), though `id` as a surrogate PK is extremely common and defensible; GitLab compromises: 'An `id`... should always be prefixed by what it is identifying' when projected (`id AS account_id`).
- Never give a column the same name as its table.

#### Uniform suffixes (sqlstyle.guide) and semantic naming (GitLab)
- sqlstyle.guide suffixes: `_id`, `_status`, `_total`, `_num`, `_name`, `_seq`, `_date`, `_tally`, `_size`, `_addr`.
- GitLab booleans: 'Boolean field names should start with `has_`, `is_`, or `does_`' (e.g., `is_deleted`).
- GitLab timestamps/dates: 'Timestamps should end with `_at`... and should always be in UTC'; 'Dates should end with `_date`.' GitLab also warns: 'Always avoid key words like `date` or `month` as a column name.'

#### Constraints and indexes - prefix conventions
There are **two schools**. The widely used prefix convention (SQL Server community, SQLAlchemy default, most tutorials):

| Object | Prefix pattern | Example |
|---|---|---|
| Primary key | `pk_<table>` | `pk_customers` |
| Foreign key | `fk_<table>_<referenced>` | `fk_orders_customers` |
| Unique | `uq_<table>_<col>` | `uq_users_email` |
| Check | `ck_<table>_<col>` | `ck_products_price` |
| Index | `ix_<table>_<cols>` | `ix_order_customer_id` |
| Default (SQL Server) | `df_<table>_<col>` | `df_order_created_at` |

The **SQLAlchemy default naming convention** codifies exactly this - its documented convention is `"pk": "pk_%(table_name)s"`, `"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"`, `"uq": "uq_%(table_name)s_%(column_0_name)s"`, `"ck": "ck_%(table_name)s_%(constraint_name)s"`, `"ix": "ix_%(column_0_label)s"` - and is a de-facto standard for Python/Postgres shops.

The **competing school** (emergentsoftware's sp_Develop for SQL Server) argues **no prefix** is needed because system catalogs already tell you the object type: index names should be `TableName_Column1_Column2`, FK names `[FK-TABLE]_[PK-TABLE]`. **Recommended default: use the `pk_`/`fk_`/`uq_`/`ck_`/`ix_` prefixes** - they make constraint errors instantly legible in logs and DDL, and they are what SQLAlchemy/Alembic emit. Whatever you choose, **always name constraints explicitly** rather than accepting the engine's autogenerated names (e.g., SQL Server's `PK__TableNam__38F491856B661278`, PostgreSQL's `table_col_key`), which are unstable across environments and make migrations fragile. sqlstyle.guide's nuance: `PRIMARY KEY`, `UNIQUE`, and `FOREIGN KEY` can be left to the vendor's auto-naming, but custom constraints (checks) should always be named.

#### Reserved words and prefixes to avoid
- Never use reserved words as identifiers (all guides). If unavoidable, quote them - but better to rename.
- **Do not use `sp_` prefix for SQL Server stored procedures.** This prefix is reserved by SQL Server for system procedures in `master`; per Microsoft, SQL Server 'always looks for a stored procedure beginning with sp_' in the `master` database *first*, causing a measurable performance penalty (Aaron Bertrand's benchmarks with SQL Sentry Plan Explorer showed 'the sp_ prefix has a significant impact on average duration in almost all cases') and the risk that a name collision silently runs the system proc instead of yours. As Bertrand notes in 'Is the sp_ prefix still a no-no?' (SQLPerformance.com, Oct 2012): 'The sp_ prefix does not mean what you think it does: most people think sp stands for stored procedure when in fact it means special.' Use `usp_` or a verb-based name.
- Avoid Hungarian/`tbl_`/`vw_` prefixes (sqlstyle.guide; Celko §1.2.3 'Avoid Descriptive Prefixes').
- Stored procedure names 'must contain a verb' (sqlstyle.guide).

#### Schemas
- **SQL Server**: `dbo` is the default schema. Use two-part names (`dbo.Customer`) in code - this avoids a name-resolution penalty and ambiguity. Group related objects into custom schemas (e.g., `sales.`, `hr.`) for larger databases. Note `sysname` is SQL Server's built-in type for identifiers (equivalent to `nvarchar(128)`), used when writing metadata/dynamic code.
- **PostgreSQL**: `public` is the default schema; objects resolve via `search_path`. For multi-tenant or modular designs use explicit schemas and set `search_path` deliberately. Be aware that relying on an implicit `search_path` can be a security concern (schema-shadowing); qualify names in `SECURITY DEFINER` functions.
- **SQLite**: no schema concept beyond `main`, `temp`, and `ATTACH`ed databases; there is no `dbo`/`public` equivalent.

### 3. Formatting and layout

#### Two dominant layout philosophies
**(a) 'River' / right-aligned (traditional; Celko, sqlstyle.guide):** root keywords are right-aligned so their values form a left-aligned 'river' down the middle:
```sql
SELECT a.title, a.release_date
  FROM albums AS a
 WHERE a.title = 'Charcoal Lane'
    OR a.title = 'The New Danger';
```
sqlstyle.guide: 'Spaces should be used to line up the code so that the root keywords all end on the same character boundary. This forms a river down the middle.' JOINs indent to the other side of the river.

**(b) Left-aligned / 'modern' (Mozilla, dbt, GitLab, mattm):** each root keyword starts at column 0 on its own line; columns indented one level:
```sql
SELECT
    a.title,
    a.release_date
FROM albums AS a
WHERE a.title = 'Charcoal Lane'
    OR a.title = 'The New Danger';
```
Mozilla explicitly overrides Holywell here: 'Root keywords should all start on the same character boundary... This is counter to the common rivers pattern.' **Recommended default: left-aligned/modern.** The river style is elegant but breaks down on editing (re-aligning multi-line predicates on every change) and produces noisy diffs - a common critique is that it puts too much burden on the query writer whenever you modify and re-align a query. Left-alignment is what most modern formatters (sqlfmt, most SQLFluff configs) produce.

#### One column per line
Near-universal for multi-column SELECTs. mattm: 'always put each column name on its own line.' GitLab: 'When `SELECT`ing, always give each column its own row, with the exception of `SELECT *`.' Rationale: cleaner diffs and easier to add/remove columns.

#### Leading vs trailing commas - the second big debate
- **Trailing commas (dominant)**: sqlstyle.guide, GitLab ('Commas should be at the end-of-line (EOL) as a right comma'), dbt, Mozilla, mattm. Argument: matches English reading conventions (Holywell: 'In the English language, a comma separated list always places the comma immediately after a term').
- **Leading commas (minority, has real merit)**: easier to comment out the last column without a dangling-comma parse error, and produces cleaner diffs when adding columns. dbt notes it has 'a small but passionate contingent of leading comma enthusiasts.'

**Tradeoff**: Trailing is more readable and is the majority. Leading is more edit-friendly and diff-friendly. **Recommended default: trailing commas** (majority + reads naturally), unless your team values the comment-out convenience more.

#### Indentation
4 spaces (GitLab: 'Within a CTE, the entire SQL statement should be indented 4 spaces'; sqlstyle.guide: 'Indent column definitions by four (4) spaces' in CREATE) or 2 spaces (many dbt setups). Never tabs (GitLab: 'No tabs should be used - only spaces'). Line length typically capped at 80 characters (GitLab: 'Lines of SQL should be no longer than 80 characters') or up to 120.

#### CTEs
- Place all CTEs at the top; leave a blank line above and below the final query (GitLab).
- Indent the CTE body 4 spaces.
- Name CTEs concisely but clearly (GitLab: 'CTE names should be as concise as possible while still being clear'); comment non-obvious ones.

#### Subqueries and parenthesization
sqlstyle.guide: subqueries align to the right of the river, closing paren on its own line at the same position as the opener for nested subqueries. General principle (all guides): avoid redundant parentheses but use them to make precedence explicit in mixed `AND`/`OR` conditions.

### 4. Query construction best practices
- **Explicit column lists, not `SELECT *`**: universal for production/persistent code. `SELECT *` is acceptable only for ad-hoc exploration and (per dbt/GitLab) in the final `SELECT * FROM final` line of a staged model. Reasons: stable result shape, avoids breaking on schema change, avoids fetching unused columns.
- **ANSI `JOIN` syntax, never comma joins**: Mozilla: 'Always include the JOIN type rather than relying on the default join.' Explicit `INNER`/`LEFT`/etc. `JOIN ... ON ...` beats the old comma-join + WHERE style, which hides join conditions among filters and invites accidental cross joins. (GitLab-specific: 'Never use `USING` in joins because it produces inaccurate results in Snowflake' - a warehouse-specific caveat, but a reminder that `ON` is the safe, explicit choice.)
- **Always use `AS` for aliases**: sqlstyle.guide, Mozilla, GitLab all require it. Note: SQL Server accepts `AS` for column aliases and also accepts table aliases with or without `AS` (`FROM Orders AS o` and `FROM Orders o` both work). PostgreSQL and SQLite accept `AS` for both columns and tables.
- **Meaningful aliases, not single letters**: sqlstyle.guide: 'the correlation name should be the first letter of each word.' GitLab goes further: 'strongly prefer to reference the full table name instead of an alias'; single-letter aliases (`a`, `b`, `c`) are discouraged. **Recommended default: short but meaningful aliases** (`cust`, `ord`) or full table names; reserve single letters for throwaway queries.
- **Qualify all columns when >1 table is in scope**: prevents ambiguity and breakage when a column is later added to another table (the GitLab/Rails `user_id` example shows how an unqualified column can silently change meaning after a migration adds the same column to another joined table).
- **Clause ordering** is fixed by SQL: `SELECT` -> `FROM` -> `JOIN` -> `WHERE` -> `GROUP BY` -> `HAVING` -> `ORDER BY` -> `LIMIT/OFFSET`. Understand the logical execution order (FROM/JOIN -> WHERE -> GROUP BY -> HAVING -> SELECT -> ORDER BY -> LIMIT) to reason about aliases and aggregates. (GitLab/dbt convention: `GROUP BY 1, 2` positional grouping is preferred by some analytics teams; others insist on explicit column names - this is itself a minor debate.)

### 5. Data type conventions

#### Portability principle
sqlstyle.guide: 'Where possible do not use vendor-specific data types.' Prefer `NUMERIC`/`DECIMAL` over `FLOAT`/`REAL` except for genuine floating-point math (rounding errors). Store ISO-8601 date/time.

#### Text
| Concern | PostgreSQL | SQL Server | SQLite |
|---|---|---|---|
| Preferred string type | **`text`** (no length penalty; PostgreSQL wiki 'Don't Do This' advises against defaulting to `varchar(n)`) | **`nvarchar`** for Unicode (Microsoft: 'If you store character data that reflects multiple languages, use Unicode data types (nchar, nvarchar...) instead of non-Unicode data types'); `varchar` only when you know data is ASCII/single-codepage. `nvarchar(max)` for large. | `TEXT` (length in `VARCHAR(n)` is ignored - affinity only) |
| `char(n)` | Avoid (pads with spaces) | Avoid except true fixed-width | Becomes TEXT affinity |

#### Numbers / auto-increment identity
| Concern | PostgreSQL | SQL Server | SQLite |
|---|---|---|---|
| Auto-increment | `GENERATED ALWAYS AS IDENTITY` (SQL-standard, **preferred over `serial`** per PostgreSQL wiki and community since v10 - 'For new applications, identity columns should be used instead'); `serial`/`bigserial` legacy | `IDENTITY(1,1)` | `INTEGER PRIMARY KEY` (alias for `rowid`, auto-increments by default); `AUTOINCREMENT` keyword only if you must prevent rowid reuse - per SQLite docs it 'imposes extra CPU, memory, disk space, and disk I/O overhead and should be avoided if not strictly needed. It is usually not needed.' |
| Money | `numeric(p,s)` (never `float`; avoid the `money` type per PG wiki) | `decimal`/`numeric` (avoid `money`) | `NUMERIC` affinity; enforce precision in app |

#### Boolean
| Engine | Boolean handling |
|---|---|
| PostgreSQL | Native `boolean`; accepts `true`/`false`/`'t'`/`'yes'`/`'on'`/`'1'` etc. |
| SQL Server | **No boolean type**; use `BIT` (0/1) |
| SQLite | **No boolean type**; stored as integer `0`/`1`; keywords `TRUE`/`FALSE` recognized since 3.23 as aliases for 1/0. Common idiom: `is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))` |

#### Date/time
| Engine | Recommended type | Notes |
|---|---|---|
| PostgreSQL | **`timestamptz`** (timestamp with time zone) for points in time (PG wiki 'Don't Do This': 'Don't use the `timestamp` type to store timestamps, use `timestamptz`'); `date` for date-only | `timestamptz` stores UTC internally and converts to session timezone on display |
| SQL Server | **`datetime2`** (higher precision, larger range) over legacy `datetime`; `datetimeoffset` for TZ-aware | John McCall's T-SQL style guide recommends `DATE`, `TIME`, `DATETIME2`, `DATETIMEOFFSET` |
| SQLite | **No date/time type**; store as ISO-8601 `TEXT` (`'2026-04-23 14:30:00'`), or INTEGER Unix epoch, or REAL Julian day | Date functions work on all three encodings |

#### UUID
| Engine | UUID handling |
|---|---|
| PostgreSQL | Native `uuid` type (16 bytes); `gen_random_uuid()` built in since **v13** (per the PostgreSQL 13 release notes: 'Add function gen_random_uuid() to generate version-4 UUIDs'; before v13 required the `uuid-ossp` or `pgcrypto` modules) |
| SQL Server | `uniqueidentifier`; `NEWID()` or `NEWSEQUENTIALID()` |
| SQLite | No UUID type; store as `TEXT` or `BLOB` |

### 6. NULL handling conventions
- **Three-valued logic** (TRUE/FALSE/UNKNOWN) is identical across all three engines. `NULL = NULL` is UNKNOWN, not TRUE.
- **Always `IS NULL` / `IS NOT NULL`, never `= NULL`**: `= NULL` evaluates to UNKNOWN and returns no rows. (In SQL Server, the deprecated `SET ANSI_NULLS OFF` legacy behavior can change this - never rely on it.)
- **`NOT IN` with a subquery that can return NULL is a classic bug** (three-valued logic makes the whole predicate UNKNOWN, returning zero rows) - prefer `NOT EXISTS`. This is documented as one of the 'Ten Common SQL Programming Mistakes' (Red Gate Simple Talk).
- **Null-coalescing functions differ**:

| Function | PostgreSQL | SQL Server | SQLite |
|---|---|---|---|
| ANSI `COALESCE` (n-ary, portable) | yes | yes | yes |
| `ISNULL` (2-ary) | no | yes (`ISNULL(x, y)`) | no - use `IFNULL` or `COALESCE` |
| `IFNULL` | no | no | yes |
| `NULLIF` (returns NULL if equal) | yes | yes | yes |

**Recommendation**: prefer **`COALESCE`** everywhere (ANSI, portable, n-ary). dbt: 'Use coalesce instead of ifnull or nvl.' Note SQL Server's `ISNULL` and `COALESCE` differ subtly in return-type determination and NULL-ability of the result - another reason to standardize on `COALESCE`.

- **NULL ordering in `ORDER BY`**:

| Engine | Default NULL sort | `NULLS FIRST/LAST` clause |
|---|---|---|
| PostgreSQL | NULLs sort as **largest** (last in ASC, first in DESC) | Supported |
| SQLite | NULLs sort as **smallest** (first in ASC, last in DESC) | Supported (3.30.0+) |
| SQL Server | NULLs sort as **smallest** (first in ASC) | **Not supported** - emulate with `ORDER BY CASE WHEN col IS NULL THEN 1 ELSE 0 END, col` |

This is a portability trap: the *default* placement differs between PostgreSQL and the other two, and only SQL Server lacks the explicit clause.

### 7. Comments and documentation
- **Both styles are portable**: `--` single-line (to end of line) and `/* ... */` block comments work in all three engines.
- sqlstyle.guide: 'Use the C style opening `/*` and closing `*/` where possible otherwise precede comments with `--`.'
- **Header comment for stored procedures/functions**: document purpose, parameters, author/date, and change history. This is standard practice for T-SQL and PL/pgSQL routines.
- Comment *why*, not *what*; annotate complex CTEs and non-obvious business logic (GitLab, dbt). dbt: a comment signals the SQL below is important/complex enough to warrant attention.
- PostgreSQL also supports the `COMMENT ON` statement to attach persistent documentation to objects in the catalog.

### 8. CTEs and subqueries
- **When to use which**:
  - **CTE**: multi-step logic, readability, referencing the same intermediate set multiple times, recursion. GitLab: 'CTEs make SQL more readable and are more performant'; 'Use CTEs to reference other tables. Think of these as import statements.' dbt/GitLab: each CTE should 'perform a single, logical unit of work.'
  - **Subquery**: simple, single-use, e.g. `WHERE id IN (SELECT ...)`. If nesting exceeds one level, refactor to CTEs.
  - **Temp table**: when an intermediate result is large, reused across statements, or benefits from its own index/statistics; or to break up a query the optimizer handles poorly. Note sqlstyle.guide's caution: 'Avoid the use of `UNION` clauses and temporary tables where possible' if the schema can be optimized instead.
- **Materialization caveat**: In PostgreSQL before v12, CTEs were an optimization fence (always materialized); v12+ can inline them (use `MATERIALIZED`/`NOT MATERIALIZED` to control). SQL Server and SQLite generally inline/optimize CTEs.
- **Recursive CTE syntax difference**:

| Engine | Keyword |
|---|---|
| PostgreSQL | **`WITH RECURSIVE`** (required) |
| SQLite | **`WITH RECURSIVE`** (required; supported since 3.8.3) |
| SQL Server | **`WITH`** only - the `RECURSIVE` keyword is **not used** (and will error if included) |

SQL Server also supports `OPTION (MAXRECURSION n)` to cap recursion depth (default 100); this hint is not valid in PostgreSQL/SQLite. All three follow the anchor-member + `UNION ALL` + recursive-member structure.

### 9. Transactions and error handling
- **Basic transaction control** (`BEGIN`/`COMMIT`/`ROLLBACK`) exists in all three, with syntax differences:
  - PostgreSQL: `BEGIN;` ... `COMMIT;`/`ROLLBACK;` (also `START TRANSACTION`). Savepoints: `SAVEPOINT sp; ROLLBACK TO sp;`.
  - SQL Server: `BEGIN TRANSACTION` ... `COMMIT`/`ROLLBACK`; nested-transaction depth tracked via `@@TRANCOUNT`; savepoints via `SAVE TRANSACTION`.
  - SQLite: `BEGIN;` (or `BEGIN IMMEDIATE`/`EXCLUSIVE`) ... `COMMIT;`/`ROLLBACK;`; savepoints supported.
- **Error handling**:
  - **SQL Server**: `BEGIN TRY ... END TRY BEGIN CATCH ... END CATCH`. Best-practice pattern (Erland Sommarskog, *Error and Transaction Handling in SQL Server*): put `SET XACT_ABORT, NOCOUNT ON` at the top of every procedure; in the CATCH block, roll back if `@@TRANCOUNT > 0` (or check `XACT_STATE()`), then re-raise with `THROW` (SQL Server 2012+, preferred over `RAISERROR` because `THROW` re-raises the original error faithfully). Critical limitation: TRY/CATCH does **not** catch compile-time/syntax errors in the same scope, nor severity-20+ connection-terminating errors. Report error details with `ERROR_MESSAGE()`, `ERROR_NUMBER()`, `ERROR_LINE()`, etc.
  - **PostgreSQL**: no TRY/CATCH in plain SQL; use `BEGIN ... EXCEPTION WHEN ... THEN ... END` blocks inside PL/pgSQL functions/`DO` blocks.
  - **SQLite**: no procedural error handling in SQL; errors are handled in the host application. Use `ON CONFLICT` clauses for constraint handling.
- **Isolation levels**: all support standard ANSI levels. PostgreSQL defaults to READ COMMITTED and offers true SERIALIZABLE (Serializable Snapshot Isolation). SQL Server defaults to READ COMMITTED (and offers `READ_COMMITTED_SNAPSHOT`/`SNAPSHOT`). SQLite is effectively SERIALIZABLE with database-level locking (WAL mode allows concurrent readers with one writer).

### 10. Dialect-specific gotchas and portability

#### Row limiting / pagination
| Task | PostgreSQL | SQL Server | SQLite |
|---|---|---|---|
| Top N | `LIMIT n` | `SELECT TOP (n) ...` | `LIMIT n` |
| Pagination | `LIMIT n OFFSET m` | `OFFSET m ROWS FETCH NEXT n ROWS ONLY` (2012+; requires `ORDER BY`) | `LIMIT n OFFSET m` |
| ANSI standard | `OFFSET m FETCH NEXT n ROWS ONLY` also supported | `OFFSET/FETCH` is the ANSI form | `LIMIT`/`OFFSET` |

`LIMIT`/`OFFSET` is shared by PostgreSQL and SQLite; SQL Server uses `TOP` for simple cases and `OFFSET/FETCH` for pagination (and requires `ORDER BY` with it). Always use `ORDER BY` with any row-limiting for deterministic results (PostgreSQL docs: 'using different LIMIT/OFFSET values... will give inconsistent results unless you enforce a predictable result ordering with ORDER BY'). Note large `OFFSET` values are inefficient (rows are still computed then discarded); keyset/seek pagination scales better.

#### String concatenation
| Engine | Operator/function |
|---|---|
| PostgreSQL | `\|\|` (ANSI; NULL propagates -> NULL); `CONCAT()` (NULLs treated as empty string) |
| SQL Server | `+` (NULL propagates unless `CONCAT_NULL_YIELDS_NULL` off); `CONCAT()` since 2012 (NULLs -> empty) |
| SQLite | `\|\|` only (no `+` for strings; `+` is numeric) |

`||` is portable between PostgreSQL and SQLite but **not** SQL Server (where `||` is not string concat). `CONCAT()` works in PostgreSQL and SQL Server (2012+) but not older SQLite builds. Most portable within a pair: `CONCAT()` for PG/SQL Server; `||` for PG/SQLite.

#### Identifier quoting
| Engine | Quote character |
|---|---|
| PostgreSQL | `"double quotes"` (ANSI standard) |
| SQL Server | `[square brackets]` (native) or `"double quotes"` (only when `QUOTED_IDENTIFIER ON`) |
| SQLite | `"double quotes"` (standard), also accepts `[brackets]` and `` `backticks` `` for MySQL/SQL Server compatibility |

sqlstyle.guide: if you must quote, use SQL-92 double quotes for portability. **Best practice: avoid needing to quote at all** by using lowercase `snake_case` non-reserved identifiers.

#### UPSERT
| Engine | Syntax |
|---|---|
| PostgreSQL | `INSERT ... ON CONFLICT (col) DO UPDATE SET ...` (v9.5+; use `EXCLUDED.col` for incoming values); `MERGE` since v15 |
| SQL Server | `MERGE` statement (`WHEN MATCHED` / `WHEN NOT MATCHED [BY SOURCE]`); requires a trailing semicolon (omitting it raises error 10713) |
| SQLite | `INSERT ... ON CONFLICT(col) DO UPDATE SET ...` (v3.24+, mirrors PostgreSQL, uses lowercase `excluded`); legacy `INSERT OR REPLACE` (delete-then-insert - **not a true upsert**, loses unspecified columns) |

`ON CONFLICT` is shared PostgreSQL/SQLite. SQL Server's `MERGE` is more general (can also DELETE for full sync) but more verbose. Note a **contested caveat**: Aaron Bertrand ('Use Caution with SQL Server's MERGE Statement', MSSQLTips) warns that 'unless you use a HOLDLOCK hint on your MERGE target, your statement is vulnerable to race conditions', so some practitioners prefer an explicit `UPDATE`-then-`INSERT` or `MERGE ... WITH (HOLDLOCK)`. The opposing view (Hugo Kornelis, 'An update on MERGE', SQLServerFast, Sept 2023) concludes that if you do not target a temporal table and do not use the DELETE action, then it is safe to use MERGE. The pragmatic default: use `MERGE` with `HOLDLOCK` under concurrency, or avoid it for single-row upserts in favor of an explicit pattern.

#### Auto-increment (see §5 also)
| Engine | Syntax |
|---|---|
| PostgreSQL | `GENERATED ALWAYS AS IDENTITY` (preferred) / `serial` (legacy) |
| SQL Server | `IDENTITY(1,1)` |
| SQLite | `INTEGER PRIMARY KEY` (auto) / `... AUTOINCREMENT` (only to prevent ID reuse) |

#### Boolean literals
PostgreSQL `TRUE`/`FALSE`; SQL Server `1`/`0` (BIT); SQLite `1`/`0` (or `TRUE`/`FALSE` aliases since 3.23).

#### Common date/time functions
Current timestamp: PostgreSQL `now()` / `CURRENT_TIMESTAMP`; SQL Server `GETDATE()` / `SYSDATETIME()` / `CURRENT_TIMESTAMP`; SQLite `CURRENT_TIMESTAMP` / `datetime('now')`. These are heavily dialect-specific - isolate them if you need portability.

### 11. Performance-adjacent conventions (that are also style)
- **Write SARGable predicates** ('Search ARGument able'): do **not** wrap an indexed column in a function or expression in the `WHERE`/`JOIN`/`ORDER BY`. `WHERE YEAR(order_date) = 2024` forces a scan; rewrite as `WHERE order_date >= '2024-01-01' AND order_date < '2025-01-01'`. `WHERE col + 0 = @x` or `WHERE UPPER(name) = 'X'` are non-SARGable (any function on the column side prevents an index seek). This is a *style* rule because it is about how you *write* the equivalent logic. For genuine case-insensitive search, use a computed/persisted column + index (SQL Server) or a functional index / `citext` (PostgreSQL).
- **Avoid implicit type conversions**: comparing an indexed `varchar` column to an `nvarchar` parameter in SQL Server converts *every row* (NVARCHAR has higher data-type precedence), defeating the index. Match parameter types to column types; make casts explicit and on the constant side.
- **`EXISTS` vs `IN`**: prefer `EXISTS`/`NOT EXISTS` for correlated existence checks, especially where the subquery can return NULLs (`NOT IN` + NULL = wrong results). Modern optimizers often treat `IN`/`EXISTS` similarly for simple cases, but `NOT EXISTS` is the safe, correct default.
- **Leading-wildcard `LIKE '%x'`** is non-SARGable (cannot use a B-tree index); trailing-wildcard `LIKE 'x%'` is SARGable.
- **`LIKE` case-sensitivity**: PostgreSQL `LIKE` is case-sensitive - use `ILIKE` for case-insensitive (GitLab prefers `LOWER(col) LIKE '%match%'` to reduce stray-capital surprises). SQL Server `LIKE` case-sensitivity follows collation. SQLite `LIKE` is case-insensitive for ASCII by default.
- **`UNION ALL` over `UNION`** unless you specifically need dedup - `UNION` adds a sort/distinct pass (dbt, GitLab: 'Prefer `UNION ALL` to `UNION`. This is because a `UNION` could indicate upstream data integrity issues that are better solved elsewhere').

### 12. Security conventions
- **Always parameterize user-supplied values; never build SQL by string concatenation of untrusted input.** This is the single most important defense against SQL injection. Use bound parameters/prepared statements (`$1`, `?`, `@param` depending on driver/engine) rather than interpolating values into the SQL text.
- The full sink-by-sink treatment - dynamic SQL (`sp_executesql`, `format()` with `%L`/`%I` + `USING`), identifier allowlisting, least-privilege grants, `SECURITY DEFINER` + `search_path` hardening - is the `database-security` skill's; this file keeps only the style-level rule above.

## Recommendations

**Stage 1 - Adopt a baseline house style (do this first).** Choose and document, in a `SQL_STYLE.md` co-located with your code:
- Identifiers: lowercase `snake_case`, unquoted, non-reserved. (Sidesteps all three engines' folding/casing differences.)
- Keywords: UPPERCASE (or lowercase if you are a dbt shop - just be consistent).
- One column per line; trailing commas; left-aligned root keywords; 4-space indent; ~100-char lines.
- Explicit column lists; ANSI JOINs; `AS` for aliases; qualify all columns in multi-table queries.
- Explicitly named constraints with `pk_`/`fk_`/`uq_`/`ck_`/`ix_` prefixes.

**Stage 2 - Enforce it automatically.** Add **SQLFluff** (supports Postgres, T-SQL, and SQLite dialects) to pre-commit hooks and CI. Automated linting is what makes a style guide stick; GitLab, dbt, and Meltano all rely on it. Benchmark to change the plan: if linting produces excessive false positives on legitimate dialect features, tune the ruleset rather than abandoning it.

**Stage 3 - Codify the portability rules that bite.** Maintain the cheat-sheet below and require code review to flag any use of `SELECT *` in persistent code, `NOT IN` with a nullable subquery, non-SARGable predicates, `sp_` prefixes, or unparameterized dynamic SQL.

**Stage 4 - Decide your portability posture explicitly.** If you target one engine, use its idioms freely (`timestamptz` + `ON CONFLICT` + `GENERATED AS IDENTITY` on Postgres; `datetime2` + `MERGE` + `THROW` + `IDENTITY` on SQL Server; `INTEGER PRIMARY KEY` + `ON CONFLICT` on SQLite). If you must support multiple engines, restrict to ANSI constructs, prefer `COALESCE`/`CONCAT`, avoid `NULLS FIRST/LAST` (or abstract it), and isolate all date/time and pagination logic. **Threshold to revisit**: the moment you add a second target engine, promote the cheat-sheet's divergence rows into hard lint rules and code-review gates.

### Cheat-sheet: dialect quick reference
| Feature | PostgreSQL | SQL Server (T-SQL) | SQLite |
|---|---|---|---|
| Unquoted identifier case | folds to lowercase | preserves, compares case-insensitively (default) | case-insensitive (ASCII) |
| Identifier case style | `snake_case` unquoted | `PascalCase` is the engine idiom (`dbo.CustomerOrders`); it wins on SQL Server unless the project says otherwise | `snake_case` |
| Identifier quoting | `"x"` | `[x]` or `"x"` | `"x"`, `` `x` ``, `[x]` |
| String concat | `\|\|`, `CONCAT()` | `+`, `CONCAT()` | `\|\|` |
| Top N | `LIMIT n` | `TOP (n)` | `LIMIT n` |
| Pagination | `LIMIT/OFFSET` | `OFFSET/FETCH` (needs ORDER BY) | `LIMIT/OFFSET` |
| UPSERT | `ON CONFLICT` / `MERGE` (15+) | `MERGE` (+HOLDLOCK) | `ON CONFLICT` / `INSERT OR REPLACE` |
| Auto-increment | `GENERATED ... AS IDENTITY` / `serial` | `IDENTITY(1,1)` | `INTEGER PRIMARY KEY` [`AUTOINCREMENT`] |
| Boolean | `boolean` (`TRUE`/`FALSE`) | `BIT` (`1`/`0`) | integer `0`/`1` (`TRUE`/`FALSE` aliases) |
| Null coalesce | `COALESCE` | `COALESCE`/`ISNULL` | `COALESCE`/`IFNULL` |
| `NULLS FIRST/LAST` | yes | no (use CASE) | yes (3.30+) |
| Recursive CTE | `WITH RECURSIVE` | `WITH` (no RECURSIVE) + `OPTION(MAXRECURSION)` | `WITH RECURSIVE` |
| Preferred string type | `text` | `nvarchar` | `TEXT` |
| Preferred timestamp | `timestamptz` | `datetime2`/`datetimeoffset` | ISO-8601 `TEXT` |
| UUID | `uuid` (`gen_random_uuid()` v13+) | `uniqueidentifier` (`NEWID()`) | `TEXT`/`BLOB` |
| Error handling | PL/pgSQL `EXCEPTION` | `TRY/CATCH` + `THROW` | app layer |
| Default schema | `public` | `dbo` | `main` |
| Current timestamp | `now()` | `SYSDATETIME()`/`GETDATE()` | `CURRENT_TIMESTAMP` |

