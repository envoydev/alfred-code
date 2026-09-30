# Execution Modes and Routing

The full team is not the default. Classify size, risk, domains, and contract impact, then run the smallest safe mode. Modes are a routing policy, not separate agents - never create a web-angular-small-task-agent or an aspnet-implementer-high; keep one seat per role and let this policy pick the mode and `references/model-routing.md` pick the effort.

## Contents

- DELEGATED vs INLINE - dispatch capability
- Feature / change modes
- Decision ladder
- Single-chat and implementer-only
- Route by risk, not size - what the verifier is worth
- Escalation guardrails
- Per-mode model, by example
- Team Lead routing output
- Issue / bug modes
- Cost rules

## DELEGATED vs INLINE - dispatch capability
Before the size/risk modes below, every skill carrying the session-or-agents decision - the orchestrators (`alfred-task-solve-cross`, `alfred-task-build-from-scratch`, `alfred-loop-architecture-quality`, `alfred-loop-test-coverage`, `alfred-loop-quality`), the captures, and the single-chat twins (`alfred-task-design` / `alfred-task-implement` / `alfred-task-verify-plan`) - picks one dispatch mode at the start and holds it for the run. This is the canonical statement of that policy; the skills that must run without this file installed carry their own pinned copies or restatements:

- **DELEGATED** - the main session orchestrates and dispatches every seat, never doing their work itself. The mode is the user's run-start pick, house-wide: every orchestration skill and capture asks ONE question up front, via the AskUserQuestion tool, when dispatch is available - current session or the seats - holds the answer for the run, and inherits the mode instead of re-asking when it runs inside another flow that already picked; an invocation that already names the mode IS the answer. The ask carries a recommendation, not a default: the dispatched producer-first flow for cross-domain work (one context for both domains reintroduces the token blowup and loses the integration gate's isolation), the seats for a capture's gathering (they absorb the reads), the smallest safe mode everywhere else.
- **INLINE** - the same steps, done in-session, no dispatch. Every skill's forced path when dispatch is unavailable (a Cursor session, a non-stack project with no domain agents, or a change too small to fan out) - forced INLINE skips the question; never offer seats that cannot run.

Dispatch is explicit-only, house-wide: never dispatch a seat the user did not choose. A dispatched seat runs on its frontmatter model/effort pin unless the user names a model; fan-out is capped at 3 implementers at once by default, more only on the user's ask. Detection keys on dispatch capability, not file presence - a project can carry the agent files on disk with no Agent tool to dispatch them, which is still INLINE. The size/risk modes below apply in either case; in INLINE they are done in-session.

Detection is PER STACK, not per run: a per-stack install gives the session only the HOST repo's roster, so a cross-domain run started in one repo may find a sibling domain's seats undispatchable. That domain runs INLINE (design, build, self-verify in-session) while the domains with seats stay dispatched - name the split at the plan stop, keep the contract frozen either way, and the integration gate still reviews the assembled whole. When the user wants that domain's independent trio instead, offer the two real levers: run the flow from that repo, or install its trio here.

**The approval gate file.** An implementer dispatch is mechanically gated (the `guard-unapproved-dispatch.js` hook): before the first implementer fans out, write `<docs-path>/flow/APPROVAL` with one first line - `APPROVED <plan/contract id> - "<the user's words, verbatim>"` on their explicit plan approval, or `AUTO - "<their words, verbatim>"` when they explicitly asked for a no-stops run. Stops are the default; AUTO is written only from the user's literal ask, never inferred from an ambiguous 'go' or from context. Re-write the stamp when the plan changes (a superseded contract_version does not carry approval forward), and delete the file when the run completes - a stale stamp must not authorize the next run. Designer and verifier dispatches need no stamp (the plan exists before approval; audits are read-only). Write the stamp at the ABSOLUTE path `${CLAUDE_PROJECT_DIR}/<docs-path>/flow/APPROVAL` with the Write tool. Only where the docs root still sits under `.claude/` (the old `.claude/docs` default, kept) is the write protected: a prompt for it offers 'Yes, and allow Claude to edit files in this project's .claude folder for this session' - take that, since `permissions.allow` cannot pre-approve it. A relative write follows whatever cwd the shell drifted to and the dispatch then bounces. The stamp belongs to the session that dispatches - written when its own decision lands, deleted at its own close; an earlier session's leftover stamp is not consent. If BOTH the Write tool and an absolute-path Bash write are refused by the harness's classifier, stop and put the choice through AskUserQuestion (retry the stamp, or run this stage inline) rather than retrying blind or dispatching around the gate - measured: five sessions in one project lost DELEGATED-mode fixes to an unwritable stamp and never said so.

## Feature / change modes

| Mode | Flow | Use when | Token profile |
|---|---|---|---|
| `single_chat` | main session only | tiny, clear, safe, one-domain change | lowest |
| `implementer_only` | main session -> one domain implementer -> main session verifies | the lightest single-domain dispatch rung: small OR medium work with no risk trigger - the main session self-verifies (build / test / review) | low |
| `domain_trio` | domain designer -> one implementer -> domain verifier | single-domain work that trips a risk trigger - auth, migration, data-loss, concurrency, security, or a large refactor (opt-in on risk, NOT the medium-work default) | medium |
| `fanout_domain_trio` | domain designer -> up to 3 implementers at once (more on ask) -> domain verifier | large/risky work inside one domain | medium-high |
| `cross_domain_light` | producer designer -> producer + consumer implement/verify -> integration-reviewer | 2+ domains, routine stable seam | high |
| `full_cross_domain` | producer designer -> consumer designer validates the seam -> domain pipelines -> integration-reviewer | novel or risky seam: new public/versioned API, streaming or eventing, auth, migrations, deployment order, production-critical | highest |
| `cross_without_domain_verifiers` | producer designer -> domain implementers gate on their own build + fast tests (NO domain verifiers) -> integration-reviewer as the SOLE independent gate | ONLY on the user's explicit cost opt-in - never routed to by the decision ladder. The skipped layer is where MATERIAL catches happen - measured twice: findings the integration gate did not re-find, and a same-task A/B where this mode SHIPPED a live-app ship-blocker (dead browser app, green unit suites, curl-level E2E blind to it) that the full mode caught and fixed. Tell the integration-reviewer it is the only independent gate and name the accepted risk at the mode stop | high (measured ~34% cheaper than the full run on the same task) |

`domain_trio` and `fanout_domain_trio` run per `references/domain-trio-protocol.md` - the single-stack vertical's execution protocol; Read it the moment either mode is picked. cross_domain_light, full_cross_domain and cross_without_domain_verifiers are the producer-first flow in the skill body (the verifier-less mode differs only in the skipped domain-verifier seats and the integration brief).

## Decision ladder

```text
tiny and one-domain                                 -> single_chat
small OR medium, one-domain, no risk trigger        -> implementer_only   (the lightest dispatch rung)
one-domain WITH a risk trigger (auth / migration /
  data-loss / concurrency / security / big refactor) -> domain_trio
large/risky, one-domain                             -> fanout_domain_trio
2+ domains, routine stable seam             -> cross_domain_light
novel or risky seam (new public/versioned API,
  streaming/eventing, auth, migrations,
  deployment order) or production-critical  -> full_cross_domain
```

## Single-chat and implementer-only

`single_chat` - plan lightly, edit, run focused validation, report. For: a typo, a rename, one validation message, one failing unit test, a CSS class, an endpoint response mapping with no contract change.

`implementer_only` - main session dispatches one domain implementer, then runs build/test/review itself. For: a backend-only endpoint tweak, a frontend-only component fix, a DB-only migration correction, a WPF-only ViewModel bug, an Ionic-only permission-wrapper update, a devops-only CI config fix.

The line between them is **discovery**: when the edit site is already known - a named file, a 1-2 line change the request or a diagnosis has already localized - `single_chat` does it in the main session at zero seat cost. Reserve `implementer_only` for when the seat must first *find* where to edit, or the change touches several files in the domain. Spinning a full seat for a known one-liner is the trivial-blast-radius overuse the modes exist to avoid. (The issue-flow sibling of this rung is `direct_fix` in `references/issue-investigation.md` - a diagnoser-localized trivial fix the main session applies without a separate implementer + verifier.)

De-escalation runs the same way, a step DOWN the ladder. A pure presentational leaf - a component with no interaction, reactive subscriptions, routing, API, or shared-state surface (a property the designer's verdict already carries) - drops from `domain_trio` to `implementer_only` plus a main-session check, rather than paying an opus designer and an xhigh verifier for a labelled span. A blocked dispatch is NEVER a de-escalation trigger: when the approval-gate hook stops a seat, the recovery is the plan-approval stop the block message names, not a silent drop to `single_chat` (measured: one session answered the block by self-authorizing a two-rung drop and building inline, shipping the runtime defect the gated flow's verify step catches). The lever is the lighter MODE, not a lighter verify effort: per the model/effort asymmetry `references/model-routing.md` owns, a trivial blast radius is made cheaper by choosing fewer / lighter seats, never by dialing a dispatched seat's effort down.

## Route by risk, not size - what the verifier is worth

The independent verifier (`domain_trio`+) is the flow's main cost premium: a fresh seat that re-runs the gates and catches a defect the implementer missed - but at roughly double the tokens of one self-verifying context. So it is **opt-in on risk, not the default**. Convene it only when the work trips an explicit **risk trigger**: auth, a migration or other data-loss exposure, concurrency, security-sensitive behavior, a shared contract seam, or a large refactor. Ordinary single-domain features - even medium ones that carry a boundary, overflow, or reactivity edge - do NOT convene it; they run in `implementer_only`, where the main session builds and self-verifies.

So the trio's trigger is an explicit risk (the escalation-guardrail set below), not task size and not a merely non-obvious edge. **The deliberate trade:** below that bar a medium feature is self-verified by the one context that wrote it, so a subtle edge-case defect - an int32 overflow on an unbounded page, a reactivity slip - CAN ship, because no independent seat re-derives it. That is accepted on purpose: it roughly halves the token cost of ordinary single-domain work, and the risk triggers still force the mode UP the instant real, costly risk (auth, migration, data-loss, cross-domain, security, large refactor, unclear legacy) appears - so the independent gate is spent where a bug is expensive, not on every medium feature. One measured exception to 'inline is cheaper': a MULTI-SLICE feature run inline on a small model ground to 2-3x its dispatched-trio cost with the thinnest test suite - when the plan decomposes into parallel slices, dispatch beats inline on cost, not just isolation. A convened trio can still run its mechanical task cards on haiku - the designer assigns each task's implementer model, sonnet floor on risk (`references/model-routing.md`). Fewer seats is the token lever that dominates all per-seat tuning; this rung is how you pull it.

## Escalation guardrails

A scaled-down mode must stop and escalate the moment it detects any of:

```text
cross-domain contract impact      auth / authorization risk
migration or data-loss risk       deployment-order risk
security-sensitive behavior       large refactor surface
unclear legacy behavior
```

Escalate one step:

```text
single_chat        -> implementer_only or domain_trio
implementer_only   -> domain_trio
one-domain mode    -> cross_domain_light or full_cross_domain
```

## Per-mode model, by example

The mode carries the seat set; each seat's effort is its own pin. Angular, three sizes:

```yaml
angular_small:   # one component/file, no API/auth/state change
  flow: single_chat or web-angular-implementer only
  model: { implementer: sonnet-medium }
angular_medium:  # new page, local state or API service, tests, contract unchanged
  flow: [web-angular-solution-designer, web-angular-implementer, web-angular-verifier]
  model: { designer: opus-xhigh, implementer: sonnet-medium, verifier: sonnet-xhigh }
angular_large:   # multiple areas, auth-sensitive UI, complex state, or a cross-domain API change
  flow: [web-angular-solution-designer, web-angular-implementer x N, web-angular-verifier]
  model: { designer: opus-xhigh, implementers: sonnet-medium, verifier: sonnet-xhigh }
```

These values illustrate the per-mode floor and rationale; they are not a per-dispatch dial. What the orchestrator can and cannot vary per dispatch - model yes (including the guarded-Haiku implementer down-dispatch), effort no - is the asymmetry `references/model-routing.md` owns. So the primary cost lever is the MODE / seat-count, not a re-dialed seat: `single_chat` and `implementer_only` skip the designer and the verifier entirely, which saves far more than running any dispatched seat a shade cheaper. A heavier need escalates to a higher mode or a heavier seat (the in-session scoping pass -> the deliberate alfred-capture-architecture capture, a domain verifier -> integration-reviewer), per the same policy. Capability wiring - the documentation server before a library API, a memory note read instead of a re-derivation - is the other lever the mode carries; see `references/capability-reuse.md`.

## Team Lead routing output

Emit compact metadata, not repeated prompts:

```yaml
task_id: ANG-042
domain: web-angular
classification: medium
risk_level: medium
flow: domain_trio
agents: [web-angular-solution-designer, web-angular-implementer, web-angular-verifier]
contract_version: none
reason: [adds a routed page, form validation, needs tests, no backend contract change]
```

## Issue / bug modes

For a bug, incident, CI failure, flaky test, or unclear behavior, do not use the feature modes - route through `references/issue-investigation.md`, which defines `investigation_only`, `investigation_safe_fix`, `ci_repair_loop`, `cross_domain_issue_fix`, and `security_issue_fix`. The rule is: diagnose before coding.

## Cost rules

```text
Do not run full_cross_domain by default. Use single_chat for tiny tasks,
implementer_only for small AND medium domain-local work with no risk trigger,
domain_trio only when a risk trigger fires (the decision ladder above).
Use full_cross_domain only when cross-domain coordination risk justifies the cost.
The full flow costs 2x-5x the tokens of a single chat - parallelism buys wall-clock
and separation of concerns, not tokens.
```
