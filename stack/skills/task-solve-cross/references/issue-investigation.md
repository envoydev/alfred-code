# Issue Investigation Flow

Bugs, CI failures, incidents, runtime errors, flaky tests, and unclear behavior use a different flow from feature work. Do NOT start them on the feature path (clarify -> scope -> solution designers -> implementers). Start with evidence and diagnosis.

## Contents

- Issue-flow seats
- Investigation-only mode
- Investigation + optional fix mode
- Fix routing rules
- Issue execution modes
- Parallelism
- Final report
- Task card
- Anti-patterns

```text
Issue / failure report
  -> triage
  -> issue-diagnoser-runtime or issue-diagnoser-ci
  -> parallel evidence-gatherer agents
  -> diagnosis report
  -> fix decision gate: stop | resolver loop | single-domain fix | cross-domain fix
```

The strict rule:

```text
Diagnose before coding.
Evidence-gatherers may run in parallel (read-only).
Implementers do not start until the diagnosis is proven or the fix route is explicitly approved.
When the fix dispatches, the task card embeds the diagnosis report VERBATIM - root cause, files,
evidence, fix plan - never a pointer to it: a fix seat that re-derives the diagnosis pays for the
investigation twice (measured: a three-file fix spent most of its turns re-establishing what the
card could have carried).
```

issue-diagnoser-runtime is the bug-side equivalent of a solution designer - it plans and routes the fix once it has evidence; it does not write the fix.

## Issue-flow seats

| Seat | Responsibility | Writes code |
|---|---|---|
| issue-diagnoser-runtime | reproduce/isolate root cause from logs, errors, screenshots, code paths; produce diagnosis + fix plan | no |
| issue-diagnoser-ci | read failing CI/build/test output; identify the broken domain and fix route | no |
| evidence-gatherer | cheap read-only helper for repro, log extraction, stack traces, code refs, recent diffs, env facts | no |
| repair resolvers | bounded red-to-green loops for compile/test failures | yes |
| domain implementers | implement the approved fix once root cause is known | yes |
| domain verifiers | verify the fix against diagnosis, reproduction, tests, and contract | no / read-only preferred |
| integration-reviewer | check cross-domain issue fixes; block merging a partial fix | no / read-only preferred |

The two diagnosers dispatching a read-only evidence-gatherer (exactly as the roster spells it, `alfred-code:<seat>` where the core plugin carries it) is the stack's one sanctioned nested dispatch. Gathering is observation, not a fix, so parallel gather-tasks do not break the one-change-at-a-time debugging discipline.

## Investigation-only mode

Use when the user asks to investigate, find root cause, explain what is broken, or check why CI failed. Diagnose, then STOP - do not implement unless the user or policy asks for a fix.

```yaml
status: DIAGNOSED | NOT_REPRODUCED | NEEDS_MORE_EVIDENCE | LIKELY_FLAKE | INCONCLUSIVE
confidence: high | medium | low
root_cause:
  summary:
  files: [{ path:, symbol:, reason: }]
severity: critical | high | medium | low     # blast radius: data-loss/corruption or outage = critical .. cosmetic / no data impact = low
priority: P0 | P1 | P2 | P3                   # urgency on the P0-P3 ladder, NEVER a bare High/Med/Low (that is a severity): P0 outage/data-loss now, P1 blocks the release, P2 fix soon / has a workaround, P3 backlog
evidence:
  - { type: log | stack_trace | failing_command | screenshot | code_reference | repro_step, detail: }
affected_domains: [backend | data | web-angular | wpf | winforms | console | windows-service | ionic-angular | browser-extension | devops]
fix_recommendation:
  route: no_fix_needed | resolver | single_domain_implementer | cross_domain_contract_change | user_decision_needed
fix_plan: [{ step: }]
risk: [regression, migration/data-loss, security]
open_questions: [{ question: }]
```

**Level by rule, not by feel.** Severity is blast radius; priority is urgency. Decide each against the ladder below - do not default a wrong-but-recoverable bug to High/P1:

```text
severity: data-loss / corruption / security exposure / full outage      = critical
          a core flow broken with no workaround                         = high
          wrong-but-recoverable output, degraded or confusing behavior  = medium
          cosmetic, no functional or data impact                        = low
priority: data-loss or outage happening now                             = P0
          blocks the release or a core flow, no workaround              = P1
          wrong but display-only / recoverable / has a workaround       = P2   (fix soon)
          cosmetic or backlog                                           = P3
```

A display-only value that renders wrong with no data loss and a reload or re-nav workaround is **severity Medium, priority P2** - not P1. Reserve P0/P1 for data-loss, corruption, security exposure, or a broken core flow with no workaround.

## Investigation + optional fix mode

Use when the user asks to investigate and fix if obvious/safe. Diagnose, then pass an EXPLICIT fix decision gate - never slide silently from diagnosis into implementation.

```text
If safe/local:  domain implementer or resolver -> domain verifier -> final report.
If risky/cross-domain:  contract/fix plan -> affected domain pipelines -> integration-reviewer.
```

## Fix routing rules

```text
Build failure:  issue-diagnoser-ci -> dotnet-build-error-resolver or ng-build-error-resolver -> re-run build -> domain verifier
Test failure:   issue-diagnoser-runtime/issue-diagnoser-ci -> dotnet-test-failure-resolver or angular-test-resolver -> re-run focused tests -> domain verifier
Runtime bug, single domain:  issue-diagnoser-runtime -> domain implementer -> domain verifier   (the diagnosis replaces the designer step for a small proven bug - do not over-plan; a provably-trivial one-liner takes direct_fix, main session applies it, no separate implementer/verifier)
Runtime bug, multi domain:   issue-diagnoser-runtime (+ parallel evidence-gatherers) -> contract/fix plan -> per-domain implementer+verifier -> integration-reviewer
Security issue:  security-auditor -> OWASP/CWE punch-list -> affected domain implementers -> affected domain verifiers -> security re-check -> integration-reviewer if cross-domain
```

If a fix changes a shared contract, the issue flow uses the same BLOCKED_CONTRACT_CHANGE protocol as feature work (`references/contract-protocol.md`).

## Issue execution modes

| Mode | Use when | Flow |
|---|---|---|
| `investigation_only` | root cause / report only | issue-diagnoser-runtime -> evidence-gatherer(s) -> report |
| `direct_fix` | root cause is a diagnoser-localized, provably-trivial one-liner (flipped operator, off-by-one, constant, guard), no contract/security/data/migration surface | diagnose -> main session applies the fix + one focused test (no separate implementer or verifier seat) |
| `investigation_safe_fix` | root cause likely local, fix allowed if obvious | diagnose -> implementer/resolver -> verifier |
| `ci_repair_loop` | a build/test failure is the whole issue | issue-diagnoser-ci -> resolver -> verifier |
| `cross_domain_issue_fix` | bug spans DB/backend/frontend/mobile/devops or changes the contract | diagnose -> contract/fix plan -> affected domain flows -> integration-reviewer |
| `security_issue_fix` | a security finding or suspicious auth/data-exposure issue | security-auditor -> punch-list -> domain fixes -> security re-check |

`direct_fix` is the issue-side floor - the bug equivalent of `single_chat`. Use it ONLY when the diagnosis pins the fix to a single provably-trivial edit with no contract, security, data, or migration surface: the main session applies the one-line fix and runs one focused test to confirm, skipping the separate implementer and verifier seats. Anything with real blast radius escalates to `investigation_safe_fix`. Do not over-plan a one-character bug, and do not skip the trio for a fix whose blast radius you have not proven trivial.

## Parallelism

Parallel is encouraged in the evidence-gathering phase (reproduce, logs/traces, backend path, frontend path, DB schema, CI/runtime) - all read-only. Parallel CODING before diagnosis is forbidden: no backend, frontend, and data implementer all fixing at once before the root cause is known. Independent fix experiments are allowed only when explicitly sandboxed and not committed.

## Final report

```yaml
status: FIXED | DIAGNOSED_ONLY | NOT_REPRODUCED | PARTIALLY_FIXED | BLOCKED | INCONCLUSIVE
root_cause: { summary:, evidence: }
fix_applied: { changed_files:, summary:, contract_version: }
verification: { commands_run:, results:, reproduction_retested: true | false }
remaining_risk: [{ risk: }]
follow_up: [{ task: }]
```

## Task card

```yaml
task_id:
mode: investigation_only | direct_fix | investigation_safe_fix | ci_repair_loop | cross_domain_issue_fix | security_issue_fix
issue_summary:
source: { type: user_report | CI | log | screenshot | production_alert | test_failure }
reproduction: { known_steps:, expected:, actual: }
constraints: { can_modify_code:, require_user_approval_before_fix:, max_repair_iterations: }
affected_domains_guess: [data | backend | web-angular | wpf | winforms | console | windows-service | ionic-angular | browser-extension | devops]
allowed_agents: [issue-diagnoser-runtime, evidence-gatherer, issue-diagnoser-ci, domain implementers if fix approved]
stop_conditions: [diagnosis DIAGNOSED and fix not approved, diagnosis NOT_REPRODUCED, repair_iterations exceeded]
required_output: [diagnosis_report, evidence_list, fix_route, tests_or_repro_commands]
```

## Anti-patterns

```text
Do not code before root cause is known. Do not let evidence-gatherers write code.
Do not let issue-diagnoser-runtime implement the fix. Do not run full feature planning for a
tiny proven bug. Do not treat a test snapshot as truth without checking product behavior.
Do not silence or delete a failing test to make CI green. Do not change a shared
contract without a Contract Change Request. Do not keep all lanes running when one
finds a contract-breaking root cause. Do not merge after a resolver says green - a
domain verifier or the integration-reviewer must verify the fix route.
```
