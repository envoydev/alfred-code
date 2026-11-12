---
description: "Turn auto-run on or off for this session; on also stops the fresh-session ask - /alfred-code:mode:auto-run on|off, typed alone on its line."
argument-hint: on|off
disable-model-invocation: true
---

The user typed `/alfred-code:mode:auto-run $ARGUMENTS`.

- A line starting `[mode]` is in this turn's context: say that line to the user, word for word, and stop.
- No such line (the hooks are off, or this host runs none): no hook holds the mode. Say in one line that auto-run is
  on, or off, for this conversation by the user's word alone, then hold to it until they say otherwise:
  each stop takes its `(Recommended)` option, listed in the close; a stop with no marked option waits;
  nothing goes outward; no fresh-session hand-off.
