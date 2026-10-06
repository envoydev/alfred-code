# loop-quality - evidence appendix

The measured anecdotes behind this skill's rules, kept out of the run-time body so every session stops paying
for them. Audit material: read it to learn WHY a rule is shaped the way it is, never to run the skill.

Every section below measures the numbered-prompt run, which was this skill's whole body before 2.0.0 and is
now its STAGED mode (`references/staged-mode.md`). The default analyze-triage-fix loop is new in 2.0.0 and
has no measurements of its own yet.

## Intro - autonomy, pauses and the approval stamp
- **every other decision ... you make yourself, apply, and log** - measured: one run asked the user a mid-stage FIX-mode question this line already forbade
- **never a prose 'which do you want?' that ends the turn with the handoff unwritten** - measured: one mid-pass stop narrated two options and left RUN-STATE unwritten until the user asked what to paste into a new session
- **never a relative Bash write, which follows whatever cwd the shell drifted to** - measured: two sessions landed the stamp in a phantom nested docs tree and lost dispatches to the guard
- **never retry blind, and never let a run degrade to inline with nothing said** - measured: five sessions in one project silently degraded every FIX to inline for a whole 12-stage run because the stamp could not be written and nothing said so
- **an earlier session's leftover stamp is not consent** - measured: a 2h52m-old stamp from another session authorized five implementer dispatches
- **an orchestration or fan-out tool never replaces DISCOVERY, the numbered stages, or the anti-gaming sweep** - measured: two runs re-implemented the loop as ad hoc fan-out scripts and lost the sweep entirely

## Intro - stage boundaries and the fresh-session ask
- **carried-forward conversation, not tool output, is what dominates session cost** - measured across the audited loop sessions: the carried conversation, not tool output, dominated per-message cost
- **A step, not advice** - the advice form was ignored in 4 of 4 audited long sessions
- **DECISIONS.md, a side file no resume reads whole** - measured: the all-in-one carryover grew to ~1,447 lines and its whole-file resume read alone was 39% of one session's tool-result volume, recurring in 8 of 11 sessions

## EXECUTION MODES
- **Seats are always the NAMED domain seats, never a generic seat** - measured: one run put all 10 dispatches on generic seats, losing every seat pin, preload, and trap-list

## OUTER LOOP
- **a next stage started with that field absent is a protocol violation, headless runs included** - measured: one headless run recorded three stage outcomes and fired zero of the three mandated asks; the same model honored the identically-shaped run-start ask, so the binding lives on the outcome line, not in prose reminders
- **Review the FULL diff - never cap it** - measured: one sweep piped the diff through `head -400` - harmless that run only because the diff was 177 lines

## INNER LOOP
- **one auditor ALWAYS takes the cumulative diff ... (the diff-lens seat) - stated here because a resumed session re-reads this file** - measured: one resume dropped the diff-lens seat with the rule sitting unread

## RULES
- **An enumerable finding class ... pairs the model audit with the deterministic scan** - measured: five auditors together missed 6 of a class's 81 instances that a one-line grep listed
