---
name: alfred-task-version-upgrade
description: "Use when planning a breaking upgrade - 'upgrade to .NET 10', 'ng update to v20', 'this package's new major breaks us'. Not for routine bumps."
disable-model-invocation: true
---

# Project Version Upgrade - Plan, Approve, Execute (Deliberate)

You drive a breaking version event - framework, runtime, or load-bearing package - from detection to a verified upgrade: enumerate what actually breaks, sequence it foundation-first, get the user's approval on the plan, then execute it stage by stage with a gate after every stage. Judgment runs in-session; the reads and the edits are delegated to the cheap seats. This skill carries NO `model` pin for that judgment, deliberately: a skill-level `model` pin applies only for the rest of the turn in which the skill activates and is not saved to settings, so a multi-turn run returns to the session model (measured: invocations ran on the session model, while agent-level pins in the same session held exactly), so check the session model at run start: when it is not Opus, say so in the first thing the user sees, so the switch to `/model` Opus can happen before the plan is reasoned.

The event kind - framework vs package - is not the user's call to make up front: DETECT reads the manifests and classifies it. The workflow is identical either way; only the breaking-change surface differs. A routine minor/patch bump with no breaking changes needs none of this - say so and exit.

Read `references/upgrade-playbooks.md` before PLAN - the stack-keyed sequencing rules and the runtime-break catalog are this skill's contract, not suggestions.

## When to use

- The deliberate version-upgrade flow for any BREAKING version event - a framework or runtime major, an EOL, a load-bearing package's breaking major: plan in-session (the published breaking-change surface crossed against located usage - applicable changes only), present the staged plan at an approval gate, then drive the execution stage by stage with a green gate after every stage.
- Triggers also on 'plan the framework upgrade'. Routine non-breaking bumps need no skill: just bump.
- Auto mode - skipping the approval gate - runs ONLY when the user explicitly asked for it.
- Not for a feature that merely needs a newer package (the feature's own flow), or a red CI pipeline (alfred-issue-diagnoser-ci, or its single-chat CI-triage twin).

## Approval gate - and the explicit auto mode

The staged plan is presented and NOTHING is edited until the user approves - an upgrade is consequential. Two answers end the run early: 'just the plan' (exit after PLAN, hand over the plan) and 'stop'.

**Auto mode skips the gate - only when the user explicitly asked for it in the invocation** ('run it in auto mode', '/alfred-task-version-upgrade --auto'). Never infer auto from urgency, from a clean plan, or from past runs; absent those words, the gate stands. Auto mode still stops on every hard signal below - it skips the approval pause, not the safety rails. (Side effect worth knowing: an auto run never pauses, so the model the session is on at run start carries the whole run; a gated run can switch at the approval pause and drop to a cheaper model for execution.)

## The run

### 1. DETECT
Green baseline first - build + tests green, zero pending EF migrations, before a single version moves; a red or drifted baseline is a blocking precondition, report it and stop, never plan around it. Then read the manifests (`global.json`, `*.csproj` / `Directory.Packages.props`, `package.json` / `angular.json`), pin current -> target versions and the trigger (major, EOL, security advisory), and classify the event and the stacks it touches. No breaking surface -> routine bump, exit.

### 2. GATHER - delegated
- **the documentation server** (load-bearing - the library-docs MCP every install carries): the target's published breaking-change surface - the migration guide, deprecations-and-removals, the version delta - never from recall. When it is unreachable, the surface is the vendor's migration guide the user pastes or fetches, and a breaking change no doc backs is marked `unverified` in the plan, never asserted. Branch by stack per the playbooks: what a migration tool auto-applies (`ng update` schematics on Angular; on .NET whatever the current porting docs name - the Upgrade Assistant is deprecated) versus hand edits.
- **architecture-analyzer (sonnet/medium)** per affected area, dispatched exactly as the roster spells it (`alfred-code:<seat>` where the core plugin carries it): where the codebase actually uses the changed/deprecated APIs - located usage digests, reads kept off this context. Mine the build's own signals first (the `[Obsolete]`/analyzer warnings, `ng update`/`ng lint` deprecation notices) - they are the framework's pre-computed removal map.

### 3. PLAN - in-session
Cross the surface against located usage: a breaking change nothing uses is not a task. Split engine-applied vs hand edits. Sequence foundation-first per the playbooks (SDK pin -> TFM -> framework packages in lockstep -> code edits on .NET; one major at a time with `ng update` + the peer matrix on Angular). Each stage carries: its edits, its verification command, its rollback point. Genuinely user-level calls (accept a new major's baseline, drop a deprecated dependency) go to the gate as questions, never guessed. **Hard cap: 2 planning passes.**

### 4. APPROVAL GATE
Present the staged plan, then put the gate through AskUserQuestion as ONE call - free text stays available via Other, and the PLAN step's user-level calls join the same call as their own questions (plain-text options where the harness lacks the tool). With no user-level call open:

```ask
The staged plan is ready: <n> stages, each with its verification and rollback point. Execute it stage by stage.
- 'Approve - execute the stages (Recommended)' - each stage runs and gates green before the next
- 'Just the plan' - exit here and hand over the plan
- 'Stop - changes needed' - say what changes in Other
```

With a user-level call still open, executing would guess its answer, so the plan is the recommendation:

```ask
The staged plan is ready, but <n> user-level call(s) are open. Take the plan and settle them first.
- 'Just the plan (Recommended)' - exit here with the plan; the open calls are yours to settle
- 'Approve - execute the stages' - run the stages on the answers given in this same call
- 'Stop - changes needed' - say what changes in Other
```

Auto mode (explicitly requested) proceeds without the pause.

### 5. EXECUTE - stage by stage
Before the first implementer dispatch, write the approval gate file `<docs-path>/flow/APPROVAL` - first line `APPROVED <plan id> - "<the user's words, verbatim>"` from the gate's approving answer, or `AUTO - "<their words, verbatim>"` from the auto-mode invocation - the dispatch hook blocks an unstamped implementer; delete the file when the run completes. Write the stamp at the ABSOLUTE path `${CLAUDE_PROJECT_DIR}/<docs-path>/flow/APPROVAL` with the Write tool. Only where the docs root still sits under `.claude/` (the old `.claude/docs` default, kept) is the write protected: a prompt for it offers 'Yes, and allow Claude to edit files in this project's .claude folder for this session' - take that, since `permissions.allow` cannot pre-approve it. A relative write follows whatever cwd the shell drifted to and the dispatch then bounces. The stamp belongs to the session that dispatches - written when its own decision lands, deleted at its own close; an earlier session's leftover stamp is not consent. If BOTH the Write tool and an absolute-path Bash write are refused by the harness's classifier, stop and put the choice through AskUserQuestion (retry the stamp, or run this stage inline) rather than retrying blind or dispatching around the gate.

Per stage, in the plan's order: dispatch the domain **implementer (sonnet/medium)** with the stage as a scoped brief (trivial manifest bumps: edit inline); run the stage's verification (build + tests); a red routes to the matching **resolver (sonnet/high)** for that stack - the seat covering build errors, or the one covering test failures, matched from your installed agents; with none matching, resolve the red inline and say so; gate green before the next stage. Hard stops, auto mode included: a resolver returning BLOCKED_CONTRACT_CHANGE, a stage that stays red after its resolver pass, or reality contradicting the plan - stop and re-plan, never push through or skip a stage gate.

### 6. VERIFY + REPORT
Full suite green at the end; on a large upgrade, optionally the domain **verifier (sonnet/xhigh)** over the assembled result. Report: current -> target, stages landed and what each changed, runtime-break checks done, anything deferred or user-declined, the rollback points. If the run stopped early: which stage, why, and the state it left. Shaped like:

```
.NET 8 -> 10: 4 stages landed, full suite green (412 passed)
  1 SDK pin + global.json (rollback a1b2c3d)   2 TFM + framework packages in lockstep
  3 obsolete-API swaps (SYSLIB warnings)       4 hand edits - TimeProvider swap, 3 call sites
runtime-break checks: serializer defaults reviewed, zero [Obsolete] warnings left
deferred: FluentAssertions major (user-declined)
```

## Don't game it
Enumerate the real breaking changes from the framework's own docs, not recall - recall catches the compile break and ships the runtime break. Keep the plan to located usage. Never wave a deprecation off as 'probably fine' - unclear impact is marked to verify. Never weaken a test, suppress a warning, or skip a stage gate to make a stage look green - that is a new break, not progress. Auto mode is the user's word only - proceeding past the gate without it is a protocol violation, not initiative.
