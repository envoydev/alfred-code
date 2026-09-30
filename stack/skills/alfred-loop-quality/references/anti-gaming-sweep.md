# Anti-gaming sweep - the final-gate commands

Run once, at the end of the run, after the final build + tests: at the default loop's STOP when any
fix shipped, or after the staged run's last file and its final GREEN BASELINE re-gate. `<BASE>` is the sweep
baseline the run recorded at its start (round 1's ANALYZE, or the staged DISCOVERY step 3) - HEAD, or
the `git stash create` sha on a dirty tree.

1. `git diff -M --stat <BASE>` - the shape of the run. Rename detection is not optional: a structure
   stage makes the diff rename-heavy, and a pure rename (R100, no content change) is verified by name
   alone.
2. `git diff -M <BASE>` - every remaining content hunk, paged deterministically until exhausted.
   Never cap it (`head`, first-N lines): a gamed bar past the cap is exactly the one that survives.
3. `git ls-files --others --exclude-standard`, minus the paths in `<docs-path>/flow/untracked-at-start-<HEAD sha>` (the record the session start wrote; absent = none to subtract) - the files untracked since the run began. A plain diff is blind
   to brand-new files, so a gamed bar added in one would never surface.
4. Read each file left by 3 in full - it has no diff to page.

Report the result as the Final report's anti-gaming line: clean, or what was reverted and which
stage gamed it.
