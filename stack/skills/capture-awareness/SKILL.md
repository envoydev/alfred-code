---
name: capture-awareness
description: "Use when asked to capture the project awareness - what is installed, the run book (build, start, log in), sibling repos. Manual, /-only. Not for architecture."
disable-model-invocation: true
---

# Awareness - what this project has, how it runs, what it is bound to

Every session needs three things it cannot read off the code: what THIS install carries (the skills, seats, MCP
servers and plugins left after the project's picks), how to build, start, log into and hand-check the app, and
which sibling repos it is bound to. One capture records all three under `<docs-path>/awareness/`, and one generated
rule imports them into every session and every subagent:

| File | Holds | Written by | In git |
|---|---|---|---|
| `<docs-path>/awareness/AGENTS-AWARENESS.md` | the house usage policy and the real inventory | the script, whole | never - it names this machine's plugins |
| `<docs-path>/awareness/PROJECT-AWARENESS.md` | the run book | this run, from the repo and the user's answers | with the docs |
| `<docs-path>/awareness/RELATED-PROJECTS-AWARENESS.md` | the sibling repos and their seams | this run, from the siblings the user names | with the docs |
| `.claude/rules/alfred-awareness.md` | one `@` import per doc | the script | where the project commits `.claude/rules/` |

`<docs-path>/awareness/` is one docs domain with one `watch.json`. Its `notOwned` entry keeps the docs engine from
sectioning or writing `AGENTS-AWARENESS.md`, which only the script writes.
Each doc's shape is fixed verbatim in its reference - no formatting skill loads for them (the docs root belongs
to the skill that writes it).

## When to use

- The deliberate awareness capture: after an install, an update, a configure run or a trim (the inventory moved), when the run book is missing or stale, or to add or refresh a sibling repo.
- Arguments: sibling locations - local paths or git URLs, each with an optional relation hint (`../backend`, `git@github.com:org/contracts.git provides-to`) - add or refresh those related projects; `refresh` re-asks the run book and rewrites the inventory even when nothing on disk moved.
- A re-run is cheap: the inventory is one script call, the run book is asked again only when it is missing, stale or `refresh` was passed, and the related projects only when siblings are passed or none were ever recorded.
- Not for the architecture map (capture-architecture), the code style (capture-code-style), or dynamic cross-repo findings - those go to the shared `alfred-memory` MCP, tagged with the sibling's name.

The four files are generated: a re-run refreshes them in place, and nobody edits them by hand. The rule stays out
of the installer's catalog and no installer ledger records any of them, so `/alfred-code:update` never overwrites
them - it only moves an older install's files into this layout.

**auto-mode.** `--auto-mode` as the first word of the arguments is a mode flag, not a target: the run goes unattended. Each stop takes its `(Recommended)` option and an answered ask is the go, in the same turn; an ask without one waits for the user, the fresh-session hand-off is never taken, nothing is pushed, merged, deployed or sent out, and the hook's `AUTO` stamp in `<docs-path>/flow/APPROVAL` is the run's approval: write no APPROVED or AUTO line over it, and only the close of the run its `skill:` line names deletes it.

## The run

### 0. The script - resolve it once

`scripts/capabilities-inventory.js` writes `AGENTS-AWARENESS.md` (step 1) and the rule (step 4). It has TWO homes -
this skill's copy under `.claude/skills/`, or the stack's plugin cache, where several versions can sit side by side
and the newest is taken (after a core update it can be newer than the copies) - so resolve it ONCE: the block prints
the path, and every later call pastes that literal as `<caps>` (each Bash call is its own shell, so a variable set
here is gone by the next). Run all of it from the project root:

```bash
CAPS=.claude/skills/capture-awareness/scripts/capabilities-inventory.js
[ -f "$CAPS" ] || CAPS=$(for d in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/*/*; do   # one glob: zsh aborts the loop when any named glob matches nothing
  PN=${d%/*}; PN=${PN##*/}; [ "$PN" = alfred-code ] || continue
  f="$d/stack/skills/capture-awareness/scripts/capabilities-inventory.js"
  [ -f "$f" ] && [ ! -e "$d/.orphaned_at" ] && printf '%s\t%s\n' "$(basename "$d")" "$f"
done 2>/dev/null | sort -V | tail -1 | cut -f2)
echo "caps: ${CAPS:-absent}"
```

`caps: absent` means neither home has it: say so and stop - never hand-tally the inventory or hand-write the rule.

### 1. AGENTS - the inventory, no questions

Read `references/agents.md`, then run `node "<caps>" --write` (`--write --refresh` when the arguments say
`refresh`). Its printed block is the whole inventory and its verdict lines say what happened; the reference says
how to read each one.

### 2. PROJECT - the run book

Read `references/project.md`: the credentials rule, DISCOVER, the doc's shape. The mode comes from disk:

- **FIRST** - no `<docs-path>/awareness/PROJECT-AWARENESS.md`: DISCOVER, the ask below, WRITE.
- **CURRENT** - the doc exists, `node .claude/hooks/docs.js stale` names no `PROJECT-AWARENESS` section, the doc
  holds no `unknown - re-run` line, and the arguments carry no `refresh`: one report line, no ask, on to step 3.
- **UPDATE** - otherwise. This gate first; on 'Refresh', DISCOVER again and ask only the questions whose section
  still says `unknown` or cites a file that changed since the stamp (`git diff --name-only <stamp-sha>..HEAD`). An
  answer the user gave before stands unless the repo now contradicts it or the user changes it.

  ```ask
  The run book exists (captured <branch>@<sha>, <date>) and <the stale sections, the open gaps, or 'you asked for a refresh'>. Refresh it: the repo is re-read and only the open gaps and what moved are asked.
  - 'Refresh the run book (Recommended)' - every earlier answer the repo does not contradict is kept
  - 'Keep it as it is' - nothing is written; the report names what moved
  ```

  No answer, no write - never fall through to the rewrite.

The gaps DISCOVER left open go in ONE AskUserQuestion call, one question per gap (at most four). A question whose
whole answer DISCOVER settled is not asked - its facts go straight into the doc. Each question states what the repo
showed ('nothing' when it showed nothing), and the fuller answer arrives as typed text via Other:

```ask
How is the app started and reached for a manual check? The repo shows: <start commands, URLs, launch profiles - or nothing>. Type a correction or the missing part via Other.
- 'As the repo shows (Recommended)' - the Start and Reach lines are written from <files>, each cited
- 'Unknown for now' - the missing part says unknown; the next capture asks again
```

```ask
How does an agent log in? The repo shows: <a login route, an auth config - or no login>. Never type a password here - via Other, type the login steps, the account's role and WHERE its credentials already live (an env var, a file and key, a vault item).
- 'A test account - name its keys and I add them to the sensitive data (Recommended)' - the report hands one `KEY=` line per key for `<data root>/.sensitive-data`; the doc points at them
- 'No login - the app is open' - the section says so
- 'Unknown for now' - the section says unknown; the next capture asks again
```

```ask
Which flows prove a change works, and which edge cases break? The repo shows: <e2e spec titles, README usage sections - or nothing>. Type flows (steps, then the expected result) and edge cases via Other.
- 'The flows the repo names (Recommended)' - each spec or README flow becomes a numbered flow, cited
- 'Unknown for now' - both sections say unknown; the next capture asks again
```

```ask
What must be up or known before a run, and where does debugging start? The repo shows: <services, env var names, seed commands, launch configs - or nothing>. Type anything a first run trips on via Other (a VPN, a busy port, a feature flag, where the logs go).
- 'As the repo shows (Recommended)' - both sections are written from <files>, each cited
- 'Unknown for now' - the missing parts say unknown; the next capture asks again
```

Then WRITE and the three checks, per the reference.

### 3. RELATED - the sibling repos

Read `references/related-projects.md`. The mode comes from the arguments and disk:

- **Siblings passed** - map them (the reference's run, its mode ask first when dispatch is available).
- **None passed, and `<docs-path>/awareness/RELATED-PROJECTS-AWARENESS.md` exists** - keep it: one report line, no ask.
- **None passed, and no doc** - ask for them as typed text, never options scraped from a filesystem scan (a
  plain-text ask where the harness lacks the tool); the reference's mode question joins this call when dispatch is
  available:

  ```ask
  Does this project depend on sibling repos the capture should map? Type local paths or git URLs via Other, each with an optional relation hint (`../backend provides-to`).
  - 'None - a standalone repo (Recommended)' - the doc records the answer with no entry, so later runs ask nothing; a run with sibling paths adds them
  - 'I will type them via Other' - the run maps the locations you type
  ```

### 4. RULE - one script call

`node "<caps>" --rule` composes `.claude/rules/alfred-awareness.md` from the copy target below - one `@` import per
awareness doc that exists, the related doc only once it holds an entry - compares it, writes it on differs, puts
back the `notOwned` entry in `watch.json`, and removes the rules it supersedes (`alfred-agent-awareness.md`,
`alfred-project-awareness.md`, `alfred-related-context.md`, the 1.x `baseline-project-capabilities.md`) once their
content is imported. A `RULE: FAIL` line is a stack defect: report it as it stands, never hand-write the rule.

COPY TARGET - the script fills the import slot; every `<docs-path>` is the literal docs root:

```markdown
---
description: Project awareness - generated by /capture-awareness; edit via a re-run, not by hand.
---

# Project awareness

Imported below at every session start, from `<docs-path>/awareness/`: what this install carries and how to use it, the run book - follow it before you build, start, log into or hand-check the app - and the related repos. If a file's text is not below, Read it before you act on its area.

<the script's import lines, one per awareness doc>
```

### 5. REPORT

A literal line template, one line per field (a table where a field lists several items):

```text
Agents:      <the script's Doc: line>; Verify: <its Verify: line>
Inventory:   <the script's Inventory: line>; Drift: <its Drift: line>
Project:     <created | refreshed | current | kept> - <docs-path>/awareness/PROJECT-AWARENESS.md, sections <touched, or none>
From repo:   <the files DISCOVER read the facts from, or not run>
Asked:       <each question asked with the answer's label, or none>
Unknown:     <the run-book sections or lines still unknown, or none>
Credentials: <where each account's credentials live, by name only | keys in <data root>/.sensitive-data, ignored: yes | no login>
Value check: <no hit | <n> hit(s) replaced with where the value lives | not run>
Watch:       <the cited file> -> <the sections it names, or not run>
Related:     <created | refreshed | kept | none recorded> - <n> entries, rewritten <names>, kept <names>; first_read <n> of <n> verified; skipped <locations, or none>
Landed:      <git | overlay> - the mode line of `node .claude/hooks/docs.js status`, for each doc this run wrote
Rule:        <the script's RULE: line>
Live from:   next session - the rule is read at session start, so it does not govern this one
Flags:       <one row each, or none>
```

Then the agents reference's prose lines, and - when the capture surfaced work a sibling owns - the task card the
related reference describes. No re-paste of any doc - point to the files. The rule ships only where the project
commits `.claude/rules/` (the installers gitignore `.claude/*` but `.claude/AGENTS.md`), so a fresh clone re-runs
this capture.

## Don't game it

Every fact in the three docs traces to a line the script printed, a file the run read, or the user's own answer: a
gap stays `unknown`, an unreachable sibling stays an UNVERIFIED entry, an unreadable source is reported as
unreadable, and a credential appears only as the place it lives.

## Old installs

`/alfred-code:update` moves an older install into this layout: the run book from `project-awareness/` (or
`project-capabilities/`) with its section ids and branch versions, the sibling doc from
`related-projects/RELATED-PROJECTS.md`, the inventory rule's body into `AGENTS-AWARENESS.md`, and it writes the rule.
When a doc still sits at an old home, name `/alfred-code:update` in the report rather than moving it by hand.
