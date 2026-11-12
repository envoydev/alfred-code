This project's rules are loaded by the alfred-code plugin at the start of the session, in blocks that open "Project
rules, part k of n" and close "End of project rules, part k of n". If no such block is in your context, or a part is
missing or has no closing line, say so once: the plugin is off, its hooks are disabled, a part was cut, or this folder
was never set up or not yet updated. Tell the user to run /alfred-code:status, or /alfred-code:init in a folder never
set up.
