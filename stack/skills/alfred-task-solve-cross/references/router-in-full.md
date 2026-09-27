# The router in full - every rule with its reason

Read when a rule in SKILL.md is unclear, or before a first cross-domain run in a session: the same rules, unabridged. The measurements behind them: `references/evidence.md` (an audit appendix).

**Contents:** [Two routing families](#two-routing-families), [Clarify](#clarify-before-you-design-feature-family), [Scope](#scope-in-session---before-any-dispatch), [Execution modes](#execution-modes---the-user-picks-session-or-agents), [Cross-domain orchestration](#cross-domain-orchestration---producer-first), [The seam is law](#the-seam-is-law), [Progress ledger](#progress-ledger), [Policies](#policies---the-shared-home-every-seat-references), [Rules](#rules)

## Two routing families

Decide the family from the ask first:

- **Feature / change** - the task builds or changes expected behavior. Route through clarify -> scope -> mode -> ordered domain pipelines -> integration gate.
- **Issue / bug / incident** - the task asks why something is broken, failing, flaky, slow, or crashing. Route through `references/issue-investigation.md`: diagnose before coding, always. Do not start a bug on the feature path.

## Clarify before you design (feature family)

Before you scope a feature or dispatch any designer, load `alfred-habits-clarify` (the Skill tool) and run it: an ambiguous, underspecified, or multi-reading ask is settled FIRST, and its answers are recorded as the `requirements_source` the designers build on. Clarification is an orchestrator gate, never a seat - only the main session can talk to the user. Backstop at the seat: a designer handed an ambiguous brief returns NEEDS_CONTEXT instead of guessing, and you run it again before re-dispatch.

## Scope in-session - before any dispatch

Scoping is yours, not a seat's. Establish the task's true blast radius from what is already in context, plus a bounded look at the code:

1. **Read what is pre-loaded.** The generated awareness rules carry the map: the docs hook's start block (project shape, module map, house contracts; `baseline-project-architecture` points at the docs when the hook is off) and `baseline-project-related-context` (the sibling entries with `relation` and `seam` - the dependency directions); follow into the architecture map for the area the task names, by the route `baseline-navigation.md` sets.
2. **Locate, bounded.** Verify the touched symbols and their one-level callers with the navigation server - **hard cap: 2 locating passes**; past that, dispatch architecture-analyzer (sonnet/medium) for a digest instead of reading on - the cheap seat absorbs the reads, you keep the judgment, and the orchestrator context never holds a whole-module read.
3. **Walk the seam catalog.** Read `references/seam-catalog.md` - the stack-keyed traps that turn a 'local' task cross-domain (a shared DTO edit, a migration, an app-wide singleton service, an event contract); a discovered shared-interface edit is itself the cross-domain signal.
4. **State the verdict:** the size line first, by the size table below (a trivial or small single-domain task runs that row's steps, never this pipeline), then the affected domains, the dependency direction (who produces, who consumes - from the related-context entries or the map), the risks the plan must absorb, and open questions (back to the clarify gate). The verdict CARRIES the seam check - one line naming the catalog traps the task touches, or 'no catalog trap applies - <why>'; a verdict without that line skipped step 3, not summarized it.

The size line is `Size: <trivial|small|standard|cross> - <the signal that decided it>`; the size can be raised mid-run, never lowered.

| Size | Signals | Steps that run |
|---|---|---|
| trivial | one file, no new dependency, no behaviour a test would see (typo, comment, format, rename inside a file) | edit -> scoped check -> close. No design, no audit, no stop |
| small | up to 3 files in one domain, no new dependency, no public contract touched | plan inline -> build -> verifier -> close. One stop, the close |
| standard | anything else in one domain | the full gated vertical |
| cross | more than one domain | this pipeline |

Floor: auth, secrets, input parsing, permissions, a public contract or a migration is never below
standard, whatever the file count.

## Execution modes - the user picks: session or agents

When dispatch is available, the scoping verdict IS the mode ask - one atomic step, not a verdict followed by a decision you make: the message that states the verdict fires AskUserQuestion and ENDS THE TURN; where the tool is absent the same message ends with plain-text options. Every ask this skill fires marks exactly one option `(Recommended)`, listed first, the reason in its description - an ask with no mark is malformed, rebuild it (pilot 3: 18 of 40 flow asks carried none, and the first option was taken each time).

```ask
Size <size> across <domains>. Run it <in this session | through the seats>: <the smallest safe mode's reason>.
- 'Run in this session (Recommended)' - <why one chat is the smallest safe mode>
- 'Dispatch the agent seats - <mode>' - <what the seats buy for this task>
- 'Resume in a fresh session' - required past a chained-run or fresh-session trigger
```

The mark follows the rules below - the smallest safe mode normally, the fresh-session hand-off past a trigger.

- **The answer is a precondition, not a formality.** Delivering a verdict and continuing into design, build, or any edit without the recorded answer is a protocol violation - record the answer in the ledger as `mode: <answer> - "<user words>"` before anything past this line runs, and a headless or CI-style invocation changes nothing: the turn still ends at the ask.
- **A mode already named IS the answer.** An invocation that already names the mode (an agents opt-in, an explicit 'inline') is never re-asked - record it and continue. No dispatch capability is the current session without asking.
- **Cross-domain carries its own recommendation.** The dispatched producer-first recommendation goes inside the ask; the user's pick stands.
- **The recommended slot follows the session's state, not habit.** The smallest safe mode normally; past a chained-run trigger (a prior plan approval, APPROVAL stamp, or cycle/run ledger from THIS session is in context - the finished cycle's carried context compounds into every dispatch and re-send) or the install's fresh-session trigger for its context window (150,000 tokens on a 200k window, 400,000 on a 1M one, 180,000 on any other window), the fresh-session hand-off TAKES the recommended slot - and every ask this skill fires past that trigger carries the fresh-session option (the stop contract's construction check - this skill's job per ask; the hook backs it only at a clean close).
- **Read the routing policy before you pick.** Dispatch is explicit-only house-wide; the seat pins, the 3-implementer fan-out cap, the decision ladder and the escalation guardrails are `references/execution-modes.md` - Read it before you pick, then pick the smallest mode. Read `references/model-routing.md` with it when the pick lands on a dispatching mode: task class and risk -> the seat and effort to dispatch, the frontmatter pins as the defaults, and when to escalate:

| Mode | Flow |
|---|---|
| single_chat | main session only - tiny, clear, one-domain, no seam impact |
| implementer_only | main session -> one domain implementer -> main session verifies |
| domain_trio | one stack's designer -> implementer -> verifier |
| fanout_domain_trio | one stack's designer -> up to 3 implementers at once (more on ask) -> verifier |
| cross_domain_light | producer designer -> producer + consumer implement/verify -> integration-reviewer - 2+ domains, routine seam |
| full_cross_domain | producer designer -> consumer designer validates the seam -> domain pipelines -> integration-reviewer - novel or risky seam (the reference lists the triggers) |

**Honor a fresh-session answer.** When any ask's answer picks the fresh-session hand-off, the turn ends with a short ack plus the paste-ready resume block - nothing else: no 'one more step', no new work in this chat. If the user keeps typing here afterwards, answer questions plainly, but route new WORK back to the hand-off once - then follow their explicit choice.

For any single-stack mode, Read `references/domain-trio-protocol.md` and drive that stack's seats from the main session per it - its plan gate, fan-out, bounded verify loop and status routing are that file, never re-improvised. A user hint that names the surface ('frontend only', 'just the API') pins the stack up front: scoping shrinks to the change-scope read that feeds the designer brief, and routing goes straight down the trio ladder. Escalate the moment the guardrails in `references/execution-modes.md` trip.

## Cross-domain orchestration - producer first

When the mode is cross_domain_light or full_cross_domain, Read `references/cross-domain-run.md` now - the producer-first sequence, the contract record, the consumer briefing and a worked run are that file, never re-improvised - and write `cross-domain protocol: read` into the ledger before the producer designer is dispatched. It serves three rules: the PRODUCER designer runs first and the interface section of its plan IS the contract, recorded in the ledger before any consumer seat is briefed; in full_cross_domain the consumer designer validates that seam before anything is built; the integration-reviewer gates the assembled whole and nothing commits before it signs off.

**Frontend and backend in different repositories.** Read `references/repo-separation.md` before the producer designer is dispatched - where the shared contract is stored and how the per-repo flows are split are that file, never re-improvised.

**Gate every plan before it fans out.** For fan-out and cross-domain modes, audit each returned designer plan by INVOKING `alfred-task-verify-plan` (the Skill tool - load it, never replay its passes from memory: the passes evolve with the stack, your recollection does not) and running its five passes in-session - traps named for its stack, scope matches the requirement, every named thing exists, edges and safety covered, minimal - before dispatching a single implementer. Record the audit in the ledger as five per-pass verdicts by name - `risk / scope / existence / edges / soundness` - an audit entry that cannot list the five passes is an audit that did not run. The plan is already in your context, so the audit costs one bounded pass; a failed pass goes back to the designer as a scoped re-brief, never silently patched by you. Skip it below fan-out (single_chat / implementer_only) - there the audit can cost more than the build it protects.

**Plan review stop - the user reads the plan before anything builds.** Once the plan passes the audit (and, cross-domain, the contract is recorded), present the gated plan - tasks, contracts, risks, and the seam interface where one exists - and put the review through AskUserQuestion (plain-text options where the harness lacks the tool), then END THE TURN:

```ask
The plan passed the audit<; the contract is recorded at v1>. Approve it to build.
- 'Approve and build (Recommended)' - the implementers start on the gated plan
- 'Changes needed' - edit the plan, or say what changes in Other
```
 This is the user's window to read, edit, or redirect before implementers spend anything; build only on the approving answer. The stop is about the work, not the dispatch: an inline-mode run with a substantial change (a new feature, 3+ files) stops here identically - no hook guards inline edits, this ask IS the approval. The user can waive it - 'run without plan review', 'no stops', or equivalent, in the ask or at any stop - and then the run continues straight through with `plan_review: waived` recorded in the ledger, an honest record, never a silent skip. Opting into dispatch or naming an execution mode is NOT a waiver - and neither is an instruction to run the whole flow end-to-end, finish in one pass, or end with a completion token (a CI-style ask still stops here). Only words about the review are.

When you build each dispatch brief, keep it lean and capability-wired: each seat runs the lean-work / terseness discipline for its role (`references/token-reduction.md`) and is pointed at the installed capability - house skill, the documentation server, the navigation server, the memory handoff note - that removes a guess or a re-read (`references/capability-reuse.md`).

## Close-out - any mode

In full in `references/close-out.md`.

## The seam is law

No seat may silently change the recorded interface. A local implementation detail can change and continue; a seam change - a route or DTO, an auth policy, a schema semantic, anything on the change list `references/contract-protocol.md` owns - must stop and emit BLOCKED_CONTRACT_CHANGE with a change request. On a seam change: pause only the affected lanes, revise the interface with the producer designer (or in-session when the delta is trivial), record v2 in the ledger, re-brief the affected seats, and verify against v2 only.

## Progress ledger

Keep a durable ledger - a short file, not just in-context notes - so a mid-run compaction resumes without re-deriving what landed: the recorded interface and its version, each lane's phase and task statuses, the change history, and the final-gate status. Format and the structured status vocabulary every seat returns are in `references/agent-output-protocol.md`. Phase boundaries are cheap restart points: on a large run, recommend resuming the next phase in a fresh session - the orchestrator restarts at 21.5-59.4% of its carried context with nothing lost (never under 21%; quote those absolute numbers to the user, never a ratio); carried-forward context is the run's single biggest token cost.

## Policies - the shared home every seat references

Each reference named at its step above is that policy's shared home - route seats to it, never restate it in a brief. `references/model-routing.md` is named at the mode pick, and its per-task stamps are read again at fan-out.

## Rules

- The main session is the only orchestrator. Domain seats carry no Agent tool, so the fan-out stays flat; the sanctioned nested dispatch is the two diagnosers calling a read-only evidence-gatherer - and it does not run inside this flow.
- Durable orientation is the docs under the project's docs root: `baseline-navigation.md` owns which architecture doc to open and when, and the code-style doc is `<docs-path>/code-style/CODE-STYLE.md`. Every seat orients from them instead of re-deriving the project; navigation-server memory is the transient inter-agent comms bus, never the durable store. The docs refresh deliberately, never inside this flow - reconciling them after a structural change is a purposeful capture run (the `alfred-capture-architecture` skill or the `alfred-loop-architecture-quality`).
- A causal claim about a dispatched seat's actions - to the user, or in a re-brief - is checked against the seat's `tools:` grant and its transcript first: a seat without a write tool did not mutate the tree, whatever the timeline suggests; when the real actor is unknown, say unresolved rather than assign it.
