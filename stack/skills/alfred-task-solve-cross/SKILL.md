---
name: alfred-task-solve-cross
description: "Use when work spans backend and frontend, or when you want the agent seats routed for a task - the entry-point router for multi-agent engineering work. It scopes the task IN-SESSION (the generated awareness rules + a bounded navigation-server pass), asks session-or-agents up front, and routes to the smallest safe execution mode: single-chat, one implementer, a single-stack design-build-verify trio, or a producer-first cross-domain run where the producer's interface IS the contract and the integration-reviewer gates the assembly. Also triggers on plan the agents for this, how should I route this work, or investigate-and-fix a bug across the stack; name the stack ('frontend only', 'just the API') to pin routing to it. It scopes and routes - never designs or writes code - and runs in the MAIN session only. NOT for greenfield (alfred-task-build-from-scratch) or a deliberate architecture re-capture (alfred-capture-architecture)."
disable-model-invocation: true
---

# Project Solve Cross-Task - the Team-Lead Router for Engineering Work

You are the Team Lead: scope the work in-session, recommend the smallest safe execution mode (the
run-start session-or-agents ask decides dispatch), order the domain runs by dependency direction,
keep the progress ledger, pause affected lanes when the seam changes, and drive the integration gate
before commit. You route and orchestrate from the main session; you never do a seat's design, build,
or verify work yourself. Every rule below in full, with its reason: `references/router-in-full.md`.

```text
Producer before consumer across domains. Sequential inside one domain.
Never commit on domain sign-off alone - the integration gate is mandatory for cross-domain work.
```

## Two routing families

- **Feature / change** - clarify -> scope -> mode -> ordered domain pipelines -> integration gate.
- **Issue / bug / incident** - `references/issue-investigation.md`: diagnose before coding, always.

## Clarify before you design (feature family)

Before you scope a feature or dispatch any designer, load `alfred-habits-clarify` and run it; its
answers are the `requirements_source`. A designer handed an ambiguous brief returns NEEDS_CONTEXT.

## Scope in-session - before any dispatch

1. **Read what is pre-loaded** - the docs hook's start block (`baseline-project-architecture` with
   the hook off) and `baseline-project-related-context` (sibling relations and seams); follow into
   the map by `baseline-navigation.md`'s route.
2. **Locate, bounded** - the touched symbols and their one-level callers through the navigation
   server, **hard cap: 2 locating passes**; past that, dispatch architecture-analyzer for a digest.
3. **Walk `references/seam-catalog.md`** - the stack-keyed traps that turn a 'local' task cross-domain.
4. **State the verdict** - the size line first, then the affected domains, the dependency direction,
   the risks and open questions, and ONE line naming the catalog traps touched (or 'no catalog trap
   applies - <why>').

The size line is `Size: <trivial|small|standard|cross> - <the signal>`, by `references/size.md`'s
rows (a trivial or small single-domain task runs its row, never this pipeline); it can be raised,
never lowered. Floor: auth, secrets, input parsing, permissions, a public contract or a migration is never below
standard, whatever the file count.

## Execution modes - the user picks: session or agents

When dispatch is available, the scoping verdict IS the mode ask - the message stating the verdict
fires AskUserQuestion and ENDS THE TURN (plain-text options where the tool is absent). Every ask this
skill fires marks exactly one option `(Recommended)`, listed first, the reason in its description -
an ask with no mark is malformed, rebuild it.

```ask
Size <size> across <domains>. Run it <here | through the seats>: <the smallest safe mode's reason>.
- 'Run in this session (Recommended)' - <why one chat is the smallest safe mode>
- 'Dispatch the agent seats - <mode>' - <what the seats buy here>
- 'Resume in a fresh session' - required past a chained-run or fresh-session trigger
```

- **The answer is a precondition.** Record `mode: <answer> - "<user words>"` in the ledger before
  anything past this line runs; a headless invocation still ends at the ask. A mode the invocation
  already names is recorded, never re-asked; no dispatch capability is the current session.
- **The mark follows the session's state.** The smallest safe mode normally (a cross-domain
  recommendation goes inside the ask); past a chained-run trigger (a prior plan approval, APPROVAL
  stamp or run ledger from THIS session) or the install's fresh-session trigger for its window
  (150,000 tokens on a 200k window, 400,000 on a 1M one, 180,000 on any other window), the
  fresh-session hand-off TAKES the mark, and every later ask carries it.
- **Read `references/execution-modes.md` before you pick** - the six modes (single_chat to
  full_cross_domain), the seat pins, the 3-implementer cap, the decision ladder, the escalation
  guardrails; with `references/model-routing.md` when the pick dispatches.

**Honor a fresh-session answer.** When an answer picks the hand-off, the turn ends with a short ack
plus the paste-ready resume block - no new work here; later WORK typed here is routed back once.

A single-stack mode runs per `references/domain-trio-protocol.md` - Read it and drive that stack's
seats from the main session; a surface hint ('frontend only') pins the stack up front.

## Cross-domain orchestration - producer first

In cross_domain_light or full_cross_domain, Read `references/cross-domain-run.md` now and write
`cross-domain protocol: read` into the ledger before the producer designer is dispatched: the PRODUCER designer runs first and the interface section of its plan IS the contract, recorded before any
consumer seat is briefed; full_cross_domain has the consumer designer validate the seam first; the
integration-reviewer gates the assembly and nothing commits before it signs off. Front and back end
in different repos: Read `references/repo-separation.md` before the producer designer is dispatched.

**Gate every plan before it fans out.** For fan-out and cross-domain modes, INVOKE
`alfred-task-verify-plan` (the Skill tool, never replayed from memory) over each returned plan and
record the five per-pass verdicts by name - `risk / scope / existence / edges / soundness` - in the
ledger; a failed pass goes back to the designer as a scoped re-brief. Skip it below fan-out.

**Plan review stop.** Once the plan passes (and, cross-domain, the contract is recorded), present
it - tasks, contracts, risks, the seam - and END THE TURN on:

```ask
The plan passed the audit<; the contract is recorded at v1>. Approve it to build.
- 'Approve and build (Recommended)' - the implementers start on the gated plan
- 'Changes needed' - edit the plan, or say what changes in Other
```

An inline run with a substantial change stops here identically - this ask IS the approval. Only
words about the review waive it ('run without plan review', 'no stops'), recorded as `plan_review: waived`;
opting into dispatch or asking for an end-to-end run is not a waiver.

Briefs stay lean (`references/token-reduction.md`, `references/capability-reuse.md`) and route to a policy's reference, never restate it.

## Close-out - any mode

Read `references/close-out.md` at the close - the doc-drift line, what the run started and its
teardown ask, the pending sweep, the known-ceilings filing, the close report shape, and the Hold
ask: an uncommitted diff is held for the user's review, and a picked commit runs
`alfred-habits-commit-checkpoint` whole.

## The seam is law

No seat silently changes the recorded interface. A seam change (a route or DTO, an auth policy, a
schema semantic - the change list is `references/contract-protocol.md`'s) stops with
BLOCKED_CONTRACT_CHANGE: pause the affected lanes, revise the interface with the producer designer,
record v2, re-brief, verify against v2 only.

## Progress ledger

A durable ledger file (`references/agent-output-protocol.md` has its format and the status
vocabulary): the interface and version, each lane's phase and task statuses, the change history,
the final gate. Phase boundaries are cheap restart points - the orchestrator restarts at 21.5-59.4% of its carried context with nothing lost (never under 21%; quote those absolute numbers to the user, never a ratio).

## Rules

- The main session is the only orchestrator. Domain seats carry no Agent tool, so the fan-out stays flat.
- Every seat orients from the docs under the project's docs root (`baseline-navigation.md` names
  them) - refreshed by a deliberate capture, never inside this flow; navigation-server memory is the transient bus.
- A claim about a seat's actions is checked against its `tools:` grant and transcript first.
