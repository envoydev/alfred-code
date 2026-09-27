# Generating the path-scoped style rule, and retiring the legacy hook

Read at step 4, before filling `references/code-style-rule.template.md`, and at step 5 when the legacy hook file exists.

## Why a rule, not a hook

A PreToolUse hook's injected context never reaches a subagent's tool calls; a path-scoped rule reaches the main
session and every dispatched subagent alike, which is why the style core ships as a rule.

## The three placeholders

1. `__PATH_GLOBS__` -> one `  - "**/*.<ext>"` line per observed extension. Derived, not designed.
2. `__STYLE_CORE__` -> the condensed essence of the merge: each language's Enforced + Idioms as tight bullets (keep 'uncertain'/'inconsistent' markers), plus the cross-cutting idioms. Aim small - this text is injected into every session that touches matching code; detail beyond what a writer needs on the spot belongs in the doc, not the rule.
3. `__DOC_PATH__` -> the SAME resolved docs root the doc was just written under, baked as a literal (a rule is static text - it cannot resolve env at load; the next capture re-bakes it if the root moved).

## Retiring the legacy hook

Earlier captures generated `.claude/hooks/inject-code-style.js` + a `settings.json` PreToolUse entry. The rule replaces it (one home per piece - both together would double-inject in main sessions). If the hook file exists: delete it, then parse `.claude/settings.json`, remove the PreToolUse entry whose command references `inject-code-style.js`, and rewrite - never regex-edit JSON, never touch the entries the stack installer wired. Nothing to retire on a clean project: skip silently.
