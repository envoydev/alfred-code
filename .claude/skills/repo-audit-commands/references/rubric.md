# Command audit - Phase 1 rubric

Read at Phase 1. Every point awarded or deducted cites the line that justifies it.

Score each command on four weighted dimensions, 100 points total. Then map the total to a grade using the band
table, applying the dimension floors. A manifest entry with inline `content` is scored as a file would be, its
manifest fields standing in for frontmatter.

## Dimension 1 - Menu line and invocation (30 pts)

What a user sees in the `/` menu and types is the whole interface before the command runs.

- The description says what the command does and when to run it, the key use first, as one line a person scanning
  the menu understands without opening the file. It names the outcome ('Install the servers that are not installed
  yet'), not the mechanism ('Runs the inventory script'). The harness cuts a listing entry at 1,536 characters;
  where the repo's `checks` hold a tighter cap, quote it and score against it. A missing description falls back to
  the body's first line, which is rarely a menu line. (9)
- The name is a verb or verb phrase for the one thing the command does, short, lower case with hyphens, and
  consistent with its siblings: one verb means one thing across the set. A namespace, where used, groups commands a
  user would look for together. A weak name is scored here and reported as a candidate - never renamed. (6)
- `argument-hint` shows exactly what the body reads, in the order it reads it, with optional parts in brackets;
  absent only when the command takes nothing. A hint the body ignores, or an argument the body reads that the hint
  never shows, loses the points. (7)
- Invocation control matches what the command does: `disable-model-invocation: true` on a command that writes,
  installs, publishes, deletes or spends; left open only where a model-started run is harmless and wanted - and
  then the description is judged as a trigger too, 'Use when' first. `user-invocable: false` on a file under a
  commands folder is a contradiction. (5)
- No collision: no skill or command of the same typed name, and no sibling a person cannot tell apart from the
  menu line alone. (3)

Floor for A: >= 26/30.

## Dimension 2 - Arguments, instructions and safety (30 pts)

- Arguments are read on purpose: the body uses the whole string or positions or named arguments, not a mix that
  double-reads; positions are counted from zero; it says what happens with none (ask, list the choices, or a
  stated default), with too many, and with a value that fails its check - before anything is written with it. (7)
- Instructions are imperative and ordered. Steps that must happen in sequence are numbered; a fragile step gives
  the exact command and no alternative; rules carry their reason; one term per concept throughout. Asks go through
  the AskUserQuestion tool with concrete options, or the single-line typed-value form the body states. (6)
- Side effects are gated. The first write the invocation did not spell out is preceded by a step that shows what
  will change and asks, once for the whole plan. Nothing is applied on a failed check, and a partial apply says
  what was and was not done. (6)
- Execution is least-privilege and safe. `allowed-tools` lists the exact calls the body makes - a script through
  its interpreter with an arguments pattern - never a bare shell or a wildcard over everything. No argument reaches
  a shell line unquoted, and none is pasted into a pre-run shell line. Pre-run shell lines only read, finish fast
  and bound their output. Shipped files are reached through the plugin root or the command's own folder variable;
  nothing is written under the plugin root. No secret is asked for, printed or written into the conversation. (7)
- The end is defined. The command names what it prints last - a result table, the files changed, the next command
  to type - and the check that proves it worked, with its result line, never the claim alone. (4)

Floor for A: >= 26/30.

## Dimension 3 - Load and run cost (20 pts)

- The body earns its length. All of it enters context on every invocation and stays for the session, and after a
  compaction only the first 5,000 tokens of each invoked entry come back, under a budget shared by all of them -
  so the rules a long run needs sit near the top. No restated rule, no filler, no section the run never reads. (7)
- Deterministic work is in scripts. Parsing, listing, diffing against a catalog, writing a config - a script does
  it and prints what the model needs, instead of prose the model re-derives each run. A script's code never enters
  context; its output does, so that output is shaped and bounded. (6)
- What is injected is bounded. A pre-run shell line or a file reference pulls in only what the run needs: a status
  summary, not a full diff; a named file, not a folder. (4)
- The always-on cost is deliberate. A command the model cannot start costs every session nothing; one it can start
  pays for its description on every message, so that description is as short as its trigger allows. `model` and
  `effort`, where set, fit the work - a lookup does not pin the largest model. (3)

Floor for A: >= 17/20.

## Dimension 4 - Fit and set coherence (20 pts)

Scored against the maps from Phase 0. A command loses points here for what the set shows, even when the file
reads well alone.

- Shipped and reachable. The file is one the manifest or the default folder scan loads; no folder is silently
  ignored because the manifest sets the key; every script, file, command, skill, agent, server and setting the
  body names resolves. A blocked edge - the model told to run a manual-only entry - is a defect. (6)
- The right form. The work fits a flat command: one file, typed by the user, no bundled references. A command that
  cites files it cannot ship beside itself, repeats a block four siblings also carry, or should load on its own is
  a candidate for a skill folder - reported with what the move changes, never converted here. (5)
- No unmanaged duplication. A block that repeats across commands lives in one script or one shared file, or each
  copy is registered in the repo's multi-home registry and pinned by a marker. (5)
- The set reads as one product. Commands that are steps of one job name each other to the user as the next step;
  the verbs, the hint style and the shape of the closing report match across the set; none contradicts another
  about who owns a file or a setting. (4)

Floor for A: >= 17/20.

## Grade bands

| Total | Grade | Numeric |
|-------|-------|---------|
| 90-100 and all floors met | A | 9 |
| 80-89 | B | 7-8 |
| 65-79 | C | 5-6 |
| 50-64 | D | 3-4 |
| < 50 | F | 1-2 |

Where a band gives two numerics, the upper half of its totals takes the higher: 85-89 is 8 and 80-84 is 7, 72-79 is 6 and 65-71 is 5, 57-64 is 4 and 50-56 is 3, 25-49 is 2 and under 25 is 1. A report prints the numeric beside the letter, and a mean is taken over the numerics.

A command reaches A / 9 only when the total is >= 90 and every dimension clears its floor: a command with a
careful body and a menu line nobody understands is not an A command, because nobody runs it; one with a perfect
menu line that applies changes unasked is not one either.

Blocked from A whatever the total: a command that shares its typed name with a skill or another command, a
command the manifest never loads, an ungated destructive or outward side effect, and an unresolved DRIFTED finding
from Phase 1b.
