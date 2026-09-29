---
name: alfred-issue-signatures-ci
description: "Use when CI or a PR check goes red - red CI, passes locally but fails in CI, NU1301, ERESOLVE, exit 137. Not for a local crash or authoring CI/CD."
---

# CI Triage - turn a red pipeline into a verdict and a route

A red check is not automatically a code bug. The highest-value call in CI triage is the red-in-CI, green-locally delta: is this a real defect CI merely surfaced first, or an environment / pin / config / workflow failure that never touched the code? Route a config or runner failure to a code fix and you thrash on code that was never wrong. This is the single-chat form of the alfred-issue-diagnoser-ci seat - match the failure to a signature, make that call, and route it, all in the current context. It is the CI sibling of the local-runtime signature catalogue (a crash on your own machine) and runs on `alfred-habits-root-cause` - read the full error, quote the part that matters, form one hypothesis, and prove it with a check before changing anything.

## When to use

- Also a workflow YAML that broke, or a flaky pipeline to separate from a real defect.
- A crash on your own machine goes to the runtime failure-signatures skill; authoring CI/CD to the pipeline-authoring house skill.

## First: pull the right log, read the right line

- Confirm it is actually red before spending the triage - `gh pr checks`; a re-run or a later push may already be green.
- Resolve the failing run from the PR head branch, then pull only the failed step: `gh run list --branch <head> --json databaseId,conclusion`, then `gh run view <id> --log-failed`. When `--log-failed` is empty or unrevealing (a fatal warning promoted in an earlier green step is invisible to it), fall back to the full step log.
- Read the FIRST error, not the tail - the first `error CS####` / compile line is the signal; the `Build FAILED` block and the final count just restate it. On GitHub Actions the real error is often an `##[error]` line inside a collapsed group, timestamp-prefixed and colorized - grep loose (a substring, not an exact string).

## The signatures - what each means and where the fix lives

- **Compile / restore.** A CS/NG/TS compile error is code - fix it. A restore red is usually NOT the code: a lockfile out of sync with the manifest - `NU1004` under `dotnet restore --locked-mode`, `npm ci` refusing a `package-lock.json` that no longer matches `package.json` - so a locked restore fails where a loose install would silently update; an unresolvable version set (npm `ERESOLVE` on a peer conflict, `ETARGET` when no version matches the range); a private feed the runner cannot reach or auth to (`NU1301` - the source, not the package); a package no configured source carries (`NU1101` - a wrong id or version, or a missing source); a rate-limited registry; or a stale cache key replaying an old package set. Fix the lockfile or the feed, not the code.
- **Green locally, red only on the runner** (reach here first when your local run passed). Case-sensitivity - a Linux runner is case-sensitive, so an import whose casing differs from the file builds on mac/Windows and fails only in CI. A file present locally but never committed, so the clean checkout lacks it. A Debug-vs-Release gap (a Release-only analyzer, a DEBUG-conditional path). A missing CI-only secret or env var. Tool-version skew - `global.json` rollForward, `.nvmrc` / engines, the JDK or Xcode the runner image pins, a floating vs SHA-pinned action. The fix is the workflow or a pin, not the code.
- **Quality gate.** The .NET gate is a build with warnings promoted to errors plus a formatter check; a red here is committed formatting drift or a newly-promoted analyzer, not a compile break. The fix is the code - and any instinct to silence the warning or downgrade the severity is the reward-hack to resist.
- **Signing / release** (mobile). An expired distribution cert or provisioning profile, a rotated store API key, a non-incrementing build number, a keystore-secret decode failure, or native built off a stale bundle because the sync step was skipped. Pipeline config, not app code - route the fix through the skill covering mobile build, signing, and store submission; a project without one fixes it from its own pipeline definition.
- **Workflow-config drift.** The YAML itself - a renamed job, a broken `needs:` or matrix leg, a wrong working-directory, a bumped action. A red check whose log shows the tool never ran is config; it routes back to you, never to a code fix.
- **Infra flake** (name the non-determinism, never bare 'flaky'). Test-ordering or shared static state (passes isolated, fails in the full parallel run); real-clock or real-network timing (a real HTTP call, a real timer that needed fake time, an implicit wait); or infra (`exit 137` = OOM/SIGKILL, `exit 143` = SIGTERM/timeout, disk-full, a container-pull blip). Proof is a re-run with no code change passing (`gh run rerun --failed`).

## Execution modes

This catalogue is single-sourced: the alfred-issue-diagnoser-ci seat preloads this same file, so the
inline and seated forms never drift. Loaded INSIDE the seat, this section is already satisfied -
the seat is the dispatched form, and the rest of this section is not read there. Loaded in the
MAIN session, run the triage HERE and Read `references/gatherer-fan-out.md` before deciding on
evidence-gatherers - the inherit-or-ask rule, the four dispatch triggers, the stay-inline shape
and a worked fan-out are that file. Either way, dispatch is explicit-only house-wide, so the seats
never start on your own say-so. Do NOT dispatch the diagnoser seat from this skill - the
signatures are already in context, so the seat would only duplicate them; the seat exists for the
orchestrated issue flow and direct @agent- calls, where it runs this same file in an isolated
context with the same gatherer fan-out.

## Route it

State the verdict per failing job: the signature, the code-vs-environment call, and where it goes - a code defect to the fix (the matching build/test resolver in the flow, or fix it inline), an environment / pin / workflow delta back to you with the named delta, a proven flake to a re-run. Never route a config or runner failure to a code fix. If the evidence does not fit a signature, say so and pull the fuller log rather than force-fit one. Every verdict names the check that would prove it and the run quotes that check's output: a code verdict is proven by the failing test going green, a flake by `gh run rerun --failed` passing with no change, and a config, feed or pin verdict by a re-run after the named delta was fixed and nothing else touched - an unproven verdict is reported as unproven, never as the call.

Worked example - the failed step's first error line reads:

```text
error NU1301: Unable to load the service index for source https://pkgs.example.com/nuget/v3/index.json. Response status code does not indicate success: 401 (Unauthorized).
```

The three-line verdict it produces:

```text
signature: restore - NU1301 against the private feed, 401
call: environment - the runner's feed credential expired; the code and lockfile never changed
route: fix the feed secret in the workflow, then re-run; no code fix
```
