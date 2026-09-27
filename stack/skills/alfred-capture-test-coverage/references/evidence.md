# Evidence behind alfred-capture-test-coverage

An audit appendix - the measurements behind the rules in SKILL.md, never a run-time load.

## Moved from SKILL.md (pilot 4 split)

The measurement each rule in SKILL.md now states without its story.

- **One batched ask** - A separately-scheduled mode question is the one that gets dropped: a first capture asked Docker-handling and the bar in one call and never asked the mode.
- **Long suites stay out** - An unasked replay run consumed 41GB of disk before being killed, and the user had to add a hand-written rule to stop it recurring
- **The Leftovers line** - The named line is what makes the teardown check happen at all.
- **Coverage outside the build flows** - A seat babysitting an instrumented run burns about half its cost idling on the wait.
