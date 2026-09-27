# Evidence appendix - the builds these rules were written from

An audit appendix, not a run-time load: read it when a rule in SKILL.md looks like ceremony, never
during a build.

- **The plan needs an `Approved:` line (Build mode 6).** A build started on a bare 'implement' with
  no approval line and no question, and the user rejected it after its whole 23.9M window.
- **The red-gate loop stops at five (protocol step 3).** Seven red runs of one task's gate at ~296k
  context per message, 11.4M cache-read for 47k chars of test output, the last two on code that had
  not changed.
- **'Code complete, builds' is not DONE (protocol step 4).** Four tasks ticked DONE on compile
  alone; the end-to-end run they existed for was never made, and the user found it.
- **A `FAILED` task ends the turn with an ask (protocol step 4).** Forty consecutive tool calls, the
  plan saying the failure was reported, no question ever asked.
- **A post-cycle bug report is a decision point (when the plan meets reality).** Two post-cycle bug
  reports were fixed and committed with no decision point between them.
