---
description: "Alias of /alfred-code:init, kept for one release - the same FRESH install of the alfred-code into a project (or globally), guided layer by layer."
disable-model-invocation: true
---

# Set up the Claude stack - alias of init

`/alfred-code:setup` was renamed to `/alfred-code:init`. Read
`${CLAUDE_PLUGIN_ROOT}/setup-plugin/commands/init.md` and follow it as THIS command's instructions,
start to finish, with the same arguments. Name the new command once in your first line, so the
next run types it. That file is read, not loaded, so every plugin-root placeholder in it (a dollar
sign, a brace, CLAUDE_PLUGIN_ROOT, a brace) arrives unexpanded: read each one as
`${CLAUDE_PLUGIN_ROOT}`, the path this line already carries.
