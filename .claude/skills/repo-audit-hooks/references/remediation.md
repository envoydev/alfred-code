# Hook audit - Phase 2 remediation

Read before the first edit. The anti-gaming guards at the end override the grade target.

Set-level defects first. A coverage gap: add the hook or the permission rule only with the measured incident that motivates it, or record the decline with its reason - never a gate on a hunch. A double home: retire the prose mandate to a pointer at the mechanism. A route gap: extend the same hook to the missing route with the same test shapes. A wiring drift: fix the source (the manifest's `hooks` rows and `retired.hooks`, then `npm run marketplace` for the generated core entry; `HOOK_TIMEOUTS` for a timeout) and let the lint and tests prove it. A collision: merge the jobs into one hook or record the order and the combined cost. A contradiction: the house rule wins - repair the receipt path (the skill step writes what the hook reads, or the hook reads what the step writes) or retire the instruction; amend the rule only with a measurement and a recorded reason. A child hook that duplicates, contradicts or collides with the root: the plugin audit owns the plugin's fate; this run writes the row, the recommended home (the house hook, the child hook, or neither) and, where the child stays, the timeout and matcher it would need - and never edits a plugin's files in its cache.

Then, for each hook still below A / 9, a bounded loop:

1. Snapshot the hook file, its wiring lines and its tests.
2. Rank the deductions by points lost. Fix the largest first.
3. Apply the smallest edit that removes it. Examples:
   - Exit 1 where a block is meant: exit 2, or the JSON deny on exit 0, with the reason written for the model and the escape named.
   - Field at the wrong nesting: move it inside `hookSpecificOutput` with `hookEventName`; confirm in the debug log that the object is no longer reported as unrecognised.
   - Matcher too wide or unanchored: anchor it, or move the filter into `if` so the process does not spawn.
   - Missing timeout: `HOOK_TIMEOUTS` in `scripts/install/settings.js` stamps it on every entry the stack owns, read by the core entry's generator and the copy-route writer alike (this stack: 10 seconds, every hook measured under 30 ms; 60 on `check-turn-build.js`'s `Stop`; the `shell-guards.js` dispatcher the sum of its guards' 10s).
   - Heavy check on the hot path: move it to `Stop`, or make it `async` when nothing downstream depends on its result.
   - Denial with no escape: name the ranged read, the receipt, the one file, the ask.
   - Stop hook without the loop guard: read `stop_hook_active` and exit 0 when it is true; accept the run's own 'nothing pending' close.
   - No ledger row: append one per block with hook, event, tool and reason.
   - No test for a route: replay the recorded failure shape through that route, plus the false positive once fixed.
4. Re-score from scratch. Do not carry the previous score forward.
5. Repeat until A / 9, `MAX_ITERATIONS`, or a pass with no material gain.

## Anti-gaming guards (hard invariants)

- No new hook without a measured incident. A gate added because a playbook lists it, with no session showing the failure, is a spawn on every call for a class the stack never had - measure first.
- No move inside an observation week. Seeded triggers, thresholds and injection lines under observation are read from the week's rows, not edited.
- Never loosen to pass. A matcher is never narrowed, a shape never dropped, a route never uncovered to improve a cost or latency score; the escape is the remedy for thrash, not a weaker gate.
- Never widen to farm coverage. A matcher is not broadened past the measured shapes so the coverage map looks fuller; a broad matcher with a false positive costs more than the gap.
- Exit 2 only where a block is meant. A logging or injecting hook never exits 2; a gate never exits 1.
- The prose twin retires when the hook lands. Keeping both is a double home, not belt and braces.
- No `allow` returns. A hook tightens; an `allow` that skips a prompt the mode would have raised is a loosening, whatever its intent.
- Timeouts stay. No entry loses its timeout to 'let the check finish'; a check that needs minutes is not a hook on the hot path.
- The root wins by default, never silently. A house rule is amended to fit a hook or a child hook only with a measurement and a recorded reason; a hook is never kept by weakening the rule it contradicts.
- A fit finding quotes both sides. 'Overlaps with the house' without the two lines is noise, not a deduction.
- A child hook is read, not trusted by its marketplace tier. A curated plugin's hook is opened line by line like a house hook; the tier is a D4 input for the plugin audit, not a pass here.
- The twin repo is mirrored deliberately. Where the Cursor stack ships a hook layer of its own, a protocol change here is written to a task card for that repo, never assumed.
- Honest scoring. A hook that cannot reach A without breaking a guard is reported at its real grade with the blocker.
