# Size first - the four rows

Read at invocation, before the size line: the signals that decide each size and the steps each size runs.

| Size | Signals | Steps that run |
|---|---|---|
| trivial | one file, no new dependency, no test-visible behaviour | edit -> scoped check -> close; no stop |
| small | up to 3 files in one domain, no new dependency, no public contract | plan inline -> build -> verifier -> close; one stop |
| standard | anything else in one domain | the gated vertical below |
| cross | more than one domain | `/alfred-task-solve-cross` (the user's command) |
