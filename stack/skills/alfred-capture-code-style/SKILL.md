---
name: alfred-capture-code-style
description: "The deliberate project code-style capture. Use when the user asks to capture the project code style or to set up the code-style doc and rule; manual, /-only, and re-run to refresh in place. It fans out code-style-analyzer agents (one per detected language), merges their reports into code-style/CODE-STYLE.md under the docs root, and generates the path-scoped project-code-style rule that auto-attaches the style core whenever a matching file is touched - in the main session AND in dispatched subagents. NOT for architecture (alfred-capture-architecture), one language's style question (@agent-code-style-analyzer alone), or enforcing style (the per-language configs stay the enforced source)."
disable-model-invocation: true
---

# Project Code Style Analyzer - Capture, Merge, Attach (Deliberate)

You drive the deliberate capture of a project's ACTUAL code style and make it self-serving at write time. Two artifacts come out of a run; a re-run repeats the same analysis, then reconciles the doc in place and regenerates the rule from the fresh reports:

1. `<docs-path>/code-style/CODE-STYLE.md` - the merged style doc, a docs domain like every other: one file, a `##` section per language (not one file per language - a section's own `covers:` glob already routes a language's change to it), `references/` for anything too long for a section, and a `watch.json` naming which globs ask whether a language's section still holds. It captures how this codebase really writes each of its languages (config-enforced rules + the idioms a linter cannot encode), divergence from the house convention skills flagged. It opens with the `Captured: <branch>@<short-sha>, <date>` lifecycle stamp (`+dirty` on an uncommitted tree) - the docs-root rule (`.claude/rules/baseline-docs-root.md`) owns what readers make of it. `references/doc-shape.md` is the section format and write mechanics, including how a change lands on a branch - read it before MERGE.
2. `.claude/rules/project-code-style.md` - a generated path-scoped rule carrying the condensed style core, its `paths:` globs built from the exact extensions the analysis observed. The rules channel delivers it mechanically wherever a matching file is touched - main session and dispatched subagents alike (a PreToolUse hook's injected context never reaches subagent tool calls, which is why this is a rule and not a hook). The full doc stays the deep reference; the rule is the always-delivered essence.

The per-language configs (`.editorconfig`, eslint/prettier, `tsconfig`, the SQL linter rules) stay the enforced source of truth; the doc records what they encode and what they cannot. Code style is NOT architecture - structure, boundaries, and patterns live in `<docs-path>/architecture/`, owned by the alfred-capture-architecture skill. Never fold one into the other.

## Execution modes
DELEGATED vs INLINE keys on dispatch capability, not file presence - agent files on disk with no Agent tool to dispatch them is still INLINE. When dispatch is available, ask ONE question before a first capture's fan-out, via AskUserQuestion - characterize via code-style-analyzer seats (recommend it: the seats absorb the reads), or in-session? - unless a calling flow already picked the run's mode, which is inherited, never re-asked. Pick once, hold for the run:

- **FIRST capture** (no existing doc, or no `Captured:` stamp) - DELEGATED (the user chose seats): fan out code-style-analyzer per language as below; you merge and write. INLINE (chosen - or forced, no question asked: no dispatch (Cursor), or a single-language repo too small to fan out): the same characterization in-session, one language at a time, honoring the agent's own rules (config first, located code second, 2 locating passes per language, divergence flagged) - then continue at MERGE identically.
- **UPDATE** (doc + stamp exist) - INLINE in this session: `git diff --name-only <stamp-sha>..HEAD` names the changed files, and only the language families those files belong to get re-verified (config re-read, idioms spot-checked) - the other languages' sections stand. Escalate back to per-language dispatch when the drift spans most languages, the stamp's sha is unreachable or `+dirty`, or the USER explicitly asks for agents - their ask always wins.

## The run

### 1. DETECT - what languages does this repo hold?
A cheap Glob scan, in-session: `*.cs`, `*.xaml`, `*.ts`, `*.html`, `*.scss`/`*.css`, `*.sql`, plus the config markers (`package.json`, `angular.json`, `*.csproj`, `tsconfig.json`, `.editorconfig`, eslint/prettier config, SQL linter config). The result is the fan-out list - one language family per seat (e.g. WPF repo: C# + XAML; Angular repo: TypeScript/Angular + SCSS/CSS; ASP.NET repo: C# alone). Do not dispatch for a language the scan did not find.

### 2. FAN OUT - one code-style-analyzer per language, in parallel
Dispatch all seats in a single message. Each dispatch prompt names its language-family scope, tells the seat to locate with the navigation server and read only the ranges that matter - never a whole file - and nothing else. The agent reads its config + representative code and returns the structured report (project type, observed extensions, enforcement map, enforced rules, idioms, uncertain/inconsistent). The agents write no files; their final messages are your merge input.

### 3. MERGE - write <docs-path>/code-style/CODE-STYLE.md
Consolidate the reports into one doc - apply the `markdown-style` skill so it reads as a quick reference, not a wall of prose. Five sections, in order: the opening line, **Project type**, the **Enforcement map** table, one `##` heading **per language**, **Cross-cutting idioms**. Read `references/doc-shape.md` before writing - it says what each section carries, how a change lands when the branch keeps docs in an overlay, and what a re-run reconciles.

### 4. RULE - regenerate .claude/rules/project-code-style.md
Build the extension union from the agents' **Language + extensions** sections ONLY - never pad it from assumption (a WPF repo gets `cs|xaml`, an Angular repo `ts|html|scss`, an ASP.NET repo `cs` - plus whatever else was genuinely observed, e.g. `sql`). Then generate from `references/code-style-rule.template.md`:

1. `__PATH_GLOBS__` -> one `  - "**/*.<ext>"` line per observed extension. Derived, not designed.
2. `__STYLE_CORE__` -> the condensed essence of the merge: each language's Enforced + Idioms as tight bullets (keep 'uncertain'/'inconsistent' markers), plus the cross-cutting idioms. Aim small - this text is injected into every session that touches matching code; detail beyond what a writer needs on the spot belongs in the doc, not the rule.
3. `__DOC_PATH__` -> the SAME resolved docs root the doc was just written under, baked as a literal (a rule is static text - it cannot resolve env at load; the next capture re-bakes it if the root moved).

Regenerate on every run - the rule is derived output, cheap to rebuild, and rebuilding from the same reports as the doc is what keeps the two in sync. Never hand-reconcile it. Wholesale is mechanical, and it is a REPLACE, never a delete: READ the existing rule first (it is short), then Write the fresh one over it. The read is what makes the Write legal; an `rm` first is denied by the auto-mode classifier, which costs exactly the blocked round trip the delete was meant to save. Nothing in the old copy is preserved. Verify after writing: frontmatter parses, every glob came from an observed extension, the doc pointer names an existing file.

This generated rule is per-project output, deliberately NOT in the stack's RULES set - the installer fetches only named files and never prunes `.claude/rules/`, so `stack update` never touches it.

### 5. RETIRE - remove the legacy hook, if present
Earlier captures generated `.claude/hooks/inject-code-style.js` + a `settings.json` PreToolUse entry. The rule replaces it (one home per piece - both together would double-inject in main sessions). If the hook file exists: delete it, then parse `.claude/settings.json`, remove the PreToolUse entry whose command references `inject-code-style.js`, and rewrite - never regex-edit JSON, never touch the entries the stack installer wired. Nothing to retire on a clean project: skip silently.

### 6. REPORT
A literal line template, not prose to remember - the close is filled in, field by field, one line each (a table where a field lists several items, since the answer-length hook blocks a wall of prose and tables are exempt):

```
Doc:         <created | refreshed> - <docs-path>/code-style/CODE-STYLE.md, sections <the ones touched>
Rule:        <created | regenerated> - .claude/rules/project-code-style.md, globs <the observed extensions>
Languages:   <the families DETECT found> via <code-style-analyzer seats | in-session>
Divergences: <each divergence from a house convention skill, or `none`>
Legacy hook: <retired | none found>
Landed:      <machine-local under `.claude/` (gitignored) | the committed docs root `<path>`>
```

Every value comes from the step that produced it - the extension union from the agents' reports, not a hand tally. Then the prose, short: the notable idioms a linter cannot enforce and any divergence worth the user's eye. No re-paste of the doc body - point to the file.

## Don't game it
The doc records the style the code actually follows, not an aspiration - the agents' rules bind the merge too: every idiom names observed code, splits stay 'inconsistent', absent conventions stay absent. The rule's globs and core are derived, not designed - extensions and idioms come from the reports, and the verify step in RULE runs against the real generated file, not the template.
