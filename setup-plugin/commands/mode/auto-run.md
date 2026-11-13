---
description: "Turn auto-run on or off - on lasts until off, new sessions included, and stops the fresh-session ask - /alfred-code:mode:auto-run on|off, typed alone on its line."
argument-hint: on|off
disable-model-invocation: true
---

The user typed `/alfred-code:mode:auto-run $ARGUMENTS`.

- A line starting `[mode]` is in this turn's context: say that line to the user, word for word, and stop.
- No such line (the hooks are off, or this host runs none): say in one line that auto-run is
  on, or off, by the user's word alone, and that no hook holds the mode here, so it holds for this conversation only and a
  new session starts without it; then hold to it until they say otherwise:
  each stop takes its `(Recommended)` option, listed in the close; a stop with no marked option waits;
  nothing goes outward; no fresh-session hand-off.
