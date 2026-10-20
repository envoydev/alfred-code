---
name: task-version-upgrade
description: "Use when planning a breaking upgrade - 'upgrade to .NET 10', 'ng update to v20', 'this package's new major breaks us'. Not for routine bumps."
disable-model-invocation: true
---

# Project Version Upgrade - Plan, Approve, Execute (Deliberate)

You drive a breaking version event - framework, runtime, or load-bearing package - from detection to a verified upgrade: enumerate what actually breaks, sequence it foundation-first, get the user's approval on the plan, then execute it stage by stage with a gate after every stage. Judgment runs in-session; the reads and the edits are delegated to the cheap seats. This skill carries NO `model` pin and asks for no model switch: the plan is reasoned on the session's model (a skill-level pin lasts only for the turn it activates in; measured: Sonnet at xhigh planned a .NET 8 to 10 upgrade as well as Opus did, at the same cost).

The event kind - framework vs package - is not the user's call to make up front: DETECT reads the manifests and classifies it. The workflow is identical either way; only the breaking-change surface differs. A routine minor/patch bump with no breaking changes needs none of this - say so and exit.

Read `references/upgrade-playbooks.md` before PLAN - the stack-keyed sequencing rules and the runtime-break catalog are this skill's contract, not suggestions. The printed plan's first line is the receipt: `playbooks: read - <the stack section(s) applied>`.

## When to use

- The deliberate version-upgrade flow for any BREAKING version event - a framework or runtime major, an EOL, a load-bearing package's breaking major: plan in-session (the published breaking-change surface crossed against located usage - applicable changes only), present the staged plan at an approval gate, then drive the execution stage by stage with a green gate after every stage.
- Triggers also on 'plan the framework upgrade'. Routine non-breaking bumps need no skill: just bump.
- `--auto-mode` - the run unattended - starts ONLY on the user's typed flag; its hard stops still wait for the user.
- Not for a feature that merely needs a newer package (the feature's own flow), or a red CI pipeline (issue-diagnoser-ci, or its single-chat CI-triage twin).

## Approval gate - and auto-mode

The staged plan is presented and NOTHING is edited until the user approves - an upgrade is consequential. Two answers end the run early: 'just the plan' (exit after PLAN, hand over the plan) and 'stop'.

**Under auto-mode the gate is answered, not skipped - and only when the user typed `--auto-mode` on the call.** Never infer it from urgency, from a clean plan, or from past runs; the old `--auto`, 'auto mode' or bare `auto-mode` wording starts nothing, and the gate stands. The hook takes the gate's `(Recommended)` option, so an open user-level call still ends the run at 'Just the plan'. The hard stops in step 5 stay rails: under auto-mode their ask goes out with no `(Recommended)` mark, so it waits for the user. (Side effect worth knowing: an unattended run never pauses, so the model the session is on at run start carries the whole run; an attended run can switch at the approval pause and drop to a cheaper model for execution.)

**auto-mode.** `--auto-mode` as the first word of the arguments is a mode flag, not a target: the run goes unattended. Each stop takes its `(Recommended)` option and an answered ask is the go, in the same turn; an ask without one waits for the user, the fresh-session hand-off is never taken, nothing is pushed, merged, deployed or sent out, and the hook's `AUTO` stamp in `<docs-path>/flow/APPROVAL` is the run's approval: write no APPROVED or AUTO line over it, and only the close of the run its `skill:` line names deletes it.

## The run

### 1. DETECT
Green baseline first - build + tests green, zero pending EF migrations, before a single version moves; a red or drifted baseline is a blocking precondition, report it and stop, never plan around it. Then read the manifests (`global.json`, `*.csproj` / `Directory.Packages.props`, `package.json` / `angular.json`), pin current -> target versions and the trigger (major, EOL, security advisory), and classify the event and the stacks it touches. No breaking surface -> routine bump, exit.

### 2. GATHER - delegated
- **the documentation server** (load-bearing - the library-docs MCP every install carries): the target's published breaking-change surface - the migration guide, deprecations-and-removals, the version delta - never from recall. When it is unreachable, the surface is the vendor's migration guide the user pastes or fetches, and a breaking change no doc backs is marked `unverified` in the plan, never asserted. Branch by stack per the playbooks: what a migration tool auto-applies (`ng update` schematics on Angular; on .NET whatever the current porting docs name - the Upgrade Assistant is deprecated) versus hand edits.
- **architecture-analyzer (sonnet/medium)** per affected area, dispatched exactly as the roster spells it (`alfred-code:<seat>` where the core plugin carries it): where the codebase actually uses the changed/deprecated APIs - located usage digests, reads kept off this context. Mine the build's own signals first (the `[Obsolete]`/analyzer warnings, `ng update`/`ng lint` deprecation notices) - they are the framework's pre-computed removal map.

### 3. PLAN - in-session
Cross the surface against located usage: a breaking change nothing uses is not a task. Split engine-applied vs hand edits. Sequence foundation-first per the playbooks (SDK pin -> TFM -> framework packages in lockstep -> code edits on .NET; one major at a time with `ng update` + the peer matrix on Angular). Each stage carries: its edits, its verification command, its rollback point. Genuinely user-level calls (accept a new major's baseline, drop a deprecated dependency) go to the gate as questions, never guessed. **Hard cap: 2 planning passes.**

### 4. APPROVAL GATE
PRINT the staged plan in the chat first - the `playbooks:` line, then every stage with its edits, its verification command and its rollback point - in the same turn as the gate: an approval over a plan the chat never showed approves nothing. Load `habits-execution-strategy` (the Skill tool); its `Execution:` line is the mode reason, and stages that share files read `serial`. Then put the gate through AskUserQuestion as ONE call - free text stays available via Other, and the PLAN step's user-level calls join the same call as their own questions (plain-text options where the harness lacks the tool). With no user-level call open:

```ask
The staged plan above: <n> stages, each with its verification and rollback point. Execute it stage by stage <through the seats | in this session>: <the Execution: line's reason>.
- 'Approve - execute through the seats (Recommended)' - each stage goes to the implementer seat and gates green before the next
- 'Approve - execute in this session' - the stages run in order here, no seat; each still gates green
- 'Just the plan' - exit here and hand over the plan
- 'Stop - changes needed' - I ask what to change next, in plain text
```

The mark moves to 'in this session' when the verdict reads `serial`; the run never drops the seats on its own call. With a user-level call still open, executing would guess its answer, so the plan is the recommendation:

```ask
The staged plan above is ready, but <n> user-level call(s) are open. Take the plan and settle them first.
- 'Just the plan (Recommended)' - exit here with the plan; the open calls are yours to settle
- 'Approve - execute the stages' - run the stages on the answers given in this same call, in the mode the verdict names
- 'Stop - changes needed' - I ask what to change next, in plain text
```

### 5. EXECUTE - stage by stage
Before the first implementer dispatch, write the approval gate file `<docs-path>/flow/APPROVAL` - first line `APPROVED <plan id> - "<the user's words, verbatim>"` from the gate's approving answer (under auto-mode the hook's `AUTO` stamp already stands - leave it) - the dispatch hook blocks an unstamped implementer; delete the file when the run completes. Write the stamp at the ABSOLUTE path `${CLAUDE_PROJECT_DIR}/<docs-path>/flow/APPROVAL` with the Write tool. Only where the docs root still sits under `.claude/` (the old `.claude/docs` default, kept) is the write protected: a prompt for it offers 'Yes, and allow Claude to edit files in this project's .claude folder for this session' - take that, since `permissions.allow` cannot pre-approve it. A relative write follows whatever cwd the shell drifted to and the dispatch then bounces. The stamp belongs to the session that dispatches - written when its own decision lands, deleted at its own close; an earlier session's leftover stamp is not consent. If BOTH the Write tool and an absolute-path Bash write are refused by the harness's classifier, stop and put the choice through AskUserQuestion - 'Retry the stamp (Recommended)' / 'Run this stage inline' - rather than retrying blind or dispatching around the gate.

Per stage, in the plan's order, in the mode the gate's answer chose: through the seats, dispatch the domain **implementer (sonnet/medium)** with the stage as a scoped brief (trivial manifest bumps: edit inline); in this session, make the stage's edits here (no approval stamp needed - nothing dispatches); run the stage's verification (build + tests); a red routes to the matching **resolver (sonnet/high)** for that stack - the seat covering build errors, or the one covering test failures, matched from your installed agents; with none matching, resolve the red inline and say so; gate green before the next stage. Hard stops, auto-mode included: a resolver returning BLOCKED_CONTRACT_CHANGE, a stage that stays red after its resolver pass, or reality contradicting the plan - stop and put it through ONE AskUserQuestion - 'Re-plan from this stage (Recommended)' / 'Roll back to the last stage's rollback point' / 'Stop here' - never push through or skip a stage gate. Under auto-mode put the same three options with NO `(Recommended)` mark, the question opening 'no option is recommended: a hard stop waits for you under auto-mode' - the hook answers only a marked ask, so this one waits.

### 6. VERIFY + REPORT
Full suite green at the end; on a large upgrade, optionally the domain **verifier (sonnet/xhigh)** over the assembled result. Report: current -> target, stages landed and what each changed, runtime-break checks done, anything deferred or user-declined, the rollback points, and the commit line. If the run stopped early: which stage, why, and the state it left. Shaped like:

```
.NET 8 -> 10: 4 stages landed, full suite green (412 passed)
  1 SDK pin + global.json (rollback a1b2c3d)   2 TFM + framework packages in lockstep
  3 obsolete-API swaps (SYSLIB warnings)       4 hand edits - TimeProvider swap, 3 call sites
runtime-break checks: serializer defaults reviewed, zero [Obsolete] warnings left
deferred: FluentAssertions major (user-declined)
commit: held - the diff is uncommitted
```

Then the commit decision, ONE AskUserQuestion once the report prints (an early stop asks it too when a stage landed):

```ask
<N> upgrade stage(s) landed, uncommitted (<suite green | stopped at stage <k>>). Commit them on this machine?
- 'Commit now (Recommended)' - runs `habits-commit-checkpoint` in full, then commits
- 'Hold - review the diff first' - nothing is committed; the diff stays as it is
```

## Don't game it
Enumerate the real breaking changes from the framework's own docs, not recall - recall catches the compile break and ships the runtime break. Keep the plan to located usage. Never wave a deprecation off as 'probably fine' - unclear impact is marked to verify. Never weaken a test, suppress a warning, or skip a stage gate to make a stage look green - that is a new break, not progress. `auto-mode` is the user's typed word only - proceeding past the gate without it is a protocol violation, not initiative.
