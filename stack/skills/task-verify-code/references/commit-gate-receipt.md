# The COMMIT-GATE receipt - when this review is the pre-commit checkpoint

Read when a commit is the next act and the verdict is sound - or sound after fixes that landed and
re-verified. A punch-list with unresolved BLOCKER/MATERIAL findings writes no receipt.

Write the gate receipt `<data root>/state/approvals/COMMIT-GATE` with five lines - `VERIFIED <what was reviewed, one phrase>`, `authorized: "<the user's words asking for THIS commit, verbatim>"` (or `answered: <the chosen option label>` when they picked rather than typed), `head: <the sha reviewed>`, `spec: <N files>` and `live-probe: <what you ran, or NOT RUN - <reason>>` - then `format: <the format CHECK command run> - clean over <N> staged files` (the commit checkpoint's formatter half, run over every staged path) and `findings: <this review's Findings field, copied>`, so the verdict the Output section emits reaches the receipt the guard reads and the user's eyes (measured: three reviews whose named fields reached no assistant text, the substance only in the receipt). On a security-relevant diff (auth, crypto, secrets, payment, data access) the receipt adds a sixth line: `security:` naming each category checked and its verdict (`security: auth ok, secrets ok, injection ok, data-access n/a`), written only after the commit checkpoint's security half ran (alfred-security.md) - a VERIFIED line that claims that review with no `security:` line reads as no review. The VERIFIED line proves the review ran, the authorized line proves the user asked.

Write it with the commit checkpoint's bundled `receipt.js`, run from the project - by hand only where the script is absent. It fills `head:`, `spec:` and the counts on `format:` and `security:` from git, the fields hand-written receipts were refused for:

```bash
node .claude/skills/habits-commit-checkpoint/scripts/receipt.js commit --verified '<what was reviewed>' --authorized '<the user words, verbatim>' \
  --probe '<what ran, or NOT RUN - reason>' --format '<the format check command, or none>' \
  --findings '<the Findings field, copied>' --paths <the session's own paths>
```

`--answered '<label>'` replaces `--authorized` for a picked option, and `--security '<each category and its verdict>'` adds that line. The script refuses a receipt with no consent line, so when the consent words do not exist yet - the review ran ahead of the ask - run it at the commit turn, before the commit call. Write the receipt as its OWN tool call, never inside the commit's compound command. The `guard-ungated-commit` hook blocks a non-trivial commit whose receipt lacks the VERIFIED line, the consent line or any field the command above fills, and an INLINE review's Output may live in the receipt provided every required field is present.
