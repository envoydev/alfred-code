---
name: alfred-capture-agent-capabilities
description: "Use when asked to capture the agent capabilities, refresh the capabilities rule, or see what this project has installed. Manual, /-only. Not for architecture."
disable-model-invocation: true
---

# Agent Capabilities - inventory what is installed, generate the awareness rule

Every project trims the stack differently - skills commented out of the manifest, MCPs dropped (`browser` where nothing renders a browser UI), seats it never picked (each denied in `permissions.deny`). A predefined list would name capabilities the project does not have; this skill reads the REAL inventory and generates the rule from it, so every session knows exactly what this project can do - and never gets steered at a capability that is not there.

The measurements behind these rules live in `references/evidence.md` - an audit appendix, not a run-time load.

## When to use

- The deliberate capabilities capture. Use after an install, a stack update or a manifest trim as well.
- It inventories what THIS project actually has - the slash-only orchestration skills, the subagent seats, the MCP servers, the plugins - and regenerates wholesale the always-on awareness rule `.claude/rules/alfred-project-agent-capabilities.md`: the fixed house usage policy plus the real inventory, never an assumed stack.
- Not for capturing architecture (alfred-capture-architecture), code style (alfred-capture-code-style), the run book on building, starting and logging into the app (alfred-capture-project-capabilities), or a sibling repo's context - that is the sibling-context capture, where the project installed one.

## The run - one script, one compose, one write

`scripts/capabilities-inventory.js` does every mechanical step in ONE node pass (built-ins only,
nothing to install, no per-skill fork): the precheck, the inventory with a printed COUNT per layer,
the live `claude mcp list`, the paste-ready MCP routing rows, the compare verdict and the
post-write verify.

The script has TWO homes - this skill's copy under `.claude/skills/`, or the stack's plugin cache, where
several versions can sit side by side and the newest is taken (normally the release these copies came
from; after a core update it can be newer) - so resolve it ONCE: the block prints the path, and every later call pastes that literal as `<caps>` (each Bash
call is its own shell, so a variable set here is gone by the next). Run all of it from the project root:

```bash
CAPS=.claude/skills/alfred-capture-agent-capabilities/scripts/capabilities-inventory.js
[ -f "$CAPS" ] || CAPS=$(for d in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/alfred-code/* "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-stack/*; do   # legacy-name: a 1.x dir until orphaned
  f="$d/stack/skills/alfred-capture-agent-capabilities/scripts/capabilities-inventory.js"
  [ -f "$f" ] && [ ! -e "$d/.orphaned_at" ] && printf '%s\t%s\n' "$(basename "$d")" "$f"
done 2>/dev/null | sort -V | tail -1 | cut -f2)
echo "caps: ${CAPS:-absent}"
node "$CAPS"
```

`caps: absent` means neither home has it: say so and stop, never hand-tally the inventory instead.

**Its printed block is the whole inventory.** Re-grepping, re-Reading or hand-tallying anything it
printed is a defect, not diligence - every count and every row of the report comes off one of its
lines, and a claim with no printed line behind it does not go in the report. It probes the `claude`
CLI without laundering a failure into an empty result (`<cmd> || echo none`, banned in
`alfred-navigation.md`) and without `| head -N`, so `CLI absent` and `0 plugins` stay
different report fields.

### 1. PRECHECK - the script's first lines
- `PRECHECK: FIRST` - no rule yet. Compose and write; this is the capture the skill exists for.
- `PRECHECK: empty` - nothing under the inventory sources changed since the rule was written. Say
  so in ONE line naming the `Captured:` date that line quotes, and STOP. Do not compose, do not
  write. Two things the precheck cannot see, and the only two reasons to go on: the PLUGIN list is
  machine-global (an enable or disable changes no file in this tree), and the USER may ask for a
  refresh outright. Either overrides it - say which one you are acting on.
- `PRECHECK: drift - <n> file(s)` - that is the drift. Continue, and name those paths in the report.

### 2. COMPOSE the body - the verdict authorizes the write
Read `references/generated-rule-template.md` for the four sections' fill rules, then compose the
WHOLE body in-session: the block below verbatim, with only its `<...>` slots filled from the
script's lines. One slot is not a slot - every `<docs-path>` becomes the LITERAL `DOCS ROOT` value
the script printed, because the generated rule is a deterministic pointer and cannot itself carry
the placeholder it exists to resolve; the routing rows arrive with it, `<data root>` and `<engine>`
already filled, and `--verify` fails a rule still holding one.

Write the composed body to the file the script's `COMPARE` line names - `<DOCS ROOT>/flow/capabilities-body.md`,
inside the project, where a Write lands in print mode too, and out of git through the docs root's own
`.gitignore` - then run the verdict:

```bash
node "<caps>" --body <DOCS ROOT>/flow/capabilities-body.md
```

Delete that file once the verdict is spent - after the rule is written, or on `identical`.

- `COMPARE: identical` - do NOT write. Report `rule unchanged - <N> bytes, not rewritten`, and go
  to step 3's report. An identical rewrite pays a delete plus a full write, and the next session
  pays the changed mtime.
- `COMPARE: differs` - write the composed body over the rule in ONE call, the whole file. No
  in-place Edit, no `sed -i`, no partial upsert: an edit keeps stale policy wording the skill has
  since changed. Do NOT `rm` it first - the auto-mode classifier denies that delete, which costs
  exactly the blocked round trip the delete was meant to save.

Without a printed `COMPARE: differs` line there is nothing to write.

The block below is a COPY TARGET, not prose to retype:

```markdown
---
description: Project capabilities awareness - generated by /alfred-capture-agent-capabilities; edit via a re-run, not by hand.
---

# This project's capabilities

Captured: <the script's CAPTURED line>

## Usage policy (fixed - stamped verbatim, every run)
<!-- policy-rev: bb634a02 -->
- Load a skill for the work at hand - a file you are about to edit, a command you are about to
  run, a diff you are about to show - never to answer a question the code or the conversation
  already answers.
- One home per rule: the project CLAUDE.md routes only what an auto-injected description does not
  cover; path-scoped rules own per-file-type routing, hooks own deterministic gates.
- Subagent dispatch is explicit, never automatic: a user @agent-<name> mention, an orchestration
  skill routing to it, or a repair-loop rule naming its resolver - never self-delegation off a
  description match. For multi-agent work, suggest the matching orchestration skill below, never one
  this project does not carry.
- A slash-only skill or plugin command (`disable-model-invocation` - listed below) is the USER's to
  type - never call it yourself or retry it under another spelling, and never spend the turn explaining
  that you cannot: name the command, say in one line what it does, hand the turn back
  (`guard-fresh-session-start.js` denies the call).
- A deliberate orchestration skill (a capture, a quality loop, a build flow) starts in a fresh
  session when this one already carries another run's history; `guard-fresh-session-start.js` blocks
  the call past the window trigger, answered with one AskUserQuestion (fresh session recommended).

## Orchestration skills (slash-only - invisible until invoked)
<the script's `/name - clause` rows, one per row>

## Subagent seats
<the script's SEATS name line - each seat under the name that RESOLVES: a seat from a plugin is
addressable only as `<plugin>:<seat>`, and a bare name returns 'Agent type not found'>

## MCP routing
<the script's `MCP ROUTING rows` block, pasted verbatim>

## Plugins
<the script's PLUGINS name line; omit the section when it printed `CLI absent`>
```

The usage-policy section is the house skill/agent policy's ONE home - it ships verbatim from this skill (a policy wording change lands here and reaches projects on their next re-run). Copy the `<!-- policy-rev: ... -->` line with it, unchanged: it is a content stamp over the block, recomputed by the stack's own lint whenever the policy text moves, and it is the ONLY way to tell a project carrying a current copy from one carrying a two-release-old one. `/alfred-code:validate` compares a project's stamp against the snapshot's. Like every generated `alfred-project-*.md` rule it stays out of the installer's catalog, so `/alfred-code:update` cannot overwrite it.

The 1.x project-capabilities skill (this one's old name, not the run-book capture) wrote `.claude/rules/baseline-project-capabilities.md`, and before 2.1.6 this rule was `.claude/rules/baseline-project-agent-capabilities.md` (the update moves it; a run that finds it beside the new file means both exist): when either legacy rule exists, delete it in the same run - this rule supersedes it, and nothing else ever prunes generated rules.

### 3. VERIFY - after the write, before the report

```bash
node "<caps>" --verify .claude/rules/alfred-project-agent-capabilities.md
```

It parses the frontmatter with node - never PyYAML, which is missing on machines where a run died
on ModuleNotFoundError and still reported 'frontmatter parses' off a weaker check - and checks
there is no `paths:` key, that the `<!-- policy-rev: ... -->` stamp and the policy block came over verbatim, that
the inventory headings are present, and that every MCP row carries its `first call:` line. A
non-zero exit means the rule is not done: fix and re-run it. Its `VERIFY:` line is a report field.

### 4. REPORT
A literal line template, not prose to remember - every field is one of the script's printed lines:

```
Rule:       <created | refreshed | unchanged, not rewritten> - <N> bytes   (the COMPARE line)
Verify:     <the VERIFY: line, or `not run - nothing written`>
Inventory:  skills <n> / seats <n> / rules <n> / MCP <n> / plugins <n | CLI absent>
Drift:      <the paths PRECHECK printed, or `user asked for a refresh` / `plugin state only`>
Live from:  next session - an always-on rule is read at session start, so it does not govern this one
Flags:      <one row each, or `none`>
```

Then the prose, short - four things, each its own line so none of them is skimmed past:

- **Say `Live from:` the one way it is true on BOTH branches** - an always-on rule loads at session start, not retroactively, so this one governs from the next session and its guidance starts applying at the next `/clear`. It is UNCONDITIONAL and identical whether or not anything was written, and there is no next-run line: a capture is suggested only where its output is stale.
- **The flags are MECHANICAL - read them off the block, do not eyeball them**: the script's `seat families` line against its path-scoped rule rows is the convention-rule cross-check (a family whose stack no rule names); and a slash-only skill whose seats are not installed is the second.
- **Never infer causation from a machine-global listing** - state observed facts plainly ('typescript-lsp: listed disabled'), and never assert WHY something is installed or disabled: `claude plugin list` is machine-global, so install-scope causation read off it is a guess.
- **Say that the rule is MACHINE-LOCAL, not committed** - the installers tell every project to gitignore `.claude/*` and re-include only `.claude/CLAUDE.md`, so this file is untracked, a fresh clone does not carry it, and the command has to be re-run there.

## Don't game it
The rule lists what the inventory proved, nothing else - no capability assumed from the house defaults, no row for a server or skill the project dropped, and an unreadable source reported as unreadable (the script prints it that way) rather than filled from memory.

A thin `.claude/agents` is not by itself a broken install: the core carries the seats (every skill is a copy under `.claude/skills`), so when a layer comes from plugins the script prints `SOURCE: PLUGIN-COVERED` and reports the UNION - what the enabled plugins carry plus whatever is copied locally. Stop and say so only when it printed neither a local nor a plugin source.
