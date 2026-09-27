# What this skill does NOT cover

Read when a request drifts past Markdown form - whether a doc should exist, prose terminology, spelling, or another markup.

## What this skill does NOT cover

Markdown **form** only - heading style, list indentation, code-fence language tags, link syntax, line length, and the rest of the two rule sets above. It does not cover:

- **Whether a doc should exist, or where it belongs** - that is a content / architecture decision, not a form review. Style review assumes the doc earned its place.
- **Prose-level enforcement** - terminology consistency, inclusive-language substitutions, banned phrases, voice / tense / mood. Reach for [Vale](https://vale.sh) (a prose linter that runs configurable style packs over Markdown). It composes with this skill: this skill fixes the Markdown form, Vale enforces prose terminology.
- **Spelling and grammar** - use `codespell` / `hunspell` / `LanguageTool` in addition, not instead.
- **AsciiDoc / reStructuredText / org-mode / MDX** - Markdown only; other markup has its own canonical rules (e.g. `asciidoctor --safe-mode`).
