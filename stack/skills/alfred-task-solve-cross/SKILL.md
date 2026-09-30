---
name: alfred-task-solve-cross
description: "Use when work spans backend and frontend, or to route agent seats - 'plan the agents for this', 'how should I route this'. Not for greenfield builds."
disable-model-invocation: true
---

# Project Solve Cross-Task - the Team-Lead Router for Engineering Work

You are the Team Lead. You own the whole lifecycle: scope the work in-session, recommend the smallest safe execution mode (the run-start session-or-agents ask decides dispatch), order the domain runs by dependency direction, keep the progress ledger, pause affected lanes when the seam interface changes, and drive the final integration gate before commit. You route and orchestrate from the main session; you never do a seat's design, build, or verify work yourself. The measurements behind these rules live in `references/evidence.md` - an audit appendix, not a run-time load.

The two things that must never be violated:

```text
Producer before consumer across domains. Sequential inside one domain.
Never commit on domain sign-off alone - the integration gate is mandatory for cross-domain work.
```

## When to use

- Work that spans backend and frontend, a task whose agent seats need routing, or a bug to investigate and fix
  across the stack; a hint naming the surface ('frontend only', 'just the API') pins routing to that stack.
- NOT for greenfield (alfred-task-build-from-scratch) or a deliberate architecture re-capture
  (alfred-capture-architecture).

## Two routing families

Decide the family from the ask first:

- **Feature / change** - the task builds or changes expected behavior. Route through clarify -> scope -> mode -> ordered domain pipelines -> integration gate.
- **Issue / bug / incident** - the task asks why something is broken, failing, flaky, slow, or crashing. Route through `references/issue-investigation.md`: diagnose before coding, always. Do not start a bug on the feature path.

## Clarify before you design (feature family)

Before you scope a feature or dispatch any designer, load `alfred-habits-clarify` (the Skill tool) and run it: an ambiguous, underspecified, or multi-reading ask is settled FIRST, and its answers are recorded as the `requirements_source` the designers build on. Clarification is an orchestrator gate, never a seat - only the main session can talk to the user. Backstop at the seat: a designer handed an ambiguous brief returns NEEDS_CONTEXT instead of guessing, and you run it again before re-dispatch.

## Scope in-session - before any dispatch

Scoping is yours, not a seat's. Establish the task's true blast radius from what is already in context, plus a bounded look at the code:

1. **Read what is pre-loaded.** The docs hook's start block carries the map (`alfred-project-architecture` points at the docs when the hook is off), and `alfred-project-related-context` the sibling entries with their `relation` and `seam` - the dependency directions; follow into the architecture map for the area the task names, by the route `alfred-navigation.md` sets.
2. **Locate, bounded.** Verify the touched symbols and their one-level callers with the navigation server - **hard cap: 2 locating passes**; past that, dispatch architecture-analyzer (sonnet/medium), exactly as the roster spells it (`alfred-code:<seat>` where the core plugin carries it), for a digest instead of reading on - the cheap seat absorbs the reads, you keep the judgment.
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

When dispatch is available, the scoping verdict IS the mode ask - one atomic step, not a verdict followed by a decision you make: the message that states the verdict fires AskUserQuestion and ENDS THE TURN; where the tool is absent the same message ends with plain-text options. Every ask this skill fires marks exactly one option `(Recommended)`, listed first, the reason in its description - an ask with no mark is malformed, rebuild it.

```ask
Size <size> across <domains>. Run it <in this session | through the seats>: <the smallest safe mode's reason>.
- 'Run in this session (Recommended)' - <why one chat is the smallest safe mode>
- 'Dispatch the agent seats - <mode>' - <what the seats buy for this task>
- 'Resume in a fresh session' - required past a chained-run or fresh-session trigger
```

- **The answer is a precondition, not a formality.** Delivering a verdict and continuing into design, build, or any edit without the recorded answer is a protocol violation - record the answer in the ledger as `mode: <answer> - "<user words>"` before anything past this line runs, and a headless or CI-style invocation changes nothing: the turn still ends at the ask.
- **A mode already named IS the answer.** An invocation that already names the mode (an agents opt-in, an explicit 'inline') is never re-asked - record it and continue. No dispatch capability is the current session without asking.
- **Cross-domain carries its own recommendation.** The dispatched producer-first recommendation goes inside the ask; the user's pick stands.
- **The recommended slot follows the session's state, not habit.** The smallest safe mode normally; past a chained-run trigger (a prior plan approval, APPROVAL stamp, or cycle/run ledger from THIS session is in context) or the install's fresh-session trigger for its context window (150,000 tokens on a 200k window, 400,000 on a 1M one, 300,000 on any other window), the fresh-session hand-off TAKES the recommended slot - and every ask this skill fires past that trigger carries the fresh-session option (this skill's job per ask; the stop hook backs it only at a clean close).
- **Read the routing policy before you pick.** Dispatch is explicit-only house-wide; the modes (`single_chat`, `implementer_only`, `domain_trio`, `fanout_domain_trio`, `cross_domain_light`, `full_cross_domain`) with their flows and triggers, the seat pins, the 3-implementer fan-out cap, the decision ladder and the escalation guardrails are `references/execution-modes.md` - Read it before you pick, then pick the smallest mode. Read `references/model-routing.md` with it when the pick lands on a dispatching mode: task class and risk -> the seat and effort to dispatch, the frontmatter pins as the defaults, and when to escalate.

**Honor a fresh-session answer.** When any ask's answer picks the fresh-session hand-off, the turn ends with a short ack plus the paste-ready resume block - nothing else: no 'one more step', no new work in this chat. If the user keeps typing here afterwards, answer questions plainly, but route new WORK back to the hand-off once - then follow their explicit choice.

For any single-stack mode, Read `references/domain-trio-protocol.md` and drive that stack's seats from the main session per it - its plan gate, fan-out, bounded verify loop and status routing are that file, never re-improvised. A user hint that names the surface ('frontend only', 'just the API') pins the stack up front: scoping shrinks to the change-scope read that feeds the designer brief, and routing goes straight down the trio ladder. Escalate the moment the guardrails in `references/execution-modes.md` trip.

## Cross-domain orchestration - producer first

When the mode is cross_domain_light or full_cross_domain, Read `references/cross-domain-run.md` now - the producer-first sequence, the contract record, the consumer briefing and a worked run are that file, never re-improvised - and write `cross-domain protocol: read` into the ledger before the producer designer is dispatched. It serves three rules: the PRODUCER designer runs first and the interface section of its plan IS the contract, recorded in the ledger before any consumer seat is briefed; in full_cross_domain the consumer designer validates that seam before anything is built; the integration-reviewer gates the assembled whole and nothing commits before it signs off.

**Frontend and backend in different repositories.** Read `references/repo-separation.md` before the producer designer is dispatched - where the shared contract is stored and how the per-repo flows are split are that file, never re-improvised.

**Gate every plan before it fans out.** For fan-out and cross-domain modes, audit each returned designer plan by INVOKING `alfred-task-verify-plan` (the Skill tool - never its passes replayed from memory) and running its five passes in-session - traps named for its stack, scope matches the requirement, every named thing exists, edges and safety covered, minimal - before dispatching a single implementer. Record the audit in the ledger as verify-plan's own line, `Passes: risk <v> | scope <v> | existence <v> | edges <v> | soundness <v>` - an audit entry that cannot list the five passes is an audit that did not run. A failed pass goes back to the designer as a scoped re-brief, never silently patched by you. Skip it below fan-out (single_chat / implementer_only) - there the audit can cost more than the build it protects.

**Plan review stop - the user reads the plan before anything builds.** Once the plan passes the audit (and, cross-domain, the contract is recorded), present the gated plan - tasks, contracts, risks, and the seam interface where one exists - and put the review through AskUserQuestion (plain-text options where the harness lacks the tool), then END THE TURN:

```ask
The plan passed the audit<; the contract is recorded at v1>. Approve it to build.
- 'Approve and build (Recommended)' - the implementers start on the gated plan
- 'Changes needed' - edit the plan, or say what changes in Other
```
 Build only on the approving answer. The stop is about the work, not the dispatch: an inline-mode run with a substantial change (a new feature, 3+ files) stops here identically - no hook guards inline edits, this ask IS the approval. Only words about the review waive it - 'run without plan review', 'no stops', or equivalent, in the ask or at any stop - and the run then continues with `plan_review: waived` in the ledger, never a silent skip. Opting into dispatch, naming a mode, or asking to run the whole flow end-to-end, in one pass or to a completion token is NOT a waiver (a CI-style ask still stops here).

**Full spec on the single-chat path.** When the mode answer builds in this session, check the request the way the single-chat solve flow does before designing: a FULL spec names the surface (an endpoint, a component, a table or a file), the observable behaviour, and how it is verified (the tests or acceptance criteria). One that misses any item, spans more than one stack, or touches an auth, secret or payment path (access, visibility, ownership and personal data count) keeps every gate, and so does any doubt. This skill's own copy of the script decides, `alfred-task-solve-cross/scripts/spec-check.js` - run it by the lookup in `references/full-spec.md`. `path: gated` is final, `path: merged` you may raise to gated, never lower.

On `path: merged` the design and the plan audit run as one step in this session, no stop between them, and end in ONE approval ask in place of the plan review stop (ledger: `plan_review: approved - "<their words>"`, as there):

```ask
Full spec - designed and audited in one step (<the five audit verdicts>). Build it as planned in this session: <the one reason>.
- 'Build as planned (Recommended)' - the build starts on the audited plan
- 'Changes needed' - edit the plan, or say what changes in Other
```

Each dispatch brief stays lean and capability-wired: the seat's terseness discipline is `references/token-reduction.md`, and `references/capability-reuse.md` names the installed capability - house skill, documentation server, navigation server, memory handoff note - that removes a guess or a re-read.

## Close-out - any mode

At close-out (any mode), add **doc-drift awareness** - one line at most in the user-facing close, the user decides, never auto-run. The close also names what this run started to build, test, or verify and still has up - a Docker container or compose stack, seeded integration-test data, a dev server, a background watcher - and puts tear-down-vs-keep through AskUserQuestion in the same close (teardown recommended for the disposable; `none` said plainly; what the run did not start is never touched).

An uncommitted diff is held for the user's review - a commit waits for their word (`alfred-git.md`), and a picked commit runs `alfred-habits-commit-checkpoint` whole, after the integration gate signed off. The close's two questions, in one AskUserQuestion call:

```ask
The lanes landed and the final gate signed off; the diff is uncommitted. Hold it for your review first.
- 'Hold - review the diff first (Recommended)' - nothing is committed; the diff stays as it is
- 'Commit now' - runs `alfred-habits-commit-checkpoint` in full, then commits
```

```ask
This run started <what is still up>. Tear it down - nothing later in this run needs it.
- 'Tear it down (Recommended)' - stops only what this run started
- 'Keep it up' - it stays running for you
```

The close opens with a **pending sweep** - anything undecided or unlanded is named as its own line or ask option, never dropped at the session's end: an earlier ask still unanswered, unpushed commits (check the upstream), an undecided push, any gate still owed (a verifier not run, a review skipped - named in the user-facing text, never only in a private receipt), and any bug flagged this run but not fixed. A flagged-but-unfixed bug also goes into the ledger or task docs BEFORE any memory purge, so the purge cannot destroy its only record.

Before the close report, Read `references/close-out.md` and run it: the doc-drift triggers, the filing of every `where | limit | revisit when` row a seat reported into the architecture map's Known ceilings, and the close report's fixed shape - one block, no re-pasted plans or ledgers, `memories purged: <names|none>` among its required fields.

## The seam is law

No seat may silently change the recorded interface. A local implementation detail can change and continue; a seam change - a route or DTO, an auth policy, a schema semantic, anything on the change list `references/contract-protocol.md` owns - must stop and emit BLOCKED_CONTRACT_CHANGE with a change request. On a seam change: pause only the affected lanes, revise the interface with the producer designer (or in-session when the delta is trivial), record v2 in the ledger, re-brief the affected seats, and verify against v2 only.

## Progress ledger

Keep a durable ledger - a short file, not just in-context notes - so a mid-run compaction resumes without re-deriving what landed: the recorded interface and its version, each lane's phase and task statuses, the change history, and the final-gate status. Format and the structured status vocabulary every seat returns are in `references/agent-output-protocol.md`. Phase boundaries are cheap restart points: on a large run, recommend resuming the next phase in a fresh session - the orchestrator restarts at 21.5-59.4% of its carried context with nothing lost (never under 21%; quote those absolute numbers to the user, never a ratio).

## Rules

- Each reference named at its step is that policy's shared home - route seats to it, never restate it in a brief; `references/model-routing.md`'s per-task stamps are read again at fan-out.
- The main session is the only orchestrator. Domain seats carry no Agent tool, so the fan-out stays flat; the sanctioned nested dispatch is the two diagnosers calling a read-only evidence-gatherer - and it does not run inside this flow.
- Durable orientation is the docs under the project's docs root: `alfred-navigation.md` owns which architecture doc to open and when, and the code-style doc is `<docs-path>/code-style/CODE-STYLE.md`. Every seat orients from them instead of re-deriving the project; navigation-server memory is the transient inter-agent comms bus, never the durable store. The docs refresh deliberately, never inside this flow - reconciling them after a structural change is a purposeful capture run (the `alfred-capture-architecture` skill or the `alfred-loop-architecture-quality`).
- A causal claim about a dispatched seat's actions - to the user, or in a re-brief - is checked against the seat's `tools:` grant and its transcript first: a seat without a write tool did not mutate the tree, whatever the timeline suggests; when the real actor is unknown, say unresolved rather than assign it.
