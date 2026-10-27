---
name: capture-project-code-style
description: "Use when asked to capture or refresh how this project writes code - the project code-style doc. Manual, /-only. Not for architecture or enforcing style."
disable-model-invocation: true
---

# Project code style - capture and merge (Deliberate)

You drive the deliberate capture of a project's ACTUAL code style. One artifact comes out of a run; a re-run repeats the same analysis, then reconciles the doc in place from the fresh reports:

`<docs-path>/preferences/PROJECT-CODE-PREFERENCES.md` - the merged style doc, one of the preferences docs: one file, a `##` section per language (not one file per language - a section's own `covers:` glob already routes a language's change to it), `preferences/references/` for anything too long for a section, and entries in `preferences/watch.json` naming which globs ask whether a language's section still holds. It captures how this codebase really writes each of its languages (config-enforced rules + the idioms a linter cannot encode), divergence from the house convention skills flagged. It opens with the `Captured: <branch>@<short-sha>, <date>` lifecycle stamp (`+dirty` on an uncommitted tree) - the docs-root rule (`.claude/rules/alfred-docs-root.md`) owns what readers make of it. `references/doc-shape.md` is the section format and write mechanics, including how a change lands on a branch - read it before MERGE.

No rule is written. The shipped `alfred-preferences.md` names the doc and says when it is read - before any code change, a design plan or a code discussion - and ranks it above the house convention skills, so a refreshed section binds at the next read.

The per-language configs (`.editorconfig`, eslint/prettier, `tsconfig`, the SQL linter rules) stay the enforced source of truth; the doc records what they encode and what they cannot. Code style is NOT architecture - structure, boundaries, and patterns live in `<docs-path>/architecture/`. Never fold one into the other.

## When to use

- The deliberate project code-style capture; re-run to refresh in place.
- It fans out code-style-analyzer agents (one per detected language) and merges their reports into `preferences/PROJECT-CODE-PREFERENCES.md` under the docs root, the doc every session and seat reads before it changes code.
- Not for architecture (capture-architecture), the user's own code, architecture or git preferences (the preferences capture), one language's style question (the code-style-analyzer seat alone, picked from the @ typeahead), or enforcing style (the per-language configs stay the enforced source).

**Modes.** Mode flags right after the command - `--mode-auto-run-on`, `--mode-auto-run-off`, `--mode-output-scorer-on`, `--mode-output-scorer-off` - are switches, not the request: strip them; with only flags typed, run as with no arguments. Under the hook's auto-run contract, follow it. With no hook line (hooks off, Cursor), `-on` holds for this run only: each stop takes its `(Recommended)` option, listed in the close, an unmarked one waits, nothing goes outward, no fresh-session hand-off, and the close says auto-run ended; `--mode-output-scorer-on` grades this run's output like a typed stack.

## Execution modes
DELEGATED vs INLINE keys on dispatch capability, not file presence - agent files on disk with no Agent tool to dispatch them is still INLINE. When dispatch is available, ask ONE question before a first capture's fan-out, via AskUserQuestion - characterize via code-style-analyzer seats (recommend it: the seats absorb the reads), or in-session? - unless a calling flow already picked the run's mode, which is inherited, never re-asked. Pick once, hold for the run:

```ask
First style capture across <the languages>. Characterize them through the code-style-analyzer seats or in this session?
- 'Through the seats (Recommended)' - the seats absorb the reads; the merge and the write stay here
- 'In this session' - one language at a time, no dispatch
```

- **FIRST capture** (no existing doc, or no `Captured:` stamp) - DELEGATED (the user chose seats): fan out code-style-analyzer per language as below, exactly as the roster spells it (`alfred-code:<seat>` where the core plugin carries it); you merge and write. INLINE (chosen - or forced, no question asked: no dispatch, or a single-language repo too small to fan out): the same characterization in-session, one language at a time, honoring the agent's own rules (config first, located code second, 2 locating passes per language, divergence flagged) - then continue at MERGE identically.
- **UPDATE** (doc + stamp exist) - INLINE in this session: `git diff --name-only <stamp-sha>..HEAD` names the changed files, and only the language families those files belong to get re-verified (config re-read, idioms spot-checked) - the other languages' sections stand. Escalate back to per-language dispatch when the drift spans most languages, the stamp's sha is unreachable or `+dirty`, or the USER explicitly asks for agents - their ask always wins.

## The run

### 1. DETECT - what languages does this repo hold?
A cheap Glob scan, in-session: `*.cs`, `*.xaml`, `*.ts`, `*.html`, `*.scss`/`*.css`, `*.sql`, plus the config markers (`package.json`, `angular.json`, `*.csproj`, `tsconfig.json`, `.editorconfig`, eslint/prettier config, SQL linter config). The result is the fan-out list - one language family per seat (e.g. WPF repo: C# + XAML; Angular repo: TypeScript/Angular + SCSS/CSS; ASP.NET repo: C# alone). Do not dispatch for a language the scan did not find.

### 2. FAN OUT - one code-style-analyzer per language, in parallel
Dispatch up to `ALFRED_CODE_MAXIMUM_RUN_AGENTS` seats in one message (default 5), the next as each hands back. Each dispatch prompt names its language-family scope, tells the seat to locate with the navigation tools and read only the ranges that matter - never a whole file - and nothing else. The agent reads its config + representative code and returns the structured report (project type, observed extensions, enforcement map, enforced rules, idioms, uncertain/inconsistent). The agents write no files; their final messages are your merge input.

### 3. MERGE - write <docs-path>/preferences/PROJECT-CODE-PREFERENCES.md
Consolidate the reports into one doc, a quick reference whose shape is fixed verbatim in `references/doc-shape.md` - no formatting skill loads for it (the docs root belongs to the skill that writes it). Five sections, in order: the opening line, **Project type**, the **Enforcement map** table, one `##` heading **per language**, **Cross-cutting idioms**. Read `references/doc-shape.md` before writing - it says what each section carries, how a change lands when the branch keeps docs in an overlay, and what a re-run reconciles. A seat that opens `status: PARTIAL` merges with its open items kept uncertain, and the REPORT's `Languages:` line names it PARTIAL.

### 4. VERIFY
Run `node .claude/hooks/docs.js lint preferences` and fix every PROBLEM row (where the docs hook is deselected, say so instead). Then `node .claude/hooks/docs.js where <path>` on one file per language DETECT found, each answering with that language's own `PROJECT-CODE-PREFERENCES#<id>` section first - `where` reads the sections' `covers:`, so a miss is a wrong glob.

### 5. REPORT
A literal line template, not prose to remember - the close is filled in, field by field, one line each (a table where a field lists several items, since the answer budget caps prose and tables are exempt):

```
Doc:         <created | refreshed> - <docs-path>/preferences/PROJECT-CODE-PREFERENCES.md, sections <the ones touched>
Verify:      <lint clean | N fixed>, where <n of n languages routed to their own section>
Languages:   <the families DETECT found, a PARTIAL seat's marked PARTIAL> via <code-style-analyzer seats | in-session>
Divergences: <each divergence from a house convention skill, or `none`>
Legacy hook: <retired | none found>
Landed:      <committed (mode: git) | kept out of git (mode: overlay)> - the mode line of `node .claude/hooks/docs.js status`
```

Every value comes from the step that produced it - the languages from DETECT, the where count from VERIFY, not a hand tally. Then the prose, short: the notable idioms a linter cannot enforce and any divergence worth the user's eye. No re-paste of the doc body - point to the file.

## Don't game it
The doc records the style the code actually follows, not an aspiration - the agents' rules bind the merge too: every idiom names observed code, splits stay 'inconsistent', absent conventions stay absent. The `covers:` globs and the watch entries are derived, not designed - extensions and idioms come from the reports, and VERIFY runs against the real written doc.

## Old installs

Earlier captures generated `.claude/hooks/inject-code-style.js` + a `settings.json` PreToolUse entry; the doc replaces it, and `/alfred-code:update` moves an older `code-style/CODE-STYLE.md` and removes its generated `project-code-style.md` rule. Every run checks before REPORT: if the hook file exists, delete it, then parse `.claude/settings.json`, remove the PreToolUse entry whose command references `inject-code-style.js`, and rewrite - never regex-edit JSON, never touch the entries the stack installer wired. Nothing to retire on a clean project: skip silently. The REPORT's `Legacy hook:` line records which.
