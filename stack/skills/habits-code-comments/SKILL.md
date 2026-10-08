---
name: habits-code-comments
description: "Use when writing a doc comment or an inline comment - XML docs, TSDoc, JSDoc, docstring. Not for READMEs or docs pages, which the docs skills own."
---

# Code comments - the default is none

A comment earns its place only by saying what the code cannot. Every extra one buries the few that
matter and drifts out of date as the code changes.

## When to use

- Fires before writing a doc comment or an inline comment, and when checking the comments in a diff.
- Not for READMEs, ADRs or docs pages, which the docs skills own.

## Precedence

- The codebase's own conventions win: which members get doc comments, tag style, comment language. Infer them from nearby files; apply the defaults below only where no clear pattern exists.
- Comments are English unless the existing comments use another language. The language of the conversation never decides.

## Ticket identifiers

No ticket or work-item id (JIRA-123, #456, an Azure DevOps item) in a comment: it means nothing outside the tracker and belongs in the commit message or PR. Two exceptions: the user wrote the id in the request or asked for it, or a workaround for a third-party bug links the public upstream issue (`dotnet/efcore#12345`), which tells the reader when it can go.

## Doc comments

**When.** Where the project shows no pattern, on public and protected members and on anything a module or library exports. On internal and private members only when the name and signature leave the contract unclear - most private helpers need none.

**Structure.** A doc comment is written complete, because a partial tag set misleads and trips CS1573:

- C# - XML docs: `<summary>`, `<param>` for every parameter, `<typeparam>` for every type parameter, `<returns>` for non-void, `<exception>` for what the member throws by contract (argument validation, domain rules), not for what a dependency might propagate. `<inheritdoc/>` on overrides and interface implementations, never a copy of the base docs.
- TypeScript - TSDoc: summary, `@param`, `@typeParam`, `@returns` for non-void, `@throws` for contract exceptions. No `@private` / `@protected` / `@public` as access markers - the keyword says it, and in TSDoc `@public` is a release tag. Release tags (`@public`, `@beta`, `@alpha`, `@internal`) only where the project uses API Extractor or already uses them.
- JavaScript - the JSDoc equivalents (`@template` for type parameters), plus `@private` / `@protected` on members not meant for public use, since JavaScript has no access modifiers (`#` fields aside).
- Other languages - the idiomatic form: docstrings in the project's own style, a `--` header on a SQL procedure or function.

**Content.** The summary is one sentence on what the member does in domain terms, never how. Each tag is ONE line that adds what the name and type do not - units, valid range, format, null or empty handling, side effects. A tag with nothing to add gets the shortest accurate phrase, never a padded sentence.

## Inline comments

Before a comment inside a body, decide:

1. The code, its enclosing name and the names and constants around it already say why: add nothing. A clearer name, a named constant or an extracted method beats a comment.
2. Add one only when the code cannot express the reason - a non-obvious business rule, a workaround, a performance or ordering constraint, a surprising edge case.
3. Then one short line, the why at that exact spot, never what the code does.

Never add:

- Narration of your change ('Added null check', 'Fixed', 'Changed to use X') - history is the commit message.
- Commented-out code - delete it, version control keeps it.
- A `TODO` or `FIXME` the user did not ask for - unfinished work goes in your report.

## Maintenance

- A change updates or removes the comments it made stale.
- Comments outside the code you are changing are not rewritten, reformatted or deleted.
- Before you finish, check every comment in your diff against this page.

## Examples

Bad - the doc comment restates the signature. Good - every line adds something:

```csharp
/// <summary>This method calculates the total.</summary>
/// <param name="order">The order.</param>

/// <summary>Calculates the order total after discounts, before tax.</summary>
/// <param name="order">Order with at least one line item.</param>
/// <param name="currency">ISO 4217 code matching the order's price list.</param>
/// <returns>Total rounded to the currency's minor unit.</returns>
/// <exception cref="ArgumentException">The order has no line items.</exception>
```

Good - TSDoc:

```ts
/**
 * Formats an amount for display in the user's locale.
 * @param amount - Amount in minor units (cents).
 * @param currency - ISO 4217 code.
 * @returns Localized string, e.g. 1234 with USD gives $12.34.
 */
```

Bad - restates the code and carries a ticket id. Good - nothing:

```csharp
// Loop through the orders and add up the total (JIRA-1234)
foreach (var order in orders) total += order.Amount;
```

Bad - narrates the change. Good - no comment, `SingleOrDefault` already says at most one match:

```csharp
// Changed FirstOrDefault to SingleOrDefault to fix the duplicate bug
var user = users.SingleOrDefault(u => u.Email == email);
```

Acceptable - only when nothing nearby explains the value, one line of why:

```csharp
// Device rejects commands for ~200 ms after connect.
await Task.Delay(200);
```
