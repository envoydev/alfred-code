---
paths:
  - "stack/hooks/handoff.js"
  - "stack/mcp/data-root.js"
  - "scripts/install/data-root*"
  - "scripts/install/docs.js"
---

# Memory, docs root and data root

The stores and what each holds, where the docs root and the data root live, and the durable-versus-ephemeral split. Moved here verbatim from the repo `CLAUDE.md` so it loads only when you edit these files.

- **No memory server and no memory level** (2.10.1, the user's ruling of 2026-10-24: the stack depends on no MCP
  server). Claude Code's own memory stays ON - the stack switches it off only for a project on custom memory (`ALFRED_CODE_MEMORY=custom`, ledgered), in the file that holds the choice - `settings.local.json` when its env carries the key, else the run's own file - and a scope move keeps the two together (final review I1: a personal choice wrote the switch-off into the committed `settings.json`). A personal choice never takes the team's switch-off out of `settings.json` while that file's own env still says custom (fix-pass review I1: one developer's local key stripped it, and teammates' runs wrote it back). The first update or uninstall past
  2.10.1 lifts the `autoMemoryEnabled: false` an earlier release's memory level wrote, from the run's own settings file
  alone and only for a stamp before 2.10.1 (`alfred-code.js liftMemorySwitchOff`); a switch-off set after that is the
  user's and stays. `--memory-level` is accepted and ignored with one line, `ALFRED_CODE_MEMORY_DB` leaves the settings,
  and the database the install pointed at stays on disk, named in the retire block beside its add-back line
  (`stack/mcp/original-mcps.json`, `repo-mcp.md`).

- **Four stores, don't conflate:**
  - Claude Code's OWN memory (`MEMORY.md` + `memory/*.md`, per project) - the lessons and project facts that outlast
    a session; `guard-answer.js`'s correction line names it for a lesson or a fact a correction states.
  - The PREFERENCES docs (`<docs-path>/preferences/`, below) - how the user wants the work done; the correction line
    names them for a stated preference (`/capture-preferences`).
  - The seats' HANDOFF bus (`stack/hooks/handoff.js`, an engine copied beside `docs.js`) - one note per
    `<feature>/<contract_version>/<seat>[/<task>]`, in `<data root>/state/handoff/<feature>.jsonl` of the MAIN checkout
    (`layout.js projectRootOf`, so a linked worktree's seat writes where the next reads), read by exact name, purged at
    the run's close, never committed - the EPHEMERAL bus, never a place for what should outlast the run.
  - The session HISTORY (`<data root>/state/history/`, `history-session.js`) - machine-local and never shared: what
    each session did and what the user ruled, script-written, read back at the next start on the same branch - a
    record, not memory.
  Which repos are related lives in `<docs-path>/awareness/RELATED-PROJECTS-AWARENESS.md` (the `/capture-awareness`
  skill, imported by the generated `alfred-awareness.md`), not memory.
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
  project memory folder) while each holds exactly the stack's text (`docs.pruneNestedIgnores`). A docs root OUTSIDE the data root, or under a data root whose file is
  the project's own, keeps its own (`docs.ensureDocsIgnore`, never under `.claude/`). `local` keeps the whole docs root out of
  git, `git` commits it but for the run book's old `credentials.local.env`, the awareness inventory and the hooks' pre-2.8.0
  state homes, which a session started before the update still writes and an unanswered hand-set root keeps (`data-root.js
  DOCS_STATE_IGNORE`; the temp-project matrix of 2026-10-21 found them visible to git once dropped). The hooks' machine state and ledgers left the docs root in 2.8.0 (`stack/hooks/layout.js`):
  `<data root>/state/` (approvals, session scratch, history) and `<data root>/statistics/` (block, tool-usage and docs ledgers,
  the usage audit's reports and raw transcript copies), both under the data root's `/*`, so never committed whatever the
  versioning; `docs.migrateLayout` moves an older project's folders there on update, file by file, `git mv` where tracked, a
  doc clash kept at the old path and named (so is a file standing where a folder moves, item 6), a ledger at both homes appended to the new file and any other state file left
  to the new home's copy, the one the hooks read (final review 2026-10-20b C2: kept, the pair clashed on every run). The usage audit's copy step still checks `git check-ignore` before it copies; the
  folder was `alfred-code-usage-report/` until 2.1.7 - `docs.migrateUsageReport`, run after this
  file is current, moves it straight to `statistics/usage-report/`, never moving raw copies to a path git would not ignore, never over a session folder the new
  one holds). A file holding a text an earlier release wrote (`DOCS_IGNORE_FORMER`) is the stack's
  and is rewritten; any other text is the project's and kept. THE DRAIN (2.8.0, `docs.docsMovePlan`,
  `alfred-code.js docsRootStep`): every run moves the stack's docs, unasked, to `<data root>/docs` - from the root a
  leftover key names (settings.local.json over settings.json, Claude Code's merge), else on a stamped install with no key
  from the earlier data root's `docs/` (a data-root change) or the pre-2.0.0 `.claude/docs` - then removes the key from
  both settings files (`settings.js applyEnv` 3b). The docs are no part of the data-move offer. A HAND-SET root (`handSet`: a value no release seeded - not `<data root>/docs`, `.alfred/docs`, `.claude/docs` or
  the earlier data root's `docs/` - and no ledger row records) holding the stack's docs is the one exception (the user's
  answer of 2026-10-20 to a side note: it may be the team's own `docs/`, and the entries are picked by name): the preflight
  prints `docs-move: offer <from> -> <to> moves=<names> stack=<n> own=<names>`, update asks it naming every moving entry, and
  it moves only on `--docs-root-move move`, `--docs-root-leave <entries>` naming the team's own, which stay (a name that is
  none of the stack's moves nothing). No keep - every docs file of the stack's belongs under the data root, and a user
  who wants it elsewhere changes the data root (the user's answer of 2026-10-20); unattended takes the recommended move
  all; no answer (an installer run outside the walk) moves nothing yet, a `!!` line, and the next update asks.
  A kept key carries its ledger row as recorded. Only the stack's own top-level entries move (`STACK_DOCS`: the domains and work folders, every older home a
  migration still moves, the loose legacy `ORIENTATION.md`, `.branches`, any folder holding a `watch.json`): a hand-set root may be a
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
  checkDataPath`) - holds the docs (`<root>/docs`), the hooks' state and ledgers (`<root>/state`, `<root>/statistics`,
  `stack/hooks/layout.js`), the stack's variables (`<root>/.variables`, 3.0.0: every catalog `ALFRED_CODE_*` key but
  `DATA_PATH` and the guard key `HOOKS_OFF`, which stay in the settings files; written by the installer and
  `scripts/variables.js set`, ledgered as `.variables` rows; tracked by git at project and user scope, whose
  `<root>/.gitignore` carries `!/.variables` - D6, `data-root.js dataIgnoreText` - and kept out at local scope; the
  hooks' loader `layout.variablesOf` reads it) and the project's sensitive data (`<root>/.secrets`, a dotenv the user fills by hand -
  2026-10-13; every install writes it absent-only with one comment line and no key, only where git keeps it out,
  `data-root.js ensureSensitiveFile`; the secret guard keeps its values out of the chat, and `Read(.secrets)` and
  `Read(.sensitive-data)` are in the shipped deny, a bare name matching at any depth per code.claude.com/docs/en/permissions).
  THE RENAME (item 3, 2026-10-25): its name was `.sensitive-data`, and 2.x reads both, `.secrets` first (`data-root.js
  SECRET_FILES` / `findSecretsFile`, pinned as `secret-file-names`). Two phases, so a session opened before the update
  never loses the store mid-run: the first run beside an old file writes `secrets: dual <by>` into the stamp (`by` the
  session id, else `run-<installed-ms>`, kept as first written) and no `.secrets`; a later run whose session is not `by`
  renames the file alone (`renameSecrets`, at the prior root and the current one, only where git ignores `.secrets`),
  re-points the run book (`repointRunBooks`) and prints the restart line. Both names present, a non-file at `.secrets` or
  an unignored target keeps the old file and says so with `!!`. A fresh install writes `.secrets` and the line at once.
  The way back after a release is a forward fix, never a revert: a reader of the old name alone leaves `.secrets` unguarded. What an older
  release's servers left there - the navigation index, browser profiles holding session cookies, a project memory
  database - is no longer the stack's: never moved or deleted, kept out of git by the root's `/*`. `stack/mcp/data-root.js`
  is the one home of every place, read by the installer, init's plan and the preflight. `<root>/.gitignore` is `/*` plus
  `!/.gitignore` and, under `git` versioning, `!/docs/` with the docs' machine-state lines (`data-root.js
  dataIgnoreText`, header-marked, a project's own text kept): a bare `*` would make `git check-ignore` answer yes for the
  docs and the versioning seed would read every fresh project as `local` (a `preferences/` domain holding only the git
  doc the install seeds casts no vote either - `docs.docsVersioningSeed`), and the file re-includes itself so it is
  committed and a teammate's clone has it. The installer keeps it current (`docs.ensureDataIgnore`). THE MOVE: the docs
  move inline and unasked (the drain above); the secrets file (either name) is the one other class that moves, inline with a
  root change, into a root whose `.gitignore` is written first. `update-preflight.js` prints `data-move: offer <root>
  from=...` when an earlier root the stamp names still holds it; update asks ONE question (move recommended, keep, or a
  typed folder), the answer is `--data-move move|keep` (`--docs-move` read for one release) and `--data-path <folder>`;
  keep writes `data-move: kept` and no later update offers again; configure's data question passes `--data-path <new>
  --data-move move`. A `--data-path` over a root that holds data without `--data-move move` is not applied. A refused
  move stays as `data-pending: sensitive <from> -> <to>` for the next run; a `data-pending:` line an earlier release
  wrote for a server's launcher is dropped, the data left where it is. The stamp's `data-root:` line is the next run's
  baseline, so a root changed by hand is still found.
- **The workspace file and the load check live in the data root** (workspace layering, release 1, 2026-10-26):
  `<data root>/workspace` holds the project's `parent <rel>` or `role root|standalone` (`parent none` reads as
  standalone), `above <rel>|none` (the tree its role was asked against), `child <rel>` and `ignore <category>
  <name>` lines (`install/workspace.js readWorkspace` / `writeWorkspace`, through a lock beside it). It moves with the
  root on every run that changes it, on or off (`workspace.moveWorkspace` - `planDataMove` carries only the store), a parent's file is read under the parent's own root, and an ancestor's
  is read with an env that keeps only the account (`ancestorEnv`), so this project's `ALFRED_CODE_DATA_PATH` never
  points into a parent. `workspace.js check-loads` writes its last result, whatever the state, to `<data root>/state/
  workspace-check.json`, which `status` reads. Both stay out of git through the root's `/*`. Uninstall takes out the
  `parent` and `child` lines on both sides (`leaveParent`, `releaseChildren`, which first writes each child's
  inherited values into its own `.variables`) and leaves the rest of the file, as it leaves the data root.
- **A child reads its ancestors' docs and memory, never writes them** (workspace layering, release 3, 2026-10-27). An
  ancestor's docs root is `layout.docsRootOf` - its own settings' leftover `ALFRED_CODE_DOCS_PATH`, else `<its data
  root>/docs`, never the child's env. Its memory folder is `layout.memoryDirsOf`, Claude Code's own rule: the first
  string `autoMemoryDirectory` (the managed drop-ins last first, the managed file, the member's `settings.local.json`, its
  `settings.json`, the account's; a leading `~` is the home folder), else `<account>/projects/<name>/memory`, `<name>`
  its git top (a linked worktree's main checkout) with every character outside `[A-Za-z0-9]` as `-`; past 200
  characters Claude Code appends `-<hash>`, so the existing `<first 200>-*` folders are listed (probe A5,
  `docs/workspace-layering-evidence.md`), and `CLAUDE_CODE_PROJECT_DIR_NAME` set means none. The line a child's start
  shows is `layout.workspaceMemoryOf`: the top member's folder, none past an `ignore memory root`, unless exactly one
  folder matches, or when it is one of the child's own. The install opens the docs roots and denies their edit
  (`repo-installer.md`); the hooks read them and guard the memory (`repo-hooks.md`).
- **Two stores, split by durability** (hard rule). The committed architecture docs
  (`<docs-path>/awareness/ARCHITECTURE-AWARENESS.md` + `references/`, owned by
  `capture-awareness`'s architecture part; `architecture/` before 3.5.0, moved by `docs.migrateArchitecture`) are the DURABLE truth every seat reads to orient, refreshed
  deliberately (that part or `loop-architecture-quality`), never after each change. The
  preferences live in `<docs-path>/preferences/`: the code style in `PROJECT-CODE-PREFERENCES.md` (owned by
  `capture-awareness`'s project-code-style part), the user's own `PERSONAL-`, `PERSONAL-CODE-`, `ARCHITECTURE-` and `GIT-PREFERENCES.md`
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
  `<docs-path>/awareness/RUN-AND-DEBUG-AWARENESS.md` (`PROJECT-AWARENESS.md`, its legacy name, until 3.5.0 split it into
  project info, run and debug, resources and the user's own `USER-AWARENESS.md`; owned by `capture-awareness`, repo facts first, the user's answers for
  the gaps; `project-capabilities/PROJECT-CAPABILITIES.md` through 2.5.0, moved by `docs.migrateDocsDomains` with its
  `watch.json`, then `docs.migrateAwareness` re-spells its section ids and moves its branch versions; the generated
  `alfred-awareness.md` `@`-imports it so every session loads it at its start): a
  credential appears there only as WHERE it lives - an env var, a vault item, or a key in the
  project's `<data root>/.secrets` (the capture writes its keys empty only when the file is absent) - never
  as a value. The capture's own `credentials.local.env` before 2026-10-13 is moved into that store by every install
  run (`data-root.js adoptCredentials`, the user's call: one credential home, by update) - the values read and written
  by the installer, never printed, the run book's line re-pointed; a key the store holds with another value, a store
  git would commit (`git check-ignore`) or one that is not a file moves nothing and is said every run until fixed. The findings (`quality/ARCHITECTURE-ASSESSMENT.md`, `quality/CODE-ASSESSMENT.md`, owned by the
  two `*-quality` captures) are the opposite of durable - recomputed fresh every run, so
  `quality/` is a RECOMPUTED domain (`"recomputed": true` in its `watch.json`, written only by `capture-quality`'s architecture-quality part
  through `docs.js watch-merge`): the assessment's located entries are asked at a session's close, set in place on every
  branch, picked after the durable docs and never credited as a docs read; `CODE-ASSESSMENT.md` is `notOwned` there. An
  assessment older than its watch is named by update (`docs.assessmentWatchLine`), never given one by the installer. A doc an older capture left at a former home moves on
  update (`docs.migrateDocsDomains`, absent-only: `PROJECT-CODE-STYLE.md`, `architecture/ASSESSMENT.md`, and the
  orientation doc from `related-context/` or loose at the root, its pre-folder home), and each generated rule naming
  the old path is re-pointed whenever the doc sits only at its new home - the project's own AGENTS.md / CLAUDE.md is
  named, never rewritten (2026-10-10: a moved doc would leave the always-on pointer dangling). The seat handoff note (`<feature>/<contract_version>/<seat>`, a `handoff.js` note
  under `<data root>/state/handoff/`) is the EPHEMERAL inter-seat bus; anything that must survive a fresh clone
  belongs in the committed docs.
