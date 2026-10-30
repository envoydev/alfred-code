---
name: capture-awareness
description: "Use when asked to capture or note project awareness - run book, Jira/Sentry links, architecture map or module boundaries, code style, sibling repos, installs."
---

# Awareness - what this project has, how it runs, how it is built, what it is bound to

Five deliberate captures share this skill. Each part is a reference the run reads and follows; the first word picks
one part, and the typed command with no topic word runs the chain behind one ask.

| Part | Topic words | Its own arguments | Writes | Seats |
|---|---|---|---|---|
| project | `project` | none, `refresh`, or any text (a NOTE) | `awareness/PROJECT-INFO-AWARENESS.md`, `awareness/RUN-AND-DEBUG-AWARENESS.md`, `awareness/RESOURCES-AWARENESS.md`, `awareness/USER-AWARENESS.md` (created once) | none |
| related-projects | `related-projects`, `related` | none, `refresh`, or sibling locations (each with an optional relation hint) | `awareness/RELATED-PROJECTS-AWARENESS.md` | related-project-analyzer |
| project-code-style | `project-code-style`, `code-style` | none, or `refresh` | `preferences/PROJECT-CODE-PREFERENCES.md` | code-style-analyzer |
| architecture | `architecture` | none, `refresh`, or a target (a path that exists) | `awareness/ARCHITECTURE-AWARENESS.md`, `awareness/references/`, `awareness/history/`, `awareness/ARCHITECTURE-ORIENTATION-AWARENESS.md` | architecture-analyzer |
| agents | `agents` | none, or `refresh` | `awareness/AGENTS-AWARENESS.md` | none |

Every path is under `<docs-path>/`. The rule `.claude/rules/alfred-awareness.md` is no part's. Every run that ran the
project, related-projects, architecture or agents part closes with ONE `--rule` call after its last part (section 5),
so a lone `/capture-awareness project` writes the imports of the docs it just made. `agents` is the table's last row,
so a chain takes the inventory after the seat parts wrote their rules. A lone architecture run closes with the same
call, which writes the map's pointer line; a lone code-style run takes no inventory and leaves the awareness rule
alone.

`<docs-path>/awareness/` is one docs domain with one `watch.json`. Its `notOwned` entry keeps the docs engine from
sectioning or writing `AGENTS-AWARENESS.md`, which only the script writes. Each doc's shape is fixed verbatim in its
reference - no formatting skill loads for them (the docs root belongs to the skill that writes it). The rule imports
these into every session and every subagent:

| File | Holds | Written by | In git |
|---|---|---|---|
| `<docs-path>/awareness/AGENTS-AWARENESS.md` | the house usage policy and the real inventory | the script, whole | never - it names this machine's plugins |
| `<docs-path>/awareness/PROJECT-INFO-AWARENESS.md` | what the project is, who uses it, its stack and where it runs | the project part, from the repo and the user's answers | with the docs |
| `<docs-path>/awareness/RUN-AND-DEBUG-AWARENESS.md` | the run book | the project part, from the repo and the user's answers | with the docs |
| `<docs-path>/awareness/RESOURCES-AWARENESS.md` | the issue tracker, the wiki, the error monitor, the git host and CI | the project part, from the repo and the user's answers | with the docs |
| `<docs-path>/awareness/RELATED-PROJECTS-AWARENESS.md` | the sibling repos and their seams | the related-projects part, from the siblings the user names | with the docs |
| `<docs-path>/awareness/USER-AWARENESS.md` | the user's own notes | the user alone - the project part creates it once | never |
| `.claude/rules/alfred-awareness.md` | one `@` import per doc | the script | where the project commits `.claude/rules/` |

The rule stays out of the installer's catalog and no installer ledger records the generated files, so
`/alfred-code:update` never overwrites them - it only moves an older install's files into this layout.

## When to use

- A topic word picks one part: `/capture-awareness project`, `/capture-awareness architecture src/api`,
  `/capture-awareness code-style`, `/capture-awareness related ../backend`, `/capture-awareness agents`.
- After an install, an update, a configure run or a trim (the inventory moved), when the run book is missing or
  stale, to add or refresh a sibling repo, or to map the structure or the code style.
- The chain of all five runs only on the typed `/capture-awareness` with no topic word (or `refresh`), or a request
  that asks in words for the whole awareness capture. A description match runs the one part the request names.
- A re-run is cheap: the inventory is one script call, and each other part asks or reads only what moved.
- Not for judging the code, the architecture or the coverage (capture-quality), or dynamic cross-repo findings -
  those go to Claude Code's own memory, naming the sibling.

**Modes.** Mode flags right after the command - `--mode-auto-run-on`, `--mode-auto-run-off`, `--mode-output-scorer-on`, `--mode-output-scorer-off` - are switches, not the request: strip them; with only flags typed, run as with no arguments. Under the hook's auto-run contract, follow it. With no hook line (hooks off, Cursor), `-on` holds for this run only: each stop takes its `(Recommended)` option, listed in the close, an unmarked one waits, nothing goes outward, no fresh-session hand-off, and the close says auto-run ended; `--mode-output-scorer-on` grades this run's output like a typed stack.

## 0. The script - resolve it once

`scripts/awareness-state.js` reads every part's state (`--state`), writes `AGENTS-AWARENESS.md` (`--write`, the
agents part) and the rule (`--rule`, section 5). It has TWO homes - this skill's copy under `.claude/skills/`, or
the stack's plugin cache, where several versions can sit side by side and the newest is taken (after a core update it
can be newer than the copies) - so resolve it ONCE, before the first part, in any run but a lone code-style one: the
block prints the path, and every later call pastes that literal as `<caps>` (each Bash call is its own shell, so a
variable set here is gone by the next). Run all of it from the project root:

```bash
CAPS=.claude/skills/capture-awareness/scripts/awareness-state.js
[ -f "$CAPS" ] || CAPS=$(for d in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/*/*; do   # one glob: zsh aborts the loop when any named glob matches nothing
  PN=${d%/*}; PN=${PN##*/}; [ "$PN" = alfred-code ] || continue
  f="$d/stack/skills/capture-awareness/scripts/awareness-state.js"
  [ -f "$f" ] && [ ! -e "$d/.orphaned_at" ] && printf '%s\t%s\n' "$(basename "$d")" "$f"
done 2>/dev/null | sort -V | tail -1 | cut -f2)
echo "caps: ${CAPS:-absent}"
```

`caps: absent` means neither home has it: say so and stop - never hand-tally the inventory or hand-write the rule.

## 1. The topic word

Read the arguments in this order.

1. Strip the mode flags (`--mode-auto-run-on`, `--mode-auto-run-off`, `--mode-output-scorer-on`,
   `--mode-output-scorer-off`).
2. Take the first remaining word, compared whole and case-insensitively against the topic words. A word holding `/`,
   `\` or `.`, or a git URL, never matches.
3. A match picks that part. A mode word next, `DELEGATED` or `INLINE` (case-insensitive), marks a calling flow: the
   part skips its run gate and its seats-or-inline ask and inherits that mode, and every word after it is the part's
   own argument. A person may type the same form, and has then chosen. Without a mode word the rest is the part's own
   argument. On the TYPED command the rest must fit the part's column above; when it does not, the whole text is a
   NOTE for the project part, and the run's first line says so - 'Read as a note: <text>. To run the <part> part,
   type /capture-awareness <topic>.' A caller's Skill call (section 4) is never re-read as a note: its topic wins and
   the rest is its argument.
4. No match - who started the load decides:
   - On a description match (the model loaded the skill on a request), section 3's load rule decides, and none of
     the bullets below applies: the part is the one the request names, a path that exists is that part's argument,
     and the chain never runs.
   - On the typed command or a caller's Skill call:
     - a path that exists or a git URL first: the related part with those siblings;
     - `refresh` alone: the chain, with every part's run recommended whatever its state;
     - nothing: the chain;
     - any other text: a NOTE for the project part - never the chain.

| Arguments (typed, unless marked) | Result |
|---|---|
| none | the chain |
| `refresh` | the chain, every part recommended |
| `Agents` | the agents part |
| `architecture` | the architecture part, whole repo |
| `architecture src/api` | the architecture part, target `src/api` (it exists) |
| `architecture DELEGATED src/api` | the architecture part through its seats, no run gate or mode ask, target `src/api` |
| `architecture is hexagonal` | a NOTE, 'architecture is hexagonal' (the rest is no path) |
| `project uses pnpm 9` | the project part, NOTE 'uses pnpm 9' |
| `code-style` | the code-style part |
| `style guide lives in Confluence` | a NOTE (`style` is no topic word) |
| `../backend provides-to` | the related part, sibling `../backend` |
| `related ../backend` | the related part, sibling `../backend` |
| `the API needs a VPN` | a NOTE for the project part |
| (model-loaded) 'document the architecture of src/api' | the architecture part, target `src/api` - never the related part, never a NOTE |

`capture-quality`'s `architecture` topic is another skill's word; the two never meet, since a topic is read only
after the command or Skill call that names its skill.

## 2. One part

The part runs alone, with its arguments, by its own reference - its run gate, mode ask, steps and field template as
written there:

- project: read `references/project.md` and follow it.
- related-projects: read `references/related-projects.md` and follow it.
- project-code-style: read `references/project-code-style.md` and follow it.
  - `references/project-code-style-doc-shape.md` - the section format and write mechanics, read before MERGE.
- architecture: read `references/architecture.md` and follow it.
  - `references/architecture-doc-shapes.md` - the map's shape and write protocol, read before AGGREGATE.
  - `references/architecture-hazards.md` - the stack-keyed hazard catalog, read before AGGREGATE.
  - `references/architecture-vocabulary-roles.md` - what the vocabulary step loads, read at AGGREGATE.
  - `references/architecture-report-fields.md` - what each close field means, read at REPORT.
- agents: read `references/agents.md` and follow it.

Each part's contract file is read in full at its step, never from the part's mention alone. Then the close (section 5).

## 3. The chain

Who started the load decides what a run with no topic word does:

- The user's message is the typed `/capture-awareness` command (no arguments, or `refresh`), or asks in words for the
  whole awareness capture: the chain runs.
- Otherwise the model loaded the skill on a request (a description match). The part is the one the request names,
  matched against the router table's Writes and topic words ('document the architecture' names the architecture part,
  'capture how we build and log in' the project part). When it names none, or more than one, ONE single-select
  question picks the part, the closest first and Recommended. The chain never runs on a description match: five
  captures, three of them with seats, are never what one request asked for.
- On a description match the remaining words are a part's argument only when they name a path that exists or a git
  URL; otherwise there is none. The part's own run gate still applies, because no calling flow started it.
- A calling flow's Skill call (section 4) is none of these: it always names its part, so it reaches the part through
  section 1 step 3 and never the chain.

The part pick, when a description match names none of the five parts or more than one:

```ask
Which awareness part should run? The request names none of the five, or more than one.
- '<the part closest to the request's words> (Recommended)' - its Writes or topic words come nearest the request
- '<the next closest part>' - writes <its docs>
- '<the third closest part>' - writes <its docs>
```

The chain:

1. Run `node "<caps>" --state`. It reads, never writes, always exits 0, and prints one line per part in the router
   table's order - `absent (no <doc>)`, `unstamped (<doc>)`, `current <branch>@<sha>` or `stale <branch>@<sha> (<why>)`,
   and `agents: run` last. A line ending `(no docs engine)` read each doc by presence alone; one ending
   `(docs engine failed)` kept the stamps and could not read the drift. With `refresh`, read every part as needing a run.
2. Put ONE AskUserQuestion call of at most two questions, each a single-select ask template:

   ```ask
   Run the awareness capture? <n> of the five parts need it: <part - state, one per part>.
   - 'Run the <n> that need it (Recommended)' - <those parts>; the current ones stay as they are
   - 'Pick the parts' - one more question, part by part
   - 'Run all five' - every part, the current ones refreshed
   ```

   The recommended set is never empty, since the agents part always runs. The second question, only when dispatch is
   available and a seat part (related-projects, project-code-style, architecture) can run:

   ```ask
   Run the seat parts through their analyzer seats or in this session?
   - 'Through the seats (Recommended)' - the cheap seats absorb the reads; the reasoning and the write stay here
   - 'In this session' - bounded, no dispatch
   ```

   With no dispatch every part runs INLINE and the second question is not asked.
3. 'Pick the parts' opens ONE more call of two multi-select questions, grouped by the table's Seats column: 'Which
   docs from this repo?' (agents, project) and 'Which analyses?' (related-projects, project-code-style,
   architecture), each option labelled with its state. Under auto-run the first option of each single-select is
   taken, so the Pick call never opens.
4. The answers are each part's run gate and mode answer, so no part asks either again; a part's content questions (the
   run book's asks, the siblings to add) still come. Run each chosen part by reading its reference and following it,
   in the router table's order, each in the same skill load: the parts are read, not re-invoked.
5. The close (section 5), with one `Skipped:` line naming the parts not run.

## 4. Callers

- A calling flow hands `<topic> <DELEGATED|INLINE> <target>`: the mode word right after the topic skips the part's run
  gate and mode ask, and the part inherits the mode.
- A person may type `/capture-awareness <topic>` (init's capture rows print that form) and gets the part's run gate.

## 5. The close

### RULE - one script call

After the last part of any run but a lone code-style one, `node "<caps>" --rule` composes
`.claude/rules/alfred-awareness.md` from the copy target below - one `@` import per awareness doc that exists, the
related doc only once it holds an entry, then the map's pointer line when the map exists - compares it, writes it on
differs, puts back the `notOwned` entry in `watch.json`, and removes the rules it supersedes (`alfred-agent-awareness.md`,
`alfred-project-awareness.md`, `alfred-related-context.md`, the 1.x `baseline-project-capabilities.md`, and the legacy
architecture marker once the map's line is written) once their content is imported. It prints one `size:` line per
imported doc and an `over budget:` line past a cap - the project part's budgets are counted there, never by hand. A
`RULE: FAIL` line is a stack defect: report it as it stands, never hand-write the rule.

COPY TARGET - the script fills the import slot and the map slot; every `<docs-path>` is the literal docs root:

```markdown
---
description: Project awareness - generated by /capture-awareness; edit via a re-run, not by hand.
---

# Project awareness

Imported below at every session start, from `<docs-path>/awareness/`: what this install carries and how to use it, the project's facts, the run book - follow it before you build, start, log into or hand-check the app - its resources, the related repos and your own notes. If a file's text is not below, Read it before you act on its area.

<the script's import lines, one per awareness doc>

<the script's map line, when the map exists>
```

### REPORT

One part: its field template, as its reference writes it, then the lines below. The chain: one block per part run,
in table order, each in its part's own field template, then:

```text
Landed:      <git | overlay> - the mode line of `node .claude/hooks/docs.js status`, for each doc this run wrote
Rule:        <the script's RULE: line, and its size: lines> | not run - a lone code-style run
Live from:   next session - the rule is read at session start, so it does not govern this one
Skipped:     <the parts the chain did not run, or none>
```

Then the agents reference's prose lines, and - when the capture surfaced work a sibling owns - the task card the
related reference describes. No re-paste of any doc - point to the files. The rule ships only where the project
commits `.claude/rules/` (the installers gitignore `.claude/*` but `.claude/AGENTS.md`), so a fresh clone re-runs
this capture.

## Don't game it

Every fact in the awareness docs traces to a line the script printed, a file the run read, or the user's own answer: a
gap stays `unknown`, an unreachable sibling stays an UNVERIFIED entry, an unreadable source is reported as
unreadable, and a credential appears only as the place it lives.

## Old installs

`/alfred-code:update` moves an older install into this layout: the run book from `project-awareness/` (or
`project-capabilities/`) with its section ids and branch versions, the sibling doc from
`related-projects/RELATED-PROJECTS.md`, the architecture map and its orientation block from `architecture/`, the
inventory rule's body into `AGENTS-AWARENESS.md`, and it writes the rule. When a doc still sits at an old home, name
`/alfred-code:update` in the report rather than moving it by hand.
