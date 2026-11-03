# Stop done-close regex v2 (2026-11-03)

The stop judge is held (the user's ruling of 2026-11-03: 'hold judge, keep regex'), so the regex reading of the
done-close in `stack/hooks/guard-stop-contract.js` was retuned instead: cover more cases, at or above the judge's 14 to
16 of 18, no regression, and a reply in another language read on language-neutral signals only, with no non-English text
in plugin code. What changed is THE RETUNE in `.claude/rules/repo-hooks.md`; this file holds the method and the counts.

## Method

- **Corpus.** Read-only from the Claude Code transcripts of five projects on the maintainer's machine: 3,482
  turn-ending main-session closes (an assistant message with text and no tool call) over 256 sessions. The live hook
  had held 157 of them as a done-close and 44 as a prose ask, and passed 3,281. The text stays in a private scratch
  folder; none of it is in this repo, and this file gives counts only.
- **Labels.** Hold or release by the judge's own criteria (`stack/hooks/stop-judge-prompt.txt`), read by one reader -
  the retune's author, not the user. The 18 replayed closes the Haiku judge scored 14 to 16 on keep their labels. A
  seeded, stratified sample of 80 more: 26 live holds, 26 closes the live hook passed but a text-only replay of the old
  reading holds, 16 clean passes carrying a done word, and 12 in another language. 4 were marked unsure and left out:
  94 labelled closes.
- **Scorer.** The hook runs in-process through `shell-guards.js runGuard` (the runner `hook-inprocess.js` uses), one
  Stop payload per close: `last_assistant_message`, and the replay rows' recorded `stop_hook_active` and
  `background_tasks`, with no `transcript_path`. No transcript-backed exemption can fire there - an ask answered this
  turn, a fresh-session pick, an answer to a read-only question, live work read from the transcript - so every count
  below is a text-only reading, stricter than production.
- **Baseline.** `develop` at ac1777a3, frozen before the first edit.
- **Population check.** The same replay over all 3,482 closes, the two verdicts diffed: 24 of the released closes,
  drawn at random, and every newly held one read by hand.
- **Tests.** Each pattern has a synthetic fixture in `scripts/guard-stop-closes.test.js` ('retune 3.7.1'); each of the
  four tests fails on the baseline hook and passes on v2. Text in another language is built from code points
  (`scripts/hook-test-env.js foreignWords`), so no non-English word sits in the source.

## The 18 replayed closes

| | Baseline | v2 |
|---|---|---|
| Right | 6 | 18 |
| Holds right | 5 | 5 |
| Releases right | 1 | 13 |
| Wrong holds | 12 | 0 |
| Misses | 0 | 0 |

The earlier replay counted 13 wrong holds; one of them, a close in another language, already passed after the
English-only ruling of 2026-10-16. The retune read these 18 while it was built, so 18 of 18 is in-sample; the
population check below is the out-of-sample reading.

## The 94 labelled closes

| Group | Labelled | Right, baseline | Right, v2 | Wrong holds / misses, baseline | Wrong holds / misses, v2 |
|---|---|---|---|---|---|
| Replayed | 18 | 6 | 18 | 12 / 0 | 0 / 0 |
| Live holds | 24 | 14 | 22 | 9 / 1 | 1 / 1 |
| Live passes the old replay holds | 25 | 7 | 21 | 18 / 0 | 4 / 0 |
| Clean passes with a done word | 15 | 15 | 15 | 0 / 0 | 0 / 0 |
| Another language | 12 | 10 | 11 | 0 / 2 | 0 / 1 |
| All | 94 | 52 | 87 | 39 / 3 | 5 / 2 |

All 94 as a confusion table:

| | Baseline | v2 |
|---|---|---|
| Holds right | 17 | 18 |
| Releases right | 35 | 69 |
| Wrong holds | 39 | 5 |
| Misses | 3 | 2 |

The 5 wrong holds left: 3 answers to the user's own question, which the informational-answer exemption can pass only
with the transcript in hand; 1 hand-off of the user's own fix after a real push, which the pinned rule that a when /
once condition still hands back (re-verify 4 R4-M3) keeps held; 1 future approval named beside running seats, which the
rule that a hand-back anywhere wins over a wait (re-verify 2 R2-M1) keeps held. The 2 misses: an owed red check stated
near the top of a long report, past the 1,500-character tail the pending half reads; and a close in another language
whose owed item is in prose alone - the stated limit below.

## Population check - 3,482 closes, text only

| Live outcome | Closes | Held, baseline | Held, v2 |
|---|---|---|---|
| Done-close hold | 157 | 95 | 51 |
| Pass | 3,281 | 353 | 172 |
| Prose-ask hold | 44 | 0 | 0 |
| All | 3,482 | 448 | 223 |

- 199 holds kept, 249 released, 24 newly held; the prose-ask branch's 279 verdicts are unchanged.
- Released, 24 read: 21 right by the judge's criteria (waits on running work, answers with facts, a diff held for
  review); 3 questionable, each an offer to commit beside a held diff or an approval ask whose only done word had been
  an accident (two a 'ready' in 'when you're ready', one a 'committed' inside a when-clause) - the first-person widening holds one of them again.
- Newly held, all 24 read: 13 right (inputs or steps owed in prose, a decision handed over), 8 wrong (a future
  approval beside running work, a hold the user chose, a quoted task step read as an instruction), 3 unclear. 4 of the
  24 are in another language.

## A close in another language

- 50 of the 3,482 closes have under 70% of their prose letters in the Latin script; 19 of them carry a close label.
  The baseline held none of the 50 (its lists read English only). v2 holds 4: 3 report a run short of its last step
  while asking for inputs in prose (right), and 1 waits on a background check - work the registry carries, which the
  `neutral-live-work` exemption releases in production.
- `Leftovers:` alone is no signal: read as owed, it held 5 labelled closes in another language that release, each
  listing the user's own manual steps.
- **The limit.** A close in another language with no close label passes whatever it says (1 labelled miss). The remedy
  is the labels the skills already print in any reply language (`alfred-interaction.md`), never a translated word list.

## An independent reader (2026-11-03, after the merge)

The labels above are the tuning seat's own. A second reader, a fresh agent shown only the judge's criteria
(`stack/hooks/stop-judge-prompt.txt`) and the close texts - shuffled, with no label, verdict or regex - labelled 162
closes: the 94 above, the 23 v2 newly holds, 30 of its 227 new releases (seeded sample) and 15 of the 182 both versions
hold. It marked 42 hold, 119 release, 1 unsure. Scored text-only by the same offline runner, each row's
`stop_hook_active` and `background_tasks` as recorded:

- The two readers agree on 83 of the 93 shared closes (89%, Cohen's kappa 0.70).

| Set (blind labels) | v3.7.0 right | wrong holds | misses | v2 right | wrong holds | misses |
|---|---|---|---|---|---|---|
| The 94 labelled | 56 / 93 | 34 | 3 | 80 / 93 | 6 | 7 |
| The 18 replayed | 6 / 18 | 12 | 0 | 16 / 18 | 1 | 1 |
| v2's new holds | 13 / 23 | 0 | 10 | 10 / 23 | 13 | 0 |
| v2's new releases (sample) | 3 / 30 | 27 | 0 | 27 / 30 | 0 | 3 |
| Both hold (sample) | 5 / 15 | 10 | 0 | 5 / 15 | 10 | 0 |
| All 161 | 77 / 161 | 71 | 13 | 122 / 161 | 29 | 10 |

- About 5 of v2's 13 wrong new holds wait on running work that a replay cannot show: with live work in the registry the
  `neutral-live-work` reading releases them. The rest need the transcript (an answer to the user's own question, a
  hold the user chose) - about 8 truly wrong, as the population check above estimated.
- Both versions still hold 10 of 15 sampled closes the reader releases: the retune left that group where it was.
- The empty registry matters: scored with `background_tasks: []` on every row, v2 reads each stated wait as owed and
  falls to 94 / 161. A replay cannot know what was running; production can.

## Not measured

- The live rate: each exemption that fires writes one `done-close-exempt` probe row naming it - `resume-unread`,
  `neutral-live-work` and the widened `own-work-running` included. A week of those rows is the production reading.
- The user's own reading of the labels.
- No billed model call ran: the judge was not re-run against the v2 corpus.
