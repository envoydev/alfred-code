---
type: regex
weight: 2
target: last_message
pattern: "/alfred-code:setup"
---

The router reads the install state and hands back ONE command. Nothing is installed in the run's
empty working directory - no install record in `.claude/` - so the route is `/alfred-code:setup`.
