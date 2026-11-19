---
name: repo-audit-commands
description: Use when auditing and fixing the slash commands this repo ships toward grade A - menu line, arguments, safety, cost. Not for skill folders or hooks.
disable-model-invocation: true
---

# Command audit and remediation

You are a command-surface engineer. Take the slash commands a repo ships and raise them to excellent, ship-ready
quality: audit every command under `COMMANDS_ROOT`, score each one against an objective rubric, then rewrite each
command in place until it reaches grade A (numeric 9) without changing what it does or what the user types to run
it. The end state is a command set a user would consider excellent: findable in the `/` menu, clear about its
arguments, safe to run, cheap to load, and coherent as a set.

The audit makes no assumptions about which commands exist - discover them from `COMMANDS_ROOT` and the plugin
manifest, never assume a particular set. It is this repo's own maintenance tool, not part of what the repo ships.

## When to use

- The user types `/repo-audit-commands` to audit the repo's shipped commands (the `audit.commands` roots in
  `.claude/kit/repo.json`), or a root they name.
- A command here is a flat Markdown file the harness serves as a slash entry - a file in a plugin's `commands/`
  folder or a project's `.claude/commands/`, or an entry of the plugin manifest's `commands` map.
- Not for a skill folder with a `SKILL.md` (`/repo-audit-skills`), the hooks (`/repo-audit-hooks`) or the plugin
  manifest as a whole (`/repo-audit-system`), and not for writing one command.

## Parameters

- `COMMANDS_ROOT`: the folders or files holding commands (default: the `audit.commands` roots from step 1). Each
  Markdown file is one command; a subfolder is a namespace. Where the repo ships a plugin, the manifest's `commands`
  key decides which files load, so read it beside the folder.
- `SCRIPTS_ROOT`: where the scripts the commands run live (default: what the `notes` name) - read for what each
  command executes, never scored here.
- `TARGET`: minimum acceptable grade (default: `A` / `9`).
- `MAX_ITERATIONS`: max remediation passes per command (default: `4`).
- `WRITE`: `true` takes the run to the flow's ask and applies what it picks, `false` stops after the report and the
  plan (default: `true`).

## How the run goes

**Load the `repo-audit-plugin` skill before step 1 and run this audit through its flow.** Its planner seat does Phases 0
to 1b and writes Phase 2's edits as a plan, its editor seat applies them, and the planner does Phase 3. This session
coordinates and is the only one that asks the user. The seats do not ask for confirmation between phases; the stops
the flow adds are its own asks, one of them before any edit lands. Stop otherwise only on the stop conditions
below. When a stop or finding genuinely needs the user's answer - a rename, a command that should be a skill, a
conflict with no repo-decided winner - put the question through the AskUserQuestion tool
with concrete options and a marked recommendation, never a prose question buried in a report.

1. **Targets.** Read `.claude/kit/repo.json` -> `audit.commands`. No entry: report 'this repo ships no
   commands - nothing to audit' and stop. Its `roots` are `COMMANDS_ROOT` for this run (a root the user
   names overrides them); run every `checks` command wherever this skill calls for the repo's checks,
   and quote its result; follow every `notes` line wherever this skill touches a repo-specific
   mechanism (a script folder, a manifest generator, a sandbox for commands that write, an eval suite).
2. **Principles.** Read `references/principles.md` before any phase - it defines what counts as a
   defect in every later phase (the typed surface, arguments as input, gated side effects, pre-run shell lines).
3. **Phase 0 - discovery.** Follow `references/discovery.md`: every command file and manifest entry, the
   per-command record, the name and collision map, the argument map, the execution map. Edit nothing in this phase.
4. **Phase 1 - scoring.** Score each command on the four dimensions in `references/rubric.md`, citing the
   line or block behind every point, and map the total through its grade bands and floors. Produce the
   baseline report (the output contract below) before any editing.
5. **Phase 1b - currency.** Check the external claims per `references/currency.md`; an unresolved
   DRIFTED finding blocks the command from A.
6. **Phase 2 - remediation.** Follow `references/remediation.md`: set-level defects first (collisions,
   unreachable files, duplicated blocks), then the bounded per-command loop. Its anti-gaming guards
   override the A target.
7. **Phase 3 - verification**, below.

## Phase 3 - Verification

After the loop, for each edited command:

1. Re-read the full edited file end to end. Confirm the frontmatter still parses, and that the file name, its
   folder, the argument order and the `argument-hint` all match what a user typed before the edit.
2. Confirm the behavior-preservation invocations (typical arguments, none, a malformed one) still lead to the same
   steps and the same writes.
3. Confirm no guarded rule was dropped - a confirmation step, a 'never' line, a key-handling rule. Diff against the
   snapshot to check.
4. Confirm every path, script, command, skill and agent the body names still resolves, and every tool the body
   calls without asking is still covered by `allowed-tools`.
5. Run the repo's `checks` and quote each result line. Where the repo ships a plugin, run `claude plugin validate`
   on it and quote its result line.
6. Never run a command that writes in order to verify it. Where the `notes` name a sandbox for such commands (a
   throwaway home, a case matrix), run that and read what it wrote; without one, list the invocations as an owed
   check and mark the claim unproven. A live run in a fresh session is a nested, billed one: the user says go first
   (one AskUserQuestion, the unbilled route recommended).
7. Record the final grade with the same evidence-cited scoring as Phase 1.

If any command regressed on behavior, changed what the user types or lost a guarded rule, restore it from the
snapshot and report it as unresolved with the reason.

## Stop conditions

Stop the whole run when either holds:

- Every command is at A / 9 and passed verification, or
- Every remaining sub-A command has hit `MAX_ITERATIONS` or has a reported blocker that a guard forbids fixing.

Do not loop past these. Report the remainder honestly rather than inflating grades to force a clean sweep.

## Output contract

Produce a single report with:

1. Summary table: one row per command with columns `command` (as typed, namespace included), `invocation` (user
   only / user and model / model only), `baseline grade`, `final grade`, `iterations`, `status` (`raised to A`,
   `already A`, `blocked: <reason>`).
2. Per command, a short block: baseline score by dimension with the top 2-3 cited deductions; what changed, as a
   terse list of edits; final score by dimension; any blocker and why a guard prevented an A.
3. Name and collision map: every pair that collides or reads alike, every file the manifest leaves unreachable, and
   how each was resolved or why it was left.
4. Argument map: per command, what the hint promises, what the body reads, and how an empty or malformed argument
   is handled.
5. Execution map: per command, the tools pre-approved, the pre-run shell lines, the scripts run, and each side
   effect with the step that gates it.
6. Candidates, never applied here: a rename, a command that fits a skill better, a split or a merge - each with its
   reason and what it would change for users.
7. If `WRITE` is true, the list of files edited, any multi-home registry entries added or updated, and the snapshot
   location for rollback.
8. The repo's `checks` - each command with its result line, before and after the edits - and the owed checks of
   Phase 3 step 6.
9. The Phase 1b currency table with this run's verdicts.

Keep the report dense. No preamble, no restating this skill back, no filler.
