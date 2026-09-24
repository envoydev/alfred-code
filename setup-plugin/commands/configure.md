---
description: "ADJUST an existing Alfred Code install - inventory what is actually installed, report what an update would bring (the stamp compare), pick WHICH areas to adjust, then walk the chosen areas in dependency order: each layer shows ONE numbered table of the whole catalog with what is installed and what is locked (the required-by reason shown), then an ADD round and a DROP round (quick options + typed numbers); an environment area adjusts the two settings.json env values (auto-compact trigger, generated-docs root) on the same consent. Drops cascade BOTH ways, always with consent: what a dropped item alone pulled in is offered for removal at its own layer, and dropping a required item offers the dependent rules/agents that hold it for removal with it - nothing is ever removed silently. Prerequisite check, the installer's update action, explicit removals, and an OFFERED (never forced) CLAUDE.md reconcile close the run. NOT for a first install - that is the sibling init command; for a plain refresh (+ prune of upstream removals) the sibling update command is the shorter path."
disable-model-invocation: true
---

# Configure Alfred Code - adjust an existing install

You are adjusting an Alfred Code install that already exists. Same discipline as `init`: drive
it interactively, walk the selection one layer at a time, always show the prerequisite report
before running, never run past an unmet blocker. `stack-select.js` does the deterministic work;
you orchestrate. Two differences from `init`: the baseline selection is what is INSTALLED, not
the recommendations - every layer is a straight modify, no recommended phase - and the action is
`update`, not `install`. (For a no-questions refresh that also prunes what upstream removed, the
sibling `update` command is the shorter path - this command is for CHOOSING what changes.)

**This run needs NO conversation context - so it is worth MOVING, but only out of a session that
is actually loaded.** Measure before you ask: this session's own per-message context is `input +
cache_read + cache_creation` off the last assistant message in the transcript. Ask ONLY when that
figure is past the same trigger `guard-fresh-session-start.js` uses - the tier's own absolute
trigger, `ALFRED_CODE_FRESH_SESSION_200K` (default 150,000) or `ALFRED_CODE_FRESH_SESSION_1M`
(default 400,000), or `ALFRED_CODE_FRESH_SESSION_DEFAULT` (default 180,000) when the window is
neither of those two sizes or cannot be read at all - which one applies comes from the session
model's row in `.claude/hooks/model-windows.json`, else `ALFRED_CODE_DEFAULT_CONTEXT_WINDOW` - or when that hook has already
injected the ask into this turn. Below the
trigger, or when the figure cannot be read at all, SKIP the ask silently and start step 1: an ask
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

**THE PLUGIN CACHE IS THE SNAPSHOT - the common run downloads nothing** - the shared contract lives at
`${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md`; read it first and hold the whole run to
it: resolve the snapshot once into `$TMP/repo` - copied from the newest valid plugin-cache entry, downloaded only when there is none (the reference owns the fallback), use every tool
from that snapshot, hand it back with `--source` in step 12, and remove `$TMP` per the 'Clean up'
section on every exit path. The protocol's 'Narrate, don't trace' section governs every tool
call: one quiet call per recompute, no pasted tool output except the decision tables, one narration line between steps.
This command's extra stake in the snapshot: its `RELEASE-SOURCE` commit is what step 1 compares
the stamp against to report what an update would bring.

**Table before question - no exceptions.** Any table or report the user decides from (every layer's `stack-select.js --table` catalog, the `plugin-settings.js` report) is pasted into YOUR message, byte-for-byte in a fenced block, BEFORE the AskUserQuestion that asks about it - never after, never only in the ask's preview panel, never replaced by 'shown above' or a prose summary. A tool result is collapsed in the UI, so a table you only ran is a table the user never saw (measured: agents and skills asks answered 'I do not see any table'). This is the one sanctioned exception to 'no pasted tool output', and the plugin's `guard-layer-table.js` hook denies an ask whose table is missing.

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

Thirteen user-facing steps; the machinery between them runs silently. Before EVERY question, one
banner line so the user always knows where they are, what is being decided, and what comes next:

```
[step 3/13 - rules] adjust the installed rules · next: agents
```

1 install status · 2 areas · 3 rules · 4 agents · 5 skills · 6 hooks · 7 MCPs · 8 plugins · 9 environment · 10 permission mode · 11 prerequisite check · 12 update · 13 CLAUDE.md (optional)

**The skeleton is INVARIANT - the stability contract.** Every run prints all 13 banners, in this
order, exactly once each. A step that does not apply THIS run still prints its banner followed by
ONE line naming why it is a no-op (`[step 7/13 - MCPs] skipped - area not selected`,
`[step 13/13 - CLAUDE.md] skipped - global mode`), then moves on - a step never silently
vanishes, and steps are never merged, reordered, renumbered, or invented. Two runs must be
comparable banner by banner; the content varies, the skeleton never does.

## 1. Install status - find it, inventory it, diff it

- **Find the install.** Project mode: cwd is a project root with a populated `.claude/`
  (skills/agents/rules dirs, or `.mcp.json`). Global mode: no project here, but the account
  (`~/.claude`, or `~/.claude-<space>`) carries installed skills. Nothing installed in either
  place -> stop and route to the sibling `/alfred-code:init` command; there is nothing to
  configure yet.
- **Inventory the installed set through the installer's own read-back** - never by hand, from disk
  or from memory. It is the SAME read an `update` writes back, so a seat or hook the user switched
  off stays out of it; a hand inventory unioned what the plugin entries carry, and the next apply
  switched every one of those seats back on. One call from the snapshot, on every OS and seed - a
  `--print-plan` run writes nothing:

  ```bash
  node "$TMP/repo/scripts/install/alfred-code.js" update --source "$TMP/repo" --scope <scope> --installed-only --print-plan --plan-out "$TMP/installed.json" [--space <name>] > "$TMP/plan.out" 2>&1
  ```

  `$TMP/installed.json` is the walk's inventory (`--installed`): `{rules, agents, skills, hooks,
  mcps, plugins, plugins_disabled, parked_plugins, left_out, answered}` in catalog names (the
  playwright engines folded onto `playwright`). Each plugin carries the SCOPE the listing printed,
  because an uninstall is scope-addressed. A plugin the listing marks disabled sits in
  `plugins_disabled` (`parked_plugins` is its catalog part): parked, never proposed for install or
  removal. `left_out` lists what the user switched off - a denied seat, an item of a parked retired entry -
  as selection lines; the walk leaves it off unless the user picks it. Three signals in
  `$TMP/plan.out`, none printed to the user: `error: --installed-only found nothing installed` means
  there is nothing to configure - route to `/alfred-code:init`; `plan routes: skills=<plugin|copy>
  hooks=<plugin|copy> mcps=<plugin|copy>` names the routes; `plan answered: hooks=<yes|no>
  agents=<yes|no>` says which off-states the read found evidence of. `agents=no` with
  `skills=plugin` means the plugin listing could not be read or the core entry is parked - stop and
  report which, since every carried seat would read as dropped. `hooks=no` means the hooks layer is
  not walked this run: its table would be a guess.
 Show the inventory grouped by category, with counts. In project mode, also
  run the evidence scan quietly - `node "$TMP/repo/scripts/scan-evidence.js" --root . --catalog
  "$TMP/repo/meta/evidence.json" --out "$TMP/found.json"` - so the walk's
  tables can label what the project provably uses (`--found`); skip it in global mode (no
  project to scan).
- **Report what changed since the install.** `.claude/alfred-code.stamp` (or the account's; a 1.x
  install has `claude-stack.stamp` until its first 2.0.0 update, which `stamp-compare.js` reads <!-- legacy-name -->
  when the new one is absent) records the commit every artifact of the current install was copied from - the stack versions
  the INSTALL, not the file. Use it to tell the user what an update would actually bring, BEFORE
  they choose:

```bash
node "$TMP/repo/scripts/stamp-compare.js" --snapshot "$TMP/repo" --stamp .claude/alfred-code.stamp
```

(A fork install passes `--repo <owner/name>`; the script reads the snapshot's `RELEASE-SOURCE`,
falling back to the clone's git HEAD.) It prints the version delta first (`version: 0.1.0 ->
0.2.0` - the plugin/marketplace version; `unknown` when either side lacks one), then
`status<TAB>path` lines (`modified`/`added`/`removed`, and `renamed` with `<- old-path`)
filtered to stack-owned paths. Summarise by category, naming the items - that is the honest
answer to 'what does updating get me'. The diff is what has been RELEASED since the stamp
(merges to `main`, the release branch) - work still on `develop` is invisible here by design,
so never diff against or mention `develop`. Two signal lines to handle, neither an error:

- **`no-stamp`** (exit 2) - an install predating stamping, or one whose source never resolved.
  Say the baseline is unknown, so an update's effect cannot be previewed; the update itself is
  unaffected and will write a stamp.
- **`compare-unreachable`** (exit 3) - the commit is gone (history rewritten, or a
  fork/`STACK_SKILLS_REPO` source that never had it), or the API is unreachable. Report that the
  baseline is unreachable and move on; never guess a diff, and never treat this as a reason to
  skip the update.

A `TRUNCATED` line (the third, after the version and base lines) means the preview may be missing files - say so alongside the summary.

**This step's output has ONE fixed shape** - three blocks, nothing else: (1) the inventory table,
fixed columns `category | count | items`, six rows in the fixed order
rules/agents/skills/hooks/mcps/plugins (note excluded generated files in one trailing line, not
per-row prose); (2) the update-preview verdict - one line leading with the version delta or 'no
upstream changes', then the category summary only when there IS a diff; (3) the closing question.
Detection detail, tool notes, and narration beyond these three blocks is the chaos this shape
exists to prevent.

Close the step with one AskUserQuestion: **adjust the selection** (continue to the area pick at step 2), or
**refresh as-is** (nothing to change - skip straight to step 11; when upstream changed nothing
either, offer to stop rather than running a no-op, and note the sibling `update` command is the
no-questions path for plain refreshes).

## 2. Choose the areas

One multi-pick: which areas to adjust this run - rules, agents, skills, hooks, MCPs, plugins, environment (default: all). The AskUserQuestion tool caps a question at 4 options, so present exactly this fixed grouping rather than improvising one per run (measured: an ad hoc 5-option split errored once before self-healing): 'Rules + Agents + Skills', 'Hooks', 'MCPs + Plugins', 'Environment' - all selected by default, each option's description naming the areas it covers. Only the chosen areas are walked, in the fixed dependency order rules -> agents -> skills -> hooks -> MCPs -> plugins -> environment; every skipped layer keeps its installed SET untouched - its files are still refreshed by the
installer run at step 12, which works from the whole selection - and gets one narration line naming it. Cascades still cross area lines - the closure owns consistency, the picker only decides which tables you page through: a consent-drop's dependents are handled wherever they land, and orphans that fall in a SKIPPED layer are collected and presented in one combined drop round after the last walked layer, never silently kept or removed.

## The walk - steps 3-8, one layer at a time

Same dependency-ordered walk as `init` (rules pull agents + skills, agents pull skills,
everything pulls MCPs and plugins, hooks stand alone - dependencies only point FORWARD), applied to
the installed set with no recommended phase. Hold TWO running files in the temp dir: `raw.json` -
the remaining selection (installed + adds - drops, every category incl. `hooks` and `mcps`) - and
`dropped.json` - everything dropped so far, per category. Both are ONE object keyed by category,
each value an array of names, and that is the whole schema - do not go looking for it (measured: a
run spent `--help`, an `ls examples` and a source grep at 258k context to confirm this shape):

```json
{ "skills": ["csharp"], "agents": ["aspnet-implementer"], "rules": ["csharp-conventions"],
  "hooks": ["guard-stop-contract"], "mcps": ["serena"], "plugins": ["security-guidance"] }
```

Seed BOTH before the first recompute - `raw.json` from the step-1 inventory, `dropped.json` as
`{}` - so no layer ever runs against a file that does not exist yet.

Per layer, the SAME three-beat shape as init:

1. **Recompute quietly** - one call:
   `node stack-select.js --selection raw.json --dropped dropped.json`,
   output redirected to `$TMP/select.out` and parsed from there, never pasted. Two line kinds drive the step:
   - `required: <category> <name> - <why>` naming a DROPPED item -> the drop is blocked: something
     kept still depends on it. Show the reason; the user keeps it, or also drops the dependents
     the reason names (their layer is reopened if already walked, and its own cascade re-runs).
   - `orphan: <category> <name> - <why> (dropped); nothing kept still needs it` -> the cascade:
     an installed item whose only dependents were dropped at an earlier layer. Offer this layer's
     orphans for removal - 'it was only there for what you dropped; remove it too, or keep it?' -
     never remove one silently, never re-offer one the user chose to keep.
2. **Show ONE numbered table of the layer's ENTIRE catalog** (installed and not-installed
   alike). The TOOL renders it, never you:
   `node stack-select.js --selection raw.json --table <layer> --installed installed.json --dropped dropped.json --found "$TMP/found.json"` - **never redirected to a file**: the table comes back in the tool result and you paste those exact lines. (Measured: the old redirect-then-paste-the-file form left the tool result empty and one real run showed no table for any of its six layers. A disk copy, if you want one, is `| tee "$TMP/table.txt"`.)
   (`installed.json` is the step-1 `--plan-out` file, `$TMP/installed.json`; omit `--found` in global mode - no scan
   ran. A not-installed row whose reason column carries a matched signal is the project telling
   you it uses what the install lacks - an informed add candidate, never an auto-add) - then paste the tool output verbatim
   inside a fenced code block. **The layer turn has ONE fixed shape, in order: (1) the
   `[step n/13 - <layer>]` banner, (2) the fenced block holding the tool output byte-for-byte (self-check: your message must carry its `total: N <layer>` footer line - it is not there unless you pasted the table), (3) the
   ADD round question - a layer turn missing the fenced table is invalid: render the table and
   re-send.** A prose grouping that feels equivalent (`Installed (5): ...` / `Locked (3): ...`
   lines) is the exact failure this shape exists to prevent, and the run's narrate-don't-trace
   rule does not reach this paste - it is the rule's one sanctioned exception. The paste is
   pre-padded by the tool so it stays aligned at any length; a hand-written markdown table shears
   when the renderer flushes it in segments. The table ends in a `total: N <layer>` footer line - it is part of the paste and the
   user's truncation check: a display whose visible rows fall short of the footer's count (or that
   lacks the footer) was cut down and must be re-pasted in full; never summarize rows into prose,
   the user decides from the whole catalog, not from your shortlist. Rows are labeled `yes` / `orphaned` (with the cascade origin) / `-`, the lock
   reason rides the last column, and row numbers are stable across rounds. Columns: number, name, `installed` (`yes`, `orphaned` for the cascade
   offers, or `-`), `required by` (the lock reason for kept items something else kept needs, or
   `-`):

```
[step 5/13 - skills] adjust the installed skills · next: hooks
 # | skill      | installed | required by
---+------------+-----------+------------------------------------------
 1 | csharp     | yes       | rule csharp-conventions
 2 | dotnet-wpf | orphaned  | was: required by agent dotnet-build-error-resolver
 3 | postgres   | -         | -
```

3. **Two rounds - ADD, then DROP.** The add round first, quick options + numbers: **Keep as-is**
   (add nothing - the default), **All** (add every catalog row), or typed numbers (`3 7 12`).
   Then the drop round: **Nothing** (the default; orphaned rows are pre-suggested, each with its
   cascade origin), **All droppable** (keep only locked rows), or typed numbers. A drop naming a
   LOCKED row triggers the consent cascade, not a refusal: run
   `node stack-select.js --selection raw.json --dependents <category>:<name>`
   (output to `$TMP/select.out`) and present what holds it - 'csharp is required by rule
   csharp-conventions, rule dotnet-repair-agents + 4 agents; drop them ALL together, or keep it?'
   On consent, the item AND its dependents fold into `dropped.json` - dependents from
   already-walked layers are named right there, and the next recompute's orphan lines surface
   immediately. On refusal, the row stays. Restate the outcome in one line (added N, dropped M
   incl. dependents), fold into `raw.json` + `dropped.json`, narrate the handoff, move on. An `unknown:` line marks an installed name this release no
   longer ships (retired or renamed upstream) - it is excluded from the emitted selection
   automatically; surface it: adopt the replacement here if step 1 showed a rename, or let the
   sibling `update` command prune the leftover artifact.

## 3. Rules

Nothing depends on a rule, so every installed rule is freely droppable and every catalog rule
addable - and a rule drop is where cascades START: what it alone pulled in surfaces as orphan
offers in the layers ahead.

## 4. Agents

Locked = agents a kept rule requires. Orphans here trace back to rule drops in step 3.

## 5. Skills

Locked = skills the kept rules + agents require (rule attachments and `skills:` frontmatter
preloads). A skill an agent's body merely names as a conditional load ('load X when...') is NOT
an edge and never appears pre-selected: what a project needs is proven by the evidence scan
against its own manifests, or seeded per stack - never inferred from a body. Those installed rows
show `-` in required-by and drop freely, no cascade. Orphans trace back to the rule and agent
drops before them.

## 6. Hooks

Leaf picks - nothing requires a hook and a hook requires nothing, so every row is free and the
cascade never reaches here. The set ships together inside the core `alfred-code` plugin, so dropping
a row copies and unwires nothing: it is named in `ALFRED_CODE_HOOKS_OFF` in the scope's
`settings.json` env, and re-adding a row removes its name from that value. The environment area is
where the same value can also be edited by hand. An install still on the copy route (`ALFRED_CODE_HOOKS_VIA_PLUGIN=false`) keeps the
old behaviour - dropping a hook removes its file and its wiring (step 12 shows that edit) - and, while the core is on for the skills or the MCP servers, names it in `ALFRED_CODE_HOOKS_OFF` too, since the core carries every hook - on that route every run rewrites the value as the hooks the project does not wire, so a hand edit there does not hold.

## 7. MCPs

Locked = the servers the kept selection pulls (`serena` via `baseline-navigation`, `context7` via `baseline-quality-gates`,
`memory` via `baseline-memory` once that rule is kept or added - required like the other two once it is present);
the rest of the installed servers are direct picks - droppable, and preserved across runs
(`raw.json` carries them). Addable from `catalog.mcps` - `playwright` is the one droppable server left. A server
2.0.0 cut (`angular-cli`, `chrome-devtools`, `appium-mcp`, `sentry`, `context7-local`) is offered nowhere: the run
uninstalls the stack's own copy and prints the `claude mcp add` line that brings it back as the user's own.

Whenever `memory` is PRESENT after this round - kept from before, or newly pulled in by adding
`baseline-memory` at step 3 - ask the shared memory level. Read what is registered today first:
`node "$TMP/repo/stack/hooks/memory.js" level` prints `<level> <dbPath>` or `none` (no prior
registration - a fresh add, default to `global`). Paste the level table init uses - `global` /
`scoped` / `project`, who shares each and where its database lives - but at `--scope global` drop
the `project` row entirely: the installer refuses `project` at global scope (there is no single
project root an account-wide install can sensibly own), so only offer `global` and `scoped` there.
Pre-select the level just read back, and ask ONE AskUserQuestion: keep it, or change to the
other one(s) shown. Picking or keeping `project` while this project's related-projects domain
already names sibling repos (`<docs-path>/related-projects/RELATED-PROJECTS.md`, or the generated
`baseline-project-related-context.md`) means those projects' memories are not visible from this
one - name that in the post-check, not here. Changing level never copies or deletes a database -
it re-points the registration, and the installer prints
`memory: level <old> -> <new>: <newPath> (old memories stay in <oldPath>)`; read that line verbatim
and report it, never assert it. The post-check then offers the move as two copy-ready commands the
user runs - `node .claude/hooks/memory.js export --db <oldPath> > memories.jsonl`, then `node
.claude/hooks/memory.js import memories.jsonl` (stored through the new level's server; a re-run
stores nothing) - and runs neither itself. Pass the answer to the installer as
`--memory-level <value>` at step 12; 'keep' passes nothing - the registration already matches.
`memory` dropped this round entirely (its holding rule dropped too): ask nothing, the MCP layer's
own drop handling applies like any other server.

Whenever playwright is PRESENT after this round, name the browsers installed today and the ones
enabled - both from the stamp: `grep -E '^playwright-(browsers|enabled):' .claude/alfred-code.stamp`
(the account's for a global install). A stamp without those lines (1.x, or no stamp) falls back to
the ROUTE-decided read: a `playwright-<browser>@<key>` entry (under the resolve line's `key=`) in the
plugins listing, else `playwright-<browser>` in `.mcp.json` (global: `claude mcp list`), each counted
as enabled; a legacy single `playwright` server counts as its `--browser` value, `chrome` when it has
none, and is migrated by the run. Then ask two AskUserQuestions, in order: which browsers to INSTALL
(multi-select, today's pre-selected: `chrome` = the machine's Google Chrome, `msedge` = the machine's
Microsoft Edge, `firefox`, `webkit` = Safari's engine; the last two are Playwright's own builds,
downloaded by the installer), then which of those to ENABLE (multi-select over the installed ones,
today's enabled pre-selected, a newly added one too), the question naming the cost in one line: each
enabled browser adds its own ~25 tools (about 18.7k characters of schema) to every session. Pass a
changed install set at step 12 as `--playwright-browsers <csv>` - a browser left out is uninstalled
by the run - and a changed enabled set as `--playwright-enabled <csv|none>`, which the run applies with
`claude plugin enable` / `disable`. An unchanged answer passes nothing: a plain update switches no
browser, since the user may have toggled one in `/plugin` since.

Presence, never the value - run this and paste its lines as-is:
`node "$TMP/repo/stack/hooks/guard-secret-value.js" --presence "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" CONTEXT7_API_KEY`
(the same line runs on Windows - Claude Code's Bash tool is Git Bash, where `$env:USERPROFILE` is not a variable; a `--space <name>` install reads `~/.claude-<name>/settings.json`). Output is `KEY=set (N chars)` or `KEY=absent` - nothing else is ever printed; a shell dump of that file is rewritten by the same hook into its redacted view (every credential value shown as `<set (N chars)>`), and the Read tool on it is blocked.

## 8. Plugins

`superpowers` and `claude-hud` show as `dependency` - every install carries both beside the core plugin, so neither can be
dropped and neither needs an install row (a `claude-hud` the user disabled stays off - updated, never switched back on); the rest of the installed plugins are direct picks (the four optional ones,
suggested on evidence). Addable from `catalog.plugins`.

**Plugin settings - part of this layer's turn.** After the selection question, for every kept
plugin the snapshot's `$TMP/repo/meta/plugin-settings.json` has a row for (today `claude-hud`,
whose config file is ACCOUNT-level whichever scope it is installed at), report the delta and ASK
here - the answer is applied at the update step, exactly like the step-9 environment choices:

1. `node "$TMP/repo/scripts/plugin-settings.js" --catalog "$TMP/repo/meta/plugin-settings.json" --config-dir <account dir> --installed <kept plugins csv>` - paste its output verbatim in a fenced block. Each line reads `missing` (would be added), `differs` (the user already chose something else) or `match`; `--config-dir` is `~/.claude`, or `~/.claude-<space>` under a profile.
2. ONE AskUserQuestion carrying those counts: **Apply recommended** (Recommended - adds only the missing keys, every value already chosen is kept), **Apply and replace differing** (overwrite those too), **Skip** (change nothing).

No kept plugin with a row: skip this silently, ask nothing. A target that needs a block the
plugin's own setup owns (claude-hud's `statusLine`, which carries the refresh interval) reports
itself as `skipped` rather than inventing it - say so once, and point at `/claude-hud:setup`.

## 9. Environment - the stack env values (when picked)

The values come from the snapshot's `$TMP/repo/meta/environment.json` - the ONE list of what this
release owns in the scope's settings.json `env` (`.claude/settings.json`, or the account file for a
global install). Read each row's `key`, `default` and `what` FROM THAT FILE and put the `what` in
front of the user in its own words; do not carry a copy of the rows here, or the walk shows five
values on the day the catalog holds six. **Never print, echo back, or ask for a credential VALUE.** A key matching the catalog's `secret_key_pattern`, or a row flagged `secret: true`, is reported as `set (N chars)` or `absent` and nothing else - not as a shown default, not in a table, not in a question. A value that must be set is set by the user in the file itself, or with a copy-ready command they run in their own terminal; it never travels through the chat. Measured: seven credential exposures in one corpus. The installer seeds every row only when ABSENT, so this
step is the one place they change deliberately. A row whose key is missing from the file is one the
release INTRODUCED - offer it with the catalog's default; a row's `renamed_from` still present on
disk is the old spelling, and accepting it moves the value, never resets it. `ALFRED_CODE_DOCS_VERSIONING`
is the ONE row this does not apply to when it is missing: its value is DETECTED, not constant, so offering
the catalog's `git` there would write it over a project whose docs are kept out of git - the switch the
rule exists to prevent. Preview it read-only instead - `node .claude/hooks/docs.js status` (project mode;
with the key absent its `mode:` line falls back to the same rule) - and offer THAT probed value
(`git`/`local`, the bare `git (docs are not kept out of git - ...)` or `overlay (docs are kept out of
git - ...)` line names it and why) as the recommended answer, never the catalog default.

One behaviour lives here rather than in the catalog, because it is about what this step DOES: a
docs-root change re-stamps the deployed rule (below) and moves no existing docs. Claude Code's own
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` is NOT one of these rows - the stack does not own that key and
this step neither offers nor touches it.

Show the CURRENT values read from the file - never assume the defaults - then one AskUserQuestion
keep-or-change consent covering every row (keep - recommended; change, the new values via Other) -
one question per row, and a row carrying `asked_with` rides along with the row it names rather than
spending its own question. A row carrying `group_off` is ONE question for the whole FEATURE it owns
- it and its riders: name each key with the value currently on disk, and give three answers - keep
them (recommended), set your own (Other: one number per key, in the catalog's own order), or do not
use the feature (which writes the row's `group_off` value to every key in the group). Only a row
carrying `group_off` gets an off answer; never invent one for a row without it, and a group already
sitting at that value is reported as off, with turning it back on as the change. On a
docs-root change, say plainly: existing generated docs do NOT move - they stay under the old root until
moved by hand or re-captured. Then re-stamp the deployed rule - run
`node $TMP/repo/scripts/stamp-docs-root.js <project root>` (global install: `--claude-dir <account dir>`): it rewrites the 'This install's root:'
line in `.claude/rules/baseline-docs-root.md` from the settings.json value just written, so the
always-on awareness matches the env (every install/update run re-stamps it too). Add
`--reprobe-versioning <value>` to that same command when this run's own install SEEDED the docs-versioning key,
passing the value its seed line named (`git` or `local`) - the seed was probed at the old docs path. The script
REFUSES when the file no longer holds that value, so a key an earlier install wrote, or one the user just
changed, is never re-probed: pass the seeded value and let the check answer. Nothing else
needs editing. Apply on consent with a
merge touching ONLY the chosen keys - everything else in settings.json is preserved, EXCEPT a
MISSING `ALFRED_CODE_DOCS_VERSIONING` row accepted at its previewed (recommended) value: write that
one by running `node $TMP/repo/scripts/stamp-docs-root.js <project root> --seed-versioning` instead
of folding it into the merge, so the write re-probes at write time rather than trusting a preview a
few turns stale, and report its printed line. A typed override (Other) for that same row is a
deliberate decision like any other row's and goes through the generic merge as-is. Area
skipped, or nothing changed: one narration line, nothing written.

## 10. Permission mode

Runs regardless of which areas were chosen at step 2 - it is not part of that picker (the tool caps a
question there at 4 options, already spent on rules+agents+skills / hooks / MCPs+plugins /
environment). Read the account settings.json (`~/.claude/settings.json`, or the `--space` profile's)
`permissions.defaultMode` and, in project mode, whether the project's own `.claude/settings.json`
already sets one - report both in one line (`account: auto · project: unset`). Ask ONE
AskUserQuestion: **keep it as it is** (recommended - leave the project's `permissions` block
untouched, whatever it currently holds) or **set the default for this project** (write/overwrite
`permissions.defaultMode` in the project's own `.claude/settings.json` only, pre-filled with the
account's current value, editable via Other to any of `default` / `plan` / `acceptEdits` /
`bypassPermissions` / `auto` / `dontAsk`). Global mode: skip - there is no project to scope a
default to. Applied at step 12 (Update + removals), the same merge-only-this-key discipline as the
Environment step - every other key in `permissions` (`allow` / `deny` / `ask` /
`additionalDirectories`) and the rest of the file stay untouched.

## 11. Prerequisite check

Run: `node stack-select.js --selection "$TMP/raw.json" --emit "$TMP/selection.txt" --check [--hooks-answered] [--playwright-browsers <csv>] [--config-dir ~/.claude-<space>]`
(`--hooks-answered` whenever the Hooks area was walked this run, so a walk that switched every hook off emits `hook none` rather than no hook line - which reads as 'every hook'; `--playwright-browsers` with the step-7 kept browsers whenever playwright is kept - a kept `msedge` warns
when Edge is not installed; `--config-dir` under a `--space` profile, so the env probe reads that account's
settings.json), output redirected to `$TMP/select.out` like every recompute. **Fixed shape, three blocks:** (1) one
verdict line - `blockers: N · warnings: N`; (2) the closed selection grouped by category - closure
adds marked with their reasons, the final drop list (incl. accepted orphans) named; (3) each
blocker with its fix, each warning listed. Never run past a blocker
(fix now, or reopen the owning layer and drop the affected items). Warnings are listed and
passed. **Convention-conflict warnings (project mode only):** when the project carries stated
conventions (a root or `.claude/` CLAUDE.md, `<docs-path>/architecture/` docs), check THIS RUN'S
typed adds (never locked rows or kept installed items) against them - a conflicting add gets one
warning line quoting the rule verbatim plus a keep-or-drop consent. No citable conflict, no
warning; no project docs, skip silently; a conflict warning never blocks the run. Also ask here,
through AskUserQuestion: keep local model/effort pins? (`--keep-pins`, yes recommended for a configure
run - an existing install often carries deliberate pin edits).

## 12. Update + removals

**First, is there anything to do?** Run the delta - `node "$TMP/repo/scripts/derive-state.js"
--delta --installed "$TMP/installed.json" --selection "$TMP/selection.txt" --picked "$TMP/raw.json"`
prints one `add <line>` or `drop <line>` per change against step 1's read-back, or `none`, then
the lines the run leaves OFF: `kept-off <line>` is a switched-off item the closure re-requires but
the user never picked - report it as 'stays switched off; pick it in the walk to turn it on', never
as added; `keep-parked plugin <name>` is a parked plugin the read-back would otherwise enable -
pass it as a `--drop` whenever the installer runs, but it is no reason to run it. When it prints `none` AND no removals were accepted AND no env,
permission-mode, or plugin-settings change was chosen, print ONE line - `unchanged - nothing to
install, nothing to remove` - and skip to step 13. Do not run the installer to prove it (measured: a run whose
selection it had itself proved identical spent 2 API messages and 351,777 re-sent tokens on an
installer pass whose only real effect was resetting the agent model/effort pins).

Otherwise, run the installer **from the snapshot**, passing it back with `--source` so the run
lands the same revision step 1 previewed. One fixed capture form, always - `2>&1 | tee
"$TMP/install.log"` on the call itself, so the post-install read below has a file that was actually
written (the shared contract is in `source-protocol.md`'s 'Capture the installer's own output'):

- **Any OS:** `node "$TMP/repo/scripts/install/alfred-code.js" update --source "$TMP/repo" --scope <scope> --installed-only [--add '<line>']... [--drop '<line>']... [--space <name>] [--keep-pins] [--playwright-browsers <csv>] [--playwright-enabled <csv|none>] [--docs-versioning git|local] [--memory-level global|scoped|project] 2>&1 | tee "$TMP/install.log"` - one `--add` per delta `add` line, one `--drop` per `drop` and `keep-parked` line, each quoted. The installer applies them on top of the SAME read-back step 1 showed, so an unwalked layer and a seat or hook switched off before this run stay exactly as they were. Never `--selection` on this seed: that route neither removes nor disables what the walk dropped, and it stamps every carried item as a pick.
- **`ALFRED_CODE_SEED=shell`** - the resolve line reported `seed=shell` (`ALFRED_CODE_SEED`, or the 1.x `CLAUDE_STACK_SEED`, set to `shell`). The frozen OS twin names what a 2.0.0 registration cannot resolve, so it no longer runs: print `the shell installers were removed in 2.0.0 - unset ALFRED_CODE_SEED / CLAUDE_STACK_SEED to use the Node installer` and stop. <!-- legacy-name -->
- `--docs-versioning` only when the user's own invocation names a value (`/alfred-code:configure
  --docs-versioning local`): the installer writes it over the current value and prints the old and new
  value in one line. A value changed at step 9 is already in the file, and the installer never re-seeds a
  key that is present - so it needs no flag.
- `--memory-level` carries step 7's answer whenever memory is present and the user changed the
  level: the installer re-points the registration to that level's database (nothing copied or
  deleted) and prints `memory: level <old> -> <new>: <newPath> (old memories stay in <oldPath>)`.
  Nothing changed at step 7 - the level already matches, or memory was dropped - needs no flag.
- Scope/space mirror how the install was laid down (project install -> `project`; account
  install -> `global`, with the space that owns it) - ask only when it is genuinely ambiguous.

The run refreshes EVERY installed item, in every category, whether or not its area was walked this
run - the area picker decides which tables you page through, never which files the installer
rewrites. So an unwalked layer is untouched IN THE SELECTION and refreshed on disk, and a post-check
that calls it 'untouched' is wrong (measured: four layers reported untouched while all 88 selected
items had just been refreshed). On the Node seed a `--drop` is applied BY the installer:

- a core seat is denied (`Agent(alfred-code:<name>)` in `permissions.deny`); a hook on the plugin
  route is named in `ALFRED_CODE_HOOKS_OFF`; a COPIED skill, agent, rule or hook (a copy route, or a
  library copy) has its file deleted, a copied hook its wiring too;
- an MCP entry nothing kept needs any more - a dropped server's own entry - is disabled:
  `plugin disabled [<scope>]: <entry>`;
- a core skill logs `skill <name> stays loaded`: the core carries it and no setting unloads a plugin
  skill, so it is reported as carried, never as removed;
- a drop something kept REQUIRES logs `--drop <line> not applied - something kept requires it`,
  after the `required:` line naming what needs it, and a drop of an always-on rule or server logs
  `not applied - locked` - report both as kept, with that reason;
- a stack entry enabled at a DIFFERENT scope than this run's is never disabled: the log names it and
  the command, for the user to run if nothing else needs it.

It does NOT uninstall a plugin, and on the copy MCP route it does not unregister a server.
**Fixed order, three blocks:** (1) the installer run, summarized in ONE line (what landed, the
stamp action) - never paste its output, and take the counts from the line that states them:
`grep -E 'installed/refreshed this run' "$TMP/install.log"` (a `tail -20` of a 243-line log misses
it, which is how the wrong post-check above was written); (2) removals - what the drops did, from
`grep -E 'installed-only: (dropping|--drop|skill .* stays loaded)|plugin disabled|plugin disable failed|scope, not this run|removed \(dropped\)|overwriting a hand-edited copy' "$TMP/install.log"` - for each `--drop <line> not applied - something kept requires it` among them, its reason is `grep -F 'installed-only: required: <line> ' "$TMP/install.log"`; a `dropping plugin <name>` for a `keep-parked` name is no removal, leave it out,
one line per item, never deleted a second time by hand; then each removal the installer does not
make, with its command shown before running it: `claude mcp remove <name>` for an MCP on the copy
route (playwright = every `playwright-<browser>` server);
`claude plugin uninstall <name> --scope <the scope step 1's inventory carries for it>` for a plugin -
except one the table showed as `dependency`, which is never proposed for removal at all: every
install carries it beside the core, and the next run installs it again - and the removal ask that proposed it NAMES that scope ('enabled at USER scope - removing it removes
it for every project'), since account-wide and project-local are different consents and the wrong
`--scope` fails with `not installed in project scope`. 'removals: none' when nothing was dropped;
(3) the follow-through line - telling the USER to re-run `/project-agent-capabilities` (when
installed, and ONLY when this run added or removed a skill, agent, MCP server or plugin - the
inventory that rule lists; a run that changed only env or settings names none) so the generated awareness rule reflects the new inventory (the skill is manual-only,
`disable-model-invocation` - a Skill call from this run is blocked; the line is addressed to the
user, never acted on), and any environment writes from step 9. On a step-10 'set the default for
this project' answer, merge `permissions.defaultMode: <value>` into the PROJECT's
`.claude/settings.json` here too - never the account file, touching ONLY that key inside
`permissions`; 'keep it as it is' writes nothing.

### 12a. Plugin settings - apply the step-8 answer

Same as the init walk, run after the installer block and before the follow-through line: re-run
`node "$TMP/repo/scripts/plugin-settings.js" --catalog "$TMP/repo/meta/plugin-settings.json" --config-dir <account dir> --installed <kept plugins csv> --apply` (plus `--replace` for the
overwrite answer) and paste the closing `applied:` line. A run that dropped the plugin asked
nothing at step 8 and applies nothing here.

## 13. CLAUDE.md - the user's call (project mode)

Not required - open with WHERE it lives and WHAT a yes changes, then AskUserQuestion (reconcile -
recommended / skip); a 'no' ends the run cleanly. The location: the project's own CLAUDE.md - `.claude/CLAUDE.md` where the installer
seeded it, or the root `CLAUDE.md` where the project already had one; name which one you found.
On a yes: reconcile it against the fetched `stack/CLAUDE.template.md` - add the sections the
template gained since the install, update the selection-tied parts (the rules table and any
capability mentions) for what this run added or dropped, and complete any still-unwritten
authoring-outline sections from what the inventory established. Reconcile ADDITIVELY: never
overwrite the project's own prose, and show the changes before writing. Never offer
skill/agent/MCP additions here - the walk owned the selection. Skip in global mode (no project
file to reconcile).

## Post-check

Report what changed per category (refreshed / added / dropped, orphans removed vs kept), the
CLAUDE.md decision and reconcile result, anything deferred, and remind that a restart picks up
MCP registration changes. When step 7 touched `memory`, add one line naming the level (unchanged
or the old -> new file) and, when `project` was chosen while sibling repos are named, that those
projects' memories are not visible from this one. The run rewrites `alfred-code.stamp` to the
revision it installed, so the next configure diffs from here.

**The run closes on a suggestion card, never on a question.** After the report, list the
follow-ups that are the USER's to run - restart for an MCP change, `/project-agent-capabilities`
(when installed and this run changed the inventory it lists), a manual-only capture whose output this
run made stale, the serena re-index, a credential to rotate or set by
hand - as `Suggested next steps`, the recommended one first and each with the one reason it
matters ('`/project-agent-capabilities` - the selection changed, so the generated rule still
names what this project dropped'). No AskUserQuestion over them: the walk's asks end with the
installer (a write still gets its consent ask where it happens - step 13's CLAUDE.md reconcile),
and the closing ask over follow-ups was dropped as friction - the user's call, made knowing a
prose next step was ignored 3 of 3 in one audited session, which is why the reason rides beside
every step. Close with this line, verbatim:
'Nothing is pending on this run - these are yours to run when you choose.' The stop-contract
guard reads that sentence as a finished close; without it a 'done + next step' card is blocked
as a stall and the guard demands the very ask this paragraph removes.
The line is CONDITIONAL: print it only when the card carries nothing OWED. A still-required user action - revoke the old token, fill in a credential, run a rotation - IS pending, so name it and put the close through the ask instead (measured: one close stated 'Still owed: revoke the old token in Sentry's dashboard' and this line in the same message).


## Clean up the temp dir - ALWAYS

Remove `$TMP` per `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md`, on EVERY exit path of
THIS command: after a successful update, after an abort, after a blocker, and after the step-1
'nothing changed, stop here' case. Then confirm the project tree holds only installed artifacts.

## Do not

- Do not fall back to a full re-install - this is the update path; a from-scratch install is the
  sibling `init` command. Never present a layer question without its
  `[step n/13 - <name>] ... · next: <name>` banner or without the full-catalog table.
- Never drop a locked row on the user's behalf, never remove an orphan silently, and never
  re-offer an orphan the user chose to keep - the reason column is the answer, the dependent's
  layer is the remedy.
- Do not paste tool output other than the decision tables, or run chatty per-file commands - the 'Narrate, don't trace' contract
  holds for the whole run.
- Do not skip the area pick, the walked layers, the add/drop rounds, the prerequisite gate, or the explicit-removal
  pass. Do not write the archive, the extracted repo, or the working files into the project
  tree, and do not leave `$TMP` behind on any exit path. Do not commit anything on the user's
  behalf.
