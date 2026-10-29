# After the install - first session checklist

The install laid files down; none of them are live yet. Work this list top to bottom - each step
depends on the one before it. `/alfred-code:init`, typed in the session after the restart, does
step 3 for you (the machine installs through one ask first); this page is what it does, and
how to redo any of it by hand later.

## 1. Reload the session

Most of what the install delivered binds at session start, not mid-session: the enabled plugins load at
launch (an LSP plugin's language server with them), and skills, agents and the always-on rules are
inventoried then.
Two things do NOT wait: the `settings.json` hooks and its `env` values are read per invocation, so
a newly wired hook fires and a flipped env value applies on the very next tool call (measured in
one session both ways - a hook installed at 08:12:53 fired at 08:21:15, and an env flip produced
its first ledger row 7.9 s later, covering 17 of 17 subsequent calls). Exit Claude Code and start it again
from the project root. `/reload-plugins` is NOT a substitute here - measured, it did not bind a
freshly installed LSP plugin's tool server (a session ran 64 failed nav calls after that advice);
only the full restart does. First launch after an install may prompt to trust the project's plugins -
accept for this project. Until the reload, the plugins, skills, agents and rules are on disk but not in play.

**Then check the plugins are ENABLED, not merely installed.** Installing a plugin does not enable it
at that scope, and a disabled one is silent in both directions - it does nothing and says nothing.
Measured on this machine: 24 of 40 stack-plugin project installs sat disabled across four plugins,
including a commit-time security gate that was off through two runs which both reported nothing to
do, and both language servers that the navigation rule routes to.

```bash
claude plugin list
```

Every stack plugin should read enabled for this project. One that does not is one command away -
`claude plugin enable <name> --scope <this install's scope>` (always with the scope: the CLI's default for a plugin is `user`) - and `/alfred-code:status` reports the same state per plugin any
time after that.

An LSP plugin answers only once its language server is on PATH - `typescript-language-server` (with TypeScript 6)
for `typescript-lsp`, `csharp-ls` (it needs the .NET 10 SDK) for `csharp-lsp`; init's bootstrap offers both. Without
it the plugin reads enabled and answers nothing, and symbol lookups fall back to a scoped grep.

## 2. Git hygiene - keep the machine-local artifacts out of the repo

In no-repo mode this section is skipped: the close card's line reads exactly `git hygiene: skipped - no git repository`,
and nothing about `.claude/AGENTS.md`.

The install creates machine-local state that should not be committed. Two homes - pick one:
the committed `.gitignore` (shares the policy with the team) or `.git/info/exclude` (local-only,
touches no committed file). The lines, minus anything the project already covers:

```gitignore
.claude/*
!.claude/AGENTS.md
```

- `.claude/` - the install and the stamp are machine-local, while `.claude/AGENTS.md` is the team's
  seeded, init-filled instruction file and stays committed, so the pair above is what ignores the rest:
  `.claude/*` + `!.claude/AGENTS.md` - a bare directory ignore blocks the re-include. Where the install's name answer
  was CLAUDE.md, the re-include names `.claude/CLAUDE.md`. With the instruction file at the root (init's or configure's
  place answer), the re-include keeps nothing and `.claude/*` stands alone.
- `.alfred/` - the data root (`ALFRED_CODE_DATA_PATH`), outside `.claude/` because Claude Code prompts
  for every write there: the docs (`.alfred/docs/`), the hooks' state and the seats' handoff notes
  (`.alfred/state/`) and the project's sensitive data (`.alfred/.secrets`). Its ONE `.gitignore` keeps everything but `docs/` out
  of git, so while the docs are committed it needs no line here, and it carries the docs' rules too, written
  from `ALFRED_CODE_DOCS_VERSIONING`: `local` keeps them out of git, `git` (a fresh project's default) commits
  them and keeps only the hooks' machine state out. No folder under it carries a `.gitignore` of the stack's;
  the folders an earlier release's servers left there (`serena/`, `<engine>-control/`, `.alfred-memory/`) stay
  ignored by it until you delete them. To keep the docs machine-local, switch it once with
  `/alfred-code:update --docs-versioning local`. Where nothing under it is committed (local docs, or the
  docs root set elsewhere) git still lists `.alfred/` as untracked; then add `/.alfred/` -
  `node scripts/git-hygiene.js --root .` from the run's snapshot says which case applies, and
  `--apply gitignore|exclude` writes the line.
- `.mcp.json` - the stack writes none since 2.10.1, and the first update onto it takes the stack's own
  registrations out of it; a server of yours there stays. It needs no line from the stack.
- `.serena/`, `.playwright/`, `.memory-mcp/` - the 2.0.0 places of the old servers' data, each with its own
  `.gitignore` (`*`), so none needs a line here. Nothing reads them now - delete them when you no longer want them.
- Add runtime dirs only when they appear in the tree: `.slopwatch/`.

## 3. Run the captures - in this order

The deliberate captures turn a fresh install into an oriented one. Init runs each whose skill AND
seat are installed, in this order, by following its SKILL.md (`/alfred-code:configure` adds a
missing one); do not shuffle it. A later re-run is yours to type: all but the two analyzers
(`capture-architecture`, `capture-quality`) are manual-only
(`disable-model-invocation`), so the assistant cannot invoke one on your behalf:

1. `/capture-architecture` - writes the durable architecture docs every seat reads to
   orient, so it runs first.
2. `/capture-project-code-style` - captures how the codebase really writes each language into
   `preferences/PROJECT-CODE-PREFERENCES.md`, read before every code change.
3. `/capture-awareness` - LAST, so its generated inventory reflects the final install, including
   anything the captures above added. One run writes the three awareness docs and the rule that loads
   them into every session: what this install carries and how to use it; the run book - how to build,
   start, reach and log into the app, the flows and edge cases a manual check exercises, where
   debugging starts (it reads the repo first and asks only for the gaps; credentials are recorded by
   where they live, never by value); and the sibling repos, asked as typed paths or git URLs (e.g.
   `../client`), never scanned for. The `related-project-analyzer` seat that characterizes a sibling
   is an opt-in add via `/alfred-code:configure`.

Optional, whenever you want the coverage picture: `/capture-quality test-coverage-quality` - it
measures the suite and asks for YOUR coverage bar on first capture, recording it for every later
run.

Optional, whenever you have one to record: `/capture-preferences <your words>` - your own code,
architecture or git preferences ('avoid static classes', 'branches are feature/<ticket>'), which every
seat then follows. Init never runs it: the preferences are yours to state, not the codebase's to read.

Optional, whenever you want your own tools first: `/capture-preferences tools` - rank your own tools per job; until
then every session is told the stack's defaults.

## Later - after switching to a structurally different branch

A branch switch that meaningfully changes the structure (new modules, moved projects, different
dependencies) leaves session-side state describing the OLD tree. Worth pasting then:

```text
I switched branches and the structure changed. Re-run dependency install if needed, restart the
language server, and purge any handoff note a run left behind (`node .claude/hooks/handoff.js left` lists them).
```

The architecture docs handle a branch switch themselves: under `local` versioning the docs hook
serves the branch's own section versions and folds a merged branch back into mainline at the next
session start; under `git` versioning the branch's commits carry its docs and git does the merge.
Which one this install uses is `ALFRED_CODE_DOCS_VERSIONING` in `<data root>/.variables`, and
`node .claude/hooks/docs.js status` names it.

## Done looks like

A restarted session where every stack plugin reads enabled, the generated rules exist under `.claude/rules/`
(`alfred-awareness.md` plus the captures' own rules), and the docs root holds the architecture / code-style /
awareness docs the seats orient from. From here, work normally - the stack routes itself.
