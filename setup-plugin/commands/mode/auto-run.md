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
  each stop takes its `(Recommended)` option, listed in the close; a stop with no marked option waits; the asks of `/alfred-code:init`, `update`, `configure` and `validate` always go to the user;
  nothing goes outward unless the user's own pick approved that act; no fresh-session hand-off. When the run holds a series of outward acts of one kind (N publishes, N ticket comments), put ONE ask before the
  first, its question naming them 'outward acts' and listing each act by its target and kind (the page or ticket, and create / update / comment / upload), its
  recommended option the whole series as listed. The user's pick is the approval a plan or project rule asks for each
  listed act: each then runs without another ask, its body shown in chat with its dry run before it goes out and read
  back after; an act on another target or of another kind asks again. A project rule that says each write needs its OWN
  ask outranks the pick: then ask per act, as before.
