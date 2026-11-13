---
description: "Stop the fresh-session ask so the context compacts instead, until off, new sessions included - /alfred-code:mode:auto-compact on|off, typed alone on its line."
argument-hint: on|off
disable-model-invocation: true
---

The user typed `/alfred-code:mode:auto-compact $ARGUMENTS`.

- A line starting `[mode]` is in this turn's context: say that line to the user, word for word, and stop.
- No such line (the hooks are off, or this host runs none): say in one line that auto-compact is
  on, or off, by the user's word alone, and that no hook holds the mode here, so it holds for this conversation only and a
  new session starts without it; then hold to it until they say otherwise:
  offer no fresh session and put no fresh-session option in any ask.
