---
description: "FAST refresh of an existing Alfred Code install to the newest release - no selection questions (it asks only when the release adds an item this install would not otherwise carry, or a root, the instruction file or the projects joined below need a decision): every installed item and stack plugin moves to the release's own content and pins, and what the stack itself retired or renamed upstream since the stamp is pruned - computed from the stamp compare and meta/migrations.json, never guessed, the MCP servers an earlier release registered included, each with its add-back line; user-authored artifacts and the generated rules are never touched, and one confirmation comes before any migration removal. NOT for choosing items to add or drop - that is /alfred-code:configure; not a first install - that is /alfred-code:init."
disable-model-invocation: true
---

# Update Alfred Code - refresh everything, prune what upstream removed

## 0. Where to run it

**The model gate comes first - before any tool call and before reading further.** This walk is script
orchestration, not reasoning - a stamp compare, an installer invocation, a grep over its log. It runs identically on
the cheap tier and costs about a THIRD as much there (measured: the same scripted walk in the same project cost 3x on
`opus[1m]` as on sonnet). A frontmatter `model:` key CAN pin a skill's run to a tier (the Claude Code skills
frontmatter reference lists `model` and `effort` beside `allowed-tools`), and this command deliberately carries none:
a pin every install inherits is a behaviour change that ships with its own evidence, and `/model` is the USER's
command. So on an expensive tier when a cheap one is available, step 0 is a STOP, not an ask: the opening line is the
whole turn - 'this walk is scripted: `/model sonnet`, then `/alfred-code:update` again, runs it for about a third;
`/alfred-code:update` again on this model runs it here' - and the turn ends before the snapshot is resolved (audit
2026-10-11, session 37d7a42c: the run went on on Opus after the hint, 245.9k cache-read and 83.1k cache-write over 3
messages, and the user interrupted it and ran it again on Sonnet). **When the gate stops the run, that line is the
turn: no tool call, nothing below is read or summarised, and the turn ends on it.** A second `/alfred-code:update` in
this session goes ahead on whatever tier it finds, with no line. An unattended launch picks its model up front and
has nobody to switch it: on the expensive tier make the first call `printf 'unattended=%s\n'
"${ALFRED_CODE_UNATTENDED:-}"`, and on `unattended=1` log `unattended: tier -> run here` and go on instead of stopping.

**This run needs NO conversation context**, so it is the cheapest thing in the stack to move -
but only out of a session that is actually loaded, and the measuring is the hook's, never yours.
`guard-fresh-session-start.js` reads this session's per-message context against its tier's trigger (and
whether a guided run already ran in this session) and, when a move pays, injects a note into this very
turn that quotes the figure and says 'Do NOT start the run yet'. With that note, step 0 is its ask.
Without it, step 0 does not exist: never measure, never mention it - no 'step 0 skipped', no 'fresh
session', no 'context is low, proceeding' - the first line you write is step 1's (audit 2026-10-11,
session bca100bd: 'Step 0 skipped (fresh session)' on the first message of a fresh session, the line
this clause forbids). Where the stack's hooks stand down (a legacy install before its first stamp,
`hook_profile: minimal`) no note comes, and the walk runs here.

When the note comes, put the choice through AskUserQuestion - run here anyway vs run in a fresh
session (recommended). One ordering rule for every ask in this run: **never lead with an option
the harness has already refused.** Once an installer invocation has come back denied, the
recommended answer becomes 'you run it yourself' with the command to paste, and the settings rule
that would pre-authorize it named beside it. State the figure the note quotes and the walk's own
cost beside it: this body plus its own tool output, measured at ~15-17k tokens of tool results in two audited runs
(audit 2026-10-20 C15, 24841a36 and e43969a7) - every one of its messages re-sends whatever this session already
carries on top. Never quote a figure measured in another session for the carry.

| answer | next action |
|---|---|
| fresh session | give the paste-ready one-liner, end the turn, run nothing |
| run here | go to step 1 now |
| not now | say what is owed and end the turn - do not download |

If the user redirects mid-answer and this ask is displaced, re-offer it ONCE when the redirect
is handled, then proceed on their answer.

**House voice in every line this run emits** - narration, tables and the asks alike: single
dashes, never em-dashes, and single quotes in prose. A fresh or refreshed install may have no
`.claude/rules/alfred-interaction.md` loaded at all, so this command's own text is the only place
the voice can come from.

**THE PLUGIN CACHE IS THE SNAPSHOT - the common run downloads nothing** - the shared contract lives at
`${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md`; read it first, in ONE Bash `cat`, and hold the whole run to
it: resolve the snapshot once into `$TMP/repo` - copied from the newest valid plugin-cache entry, downloaded only when there is none, use every tool from that snapshot, hand it back
with `--source` in the install step, and remove `$TMP` on EVERY exit path (fast, slow, blocker,
or a user 'no'). The protocol's 'Narrate, don't trace' section governs every tool call: quiet
machinery, no pasted output, one narration line between steps.

**Budget the CALLS, not the characters.** Every message re-sends the whole carried session (one audited run read 11.1k
of file content and cost 886.8k), so an extra grep is another full context re-send - fold reads together, and never
read a file or output the steps do not name.

## The run - a router; each step's rules ride a call the run makes anyway

This body holds only the gate and the order of calls. The steps live in two references, each read in the SAME Bash
call as a command the run makes anyway, so a refused run carries none of them and a run that goes ahead pays no extra
call (audit 2026-10-20 C15: a refused run carried the whole 36.5k-char walk, ~9k tokens, on every later message):

1. **The protocol** - `source-protocol.md` in ONE Bash `cat`, then resolve `$TMP/repo` per it.
2. **Preconditions, and the walk** - ONE call: `node "$TMP/repo/scripts/install/stamp.js" state . ; cat
   "${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/update-walk.md"`. Act on the word per the walk's step 1; the walk
   holds steps 1-3 and the Do-not list.
3. **The delta** - the walk's step 2: ONE preflight call, then its asks (new items, the data root, the docs root, the instruction
   file's name, whether the projects joined below update too) before the installer runs. A non-empty prune list takes `update-slow-path.md`'s steps 4-5.
4. **The refresh** - step 3's installer call (10-minute timeout, exit code read), then its ONE post-install grep. The
   installer also moves an older project's folders onto the current layout, with no ask (`layout:` lines).
5. **The restart verdict, and the close** - ONE call: step 3's `--log` call with `; cat
   "${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/update-close.md"` appended. The close holds steps 6-8.
6. **AGENTS.md** - step 6's check, the skill read, the re-spell plan and its one ask.
7. **The post-check** - step 7's report, its one hygiene call, and the suggestion card.
8. **Clean up `$TMP`** - step 8, on EVERY exit path; a blocker or a user 'no' before the close was read removes it
   per the protocol.
