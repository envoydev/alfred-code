---
description: "Turn output scoring on or off - on lasts until off, new sessions included - /alfred-code:mode:scoring on|off [level], typed alone on its line."
argument-hint: on|off [level]
disable-model-invocation: true
---

The user typed `/alfred-code:mode:scoring $ARGUMENTS`.

- A line starting `[mode]` is in this turn's context: say that line to the user, word for word, and stop.
- No such line (the hooks are off, or this host runs none): say in one line that scoring is
  on, or off, by the user's word alone, and that no hook holds the mode here, so it holds for this conversation only and a
  new session starts without it; then hold to it until they say otherwise:
  grade each plan, ticket, verdict or final answer with the skill that covers output scoring before
  handing it over.
