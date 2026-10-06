# Model Routing

The Team Lead does not pick arbitrary model names. It classifies the task; this policy maps task class and risk to the seat and effort. In this stack every seat already carries a static model/effort pin in its frontmatter; the table below is the floor and the rationale behind those pins, several of which sit a shade above their floor (reconciled in the note after the table). This policy is the guide for when the orchestrator escalates, by choosing a heavier seat (the in-session scoping pass -> the deliberate capture-architecture capture, a domain verifier -> integration-reviewer) or by classifying the work into a higher mode.

Team Lead output stays compact:

```yaml
task_class: medium_feature
risk: [auth, database_migration]
domains: [data, backend]
routing:
  solution_designer: opus-xhigh
  implementer: sonnet-medium
  verifier: sonnet-xhigh
  final_reviewer: opus-xhigh
```

## Default routing table

| Role | Default | Escalate when |
|---|---|---|
| BA / requirements clarification | sonnet high | opus high for very ambiguous product logic or a regulated domain |
| Team Lead / orchestrator | sonnet high | opus high/xhigh for large cross-stack decomposition |
| Domain Solution Designer | opus high | opus xhigh for backend / data / devops / security / major architecture risk - and the producer designer whose interface section is the cross-domain contract |
| Implementer | sonnet medium | sonnet high for auth, migrations, concurrency, messaging, devops, security-sensitive code, large refactors, legacy unknowns |
| Domain Verifier | sonnet high | sonnet xhigh for auth, data, devops, security, contract-sensitive work |
| Integration Reviewer | sonnet xhigh | opus xhigh for cross-domain contract changes, production-critical, or security-sensitive features |
| Repair Agents | sonnet high | opus only for hard root-cause diagnosis, not routine compile/test failures |
| Evidence Gatherer | haiku or sonnet low | sonnet medium when evidence collection needs repo understanding |

The house pins land a shade above several of these floors where the seat's job justifies it: the domain designers are opus/xhigh (design mistakes are the most expensive to unwind), the domain verifiers sonnet/xhigh, the implementers sonnet/medium, the integration-reviewer sonnet/xhigh (the last gate before a cross-domain commit - a verifier's pin for a verifier's job), and the evidence-gatherer sonnet/low. Three read-only reasoners sit on opus: issue-diagnoser-runtime opus/xhigh (the Repair Agents row's hard root-cause diagnosis - it isolates the cause to a file and symbol from digests it never gathered, and a wrong cause sends every later fix the wrong way), issue-diagnoser-ci opus/high (its verdict matches each failing job against the preloaded CI signature catalogue - code or environment - which needs less depth, so a pin audit took it down from xhigh) and security-auditor opus/xhigh (an adversarial sweep, where a missed exploitable path ships). The diagnosers hand the log and file volume to sonnet evidence-gatherers, so opus pays for the reasoning alone. The three pins date from the seats' creation and carry no A/B against a sonnet pin yet; that measurement, not this note, is what moves one.

One caveat on the Escalate-when column: an entry that raises the MODEL is applied per dispatch (the Team Lead overrides the model when it dispatches the seat - a per-dispatch model override is verified to fire in a headless flow run and to beat the seat's frontmatter pin, so this is a real lever, not just a contract promise); an entry that raises the EFFORT is not - effort is fixed at the seat's frontmatter pin and is not re-tunable per call. The cascading seats are already pinned at their escalated effort (designers/verifiers/integration-reviewer at xhigh), so they always run there. Where a seat is pinned below its escalate effort - the implementer at medium, the evidence-gatherer at low - that risk is carried by escalating the MODE (fanout_domain_trio, a mandatory verifier pass) and by the loaded skill, not by a per-dispatch effort bump the seat cannot receive. The same asymmetry runs downward: a trivial blast radius - a presentational leaf, a diagnoser-localized one-liner - cannot be made cheaper by dialing a seat's effort down; it is made cheaper by choosing a lighter MODE (fewer seats), per `references/execution-modes.md`.

**Guarded per-task implementer model - the designer assigns it.** The implementer stays PINNED sonnet/medium - that pin is the safe default that keeps `implementer_only` and `single_chat` protected, and the fallback when no per-task model is set. Inside a guarded mode (`domain_trio` / `fanout_domain_trio`, where an opus/xhigh designer front-loads the judgment AND an independent sonnet/xhigh verifier re-runs the gates), the solution-designer - the seat that just decomposed the work and knows each task's difficulty - stamps each task card with an `implementer_model`, and the orchestrator dispatches that task's implementer with it as the per-dispatch override (verified to fire headless and beat the pin, G1). The assignment rule:

- **`haiku`** for a mechanical / low-risk task whose correctness is obvious on the diff (a CRUD slice, a mapper, a presentational piece).
- **`sonnet`** for a task that needs more advanced implementation, subtle logic, or non-trivial judgment.
- **`sonnet` FLOOR - never haiku** for any task carrying a risk trigger (auth, migration, concurrency, security, a shared contract seam, unclear legacy), however small it looks. The designer already names these traps; it must honor them when it assigns.

So one trio can mix models per task - tasks 1 and 2 on haiku because they are easy, task 3 on sonnet because it needs the advanced build - and each task pays for exactly the capability it needs, instead of one blunt per-mode setting. Two hard limits hold: this lives with the DESIGNER, so it only applies in guarded modes (a designer implies the verifier gates the result); `implementer_only` / `single_chat` have no designer and default to the sonnet pin. And it is never a static frontmatter pin - the pin stays sonnet so the unguarded modes can never inherit haiku. Haiku execution was MEASURED green (B4, B5, a fresh bulk-complete cell - all independently test-verified); it pays most on implementer-heavy single-stack work (the implement layer is ~3x cheaper; design + verify still dominate the total). Only the model varies per task; effort stays the frontmatter pin.

## Strict cost rules

Use `max` rarely - only for very ambiguous requirements, a critical architecture decision, a large refactor across many projects, a security-sensitive redesign, a production-incident root cause, or a framework upgrade with many breaking changes.

Do not use opus for ordinary implementers by default. Do not use sonnet low for serious implementation by default. Do not duplicate a seat just to vary effort - the pin plus this escalation table covers it.
