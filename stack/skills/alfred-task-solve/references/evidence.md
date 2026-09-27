# alfred-task-solve - evidence appendix

The measured anecdotes behind this skill's rules, kept out of the run-time body so every session stops paying
for them. Audit material: read it to learn WHY a rule is shaped the way it is, never to run the skill.

## State - two layers, split by durability
- **A NEW cycle starting after a finished one recommends the fresh-session hand-off** - measured: chained orchestrations grew one session's per-message context ~19x

## The stop contract
- **Named fields, not prose about them** - measured: a controlled measurement put five named fields at 5 of 5 emitted and the same step's prose condition at 0 of 1; `Progress: N of M` is the one piece of run state measured to SURVIVE a compaction where the prose equivalent did not; `Leftovers:` exists because a cycle stamped `Completed` with its fix delta unreviewed sat 1h42m until the user asked what was left
- **There is no non-decision stop** - measured: a contract that asked the tool only for 'decision-carrying' stops let live runs classify every plain stop out of the mandate and stall in prose until the user typed - 0 of 8 stops used it while 2 of 2 other skills' asks did; recurred after a fix scoped to decision stops
- **the stop is the cheap point to run the next step in a fresh session** - measured: a resume restarts at 21.5-59.4% of the carried context, never under 21%, with zero re-work - stamped steps stay done; the 'roughly a tenth' this rule used to claim was 2-6x optimistic and reached users verbatim inside the options they acted on
- **HONOR the answer** - measured: a tool-held 'Fresh session' answer was ignored and the run continued 1h51m to 490k ctx
- **This is a CONSTRUCTION check, not a memory** - measured across eight audited sessions: the remembered form fired in zero of 40+ qualifying stops - one session crossed the trigger at its FIRST approve gate and never offered it through 15 more - while the same sessions' other option rules held
- **Autonomy waiver (AUTO)** - measured twice: with no waiver path, zero-ask runs improvised the override invisibly - one wrote 'take the recommended option at every stop, do not ask' into a scratch note as its only record

## The steps
- **Each step that names a skill INVOKES it via the Skill tool - and re-invokes it for every new cycle** - measured: a second and third cycle ran all six steps with zero fresh invocations - 1h42m of work stamped to the first cycle's reviewer
- **DELETE that gate file when the fan-out completes** - measured: the delete clause lived only in a reference file no session ever read, so a live stamp could authorize an unrelated later dispatch
- **MINT the run's contract version** - measured across four sessions: with no minted version, concurrently-dispatched seats invented 3-5 incompatible naming schemes per batch, one later read failed on a guessed name, and the naming rule's home file was never loaded by any seat
- **Build-time stops are for what the BUILD cannot decide, and there are three** - measured: the old single-stop wording classified correct behaviour as a violation - a run that stopped because an external test dependency was down was reading the rule right and doing the wrong thing
- **INVOKE the reviewer chosen at the step-4 stop** - measured twice: a chosen reviewer was never invoked, and one COMMIT-GATE receipt cited a pass with no matching invocation anywhere in the session
- **the fix delta gets the SAME reviewer again** - measured: a cycle stamped Completed with its fix delta unreviewed sat 1h42m until the user asked what was left
- **purge the run's minted seat notes** - measured corpus-wide: 28 write_memory, 0 delete_memory
- **this stop is where the close-out decisions live** - measured: this was the one step without the Stop tag, and prose closes here cost a 31-minute stall, a 12-hour ungated corridor, and a green reviewed diff that died uncommitted at a /clear
- **New scope arriving in-chat after `Completed:` is a NEW cycle** - measured: every user-caught defect in two audited sessions lived in post-close ad hoc scope the gates never saw
- **verify the sibling's actual source before writing what it must do** - measured: a chat-only handoff was regenerated twice at full context; a speculative one shipped a wrong claim the user's follow-up exposed

## Moved from SKILL.md (pilot 4 split)

The measurement each rule in SKILL.md now states without its story.

- **Every ask marked** - Pilot 3: 18 of 40 flow asks carried none
- **No retry, no you-run-it** - Pilot 3: that pick left a model change with no migration, and every integration test failed
- **Hold at close** - Pilot 3: the recommended commit was taken 6 of 6 times, $6.36
