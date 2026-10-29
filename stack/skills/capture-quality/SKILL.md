---
name: capture-quality
description: "Use when asked about test coverage, or to assess how good the code or architecture is - deliberate only. Not for fixes or writing tests (the quality loops)."
---

# Quality - the architecture, the code and the test coverage, judged

Three deliberate captures share this skill. Each part is a reference the run reads and follows; the first word picks
one part, and the typed command with no topic word runs all three behind one ask.

| Part | Topic words | Writes | Seats |
|---|---|---|---|
| architecture-quality | `architecture-quality`, `architecture` | `<docs-path>/quality/ARCHITECTURE-ASSESSMENT.md` | architecture-analyzer |
| code-quality | `code-quality`, `code` | `<docs-path>/quality/CODE-ASSESSMENT.md` | code-quality-analyzer |
| test-coverage-quality | `test-coverage-quality`, `test-coverage`, `coverage` | `<docs-path>/quality/COVERAGE-QUALITY.md`, `<docs-path>/quality/coverage-raw/` | test-coverage-analyzer |

## When to use

- A topic word picks one part: `/capture-quality coverage src/api`, `/capture-quality code`,
  `/capture-quality architecture`.
- The chain of all three runs only on the typed `/capture-quality` with no topic word, or a request that asks in words
  for all the quality captures. A description match runs the one part the request names.
- The chain asks first - one call, one question per part plus the mode - and no part asks its run gate again.
- Not for fixing the findings or raising coverage (the quality loops: `/loop-architecture-quality`,
  `/loop-code-quality`, `/loop-test-coverage-quality`), building the architecture map (capture-architecture), recording
  the code style, a security audit (the security-auditor seat) or one diff (task-verify-code, review-code). Each part's
  own `## When to use` names the rest of its boundary.
- A part's run gate is there because a conversational question - 'what are the risks here?', 'is this code any
  good?', 'what is our coverage?' - can match this skill: no seats, instrumented suite or doc rewrite start on a
  description match without its answer.

**Modes.** Mode flags right after the command - `--mode-auto-run-on`, `--mode-auto-run-off`, `--mode-output-scorer-on`, `--mode-output-scorer-off` - are switches, not the request: strip them; with only flags typed, run as with no arguments. Under the hook's auto-run contract, follow it. With no hook line (hooks off, Cursor), `-on` holds for this run only: each stop takes its `(Recommended)` option, listed in the close, an unmarked one waits, nothing goes outward, no fresh-session hand-off, and the close says auto-run ended; `--mode-output-scorer-on` grades this run's output like a typed stack.

## 1. The topic word

Read the arguments in this order.

1. Strip the mode flags (`--mode-auto-run-on`, `--mode-auto-run-off`, `--mode-output-scorer-on`,
   `--mode-output-scorer-off`).
2. Take the first remaining word, compared whole and case-insensitively against the table's topic words. A word
   holding `/`, `\` or `.` never matches, because it is a path.
3. A match picks that part. A mode word next (section 4) marks a calling flow; every word after it is the part's own
   arguments - the scope or target the part reads.
4. No match: who started the load decides.
   - The user's message is the typed `/capture-quality` command, or asks in words for all the quality captures: the
     chain runs (section 3), and every remaining word is the target handed to each part it runs.
   - Otherwise the model loaded the skill on a request (a description match). The part is the one the request names,
     matched against the table's Writes and topic words ('what is our coverage?' names the coverage part). When it
     names none, or more than one, ONE single-select question picks the part, the part closest to the request's words
     first and Recommended. The chain never runs on a description match, because three full runs are never what one
     question asked for.
   - On a description match the remaining words are a target only when they name a path that exists. Otherwise there is
     no target, so 'test coverage' never becomes a scope.

   The part's own run gate still applies on a description match, because no calling flow started it (section 4).

| Arguments | Result |
|---|---|
| `coverage` | the coverage part, no target |
| `Coverage src/api` | the coverage part, target `src/api` |
| `coverage/` | the chain, target `coverage/` |
| `coverages` | the chain, target `coverages` |
| `--mode-auto-run-on code` | the code part, with auto-run on |
| empty, or flags only, the user's message the typed command | the chain, no target |
| empty, a description match on 'what is our test coverage?' | the coverage part, no target, its run gate asked |
| `test coverage`, a description match on 'how is our test coverage?' | the coverage part, no target (no path named `test`) |
| empty, a description match on 'how good is this code?' | ONE question: code-quality (Recommended), architecture-quality, test-coverage-quality |

The part pick, when a description match names none of the parts or more than one - the other two in table order:

```ask
Which quality capture should run? The request names none of the three parts, or more than one.
- '<the part closest to the request's words> (Recommended)' - its Writes or topic words come nearest the request
- '<the next part in table order>' - writes <its doc>
- '<the last part in table order>' - writes <its doc>
```

## 2. One part

The part runs alone, with its target, by its own reference - its run gate, mode ask, steps and REPORT as written there:

- architecture-quality: read `references/architecture-quality.md` and follow it.
- code-quality: read `references/code-quality.md` and follow it.
- test-coverage-quality: read `references/test-coverage-quality.md` and follow it.

## 3. The chain

With no topic word on the typed command, ask once, then run the chosen parts in table order.

1. The state script. It has TWO homes - this skill's copy under `.claude/skills/`, or the stack's plugin cache, where
   the newest version is taken - so resolve and run it in one block from the project root:

   ```bash
   QS=.claude/skills/capture-quality/scripts/quality-state.js
   [ -f "$QS" ] || QS=$(for d in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/*/*; do   # one glob: zsh aborts the loop when any named glob matches nothing
     PN=${d%/*}; PN=${PN##*/}; [ "$PN" = alfred-code ] || continue
     f="$d/stack/skills/capture-quality/scripts/quality-state.js"
     [ -f "$f" ] && [ ! -e "$d/.orphaned_at" ] && printf '%s\t%s\n' "$(basename "$d")" "$f"
   done 2>/dev/null | sort -V | tail -1 | cut -f2)
   if [ -n "$QS" ]; then node "$QS"; else echo "quality-state: absent"; fi
   ```

   It prints one line per part - `absent`, `unstamped`, `current <branch>@<sha>` or `stale <branch>@<sha> (<why>)`.
   `quality-state: absent` means neither home has it: say so, and read each part as `absent` where its doc is missing
   and `stale (state unknown)` where it exists - never compare stamps to git by hand.
2. Put ONE AskUserQuestion call:
   - one question per part, single-select, filled from the template below that matches its state line;
   - a fourth question, the mode template, only when dispatch is available. With no dispatch every part runs INLINE
     and the question is not asked.

   The answer is each part's run gate and mode answer: no part asks either again.
3. Run each part whose answer is not 'Skip it' by reading its reference and following it, in table order, with the
   chain's target and mode.
4. Close with one line per part (section 5).

No part recommends a skip. The two assessments keep no zero-drift shortcut, because a changed rule, an accepted
decision or a shipped fix changes the answer even when the code did not; the coverage part's own update gate
recommends the re-measure and keeps its report-only answer.

For `absent` or `unstamped`, any part:

```ask
Run the <part> capture? <DOC> does not exist yet.
- 'Run it (Recommended)' - the part's first run; it writes <DOC>
- 'Skip it' - nothing runs for <part>
```

For `stale`, the two assessments:

```ask
<DOC> is stale (<why>). Refresh it?
- 'Refresh it (Recommended)' - the part's full run; <DOC> is replaced
- 'Skip it' - <DOC> stays as it is
```

For `current`, the code-quality part:

```ask
CODE-ASSESSMENT.md is current at this HEAD. Run it again?
- 'Run it again (Recommended)' - a changed rule, decision or shipped fix still changes the answer when the code did not
- 'Skip it' - CODE-ASSESSMENT.md stays as it is
```

For `stale` or `current`, the coverage part - its own update gate, with its report-only answer kept:

```ask
COVERAGE-QUALITY.md is <stale (<why>)|current at this HEAD>. Re-measure every surface and reconcile it?
- 'Re-measure and reconcile (Recommended)' - each surface's suite runs once, its raw files are replaced
- 'Report from the existing COVERAGE-QUALITY.md only' - nothing runs, nothing is written; the close reports from the doc
- 'Skip it' - nothing runs for test-coverage-quality
```

For `current`, the architecture part:

```ask
ARCHITECTURE-ASSESSMENT.md is current at this HEAD. Verify and rewrite it, run it in full, or skip it?
- 'Verify and rewrite at this HEAD (Recommended)' - every recorded entry re-measured, the accepted decisions folded in, one whole-file Write
- 'Run it in full' - a fresh judgment, seats as picked in the mode question
- 'Skip it' - ARCHITECTURE-ASSESSMENT.md stays as it is
```

The mode question:

```ask
Run the chosen parts through their analyzer seats or in this session?
- 'Through the seats (Recommended)' - the cheap seats absorb the reads; the judgment and the writes stay here
- 'In this session' - navigation-tools-first and bounded, no dispatch
```

- The architecture part's verify-and-rewrite path dispatches nothing, so it runs in this session whatever the mode
  answer.
- 'Refresh it' and 'Run it again' are each part's full run - for the coverage part, its UPDATE path.
- A chain that picks the coverage part with no coverage doc asks that part's first-capture questions (the % bar, the
  exclusions) in ONE more AskUserQuestion call, right after the chain ask and before any part runs - never deferred to
  the middle of the run.
- The mode answer reaches the coverage part only on a first capture: its update analysis is INLINE by its own rule.
- Under auto-run (the hook's contract, or `--mode-auto-run-on` with no hook line), each question takes its Recommended
  option.
- The chain is one skill load. The parts are read, not re-invoked: no fresh-session gate fires between parts.

## 4. Callers

- A calling flow hands `<topic> <DELEGATED|INLINE> <target>`. A mode word right after the topic marks a run a flow
  started: it skips the part's run gate and mode ask, and inherits the mode.
- A person may type the same form, and has then chosen.
- The calls: `loop-architecture-quality` hands `architecture-quality <mode> <target>` after its map capture,
  `loop-code-quality` hands `code-quality <mode> <target>`, and `loop-test-coverage-quality` hands
  `test-coverage-quality <mode> <target>`.

## 5. The close

One part: its REPORT, as its reference writes it. The chain: one line per part in table order, then each part's REPORT
below it.

```text
architecture-quality: ran - <its REPORT block's first line> | skipped | stopped - <why>
code-quality: ran - <...> | skipped | stopped - <why>
test-coverage-quality: ran - <...> | skipped | stopped - <why>
```
