---
name: markdown-style
description: "Load when authoring or restructuring any .md, or on 'lint / style-check / fix this markdown', 'ATX vs setext', 'use a TOC?'. Not for prose clarity or spelling."
---

# markdown-style

The Markdown authoring and review skill. Owns two layers of rules and the procedure for applying them:

1. **Syntax canon** - what valid, portable Markdown looks like. Full canon: `references/syntax-canon.md`.
2. **Style overlay** - opinionated rules a reviewer enforces on top of valid syntax. Full overlay: `references/style-overlay.md`.

The question this skill answers is **'is this doc well-formed?'** - not 'does this doc belong here?' Style review never decides whether a doc should exist; it assumes the doc earned its place and asks whether the prose structure and Markdown are clean.

**One load per session, and the tables below are the whole check.** This is a before-write check,
not a companion that rides along: load it once, run both passes over the docs this session writes,
and do not re-load it for the next `.md` - it is already in context. Neither `references/` file is
opened unless a specific rule the two quick-reference tables do not settle is actually in dispute
(measured: one session carried this skill across 11 messages for 1.6M cache-read tokens - ~52% of
that session's whole cache-read, for a single style check on one file).

## When to use

Load when authoring or restructuring any .md (README, ADR, runbook, how-to, design doc) or on an explicit 'lint / style-check / fix this markdown', 'ATX vs setext', 'should I use a TOC?', or 'fix the headings / list indentation' ask.

The two-layer rule set (syntax canon = valid, portable Markdown from the Markdown Guide; style overlay = opinionated house form from Google's style guide) plus the review procedure.

Markdown form only - not prose clarity (that is Vale), spelling (codespell / hunspell) or another markup (AsciiDoc, reStructuredText, org-mode, MDX - each has its own canonical rules).

## How to run a review

**The generated docs root is NOT governed here, and neither are the generated rules.** Skip every document under `<docs-path>` and every generated `.claude/rules/alfred-project-*.md` or `.claude/rules/project-code-style.md` - the skill that writes each one fixes its shape verbatim, down to the frontmatter, and a style pass over it pulls one file two ways.

Two passes, syntax before style. The reviewer reads a syntax violation differently from a style violation, so do not interleave them.

### Pass 1 - syntax (must-fix)

Run `markdownlint` first when it is available - the mechanical checks (heading style, list markers, blank lines around blocks, fence style) are its job, and each hit maps onto a canon rule; then walk the file top to bottom for what a linter cannot see. Syntax violations are bugs (invalid or non-portable Markdown: setext where ATX is expected, unfenced code block, missing blank line around a block element, `)` instead of `.` in an ordered list, missing space after `#`), not judgment calls - **fix them directly in one Edit pass**. No approval gate; the diff is self-explaining and each fix cites the quick-reference row it breaks (e.g. 'syntax: Headings'), and a reference short name only when that file was opened for a dispute.

### Pass 2 - style (should-fix)

Re-walk for style-overlay violations. These are opinionated. **Apply the clear wins directly** - fenced blocks with a language tag, single H1 as the title, informative link text (never 'here'), no trailing whitespace, product-name capitalization. **Batch the genuine judgment calls** - a table of contents on a borderline-length doc, table-vs-list, reference-vs-inline links, heading-uniqueness prefixes - into one short list, each with a recommendation, and move. Do not gate each finding on a reply.

Defer to the project on any conflict with a local convention (e.g. a repo standardized on `_underscore_` emphasis) - note the conflict, defer, move on. No audit markers or `[reviewed]` stamps in the file; the diff is the audit trail.

**Close.** Re-run `markdownlint` on every file you edited and quote its summary line (no output is the pass - say so); without it installed, say the syntax pass was by eye and mark it UNVERIFIED.

## The two layers - quick reference

Detailed rules with examples live in `references/`. These summaries cover the violations that account for most findings.

### Syntax (must-fix)

| Construct           | Rule                                                                            |
|---------------------|---------------------------------------------------------------------------------|
| Headings            | ATX (`#`-`######`), space after `#`, blank lines before and after.              |
| Paragraphs          | Separated by a blank line. Do not indent.                                       |
| Line breaks         | Trailing-two-spaces is controversial (invisible). Prefer a paragraph break.     |
| Emphasis            | `**bold**`, `*italic*`, `***both***`. Asterisks mid-word (underscores break).   |
| Blockquotes         | `>` prefix; `>` on the blank line between paragraphs; nest with `>>`.           |
| Ordered lists       | `1.` `2.` `3.` (period, not `)`). Start at 1. Numbering can be lazy.            |
| Unordered lists     | Choose one of `-` / `*` / `+`; do not mix within a list.                        |
| Inline code         | Single backticks. Double backticks if the code contains a backtick.             |
| Code blocks         | Fenced with a language tag. Indented blocks are valid but discouraged.          |
| Horizontal rule     | Three or more `---` / `***` / `___` alone on a line with blank lines around.    |
| Links               | `[text](url)`. Autolink with `<https://...>`. Reference links resolve elsewhere.|
| Images              | `![alt](path "title")`. Always include alt text.                                |
| Inline HTML         | Allowed. Separate block-level HTML with blank lines. Do not indent the tags.    |

Full canon with examples and known-broken edge cases: `references/syntax-canon.md`.

### Style (should-fix)

| Concern               | Rule                                                                                          |
|-----------------------|-----------------------------------------------------------------------------------------------|
| H1                    | Exactly one H1, used as the document title (match or nearly match the filename). Rest start at H2. |
| Heading style         | ATX only. No setext underlines.                                                               |
| Heading uniqueness    | Avoid bare repeated subheadings ('Summary', 'Example') under multiple parents. Prefix them.   |
| Document skeleton     | Title -> optional owner -> 1-3 sentence intro -> table of contents (long docs) -> `## Topic` sections -> `## See also`. |
| Table of contents     | Any doc that would not fit on one screen, between intro and first H2: `[TOC]` only where the renderer supports it (Gitiles, GitLab); GitHub prints it as literal text, so there a `## Contents` list of anchor links, or none. |
| Line length           | 80 chars. Exceptions: links, tables, headings, code blocks. Prose around a long link still wraps. |
| Trailing whitespace   | None. Prefer a paragraph break to the two-space line-break trick.                             |
| Lists                 | Lazy numbering (`1.` repeated) for long lists; full numbering for short stable ones. Prefer lists to tables for one-dimensional data. Nested content: keep the file's existing indent (2-space content-aligned is valid CommonMark); 4 spaces only in a file with none. |
| Code fencing          | Always fenced, never indented. Always declare a language (`text` if none). Escape wrapped shell newlines with `\`. |
| Links                 | Repo-absolute paths (`/path/to/page.md`) over `https://...` for in-repo links. Avoid `../` traversal. |
| Link text             | Informative. Never 'here', 'link', or a raw URL.                                              |
| Reference links       | Use in tables, when the URL hurts readability, or when a target repeats. Define just before the next heading. |
| Tables                | Only for scannable two-dimensional data. No prose cells (cells cannot wrap).                  |
| Images                | Sparingly. Always alt text.                                                                    |
| Capitalization        | Preserve product / tool / binary capitalization (`Markdown`, not `markdown`; `npm`, `iOS`).   |

Full overlay with rationales: `references/style-overlay.md`.

## Hard limits

- Never invent rules. Every finding cites a rule - a quick-reference row, or the reference entry when one was opened.

## Examples

<example>
<user_query>Is `===` under a heading line valid Markdown?</user_query>
<response>
Yes - that is setext-style H1, valid Markdown. But the style overlay (and Google's guide) prefer ATX (`# Heading`): setext is annoying to maintain, cannot express H3 or below, and obscures the level when scanning. Recommendation: replace `===` with a single `#` - a syntax-equivalent rewrite.
</response>
</example>

<example>
<user_query>Lint this README - the formatting is messy.</user_query>
<response>
Reviewing `./README.md` - the only README in the tree (several would go through one AskUserQuestion, the root one marked Recommended). Pass 1 fixes syntax bugs (fences, blank lines, ATX headings, list markers) directly. Pass 2 applies the clear style wins and flags any judgment calls (TOC, table-vs-list) as a short list.
</response>
</example>

## Attribution

Distilled from the Markdown Guide (CC BY-SA 4.0) and Google's Markdown style guide (Apache 2.0); link out, never paste long excerpts.
