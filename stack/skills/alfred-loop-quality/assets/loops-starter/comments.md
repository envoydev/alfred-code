# Comments stage

A findings-based audit. Review TARGET for comments and inline documentation only - run late, after the code they describe has stopped moving, so you are not documenting something a later stage will change. Code, naming and logging findings are owned by the earlier stages - do not flag them here, even when you spot them.

Look for:
- Comments that now contradict the code (an earlier stage changed the code but not the comment).
- Comments that narrate what the line plainly does instead of why it does it - delete the redundant ones.
- Missing rationale where a non-obvious decision, a workaround, or an external constraint would baffle the next reader.
- Stale TODO and FIXME markers, and commented-out code - remove them or convert to a tracked note.
- Public API surface left undocumented where the codebase documents its public surface.
- Checkable factual claims - a named symbol, a count, a claimed invariant or guarantee - verified against the code, never judged on prose plausibility alone (measured: one audit's only BLOCKER was a false security invariant in a doc comment that read perfectly plausibly).

Severity: a comment that actively misleads is MAJOR - a false safety or security invariant is BLOCKER; a redundant restatement is MINOR. Prefer deleting a bad comment to rewriting it, unless the why is genuinely worth capturing - then write the why, not the what.

A deviation from a preference is not a finding unless you can name what it breaks - a wrong finding costs more than a missed one.

Bar: zero findings at every severity - real findings only: a candidate with nothing nameable it breaks is not a finding (not recorded, not counted against this bar), `open: []` on pass 1 is a valid, complete result, and every real finding is listed, never trimmed.
