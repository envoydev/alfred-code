---
type: regex
weight: 2
target: last_message
pattern: "/alfred-code:init"
---

The router reads the install state and hands back ONE command. Nothing is installed in the run's
empty working directory, so the route is `/alfred-code:init`.
