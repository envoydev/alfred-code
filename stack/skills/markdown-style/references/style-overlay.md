# Markdown style overlay

The 'what is good' layer. Distilled from Google's developer documentation Markdown style guide (https://google.github.io/styleguide/docguide/style.html, Apache 2.0). For the 'what is valid' layer, see `syntax-canon.md`.

Findings in this file are **should-fix**, not must-fix. The user can decline any finding without justification - these rules are opinionated. Where the project has a local convention that conflicts with a rule here, defer to the project.

The skill cites style findings by short name (e.g., `style/headings/atx-only`) so the user can locate them here.

## Contents

Every rule name in this file, by section - search the name verbatim to jump to its entry.

- **Authoring philosophy** - `style/philosophy/minimum-viable`, `style/philosophy/better-than-best`
- **Headings** - `style/headings/atx-only`, `style/headings/single-h1`, `style/headings/unique-names`, `style/headings/sentence-case-and-product-names`, `style/headings/blank-lines-around`
- **Document skeleton** - `style/skeleton/recommended`, `style/skeleton/title-matches-filename`, `style/skeleton/intro-1-to-3-sentences`, `style/skeleton/see-also-section`
- **Table of contents** - `style/toc/use-when-long`, `style/toc/renderer-support`, `style/toc/placement`
- **Line length** - `style/line-length/80`, `style/line-length/exceptions`
- **Whitespace and line breaks** - `style/whitespace/no-trailing`, `style/line-breaks/sparingly`
- **Lists** - `style/lists/lazy-numbering-long`, `style/lists/full-numbering-short`, `style/lists/indent-4`, `style/lists/single-space-only-for-trivial`, `style/lists/prefer-list-to-table`
- **Code** - `style/code/fenced-only`, `style/code/declare-language`, `style/code/inline-backticks-for-escapes`, `style/code/escape-shell-newlines`, `style/code/inside-lists`
- **Links** - `style/links/repo-absolute`, `style/links/avoid-relative-traversal`, `style/links/informative-text`, `style/links/reference-style-when`, `style/links/reference-placement`
- **Images** - `style/images/sparingly`, `style/images/when-justified`, `style/images/alt-text-required`
- **Tables** - `style/tables/scannable-two-dimensional`, `style/tables/avoid-when`, `style/tables/short-cells`
- **HTML** - `style/html/avoid`
- **Capitalization** - `style/capitalization/preserve-names`
- **Items the style overlay does not specify** - prose, no rule names

## Authoring philosophy

### `style/philosophy/minimum-viable`

'Minimum viable documentation' - a small, fresh, accurate set of docs beats a sprawling stale one. Delete cruft frequently.

### `style/philosophy/better-than-best`

Reviewers should LGTM quickly when the change is reasonable, suggest concrete alternatives instead of blocking, and only block when the change makes the docs worse. Authors should not bikeshed.

## Headings

### `style/headings/atx-only`

Use ATX style (`#`, `##`, ...). Do not use setext (`===` / `---` underlines). Setext is 'annoying to maintain' and cannot express H3 or below.

### `style/headings/single-h1`

Exactly one H1 per document, used as the title. Subsequent headings start at H2. The H1 should match (or nearly match) the filename - both are read as the document's identifier.

### `style/headings/unique-names`

Avoid bare repeated subheadings like 'Summary' or 'Example' under multiple parents. Prefix with the parent topic - 'Foo summary', 'Bar summary' - so the auto-generated anchor is intuitive.

### `style/headings/sentence-case-and-product-names`

Follow the project's title-case convention (the original Google guide refers out to a broader prose style guide for this). Always preserve product / tool / binary name capitalization - write `Markdown`, not `markdown`; `GitHub`, not `github`.

### `style/headings/blank-lines-around`

Always put a blank line before and after the heading. This is technically a syntax rule too, but the style overlay enforces it strictly - some processors recover, but the source must be portable.

## Document skeleton

### `style/skeleton/recommended`

The recommended document skeleton:

```markdown
# Document Title

<optional one-line author or owner indication>

<1-3 sentence introduction, written for a newcomer who knows the system exists but not this doc.>

<table of contents for a long doc - see style/toc/renderer-support>

## Topic

…

## Another topic

…

## See also

- [Related doc](/path/to/related.md)
```

The skeleton is not mandatory, but every deviation should have a reason.

### `style/skeleton/title-matches-filename`

The H1 title should match (or nearly match) the filename. `request-routing.md` -> `# Request routing`, not `# How the Routing System Works`.

### `style/skeleton/intro-1-to-3-sentences`

The intro is 1-3 sentences and answers 'what is this doc, who is it for, what will I get from it'. Longer intros become unread preamble.

### `style/skeleton/see-also-section`

A final `## See also` section is the canonical location for links the reader might want next. Reference-style links inside `See also` keep it scannable.

## Table of contents

### `style/toc/use-when-long`

Give any document that does not fit on one laptop screen a table of contents. Short docs do not need one - it adds noise.

### `style/toc/renderer-support`

Write the `[TOC]` directive only where the renderer supports it - Gitiles (the host Google's guide is written for), GitLab, and Python-Markdown's `toc` extension each replace it with the heading list. GitHub has no such directive (it builds its own Outline menu from the headings), so there `[TOC]` renders as literal text. Elsewhere - GitHub, or a renderer you cannot name - a long doc gets a `## Contents` list of anchor links (the shape this skill's own references use), or none on GitHub, whose Outline menu already lists the headings.

### `style/toc/placement`

Place the table of contents between the introduction and the first `## H2` - the `[TOC]` line where the renderer supports it, else the `## Contents` list. Position matters for screen readers and keyboard navigation, since the table of contents lands at that point in the DOM.

## Line length

### `style/line-length/80`

Wrap prose lines at 80 characters. Rationale: Code Search does not soft-wrap, and 80 mirrors the surrounding code conventions.

### `style/line-length/exceptions`

The 80-character rule does not apply to:

- Links (one URL per line is fine even if it overflows).
- Table rows (cell content cannot wrap; the line will be as long as the widest cell).
- Headings (a heading is one logical line).
- Code blocks (preserve the original code).

The prose **around** a long link still wraps - only the line with the link is allowed to overflow.

## Whitespace and line breaks

### `style/whitespace/no-trailing`

No trailing whitespace on any line. This overrides the syntax-valid two-trailing-spaces-for-`<br>` trick because trailing whitespace is invisible, removed by IDE cleanup, and rejected by presubmit checks. Use a paragraph break (blank line) instead.

### `style/line-breaks/sparingly`

Use a trailing `\` for hard breaks sparingly. Prefer paragraph breaks for separation; prefer block-level constructs (lists, blockquotes) for structure.

## Lists

### `style/lists/lazy-numbering-long`

For long or nested ordered lists, use lazy numbering - repeat `1.` on every item. Rationale: editing is easier (no renumbering after an insert), and rendered output is identical.

### `style/lists/full-numbering-short`

For short, stable, top-level ordered lists, fully numbered (`1.`, `2.`, `3.`) is fine and more readable in the raw source.

### `style/lists/indent-4`

Nested items and wrapped item text use 4-space indentation in a file with no nesting yet; a file that already nests at another consistent width (2 spaces under a `-` bullet is the common one) keeps it. Two spaces after the item number / three spaces after a bullet, so all content aligns at column 4. Wrapped text inside a nested item needs 8-space indent.

### `style/lists/single-space-only-for-trivial`

Single-space (`* Foo`) is acceptable only when the list is short, flat, and every item is single-line. For anything else, prefer the 2-spaces-after-number form so continuations align cleanly.

### `style/lists/prefer-list-to-table`

Prefer a list to a table when the data is one-dimensional. Tables are for two-dimensional data with parallel attributes.

## Code

### `style/code/fenced-only`

Always use fenced code blocks (` ``` `). Do not use 4-space-indented blocks. Rationale: indented blocks cannot specify a language, have ambiguous boundaries, and are harder to find in Code Search.

### `style/code/declare-language`

Always declare a language on the fence:

````markdown
```python
…
```
````

Use `text` (or `none`) when there is genuinely no language.

### `style/code/inline-backticks-for-escapes`

Use inline backticks for short code, field names, file types (` `README.md` `), and to escape strings that should not be auto-linked or parsed - fake paths, example URLs containing `$VAR`, placeholder identifiers.

### `style/code/escape-shell-newlines`

In shell snippets that wrap, escape the newline with `\` so users can copy-paste the whole command:

```bash
docker run --rm \
  --name example \
  -p 8080:8080 \
  example:latest
```

### `style/code/inside-lists`

Fenced code blocks inside lists must indent to align with the list item's text - 4 spaces from the bullet, 4 more spaces for any extra nesting level.

## Links

### `style/links/repo-absolute`

For links within the same repo, prefer explicit absolute paths: `[…](/path/to/page.md)`. Do not use the full `https://…` URL for in-repo links - it breaks when the repo moves.

### `style/links/avoid-relative-traversal`

`../` relative paths are fragile. Same-directory relative (`./neighbor.md`) is fine; anything that traverses up is not.

### `style/links/informative-text`

The link text must be informative. Never use 'here', 'link', 'this', or the raw URL as the label. Write the sentence naturally, then wrap the most meaningful phrase.

- Bad: For more information, click [here](url).
- Good: See the [request-routing reference](url) for the full middleware order.

### `style/links/reference-style-when`

Use reference-style links when:

- The inline URL would hurt the readability of the surrounding sentence.
- The same destination is referenced multiple times - reference-style eliminates duplication.
- The link sits inside a table cell, because cells cannot wrap a long URL.

Do not use reference-style when the URL is short and inline would read just as cleanly.

### `style/links/reference-placement`

Reference link definitions go just before the next heading, at the end of the section where the link is first used. Treat them like footnotes scoped to a section.

Exception: a link used across multiple sections goes at the end of the document, so moving a section does not leave a dangling reference.

## Images

### `style/images/sparingly`

Use images sparingly. Prose tends to age better than screenshots.

### `style/images/when-justified`

Use an image when showing is genuinely easier than describing - UI navigation, architectural diagrams, chart output. Otherwise prefer prose.

### `style/images/alt-text-required`

Always include alt text. The alt text is the only content available to a non-sighted reader.

## Tables

### `style/tables/scannable-two-dimensional`

Use tables only for scannable, tabular data with two-dimensional structure and many parallel items with distinct attributes.

### `style/tables/avoid-when`

Avoid tables that exhibit:

- Poor distribution - many empty cells, or one column that does not vary.
- Unbalanced row-to-column ratio - too tall and narrow, or too wide and short.
- Rambling prose in cells - Markdown cannot wrap cell text across lines.

### `style/tables/short-cells`

Tables may exceed the 80-character line-length rule. Keep cells short. Use reference-style links inside cells to keep widths reasonable.

## HTML

### `style/html/avoid`

Strongly prefer Markdown to HTML. The one acknowledged exception is large tables that need features Markdown tables cannot express (colspan, rowspan, nested block content). Note that some renderers (the original guide cites Gitiles) do not render HTML at all.

## Capitalization

### `style/capitalization/preserve-names`

Preserve product / tool / binary capitalization in headings and prose alike: `Markdown`, `GitHub`, `Kubernetes`, `npm` (yes, lowercase), `iOS`, `kubectl`.

## Items the style overlay does not specify

The source guide is deliberately silent on:

- **Emphasis convention** - `**bold**` vs `__bold__`, `*italic*` vs `_italic_`. The syntax canon already covers compatibility; the style overlay does not pick a winner. Follow project convention.
- **File naming** - only that the H1 should match or nearly match the filename. No imposed kebab-case vs snake_case rule.
- **Hard document length thresholds** - only the qualitative 'above the fold on a laptop' criterion for whether a table of contents is justified.

When the user asks 'what should I do about X' and X is on this list, the skill responds: the style guide is silent - follow the project's existing convention, or pick one and apply it consistently.
