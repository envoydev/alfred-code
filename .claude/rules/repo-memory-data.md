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
  `kept` on a project a stamp records (an unstamped legacy install
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
  `MCP_MEMORY_SQLITE_PRAGMAS=busy_timeout=15000` (a shared file, several writers). 12.0.0 (audit 2026-10-14 PL10) migrates
  the file on its first open, one-way and additive - schema 12 to 19, an `embedding_pending` column with a default and the
  delta-sync tables (off unless `MCP_SYNC_EVENTLOG` is set); measured on a copy of a real database: 11.14.0 then stored,
  listed and searched over the migrated file, `memory.js export` read it, and both versions returned the same top hit.
  So installs on either pin may share one file; the readers here use columns by name (the re-embed's whole-row read only
  carries the new one into its backup, and re-stores through the service). 12.1.1 (audit 2026-10-20b) migrates nothing:
  a 12.0.0 database it opened, stored into, updated and deleted from kept the same schema (`schema_version` 19, `.schema`
  identical), and 12.0.0 then searched, stored and listed over it; the store / delete texts the readers match and the
  content hash (`sha256` of the trimmed, lower-cased text) are unchanged, and its consolidation no longer supersedes on a
  keyword-only contradiction (`MCP_CONSOLIDATION_AUTO_SUPERSEDE` now defaults to `false`). The INSTALL phase never
  imports: `/alfred-code:init`'s bootstrap phase, in the session after the install's restart (`scripts/install/memory.js
  init`), imports the project's existing `MEMORY.md` / `memory/*.md` notes into the chosen database
  once, through the service (idempotent), and only after that import succeeds switches Claude's own
  memory off (`autoMemoryEnabled: false`) and writes the stamp's `initialised:` line. With NO notes to
  import, the install phase switches it off itself, behind the same gate (the memory server and
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

- **Two memory stores and one record, don't conflate:** the `memory` MCP is the SHARED memory - preferences,
  corrections, project facts and agent lessons, searchable by meaning, one database per chosen
  level (global/scoped/project) read by every Claude account and Cursor at that level - and, since the user's
  2026-10-13 ruling ('Serena is just for navigation, for memory it's only alfred memory'), the EPHEMERAL handoff bus
  between agents within one feature too: rows tagged `handoff`, read by exact tags, purged at the run's close, never
  re-sent by the session-start push (`memory.js` `isHandoff`), and never a place for what should outlast the run. The
  navigation server's six memory tools are off in `navigation-context.yml`; Claude's own built-in memory (`MEMORY.md` +
  `memory/*.md`) is SWITCHED OFF (`autoMemoryEnabled: false`) by the install when the project has no
  notes, else by `/alfred-code:init` after a one-time import of its existing notes into the `memory` MCP - it has no search and is not shared
  with Cursor, which is why the MCP replaces it rather than sitting beside it. Which repos are
  related lives in `<docs-path>/awareness/RELATED-PROJECTS-AWARENESS.md` (the `/capture-awareness` skill, imported by the
  generated `alfred-awareness.md`), not memory. The session HISTORY (`<data root>/state/history/`,
  `history-session.js`) is the third, machine-local and never shared: what each session did and what
  the user ruled, script-written, read back at the next start on the same branch - a record, not memory.
- **The docs root lives outside `.claude/`** (2.0.0, the user's decision of 2026-09-26). Claude Code
  protects `.claude/` (only `.claude/worktrees` is exempt): a write there is prompted in default and
  acceptEdits mode, denied in `dontAsk`, and no `permissions.allow` rule pre-approves it
  (code.claude.com/docs/en/permission-modes, 'Protected paths') - so every plan, capture and commit
  receipt the model writes cost a prompt, and a headless run could not write them at all. Since 2.8.0 it
  is always `<data root>/docs` (the user's ruling of 2026-10-20): `ALFRED_CODE_DOCS_PATH` is retired - no run writes it,
  every reader still reads a leftover one first for the 2.x line, and every code home of the fallback spells
  `<data root>/docs` (`scripts/docs-root-default.test.js` holds them to it). ONE `.gitignore` (the user's ruling of 2026-10-13): the data root's carries the docs rules
  by `ALFRED_CODE_DOCS_VERSIONING` (`data-root.js dataIgnoreText`, `alfred-code.js ignoreStep`), and an update removes the
  docs root's own file and the nested ones earlier releases wrote (`history/`, the run book's `project-capabilities/`, the
  project memory folder) while each holds exactly the stack's text (`docs.pruneNestedIgnores`); serena's folder file is
  serena's - it writes one whenever none is there. A docs root OUTSIDE the data root, or under a data root whose file is
  the project's own, keeps its own (`docs.ensureDocsIgnore`, never under `.claude/`). `local` keeps the whole docs root out of
  git, `git` commits it but for the run book's old `credentials.local.env`, the awareness inventory and the hooks' pre-2.8.0
  state homes, which a session started before the update still writes and an unanswered hand-set root keeps (`data-root.js
  DOCS_STATE_IGNORE`; the temp-project matrix of 2026-10-21 found them visible to git once dropped). The hooks' machine state and ledgers left the docs root in 2.8.0 (`stack/hooks/layout.js`):
  `<data root>/state/` (approvals, session scratch, history) and `<data root>/statistics/` (block, tool-usage and docs ledgers,
  the usage audit's reports and raw transcript copies), both under the data root's `/*`, so never committed whatever the
  versioning; `docs.migrateLayout` moves an older project's folders there on update, file by file, `git mv` where tracked, a
  doc clash kept at the old path and named, a ledger at both homes appended to the new file and any other state file left
  to the new home's copy, the one the hooks read (final review 2026-10-20b C2: kept, the pair clashed on every run). The usage audit's copy step still checks `git check-ignore` before it copies; the
  folder was `alfred-code-usage-report/` until 2.1.7 - `docs.migrateUsageReport`, run after this
  file is current, moves it straight to `statistics/usage-report/`, never moving raw copies to a path git would not ignore, never over a session folder the new
  one holds). A file holding a text an earlier release wrote (`DOCS_IGNORE_FORMER`) is the stack's
  and is rewritten; any other text is the project's and kept. THE DRAIN (2.8.0, `docs.docsMovePlan`,
  `alfred-code.js docsRootStep`): every run moves the stack's docs, unasked, to `<data root>/docs` - from the root a
  leftover key names (settings.local.json over settings.json, Claude Code's merge), else on a stamped install with no key
  from the earlier data root's `docs/` (a data-root change) or the pre-2.0.0 `.claude/docs` - then removes the key from
  both settings files (`settings.js applyEnv` 3b). The docs are no part of the data-move offer; the servers' data stays
  asked. A HAND-SET root (`handSet`: a value no release seeded - not `<data root>/docs`, `.alfred/docs`, `.claude/docs` or
  the earlier data root's `docs/` - and no ledger row records) holding the stack's docs is the one exception (the user's
  answer of 2026-10-20 to a side note: it may be the team's own `docs/`, and the entries are picked by name): the preflight
  prints `docs-move: offer <from> -> <to> moves=<names> stack=<n> own=<names>`, update asks it naming every moving entry, and
  it moves only on `--docs-root-move move`, `--docs-root-leave <entries>` naming the team's own, which stay (a name that is
  none of the stack's moves nothing). No keep - every docs file of the stack's belongs under the data root, and a user
  who wants it elsewhere changes the data root (the user's answer of 2026-10-20); unattended takes the recommended move
  all; no answer (an installer run outside the walk) moves nothing yet, a `!!` line, and the next update asks.
  A kept key carries its ledger row as recorded. Only the stack's own top-level entries move (`STACK_DOCS`: the domains and work folders, every older home a
  migration still moves, `ORIENTATION.md`, `.branches`, any folder holding a `watch.json`): a hand-set root may be a
  folder the project uses too (`docs/`), so its other files stay and are named. One step: `git mv` for tracked files
  (history kept, staged as renames), a rename for the rest, every file put back on any failure, the rule re-stamped -
  with every generated pointer rule (`selection.js` GENERATED_RULES, and an older install's `project-code-style`) that names the old root,
  which a capture baked in literally (`selection.respellDocsRoot`, M11) - and a restart named; the old root's own
  `.gitignore`, when it holds a text the stack wrote, goes with it (`git rm` where tracked). A move keeps what git
  saw: an old root git ignored, with nothing tracked, becomes a `local` root. A CLASH (a file at both places) moves
  nothing and keeps the key, so the hooks keep reading where the docs are until one side is cleared; so does a
  settings.json key under a local-scope run, which does not write that file (a `!!` line each). A settings.json root
  that settings.local.json hid is named, never moved. An unreadable settings file moves nothing, and the rule keeps the
  root it was stamped with. The launch environment is never read.
- **One data root for the project's data** (2.1.0, the user's decision of 2026-09-29): `ALFRED_CODE_DATA_PATH`,
  default `.alfred` at the project root - relative, never under `.claude/`, no space, no `..` (`data-root.js
  checkDataPath`) - holds the docs (`<root>/docs`), serena's folder and home (`<root>/serena`), the browser
  profiles (`<root>/<engine>-control`), a project-level memory database (`<root>/.alfred-memory`) and the project's
  sensitive data (`<root>/.sensitive-data`, a dotenv the user fills by hand - 2026-10-13; every install writes it absent-only
  with one comment line and no key, only where git keeps it out (`data-root.js ensureSensitiveFile`); the secret guard keeps its
  values out of the chat. The browser launcher hands Playwright MCP the FILE, `--secrets <absolute path>` (audit 2026-10-14
  PL2, the user's ruling of 2026-10-14, reversing 2026-10-13's 'every launcher'): a login types the KEY name in
  `browser_type` / `browser_fill_form`, the server fills the value (`lookupSecret`) and writes each value back as
  `<secret>KEY</secret>` in its responses (`redactSecrets`, playwright-core's coreBundle.js under the 0.0.83 pin, read
  2026-10-14) - its README calls that 'a convenience and not a security feature', so the guard stays the gate. No value
  enters the browser's environment, which `browser_run_code_unsafe` can reach. Playwright parses the file as UTF-8 with
  dotenv (an unquoted `#` starts a comment there, so a value holding one is quoted); a UTF-16 store is not passed and the
  launcher says so. The full copy route passes none (audit 2026-10-21 mcps T2-2, ruling): it runs no launcher, and a static
  `--secrets` in `.mcp.json` would stop the server from starting once the store is gone - Playwright `readFileSync`s the
  path at start (`dotenvFileLoader`, 0.0.83) - so the login text reads the `<secret>` marker, and its absence means sign
  in by hand. mobile-control takes only the keys appium-mcp documents (`mobile-launch.js DOCUMENTED`, from its
  README; `withSensitive` `only`), and serena, the memory service and the desktop servers none. A root change moves the
  store inline on every route, into a root whose `.gitignore` is written first;
  `Read(.sensitive-data)` is in the shipped deny, a bare name matching at any depth per code.claude.com/docs/en/permissions).
  `stack/mcp/data-root.js` is the one home of every place, read by the three launchers, the installer, init's
  plan and the preflight. The docs root is `<root>/docs`, always (2.8.0). `<root>/.gitignore` is `/*` plus `!/.gitignore` and, under `git` versioning, `!/docs/` with the docs' machine-state lines
  (`data-root.js dataIgnoreText`, header-marked, a project's own text kept): a bare `*` would make `git
  check-ignore` answer yes for the docs and the versioning seed would read every fresh project as `local` (a
  `preferences/` domain holding only the git doc the install seeds casts no vote either - `docs.docsVersioningSeed`), and
  the file re-includes itself so it is committed and a teammate's clone has it. The installer keeps it current
  (`docs.ensureDataIgnore`); every launcher writes it absent-only before it hands out a path under the root
  (`ensureRootIgnore`) - a 2.0.0 project whose servers are already 2.1 has none yet. THE MOVE: the docs move
  inline and unasked (the drain above); a server's own data is LIVE while the session running the installer holds it, so on
  a route where its launcher runs the installer records a stamp line `data-pending: <class> <from> -> <to>` and
  the launcher moves it at its next start, only when nothing holds it (a database with no `-wal`/`-shm`/
  `-journal`, a browser profile with no Chromium `Singleton*` or Firefox `lock`, a serena folder whose logs
  name no live pid whose command line says serena (one `ps` call; on Windows one CIM `Win32_Process` query, a row with no command line judged by its image name - python, uv, serena; a failed query counts every pid busy) - `<folder>/home/logs/<date>/mcp_<stamp>_<pid>.txt`, `data-root.js serenaBusy`, M2: a second
  session's serena, or on the copy route the running session's own); on the copy route, which runs no launcher,
  the installer moves inline with the same checks, and a refused move stays pending for the next run. A pending line whose target already holds the
  data clears: its launcher made the move, and data at the old place again was written after it by a reader
  still on that place (a second session's server, Cursor's) - named once as a `!!` line, then each run as a
  plain clash, and a 2.0.0 place holding data again gets its own `.gitignore` back. With no pending line a
  launcher never moves anything: the new place when it holds data, else the 2.0.0 one (`liveDir`). `update-preflight.js` prints
  `data-move: offer <root> from=... serena= browser= memory=` (the stamp's kept engines, the memory
  class at the project level only); update asks ONE question (move recommended, keep, or a typed folder), the
  answer is `--data-move move|keep` (`--docs-move` read for one release) and `--data-path <folder>`; keep writes
  `data-move: kept` and no later update offers again; configure's data question passes `--data-path <new>
  --data-move move`. A `--data-path` over a root that holds data without `--data-move move` is not applied. The
  stamp's `data-root:` line is the next run's baseline, so a root changed by hand is still found; a root the
  data left is removed once only its `.gitignore` remains. The cursor-stack twin still reads `.serena` /
  `.memory-mcp` until its mirror lands - the home and project memory links cover the database, not the index.
- **Two stores, split by durability** (hard rule). The committed architecture docs
  (`<docs-path>/architecture/ARCHITECTURE.md` + `references/`, owned by
  `capture-architecture`) are the DURABLE truth every seat reads to orient, refreshed
  deliberately (that skill or `loop-architecture-quality`), never after each change. The
  preferences live in `<docs-path>/preferences/`: the code style in `PROJECT-CODE-PREFERENCES.md` (owned by
  `capture-project-code-style`), the user's own `PERSONAL-`, `PERSONAL-CODE-`, `ARCHITECTURE-` and `GIT-PREFERENCES.md`
  (owned by `capture-preferences`; the install seeds the git doc from `git-seed.md`, its consent, checkpoint, safety, attribution and
  checks entries `locked`, and an update restores an edited locked entry from the seed; nothing seeds the personal doc). The
  two personal docs (`PERSONAL-` and `PERSONAL-CODE-PREFERENCES.md`) are the user's own, never the team's: under git
  versioning the data root's ignore lines keep them out of git (`DOCS_STATE_IGNORE`, audit 2026-10-21 Q-1), so a linked
  worktree reads them from the main checkout (the hook and `preferences.js` alike). No rule carries their text: the shipped
  `alfred-preferences.md` names them and when each is read, and `preferences-session.js` pushes the personal doc (how the
  user wants the assistant to work) at every SessionStart, compaction included, and hands the others over at an actor's
  first edit and first git write (the user's rulings of
  2026-10-21; `code-style/CODE-STYLE.md`, `CODE-PREFERENCES.md`, the generated `project-code-style.md` and the retired
  `alfred-git.md` are moved, seeded or removed by `docs.migratePreferences` on update). The run book lives in
  `<docs-path>/awareness/PROJECT-AWARENESS.md` (owned by `capture-awareness`, repo facts first, the user's answers for
  the gaps; `project-capabilities/PROJECT-CAPABILITIES.md` through 2.5.0, moved by `docs.migrateDocsDomains` with its
  `watch.json`, then `docs.migrateAwareness` re-spells its section ids and moves its branch versions; the generated
  `alfred-awareness.md` `@`-imports it so every session loads it at its start): a
  credential appears there only as WHERE it lives - an env var, a vault item, or a key in the
  project's `<data root>/.sensitive-data` (the capture writes its keys empty only when the file is absent) - never
  as a value. The capture's own `credentials.local.env` before 2026-10-13 is moved into that store by every install
  run (`data-root.js adoptCredentials`, the user's call: one credential home, by update) - the values read and written
  by the installer, never printed, the run book's line re-pointed; a key the store holds with another value, a store
  git would commit (`git check-ignore`) or one that is not a file moves nothing and is said every run until fixed. The findings (`quality/ARCHITECTURE-ASSESSMENT.md`, `quality/CODE-ASSESSMENT.md`, owned by the
  two `*-quality` captures) are the opposite of durable - recomputed fresh every run, so
  `quality/` carries no `watch.json` and is no docs domain. A doc an older capture left at a former home moves on
  update (`docs.migrateDocsDomains`, absent-only: `PROJECT-CODE-STYLE.md`, `architecture/ASSESSMENT.md`, and the
  orientation doc from `related-context/` or loose at the root, its pre-folder home), and each generated rule naming
  the old path is re-pointed whenever the doc sits only at its new home - the project's own AGENTS.md / CLAUDE.md is
  named, never rewritten (2026-10-10: a moved doc would leave the always-on pointer dangling). The seat handoff note (`<feature>/<contract_version>/<seat>`, an `alfred-memory`
  row tagged `note:<name>` and `handoff:<feature>/<contract_version>`) is the EPHEMERAL inter-seat bus; anything that must survive a fresh clone
  belongs in the committed docs.
