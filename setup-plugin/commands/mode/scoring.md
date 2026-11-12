---
description: "Turn output scoring on or off for this session - /alfred-code:mode:scoring on|off, typed alone on its line."
argument-hint: on|off
disable-model-invocation: true
---

The user typed `/alfred-code:mode:scoring $ARGUMENTS`.

- A line starting `[mode]` is in this turn's context: say that line to the user, word for word, and stop.
- No such line (the hooks are off, or this host runs none): no hook holds the mode. Say in one line that scoring is
  on, or off, for this conversation by the user's word alone, then hold to it until they say otherwise:
  grade each plan, ticket, verdict or final answer with the skill that covers output scoring before
  handing it over.
