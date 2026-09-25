---
name: docs-as-code
description: "Load before writing or reviewing ANY documentation artifact of these types, whatever the subject - a sequence, ER or C4 diagram in Markdown, an ADR or decision-log entry, or a diagram-tooling choice (Mermaid vs DBML vs Structurizr). NOT the repo's committed architecture capture (`alfred-capture-architecture` owns <docs-path>/architecture/), not Markdown prose style, and not database design itself. Authoring conventions for documentation as versioned text - Mermaid diagrams, decision records (ADR - Nygard + MADR 4) and C4 model views, routed per doc type to references/."
---

# Docs as Code - documentation artifacts as versioned text

Documentation is a text artifact in git: diffable, PR-reviewed, and rendered natively on
GitHub/GitLab. That is the whole stance - it is what keeps docs from rotting - and it applies to
any subject, not just architecture: an API flow, a schema, a process, a decision. Diagrams live
inline in the doc they explain (a standalone `.mmd` only when several docs share one).
Structure goes in diagrams; rationale goes in ADRs; the two link to each other, never restate
each other.

## Pick the artifact

| Documenting | Use | Reference |
|---|---|---|
| An interaction ordered in time - API call chain, auth handshake, retry/timeout, event choreography | Mermaid sequence diagram | `references/mermaid-sequence.md` |
| A relational schema sketch - a handful of tables, keys, cardinality | Mermaid ER diagram | `references/mermaid-er.md` |
| A load-bearing decision - structure, cross-cutting NFRs, external dependencies, interfaces | ADR - Nygard by default, MADR 4 when options were weighed; numbered by `node .claude/hooks/docs.js adr new '<title>'` | `references/adr.md` |
| System-in-environment or deployable-parts structure, incl. for stakeholders | C4 context/container view | `references/c4.md` |
| THIS project's architecture map | owned by `alfred-capture-architecture` (flowchart + module table per its doc-shapes contract) - supplement it, never re-draw it |

Branching business logic is a flowchart, not a sequence diagram; static structure is ER/C4, not
sequence. When a diagram and an ADR both apply (a decision that changed structure), write both -
the ADR names the why, the diagram shows the outcome, each links the other.

## Mermaid ground rules (both diagram types)

- Fence with the language id exactly `mermaid` - renders natively on GitHub, GitLab, Azure
  DevOps, and the VS Code preview, no plugins. Standalone diagrams are `.mmd` files.
- Renderers lag the library (GitLab and wiki plugins run older majors). Before relying on newer
  syntax: (1) preview on mermaid.live, (2) render on the actual target platform, (3) quote the
  result of that render - or say plainly that it was not rendered. A diagram that has only ever
  been previewed is UNVERIFIED on the platform it ships to.
- Never hardcode a theme in an init directive - it breaks the reader's dark/light mode on GitHub.
  Prefer YAML frontmatter (`title:` + `config:`) over the deprecated init directive.
- Accessibility: `accTitle:` + `accDescr:` inside the diagram, plus one plain-text sentence in
  the surrounding Markdown - screen readers do not get node relationships from the SVG.
- Comments are `%%` on their own line. Colors in rect/box regions take rgb()/rgba() only - hex
  breaks there (hex is fine in theme variables, which accept ONLY hex).
- Mermaid ignores misspelled config keys silently but breaks on malformed syntax; the word end
  unquoted breaks flow/sequence diagrams - wrap it as "end".
- One diagram per concern, sized to one screen. A diagram that needs scrolling is two diagrams.

## The bar

Every diagram carries a title (and a legend when shapes/colors carry meaning); every ADR lists
its consequences including the negative ones. An artifact that would drift silently gets wired to
its source instead: generate ER diagrams from the live schema, regenerate in CI, supersede ADRs
rather than rewriting them.
