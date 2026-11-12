---
description: "Stop the fresh-session ask for this session, so the context compacts instead - /alfred-code:mode:auto-compact on|off, typed alone on its line."
argument-hint: on|off
disable-model-invocation: true
---

The user typed `/alfred-code:mode:auto-compact $ARGUMENTS`.

- A line starting `[mode]` is in this turn's context: say that line to the user, word for word, and stop.
- No such line (the hooks are off, or this host runs none): no hook holds the mode. Say in one line that auto-compact is
  on, or off, for this conversation by the user's word alone, then hold to it until they say otherwise:
  offer no fresh session and put no fresh-session option in any ask.
