# Report fields - what each receipt line means

Read at REPORT, before writing the close. Every field is UNCONDITIONAL: a named field is what makes its step
actually run, and the record that nothing was silently trimmed. One line per field; a table where a field lists
several items - the close is an answer like any other and the answer-length hook blocks a wall of prose (tables
are exempt), so the receipts must survive that cap rather than be re-answered away.

## The confirmation block

- **Files written** - created vs refreshed, sections touched; the awareness rule created/refreshed.
- **Gather rounds** - rounds used and whether the picture settled within the 3-round cap.
- **Structure headline** - one line: project type + architecture style.
- **Unverified** - anything unverified and what would settle it.

## The receipt lines

| Field | Content | The step it proves |
|---|---|---|
| `Vocabulary:` | the skills step 3 actually loaded, or `none - <role> absent, read the code` | the vocabulary load |
| `References:` | which of this skill's `references/` files this run actually Read (`hazards.md`, `doc-shapes.md`, `vocabulary-roles.md`, `report-fields.md`) | the contract reads |
| `Write gate:` | the answer to the pre-write AskUserQuestion, verbatim - or the reason the run skipped the ask (`first capture - no doc to replace`, `zero drift - nothing written`) | the ask before the first byte |
| `Write passes:` | what step 5's precondition allows: `ARCHITECTURE.md 1` on a clean run, `2` where the budget spill fired, `1 (overlay, N sections)` on the overlay route where the doc is written section by section through `docs.js set`, and the honest number plus one line on what was still being verified where a third pass happened - plus the `docs.js status` line quoted right after the first write, the proof no code-claim probe ran later | the verification-first precondition |
| `Rule:` | the awareness rule's measured byte count from `wc -c` | the 300-byte budget check |
| `Model:` | see below | the run-start model check |

## The `Model:` line

It states what the session is on NOW and what the USER should do about it - never a claim about how it got
there, and never an assertion that a reset happened. You cannot change it yourself: `/model` is a user command
with no assistant-invokable equivalent, so the line ends in the exact command to paste. Three shapes, pick the
true one:

- `raised for this run - run /model <the model this session was on before> to drop back`
- `already on Opus before this run started - nothing to reset` - allowed only when you can point at the message
  that proves it, since a new-session default says nothing about a session already running
- `not on Opus - the judgment above ran on <model>`

## The RESUME BLOCK

When the user asks for a follow-up prompt or the run hands work to a later session, shape it as a RESUME BLOCK -
the exact invocation to paste, the docs to read first, one line on what the next run does - the same paste-ready
format the loop skills end on.

## What the docs are for

The docs follow the docs root - machine-local by default, re-captured after a fresh clone, never assumed to be
in git. The map is what the domain solution-designers read to judge where a change fits, what the cross-task
orchestrator reads to pick a cross-domain run, and what the cross-domain seam interface is designed against. No
re-paste of the doc bodies in the report - point to the files.
