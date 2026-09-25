# /alfred-task-solve and /alfred-task-solve-cross - when and how

The two entry points for feature work in the stack. Both are manual-only (invoked with `/`, never
auto-fired), both drive the same underlying seats and twin skills - they differ in WHERE the work
runs and WHO holds the gates. This guide is the operator's view: what each buys, what each costs,
and how to run them. The numbers cited are from the instrumented benchmark runs on a linked
API + SPA project pair; treat them as ratios, not prices.

## One line each

- **`/alfred-task-solve`** - the gated single-chat vertical: one task through
  design -> plan audit -> your approval -> build -> review -> done-gate, with a hard stop between
  every step. You hold every gate; the work stays in (or is dispatched from) this chat.
- **`/alfred-task-solve-cross`** - the router and orchestrator: scopes the task in-session, picks
  the smallest safe execution mode (inline -> one implementer -> a domain trio -> cross-domain
  producer-first), and for multi-domain work freezes the contract and drives both verticals
  through a mandatory integration gate.

## Choosing - the short version

| Situation | Use |
|---|---|
| Trivial or single-file change | neither - just ask; the mode ladder's `single_chat` exists for exactly this |
| One task you want to READ and gate before it builds, or will resume across sessions | `/alfred-task-solve` |
| A feature you want routed to the right execution shape (may fan out) | `/alfred-task-solve-cross` |
| Anything touching two domains or a wire contract (API + SPA, shared DTO, migration a consumer feels) | `/alfred-task-solve-cross` - the contract + integration gate is the point |
| A runtime crash or broken screen | neither - `/alfred-issue-signatures-runtime` first, fix after diagnosis |

---

## /alfred-task-solve - the gated single-chat vertical

Six steps, a stop after each: DESIGN (plan written to a file under the docs root) -> GATE
(`alfred-task-verify-plan`'s four-pass audit, stamped) -> APPROVE (your word + the build mode -
'session' or 'agents'; an answer that names no mode is not an approval) -> BUILD -> CONFORMANCE
(inline review, the verifier seat, or an honest recorded skip) -> CLOSE (done-gate with per-task
evidence). The plan file plus a serena cycle note carry ALL state - every stamp, every task tick.

### Advantages

- **Control you actually exercise.** The plan is a file you read and can edit before any code
  exists; the APPROVE gate will not roll past a bare 'go'; mid-build discoveries (a pre-existing
  red, a scope question) stop and ask instead of deciding silently.
- **A second look that is not self-grading.** The conformance step reruns build + tests itself,
  live-probes the running app, traces changed wire contracts to their consumers, and checks that
  new tests can actually FAIL - the classes of defect a session reviewing its own work
  structurally misses.
- **Survivable state.** Compaction, `/clear`, or tomorrow: resume needs only the plan file and the
  cycle note. A stamp not in the file does not exist - which is precisely what makes the file
  sufficient.
- **A decision trail.** Approved mode, skipped review, per-task evidence - recorded, so 'why is it
  built this way' stays answerable.

### Disadvantages

- **The most expensive mode per feature.** A single chat carries its whole past forward: by the
  review step you re-pay the design, the plan, and every build log on every turn. Measured worst
  case: ~3x the cost of the same feature dispatched, with the thinnest tests.
- **The stops are overhead if you do not use them.** If you would type 'go' at every gate on a
  small task, you are paying the ceremony without the control.
- **One context, one blind spot.** In session build mode the same context designs, builds, and
  (inline) reviews - dispatching the verifier seat is what buys truly fresh eyes.

### How to run it cheaply

1. **Multi-slice plan? Choose agents build mode at APPROVE** - implementer seats absorb the heavy
   build reads in their own contexts (measured: the same feature dropped ~3x in cost vs session
   mode on a multi-slice backend change).
2. **Long cycle? `/clear` at a stop and resume.** The next step restarts from the plan file at a
   few thousand tokens instead of the whole conversation. This beats mid-step compaction, which is
   lossy and pays a summary pass.
3. Dispatch the verifier seat for the review when the change carries risk; skip the review
   honestly (it is stamped as skipped) when it does not.

### Example

```text
/alfred-task-solve Add a GET /api/tasks/overdue endpoint returning overdue tasks
(dueDate strictly before today, status not done), newest first, with unit + integration
tests covering the boundary: a task due today is NOT overdue.

  -> DESIGN writes .claude/docs/superpowers/plans/overdue-tasks.md, stops.
you: go
  -> GATE stamps 'Gated: passed | 1 gap fixed', presents the audit, stops at APPROVE.
you: Approved - build it in agents mode.
  -> BUILD fans the plan's tasks to aspnet-implementer seats, ticks the plan, stops.
you: Dispatch the aspnet-verifier seat for the review.
  -> CONFORMANCE signs off (build + tests rerun, live probe), stops.
you: go
  -> CLOSE runs the done-gate, stamps Completed with evidence. Nothing is committed - your word.
```

---

## /alfred-task-solve-cross - the router for multi-agent work

You describe the task; it scopes in-session (awareness rules + a bounded code pass), then picks
the smallest mode on the ladder: `single_chat` -> `implementer_only` -> `domain_trio` ->
`fanout_domain_trio` -> `cross_domain_light` -> `full_cross_domain`. Single-stack work defaults to
the current session (dispatch is opt-in); cross-domain work defaults to dispatch, because the
producer's frozen interface and the integration gate are what keep two repos honest.

### Advantages

- **Right-sized execution.** A riskless one-endpoint ask de-escalates to near-bare cost; a
  migration or auth surface escalates to the trio with a plan gate; only a real seam pays for the
  full producer-first machinery. Measured: trio-scale dispatch was the cheapest way to run a
  medium feature - the orchestrator context stays small while seats do the reading.
- **The seam machinery.** For cross-domain work: the producer designer's interface is recorded as
  the contract, consumers are briefed from it, no seat may silently change it, and the
  integration-reviewer gates the assembled whole. In the benchmark this gate caught a real
  contract violation (an error-envelope break masked by a vacuous test) that a single chat doing
  both sides shipped - along with a duplicated business rule across the wire. Neither shows up as
  a red test; both surface later as drift.
- **A durable ledger.** Contract version, per-lane phases, the four plan-audit verdicts, task
  statuses - a mid-run compaction or a fresh session resumes without re-deriving anything.
- **Plan review stop.** Once a plan passes its audit you read it before implementers spend
  anything. Only explicit words about the review waive it ('run without plan review') - a
  dispatch opt-in, a run-it-in-one-pass instruction, or a completion-token request is NOT a
  waiver.

### Disadvantages

- **The full cross-domain flow is ~3-4x a single-stack run** - two designer seats, two verify
  loops, a live integration gate. Worth it exactly when a contract actually moves; waste when the
  ask only sounded cross-domain.
- **Routing itself costs a scoping pass.** For a task you already know is one small change in one
  file, invoking the router is ceremony - ask directly.
- **More moving parts to read.** Reports, a ledger, per-lane statuses - the price of work you can
  audit later.

### Examples

Single-stack, pinned - the hint routes straight down the ladder:

```text
/alfred-task-solve-cross Add soft delete to tasks - just the API, the SPA is out of scope:
an IsDeleted flag with an EF migration, DELETE flips it, every read path excludes soft-deleted
rows, plus a restore endpoint; unit + integration tests cover exclusion and restore.

  -> scoped to the one stack; the migration is a risk trigger -> domain_trio.
  -> designer plan returned, audited (plan_audit: risk/scope/edges/soundness in the ledger),
     presented - the turn ENDS at the plan review stop.
you: approved, proceed
  -> implementers fan out per the plan, verifier gates the assembled build, ledger closed.
```

Cross-domain - producer first, contract frozen, gate mandatory:

```text
/alfred-task-solve-cross Add task archiving across the pair: isArchived on the wire contract,
archived tasks excluded from the default list and stats, includeArchived=true opt-in; the SPA
gets an Archive action and a 'Show archived' toggle with muted rows.

  -> both domains affected, backend produces -> producer designer runs first; its interface
     section is recorded as Contract v1 in the ledger; plan review stop.
you: I read the plan and the recorded contract - approved, proceed.
  -> backend vertical builds + verifies; SPA implementers briefed FROM the recorded contract;
     SPA vertical builds + verifies; integration-reviewer probes the assembled seam
     (wire shapes, migration both directions, live cross-repo E2E) and signs off.
  -> commit is authorized by the integration gate - never by one side's sign-off.
```

---

## What neither skill buys

Token savings on routine work. Measured honestly: a plain session with no skills shipped small,
well-patterned single-stack features green at a fraction of any flow's cost - in a codebase whose
existing patterns already answer the design questions. The flows earn their premium where those
conditions fail: independent verification when a green suite is not proof, contracts when two
sides must not drift, stops when a wrong plan is expensive, state when work outlives one context.
Match the tool to the risk, not to habit - that is what the mode ladder automates.
