# Evidence appendix - what each receipt line was added to catch

An audit appendix, not a run-time load: read it when a rule in SKILL.md looks like ceremony, never
as part of a commit.

## The receipt lines

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
- `format:` (usage audit 2026-10-10, session e6a68237) - the formatter half had covered only the
  files the session edited: a 34-file commit whose formatter runs covered 4 shipped an inherited
  unformatted file, and the CI format gate stayed red for 29.5 h until a fixup the next day. The
  CHECK now runs over every staged path and the guard reads its `clean` verdict.
- `findings:` (sessions 349e4825, a3d497f8, f6c591fa) - three reviews ran and none of their named
  fields reached an assistant text; the substance sat only in the receipt, and one commit ask went
  out before its review ran.

## The publish half (usage audit 2026-10-10)

- Typed words skip the ask (349e4825): 'commit current changes and push them' was re-confirmed by
  an ask the user answered in 6 s, at ~157k context.
- A recorded red is named in the ask, and CI is watched once (bba03dad, e6a68237): three develop
  pushes went out over a typecheck red the receipt's own `live-probe:` line recorded; develop stayed
  red for five runs and blocked deploy-staging until the user asked why. Elsewhere a format red went
  unseen for the 66 minutes the session stayed open, and was fixed the next day.

## The security half (usage audit 2026-10-10)

- Explicit-only dispatch (229e2715): inside the solve flow, 'Close and commit' named no seat, and
  the checkpoint dispatched a general-purpose security seat anyway (17 messages, $1.14).
- The file count (390aebcb): a receipt claimed an 'inline security review over the full 11-file
  diff' while the security diff covered 4 files; the membership handler never went through it.

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
