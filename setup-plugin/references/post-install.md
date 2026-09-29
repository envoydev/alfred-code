# After the install - first session checklist

The install laid files down; none of them are live yet. Work this list top to bottom - each step
depends on the one before it. `/alfred-code:init`, typed in the session after the restart, does
steps 3 to 5 for you (the machine installs through one ask first); this page is what it does, and
how to redo any of it by hand later.

## 1. Reload the session

Most of what the install delivered binds at session start, not mid-session: MCP servers connect at
launch (the enabled plugins' servers, and `.mcp.json` where the opt-out route wrote one, are read
then), and skills, agents and the always-on rules are inventoried then.
Two things do NOT wait: the `settings.json` hooks and its `env` values are read per invocation, so
a newly wired hook fires and a flipped env value applies on the very next tool call (measured in
one session both ways - a hook installed at 08:12:53 fired at 08:21:15, and an env flip produced
its first ledger row 7.9 s later, covering 17 of 17 subsequent calls). Exit Claude Code and start it again
from the project root. `/reload-plugins` is NOT a substitute here - measured, it did not bind a
freshly installed LSP plugin's tool server (a session ran 64 failed nav calls after that advice);
only the full restart does. First launch after an install may prompt to trust the project's plugins
and MCP servers - accept for this project. Until the reload, the MCP servers, skills, agents and rules are on disk but not in play.

**Then check they actually CONNECTED.** Registration is not connection: a stdio server whose
runtime is missing, slow to fetch, or wrong for this machine fails its 30-second connect budget and
the session simply runs without it - measured, both stack-seeded stdio servers returned
`CONNECT_TIMEOUT after 30000ms` on one install and the whole session ran with the mandated symbol
navigator dead, with nothing reporting it. One command after the restart says so:

```bash
claude mcp list
```

Every row should read connected. A timeout on `navigation` (Serena) usually means its first run is still
fetching the language server (re-run once it settles, or pre-warm with `uvx --from serena-agent
serena --help`). A timeout on `memory` is its FIRST start downloading the embedding model (~166MB into
`~/.cache/mcp_memory`: measured 33s cold, 2s warm, against the 30s budget), not a missing runtime: the
install fetches it ahead where uvx is present (`memory: the embedding model is cached now`) and init's plan
lists it otherwise; fetch it with `node .claude/hooks/memory.js warm`. Claude Code then remembers the
failed server in `<config dir>/mcp-needs-auth-cache.json` and the next session does not even start it -
remove its `plugin:memory:memory` entry from that file, then restart (measured: it connected in 1.8s). A timeout on any
other stdio server means its runtime is not installed on this machine - fix it, or drop that server via
`/alfred-code:configure` rather than carrying a dead registration whose tool schemas are injected into
every session.

Behind a package index that publishes no upload times (a private PyPI mirror), every uvx server - `navigation`,
`memory` and the desktop servers - fails at start: uv treats each file as unavailable under the release's dependency
cut-off, and its error never names the cut-off. Set `UV_EXCLUDE_NEWER=false` in the shell or a settings file's `env`
(the launchers read it at every start; on the opt-out `.mcp.json` route run `/alfred-code:update` once so the rows
drop the cut-off too), or give that index `exclude-newer = false` in its `[[index]]` entry of the user-level
`uv.toml` (`~/.config/uv/uv.toml` - uvx ignores a project one).

**And check the plugins are ENABLED, not merely installed.** Installing a plugin does not enable it
at that scope, and a disabled one is silent in both directions - it does nothing and says nothing.
Measured on this machine: 24 of 40 stack-plugin project installs sat disabled across four plugins,
including a commit-time security gate that was off through two runs which both reported nothing to
do, and both language servers that the navigation rule routes to.

```bash
claude plugin list
```

Every stack plugin should read enabled for this project. One that does not is one command away -
`claude plugin enable <name>` - and `/alfred-code:status` reports the same state per plugin any
time after that.

## 2. Git hygiene - keep the machine-local artifacts out of the repo

The install creates machine-local state that should not be committed. Two homes - pick one:
the committed `.gitignore` (shares the policy with the team) or `.git/info/exclude` (local-only,
touches no committed file). The lines, minus anything the project already covers:

```gitignore
.claude/
.mcp.json
```

- `.claude/` - the install and the stamp are machine-local. To COMMIT `.claude/CLAUDE.md` while
  ignoring the rest, the pair is `.claude/*` + `!.claude/CLAUDE.md` - a bare directory ignore blocks
  the re-include.
- `.alfred/` - the data root (`ALFRED_CODE_DATA_PATH`), outside `.claude/` because Claude Code prompts
  for every write there: the docs (`.alfred/docs/`), the navigation server's index, handoff notes and
  language servers (`.alfred/serena/`), the browser profiles holding session cookies
  (`.alfred/browser/<engine>/`) and a project-level memory database (`.alfred/.alfred-memory/`). It
  carries its own `.gitignore`, which keeps everything but `docs/` out of git, so it never needs a line
  here. The docs carry their own, written from `ALFRED_CODE_DOCS_VERSIONING`: `local` keeps them out of
  git, `git` (a fresh project's default) commits them and keeps only the hooks' machine state out. To
  keep the docs machine-local, switch it once with `/alfred-code:update --docs-versioning local`.
- `.mcp.json` - only on the opt-out route (`ALFRED_CODE_MCPS_VIA_PLUGIN=false`); the default run
  carries every server on its own plugin and PRUNES the stack's names out of this file. Where it
  does exist it is regenerated on every run, so a local edit is wiped anyway. No file, nothing to ignore.
- `.serena/`, `.playwright/`, `.memory-mcp/` - the 2.0.0 places of the same data, present only until
  `/alfred-code:update` moves them under the data root; each carries its own `.gitignore` (`*`), so none
  needs a line here. Nothing to do.
- Add runtime dirs only when they appear in the tree: `.slopwatch/`.

## 3. Check the shared memory landed

The memory MCP is required in every install, at the level chosen during init (`global`,
`scoped`, or `project` - `/alfred-code:status` names it and the database file). Init also
imported this project's old `MEMORY.md` notes into that database once, and switched off Claude's
own memory ONLY if that import succeeded - a failed import leaves it on rather than risk losing a
note (with no notes to import, the install switched it off already). Check it once: `/alfred-code:status` shows `autoMemoryEnabled` in the Environment table;
`false` means done, `true` or absent means the import has not completed - read init's memory line for
why (a missing `uvx` or Python is the usual cause), fix that, and run `/alfred-code:init` again.
`baseline-memory.md` (always-on) names what belongs in the store and when to search it before
asking or reading - nothing further to configure.

A note imported by a registration made before this version stored a hash in place of a real
embedding, so it still LOADS by project tag but may not surface on a `memory_search` by meaning -
the service has no re-embed path, so this is permanent for those older rows; anything imported or
saved from here on gets a real 384-dim embedding and searches normally.

## 4. Index the codebase for the navigation server (when installed)

The installer already wrote serena's `project.yml` under the data root (`.alfred/serena/project.yml`) -
the project name, the `language_servers` it detected from your files, and `ignored_paths` for the data
root, `.claude` and the 2.0.0 `.serena` / `.playwright`. What is left is the index:
The navigation server answers symbol questions from an LSP cache, and until it is built the first lookup in a
session pays for the whole workspace load.

Init builds it once; by hand, run it from the project root (the first run also downloads the language server - ~327MB for
C# Roslyn, which needs .NET 10+; the navigation server installs the runtime itself if it is missing):

```bash
SERENA_HOME=.alfred/serena/home uvx --python 3.13 --exclude-newer 2026-09-29T23:59:59Z --from serena-agent@1.7.0 serena project index
```

(Your data root in place of `.alfred` when you chose another; `.serena/home` while a 2.0.0 `.serena`
has not moved yet.)

`--python 3.13` is the interpreter every compiled dependency has a wheel for - uvx would otherwise
take the newest, and 3.14 has no pyyaml wheel. The version and `--exclude-newer` are the release's own pin and
dependency cut-off (`meta/mcp-pins.json`), the ones the navigation server starts on, so the index is built by the
serena that serves it. (Windows PowerShell: `$env:SERENA_HOME='.alfred\serena\home'` - the navigation server hands the path to cmd.exe unquoted, where a `/` cuts it, and so would a space in an absolute path - and, on Windows on ARM, `--python cpython-3.13-windows-x86_64-none`).

Or paste this prompt and let the session do it:

```text
Index this project for the navigation server (SERENA_HOME=.alfred/serena/home, `uvx --python 3.13 --exclude-newer 2026-09-29T23:59:59Z --from serena-agent@1.7.0 serena project index` - on Windows the spelling above), then verify with
find_symbol and find_referencing_symbols on a symbol you pick from the code. If the run reports
failed files, look at .alfred/serena/project.yml - its language_servers and ignored_paths - and tell me
what you changed.
```

Re-run it after anything that moves a lot of symbols: a large refactor, a branch switch across many
files, a dependency upgrade that regenerates code - or whenever symbol lookups start coming back
empty for code you know exists.

One honesty note per language: on TypeScript / Angular / mixed web projects the navigation server IS the nav tool.
On C# it depends on the Roslyn server actually starting - that is what the seeded `language_servers`
entry buys you, and a project without it starts no server at all and answers nothing. Where Roslyn
still indexes slowly or not at all on a large SDK-heavy solution, symbol navigation falls back to
the `csharp-lsp` plugin; the navigation server keeps its seat either way as the per-project memory bus.

## 5. Run the captures - in this order

The deliberate captures turn a fresh install into an oriented one. Init runs each whose skill AND
seat are installed, in this order, by following its SKILL.md (`/alfred-code:configure` adds a
missing one); do not shuffle it. A later re-run is yours to type: all but the two analyzers
(`alfred-capture-architecture`, `alfred-capture-test-coverage`) are manual-only
(`disable-model-invocation`), so the assistant cannot invoke one on your behalf:

1. `/alfred-capture-related-projects <name - path> ...` - OPTIONAL, only when this project has sibling
   repos: sibling-repo awareness, args only (local paths or git URLs, e.g. `frontend - ../client`);
   it never scans on its own. A standalone repo skips it and installs neither the skill nor the
   `related-project-analyzer` seat - both are opt-in adds via `/alfred-code:configure`.
2. `/alfred-capture-architecture` - writes the durable architecture docs every seat reads to
   orient. Runs after the navigation-server index above, because the capture navigates by symbol.
3. `/alfred-capture-code-style` - captures how the codebase really writes each language and
   generates the path-scoped project-code-style rule.
4. `/alfred-capture-project-capabilities` - the run book: how to build, start, reach and log into the
   app, the flows and edge cases a manual check exercises, where debugging starts. It reads the repo
   first and asks only for the gaps; credentials are recorded by where they live, never by value.
5. `/alfred-capture-agent-capabilities` - LAST, so the generated usage-policy rule reflects the final
   inventory including anything the captures above added.

Optional, whenever you want the coverage picture: `/alfred-capture-test-coverage` - it
measures the suite and asks for YOUR coverage bar on first capture, recording it for every later
run.

## Later - after switching to a structurally different branch

A branch switch that meaningfully changes the structure (new modules, moved projects, different
dependencies) leaves session-side state describing the OLD tree. Worth pasting then:

```text
I switched branches and the structure changed. Re-run dependency install if needed, restart the
language server, re-index for the navigation server (SERENA_HOME=.alfred/serena/home, `uvx --python 3.13 --exclude-newer 2026-09-29T23:59:59Z --from serena-agent@1.7.0 serena project index` - on Windows the spelling above), and check
whether the navigation-server memories still describe this branch accurately.
```

The architecture docs handle a branch switch themselves: under `local` versioning the docs hook
serves the branch's own section versions and folds a merged branch back into mainline at the next
session start; under `git` versioning the branch's commits carry its docs and git does the merge.
Which one this install uses is `ALFRED_CODE_DOCS_VERSIONING` in the settings.json `env` block, and
`node .claude/hooks/docs.js status` names it.

## Done looks like

A restarted session where the MCPs answer, every stack plugin reads enabled, the generated rules exist under `.claude/rules/`
(`baseline-project-agent-capabilities.md` plus the captures' awareness rules), the docs root
holds the architecture / code-style docs the seats orient from, and `autoMemoryEnabled` reads
`false` - the shared memory carries what Claude's own notes used to. From here, work normally - the
stack routes itself.
