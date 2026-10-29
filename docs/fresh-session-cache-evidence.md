# Cache-aware fresh-session offers - evidence

The measurements behind the cache-aware verdict (`stack/hooks/fresh-session.js` `freshVerdict`, the design of
2026-10-28). They answer the user's report that Alfred Code offered a fresh session near 100k with the prompt cache
warm. Each was read from one machine's Claude Code transcripts over 21 days, in the projects that run the stack: 212
main sessions on Claude Code 2.1.292 to 2.1.311. Counts only - no project names, paths or session ids.

## Outside facts (verified 2026-10-28)

- TTL: 5m by default, 1h on request, reset by each hit. Claude Code gives the main conversation 1h on a subscription
  within plan usage and 5m on usage credits, an API key or a cloud provider (code.claude.com/docs/en/prompt-caching,
  'Which TTL each request gets'). The same page documents `idleCompaction`: Claude Code can compact a long idle
  conversation on the 1h TTL.
- Prices against the base input price: a 5m write 1.25x, a 1h write 2x, a read 0.1x - but 0.05x on Opus 5.5 and
  Sonnet 5.5, and 0.025x on Fable 5.1 and Mythos 5.1 (platform.claude.com/docs/en/build-with-claude/prompt-caching,
  pricing and footnotes; the same figures sit in `meta/model-prices.json`).
- Plan usage draws a cached re-read 'at the cached token rate' (code.claude.com/docs/en/costs). How it weights a 1h
  write is not documented.
- A compaction keeps the system prompt and project context cached, and 'the turn after compaction rebuilds the
  conversation cache for only the much shorter summary' (code.claude.com/docs/en/prompt-caching, 'Compacting the
  conversation'). Sequential sessions share a cached prefix only when the startup git snapshot matches ('Cache scope').
- A UserPromptSubmit hook that blocks 'blocks the prompt, so it never reaches Claude', while `additionalContext` rides
  alongside a prompt that is processed (code.claude.com/docs/en/hooks).

## What a session carried, and what a fresh one cost

- Every main-session cache write used the 1h TTL: 162,893 messages, none 5m.
- The sessions ran claude-opus-5-5 (174) and claude-sonnet-5-5 (38), where a cached read costs 0.05x.
- A fresh session's floor (its first message): median 79k, p10 56k, p90 90k; a median 35% of it read from cache, so
  about 65% is a new 2x write.
- Messages per session: median 223, p25 80, p75 368.
- Fresh-session suggestions inside an ask: 424, 50 of them under 130k (70k, 80k, 83k, 100k, 103k, 108k, 126k among
  them). They came from skill templates that marked the fresh option with no size test (task-solve's new-cycle and
  compaction stops, its AUTO start after a closed cycle, the quality loops' round asks), from the chained route, from
  the post-compaction hold (17 holds, median 123k) and from check 10's demand after a finished cycle. The size gate (31
  blocks, min 150k, median 403k) and the finished-turn offer (80, min 147k, median 411k) never fired under 147k.
- Every one priced the carry at the full input rate ('every turn re-sends all of it'): 20x too high for a warm re-read
  on Opus 5.5 and Sonnet 5.5.

Method: each main-session transcript (no sidechain row, no `<synthetic>` model) was read whole. The TTL is which of
`cache_creation.ephemeral_1h_input_tokens` and `ephemeral_5m_input_tokens` is non-zero on each assistant row that
wrote the cache. The model is the session's assistant rows' `model`. The floor is the first main-session assistant
row with a usage, its size the sum of `input_tokens`, `cache_creation_input_tokens` and `cache_read_input_tokens`, its
cached share the read over that sum. An ask counts when an AskUserQuestion option names a fresh or new session; its
carry is the newest assistant usage before it. The gate figures are the hook-blocks ledgers' rows for those branches.

## The floor read

The old `coldFloor()` read only the transcript's first 512KB and took its first line naming 'assistant'. It found no
floor in 93 of the 212 sessions: Claude Code 2.1.292 to 2.1.311 writes the instructions and request rows first, which
puts the first reply between 511KB and 1,159KB into the file. With no floor, the old rule answered yes, so in those
sessions the chained route (a second typed command) offered a fresh session at any carry. The new read - forward in
512KB chunks to 8MB, a row that straddles a chunk read whole, the first main-session assistant row with a usage -
finds the floor in all 212, and agrees with the old value in all 119 where both find one.

Method: both readers ran over each transcript, and the first reply's byte offset was recorded.

## The verdict at the median floor

With G = F + R the fresh session's carry (R below), r the read rate, w the write rate and P the payback window, a
fresh session pays when ctx > G and G x (w - r) < P x (ctx - G) x r. On claude-opus-5-5 or claude-sonnet-5-5 with
the 1h TTL, F 79k and P 30:

| Carry | Pays back after | Pays |
|---|---|---|
| 100k | 449 messages | no |
| 200k | 34 messages | no |
| 211,600 | 30 messages (equal) | no |
| 211,601 | 30 messages | yes |
| 250k | 23 messages | yes |
| 400k | 12 messages | yes |

Pricing the floor at this session's own cached share (a median 35%) instead of a full write would allow 34 of the 212
sessions an offer under 100k - the suggestion the user asked to stop. The full write allows none.

## The replay

Each session was replayed with its own floor and model. The old 40% rule (carry minus floor at least 40% of the carry,
a point of 1.67 x F) allowed an offer from a median 132k: 37 sessions under 100k and 99 under 130k where it read the
floor, and the 93 unread sessions at any carry on the chained route. The verdict at P 30 allows none under 130k: its
p10 point is 159k, its median 213k, and no session's point moves earlier.

Method: for each session, the carry at which each rule first allows an offer, from its floor, its model's read rate
and the 1h write rate every session used.

## A7 - the payback window P

P is how many more messages the work runs after the offer. 139 of the 212 sessions reached their own P 30 point. They
then ran p10 25, p25 78 and a median 138 more messages before they ended or compacted, and 17 of them (12%) ran fewer
than 30. So an offer made at that point pays back in 88% of the sessions that reach it. A larger P offers earlier and
pays back less often. The measurement starts at the P 30 point itself, so it holds for that choice only.

Method: for each session whose carry passed its own P 30 point (R included), the main-session assistant messages after
the first one past it, counted until the session ended or its first compaction. Re-run over a later 21 days, a share
over 20% running fewer than 30 reopens the design.

## A8 - what a resumed session re-reads (R)

A resumed session re-reads what the old one already holds: its resume block, the plan or findings file and the files
its next step needs. R is 13,000 tokens (`RESUME_READ`): the median growth of a session's carry over its first 10
messages, over the 201 sessions of 20 or more messages (p75 19k). It holds the first new work too, which both sessions
would do, so it over-states the re-read - the direction of fewer offers.

Method: for each session of 20 or more main-session assistant messages, the carry at its tenth message minus the carry
at its first. The re-run that checks A7 also takes the same growth over the sessions whose first typed prompt is a
resume (a `task-*`, `issue-*` or `loop-*` command naming a plan, findings or ledger file, or a pasted resume block); a
median under 8k or over 20k reopens R.

## Idle compaction (2026-10-30)

Claude Code's idle compaction (`idleCompaction`, on by default) compacts a session about an hour after the last reply,
before the prompt cache expires, once its context is at or over `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` (default
200,000, a value under 100,000 raised to it - <https://code.claude.com/docs/en/env-vars>). It is no context limit, so
it must not lower the fresh-session trigger. Measured:

- Row order, a 2026-10-23 transcript of this repo: the `compact_boundary` row at 11:34:14.160 (`trigger: auto`,
  `preTokens` 212,239, `durationMs` 49,233), the compact start's hook rows at 14.795-14.796, the notice
  (`system` / `informational`, 'Compacted while idle, before the prompt cache expired ...') at 14.804 - after the
  hooks, so a hook judges by timing and a later read confirms from the notice. The stack wires no PostCompact hook.
- The user's 56 idle compactions came 54.5-55.0 min after the last assistant row, at `preTokens` 212k-361k; seven in
  this repo started 53.5-53.9 min after it.
- On seven idle compactions, the boundary's `preTokens` ran 1,069-4,999 over the last reply's input-side usage (what
  PreCompact can count), so the hold that keeps a point out of the trigger is the 50-minute gap alone, never the floor.
- Transcripts here reach 214 MB; over the twelve largest (17-214 MB) no row sat more than 14.5 min behind the newest
  row before it, which sets the window read's 20-minute slack.
- One of 26 idle compactions had a local command (`/reload-plugins`) between the last reply and the boundary: a local
  command makes no model call, so it does not end the idle gap.
