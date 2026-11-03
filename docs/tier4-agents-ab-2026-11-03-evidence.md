# Tier 4 seat A/B - AG-03, AG-07, SKS-03 (2026-11-03)

Five Tier 4 candidates from the 2026-10-30 audit waited on `audit-fix/tier4` for a billed run. These runs put
the seats to the model the stack ships them on, with and without each candidate, in throwaway projects graded
offline from the transcripts and the written tree.

## Method

- Claude Code 2.1.317, nested `claude -p --output-format stream-json`, a throwaway account dir and HOME per
  run, the subscription login, `--permission-mode dontAsk`, `--max-budget-usd` 5 per run (6 for the verifier
  and designer probes), every probe dry-run first. The dispatcher is Haiku and only writes the approval file
  and dispatches; the seats run as shipped (implementers and verifiers Sonnet, designers Opus/xhigh).
- **Arms.** Before = `develop` e0965f9b exported with `scripts/clean-export.js`. After = the same export with
  the candidates cherry-picked (AG-15 a7109f4d, AG-07 4aead0fd, SKS-03 37830e5f, AG-03 f9fdd190, the last a
  squash of b5643ba4 + 862ee577 over a `javascript-conventions.md` conflict). Every run installs its arm
  through `scripts/profile-fixture.js <profile> --export` - the browser-extension profile (35 skills, the
  typescript LSP plugin) or web-angular - so the seats are the plugin's `alfred-code:<seat>`.
- **Probes.** A small MV3 tab counter (strict TS, Vitest) committed as the project base, or an Angular 21
  app for `ngimpl`:
  - `impl` - browser-extension-implementer builds a plan task (theme setting over the message contract, a
    30-second badge alarm, the `alarms` permission).
  - `verif` - browser-extension-verifier gates a landed diff with seven planted skill-only defects (an enum
    across storage, a boundary cast, `@ts-ignore` over a number badge text, a floating promise, a real-time
    sleep in a spec, `it('works')`, a whole-module `vi.mock`) and two controls (a listener registered after
    an await, an unused `tabs` permission).
  - `ngimpl` - web-angular-implementer builds a product list on `httpResource` with a filter, an output,
    loading and error states and specs.
  - `nav` - browser-extension-implementer on a 35-module variant with NO anchors: cap the badge text at
    `999+`, find the two sites that build badge text by hand, leave two look-alike formatters alone.
  - `design` - browser-extension-solution-designer designs the theme and badge feature from a request file.
  - `sks` / `sks2` - the main session (Sonnet) adds guard tests on request (`sks`), or adds a message whose
    tests come incidentally (`sks2`), the level SKS-03 is about.
- **Grading.** A per-probe script over the seat transcript: the skill in context at the first source edit (a
  preload, or a `Skill` call before it), docs and navigation tool calls, convention markers in the written
  code, the report's lines, and `tsc` / `vitest` / `ng build` / `ng test` re-run on the result. The `nav`
  probe also runs a hidden cap test. Grader misses found on real runs (a heredoc write, a named period
  constant, 'exits 0', a `track` after a call) were fixed and every run re-graded. A step failing on both
  arms is INCONCLUSIVE, never not-worse.

## Results

| Candidate | Step | Probe | Before | After | Verdict |
|---|---|---|---|---|---|
| AG-03 | stack skill (TS) in context at the first edit / verdict | impl, verif, ngimpl, nav | 24/24 | 24/24 | |
| | JavaScript base layer in context at the first edit | impl, ngimpl, nav | 20/20 | 16/20 | |
| | graded conventions held (no enum / `any` / boundary cast; OnPush, signal I/O, `@for` track, `httpResource`, no subscribe) | impl, ngimpl | 14/14 | 14/14 | |
| | build and tests green | impl, ngimpl, nav | 20/20 | 20/20 | |
| | planted defects found / controls | verif | 28/28, 8/8 | 28/28, 8/8 | |
| | cost per dispatch | impl, verif, ngimpl, nav | - | +9.1% | WORSE - reverted |
| | testing hub in context at the report | design | 3/3 | 3/3 | |
| | test strategy names Vitest and a fake chrome; the alarm listener at top level (finished runs) | design | 2/2, 1/2 | 3/3, 3/3 | |
| AG-07 | docs-tool call before writing the external API | impl, ngimpl | 0/14 | 0/14 | INCONCLUSIVE (floor) |
| | a locate step before the first source read, no anchors | nav | 6/6 | 6/6 | |
| | both bypasses fixed, decoys untouched, cap right | nav | 6/6 | 6/6 | NOT-WORSE |
| SKS-03 | testing skill loaded before the first test edit | sks2 (incidental) | 0/6 | 6/6 | WIN |
| | | sks (plain) | 3/3 | 3/3 | |
| AG-15 | records an owed A/B in a reference sentence | - | - | - | NOT RUN (documentation only) |
| SKD-04 | already on `develop` and `main` as 32780bfd | - | - | - | NOT RUN (nothing to compare) |

Runs per arm: impl 8, verif 4, ngimpl 6, nav 6, design 3, sks 3, sks2 6. Total billed: $25.08 over 73 runs,
against a $75 cap (one implementer calibration run under a scoped Bash allow-list is excluded from the tables,
its $0.27 included). By probe: impl $3.51, verif $2.43, ngimpl $3.59, nav $2.31, design $8.98, sks $1.12,
sks2 $2.86.

## First message and cost per arm

| Probe | First input, before | First input, after | Preload chars, before / after | Cost / run, before / after |
|---|---|---|---|---|
| impl | 38,736 | 31,903 | 33,171 / 13,940 | $0.208 / $0.232 (+11.4%) |
| verif | 39,941 | 30,452 | 37,011 / 10,715 | $0.288 / $0.319 (+10.8%) |
| ngimpl | 41,362 | 29,531 | 40,597 / 6,745 | $0.289 / $0.310 (+7.5%) |
| nav | 38,737 | 31,903 | 33,166 / 13,937 | $0.186 / $0.199 (+6.7%) |
| design | 34,880 | 32,205 | 26,604 / 19,537 | $1.413 / $1.579 (+11.7%) |

First input is the seat's first request in tokens (uncached plus cache write plus cache read). The static
preload over the 30 trio seats falls from 1,293,924 to 518,997 chars. Pooled over the four code-step probes
(24 runs a side), cost per dispatch rose 9.1%; a within-probe permutation test puts the chance of that by
luck at p = 0.0007, one-sided. With the designers added (27 a side): +9.7%, p = 0.0006.

## Reading

- **AG-03 - the preload comes back at the code step, dearer.** Every code-step seat loads the skills the
  split removed, as the new body tells it to: 3 `Skill` calls a run against 1, 1 to 4 more requests. Cache
  writes do not fall (impl 41,229 -> 44,001 tokens a run; the bodies are written once either way), and each
  extra request re-reads the grown prefix (cache reads impl 268,685 -> 318,927, Angular 545,464 -> 674,535).
  Output also rose (impl 6,731 -> 7,800). The behaviour graded the same on every marker but one: with the
  JavaScript base no longer preloaded, 4 of 12 Angular and nav seats lacked it at their first edit - three
  loaded it later, one never did ('I did not load the `javascript` skill'). The Angular report's
  `reward-hack scan:` line, owned by the preloaded `angular-conventions`, appeared in 5/6 before and 3/6
  after - a pointer at n=6. WORSE on its own claim: the candidate exists to cut per-dispatch cost, and on a
  dispatch with a code step it raises it. Reverted (febe328a).
- **AG-03 on the designers - no case for a split.** The Opus designer loaded the testing hub through `Skill`
  in every after run and its finished plans graded as well or better (Vitest with a fake chrome 3/3, the
  alarm listener at top level 3/3, against 2/2 and 1/2), but it too cost more, $1.413 -> $1.579 a run (n=3,
  p = 0.065 alone), the first message only 8% lighter. One before run was cut at the print-mode wait for a
  background seat (about 600 s) after writing its handoff note and before its report; its plan was graded
  from the note and it is left out of the plan-marker counts, its cost kept. A designer-only keep would save
  nothing measured here.
- **AG-07 - nothing moved.** No implementer in either arm called a documentation tool before writing
  `chrome.alarms` or `httpResource` (0/14 a side), though WebFetch is in each seat's tools and the start line
  names it; the web-angular seat gains the docs line in the after arm and still never fetched. That step is
  at the floor, so the candidate can neither show a gain nor a loss there. The navigation cut showed no
  effect on outcome: with no anchors, every run in both arms searched before reading and fixed both
  bypasses. No seat in either arm called `LSP` on `nav` (0/12); the before arm used the `Grep` / `Glob`
  tools in 4 of 6 runs and the after arm in 2 of 6, with shell grep in all 12 - a pointer, not a finding.
  The after arm also carried AG-03, so AG-07 alone is not isolated; its text does not touch skill loading.
- **SKS-03 - a clean win at the level it targets.** When tests come incidentally with a feature, no before
  run loaded the TS/JS testing skill before writing them and every after run did (0/6 -> 6/6, Fisher exact
  p = 0.001); asked for tests outright, both arms load it (3/3). Tests green in all 18 runs. The load costs
  6.5% more on that probe ($0.231 -> $0.246).
- **Verifier docs.** Two of four before verifiers fetched the `chrome.alarms` or `chrome.action` reference,
  none of four after. The verifier carries no docs line and AG-07 changed only its navigation sentence, so
  this is read as noise at n=4 (Fisher exact, two-sided p = 0.43).

## Rulings

- Ruling: AG-03 reverted rather than split - one squashed commit covers all 30 seats and the cost rise held
  on every code-step probe - cost if wrong: a dispatch that ends before any code step (a BLOCKED return, a
  read-only answer) keeps paying 7-12k more first-message tokens than it needs.
- Ruling: AG-07 kept on NOT-WORSE (navigation outcome 6/6 a side) with the docs step INCONCLUSIVE at the
  floor - a floor cannot regress, and the unified line only adds the check to four implementers that had none
  - cost if wrong: if the cut parenthetical was what kept seats on the `Grep` tool, they drift to shell grep.
