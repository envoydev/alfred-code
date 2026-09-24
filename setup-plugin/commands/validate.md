---
description: "RECONCILE an existing Alfred Code install to THIS project - detect the project's real stacks by artifact (the init step-3 scan), inventory what is installed, then walk the selection one layer at a time (rules -> agents -> skills -> hooks -> MCPs -> plugins) showing, per layer, what is REDUNDANT (installed but its whole owning stack is absent - remove?) and what is MISSING (the detected stacks' + baseline closure not installed here - add?), each pre-marked with its reason and taken on per-item consent. Shared items, deliberate non-stack extras, and the always-baseline already installed are never touched. Detection evidence for every absent stack is shown BEFORE the walk so a mis-detection is vetoable. After the mechanical walk, a JUDGMENT step corroborates the advisory items' non-use in the code (named greps for the skill's domain, its own do-not-load exclusions, the docs' own citations of it) reviews the remainder against the project's stated conventions incl. version pins (a latest-major guidance tool fights a project pinned older - a citable conflict), mirrors gate 1 for ADDS (an uninstalled skill whose domain the code provably touches though no manifest signal covers it - only from trails the run itself surfaced, never a speculative catalog sweep), and hunts functional OVERLAP among kept items (two items covering one capability, the project docs citing only one - proposed only with the survivor's unique gap named) - drops and adds proposed only with gate evidence, each RANKED (MATERIAL/MINOR) and readable as what-it-does / why-marginal-here / the-keep-exception / recommendation, visibly labeled as judgment, never mixed with the signal tiers; plus a plain-text DORMANT advisory naming installed occasion-bound items (their own descriptions mark them release-/upgrade-/audit-time) with each one's honest idle cost and off lever - informational, acted on only by explicit request. Accepted adds and removes apply in ONE installer run over the read-back (--add / --drop) - the path configure uses; only a plugin uninstall and a copy-route MCP removal stay explicit. Project mode only. This is the project-relative two-way audit that init (fresh), update (refresh), and configure (manual add/drop) do not do."
disable-model-invocation: true
---

# Validate Alfred Code - reconcile the install to this project

You are reconciling an Alfred Code install against the project it sits in: removing artifacts whose
framework is absent and offering the detected stacks' artifacts that are not yet installed. Same
discipline as the sibling commands - drive it interactively, walk one layer at a time, show the
evidence/prerequisite before acting, never add or remove without consent. `stack-select.js` does
the deterministic work; you orchestrate.

**This run needs NO conversation context - so it is worth MOVING, but only out of a session that
is actually loaded.** Measure before you ask: this session's own per-message context is `input +
cache_read + cache_creation` off the last assistant message in the transcript. Ask ONLY when that
figure is past the same trigger `guard-fresh-session-start.js` uses - the tier's own absolute
trigger, `ALFRED_CODE_FRESH_SESSION_200K` (default 150,000) or `ALFRED_CODE_FRESH_SESSION_1M`
(default 400,000), or `ALFRED_CODE_FRESH_SESSION_DEFAULT` (default 180,000) when the window is
neither of those two sizes or cannot be read at all - which one applies comes from the session
model's row in `.claude/hooks/model-windows.json`, else `ALFRED_CODE_DEFAULT_CONTEXT_WINDOW` - or when that hook has already
injected the ask into this turn. One more case fires it regardless of the figure: this session already ran ANOTHER guided walk (a
`/alfred-code:` command completed earlier in this chat). That history is pure carry for a run that needs
none of it, and an absolute trigger never catches it - measured, a validate chained behind an update
re-sent that history on all 24 of its messages at 121.7k per message, well under every tier's number.
Below the
trigger and with no earlier guided run, or when the figure cannot be read at all, SKIP the ask silently and start step 1: an ask
with no measurement behind it is the failure this replaced (measured: it fired on the FIRST message
of a brand-new session, twice in one run, and could quote no number when the user challenged it).
Never author the decision in prose either way.

When it does fire, put it through AskUserQuestion: run here anyway, or run in a fresh session
(recommended), quoting the figure you measured - never one measured in some other session. Every
answer names its next action: fresh session -> give the paste-ready one-liner and end the turn;
run here -> start step 1 now; not now -> say what is owed and end the turn. If a redirect displaces
the ask, re-offer it ONCE. Measured: this command's siblings entered at 131,345 and 168,516 tokens
per message with no ask at all, and one of them authored its own prose decision that was never put
to the user.

**THE PLUGIN CACHE IS THE SNAPSHOT - the common run downloads nothing but a newer release** - read `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md`
before step 1 and hold the whole run to it: resolve the snapshot once into `$TMP/repo` - copied from the newest valid plugin-cache entry, downloaded only when there is none, use
`stack-select.js` / the graph / `recommendations.json` / the installer from that snapshot, hand
the installer `--source "$TMP/repo"` in step 11, and remove `$TMP` per the 'Clean up' section on
EVERY exit path. Its 'Narrate, don't trace' section governs every tool call: one quiet call per
recompute, no pasted tool output, one narration line between steps.

**Project mode only.** This command needs a project to reconcile against. If cwd is not a project
root with a populated `.claude/` (or the install lives in an account dir), stop and say so - a
global adjust is the sibling `/alfred-code:configure`. Detect the OS too (`darwin`/`linux` -> the
sh installer; Windows -> ps1 via `pwsh`).

**Every ask in this run goes through the AskUserQuestion tool** - concrete options, the recommended one
marked, free text via Other; a prose question or a bare stop-and-wait is invalid (measured: prose asks
were skipped in live runs while tool-shaped asks were answered every time). A plain-text option list is
the fallback only where the harness lacks the tool.

**House voice in every line this run emits** - narration, tables and the asks alike: single
dashes, never em-dashes, and single quotes in prose. A fresh or refreshed install may have no
`.claude/rules/baseline-interaction.md` loaded at all, so this command's own text is the only place
the voice can come from (measured: a first-run narration line opened with an em-dash, on the one
surface where the rule forbidding it cannot yet exist).

## The ladder - announce every step

Twelve user-facing steps; the machinery between them runs silently. One banner line before each:

```
[step 3/12 - rules] reconcile the rule layer · next: agents
```

1 find + inventory · 2 detect stacks · 3 rules · 4 agents · 5 skills · 6 hooks · 7 MCPs · 8 plugins · 9 environment · 10 judgment review · 11 apply · 12 post-check

## 1. Find the install and inventory it

Confirm the install (project mode, above), then **inventory the installed set through the
installer's own read-back**, exactly as configure does - never by hand, from disk or from memory.
It is the SAME read an `update` writes back, so a seat or hook the user switched off stays out of
it (a hand inventory unioned what the plugin entries carry, and the apply switched every such seat
back on). One call from the snapshot, on every OS and seed - a `--print-plan` run writes nothing:

```bash
node "$TMP/repo/scripts/install/alfred-code.js" update --source "$TMP/repo" --scope project --installed-only --print-plan --plan-out "$TMP/installed.json" > "$TMP/plan.out" 2>&1
```

`$TMP/installed.json` is the `--installed` input for the walk: `{rules, agents, skills, hooks, mcps,
plugins, plugins_disabled, answered}` in catalog names (the playwright engines folded onto
`playwright`). **Each plugin carries its SCOPE** (`{name,scope}`), because an uninstall is
scope-addressed: a removal ask naming only the plugin lets the user consent to a project-local drop
and get an account-wide one, and the wrong `--scope` fails with `not installed in project scope`
(measured: 8 messages and 1.2M cache-read spent rediscovering the scope the listing had already
printed). **A plugin the listing marks `disabled` is a THIRD state, not an absence:** it sits in
`plugins_disabled` and OUT of `plugins`, so the walk neither proposes installing what is already on
disk nor removing what the user parked (measured: two stack plugins sat disabled through an update
and a validate run four minutes apart, and both runs reported nothing to do); `parked_plugins` is
its catalog part. `left_out` lists what the user switched off - a denied seat, an item of a parked
retired entry - as selection lines, which `--missing` counts as present: never proposed back. Three
signals in `$TMP/plan.out`, never printed to the user: `error: --installed-only found nothing
installed` means there is no install - route to `/alfred-code:setup`; `plan routes:
skills=<plugin|copy> hooks=<plugin|copy> mcps=<plugin|copy>` names the routes; `plan answered:
hooks=<yes|no> agents=<yes|no>` says which off-states the read found evidence of - `agents=no` with
`skills=plugin` means the plugin listing could not be read or the core entry is parked: stop and
report which, since every carried seat would read as missing; `hooks=no` means the hooks layer is
not reconciled this run.

Then check the LIBRARY copies now, before anything writes - the apply in step 11 is an installer run,
and it overwrites a copy edited in the project:

```bash
node "$TMP/repo/scripts/library-check.js" --project . --source "$TMP/repo"
```

On a global install add `--scope global --config-dir <the account dir>`. Paste a `drift` row to the
user in this step's report, with what it means: the step-11 apply and every update overwrite that
copy, so the edit belongs upstream or in a skill of the project's own. Step 12 runs the same check
again over the result.

## 2. Detect the project's stacks - and show the evidence

The init step-3 artifact scan:

- `*.csproj` / `*.sln` -> .NET, split by content, per project: `Microsoft.NET.Sdk.Web` -> `aspnet`;
  `<UseWPF>true` -> `wpf`; `<UseWindowsForms>true` -> `winforms`; a
  `Microsoft.Extensions.Hosting.WindowsServices` reference (or a `ServiceBase` inheritor) ->
  `windows-service`; an EXECUTABLE carrying none of those markers (`<OutputType>Exe</OutputType>`, or
  `Microsoft.NET.Sdk.Worker`) -> `console`. A class LIBRARY is never its own stack: `Microsoft.NET.Sdk`
  with no `OutputType` (library is the default) - and a test project - is a surface of the app that
  references it, so a WPF solution's own libraries stay `wpf` and add NO `console` (measured
  mis-detection). With every .NET project a library, ask which surface they serve; never default to
  `console`.
- `angular.json` -> `web-angular`; `ionic.config.json` / `capacitor.config.*` -> `ionic-angular`.
  An Ionic app matches `angular.json` too - when `ionic-angular` detects, do NOT also report
  `web-angular` for the same app; both only when a second, distinct non-Ionic Angular app exists.
- a `manifest.json` carrying `"manifest_version"` (or a wxt/crxjs config) -> `browser-extension`.
- `Dockerfile` / `.github/workflows/` -> `devops`; `*.sql` / a migrations folder -> `data`.
- `tsconfig.json` / `jsconfig.json` -> `typescript` (language-level - keeps the TS rule/skill/LSP
  plugin owned in a plain TS/Node repo with no framework marker). A TS framework stack claims its own
  surface: when `web-angular` / `ionic-angular` / `browser-extension` detects, do NOT also report
  `typescript` for the same app - the framework seeds carry the rules + LSP, and reporting both flags
  `ts-js-testing` MISSING on every Angular app where testing is `angular-testing`'s (measured); both only
  when the repo holds a genuine non-framework TS surface too (Node tooling, a published library).
- `package.json` with `.js` sources and NO `tsconfig.json`/`jsconfig.json` -> `javascript` (the plain-JS
  seed). One-way suppression: `typescript` and the framework stacks cover JS - never report `javascript`
  beside them. Without this bullet a plain-JS install reads as REDUNDANT wholesale (measured: `javascript`,
  `ts-js-testing`, `javascript-conventions` and `typescript-lsp` all flagged for removal).

Report the detected set AND, for every stack you will treat as ABSENT, the exact signal you looked
for and did not find (`wpf -> *.csproj <UseWPF>: none`). **This is the veto point** - a
mis-detection (a WPF app on a non-standard SDK, SQL in an odd path) is corrected HERE, before the
walk removes anything on it. Detecting nothing is valid; confirm through AskUserQuestion, and put the CONSEQUENCE in each option's
description, not just the stack list - the answer authorizes removals, and a user who cannot see that
asks about a stack that was never at risk (measured: the one Other reply in an audited run asked about a
stack the run had DETECTED). 'Detection correct' (recommended) - every detected stack keeps its
artifacts; only the ABSENT stacks' artifacts become removal candidates, and each is still asked about
one at a time. 'Dispute' - name the stack via Other and it is treated as present, nothing of its is
proposed. Then walk. Stack names are the catalog keys of
`$TMP/repo/meta/recommendations.json` (`web-angular`, never `angular`) - the tool names an unknown one on
stderr (`unknown-stack`) instead of silently flagging nothing.

Compute the audits ONCE here, right after detection, against the current inventory, quietly - the
two stack-level passes, the evidence scan (with the judgment catalog), the evidence gaps, and the
judgment lines. This is the only place any of it runs: whatever layer or question comes up later -
MCPs and plugins included - is answered from the four files this prints, never by hand-reading
`recommendations.json` / `stack-graph.json` / `evidence.json` again (measured: a plugin/mcp question
answered with 8 ad hoc catalog reads before this block's own pass had even run):

```
node "$TMP/repo/scripts/scan-evidence.js" --root . --catalog "$TMP/repo/meta/evidence.json" \
  --judgment "$TMP/repo/meta/judgment.json" --out "$TMP/found.json"
node "$TMP/repo/scripts/stack-select.js" --redundant --installed "$TMP/installed.json" \
  --found "$TMP/found.json" \
  --recs "$TMP/repo/meta/recommendations.json" --graph "$TMP/repo/meta/stack-graph.json" \
  --stacks "<detected,csv>" > "$TMP/redundant.out"
node "$TMP/repo/scripts/stack-select.js" --missing   --installed "$TMP/installed.json" \
  --recs "$TMP/repo/meta/recommendations.json" --graph "$TMP/repo/meta/stack-graph.json" \
  --stacks "<detected,csv>" > "$TMP/missing.out"
node "$TMP/repo/scripts/stack-select.js" --evidence-gaps --found "$TMP/found.json" \
  --catalog "$TMP/repo/meta/evidence.json" --installed "$TMP/installed.json" \
  --recs "$TMP/repo/meta/recommendations.json" --graph "$TMP/repo/meta/stack-graph.json" \
  --stacks "<detected,csv>" > "$TMP/evidence.out"
node "$TMP/repo/scripts/stack-select.js" --judgment "$TMP/repo/meta/judgment.json" \
  --installed "$TMP/installed.json" > "$TMP/judgment.out"
```

`redundant:` lines = installed, whole owning stack absent, no evidence signal (remove candidates). `missing:` lines =
detected-stack + baseline closure not installed (add candidates), each with `needed by <stack|baseline>`.
`evidence-missing:` lines = the scan found a signal for an artifact that is not installed (add
candidates, the signal as the reason - already deduped against the `missing:` lines by the tool).
`no-evidence:` lines = installed, catalog-listed, no signal found - ADVISORY ONLY, never an action.
`overlap:` / `dormant:` lines (judgment.out) + the scan's `judgment.versionConflicts` rows
(found.json) = step 10's precomputed candidates - carried there, never acted on in the walk.
The tool already excludes shared items, deliberate non-stack extras, already-installed baseline,
anything the scan matched, and the curated `general` set in recommendations.json (artifacts no stack owns: cross-stack skills a
narrow seat happens to preload - e.g. dotnet-data-access - and the project-conditional opt-ins whose
applicability no manifest can prove, e.g. the `project-related-context` / `related-project-analyzer`
pair, which apply only where the project has sibling repos) - present its output as printed above.

One addition of your own, in ONE call - never by opening the catalog, which is a maintainer file
whose comment alone is 2,000 characters:

```bash
node "$TMP/repo/scripts/update-preflight.js" --snapshot "$TMP/repo" --root .
```

Its `migration:` lines are the retired GENERATED artifacts (e.g. the legacy inject-code-style
hook) that the stack-ownership model cannot flag, because generated output belongs to no stack.
Each fired entry prints its own indented `why:` / `then:` / `remove:` / `unwire:` /
`env-rename:` / `env-remove:` lines and an entry that did not fire prints nothing. Each detected
entry joins the matching layer's REDUNDANT rows labeled `(migration: <why>)`; removing one also
applies its `unwire:` edit and puts its `then:` follow-up in the report. (The version and diff
lines the same call prints are update's business, not validate's - ignore them here.) An entry acting
on the settings.json `env` (`rename_settings_env`, `remove_settings_env`) belongs to the ENVIRONMENT
layer instead: a retired key still on disk is a RETIRED row there, reported with its `why`, and
accepting it drops the key - the installers' own env pass does the same on their next run.

## The walk - steps 3-8, one layer at a time

The layer order is the dependency order rules -> agents -> skills -> hooks -> MCPs -> plugins. Per
layer, slice `redundant.out` + `missing.out` to that layer and run the SAME shape:

1. **Show one table** of this layer's actionable rows - REDUNDANT (installed, remove?) and MISSING
   (not installed, add?; `evidence-missing:` lines join as MISSING with the signal as the reason),
   each with its reason. Under the table, this layer's `no-evidence:` lines as PLAIN TEXT - no row
   numbers, no consent: 'advisory: dotnet-messaging installed, no messaging package found - kept,
   your call'. A line carrying `held by <cat> <name>` is NOT your-call: the kept closure requires
   it, so present it as locked-by-holder info - its real drop path is dropping the holder via the
   sibling configure, never a promise this walk can keep. The walk itself never acts on an
   advisory - step 10 revisits each one with code corroboration and may propose the drop there. A layer with none of the three gets a single line ('rules: nothing to reconcile')
   and you move straight on - do not invent rows.

```
[step 4/12 - agents] reconcile the agent layer · next: skills
 # | agent                  | state     | reason
---+------------------------+-----------+-----------------------------------
 1 | wpf-implementer        | REDUNDANT | owned by wpf, not detected
 2 | aspnet-verifier        | MISSING   | needed by aspnet
 3 | ci-failure-diagnoser   | MISSING   | needed by baseline
```

2. **One consent round through AskUserQuestion** - four options (the tool's cap), typed numbers via
   Other: **Accept all** (add every MISSING, remove every REDUNDANT in this layer), **Add only**,
   **Remove only**, **Skip** (touch nothing), or typed numbers (`add 2 3`, `remove 1`). Never bulk-act without an explicit choice; a REDUNDANT removal the user
   declines is simply kept. Restate the outcome in one line and carry this layer's accepted adds +
   removes forward.

## 3-8 per-layer notes

- **Rules** first - a rule's closure pulls agents/skills, so accepting a MISSING rule here means
  its pulled agents/skills already appear as MISSING in their own later layers; the apply step
  re-closes the union, so you never double-add.
- **Hooks** are leaf - REDUNDANT never appears (hooks are always-baseline or deliberate); MISSING
  only if a baseline hook is absent - a removed guard, or the env-gated `instrument-tool-usage`
  on an install predating its catalog entry (measured: a v0.1.23-era install upgraded to
  v0.2.17 had no guided route to the instrument hook until this entry existed). On the PLUGIN route
  an accepted add is not an install at all: the name is removed from `ALFRED_CODE_HOOKS_OFF` in the
  scope's `settings.json` env, and the apply step reports it as that edit, not as a copied file.
- **MCPs / plugins** - no plugin is always-baseline: `claude-hud` rides beside the core, so it is
  never REDUNDANT and the next update puts it back when it is gone. `superpowers` is an optional pick
  (R72) on the general list: never REDUNDANT where installed, never MISSING where not. One exception:
  a `claude-hud` the user disabled stays off - it is in no `plugins_disabled` row and never proposed
  for an enable. The four optional ones (`security-guidance`, `claude-md-management`, `csharp-lsp`,
  `typescript-lsp`) show MISSING only on evidence - an `evidence-missing:` line naming the matched
  manifest - or, for an LSP plugin, when its stack is detected but it was dropped. An LSP plugin
  with neither a signal nor a detected owning stack is REDUNDANT; any other optional plugin without
  a signal is a `no-evidence:` advisory, never a removal.
  Every name in `plugins_disabled` gets its own **DISABLED** row in the plugins table - reason
  `installed but disabled for this project` - and its accept action is `claude plugin enable
  <name>`, never an install and never an uninstall. A DISABLED plugin the user leaves alone is a
  deliberate choice and is not re-raised in the close.
- **`memory` joins `serena` and `context7`** as an always-required MCP (`baseline-memory.md` locks
  it in the same way `baseline-navigation.md` locks serena) - MISSING when the project carries no
  registration at all, never REDUNDANT: no stack owns it, so it belongs to every install regardless
  of what is detected. Whenever `memory` IS registered - shown in this table or already installed -
  read its level with `node .claude/hooks/memory.js level` (the project's own copy; fall back to
  `node "$TMP/repo/stack/hooks/memory.js" level` when that file is absent), which prints `<level>
  <dbPath>` or `none`. Print the answer as ONE informational line under the MCPs table - `memory
  level: <level> - <dbPath>`, or `memory: registered but the level cannot be derived from
  <dbPath>` for an unrecognized path - never a consent row: this walk does not add, drop or change
  the level, only `/alfred-code:configure` does. Add a second line checking whether the
  session-start push can even fire on this machine - `node -e
  "try{require('node:sqlite');process.exit(0)}catch{process.exit(1)}"`; a non-zero exit (Node below
  22.13) renders `memory start block: off - this Node is below 22.13, node:sqlite is unavailable
  and the session-start push never runs (memory_search still works - it goes through the MCP
  server, not this machine's Node)`, exit 0 adds nothing. In the same line's neighbourhood, read
  THIS repo's own project `.claude/settings.json` `autoMemoryEnabled` key (top-level, not under
  `env` - ALWAYS the project file, whatever the install's scope: the switch-off never touches the
  account file) and report it -
  `false` reads as done (Claude's own memory is off, the one-time import succeeded); `true` or the
  key ABSENT both read as 'the one-time import has not completed yet, so Claude's own memory is
  still on' - never claim success from an absent key.

## 9. Environment - the settings.json env block against this release

The one layer that is not an artifact: the values this stack owns in the scope's settings.json
`env`. Read the rows from the snapshot's `$TMP/repo/meta/environment.json` and the current block
from the file (project mode: `.claude/settings.json`; global: the account file), then show one
table of the actionable rows only - an install whose env already matches gets the single line
`environment: nothing to reconcile` and you move on. **Never print, echo back, or ask for a credential VALUE.** A key matching the catalog's `secret_key_pattern`, or a row flagged `secret: true`, is reported as `set (N chars)` or `absent` and nothing else - not as a shown default, not in a table, not in a question. A value that must be set is set by the user in the file itself, or with a copy-ready command they run in their own terminal; it never travels through the chat. Measured: seven credential exposures in one corpus.



- **MISSING** - a catalog row with no key in the file. This is the release-introduced case: a
  variable added upstream after this install was made, which no artifact diff can surface because
  it was never a file. Reason column: `not set - introduced after this install`. The catalog carries no version per row, so never print one.
  `ALFRED_CODE_DOCS_VERSIONING` is the ONE exception to 'offer the catalog default': its value is DETECTED, not
  constant, so writing the constant over a project whose docs are kept out of git is the exact silent switch
  the rule exists to prevent. PREVIEW it read-only before the table - `node .claude/hooks/docs.js status`
  (project mode; with the key absent its `mode:` line falls back to the same rule) - its bare `git (docs are not
  kept out of git - ...)` or `overlay (docs are kept out of git - ...)` names the probed value (`git`/`local`) and
  the reason in one line; show THAT value in the table, never the catalog's `git`. Reason column: `not set -
  probed '<value>': <the mode line's own parenthetical>`. Every other MISSING row still offers the catalog
  default unchanged.
- **OLD NAME** - a row's `renamed_from` still present in the file. Accepting MOVES the value to the
  new key and drops the old one; nothing is deleted and no default is written over it. The
  installers apply the same rename on their next run, so an unaccepted row is not lost, only later.
- **RETIRED** - a key in the file that the catalog no longer lists and `migrations.json` names in a
  `remove_settings_env` entry. Nothing reads it; accepting drops it, and the entry's `why` is the
  reason column. A key the catalog does not list and no migration names is someone else's - leave it.
- **INVALID** - a key whose value fails the row's `validate` shape (a percent or token count outside `min`..`max`
  and not its `off` value, a window under `min`, an instrumentation switch that is neither `0` nor
  `1`). Show the value and the expected shape; the fix is the catalog default unless the user types
  another. The shape is the ONLY test - a value that differs from the default is a deliberate pin,
  never a finding.

Consent exactly like the artifact layers: one AskUserQuestion round - **Accept all**, **Add
missing only**, **Skip**, or typed numbers - then restate the outcome in one line. Accepted rows
are written in step 11 as a merge touching ONLY those keys, everything else in the file preserved.

## 10. Judgment review - corroborated non-use, convention conflicts, corroborated need

The mechanical tiers stop at what signals can prove; this step carries the judgment they cannot -
a skill whose PURPOSE conflicts with the project's stated conventions, whose domain the code
provably never touches, or whose domain the code provably DOES touch without any catalog signal,
is invisible to every scanner. Drop scope: installed artifacts still untouched
this run that nothing kept requires (probe first - `node "$TMP/repo/scripts/stack-select.js" --selection
"$TMP/installed.json" --graph "$TMP/repo/meta/stack-graph.json" --dependents <skill|agent|mcp|plugin>:<name>`,
the inventory being the remaining selection - a closure-held item is NOT in scope; at most note the
finding and name the holder, its drop path is the sibling configure).
Add scope: release-shipped artifacts the walk left unproposed. **Every grep below runs INLINE in
this session** - the corroboration for one item is a handful of bounded greps, and dispatching them
costs more than running them (measured: an async dispatch plus a scheduled wakeup turned 4 greps into
three idle turns). If a seat is dispatched anyway, wait on its completion notification - never spend a
turn polling for it. Five inputs, five gates:

1. **The advisory list FIRST - corroborate non-use in the code.** Every `no-evidence:` item is a
   prime drop candidate the package scan alone cannot judge. For each: derive the skill's domain
   markers from its own description (for `dotnet-realtime`: SignalR, hubs, a web host) and grep
   the code for them - bounded, NAMED greps, mindful of substring noise (`SignalRedraw` is not
   SignalR); check the skill's own do-NOT-load exclusions against what the code actually does (an
   outbound `ClientWebSocket` bot is the realtime skill's own exclusion case); and check whether
   the project docs cite the skill - a load-by-artifact table naming it is a KEEP corroboration,
   never propose against the project's documented intent. Zero code hits + no doc citation ->
   propose JUDGMENT-DROP with the trail as the citation: the greps run, their zero results, the
   matching exclusion.
2. **The rest vs the project's stated conventions - version pins included.** Review the remaining
   scope against the project's OWN docs - the project CLAUDE.md, `<docs-path>/architecture/ARCHITECTURE.md` /
   `quality/ASSESSMENT.md`, `code-style/CODE-STYLE.md`, where they exist - and propose a drop on a cited
   conflict: quote the conflicting rule verbatim and name its source. Version pins count as
   conventions, and the scan PRECOMPUTES the known cases: the `judgment.versionConflicts` rows in
   found.json arrive with the package, the found version, the threshold, the conflict text, and
   the item's surviving half - present them as-is, adding the project-doc side where one exists.
   A version conflict the catalog misses may still be proposed by hand with the full citation
   (the pin next to the item's conflicting guidance) - and is worth an entry in
   `meta/judgment.json` upstream. No project docs -> the prose-conventions path
   is skipped (say so); path 1 and the precomputed rows still run - they read code and manifests,
   not conventions.
3. **Corroborated need - the uninstalled mirror of gate 1.** An uninstalled skill whose domain the
   code provably touches but no manifest signal covers (BCL-only cryptography, a hand-rolled
   background-job loop) is gate 1's blind spot in reverse. Work ONLY from trails this run already
   surfaced - a domain the detection or gate-1 greps tripped over, a topic the project's own docs
   name - never a speculative sweep of the whole catalog. For each candidate: confirm with bounded
   NAMED greps (quote the positive hits and their files), and check the skill's own do-NOT-load
   exclusions do not match this project (an exclusion hit kills the proposal). Propose
   JUDGMENT-ADD with the trail as the citation: the greps run, the quoted hits, the exclusion
   check. No surfaced trail, no proposal - 'the project might grow into it' passes no gate.
4. **Registered MCP servers the project never calls.** The mechanical passes reconcile a server
   against the project's FRAMEWORKS, which is why 14 validate runs across 6 projects never caught
   a browser-extension project carrying `chrome-devtools` AND `playwright` and calling neither
   across 17 sessions, or a headless .NET backend carrying `playwright` (24 tool schemas) and
   `sentry` (8). A registered server is not free: its schemas are injected into every session and
   every subagent. So judge each one the project did not prove:
   - **Measured first, where a measurement exists.** `ls "<docs-path>/tools-usage"/*.jsonl` - the
     instrumentation ledgers. When any exist, count per server:
     `grep -ho '"tool":"mcp__[a-z0-9-]*' <docs-path>/tools-usage/*.jsonl | sort | uniq -c`. A server
     with rows is KEPT, no judgment needed; a server with zero rows across several sessions is a
     drop candidate with the count as its citation. State the number of sessions the ledgers cover.
   - **No ledgers?** Say so - `no usage measurement (ALFRED_CODE_INSTRUMENT is "0"; flip it to "1"
     for a run to measure)` - and fall back to the same corroboration gate 1 uses: the evidence
     scan's verdict for that server plus bounded NAMED greps for its domain markers. Never propose
     a drop on absence of a ledger alone.
   - The two locked servers (`serena`, `context7`) are never proposed - an always-on rule names
     them, so they are closure-held. Everything else is in scope.

5. **Functional overlap among kept items.** The candidates are the tool's `overlap:` lines
   (judgment.out) - pairs from the shipped catalog where BOTH sides are installed, each side's
   unique gap precomputed on the line. Your judgment adds the third part: which one the
   project's own docs or config actually cite - and the proposal drops the uncited one, its
   precomputed gap stated so the user keeps it by needing exactly that. An overlapping pair the
   catalog misses may still be proposed by hand, but then the citation carries all three parts
   yourself (the overlap, the cited preference, the survivor's gap) - and it is worth an
   upstream `judgment.json` entry. No gap named = the analysis is not finished.

No gate evidence, no proposal: unused-looking, stale-feeling, or 'probably never needed' passes
no gate. Present the findings RANKED, each verdict carrying its severity - MATERIAL (a real
per-session cost, or guidance that actively fights the project) above MINOR (marginal value at
near-zero cost - trim only if the user wants lean) - and each proposal readable as four parts:
what the item does, why it is marginal or wrong in THIS project (the citation), the exception
that would justify keeping it, and the recommendation. Close the step with one 'correct as-is'
line naming what the review cleared and why in a clause - the user must see the reasoning
covered everything, not only the cuts. One table, VISIBLY separate from the signal tiers, then
the usual per-item consent round:

```
[step 10/12 - judgment] corroborated non-use + conflicts + corroborated need + uncalled servers + overlap · next: apply
 # | artifact                   | verdict                  | citation
---+----------------------------+--------------------------+--------------------------------------------------
 1 | mcp playwright             | JUDGMENT-DROP · MATERIAL | uncalled: 0 calls across 17 sessions of tools-usage ledgers; headless .NET backend with no UI to drive; 24 tool schemas in every session; keep only if a browser check is planned here
 2 | skill dotnet-architecture  | JUDGMENT-DROP · MATERIAL | CLAUDE.md: 'keep the layered factory pattern; it is NOT Clean Architecture / DDD / VSA'
 3 | skill dotnet-realtime      | JUDGMENT-DROP · MINOR    | advisory, corroborated: 0 hits for SignalR/hub/web-host across src/ (3 greps); outbound ClientWebSocket is the skill's own do-not-load case
 4 | skill dotnet-cryptography  | JUDGMENT-ADD             | corroborated: AesGcm in src/Vault/Sealer.cs, Rfc2898DeriveBytes in src/Auth/Hasher.cs (2 greps, hits quoted); no crypto package = no scanner signal; no exclusion match
```

This step is model judgment, not a signal: it is non-deterministic and can be confidently wrong,
which is exactly why every row carries its quotation and nothing here ever auto-applies. A
decline is final for this run - never re-litigate it. Accepted judgment drops join step 11's
removal set and accepted judgment adds its install set, both reported there under their
JUDGMENT label.

**The dormant advisory - fine to keep, fires rarely, by requirement.** Under the judgment table,
as PLAIN TEXT (no row numbers, no consent - like the walk's `no-evidence:` lines), print the
tool's `dormant:` lines (judgment.out) - the installed occasion-bound items from the shipped
catalog, each line's cadence text being the citation. The list is the catalog's, not yours:
never re-derive dormancy from descriptions or claim a frequency you cannot observe; an
occasion-bound item the catalog misses is an upstream `judgment.json` entry, not an ad-hoc
advisory. Name each item's idle cost and off lever honestly, per layer:
agents and manual `/`-skills cost nothing installed (explicit dispatch only - say so, so working
machinery is not pruned for phantom savings); an auto-firing skill costs its description line per
session (lever: remove, or accept it); an MCP costs its server launch + tools every session
(lever: `claude mcp remove`, cheap to re-add via configure); a plugin can be switched off in place
(`claude plugin disable <name>`). Act on a lever only on an explicit user request in this run -
dormancy alone is never a removal argument.

## 11. Apply - the same paths init/configure use

Build the final selection = the installed set, PLUS every accepted add, MINUS every accepted
remove, written to `$TMP/final.json` in the inventory's shape. Step 9's accepted environment rows
are applied here too, as a merge on the scope's settings.json touching ONLY those keys - seeds and
renames included - and named in the post-check the same way an added artifact is. An accepted
MISSING `ALFRED_CODE_DOCS_VERSIONING` row is the one exception: never fold it into that generic
merge - write it by running `node "$TMP/repo/scripts/stamp-docs-root.js" <project root> --seed-versioning`
(project mode only, per its own message), which re-probes at the write instead of trusting the
table's preview a step stale, and report its printed line. Every other accepted row still goes
through the generic merge. Emit + prereq-check it -
`node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/final.json" --graph "$TMP/repo/meta/stack-graph.json" --emit "$TMP/selection.txt" --check [--playwright-browsers <csv>] [--config-dir ~/.claude-<space>]` (`--playwright-browsers` with the kept browsers whenever playwright is kept, so a kept `msedge` warns when Edge is not installed)
(`--config-dir` under a `--space`
profile), output to `$TMP/select.out` - then:

- **Apply**: run the delta, then the installer from the snapshot. `node "$TMP/repo/scripts/derive-state.js" --delta --installed "$TMP/installed.json" --selection "$TMP/selection.txt" --picked "$TMP/final.json"`
  prints one `add <line>` / `drop <line>` per accepted change against step 1's read-back, or
  `none` - which with no environment row accepted means there is nothing to apply: say so, run
  nothing. After it come the lines the run leaves OFF: `kept-off <line>` (a switched-off item the
  closure re-requires but no accepted add names - report it as staying off) and `keep-parked plugin
  <name>` (a parked plugin the read-back would enable - a `--drop` whenever the installer runs, no
  reason on its own to run it). Otherwise:
  `node "$TMP/repo/scripts/install/alfred-code.js" update --source "$TMP/repo" --scope project --installed-only [--add '<line>']... [--drop '<line>']... [--playwright-browsers <csv> --playwright-enabled <csv|none>] 2>&1 | tee "$TMP/install.log"`
  - one `--add` per `add` line, one `--drop` per `drop` and `keep-parked` line, each quoted,
  applied on top of the same read-back, so nothing the reconcile did not touch moves. Never
  `--selection` on this seed: that route neither removes nor disables what the reconcile dropped,
  and it stamps every carried item as a pick. On `ALFRED_CODE_SEED=shell` (or the 1.x
  `CLAUDE_STACK_SEED`) the frozen twin no longer runs: print `the shell installers were removed in 2.0.0 - unset ALFRED_CODE_SEED / CLAUDE_STACK_SEED to use the Node installer` and stop. <!-- legacy-name -->
  Playwright among the ADDS: ask which browsers to install (`chrome` pre-selected, `msedge`,
  `firefox`, `webkit`), then which of those to enable (all pre-selected; each enabled one adds its ~25
  tools to every session) and pass both; `/plugin` toggles them later. An installed playwright passes
  nothing (the installer reads its browsers back from the stamp, and switches none). A server 2.0.0 cut is no reconcile row: the run uninstalls the stack's own copy and prints
  its `add it back:` line - pass it through. Presence, never the value - run this
  and paste its lines as-is: `node "$TMP/repo/stack/hooks/guard-secret-value.js" --presence "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" CONTEXT7_API_KEY`
  (the same line runs on Windows - Claude Code's Bash tool is Git Bash, where `$env:USERPROFILE` is not a variable; a `--space <name>` install reads `~/.claude-<name>/settings.json`). Output is `KEY=set (N chars)` or `KEY=absent` - nothing else is ever printed; a shell dump of that file is rewritten by the same hook into its redacted view (every credential value shown as `<set (N chars)>`), and the Read tool on it is blocked. The installer closes the selection and copies the added artifacts; already-installed
  ones are simply re-laid, harmless. Show the prereq report first; never install past a blocker.
- **Removes**: on the Node seed the `--drop` lines ARE the removal, applied by that run: a core
  seat is denied, a hook on the plugin route is named in `ALFRED_CODE_HOOKS_OFF`, a copied or
  library skill, agent, rule or hook loses its file (a copied hook its wiring too), and an MCP entry
  nothing kept needs any more is disabled. Report them from `grep -E 'installed-only: (dropping|--drop|skill .* stays loaded)|plugin disabled|plugin disable failed|scope, not this run|removed \(dropped\)|overwriting a hand-edited copy' "$TMP/install.log"` - for each `--drop <line> not applied - something kept requires it` among them, its reason is `grep -F 'installed-only: required: <line> ' "$TMP/install.log"`; a `dropping plugin <name>` for a `keep-parked` name is no removal, leave it out: `skill <name> stays loaded` is a core
  skill, which the core plugin goes on carrying - report it as carried, never as removed; `--drop
  <line> not applied` is an item something kept requires, or an always-on rule or server (`locked`) -
  report it as kept, with the reason; a stack entry enabled at another scope is never disabled, the
  log names the command for the user. Two removals the installer never makes, each with its command shown first:
  `claude mcp remove <name>` for an MCP on the copy route (playwright = every
  `playwright-<browser>` server), and
  `claude plugin uninstall <name> --scope <the scope step 1 recorded for it>`, except a plugin every
  install carries beside the core - never propose removing one: the installer puts it back on every
  run, so the removal would only be undone. The removal ask that proposed it
  NAMES that scope ('enabled at USER scope - removing it removes it for every
  project'), since account-wide and project-local are different consents.
- **Check the generated rule's stamped policy against this release, mechanically.** The usage-policy
  block inside `.claude/rules/baseline-project-agent-capabilities.md` ships verbatim from the skill
  and is never re-fetched, so a project can carry a two-release-old policy with nothing to notice it.
  One comparison:

  ```bash
  grep -m1 -o 'policy-rev: [0-9a-f]*' .claude/rules/baseline-project-agent-capabilities.md
  grep -m1 -o 'policy-rev: [0-9a-f]*' "$TMP/repo/stack/skills/project-agent-capabilities/SKILL.md"
  ```

  Equal - say `capabilities policy: current`. Different, or the project's rule carries no rev at all
  (written before the stamp existed) - report it as a finding with both values and name the re-run as
  the fix. No rule on disk is not a finding here; it is the capture never having run.
- Then name `/project-agent-capabilities` (when installed) in the post-check report as the
  USER's next step, so the generated awareness rule reflects the reconciled inventory - the
  skill is manual-only (`disable-model-invocation`), a Skill call from this run is denied by `guard-fresh-session-start.js`;
  never attempt it. `alfred-code.stamp` is rewritten ONLY by an installer invocation - the apply step's
  own run writes it. A validate run that added nothing leaves the stamp exactly as it found it and never
  hand-edits it: the file's own header says the installers write it, and a hand-written one carries a
  fabricated install time that every later stamp compare then trusts (measured: one run did exactly this).

**The run closes on a suggestion card, never on a question.** After the report, list the
follow-ups that are the USER's to run - restart for an MCP change, `/project-agent-capabilities`
(when installed and this run added or removed something it lists), a manual-only capture whose
output this run made stale, the serena re-index, a credential to rotate or set by
hand - as `Suggested next steps`, the recommended one first and each with the one reason it
matters ('`/project-agent-capabilities` - validate added 3 skills, so the generated rule's
inventory is short'). No AskUserQuestion over them: the walk's asks end with the installer (a
write still gets its consent ask where it happens), and the closing ask over follow-ups was
dropped as friction - the user's call, made knowing a prose next step was ignored 3 of 3 in one
audited session, which is why the reason rides beside every step. Close with this line, verbatim:
'Nothing is pending on this run - these are yours to run when you choose.' The stop-contract
guard reads that sentence as a finished close; without it a 'done + next step' card is blocked
as a stall and the guard demands the very ask this paragraph removes.
The line is CONDITIONAL: print it only when the card carries nothing OWED. A still-required user action - revoke the old token, fill in a credential, run a rotation - IS pending, so name it and put the close through the ask instead (measured: one close stated 'Still owed: revoke the old token in Sentry's dashboard' and this line in the same message).


## 12. Post-check

Report per category what was added, removed - signal-backed and JUDGMENT-labeled separately -
and left as-is (disputed detections, deliberate extras, declined suggestions, declined
judgment proposals), plus one ENVIRONMENT line naming every key seeded, renamed or corrected (or
saying the block already matched), and step 7's MEMORY line (level + database, and the
`autoMemoryEnabled` reading). Remind that a restart picks up MCP registration changes, and surface
the installer's gitignore reminder. If a CLAUDE.md rules table names a rule you added or removed,
offer to reconcile that row (additive, shown before writing) - never rewrite the user's prose.

Then audit the config the install left, on every path that reaches this step (a clean bill
included), before `$TMP` goes:

```bash
node "$TMP/repo/scripts/audit-install.js" .
```

It reads this project's own agent config - an unpinned package launch in `.mcp.json`, an
unrestricted shell grant, a hook with no timeout or one splicing tool input into a shell string, a
credential-shaped literal in `CLAUDE.md` or a settings file - and fixes nothing. Paste its output
byte-for-byte in a fenced block (`install audit: nothing to report` is the whole paste on a clean
project). A `high` row gets ONE AskUserQuestion: 'Fix the stack-owned rows' (recommended - an
update re-run pins a stack server) or 'Leave them'. A row on a server, hook or grant the user added
by hand is reported with its line and never edited; a credential row is the rotate ask
`baseline-security.md` owns, never a fix here.

Then check the LIBRARY copies - every skill and seat outside the core plugin, and every RULE (no
plugin ever carries one), is a project copy, and the stamp holds the hash of what the last install
wrote:

```bash
node "$TMP/repo/scripts/library-check.js" --project . --source "$TMP/repo"
```

On a global install add `--scope global --config-dir <the account dir>` - its skills live there.
Paste the output byte-for-byte in the same fenced block. A `drift` row is a copy edited in the
project: the next update overwrites it and says so, so the edit belongs upstream or in a skill of
the project's own, never in the copy. `behind` rows and the `stale stamp` line are what
`/alfred-code:update` takes. `library: no library stamp` is the whole paste on an install older
than the library route.

## Clean up the temp dir - ALWAYS

Remove `$TMP` per `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md`, on EVERY exit path of
THIS command: after apply, after an abort, after a disputed-detection stop, and after a clean bill
(nothing redundant or missing). Then confirm the project tree holds only installed artifacts.

## Do not

- Do not add or remove on a detection the user disputes, and never act on a layer without its
  consent round - the evidence line and the per-layer consent are the whole safety model.
- Do not touch a deliberate non-stack extra, an always-baseline item already installed, or a shared
  item whose owning stack IS present - the tool already excludes these; never second-guess it.
- Do not act on a `no-evidence:` advisory - it is information, not a removal candidate; package
  absence is weak proof (vendored code, a preinstalled skill for planned work, a scan miss).
- Do not act on a DORMANT advisory without an explicit user request, and never present dormancy
  as a removal argument - occasion-bound machinery earns its place on the occasion; cite the
  item's own description, not an invented usage frequency.
- Do not propose a judgment drop or add without its gate evidence - the corroboration trail
  (named greps with their zero or quoted-positive hits, the skill's own exclusion check) or the
  verbatim-quoted conflicting rule with its source - and never put a JUDGMENT row in a signal-tier
  table - the two have different reliability and the user must always see which is which. A
  judgment add additionally needs a trail the run itself surfaced - never a speculative catalog
  sweep - and an overlap drop additionally needs the survivor's gap named: a 'redundant' claim
  that cannot say what the drop candidate uniquely does has not finished the analysis.
- Do not skip the prerequisite gate before an install, and never remove what a kept item still
  needs. Do not paste tool output or leave `$TMP` behind on any exit path. Do not commit anything.
