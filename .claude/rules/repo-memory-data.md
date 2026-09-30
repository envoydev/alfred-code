---
paths:
  - "stack/hooks/memory*.js"
  - "stack/mcp/memory-launch.js"
  - "stack/mcp/data-root.js"
  - "scripts/install/memory.js"
  - "scripts/install/data-root*"
  - "scripts/install/docs.js"
  - "scripts/install/serena.js"
---

# Memory, docs root and data root

The memory levels and stores, where the docs root and the data root live, and the durable-versus-ephemeral split. Moved here verbatim from the repo `CLAUDE.md` so it loads only when you edit these files.

- **`memory` is required like navigation and documentation**, chosen per install by LEVEL rather than by
  a droppable pick: `global` (`~/.alfred-memory/memory.db`, every Claude account and Cursor on the
  machine - the default for a fresh install), `scoped` (`~/.alfred-memory/memory_<space>.db`,
  `memory_default.db` with no space - one account), `project` (`<project>/<data root>/.alfred-memory/memory.db`,
  gitignored - this project only). The folder is `.alfred-memory` wherever it sits (2.1.0); the 2.0.0
  `~/.memory-mcp` is moved by the memory launcher at a start when no database in it is open (no `-wal` /
  `-shm` - Windows refuses renaming an open file, and SQLite calls renaming an open database undefined),
  and a link is left at the old path (a junction on Windows) so Cursor and an install not yet updated reach
  the same file; until then every reader - the launcher, the session-start engine, the installer's level -
  serves the old place (`data-root.js liveMemoryDb`), never a second, empty database. A link that cannot be
  made (no junction, or a reader re-created the old folder first) leaves the data at the new place: the
  launcher serves the new file and names what still reads the old path (Cursor), every reader resolves an old
  home path that is gone to its new spelling (`liveMemoryDb`, the engine's `liveDbPath`), and the old folder is
  never re-created. A project-level database's 2.0.0 `<project>/.memory-mcp` gets the same link after its move
  (the launcher's, or the copy route's inline one - `data-root.js movePlace`, M5), relative so a moved checkout
  keeps it; the link is no data to any reader, and git lists it as an untracked file, which the move's log line
  names. A 2.0.0 path reads as
  its level and resolves to the new spelling, and the settings name where the file LIVES now. The service's
  embedding model (~166MB into `~/.cache/mcp_memory`) downloads at its FIRST start - 33s cold against Claude
  Code's 30s MCP connect budget, and a server that misses it is cached as failed
  (`<config>/mcp-needs-auth-cache.json`), so the next session does not start it: `memory.js warm` fetches it
  once outside any session (the server against a scratch database, one search, bounded), run by the installer
  where uvx is present (`ALFRED_CODE_MEMORY_WARM=0` off; the test sandbox sets it) and listed in init's plan. `--memory-level` sets it; init and configure ASK it (one
  AskUserQuestion, the three levels, `global` recommended), update passes it only when the invocation
  names one, and changing it re-points the server, never touching the database file. With no flag the level is the one
  the install records (`memory.recordedPath`): the copy route's `.mcp.json` registration, else the settings key; a settings
  file it cannot read is no answer - the account's local registration answers in its place, and with none the level is
  `kept` on a project a stamp records (a 1.x account-dir stamp this update migrates counts; an unstamped legacy install
  does not - measured, its `.mcp.json` registration answers first): no registration re-pointed, no key written, said before the first registration (matrix 2.1.5 F2); a fresh install takes the default
  instead, said first (review 2.1.6 M1). Claude's own memory is switched off only where the memory server takes its
  place - never on the copy route with a kept level (it registers none), and on the plugin route only where the launcher
  serves one - at every level there, a fresh install's default included (re-verify 2 R2). The launcher, the installer and
  the session-start engine read the settings key through ONE reader (`stack/hooks/memory.js settingsDbState`, re-verify 2
  R5): settings.local.json, settings.json, then the account settings.json; a file it cannot parse is no answer, the next
  readable key answers - unless the stamp's ledger records the key in that very file (re-verify 3 S6) - and with none the launcher refuses to start rather than open the global database (re-verify N2),
  said on stderr and by `memory.js level` (`refused <file>`, or `unreadable <file>` after the level), which
  `/alfred-code:status` and validate render with the fix (R4). A `.mcp.json` memory registration answers before any
  settings key (`namedDbPath`, re-verify 3 S5). The project level is written as the ABSOLUTE path in the machine-local
  `settings.local.json` key (an older release reads a relative one as no level - re-verify 3 S1) and registered in the
  committed `.mcp.json` by its project-relative path, the server started at its project through `ROOT_BOOT` (defined in `repo-mcp.md`), so
  every checkout of a repo resolves its own and none rewrites what the others share (R3) - never a parse-time
  `${CLAUDE_PROJECT_DIR:-.}`, which Claude Code sets in the server's environment, not its own, so the expansion took '.',
  the launch directory (code.claude.com/docs/en/mcp; re-verify 3 S2). A flag still wins there, said first with the key it cannot write. A project folder moved or copied
  carries settings naming the OLD folder's project database; where the ledger shows the stack wrote that value, it is
  this folder's own project level, re-pointed and said (each copy keeps its own) - a path the user set stays `custom`. The server needs
  the `[sqlite]` extra - `mcp-memory-service[sqlite]==<ver>` via `uvx --with numpy --from ...` - for
  real 384-dim embeddings; without it the server refuses to start on a database already holding
  memories. Env: `MCP_MEMORY_STORAGE_BACKEND=sqlite_vec`, `MCP_MEMORY_SQLITE_PATH=<db>`,
  `MCP_MEMORY_SQLITE_PRAGMAS=busy_timeout=15000` (a shared file, several writers). SETUP never
  imports: `/alfred-code:init`, in the session after setup's restart (`scripts/install/memory.js
  init`), imports the project's existing `MEMORY.md` / `memory/*.md` notes into the chosen database
  once, through the service (idempotent), and only after that import succeeds switches Claude's own
  memory off (`autoMemoryEnabled: false`) and writes the stamp's `initialised:` line. With NO notes to
  import, setup's install switches it off itself, behind the same gate (the memory server and
  `alfred-memory.md` selected and on disk; an unreadable notes folder counts as notes), and init only
  reports it - init runs inside the session, where the pilot-2 sandbox refused its settings write. The switch-off
  lands in THIS project's own `.claude/settings.json` at project and user scope, and in
  `settings.local.json` at local scope, where a value the user set stays local (R96) - never the
  account file, which would silence every other project. A failed import leaves Claude's own memory
  ON and is reported, never retried into a false success; the old note files are never deleted.
  A note a PRE-fix registration imported was hash-embedded, so it loads by project tag but misses a
  `memory_search` by meaning; `memory.js reembed` fixes it (the service has no re-embed tool): the
  marker is the stored vector's norm (about 11 for a hash embedding, 1 for the sentence model), each
  row is deleted, stored and given back its dates through the service, after an owner-only backup
  under `~/.alfred-memory/backups/` (a 2.0.0 `~/.memory-mcp` not moved yet keeps them) that `reembed --restore <backup>` replays. A row tied to another
  memory (superseded, a child, a graph edge) is left alone; the first row goes alone and stops the run
  when its new vector is still not unit length. `memory.js duplicates` reports same-content pairs and
  deletes nothing.

- **Three memory stores and one record, don't conflate:** the `memory` MCP is the SHARED memory - preferences,
  corrections, project facts and agent lessons, searchable by meaning, one database per chosen
  level (global/scoped/project) read by every Claude account and Cursor at that level; the navigation server's
  per-project memory (`<data root>/serena/memories/`) is the EPHEMERAL handoff bus between agents within one
  feature, never a place for what should outlast it; Claude's own built-in memory (`MEMORY.md` +
  `memory/*.md`) is SWITCHED OFF (`autoMemoryEnabled: false`) by the install when the project has no
  notes, else by `/alfred-code:init` after a one-time import of its existing notes into the `memory` MCP - it has no search and is not shared
  with Cursor, which is why the MCP replaces it rather than sitting beside it. Which repos are
  related lives in the generated `.claude/rules/alfred-project-related-context.md` (the
  `/alfred-capture-related-projects` skill), not memory. The session HISTORY (`<docs-path>/history/`,
  `history-session.js`) is the fourth, machine-local and never shared: what each session did and what
  the user ruled, script-written, read back at the next start on the same branch - a record, not memory.
- **The docs root lives outside `.claude/`** (2.0.0, the user's decision of 2026-09-26). Claude Code
  protects `.claude/` (only `.claude/worktrees` is exempt): a write there is prompted in default and
  acceptEdits mode, denied in `dontAsk`, and no `permissions.allow` rule pre-approves it
  (code.claude.com/docs/en/permission-modes, 'Protected paths') - so every plan, capture and commit
  receipt the model writes cost a prompt, and a headless run could not write them at all. The default
  is `.alfred/docs`, stated in every code home of the fallback (`scripts/docs-root-default.test.js`
  holds them to one value). The root carries its own `.gitignore` by `ALFRED_CODE_DOCS_VERSIONING`
  (`docs.ensureDocsIgnore`, absent-only, never under `.claude/`): `local` keeps the whole root out of
  git, `git` keeps only the hooks' machine state out (`flow/`, `hook-blocks/`, `history/`,
  `tools-usage/`, `.branches/`, `docs-log.jsonl`) plus the usage audit's raw transcript copies
  (`alfred-code-usage-report/**/*.jsonl`, which the audit's copy step checks with `git check-ignore`
  before it copies). A file holding a text an earlier release wrote (`DOCS_IGNORE_FORMER`) is the stack's
  and is rewritten; any other text is the project's and kept. An install on the old default is never moved
  silently (`docs.docsMovePlan`): the stack's own seed (the ledger's hash, or with no ledger the
  catalog's `former_defaults`) over docs at `.claude/docs` is OFFERED once - since 2.1.0 as part of the data
  move below: `update-preflight.js` names it in its `data-move: offer` line, update asks move (recommended)
  or keep, and the answer is `--data-move move|keep`. Move: one step, `git mv` for tracked files (history kept, staged as
  renames), a rename for the rest, every file put back on any failure, the key re-pointed and the rule
  re-stamped - with every generated pointer rule (`alfred-project-*`, `project-code-style`) that names the
  old root, which a capture baked in literally (`selection.respellDocsRoot`, M11) - a restart named. Keep: the key becomes the user's own value, out of the ledger, and no
  update offers again. No answer: nothing moves, and an absent key is written back as the old root so
  the hooks keep reading where the docs are. A value the user set is never offered: one the ledger does
  not record, or any root in `settings.local.json` at project or user scope (the stamped rule is
  settings.json's, R98). The launch environment is never read - a settings value applies over a shell
  export and the seed writes one anyway. A move keeps what git saw: an old root git ignored, with nothing
  tracked, becomes a `local` root (`ignored=yes` in the offer). A conflict or an unreadable settings file
  moves nothing, and the rule keeps the root it was stamped with.
- **One data root for the project's data** (2.1.0, the user's decision of 2026-09-29): `ALFRED_CODE_DATA_PATH`,
  default `.alfred` at the project root - relative, never under `.claude/`, no space, no `..` (`data-root.js
  checkDataPath`) - holds the docs (`<root>/docs`), serena's folder and home (`<root>/serena`), the browser
  profiles (`<root>/browser/<engine>`) and a project-level memory database (`<root>/.alfred-memory`).
  `stack/mcp/data-root.js` is the one home of every place, read by the three launchers, the installer, init's
  plan and the preflight. The docs root is written as `<root>/docs` unless the user set their own (a value the
  ledger does not record is never moved). `<root>/.gitignore` is `/*` plus `!/.gitignore` and `!/docs/`
  (`data-root.js dataIgnoreText`, header-marked, a project's own text kept): a bare `*` would make `git
  check-ignore` answer yes for the docs and the versioning seed would read every fresh project as `local`, and
  the file re-includes itself so it is committed and a teammate's clone has it. The installer keeps it current
  (`docs.ensureDataIgnore`); every launcher writes it absent-only before it hands out a path under the root
  (`ensureRootIgnore`) - a 2.0.0 project whose servers are already 2.1 has none yet. THE MOVE: the docs move
  inline (`docs.docsMovePlan` generalised - the old default the stack wrote, which the ledger records or a stamp
  from before the ledger implies; a 2.0.0 keep made it the user's and no update offers it again - or the
  stack's docs under an earlier root); a server's own data is LIVE while the session running the installer holds it, so on
  a route where its launcher runs the installer records a stamp line `data-pending: <class> <from> -> <to>` and
  the launcher moves it at its next start, only when nothing holds it (a database with no `-wal`/`-shm`/
  `-journal`, a browser profile with no Chromium `Singleton*` or Firefox `lock`, a serena folder whose logs
  name no live pid whose command line says serena (`ps`; Windows has none, so a live pid counts) - `<folder>/home/logs/<date>/mcp_<stamp>_<pid>.txt`, `data-root.js serenaBusy`, M2: a second
  session's serena, or on the copy route the running session's own); on the copy route, which runs no launcher,
  the installer moves inline with the same checks, and a refused move stays pending for the next run. A pending line whose target already holds the
  data clears: its launcher made the move, and data at the old place again was written after it by a reader
  still on that place (a second session's server, Cursor's) - named once as a `!!` line, then each run as a
  plain clash, and a 2.0.0 place holding data again gets its own `.gitignore` back. With no pending line a
  launcher never moves anything: the new place when it holds data, else the 2.0.0 one (`liveDir`). `update-preflight.js` prints
  `data-move: offer <root> from=... docs=<n> serena= browser= memory=` (the stamp's kept engines, the memory
  class at the project level only); update asks ONE question (move recommended, keep, or a typed folder), the
  answer is `--data-move move|keep` (`--docs-move` read for one release) and `--data-path <folder>`; keep writes
  `data-move: kept` and no later update offers again; configure's data question passes `--data-path <new>
  --data-move move`. A `--data-path` over a root that holds data without `--data-move move` is not applied. The
  stamp's `data-root:` line is the next run's baseline, so a root changed by hand is still found; a root the
  data left is removed once only its `.gitignore` remains. The cursor-stack twin still reads `.serena` /
  `.memory-mcp` until its mirror lands - the home and project memory links cover the database, not the index.
- **Two stores, split by durability** (hard rule). The committed architecture docs
  (`<docs-path>/architecture/ARCHITECTURE.md` + `references/`, owned by
  `alfred-capture-architecture`) are the DURABLE truth every seat reads to orient, refreshed
  deliberately (that skill or `alfred-loop-architecture-quality`), never after each change. The code
  style lives in `<docs-path>/code-style/CODE-STYLE.md` + the path-scoped `project-code-style.md` rule
  (owned by `alfred-capture-code-style`). The run book lives in
  `<docs-path>/project-capabilities/PROJECT-CAPABILITIES.md` (owned by
  `alfred-capture-project-capabilities`, repo facts first, the user's answers for the gaps): a
  credential appears there only as WHERE it lives - an env var, a vault item, or a key in the
  `credentials.local.env` template the capture writes empty and gitignores in its own folder - never
  as a value. The findings (`quality/ASSESSMENT.md`, `quality/CODE-ASSESSMENT.md`, owned by the
  two `*-quality` captures) are the opposite of durable - recomputed fresh every run, so
  `quality/` carries no `watch.json` and is no docs domain. Navigation-server memory (`<feature>/<contract_version>/<seat>`, each `/` a
  folder serena's `list_memories` `topic` filters by - 2.1.6; never the `memory` MCP) is the EPHEMERAL inter-seat bus; anything that must survive a fresh clone
  belongs in the committed docs.
