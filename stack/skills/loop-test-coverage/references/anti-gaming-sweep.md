# Anti-gaming sweep - the final-gate commands

Run once, at STOP, when any fix shipped, after the final build + tests. `<BASE>` is the sweep baseline round 1
recorded before its first fix (the RESUME BLOCK carries it into a fresh session) - HEAD, or the `git stash create`
sha on a dirty tree.

1. `git diff -M --stat <BASE>` - the shape of the run. Rename detection is not optional: a structure
   stage makes the diff rename-heavy, and a pure rename (R100, no content change) is verified by name
   alone.
2. `git diff -M <BASE>` - every remaining content hunk, paged deterministically until exhausted.
   Never cap it (`head`, first-N lines): a gamed bar past the cap is exactly the one that survives.
3. `git ls-files --others --exclude-standard`, minus the paths in `<docs-path>/flow/untracked-at-start-<HEAD sha>` (the record the session start wrote; absent = none to subtract) - the files untracked since the run began. A plain diff is blind
   to brand-new files, so a gamed bar added in one would never surface.
4. Read each file left by 3 in full - it has no diff to page.

Read the cumulative diff for a gamed bar: an assertion-free test, an existing test weakened, skipped or deleted
(outside a spec the red-check PROVED vacuous), a widened coverage exclusion, a lowered requirement or threshold.
Any hit is a BLOCKER: revert the shortcut, fix what it dodged, re-run the gate.

Report the result as the final report's `Anti-gaming:` line: clean, or what was reverted and which weak point
gamed it.
