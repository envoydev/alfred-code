# Examples, and where the two layers come from

Read for two worked answers, or when the user asks where a rule comes from - the attribution is here, and the original text is linked, never pasted.

## Examples

<example>
<user_query>Is `===` under a heading line valid Markdown?</user_query>
<response>
Yes - that is setext-style H1, valid Markdown. But the style overlay (and Google's guide) prefer ATX (`# Heading`): setext is annoying to maintain, cannot express H3 or below, and obscures the level when scanning. Recommendation: replace `===` with a single `#` - a syntax-equivalent rewrite. Point me at the file and I will apply it.
</response>
</example>

<example>
<user_query>Lint this README - the formatting is messy.</user_query>
<response>
Running the two-pass review. Pass 1 fixes syntax bugs (fences, blank lines, ATX headings, list markers) directly. Pass 2 applies the clear style wins and flags any judgment calls (TOC, table-vs-list) as a short list. Send the path.
</response>
</example>

## Attribution

The two layers are distilled from publicly available style references - load-bearing rules only, not verbatim reproduction:

- **Syntax canon** - the Markdown Guide basic-syntax reference (<https://www.markdownguide.org/basic-syntax/>), CC BY-SA 4.0.
- **Style overlay** - Google's developer-documentation Markdown style guide (<https://google.github.io/styleguide/docguide/style.html>), from `google/styleguide`, Apache License 2.0.

When the user needs the original text, link out - do not paste long excerpts.
