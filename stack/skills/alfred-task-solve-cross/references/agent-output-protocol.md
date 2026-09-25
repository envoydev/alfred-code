# Agent Output Protocol and Progress Ledger

Every seat returns structured output - never free-form only - so the orchestrator can route on status without re-reading the whole result. The orchestrator keeps a durable ledger so a long run survives context compaction.

## Contents

- Status vocabulary
- Designer output
- Implementer output
- Verifier output
- Integration gate output
- Progress ledger
- Task-card template
- Verification-report template

## Status vocabulary

Five run statuses, shared across the seats that do work:

```text
DONE                     - complete, verifier will check it
DONE_WITH_CONCERNS       - complete but carrying a flagged risk to forward
NEEDS_CONTEXT            - a contract gap, OR an ambiguous / underspecified requirement the designer must not guess: bounce it back for the orchestrator to clarify with the user before re-dispatch
BLOCKED                  - a dependency task must land first; sequence after it
BLOCKED_CONTRACT_CHANGE  - the frozen contract cannot be met; emit a Contract Change Request
```

Designers add PLAN_READY; verifiers use their own verdict set (below). BLOCKED_CONTRACT_CHANGE is the one that pauses lanes - see `references/contract-protocol.md`.

A BLOCKED status names WHAT is blocked, and both sides check the grain: a seat emits BLOCKED only for the sub-part the dependency actually gates, finishing the rest of its task first; the orchestrator receiving BLOCKED checks whether it covers the whole task or one sub-part before pausing anything wider than the blocked slice (measured: one whole lane paused on a status whose blocker gated a single follow-up step).

## Designer output

```yaml
agent: aspnet-solution-designer
domain: backend
contract_version: v1
status: PLAN_READY | NEEDS_CONTEXT | BLOCKED_CONTRACT_CHANGE
summary: ...
tasks:
  - task_id: backend-01
    title: ...
    scope: []
    acceptance: []            # the observable behavior / passing test that proves the slice done
    dependencies: []
    allowed_files_or_areas: []
    anchors: []               # file:symbol the designer located - the implementer jumps to these, skipping re-navigation
    log_points: []            # the observability the designer decided for this slice - where a line goes, at what level, with which identifiers (boundary crossings, decision points, every failure exit; 'framework-emitted' where the platform already logs it)
    forbidden_changes: []
    implementer_model: haiku | sonnet   # designer-assigned by task difficulty; sonnet floors any risk trigger
verification_notes: []
```

## Implementer output

```yaml
agent: aspnet-implementer
task_id: backend-02
domain: backend
contract_version: v2
status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED | BLOCKED_CONTRACT_CHANGE
summary: ...
files_changed:
  - { path: src/..., reason: ... }
tests_added_or_changed:
  - { path: tests/... }
validation_performed:
  - dotnet test ...
regression_proof: [none]        # a spec proven red against the pre-fix code / a captured repro - recorded so the verifier CONFIRMS the artifact, not re-derives the repro
risks_or_concerns: [...]
ceilings: [none]                # where | limit | revisit when - one row per deliberate simplification; the close files them
contract_deviations: [none]
next_recommended_action: [run aspnet-verifier]
```

## Verifier output

```yaml
agent: aspnet-verifier
domain: backend
contract_version: v2
status: SIGNED_OFF | PUNCH_LIST | BLOCKED_BY_BUILD | BLOCKED_BY_TESTS | CONTRACT_MISMATCH
summary: ...
checks_performed: [build, tests, architecture boundaries, auth behavior, error handling]
findings:
  - { severity: high, task_owner: backend-02, problem: ..., required_fix: ... }
signoff: false
```

A finding's severity is a claim: the orchestrator re-checks each one against the anchors and the skip-list below before routing it to an owner, and the integration-reviewer holds its own findings to the same three paragraphs.

**Severity anchors.** `high` - a behavior the plan specified is broken, data can be lost or corrupted, a security check is missing, or a failure is hidden (below). `med` - a real defect on a path the tests skip, or contract drift a consumer will hit. `low` - nothing breaks today: naming, a comment, over-build, a style nit. A missing doc comment, a formatting nit or an over-build finding is never `high`.

**Not a finding.** Drop these rather than route them: a pattern the plan's `## Decisions` ledger or the project's code-style capture records as deliberate; a pre-existing issue in code the diff did not touch (a line in `summary`, never a task for an implementer); a test-only shortcut inside a test project (a fixed clock, a hard-coded fixture); a 'could fail under load' with no trigger condition named; a warning the build itself does not raise.

**A fallback that hides a failure** is its own class - `high` on a data, money or auth path, `med` elsewhere: a default value returned on error, `.catch(() => [])`, a `catch` that returns `null` or an empty list, `?? []` over a call that failed. The caller cannot tell 'empty' from 'broken', so the failure ships silent; the required fix surfaces it at the seam (a throw, a result type, or an error the caller can tell apart), never a quieter default.

## Integration gate output

The integration-reviewer closes cross-domain work:

```yaml
status: SIGNED_OFF | PUNCH_LIST | CONTRACT_MISMATCH | BLOCKED_BY_TESTS | BLOCKED_BY_SECURITY
contract_version: v2
summary: ...
required_fixes: []            # each keyed to the owning domain + file/symbol
commit_allowed: true | false
```

Commit is allowed only on SIGNED_OFF.

## Progress ledger

The orchestrator keeps a compact ledger - a short file, not just in-context notes - updated as each task and each verify pass reports:

```yaml
feature: user-invitations
current_contract: v2
plan_review: approved            # or waived - only on the user's explicit review-waiver words
lanes:
  data:
    phase: verified
    plan_audit: { risk: pass, scope: pass, existence: pass, edges: 1 gap re-briefed, soundness: pass }   # the five alfred-task-verify-plan verdicts, REQUIRED before the lane builds - an entry that cannot fill them is an audit that did not run
    tasks: { data-01: DONE, data-02: DONE_WITH_CONCERNS }
    verifier: SIGNED_OFF
  backend:
    phase: implementing
    tasks: { backend-01: DONE, backend-02: BLOCKED_CONTRACT_CHANGE }
    verifier: not_started
  web-angular:
    phase: paused_affected_by_contract_change
    tasks: {}
  wpf:    { phase: not_affected }
  ionic-angular: { phase: not_affected }
  devops: { phase: needs_rework_due_to_migration_order }
contract_changes:
  - { from: v1, to: v2, reason: partial unique index for soft delete }
final_gate: { status: not_started }
```

## Task-card template

What the orchestrator hands each implementer:

```yaml
task_id: backend-02
domain: backend
contract_version: v2
title: ...
scope: []
acceptance: []                # the observable proof of done
allowed_files_or_areas: []
anchors: []                    # file:symbol the designer located - the implementer jumps to these, skipping re-navigation
log_points: []                 # copied from the designer's card verbatim - the implementer places them through the repo's logging seam, the verifier checks level + identifiers against them
forbidden_changes: []          # the shared seams this task must not touch
dependencies: []
implementer_model: haiku | sonnet   # designer-assigned by task difficulty; sonnet floors any risk trigger
```

## Verification-report template

What a verifier (or the integration gate) hands back, so the orchestrator can loop the punch-list to the right owner:

```yaml
status: SIGNED_OFF | PUNCH_LIST | BLOCKED_BY_BUILD | BLOCKED_BY_TESTS | CONTRACT_MISMATCH   # the integration gate adds BLOCKED_BY_SECURITY
contract_version: v2
commands_run: []               # build / test output, quoted, not pasted from the implementer
findings:
  - { severity: high | med | low, task_owner: backend-02, file_symbol: ..., problem: ..., required_fix: ... }
signoff: true | false
```
