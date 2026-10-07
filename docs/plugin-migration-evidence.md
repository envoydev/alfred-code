# Plugin-native migration - Phase 0 spike evidence

<!-- Re-spelled 2026-10-07: the stack's names read as it is named now; the measurements are unchanged. -->

Every row is a run, not a reading: the command, what came back, and the verdict the plan's PASS
condition gives it. A spike that was not run is reported NOT RUN, never implied as passing.

Harness: Claude Code 2.1.278 on macOS. Spike plugin `spike` 0.0.1, loaded with `--plugin-dir`, in a
throwaway git project under the session scratchpad.

**One deviation from the plan's Phase 0 preamble.** It asks for a throwaway `CLAUDE_CONFIG_DIR` so
nothing touches the real account dir. A throwaway config dir carries no credentials, so
`claude -p` answers `Not logged in - Please run /login` and measures nothing; looking for the
credential store to copy it is not something this run will do. The spikes therefore run against the
authenticated config dir, with the PROJECT still in the scratchpad. What this costs: the spike
sessions' own transcripts land under that config dir's `projects/` tree like any other session.
Nothing is installed into it - `--plugin-dir` loads the plugin for the one invocation.

---

## S1 preload naming - PASS

**Question.** Does a plugin agent's `skills:` frontmatter preload a plugin skill, under the BARE
skill name, the plugin-SCOPED name, or neither? And does a plugin agent resolve when dispatched by
its bare name?

**Setup.** Skill `alpha` whose body is `The passphrase is HERON-42`. Two agents, identical but for
one frontmatter line: `seat-bare` (`skills: alpha`) and `seat-scoped` (`skills: spike:alpha`). Both
`tools: Read`, `model: haiku` - no `Skill` tool, so a preload is the only route to the passphrase.

**Run 1 - what registers.**

```
claude --plugin-dir $S/plugin -p 'List every agent type available to you ...' --output-format json
```

```
claude, Explore, general-purpose, Plan, spike:seat-bare, spike:seat-scoped, statusline-setup
```

The skill registers as `spike:alpha`. Both agents register, plugin-scoped.

**Run 2 - the scoped preload.** Dispatch `spike:seat-scoped`, 'ask it for the passphrase, reply with
its answer only'. Result: `HERON-42`. The subagent transcript's only tool call is
`SubagentHandback` - no `Skill` call.

**Run 3 - the bare preload.** Dispatch `spike:seat-bare`, same prompt. Result: `HERON-42`. Same
transcript shape: `SubagentHandback` only, no `Skill` call.

**Run 4 - the bare AGENT name.** Dispatch with `subagent_type: seat-scoped`, no prefix, instructed
not to retry under another spelling:

```
Agent type 'seat-scoped' not found. Available agents: claude, Explore, general-purpose,
Plan, spike:seat-bare, spike:seat-scoped, statusline-setup
```

**Verdict: PASS.** The plan's condition was 'one form answers HERON-42 with no Skill tool call'.
BOTH forms do. Agents move to the plugin; they do not stay in the seed.

**What it settles for the build:**
- `skills:` in agent frontmatter resolves under BOTH spellings when the plugin skill is the only
  candidate. **Corrected by S6:** it must still be rewritten to the scoped `alfred-code:<skill>`.
  S6 ran the same two agents with a stale project copy of `alpha` present and the bare form
  preloaded the PROJECT copy, silently. Every migrating project has exactly that shape for one
  session. The Phase 3 edit pass stands.
- The DISPATCH surface does change: a plugin agent is addressable only as `<plugin>:<agent>`. Every
  place that names a bare seat name has to carry the prefix - the skills that dispatch seats, the
  trio protocol, and `guard-unapproved-dispatch.js`, whose `*-implementer` test is a bare-name match
  today.
- Hook matchers on `SubagentStart` / `SubagentStop` take the scoped identifier and are regexes, so
  they need anchoring: `^alfred-code:aspnet-implementer$`. `docs-session.js` is wired on both
  events and attributes writes per `agent_id`, so this is a Phase 2 edit, not a Phase 3 one.

**Docs check (same sitting, context7 `/websites/code_claude`):**
- `skills` on an agent: 'Array of skill names to preload into the agent context', and 'To preload
  Skills into the agent's context, use the `skills` field rather than listing `Skill` here'
  (agent-sdk/typescript, AgentDefinition).
- Plugin agent naming: 'For subagents shipped by a plugin, the agent type is the plugin-scoped
  identifier such as `my-plugin:reviewer`, not the bare frontmatter name. The colon places a
  plugin-scoped name on the regular-expression path, so anchor the matcher with `^` and `$` for an
  exact match' (hooks, SubagentStart).

---

## S2 skillOverrides over a plugin skill - PASS (the plan's design stands)

**Question.** Does `skillOverrides` in a project `settings.json` switch a PLUGIN skill off, and under
which key - bare or scoped?

**Method.** One measurement harness for S2, S3 and S6: `claude -p 'Reply with the single word ok'
--output-format json`, summing `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
off the result JSON. The skill carries a 1500-character description with `ALPHA_MARKER_7431` in it,
so a skill that loads is worth roughly 400 tokens and a drop is visible well above the noise.

| settings.json `skillOverrides` | token sum | marker answer |
|---|---|---|
| absent (baseline, 3 runs) | 20050, 20050, 20050 | `spike:alpha` |
| `{"spike:alpha": "off"}` | 20052 | `spike:alpha` |
| `{"alpha": "off"}` | 20052 | `spike:alpha` |
| both keys | 20052 | `spike:alpha` |

**Verdict: PASS, and it is the expected result, not a surprise.** Neither spelling moves the number
(+2 tokens is the settings file itself) and the model still names `spike:alpha` as the skill holding
`ALPHA_MARKER_7431`. `skillOverrides` does not reach a plugin skill.

**What it settles for the build:** trimming stays where the plan put it - a project takes the skills
it wants by choosing marketplace ENTRIES, not by switching individual plugin skills off after the
fact. No per-skill opt-out surface is built.

---

## S3 permissions.deny over a plugin agent - PASS

**Question.** Does `permissions.deny` drop a plugin agent from the listing, and does its description
stop being paid for?

**Run.** Project `settings.json` `"permissions": {"deny": ["Agent(spike:seat-bare)"]}`, the same
measurement harness. `seat-bare` carries a 1500-character description holding `BETA_MARKER_9182`.

```
without deny   sum=20441   'is BETA_MARKER_9182 in your agent descriptions?' -> YES
with deny      sum=20007   same question -> NO
```

**Verdict: PASS.** -434 tokens, which is the description, and the agent is gone from the listing.

**What it settles for the build:** a project that wants a seat off has a real lever, and it is the
per-seat trim the plan assumed. `Agent(<plugin>:<name>)` is the spelling - the scoped identifier,
matching S1's dispatch finding.

---

## S4 bin/ on PATH - PASS on macOS, Windows NOT RUN

**Question.** Does a plugin's `bin/` land on PATH for the model's own Bash calls, and for a child
shell?

**Run.** `bin/spike-cli`, `#!/usr/bin/env node`, prints a marker.

```
spike-cli                       -> marker printed
command -v spike-cli            -> <plugin>/bin/spike-cli
pwsh -NoProfile -Command spike-cli -> marker printed (child shell inherits PATH)
```

**Verdict: PASS on macOS.**

**Windows: NOT RUN** - no Windows machine in this session. The specific untested risk is the
`#!/usr/bin/env node` shebang: Windows has no shebang handling, so whether Claude Code shims a
`bin/` entry there (a generated `.cmd`, or invoking through node) is unknown. Phase 4 carries a
Windows check for it, and until that check runs no shipped code path may depend on a `bin/` entry
being callable as a bare word on Windows.

---

## S5 plugin hooks - PASS, with one branch NOT RUN

**Question.** Do plugin `hooks/hooks.json` entries fire for every event the stack uses, in exec form
with `args` and `timeout`, and what is in scope when they do?

**Run.** Five entries, each `{"type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/log-hook.js",
"args": ["<label>"], "timeout": 10}`: `SessionStart` (bare), `SessionStart` with `matcher: "compact"`,
`UserPromptSubmit`, `PreToolUse` on `Bash`, `Stop`, `SubagentStop`. The script appends one JSON row per
firing to `$CLAUDE_PLUGIN_DATA/fired.jsonl`.

Observed over the spike session: SessionStart-any 2, UserPromptSubmit 3, PreToolUse-Bash 1, Stop 2,
SubagentStop 1. Every row carried `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`,
`cwd`, and `ALFRED_CODE_DOCS_PATH=docs-x` read out of the project `settings.json` `env`. Rows landed
at `~/.claude/plugins/data/spike-inline/fired.jsonl`.

**Verdict: PASS.** Exec form with `args` and `timeout` works, all five events fire, and the three
variables the thirteen hooks read are in scope.

**NOT RUN:** whether `matcher: "compact"` fires on a real compaction. A one-shot `-p` run cannot
compact. What the run DID show is that the matcher is applied: the `compact` entry did not fire on a
startup session while the bare `SessionStart` entry did, so SessionStart matchers are honoured.
`guard-fresh-session-start.js` depends on the `compact` matcher, so Phase 2 must exercise a real
compaction before that hook moves.

---

## S6 coexistence - PASS, and it overturns part of S1

**Question.** During the migration window a project holds the OLD install's `.claude/skills/` and
`.claude/agents/` while the new plugin is already enabled. What does the duplication cost, and which
copy wins?

**Run.** The project got its own `.claude/agents/seat-bare.md` and `.claude/skills/alpha/SKILL.md`,
the latter with the body `The passphrase is OWL-7` against the plugin skill's `HERON-42`.

```
plugin only                   sum=20443
plugin + project duplicates   sum=21308      (+865 tokens)
```

Both copies appear in the listing - `seat-bare` and `spike:seat-bare`, `alpha` and `spike:alpha`.
There is no dedupe.

Then the shadowing test. Dispatch `spike:seat-bare` - a PLUGIN agent whose frontmatter says the bare
`skills: alpha` - and ask it for the passphrase:

```
spike:seat-bare    (skills: alpha)        -> OWL-7      the PROJECT's skill
spike:seat-scoped  (skills: spike:alpha)  -> HERON-42   its own plugin skill
```

**Verdict: PASS (the question is answered), and it changes the build.** S1 concluded that the 43
seats' `skills:` lines need no rewrite. That is wrong for exactly the window this migration creates:
with a stale project copy present, a bare `skills:` line preloads the STALE copy, silently, with no
error and no sign in the transcript. Every project being migrated has that shape for at least one
session.

**What it settles for the build:**
- Phase 3 rewrites all 43 seats' `skills:` lines to the scoped `alfred-code:<skill>` spelling. The
  edit pass S1 removed goes back in.
- The migration must PRUNE the old `.claude/skills/` and `.claude/agents/` in the same run that
  enables the plugin, not leave them for a later cleanup. 865 tokens is the visible cost of leaving
  them; the silent wrong-copy preload is the real one.

---

## S7 agent schema under --strict - PASS

**Question.** Does `claude plugin validate --strict` accept the frontmatter keys the 43 seats use,
`color:` in particular?

**Run.** `color: blue` on an agent alongside `description`, `tools`, `model`, `skills`.

```
with color, without author   -> exit 1, one warning: 'No author provided'
with color, with author      -> exit 0, Validation passed
```

**Verdict: PASS.** `color:` is accepted; the only thing `--strict` failed on was the missing `author`
field, which the real plugin.json carries.

---

## S8 cross-marketplace dependency - PASS

**Question.** Does `dependencies` resolve across marketplaces with
`allowCrossMarketplaceDependenciesOn`, and does the install preserve a project settings file that
already has content?

**Run.** Marketplace `dep-mkt` holding `depee`; marketplace `spike-mkt` holding `spike2` whose entry
declares `dependencies` on `depee@dep-mkt` and whose marketplace declares
`allowCrossMarketplaceDependenciesOn: ["dep-mkt"]`. The project `settings.json` already carried
`"env": {"ALFRED_CODE_DOCS_PATH": "docs-x"}`.

```
claude plugin install spike2@spike-mkt --scope project
  -> Successfully installed plugin: spike2@spike-mkt (+ 1 dependency: depee)
```

```json
{ "env": { "ALFRED_CODE_DOCS_PATH": "docs-x" },
  "enabledPlugins": { "spike2@spike-mkt": true, "depee@dep-mkt": true } }
```

**Verdict: PASS.** The dependency installs across marketplaces, and the install adds a key rather
than rewriting the file.

**What it settles for the build:** superpowers can be a hard `dependencies` entry on the core plugin,
as the ruling assumed, and the installer does not have to hand-manage its enablement.

---

## S9 shared-source entries - PASS on the plan's condition, one added assert FAILED

**Question.** Can several marketplace entries share ONE source tree, each listing the paths it
actually ships, so no generated per-plugin folders are needed?

**Setup.** One tree, `.claude-plugin/marketplace.json` with two entries, both `strict: false` and
both `source: "./"`:

```json
{ "name": "shared-one", "source": "./", "strict": false,
  "skills": ["./stack/skills/alpha"], "agents": ["./stack/agents/shared-seat.md"] }
{ "name": "shared-two", "source": "./", "strict": false,
  "skills": ["./stack/skills/beta"] }
```

**Run - the plan's PASS condition.** Install entry ONE only, then ask the session which markers are
in its skill descriptions:

```
installed: shared-one          -> SHARED_ALPHA_1111            (SHARED_BETA_2222 absent)
then also: shared-two          -> SHARED_ALPHA_1111, SHARED_BETA_2222
```

**Verdict: PASS.** Per-entry path lists scope what loads. No generated folders; the design stands.

**Assert (a) - an agent listed as a FILE: PASS.** `agents: ["./stack/agents/shared-seat.md"]` passes
`claude plugin validate --strict` and registers as `shared-one:shared-seat`.

**Assert (b) - a default `hooks/hooks.json` with no explicit `hooks` key: PASS.** It loaded and fired
once, `CLAUDE_PLUGIN_ROOT` pointing at the shared root. No duplicate-load error.

**Assert (c) - nothing at the shared root is auto-discovered: FAILED.** Everything at the shared root
loads, whether an entry lists it or not, and an explicit list does not suppress it:

| at the shared root | what happened |
|---|---|
| `agents/root-decoy-seat.md` | loaded, and ONCE PER ENTRY: `shared-one:root-decoy-seat` AND `shared-two:root-decoy-seat` |
| `commands/root-decoy.md` | loaded as `shared-one:root-decoy` |
| `.mcp.json` | registered as `plugin:shared-one:root-decoy-mcp` |
| `hooks/hooks.json` | fired ONCE across both entries, attributed to `shared-two` |

Entry one listed `agents: ["./stack/agents/shared-seat.md"]` and still got the root agent on top of
it. Root agents and commands DUPLICATE per entry; the root `.mcp.json` and `hooks/hooks.json`
collapse to a single load, each attributed to a different entry. That attribution is not something to
build on.

**What it changes.** Not the design - a constraint on it. The shared source root must carry none of
`agents/`, `commands/`, `skills/`, `hooks/hooks.json`, `.mcp.json`. This repo's root satisfies that
today with ONE exception: its own machine-local `.mcp.json` (untracked, gitignored, present because
this repo is itself a consuming project). A marketplace added from a GitHub source never sees it, since
the clone carries no ignored file. A marketplace added from a LOCAL PATH does - which is exactly how
the temp-project matrix installs from this working tree. Two things follow, both Phase 1 work:
- a lint check that the repo root carries none of those five names, `.mcp.json` exempted as untracked;
- the matrix installs from a CLEAN export (`git archive` of the working tree) rather than the working
  directory itself, so a machine-local `.mcp.json` cannot leak into a temp project and cannot make a
  matrix case pass or fail for a reason that has nothing to do with the change under test.

**Docs check (same sitting, context7 `/websites/code_claude`, plugin-marketplaces):** the shared-source
form is documented, and for SKILLS only: 'When several plugin entries share one `skills/` folder at the
marketplace root (`source: "./"`), list specific subdirectories instead so each entry loads only its own
skills', and 'With a marketplace-root `source`, the listed paths are the complete set for that entry, and
other directories in the shared `skills/` folder do not load. Listing `./skills/` itself, or the plugin
root, keeps the full scan. If none of the listed paths exist, the default scan runs instead.' That is
exactly the measured behaviour for skills. The same page says of `skills` generally that listed paths
'add to that scan' - which is what the root `agents/` did here, so the complete-set rule is a SKILLS rule,
not a per-type one. Two things to carry into Phase 1: an entry may declare `hooks` and `mcpServers` INLINE
in the marketplace entry rather than by path (the documented 'advanced plugin entry'), which sidesteps the
shared root for both; and `bin/` cannot ship in a plugin distributed through claude.ai organization
settings. The inline hooks / mcpServers form is documented but NOT SPIKED - Phase 1 exercises it before
anything depends on it.

---

## S10 plugin .mcp.json server cwd - PASS, better than the condition asked

**Question.** When an MCP server is declared in a plugin's `.mcp.json`, what is its working directory?
`serena --project-from-cwd` finds `.serena/project.yml` in its cwd, so the whole serena registration
depends on the answer.

**Run.** A stub server recording its environment and exiting:

```json
{ "mcpServers": { "cwd-probe": {
  "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/mcp-stub.js", "--probe"],
  "env": { "PROBE_LITERAL": "${CLAUDE_PROJECT_DIR}",
           "PROBE_FROM_PROJ_ENV": "${ALFRED_CODE_DOCS_PATH}" } } } }
```

```json
{ "cwd": "<project dir>",
  "CLAUDE_PROJECT_DIR": "<project dir>",
  "CLAUDE_PLUGIN_ROOT": "<the plugin's source root>",
  "CLAUDE_PLUGIN_DATA": "~/.claude/plugins/data/shared-one-shared-mkt",
  "ALFRED_CODE_DOCS_PATH": "docs-x",
  "argv": ["--probe"],
  "PROBE_LITERAL": "<project dir>",
  "PROBE_FROM_PROJ_ENV": "docs-x" }
```

**Verdict: PASS.** `cwd` IS the project directory, so `--project-from-cwd` keeps working and Phase 6
is not gated shut.

**Three further facts the run establishes, all of which a project `.mcp.json` does NOT give:**
- `${CLAUDE_PROJECT_DIR}` EXPANDS in a plugin `.mcp.json`, in `args` and in `env`. In a project
  `.mcp.json` it is not reliably in scope at parse time, which is why `--project ${CLAUDE_PROJECT_DIR}`
  is on this repo's do-not-retry list. Inside a plugin that objection is gone.
- ~~The PROJECT `settings.json` `env` reaches the expansion.~~ **WRONG - retracted 2026-09-22**, see
  'Phase 6 spikes' below. A dedicated probe with the key ONLY in the project file got the literal
  `${KEY}` back; this run's `PROBE_FROM_PROJ_ENV` was reading the shell, where the installer exports
  the same name. A plugin MCP entry sees exactly what a project `.mcp.json` sees: the shell plus the
  ACCOUNT `settings.json` `env`. Phase 6 gets no new per-project channel and uses a launcher instead.
- `${CLAUDE_PLUGIN_ROOT}` expands inside `args`, so a server shipped as a script in the plugin is
  addressable without an absolute path.

**Docs check (same sitting, context7 `/websites/code_claude`, mcp + hooks):** 'Claude Code sets
`CLAUDE_PROJECT_DIR` in the spawned server's environment to the project root', and, naming the exact
difference this spike measured: 'referencing it via `${VAR}` expansion in the `command` or `args` of a
project-scoped `.mcp.json` entry ... requires a default such as `${CLAUDE_PROJECT_DIR:-.}`.
Plugin-provided MCP configurations substitute `${CLAUDE_PROJECT_DIR}` directly and do not need the
default.' Expansion locations are `command`, `args`, `env`, `url` and `headers`. So this repo's
do-not-retry note on `--project ${CLAUDE_PROJECT_DIR}` is a PROJECT-.mcp.json note; inside a plugin the
documented behaviour and the measured behaviour agree that it works.

---

## Phase 1 - inline hooks and mcpServers in a marketplace entry - PASS

**Question.** S9's assert (c) failed: a shared source root is auto-discovered by every entry over it.
The docs offer a second form - an entry may declare `hooks` and `mcpServers` INLINE instead of by
path. Does that give each entry its own, over one shared root, with no duplicate load?

**Run.** One tree, two entries, both `source: './'` and `strict: false`, each with a DIFFERENT inline
`hooks` block calling the same logger with its own label; entry one also declares an inline
`mcpServers`. Nothing at the shared root: no `hooks/`, no `.mcp.json`, no `agents/`, no `commands/`.

```json
{ "name": "inline-one", "source": "./", "strict": false,
  "skills": ["./stack/skills/alpha"],
  "hooks": { "SessionStart": [ { "hooks": [ { "type": "command",
      "command": "${CLAUDE_PLUGIN_ROOT}/scripts/log-hook.js", "args": ["inline-ONE"], "timeout": 10 } ] } ] },
  "mcpServers": { "probe-one": { "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/mcp-stub.js", "--one"] } } }
```

```
claude plugin validate . --strict          -> Validation passed
inline-one-inline-mkt/fired.jsonl          -> 1 row: inline-ONE   root=mkt-inline
inline-two-inline-mkt/fired.jsonl          -> 1 row: inline-TWO   root=mkt-inline
inline-one-inline-mkt/mcp-start.json       -> argv ["--one"], cwd=proj, CLAUDE_PROJECT_DIR=proj
claude mcp list                            -> plugin:inline-one:probe-one   (entry TWO registers none)
```

**Verdict: PASS.** Each entry gets its OWN hooks, fired once, attributed to its own plugin and its own
data directory, with `CLAUDE_PLUGIN_ROOT` pointing at the shared root so a bundled script resolves.
The inline `mcpServers` belongs to the declaring entry alone.

**What it settles for the build.** This is the real remedy for S9(c), better than policing the root:
the stack declares hooks and MCP servers INLINE in each marketplace entry and puts nothing at the
shared root at all. The root-cleanliness lint check stays as the guard that keeps it that way, since
`agents/`, `commands/` and `skills/` have no inline form and are still auto-discovered from the root.

---

## Phase 2 - every event type through an INLINE entry - PASS

**Question.** Phase 1's T7 proved the inline `hooks` form for SessionStart only. The stack wires six
event types. Do they all fire inline, with their matchers honoured?

**Run.** One entry, `source: './'`, `strict: false`, declaring SessionStart (bare and `matcher:
compact`), UserPromptSubmit, PreToolUse with three matchers (`Bash`, `Task|Agent`, `Read`),
SubagentStart, SubagentStop and Stop, all against
`${CLAUDE_PLUGIN_ROOT}/stack/hooks/log-hook.js` in exec form with `args` and `timeout: 10`.

```
claude plugin validate . --strict          -> Validation passed

session 1 (bash, then a dispatched Explore subagent):
  SessionStart-any 1   UserPromptSubmit 3   PreToolUse-Bash 2   PreToolUse-Task 1
  SubagentStart 1      SubagentStop 1       Stop 3             (12 rows)

session 2 (one Read):
  SessionStart-any 1   UserPromptSubmit 1   PreToolUse-Read 1   Stop 1
```

**Verdict: PASS.** All six event types fire from an inline entry, and the PreToolUse matcher is
applied per entry (`Bash`, `Task|Agent` and `Read` each fired only for their own tool).
`SubagentStart` and `SubagentStop` - which `docs-session.js` needs for per-agent write attribution -
work the same way.

**Still NOT RUN:** `matcher: "compact"` on a REAL compaction. It did not fire on either session, which
is correct for a startup session and consistent with S5, but a one-shot `-p` run cannot compact. The
hook that depends on it, `guard-fresh-session-start.js`, therefore keeps its copied wiring until that
branch is exercised.

---

## Phase 2 delivery - what the temp-project matrix caught

Four findings, all from reading RESULT files rather than exit codes. Each is fixed and covered.

**1. The prune ran one step too early.** `update_hooks` is `prune_retired_hooks; download_hooks;
wire_hooks_settings`, and the plugin route appended the whole `HOOKS_CATALOG` to `RETIRED_HOOKS`
inside `wire_hooks_settings` - after the prune had already walked the list. An update over a 0.2.x
install therefore dropped all thirteen WIRINGS and left all ten `guard-*.js` FILES on disk
(`hookwindow: every stack guard file is pruned: expected '0', got '10'`). The append moved to load
time in both twins, beside the `RETIRED_HOOKS` declaration. Re-run: 11 pass, 0 fail.

**2. `hooksmoke` went hollow.** The case looped over `<project>/.claude/hooks/*.js` and skipped the
two engines, so once the guards stopped being copied it smoked NOTHING and still reported PASS
(`hooks smoked: 0` in the log, with a green line above it). The case now picks whichever home the
install used - the copied files, else the source tree the plugin serves - prints it, and FAILS below
13 hooks. This is the exact failure mode the matrix exists to catch, found in the matrix itself.

**3. `ALFRED_CODE_HOOKS_OFF` carried each hook twice.** A hook wired on two events has two
`HOOKS_CATALOG` rows, so the complement listed `guard-read-whole-file.js` twice. De-duplicated in
both twins; the value is a list of NAMES.

**4. The `hooksoff` control proved nothing at first.** The case fired the switched-off guard on
`cat src/main.ts`, a 1-line file the guard does not judge, so 'silent' was not evidence. It now
writes a 400-line file, and asserts BOTH directions: silent with the value (exit 0, zero bytes) and
judged without it (exit 2). Only the second assert makes the first one mean anything.

### The walk's hooks layer - ruling R4

The layer was going to be deleted. It stays and now feeds `ALFRED_CODE_HOOKS_OFF` with the
complement of the user's picks, because deleting it removes a real choice and renumbers a
twelve-step walk in two commands. Only a selection that CARRIES `hook ` lines counts as an answer:
`update --installed-only` reads hooks off disk, and on the plugin route there are none, which would
otherwise be read as 'the user dropped all thirteen'. An answer OVERWRITES the stored value - the
one exception to absent-only env seeding, since the user is looking at the question as it is asked.
Covered by two tests in `scripts/mcp-verify.test.js` (both twins) and the `hooksoff` matrix case.

### `status` reads the guard from either home

`/alfred-code:status` is deliberately offline (no snapshot, no `$TMP`), and its presence read called
`node .claude/hooks/guard-secret-value.js`, which the plugin route removes. The line now takes
whichever home exists, newest first: the project copy, else
`<config>/plugins/cache/envoydev/alfred-code-hooks/*/hooks/`. The cache layout was verified in
the same sitting against this machine's `~/.claude/plugins/installed_plugins.json` (`installPath`
reads `<config>/plugins/cache/<marketplace>/<plugin>/<version>`), and the resolver was exercised in
all four states - plugin only, both, copy only, neither - with the last leaving `$G` empty so the
command falls through to its existing 'not checked' wording.

### Still NOT RUN, carried forward

`matcher: "compact"` on a REAL compaction, through a plugin. Phase 0 said
`guard-fresh-session-start.js` would keep its copied wiring until that branch was exercised; it
moved with the other twelve instead, because the matcher is evaluated by Claude Code before it
dispatches to a hook and S5 already proved plugin SessionStart hooks fire. That is reasoning, not a
measurement - recorded here as NOT RUN, not as a pass.

## Phase 3 delivery - what the temp-project matrix caught

Eight findings, all from reading RESULT files rather than exit codes. Each is fixed and covered.

**1. A new script the matrix could not see.** `scripts/selection-plugins.js` was written but never
`git add`ed, and `clean-export.js` exports `git ls-files`. So the export had no resolver, every run
fell back to the copy route, and the first `skillsplugin` run read `79 43` where it expected the
extras. The installer's fail-soft worked exactly as designed - which is why the case failed on the
COUNT and not on a crash. Tracked, re-run green.

**2. `update` never installed the stack's own plugins.** `update_plugins` / `Update-Plugins`
iterated `$PLUGINS` only, so `claude plugin update` ran over the third-party six and never over
`alfred-code-hooks` or any per-stack entry - and `claude plugin update` is a no-op on a plugin that
is not installed. An update from a 0.2.x install would therefore have pruned every copied hook,
skill and agent and enabled nothing in their place. This is a Phase 2 defect the Phase 3 cases
surfaced: the stack entries now travel the same install-when-absent, enable-when-parked, then-update
loop as everything else, in both twins.

**3. The `disable-model-invocation` gate died silently on the new route.**
`guard-fresh-session-start.js` read the flag from `<root>/.claude/skills/<name>/SKILL.md` and
swallowed a missing file in its catch. Thirteen skills carry the flag and the core plugin carries
several of them, so the gate would have stopped firing the moment the skills moved, with no error
anywhere. It now reads both homes - the project copy first, then
`<config>/plugins/cache/<marketplace>/<plugin>/<version>/stack/skills/<name>/SKILL.md` - and a
scoped call (`alfred-code:project-quality-loop`) narrows the scan to its own plugin. Covered by a
new test in `scripts/guard-hooks.test.js` against a fixture cache.

**4. `analyze-usage.js` would have scored a plugin-native install as empty.** Its inventory is
`.claude/skills|agents|rules`, so the efficiency scorecard would have reported 1 skill and 1 agent
installed and judged every unused-but-paid-for row against a set the session never had. It now
unions the directory with the layers the ENABLED plugins serve, read from `settings.json` plus the
same cache layout, and names them in its `why` line. Fail-soft: a bundle analysed on another machine
has no cache and the directory stands alone.

**5. The capabilities capture read the extras and called it the project.**
`capabilities-inventory.js` consulted the plugins only when the local dir was EMPTY, and on this
route `.claude/skills` still holds the 25 extras - so a plugin-native install reported `SKILLS: 25,
SEATS: 1` and would have generated the project's routing rule over that. The layers are now UNIONED,
with a local copy winning a name clash (it is what the harness loads first).

**6. A shared plugin root credits every entry with every sibling's items.** Fixing (5) by scanning
`<installPath>/stack/skills|agents` gave `95 skills and 860 seats`: each of the 20 stack entries has
the WHOLE repo in its cache. The entry's own lists in the marketplace manifest shipped in that root
are read instead, and the scan is kept only for a plugin with a root of its own. A first cut of that
read still fell back to scanning when an entry listed nothing, which handed `alfred-code-hooks` all
43 seats (85 where the truth is 42 plus one local extra); an entry that exists and lists nothing now
ships nothing. Final, against a real install: `SKILLS: 81, SEATS: 43`. The same manifest-first read
went into `analyze-usage.js`.

**7. A skill body that ran its own script by project path.**
`project-agent-capabilities/SKILL.md` told the model to run
`node .claude/skills/project-agent-capabilities/scripts/capabilities-inventory.js`, which does not
exist on this route - the skill itself is served by a plugin. It is the only skill body in the
manifest that invokes its own script that way (`grep -rl 'node \.claude/skills/'`, one file, three
sites). The body now resolves the script ONCE into `$CAPS` and reuses it. The resolver uses `find`
over the plugin cache rather than a glob: zsh, the default shell on macOS, treats an unmatched glob
as an ERROR and kills the command, which is also why `/alfred-code:status` moved off the `ls -dt`
form Phase 2 gave it. Both were exercised under zsh against a real plugin-native install.

**8. `--skills-only` would have left a project with neither route.** The flag runs the skill step and
exits, and on this route that step PRUNES the copies - so it removed every stack skill and enabled
nothing. It now also installs the run's stack plugins, fail-soft and only when the CLI is there, so
the copy route keeps the CLI-free contract the flag was built for. The stack-plugin set moved into
one helper (`_stack_plugin_set` / `Get-StackRunPlugins`) shared by install, update and this path,
rather than a third copy. A first cut used a bash nameref (`local -n`); macOS ships bash 3.2, which
has none, so it fills a global instead - and `/bin/bash -n` is now part of the syntax check. The
first fixed run then failed the new `skillsonly` case on `0|NO-CORE`: this path never called
`ensure_official_marketplace`, and the core entry DEPENDS on superpowers, so all twenty entries
failed with `Dependency "superpowers@claude-plugins-official" ... not found` and the project ended
with 25 extras and no plugins at all. Registering it first is the fix, in both twins. The case that
caught it asserts both directions - the plugin route enables the closure, the copy route installs no
plugin at all - and re-ran green at 35 pass, 0 fail.

### Two contracts the carried-over cases had to be re-cut against

`update` restored `markdown-style` after deleting it; on the default route that skill is carried by
a plugin and deliberately absent from `.claude/skills`, so the case now deletes and restores an
EXTRA (`angular-material`) instead. And `phase1` expected NO stack plugin enabled against the
published marketplace; the core entry has existed there since 0.2.x, so a migration-window install
enables exactly `alfred-code@envoydev` and reports all twenty siblings failed. Both re-cut, and
the second is the honest picture of the window this release closes.

### The scope ruling, as implemented

The ruling was 'the core at user or project scope, per-stack entries at project scope only'. The
installer gives every stack entry the RUN's scope, which satisfies it for a project install (the
only case where the two differ) and keeps a `--scope user` install with the account-wide reach the
copy route gave it, since a user-scope run has no project to scope anything to.

---

## Cleanup

The three scratch marketplaces (`shared-mkt`, `spike-mkt`, `dep-mkt`) are removed from the user
settings and the project's `enabledPlugins` is back to `{}` with its `env` key untouched.

One gotcha recorded on the way out, and it is Phase 5 and Phase 7 work: `claude plugin uninstall
<p>@<m>` REFUSES a plugin enabled at project scope - 'is enabled at project scope (.claude/
settings.json, shared with your team). To disable just for you: claude plugin disable <p>@<m> --scope
local'. Removing the marketplace pruned the entries from `enabledPlugins` instead. The installer's
prune path (RETIRED_PLUGINS) cannot assume `uninstall` works at project scope.

---

## Phase 4 dependencies - what the docs settle and what the tests caught

**Verified against the current docs, 2026-09-22** (`https://code.claude.com/docs/en/plugin-dependencies`,
plus `/docs/en/plugins-reference` for `claude plugin disable`):

| Claim | What the docs say |
|---|---|
| The lock is real | 'disabling a plugin is blocked if another enabled plugin still needs it', with a chained `claude plugin disable <dependent> && claude plugin disable <dependency>` in the refusal |
| Enabling pulls the chain | 'When you enable a plugin, Claude Code also enables its dependencies at the same scope', writing an explicit `true` for each, even when the dependency's manifest sets `defaultEnabled: false` |
| The one failure that matters here | 'A dependency is set to `false` at a scope with higher precedence than the target scope' makes the enable FAIL |
| Cross-marketplace trust does not chain | only the ROOT marketplace's `allowCrossMarketplaceDependenciesOn` is consulted; a missing entry fails with a `cross-marketplace` error |

Spike S8 had already measured the happy path: the dependency installs across marketplaces and the
install ADDS a key to `settings.json` rather than rewriting the file.

So `superpowers` leaves the installer's `PLUGINS` pick list and arrives as the core entry's
dependency. It stays in the block COMMENTED, because three readers build their catalog from that
block and 27 skills and agents cite it: `stack-graph.js` `catalog.plugins`, the parity lint's
resolvable namespaces, and the walk's plugin layer. The walk now prints it with its own status
(`dependency`, 'carried by alfred-code@envoydev - cannot be dropped') rather than as a pick the
closure happens to force.

### Three defects, each found by reading a result rather than an exit code

1. **The copy route would have lost it entirely.** With `ALFRED_CODE_HOOKS_VIA_PLUGIN=false` and
   `ALFRED_CODE_SKILLS_VIA_PLUGIN=false` no stack plugin is enabled, so nothing pulls the
   dependency - and both switches promise the 0.2.x route UNCHANGED. Both twins now carry
   `CORE_DEP_PLUGINS` and install it explicitly when, and only when, the run enables no stack
   plugin. Lint check 51 pins that list to the generated core entry, in both directions.

2. **A one-row `claude plugin list --json` was dropped by the ps1 twin** - pre-existing, and the
   Phase 4 dependency-lock fixture is simply the first with exactly one row. `ConvertFrom-Json`
   unwraps a one-element array into a single `PSCustomObject`, which is not `IEnumerable`, so the
   shape test fell through to `@()` and every caller silently kept its defaults: `plugin update` at
   the wrong scope, a parked plugin never enabled, a retired plugin never pruned. The sh twin was
   never affected (`json.load` keeps the list). Fixed and regression-tested on the ps1 side.

3. **Two test files were asserting the delivery route by accident** - `source-cache.test.js` (which
   SOURCE a run resolved: archive, cache, marketplace clone, offline) and `skill-install.test.js`
   (which skills a run copied, and which source it stamped). Both read their answer through a skill
   landing in `.claude/skills`, and on the plugin route a stack skill is carried rather than copied,
   so seven assertions stopped meaning anything the moment `selection-plugins.js` reached `HEAD` -
   the file their own `git archive HEAD` / fixture-clone setups ship. They were green in the Phase 3
   run only because that run happened before the commit. Both now pin the copy route explicitly,
   with the reason: the delivery route has its own proofs in `mcp-verify.test.js` and the matrix.

Plus test upkeep the change forces, not a defect: three assertions named `superpowers` as a PICK in
the installer's derived plan (`selection.test.js` both twins, `skill-install.test.js`'s
`--installed-only` plan). It no longer travels that loop, so they now name a plugin that does.

### What did NOT need changing

The in-marketplace edges (per-stack -> family base -> core) and the `allowCrossMarketplaceDependenciesOn`
allowlist were already generated in Phase 1. They are now pinned by tests over the SHIPPED manifest:
every entry's dependency closure reaches the core, no cycle, only the core reaches outside the
marketplace, and the allowlist names exactly the marketplaces the entries reach into.

### S4's Windows gap, closed as a constraint

Spike S4 proved a plugin `bin/` entry lands on PATH on macOS and recorded Windows as NOT RUN: Windows
has no shebang handling, and whether Claude Code shims a `bin/` entry there is unknown. There is no
Windows machine in this session either, so the gap is enforced rather than re-reported: lint check 52
fails when a `bin/` appears at the repo root or under `stack/` or `setup-plugin/`, or when any
marketplace entry lists a path that reaches one. Running the Windows check is what lifts it.

---

## Phase 6 spikes - S11, S12, S14, and a CORRECTION to S10

Run 2026-09-22 on Claude Code **2.1.278**, in a throwaway project with its own `CLAUDE_CONFIG_DIR`,
against a local marketplace holding two plugins whose servers are stubs that record their
environment. Nothing here is inferred from docs: every row is what the CLI did.

### CORRECTION - S10's third claim is FALSE

S10 recorded that 'the PROJECT `settings.json` `env` reaches the expansion'. It does not. One probe,
five placeholders, one spawn:

| where the key lives | `${KEY}` in a plugin server's `env` |
|---|---|
| project `.claude/settings.json` `env` | **NOT expanded** - arrives literally as `${SPIKE_PROJECT_KEY}` |
| ACCOUNT `settings.json` `env` | expanded (`from-account`) |
| shell environment | expanded (`from-shell`) |
| `${KEY:-fallback}`, key absent everywhere | expanded to `fallback` |
| `${KEY}`, key absent everywhere | **stays literal** - this is S14's answer |

S10 most likely read `${ALFRED_CODE_DOCS_PATH}` out of the shell, not the project file. So a plugin
MCP entry sees exactly the two sources a project `.mcp.json` sees, and Phase 6 gets NO new
per-project env channel. Per-project values need a launcher that reads the project itself - which
works, because a stdio server's `cwd` IS the project dir (S10's first claim, re-confirmed here).

`${CLAUDE_PROJECT_DIR}` and `${CLAUDE_PLUGIN_ROOT}` both expand, in `args` and in `env`.

### S11 - sentry auth in a plugin: PASS, with one shape trap

- **`headersHelper` is a STRING command, not an object.** The object form
  (`{"command": ..., "args": [...], "env": {...}}`) is rejected and takes the WHOLE server with it:
  `claude plugin details` then reports `MCP servers (0)` with no error anywhere. Bisected - stdio
  loads, http with static `headers` loads, http with an object `headersHelper` does not, http with a
  string `headersHelper` does.
- It really runs, and its stdout really becomes the request headers: pointed at a local sink, the
  sink logged `{"url":"/mcp","auth":"Sentry-Bearer probe-token"}` - the exact header the helper
  printed.
- **Its cwd is the PLUGIN ROOT, not the project**, and `CLAUDE_PROJECT_DIR` is absent from its
  environment. `${CLAUDE_PROJECT_DIR}` DOES expand inside the helper string, so the project is
  passed as an argument.
- **Settings-env keys do NOT expand in the helper string** (`acct=${SPIKE_ACCOUNT_KEY}` arrived as
  `acct=`), although the same key DOES expand in `url` (the sink saw `/mcp/from-account`). So the
  helper reads the token itself rather than taking it on a command line - which is the better shape
  anyway: a credential never reaches `ps`.

### S12 - a disabled plugin's servers: PASS

Two plugins, one server each, both enabled: `claude mcp list` shows both, named
`plugin:<plugin>:<server>` - the same spelling the `mcp_tool` hook `server` field takes. Disable one
and its server is gone from the listing while the other stays; disable both and the CLI reports 'No
MCP servers configured'. Droppability by enable/disable works, at project scope.

### Two operational facts the runs turned up

- A marketplace added from a LOCAL DIRECTORY loads its plugins IN PLACE (`CLAUDE_PLUGIN_ROOT` is the
  marketplace dir, not a cache entry), so an edit needs `claude plugin marketplace update` plus
  `claude plugin update <name> --scope <scope>` before it is live. `plugin update` without `--scope`
  defaults to user scope and fails with 'not installed at scope user'.
- Writing `.claude/settings.json` wholesale CLOBBERS `enabledPlugins`: a spike that rewrote the file
  to set one env key silently disabled both plugins. The installers merge rather than overwrite;
  anything else that touches that file must too.

## Phase 6 implementation - what building it measured

Four things the spikes had not asked, all found by running the installer rather than reading the plan.

### A plugin's servers load TOGETHER, so packaging IS a per-session cost

The first shape put the four playwright engines in one `playwright` entry and context7's hosted plus
local server in one `context7` entry - eight entries for eight catalog names, which reads tidy. It is
not: a plugin's servers all load, so a project that kept ONE browser would have paid four copies of
playwright's tool schemas in every session, and every project two copies of context7's. The
registration route never did that (one server per KEPT engine, one context7 for the chosen
transport), so this would have been a silent cost REGRESSION introduced by packaging alone.

Rebuilt as 12 entries, one server each, named alike. Lint check 53 fails any entry whose server set
is not exactly `[<entry name>]`.

| shape | entries | servers a 1-browser project loads |
|---|---|---|
| one entry per catalog name | 8 | 4 playwright + 2 context7 + 6 = 12 |
| one entry per server (shipped) | 12 | 1 playwright + 1 context7 + 6 = 8 |

### The sweep: 841 tool names across 61 files

`mcp__<server>__` -> `mcp__plugin_<n>_<n>__`, script-driven from one map, `docs/sessions-investigation/`
excluded as historical evidence. Measured per server: serena 618, memory 167, context7 31,
playwright-chrome 5, -msedge/-firefox/-webkit 4 each, appium-mcp 3, chrome-devtools 2, angular-cli 1,
sentry 1, and one bare `playwright` in a lint test fixture. 24 agents that grant context7 now grant
both transports, because an agent cannot know which one an install chose and a `tools:` list that
omits the live one fails silently.

Lint check 54 builds its ban list from the GENERATED entry names, so the checker cannot itself
contain the spelling it bans and a new server is covered the day its entry lands. Proven both ways:
reverting one `ToolSearch select:` name in `baseline-navigation.md` produced exactly one finding.

### Three readers had `.mcp.json` as their source of truth

- `memory.js` resolved the db path from the `.mcp.json` `memory` entry - which the plugin route never
  writes, so `status` and `validate` would have said `none` and the session-start block would have
  injected nothing. It now reads `ALFRED_CODE_MEMORY_DB` from the project settings first: the same
  key the plugin launcher reads, so resolver and running server agree by construction.
- `instrument-tool-usage.js` and `analyze-usage.js` read `tool.split('__')[1]` as the server name,
  which is now `plugin_<plugin>_<server>`. Both fold it back, so 0.2.x and 1.0.0 transcripts still
  tally into the same rows.
- `enabledMcpjsonServers` pre-approved what the run registered. On the plugin route there is nothing
  to pre-approve, so those names are now DROPPED instead - a leftover entry names a server that no
  longer exists.

Plus four command bodies (`validate`, `configure`, `status`, `update`) that inventoried MCPs from
`.mcp.json` alone and would have reported ZERO servers on every plugin-route install.

### The opt-out route needed the tool names back

`ALFRED_CODE_MCPS_VIA_PLUGIN=false` registers the bare names, where the shipped plugin spelling
resolves to nothing - silently. Granting both spellings everywhere would have cost ~830 extra
entries, most in agent `tools:` lists re-sent on every dispatch, undoing R1's whole saving. So the
copy route RE-SPELLS instead: one pass over the copied `skills`, `agents`, `rules` and `hooks`
turns `mcp__plugin_<n>_<n>__` back into `mcp__<n>__`. It needs the files, so that switch belongs
with `ALFRED_CODE_SKILLS_VIA_PLUGIN=false`; the mixed pair is reported in the log, never half-fixed.

### The escape hatch reintroduced the double-load it exists to prevent

Measured by the `mcpcopy` matrix case, not by reading: with `ALFRED_CODE_MCPS_VIA_PLUGIN=false` the
run wrote serena, context7 and memory into `.mcp.json` AND enabled `serena|context7|memory@envoydev`,
because those three are hard `dependencies` of the core entry and the hooks route had the core on.
Each of the three would have run twice, with both sets of tool schemas in every session.

```
FAIL  mcpcopy: no MCP plugin is enabled: expected 'none', got 'context7,memory,serena'
```

The switch now covers the DROPPABLE five only. The locked three ride the core's dependencies
whenever any plugin route is on and are registered only on the FULL copy route, where the core is
never enabled - so the re-spelling is computed from what a run actually registered bare rather than
applied to everything, and the mixed-route warning names those servers.

### A plugin's headersHelper is handed an environment with the credentials taken out

Not measured on a session - read in the current docs and taken as binding, because it decides where
a token has to live. https://code.claude.com/docs/en/mcp, 'Which variables a helper can read': a
`headersHelper` supplied by a plugin, a project `.mcp.json`, or a project agent file runs WITHOUT the
credential variables from the environment. Every name carrying TOKEN, SECRET, PASSWORD, KEY or AUTH
in either case is removed, plus a fixed list of others; a server at user or local scope, from managed
MCP, from a claude.ai connector, or passed with `--mcp-config` keeps them.

Both keys `stack/mcp/sentry-headers.js` reads match that pattern - `SENTRY_ACCESS_TOKEN` and
`ALFRED_CODE_SENTRY_AUTH` - so on the plugin route its environment branch answers for neither. The
0.2.x `.mcp.json` route expanded `${SENTRY_ACCESS_TOKEN}` straight from the shell, so an install that
relied on an export loses its auth header at the moment the server moves to a plugin.

The resolution order did not change: the helper already read the project and ACCOUNT settings.json
after the environment, and the account file is where both installers write the token. What changed is
that the rule is now stated where someone hits it (the helper's comment, its no-token stderr line,
CLAUDE.md) and proven in `scripts/mcp-launchers.test.js` on an environment scrubbed the way the docs
describe - including that `CLAUDE_CONFIG_DIR` does NOT match the pattern, which is what keeps a
`--space` install able to reach its own account file.

context7's `${CONTEXT7_API_KEY:-}` is untouched by this: that is config expansion, not a helper's
environment. The docs' own note that a helper's `CLAUDE_CODE_MCP_SERVER_URL` arrives with an expanded
credential REDACTED is what says the expansion itself still happens.
