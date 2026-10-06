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
- `spec:` - it covered every file the commit takes in. One receipt asserted a 17-file review in which 9 files had
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

## Why the pre-existing untracked files stay out of the change

In one benchmark round ~150 files that were untracked before the change began drove 19 gate denials,
and one close committed them.

## Why a multi-project push names its `scope:`

One project's narrow test run passed both gates, the push broke CI right after, and 6.4M tokens of
triage followed.

## Why a no-fast-forward publish writes its receipt after the merge

A receipt minted before the merge named the pre-merge tip; the guard read it as reviewing a different
tree, and the retry cost a full edit-and-redo - measured at ~471k tokens.
