# Naming stage

A findings-based audit. Review TARGET for names only - identifiers, files, symbols, the public surface. Run after code quality (code may have moved homes) and before logging and comments. Code-structure, logging and comment findings are owned by the other stages - do not flag them here, even when you spot them.

Look for:
- Names that lie about what the thing does, or that no longer match its behavior after an earlier stage moved or reshaped it.
- Vague catch-alls (data, info, manager, helper, util, temp, value, do, handle) where a specific name exists.
- Inconsistent vocabulary - two names for one concept, or one name for two concepts, across the target.
- Casing or word-order that fights the surrounding codebase. The existing convention wins, always.
- Abbreviations a newcomer would have to decode, and single-letter names outside a tiny loop scope.

Severity: a public, exported, or widely-referenced misnomer is MAJOR; a private local with a weak name is MINOR. Rename through the tooling so every reference moves with it; never leave a half-renamed symbol or a dangling old name.

A deviation from a preference is not a finding unless you can name what it breaks - a wrong finding costs more than a missed one.

Bar: zero findings at every severity - real findings only: a candidate with nothing nameable it breaks is not a finding (not recorded, not counted against this bar), `open: []` on pass 1 is a valid, complete result, and every real finding is listed, never trimmed.
