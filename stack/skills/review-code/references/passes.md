# The review passes

The method `review-code` runs, and `task-verify-code` uses for its code checks. Each pass reads the target only. Locate a symbol through the navigation tools (a file's outline, the symbol with its body, its callers) before you read code; Read is for code already located. At a branch or pull request that is not checked out, the checkout is not the code under review: read each file at the target's head, `git show <head>:<path>` (the skill's Target section).

## Passes

1. **Each touched function, read whole.** Every function or method the diff touches, read in full: an unchanged line inside a touched function is in scope, since the change can break it (a variable now null on a path the old code never took, an early return that now skips a cleanup).
2. **Removed behaviour.** For each deleted or changed condition, guard, call or default: name the invariant it enforced, then find where that invariant holds now. Nowhere is a finding (category dropped-guard). Moved code counts - a guard that stayed behind in the old place is gone from the new one.
3. **Callers and callees.** For each changed signature, return shape or thrown error, the callers (the navigation tools' references) still pass what it needs and still handle what it returns; for each new call, the callee does what the change assumes (read its body, not its name).
4. **Stack pitfalls.** The trap list of the touched files' convention skill (the path-scoped convention rule attaches it; load it with the Skill tool if it is not in context): data access, lifecycle, concurrency, async, disposal, the framework's known misuses. A named trap the code hits is a finding.
5. **Wrapper and proxy routing.** A call that reaches the changed code through a wrapper, decorator, proxy, middleware or DI registration: the wrapper still forwards every argument and the result, and the registration still points at the changed type.
6. **Altitude.** Does the change fix the cause or patch the symptom? A null check where the null should never arrive, a retry around a deterministic failure, a special case for one input: say where the cause lives.
7. **Reuse, simplification, efficiency.** Something the codebase or framework already ships, rebuilt; a branch or abstraction with no reason; work repeated in a loop, a query per item, a whole file read for one value.
8. **Conventions.** The project's `AGENTS.md`, the shipped rules and the user's preferences docs, quoted: a finding names the rule or entry id and quotes both the rule and the line that breaks it. Run `node .claude/skills/capture-preferences/scripts/preferences.js check --diff [<base>] --area code` (and `--area architecture`) where the script is - a bare `--diff` for the change set or a path (it reads the files changed since HEAD plus the untracked ones), `--diff <base>` for a branch or pull request, `<base>` the Target section's - and quote its `checked:` lines.

## Refute pass

Each candidate gets one vote, decided by a quoted line:

- **CONFIRMED** - the quoted line shows the failure scenario happens.
- **PLAUSIBLE** - the scenario is real if an input or state the code does not rule out arrives; the default when neither proof is found. Kept and marked.
- **REFUTED** - a quoted line, a cited guard or a short proof shows it cannot happen, or it is pure taste. Dropped.

Merge near-duplicates first (one root cause, one row). A vote with no quoted line is no vote: read the line, then vote.

## Gap sweep

At `deep` only, after the refute pass: one fresh read of the target looking ONLY for what the table does not hold yet. The shapes it hunts: moved code that dropped a guard; a lock, transaction or `using` scope that shrank; setup without its teardown (or the reverse); a default that flipped; an error path that now swallows; an ordering two calls depended on. Each new candidate goes through the refute pass.
