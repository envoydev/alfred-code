# Publishing - push and PR merge

Read before a `git push` or a `gh pr merge`: the same ceremony as a commit, with its own receipt.

## Publishing - push and PR merge

The same ceremony. `git push` and `gh pr merge` are where the work leaves this machine - other
people and CI get it, and a shared branch cannot be un-pushed quietly - so they carry their own
receipt, `<docs-path>/flow/PUSH-GATE`, in the SAME five-line shape - `VERIFIED <what is being
published, one phrase>`, `authorized: "<the user's words asking for THIS publish, verbatim>"`,
`head:`, `spec: <the commit set going out>` and `live-probe:` - or `WAIVED - "<their words>"`. Only
the spec differs in kind: a publish's spec names what LEAVES the machine, not what is uncommitted
here, so it is required and never counted against the working tree.

1. Say what is going out and to which branch, and get the answer.
2. Write the receipt as its own call.
3. Publish, then clear the receipt.

`guard-ungated-commit` enforces this half too. A push that publishes nothing - a dry run, or a
branch already level with its upstream - is never gated, and a repo whose remote is already gated
by branch protection or a required review turns the half off for good with
`ALFRED_CODE_PUSH_GATE=0` in the settings.json env block.

When the probe actually ran something and the commit set touches more than one identifiable
project, the receipt adds a sixth line - `scope: <workspace, or the project list the probe ran>`.
One project's narrow test run passed both gates once, the push broke CI right after, and 6.4M
tokens of triage followed; name the whole workspace run (`nx affected`, a full suite) or every
project the diff touches, never just the one that was convenient to test. A single-project or
docs-only push, or a probe that genuinely ran nothing (`NOT RUN - <reason>`), needs no `scope:` line.

**A no-fast-forward publish (`git merge --no-ff`, or a PR merge) creates a NEW head.** Run the
merge first, then write the receipt: `head:` names the resulting merge commit, never the pre-merge
tip - a receipt minted before the merge still reads develop's old tip, the guard correctly reads it
as reviewing a different tree than what actually pushes, and the retry costs a full edit-and-redo
(measured: ~471k tokens). Probe, write the receipt naming the merge commit, then push.
