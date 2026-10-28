# The guided walk - one text for init's install phase and configure

The five-layer selection walk, read by `/alfred-code:init`'s install phase and `/alfred-code:configure` so the two
can never drift apart. It runs in one of two modes, and the calling command names which:

- **FRESH** (init's install phase) - a first install. The baseline is the RECOMMENDATIONS: what `always` and the
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
skills, everything pulls plugins, and hooks stand alone - rules -> agents -> skills -> hooks ->
plugins. Dependencies only point FORWARD through the walk, so an earlier answer is
never invalidated by a later one.

- **FRESH:** hold ONE running `raw.json` (in the temp dir) of the user's DIRECT picks per category
  (`rules`, `agents`, `skills`, `hooks`, `plugins`); `required` and `locked` rows never enter it - the
  emit re-adds both, the always-on baseline whatever the file holds.
- **DELTA:** hold TWO running files in the temp dir: `raw.json` - the remaining selection
  (installed + adds - drops, every category incl. `hooks`) - and `dropped.json` -
  everything dropped so far, per category. Seed BOTH before the first recompute - `raw.json` from
  the step-1 inventory, `dropped.json` as `{}` - so no layer ever runs against a file that does not
  exist yet.

Both files are ONE object keyed by category, each value an array of names, and that is the whole
schema - do not go looking for it (measured: a run spent `--help`, an `ls examples` and a source
grep at 258k context to confirm this shape):

```json
{ "skills": ["csharp"], "agents": ["aspnet-implementer"], "rules": ["csharp-conventions"],
  "hooks": ["guard-stop-contract"], "plugins": ["csharp-lsp"] }
```

## Per layer - the same three beats

1. **Recompute quietly** - one call, output redirected to `$TMP/select.out` and parsed from there,
   never pasted.
   - FRESH: fold the previous layer's picks into `raw.json`, run `node "$TMP/repo/scripts/stack-select.js" --selection
     "$TMP/raw.json"`, and read the category-tagged `required: <category> <name> - <why>` lines. The
     current layer's lines are its **locked** set.
   - DELTA: `node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/raw.json" --dropped "$TMP/dropped.json"`. Two line kinds drive
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
   - FRESH: `node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/raw.json" --table <layer> --recs <recommendations.json> --stacks <confirmed,csv> --found "$TMP/found.json"`
   - DELTA: `node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/raw.json" --table <layer> --installed "$TMP/installed.json" --dropped "$TMP/dropped.json" --found "$TMP/found.json"`
     (omit `--found` when no evidence scan ran; in a child of an installed folder add `--inherited
     "$TMP/parent.json"`, the parent's read-back). A not-installed row whose reason column carries a
     matched signal is the project telling you it uses what the install lacks - an informed add
     candidate, never an auto-add.

   Paste those exact lines into your message inside a fenced code block. (Measured: the old form
   redirected to `$TMP/table.txt` and told you to paste the file - the tool result was then empty,
   the read-back was a step nobody took, and one real run asked all six layer questions with no
   table shown at all. A disk copy, if you want one, is `| tee "$TMP/table.txt"` - the pipe keeps
   the output visible.) **The layer turn has ONE fixed shape, in order: (1) the `[step n/N -
   <layer>]` banner, (2) the fenced block holding the tool output byte-for-byte, (3) the selection
   question - a layer turn missing the fenced table is invalid: paste the output you already have,
   never re-run the table.** The plugin's `guard-layer-table.js` hook denies the ask (up to three
   times per table, counted back to the last answered ask) when no `total: N
   <layer>` footer follows the table call in your text. Self-check before you send the question:
   your own message must carry the `total: N <layer>` footer line - it is not there unless you
   pasted the table. **The table is the tool's `--table <layer>` output and nothing else** - never a
   table of your own (a `node -e` script reading a meta file, a hand-written list): the gate reads the
   `--table` call, and a home-made table hides rows the tool would show. **And the layer ends on its
   ask, answered** - narrating 'all 18 are recommended, next I'll decide' and moving on is the measured
   failure (a real init run skipped the hooks and plugins asks that way, the tables folded out of
   sight). The same hook denies the walk's next call - the next `stack-select.js` call, the
   `plugin-settings.js` report or the installer - while the latest layer table has no answered ask after
   it, and in init, a later table, the prerequisite check or the installer while an earlier layer's table
   never ran. Claude Code's auto permission mode waives none of it: the selection is the user's. A prose
   grouping that feels equivalent (`Locked (5): ...` / `Installed (12):
   ...` lines) is the exact failure this shape exists to prevent, and the run's narrate-don't-trace
   rule does not reach this paste - it is the rule's one sanctioned exception. The paste is
   pre-padded by the tool, so it stays aligned at any length; a hand-written markdown table shears
   when the renderer flushes it in segments. The `total: N <layer>` footer is the user's truncation
   check: fewer visible rows than it names (or a missing footer) means the display was cut down -
   re-paste in full, and never summarize rows into prose; the user decides from the whole catalog,
   not from a shortlist. Row numbers come from the tool and are stable across rounds.

   FRESH rows are labeled `required` (closure-locked, reason in the last column), `evidence` (the
   scan matched a signal - PRE-SELECTED, the matched signal as the reason, droppable like any
   seed), `recommended` / `stack:<name>` (seeded, droppable), `added` (the user's own pick), `locked` (an always-on
   rule or skill every install carries - never droppable, in a child too), `-`
   (not selected), and in a child `from root` (the parent install holds it - kept unless unpicked, and an unpick is an
   ignore line, never a drop). Recommended = the union of `always` + each confirmed stack in
   `$TMP/repo/meta/recommendations.json`, pre-selected:

   ```
   [step 5/10 - agents] adjust the agent roster · next: skills
    # | agent                       | selected     | required by
   ---+-----------------------------+--------------+---------------------------
    1 | issue-diagnoser-ci        | recommended  | -
    2 | dotnet-build-error-resolver | stack:aspnet | rule dotnet-repair-agents
    3 | wpf-implementer             | -            | -
   ```

   DELTA rows are labeled in the `installed` column - `yes`, `locked` (the always-on baseline every install carries),
   `orphaned` (with the cascade origin) or `-`, and in a child `from root` (installed because the parent holds it) or `ignored` (the parent holds it and this
   child ignores it) - and the `required by` column carries the lock reason for a kept item something else
   kept needs:

   ```
   [step 5/12 - skills] adjust the installed skills · next: hooks
    # | skill      | installed | required by
   ---+------------+-----------+------------------------------------------
    1 | csharp     | yes       | rule csharp-conventions
    2 | dotnet-wpf | orphaned  | was: required by agent dotnet-build-error-resolver
    3 | postgres   | -         | -
   ```

3. **The selection - options first, typing only through Other.** A layer's ask never offers only
   whole-layer verdicts: the per-row change is a pick from options built out of the table's own
   labels. Every ask is one AskUserQuestion call at most 4 options wide, the Recommended one first
   (AskUserQuestion takes 1-4 questions per call, 2-4 options each, and adds Other itself).
   - FRESH - step 1, ONE single-select per layer, the question line carrying the numbers of the
     table's `counts:` line (right above its `total:` footer), copied, never counted; the layer's own template is in
     its section below. The four options are always
     the same moves: **Keep the marked rows** (Recommended - the table exactly as shown), **Pick ...**
     (opens step 2), **Add every ...** and **Only the locked rows**. Other still takes `add 3 7 12` /
     `drop 5` for a user who prefers numbers.
   - FRESH - step 2, only on 'Pick': the tool deals the rows, never you. Run `node "$TMP/repo/scripts/stack-select.js"
     --selection "$TMP/raw.json" --deal fresh <layer>` with the other flags of that layer's `--table` call (output to
     `$TMP/deal.out`; it is no table, so it is not pasted). Each `call <c>` number is
     ONE AskUserQuestion call of up to 4 multi-select questions: a `call <c> question <q> (<side>): #<n> <name>, ...`
     line is one question whose options are its rows, each labelled `<name>` and described `row #<n> of the table`. A
     `call <c> <side>: groups - <n> rows` line takes that call's 4 questions, each option a GROUP taken from the table's own labels - a stack's
     designer-implementer-verifier trio, a stack's skill set, a hook family - its description naming the rows
     (`#21-23 wpf-solution-designer, wpf-implementer, wpf-verifier`), the likeliest first and the rest left to Other;
     the layer's own 'Step 2' line below names its groups. A `<side>: none` line asks nothing for that side, and
     `deal: nothing to pick - re-ask step 1` re-asks step 1 once. Every question's `header` is at most 12 characters.
     The answer names rows, so the off-by-one risk of typed numbers is gone; the name read-back below still runs.
   - DELTA - ONE call of two single-select questions per layer, ADD and DROP, each a template below;
     'Pick' on either runs `--deal add <layer>` or `--deal drop <layer>` with the flags of that layer's DELTA `--table`
     call and asks its lines the same way. When the table's `counts:` line gives a side exactly 1 row (1 droppable, or
     1 not installed), that side's question omits its 'Pick rows to add' / 'Pick rows to drop' option and keeps its
     other two, so a Pick never reaches a `none - 1 row` deal. When the recompute
     printed `orphan:` lines the drop question leads with **Drop the k orphaned rows** (Recommended,
     each orphan's cascade origin in the description) instead of 'Drop nothing'. A drop naming a
     LOCKED row is not refused: run `node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/raw.json" --dependents
     <category>:<name>` (output to `$TMP/select.out`) and present what holds it - 'csharp is
     required by rule csharp-conventions, rule dotnet-repair-agents + 4 agents; drop them ALL
     together, or keep it?' On consent, the item AND its dependents fold into `dropped.json` -
     dependents from already-walked layers are named right there, and the next recompute's orphan
     lines surface immediately. On refusal, the row stays. When it prints a `locked:` line (an always-on item, or one
     the always-on baseline requires), the row stays with no drop offered: quote that line and go on.
   - A drop naming a LOCKED row in FRESH (a typed `drop 5`) is refused with its reason shown ('#2
     stays - required by rule dotnet-repair-agents; drop that rule first (reopening step 4) or keep
     it'), never silently honored or silently ignored.

   The DELTA questions, the same for every layer (`<layer>` filled in, every number copied from the table's
   `counts:` line, never counted):

   ```ask
   Add to the installed <layer>? <m> catalog rows are not installed.
   - 'Add nothing (Recommended)' - keep the installed set as it is
   - 'Pick rows to add' - the next call offers the <m> uninstalled rows, dealt by `--deal add`
   - 'Add all <m> uninstalled' - every catalog row of this layer
   ```

   ```ask
   Drop from the installed <layer>? <k> rows are droppable, <o> orphaned.
   - 'Drop nothing (Recommended)' - keep every installed row
   - 'Pick rows to drop' - the next call offers the droppable rows, dealt by `--deal drop`
   - 'Drop all droppable' - keep only the locked rows
   ```

   Either mode: typed numbers (Other) are an index YOU resolved, so the NAMES go back in your next message
   before anything is written ('adding: markdown-style, ts-js-testing; dropping: wpf-conventions') -
   an off-by-one silently installs the neighbouring row (measured: a five-number edit applied with
   no name read-back at all). Restate the outcome in one line (added N, dropped M, incl. dependents
   in DELTA), fold it into the running files, and narrate the handoff to the next layer. An
   `unknown:` line from the recompute is a typo, or in DELTA an installed name this release no
   longer ships (retired or renamed upstream): surface it, never pass it through - in DELTA it is
   excluded from the emitted selection automatically; adopt the replacement when the command's
   step 1 showed a rename, or let the sibling `update` command prune the leftover artifact.

## Rules

Nothing in the graph depends on a rule, so its only locked rows are the always-on baseline, which every install
carries - past them it is the one fully free pick, which is why it goes first: the rules chosen here decide what
later layers must keep. In DELTA every installed rule but that baseline is freely droppable and every catalog rule
addable, and a rule drop is
where cascades START: what it alone pulled in surfaces as orphan offers in the layers ahead.

FRESH ask, counts copied from the table's `counts:` line (20 rows on aspnet + web-angular: 16 marked, 4 unmarked):

```ask
Rules: install the 16 marked rows? 4 are unmarked (devops, sql, winforms, wpf conventions).
- 'Keep the marked rows (Recommended)' - the 7 baseline rules, the authoring rules and the confirmed stacks' conventions
- 'Pick rules to add or drop' - next call offers the unmarked rules and the droppable marked ones, dealt by `--deal fresh`
- 'Add every rule' - all 20 rows of the catalog
- 'Only the always-on baseline' - the 7 baseline rules; stack and authoring rules left out
```

Step 2: no side of this layer passes 16 rows, so `--deal fresh rules` always deals it row by row - 'Add which?' and
'Drop which?' questions of 2-4 rows each.


## Agents

Locked = agents the kept rules require (the repair-loop rules pin their resolvers, e.g. `required by
rule dotnet-repair-agents`). DELTA orphans here trace back to rule drops.

FRESH ask (45 rows: the marked ones are the support seats, the resolvers and the confirmed stacks' trios):

```ask
Agents: install the marked rows? The unmarked ones are other stacks' trios and related-project-analyzer.
- 'Keep the marked rows (Recommended)' - the support seats, the resolvers and the confirmed stacks' trios
- 'Pick stack trios to add' - next call lists the unmarked designer-implementer-verifier trios
- 'Add every agent' - all 45 (each description rides every session's first call)
- 'Only the locked rows' - what the kept rules require
```

Step 2, on a `groups` line: multi-select questions of 4 trios each ('Add trios 1/2', 'Add trios 2/2'), plus a
'related-project-analyzer' question (Add it / Leave it out) when it is unmarked.


## Skills

The full release catalog in one table - the generator `capture-*` / `loop-*` skills and every other house
skill included, so THIS is the only place skills are ever chosen; later steps (AGENTS.md included)
never offer skill additions. Locked = every skill the kept rules and agents REQUIRE (rule
attachments and `skills:` frontmatter preloads), each with the reason naming its dependent. A skill
an agent's body merely names as a conditional load ('load X when...') is NOT an edge and never
appears pre-selected: an artifact naming a skill must never put it into an install - a need is
proven by the evidence scan against the project's own manifests, or seeded per stack, never
inferred from a body. Rows the evidence scan backed arrive labeled `evidence`, the matched signal in
the reason column ('MassTransit in src/Api/Api.csproj') - never hand-propose add-candidates beyond
what the table already shows.

FRESH: the only skills seed is `always.skills` - the house METHOD set: the cross-task orchestrator
plus the manual `task-*` / `capture-*` / `loop-*` / `issue-*` skills (the inline execution twins, the capture/loop generators,
the upgrade planner) and the `habits-*` habits, all pre-selected `recommended` - LOCKED
on every route (copies since 2.1.0, adopted by every update, so a drop logs 'not applied'; a project
that wants one quiet sets it `off` or `name-only` in `skillOverrides`, which keeps the copy); their need is
'the stack is installed', not anything a project manifest could prove, which is why they are seeded
rather than evidence-scanned. The ONE deliberate exception is `task-build-from-scratch` - greenfield-only by
its own description, dead weight on an existing project, so it is never seeded; offer it as an
unselected row like any other, and only in a greenfield run is picking it natural. Beyond the seed
set, selected = locked + whatever the user adds.

DELTA: installed rows no kept rule or agent requires show `-` in required-by and drop freely, no
cascade. Orphans trace back to the rule and agent drops before them.

FRESH ask (the marked rows are the method set, the evidence rows and the confirmed stacks' skills):

```ask
Skills: install the marked rows? The unmarked ones are mostly other stacks' skill sets.
- 'Keep the marked rows (Recommended)' - the method set, the evidence rows and the confirmed stacks' skills
- 'Pick stack skill sets to add' - next call groups the unmarked skills by stack
- 'Add every skill' - the whole catalog (each description costs always-on budget)
- 'Only the locked rows' - what the kept rules and agents require
```

Step 2, on a `groups` line: two multi-select questions of 4 stack sets each (the wpf, winforms, console and
windows-service sets; ionic-angular, data, browser-extension, js), plus one question on the
`general` opt-ins (dotnet-hosted-services, dotnet-data-access, capture-usage-report).


## Hooks

Leaf picks - nothing requires a hook and a hook requires nothing, so every row is free and the
cascade never reaches here. Recommended (FRESH) = all eighteen: the twelve always-on guards, the
four session engines (`docs-session` - the docs start block and finish ask - `preferences-session` - the
preferences docs handed over before the first edit and the first git write, the tool order and the
host's shell lines at every start - `history-session` - what the last sessions on this branch
did and ruled - and `forge-session` - the forge line at session and seat start), the turn-end build check (`check-turn-build` - run inside history-session's Stop, inert until
`ALFRED_CODE_TURN_CHECK` flips to `1`, seeded `0`), plus the env-gated `instrument-tool-usage` (wired
like the guards, but inert until `ALFRED_CODE_INSTRUMENT` flips to `1` - so keeping it costs nothing
idle, and dropping it leaves the install unable to record a measured run without a manual re-wire).

The whole set ships together inside the core `alfred-code` plugin, so nothing is copied and nothing
is wired per project: the answer is written as `ALFRED_CODE_HOOKS_OFF` in the scope's settings file
env - the rows dropped are the ones named there, re-adding a row removes its name, and **None** names
all eighteen (the emitted selection carries `hook none` for it; `--hooks-answered` at the
prerequisite check is what writes it). It can be changed later by editing that value, no reinstall.
An install on the hooks copy route (`ALFRED_CODE_HOOKS_VIA_PLUGIN=false`) keeps the old behaviour -
dropping a hook removes its file and its wiring - and, while the core is on for the skills, names
it in `ALFRED_CODE_HOOKS_OFF` too, since the core carries every hook; on that
route every run rewrites the value as the hooks the project does not wire, so a hand edit there does
not hold.

FRESH ask:

```ask
Hooks: keep all 18 on? The build check and the instrumenter stay inert until switched on.
- 'Keep all 18 on (Recommended)' - the guards, four session engines, the build check, the instrumenter
- 'Pick hooks to switch off' - next call lists them in groups of 4
- 'Guards only' - switch off the session engines, the build check and the instrumenter
- 'None - every hook off' - writes `hook none`
```

Step 2, on a `groups` line: multi-select questions of 4 - session (docs-session, preferences-session, history-session, forge-session), optional (check-turn-build, instrument-tool-usage, guard-answer,
guard-fresh-session-start) and the guards in groups of 4, the last group padded from the
neighbouring one so no question has fewer than 2 options.


## Plugins

Three OPTIONAL rows, none locked, shown by `--table plugins` like every layer (never a table of your own). `claude-hud` (the status line) reads `recommended`: every install marks
it, the user can drop it (2.2.0 - it was a required `dependency` before; a `claude-hud` the user disabled
stays off: updated, never switched back on). `csharp-lsp` and `typescript-lsp` are pre-selected only as
`evidence` (the scan matched a `*.csproj` / `*.sln`, a `tsconfig.json` or `typescript` dependency - the
reason names the manifest) or as a confirmed stack's LSP seed, and otherwise `-`, freely addable. 2.0.0
retired `claude-md-management` and `security-guidance` (the core's AGENTS.md skill and `review-security`
cover them): neither is a row, and `/alfred-code:update` removes each from this project's scope with the
line that adds it back.

FRESH ask, counts copied from the table's `counts:` line (claude-hud marked, typescript-lsp on evidence):

```ask
Plugins: install the <n> marked rows? <the marked rows and their reasons, one clause each>.
- 'Keep the marked rows (Recommended)' - claude-hud's status line plus each LSP the evidence or a stack marked
- 'Pick plugins to add or drop' - the next call lists claude-hud, csharp-lsp and typescript-lsp
- 'Add every plugin' - claude-hud, csharp-lsp and typescript-lsp
- 'None' - no status line; symbol lookups stay with the built-in search tools
```

DELTA takes the two layer questions above (add, drop) like every layer.

**Where each optional item installs - the last ask of the walk.** The core follows the run's scope. Every
OTHER kept item - a kept LSP, `claude-hud` - goes where the user chooses, item by item: `project` (this project only,
the default for every one), `global` (every project on this account loads it) or `local` (this checkout only,
never shared through the repo). Never `managed`: that scope is the admin's, and no run installs there. Nothing
kept that is optional: ask nothing. FRESH has no install, so every item starts at `project`:

```ask
Where do the <n> optional picks install? <names>. This project only, unless you make one global.
- 'This project, all of them (Recommended)' - nothing here loads in your other projects
- 'Pick which go global' - the next call lists each pick; a ticked one installs for every project on this account
- 'Global, all of them' - every project on this account loads each of them
```

DELTA reads where each installed one lives now - `node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).scopes))' "$TMP/installed.json"` prints
`{"<item>": "global" | "project" | "local" | "managed"}`, the narrowest row where an item sits at several (the one
this project loads) - names it in the question, and keeps it there by default; a newly added item starts at
`project`. A `managed` item is the admin's: name it, never offer it a move:

```ask
Keep the optional picks where they are? <item: global | project, one clause each>.
- 'Keep each where it is (Recommended)' - an update never moves one on its own; this ask is the one way it moves
- 'Pick which to move' - the next call lists each pick with its scope now; a ticked one moves to the other
- 'All in this project' - every global one moves here; your other projects lose it
```

'Pick ...' opens ONE call of multi-select questions, one per target scope the items are not already at
('Make global', 'Keep in this project', 'This checkout only (local)' - up to 4 options per question, each option
one item, its description naming its scope now); an item ticked under two targets is asked once more. Pass
every answer that is not the item's current place as `--scope-of <item>=<global|project|local>`: FRESH passes each `global` or `local` one, DELTA
each move - the installer installs the item at the new scope first, then removes it at the old one alone
(a row at a third scope stays), and says a move off `global` loud (every other project loses it, with the
line that puts it back). An unchanged answer passes nothing.

**Plugin settings - part of this layer's turn.** After the selection question, for every kept
plugin the snapshot's `$TMP/repo/meta/plugin-settings.json` has a row for (today `claude-hud`, when it is
kept - its config file is ACCOUNT-level whichever scope it is installed at), report the delta and ASK
here - the answer is applied after the installer runs, exactly like the environment choices:

1. `node "$TMP/repo/scripts/plugin-settings.js" --catalog "$TMP/repo/meta/plugin-settings.json" --config-dir <account dir> --installed <kept plugins csv>` - paste its output verbatim in a fenced block. Each line reads `missing` (would be added), `differs` (the user already chose something else) or `match`; `--config-dir` is `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`.
2. ONE AskUserQuestion carrying those counts:

```ask
Apply the recommended plugin settings? <n> missing, <m> differing, <k> matching.
- 'Apply recommended (Recommended)' - adds only the missing keys; every value already chosen is kept
- 'Apply and replace differing' - adds the missing keys and overwrites the differing ones
- 'Skip' - nothing changes
```


No kept plugin with a row, or a report whose last line reads `plugin-settings: nothing to offer`: skip this silently, ask nothing. A target that needs a block the
plugin's own setup owns (claude-hud's `statusLine`, which carries the refresh interval) reports
itself as `skipped` rather than inventing it - say so once; the block lands once a statusLine
exists, whether `/alfred-code:init` writes claude-hud's own or the user already has one of their own.

After the installer, re-run the same call with `--apply` (plus `--replace` for the overwrite answer)
and paste the closing `applied:` line, plus the `backup:` line right after it when one is printed
(the account `settings.json` was copied to `settings.json.bak.<time>` before this run's first write
to it). A run that dropped the plugin asked nothing and applies nothing.
