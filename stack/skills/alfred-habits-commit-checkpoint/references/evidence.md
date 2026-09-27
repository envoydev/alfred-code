# Evidence appendix - what each receipt line was added to catch

An audit appendix, not a run-time load: read it when a rule in SKILL.md looks like ceremony, never
as part of a commit.

## The five receipt lines

Each line closed a measured way the receipt passed while recording nothing.

- `VERIFIED` - the review ran. A self-written VERIFIED receipt once cleared a commit no user had
  requested.
- `authorized:` - the user asked for THIS commit, in their own words. The quoted words must carry a
  commit verb: `authorized: "what time is it?"` used to pass.
- `head:` - the review ran against THIS tree.
- `spec:` - it covered the whole diff. One receipt asserted a 17-file review in which 9 files had
  been read.
- `live-probe:` - it ran the thing. One asserted a passing review with no build or test output at
  all.

## Why the receipt is its own tool call

The shipped hook accepts the atomic write+commit shape, so only the rule binds: 9 of 13 commits in
one audited session took the atomic shape, and two of those left the receipt uncleared.

## Why a sibling repo is never offered as an option

Measured before the CROSS-WRITE-ALLOW receipt existed: an ask presented a sibling-repo commit +
push + PR as its `(Recommended)` option, the user took it, and the cross-project write guard denied
it at the first git verb - the run recommended a route the stack bans.
