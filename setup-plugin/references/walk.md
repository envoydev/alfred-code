# The guided walk - one text for setup and configure

The six-layer selection walk, read by `/alfred-code:setup` and `/alfred-code:configure` so the two
can never drift apart. It runs in one of two modes, and the calling command names which:

- **FRESH** (setup) - a first install. The baseline is the RECOMMENDATIONS: what `always` and the
  confirmed stacks seed, plus what the evidence scan matched. One selection round per layer.
- **DELTA** (configure) - an existing install. The baseline is what is INSTALLED, read back by the
  installer itself (`$TMP/installed.json`, the `--plan-out` file of the command's step 1). No
  recommended phase: every layer is a straight modify, an ADD round then a DROP round, and a drop
  cascades both ways with consent.

The calling command owns everything around the walk - the banners and their step numbers, the
steps before it and after it, and which layers run this time (configure walks only the areas
picked). This file owns the layers themselves.

## Order and the running files

The layer order follows the dependency graph's arrows: rules pull agents + skills, agents pull
skills, everything pulls MCPs and plugins, and hooks stand alone - rules -> agents -> skills ->
hooks -> MCPs -> plugins. Dependencies only point FORWARD through the walk, so an earlier answer is
never invalidated by a later one.

- **FRESH:** hold ONE running `raw.json` (in the temp dir) of the user's DIRECT picks per category
  (`rules`, `agents`, `skills`, `hooks`, `mcps`, `plugins`); locked items never enter it - the
  closure re-adds them at emit time.
- **DELTA:** hold TWO running files in the temp dir: `raw.json` - the remaining selection
  (installed + adds - drops, every category incl. `hooks` and `mcps`) - and `dropped.json` -
  everything dropped so far, per category. Seed BOTH before the first recompute - `raw.json` from
  the step-1 inventory, `dropped.json` as `{}` - so no layer ever runs against a file that does not
  exist yet.

Both files are ONE object keyed by category, each value an array of names, and that is the whole
schema - do not go looking for it (measured: a run spent `--help`, an `ls examples` and a source
grep at 258k context to confirm this shape):

```json
{ "skills": ["csharp"], "agents": ["aspnet-implementer"], "rules": ["csharp-conventions"],
  "hooks": ["guard-stop-contract"], "mcps": ["navigation"], "plugins": ["security-guidance"] }
```

## Per layer - the same three beats

1. **Recompute quietly** - one call, output redirected to `$TMP/select.out` and parsed from there,
   never pasted.
   - FRESH: fold the previous layer's picks into `raw.json`, run `node stack-select.js --selection
     raw.json`, and read the category-tagged `required: <category> <name> - <why>` lines. The
     current layer's lines are its **locked** set.
   - DELTA: `node stack-select.js --selection raw.json --dropped dropped.json`. Two line kinds drive
     the step. A `required: <category> <name> - <why>` naming a DROPPED item blocks the drop -
     something kept still depends on it: show the reason; the user keeps it, or also drops the
     dependents the reason names (their layer is reopened if already walked, and its own cascade
     re-runs). An `orphan: <category> <name> - <why> (dropped); nothing kept still needs it` line
     is the cascade - an installed item whose only dependents were dropped at an earlier layer:
     offer this layer's orphans for removal ('it was only there for what you dropped; remove it
     too, or keep it?'), never remove one silently, never re-offer one the user chose to keep.
2. **Show ONE numbered table of the layer's ENTIRE catalog** - every item the release ships,
   installed or not, so nothing is ever offered later or out-of-band. The TOOL renders it, never
   you, and it is **never redirected to a file** - the table comes back IN the tool result:
   - FRESH: `node stack-select.js --selection raw.json --table <layer> --recs <recommendations.json> --stacks <confirmed,csv> --found "$TMP/found.json"`
   - DELTA: `node stack-select.js --selection raw.json --table <layer> --installed "$TMP/installed.json" --dropped dropped.json --found "$TMP/found.json"`
     (omit `--found` when no evidence scan ran). A not-installed row whose reason column carries a
     matched signal is the project telling you it uses what the install lacks - an informed add
     candidate, never an auto-add.

   Paste those exact lines into your message inside a fenced code block. (Measured: the old form
   redirected to `$TMP/table.txt` and told you to paste the file - the tool result was then empty,
   the read-back was a step nobody took, and one real run asked all six layer questions with no
   table shown at all. A disk copy, if you want one, is `| tee "$TMP/table.txt"` - the pipe keeps
   the output visible.) **The layer turn has ONE fixed shape, in order: (1) the `[step n/N -
   <layer>]` banner, (2) the fenced block holding the tool output byte-for-byte, (3) the selection
   question - a layer turn missing the fenced table is invalid: render the table and re-send.** The
   plugin's `guard-layer-table.js` hook denies the ask (up to three times) when no `total: N
   <layer>` footer follows the table call in your text. Self-check before you send the question:
   your own message must carry the `total: N <layer>` footer line - it is not there unless you
   pasted the table. A prose grouping that feels equivalent (`Locked (5): ...` / `Installed (12):
   ...` lines) is the exact failure this shape exists to prevent, and the run's narrate-don't-trace
   rule does not reach this paste - it is the rule's one sanctioned exception. The paste is
   pre-padded by the tool, so it stays aligned at any length; a hand-written markdown table shears
   when the renderer flushes it in segments. The `total: N <layer>` footer is the user's truncation
   check: fewer visible rows than it names (or a missing footer) means the display was cut down -
   re-paste in full, and never summarize rows into prose; the user decides from the whole catalog,
   not from a shortlist. Row numbers come from the tool and are stable across rounds.

   FRESH rows are labeled `required` (closure-locked, reason in the last column), `evidence` (the
   scan matched a signal - PRE-SELECTED, the matched signal as the reason, droppable like any
   seed), `recommended` / `stack:<name>` (seeded, droppable), `added` (the user's own pick), `-`
   (not selected). Recommended = the union of `always` + each confirmed stack in
   `$TMP/repo/meta/recommendations.json`, pre-selected:

   ```
   [step 5/11 - agents] adjust the agent roster · next: skills
    # | agent                       | selected     | required by
   ---+-----------------------------+--------------+---------------------------
    1 | alfred-issue-diagnoser-ci        | recommended  | -
    2 | dotnet-build-error-resolver | stack:aspnet | rule dotnet-repair-agents
    3 | wpf-implementer             | -            | -
   ```

   DELTA rows are labeled in the `installed` column - `yes`, `orphaned` (with the cascade origin)
   or `-` - and the `required by` column carries the lock reason for a kept item something else
   kept needs:

   ```
   [step 5/13 - skills] adjust the installed skills · next: hooks
    # | skill      | installed | required by
   ---+------------+-----------+------------------------------------------
    1 | csharp     | yes       | rule csharp-conventions
    2 | dotnet-wpf | orphaned  | was: required by agent dotnet-build-error-resolver
    3 | postgres   | -         | -
   ```

3. **The selection.**
   - FRESH - one round, quick options + numbers: **Recommended** (keep the table exactly as shown -
     the default), **All** (select every row in the layer's catalog), **None** (keep only the
     locked rows), and typed adjustments through the free-text answer - `add 3 7 12`, `drop 5`, or
     both (bare numbers mean add). A drop naming a LOCKED row is refused with its reason shown ('#2
     stays - required by rule dotnet-repair-agents; drop that rule first (reopening step 4) or keep
     it'), never silently honored or silently ignored.
   - DELTA - two rounds, ADD then DROP. The add round: **Keep as-is** (add nothing - the default),
     **All** (add every catalog row), or typed numbers (`3 7 12`). Then the drop round: **Nothing**
     (the default; orphaned rows are pre-suggested, each with its cascade origin), **All
     droppable** (keep only locked rows), or typed numbers. A drop naming a LOCKED row triggers the
     consent cascade, not a refusal: run `node stack-select.js --selection raw.json --dependents
     <category>:<name>` (output to `$TMP/select.out`) and present what holds it - 'csharp is
     required by rule csharp-conventions, rule dotnet-repair-agents + 4 agents; drop them ALL
     together, or keep it?' On consent, the item AND its dependents fold into `dropped.json` -
     dependents from already-walked layers are named right there, and the next recompute's orphan
     lines surface immediately. On refusal, the row stays.

   Either mode: typed numbers are an index YOU resolved, so the NAMES go back in your next message
   before anything is written ('adding: markdown-style, ts-js-testing; dropping: wpf-conventions') -
   an off-by-one silently installs the neighbouring row (measured: a five-number edit applied with
   no name read-back at all). Restate the outcome in one line (added N, dropped M, incl. dependents
   in DELTA), fold it into the running files, and narrate the handoff to the next layer. An
   `unknown:` line from the recompute is a typo, or in DELTA an installed name this release no
   longer ships (retired or renamed upstream): surface it, never pass it through - in DELTA it is
   excluded from the emitted selection automatically; adopt the replacement when the command's
   step 1 showed a rename, or let the sibling `update` command prune the leftover artifact.

## Rules

Nothing in the graph depends on a rule, so this layer never has locked rows - it is the one fully
free pick, which is why it goes first: the rules chosen here decide what later layers must keep. In
DELTA every installed rule is freely droppable and every catalog rule addable, and a rule drop is
where cascades START: what it alone pulled in surfaces as orphan offers in the layers ahead.

## Agents

Locked = agents the kept rules require (the repair-loop rules pin their resolvers, e.g. `required by
rule dotnet-repair-agents`). DELTA orphans here trace back to rule drops.

## Skills

The full release catalog in one table - the generator `alfred-capture-*` / `alfred-loop-*` skills and every other house
skill included, so THIS is the only place skills are ever chosen; later steps (CLAUDE.md included)
never offer skill additions. Locked = every skill the kept rules and agents REQUIRE (rule
attachments and `skills:` frontmatter preloads), each with the reason naming its dependent. A skill
an agent's body merely names as a conditional load ('load X when...') is NOT an edge and never
appears pre-selected: an artifact naming a skill must never put it into an install - a need is
proven by the evidence scan against the project's own manifests, or seeded per stack, never
inferred from a body. Rows the evidence scan backed arrive labeled `evidence`, the matched signal in
the reason column ('MassTransit in src/Api/Api.csproj') - never hand-propose add-candidates beyond
what the table already shows.

FRESH: the only skills seed is `always.skills` - the house METHOD set: the cross-task orchestrator
plus the manual `alfred-task-*` / `alfred-capture-*` / `alfred-loop-*` / `alfred-issue-*` skills (the inline execution twins, the capture/loop generators,
the upgrade planner) and the seven `alfred-habits-*` habits, all pre-selected `recommended` - LOCKED
on the plugin route (they ride the core plugin, which carries no per-skill deny, so a drop there logs
'not applied'), droppable only on the `ALFRED_CODE_SKILLS_VIA_PLUGIN=false` copy route; their need is
'the stack is installed', not anything a project manifest could prove, which is why they are seeded
rather than evidence-scanned. The ONE deliberate exception is `alfred-task-build-from-scratch` - greenfield-only by
its own description, dead weight on an existing project, so it is never seeded; offer it as an
unselected row like any other, and only in a greenfield run is picking it natural. Beyond the seed
set, selected = locked + whatever the user adds.

DELTA: installed rows no kept rule or agent requires show `-` in required-by and drop freely, no
cascade. Orphans trace back to the rule and agent drops before them.

## Hooks

Leaf picks - nothing requires a hook and a hook requires nothing, so every row is free and the
cascade never reaches here. Recommended (FRESH) = all seventeen: the eleven always-on guards, the
session monitor (`monitor-session` - never denies; seeded to log its notes, not inject them), the
three session engines (`docs-session` - the docs start block and finish ask - `memory-session` - the
shared-memory slice at session start - and `history-session` - what the last sessions on this branch
did and ruled), the turn-end build check (`check-turn-build` - wired, but inert until
`ALFRED_CODE_TURN_CHECK` flips to `1`, seeded `0`), plus the env-gated `instrument-tool-usage` (wired
like the guards, but inert until `ALFRED_CODE_INSTRUMENT` flips to `1` - so keeping it costs nothing
idle, and dropping it leaves the install unable to record a measured run without a manual re-wire).

The whole set ships together inside the core `alfred-code` plugin, so nothing is copied and nothing
is wired per project: the answer is written as `ALFRED_CODE_HOOKS_OFF` in the scope's settings file
env - the rows dropped are the ones named there, re-adding a row removes its name, and **None** names
all seventeen (the emitted selection carries `hook none` for it; `--hooks-answered` at the
prerequisite check is what writes it). It can be changed later by editing that value, no reinstall.
An install on the hooks copy route (`ALFRED_CODE_HOOKS_VIA_PLUGIN=false`) keeps the old behaviour -
dropping a hook removes its file and its wiring - and, while the core is on for the skills or the
MCP servers, names it in `ALFRED_CODE_HOOKS_OFF` too, since the core carries every hook; on that
route every run rewrites the value as the hooks the project does not wire, so a hand edit there does
not hold.

## MCPs

Locked = the servers the kept selection pulls: `navigation` via `baseline-navigation`, `documentation` via
`baseline-quality-gates`, `memory` via `baseline-memory` - required in every install, the same way
The navigation server and the documentation server are. `browser` is the one droppable server: seeded on the web Angular, Ionic
and browser-extension stacks, pre-selected elsewhere only when the evidence scan matched it, and in
DELTA preserved across runs like any direct pick (`raw.json` carries it). Those four are the whole
catalog. A server 2.0.0 cut (`angular-cli`, `chrome-devtools`, `appium-mcp`, `sentry`,
`context7-local`) is offered nowhere: the run uninstalls the stack's own copy and prints the `claude
mcp add` line that brings it back as the user's own.

Only if the browser server stayed selected, ask two AskUserQuestions, in order. FRESH has no install to
read, so the first pre-selects `chrome` and the second every installed browser. DELTA pre-selects
from the LIVE install, never by hand: `jq -c '.browser' "$TMP/installed.json"` (the step-1 plan)
prints `{"installed": [...], "enabled": [...]}`:
`installed` is the kept browsers (the stamp's record; for a 1.x install, what the listing or
`.mcp.json` carries - a legacy single `playwright` server is migrated by the run), and `enabled` is
what the settings files say is ON NOW, a `/plugin` toggle included (on the MCP copy route: at project
scope every registered browser `disabledMcpjsonServers` does not name, at local and user scope the
last enable answer, since only an enabled browser is registered there). Never pre-select from the
stamp's own `browser-enabled:` line - it is the last answer, and a toggle made since would be
reverted.

1. Which browsers to INSTALL (multi-select; pre-selected: `installed` in DELTA, since a run
   uninstalls one the answer leaves out; `chrome` in FRESH). `chrome` = the machine's Google
   Chrome, `msedge` = the machine's Microsoft Edge, `firefox`, `webkit` = Safari's engine. Picking
   one IS installing it, and the question says so in one line: the install downloads a picked
   `firefox` / `webkit` (Playwright's own build, at the release's pinned `@playwright/mcp`), while
   `chrome` and `msedge` download nothing - they run the browser already on the machine, and
   `/alfred-code:init` reports one that is not there.
2. Which of THOSE to ENABLE (multi-select over the installed ones only; pre-selected: `enabled` plus
   any newly added one in DELTA, every one in FRESH), the question
   naming the cost in one line: each enabled browser adds its own ~25 tools (about 18.7k characters
   of schema) to every session.

Each installed browser is its own plugin (`browser-chrome`, `browser-firefox`, ...); any
number can be enabled together, and one left unticked is installed, then disabled. Pass the answers
to the installer as `--browsers <csv>` (a browser left out is uninstalled by the run) and
`--browser-enabled <csv|none>`; in DELTA an unchanged answer passes nothing, and the run switches
only an engine whose live state the answer changes. `/plugin` toggles them later. On the MCP copy
route they are `.mcp.json` servers: at project scope one left unticked is registered AND named in
`disabledMcpjsonServers`, which keeps it from loading, and taking it out of that list turns it on;
at local and user scope no settings key reaches the registration, so there the registration IS the
enable - one left unticked is not registered (still installed and downloaded), and ticking it later
registers it.

## Plugins

`claude-hud` shows as `dependency`: every install carries it beside the core plugin (at user scope -
its status line is account-wide) and the installer puts it back on every run, so it cannot be dropped
and is never offered as a pick (a `claude-hud` the user disabled stays off: updated, never switched
back on). The other four (`security-guidance`, `claude-md-management`, `csharp-lsp`, `typescript-lsp`) are OPTIONAL:
pre-selected only as `evidence` (the scan matched a `*.csproj` / `*.sln`, a `tsconfig.json` or
`typescript` dependency, an auth, token or payment package, a tracked `CLAUDE.md` - the reason names
the manifest) or as a confirmed stack's LSP seed, and otherwise `-`, freely addable.
`security-guidance` costs more than its row shows: its Stop, SubagentStop and commit hooks send the
diff to the Anthropic API under the user's own key or session - a billed model call each - and its
SessionStart hook pip-installs `claude-agent-sdk` unpinned. Say that in one line under the table
whenever the row is in it, so a pick is an informed one.

**Plugin settings - part of this layer's turn.** After the selection question, for every kept
plugin the snapshot's `$TMP/repo/meta/plugin-settings.json` has a row for (today `claude-hud`, which
every install carries, whose config file is ACCOUNT-level whichever scope it is installed at - no
emitted selection names it, so the csv below always does), report the delta and ASK here - the
answer is applied after the installer runs, exactly like the environment choices:

1. `node "$TMP/repo/scripts/plugin-settings.js" --catalog "$TMP/repo/meta/plugin-settings.json" --config-dir <account dir> --installed <kept plugins csv, claude-hud always in it>` - paste its output verbatim in a fenced block. Each line reads `missing` (would be added), `differs` (the user already chose something else) or `match`; `--config-dir` is `~/.claude`, or `~/.claude-<space>` under a profile.
2. ONE AskUserQuestion carrying those counts: **Apply recommended** (Recommended - adds only the missing keys, every value already chosen is kept), **Apply and replace differing** (overwrite those too), **Skip** (change nothing).

No kept plugin with a row: skip this silently, ask nothing. A target that needs a block the
plugin's own setup owns (claude-hud's `statusLine`, which carries the refresh interval) reports
itself as `skipped` rather than inventing it - say so once; the block lands once a statusLine
exists, whether `/alfred-code:init` writes claude-hud's own or the user already has one of their own.

After the installer, re-run the same call with `--apply` (plus `--replace` for the overwrite answer)
and paste the closing `applied:` line, plus the `backup:` line right after it when one is printed
(the account `settings.json` was copied to `settings.json.bak.<time>` before this run's first write
to it). A run that dropped the plugin asked nothing and applies nothing.
