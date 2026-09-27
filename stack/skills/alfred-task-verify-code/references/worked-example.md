# A worked review

Read before the first review of a session - one build reviewed inline, one line per finding, and the verdict.

## Example

Reviewing the records-list export build (the `alfred-task-implement` example - three tasks: a query projection, a streamed export endpoint, an integration test) inline:

```text
build + test | rerun green - Passed: 22, Failed: 0 (quoted)
plan         | all 3 tasks present, none outside its boundary, cancellation threaded per the audit
run-it       | BLOCKER | GET /export?format=bad 500s on the live host, not 400 (file:symbol) | the suite's test passes under the test host - the binder throws before the filter; map the bad-request to 400
contract     | MATERIAL | /export response shape changed; the sibling web client still reads the old array (repo:file) | freeze the contract, move the consumer in lockstep
over-build   | MINOR | a format-strategy interface with one implementation (file:symbol) | inline it (yagni)
```

Verdict: one BLOCKER to fix (live 500), one cross-consumer break to decide, one nit - handed back, nothing dispatched.
