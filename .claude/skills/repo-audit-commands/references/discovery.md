# Command audit - Phase 0 discovery

Read at Phase 0. Build every map below before scoring; edit nothing.

1. **Find the commands.** List every Markdown file under `COMMANDS_ROOT`, subfolders included - each file is one
   command and each subfolder a namespace. Where the repo ships a plugin, read its manifest (or the generator the
   `notes` name) for a `commands` key: a path, a list of paths, or a map of name to `source` or `content`. That key
   replaces the default folder scan, so a file it does not reach is not shipped, and an inline `content` entry is a
   command with no file. Record both lists and the difference between them.
2. **Read each command whole**, then the scripts and files its body names - enough of each script to know what it
   reads, what it writes and which arguments it takes; a long script is not read line by line.
3. **The per-command record:**
   - the name as typed, with its namespace and the plugin prefix where there is one, and the file behind it;
   - every frontmatter field present, and for a manifest entry its `description`, `argumentHint`, `model` and
     `allowedTools`;
   - who may invoke it - the user only, the user and the model, the model only - and why the body needs that;
   - body line and character count;
   - every constraint the author wrote - a 'never' line, a confirmation rule, a key-handling rule, an order of
     steps. These are load-bearing. Treat them as fixed.
4. **The name and collision map.** For every pair of commands, and every command against the repo's skills (the
   `audit.skills` roots, where the repo has them): the same typed name (a skill wins over a command file of its
   name, so the command is dead), names that differ by one word or by word order, descriptions a person could not
   tell apart, and verbs used for two different things across the set (`update` that upgrades in one command and
   edits in another). Record each as a pair with the lines that collide.
5. **The argument map.** Per command: what the hint shows; each place the body reads an argument and in which
   form - the whole string, a position, a named argument; what the body does with no argument, with more than it
   expects, and with a value that fails its check; and each place an argument reaches a tool call or a shell line,
   with how it is quoted there. An argument the hint names and the body never reads, or the reverse, is recorded
   here.
6. **The execution map.** Per command: each tool the body calls and whether `allowed-tools` covers it; each
   pre-run shell line with what it runs, whether it only reads, and how large its output can get; each script
   with its interpreter and the path form that reaches it; each side effect - a file written, a setting changed, a
   package installed, something sent or deleted - with the step that gates it, or 'ungated'; and what the command
   leaves in the conversation when it ends.
7. **The reference-resolution map.** Resolve every name the bodies use - scripts, files, other commands, skills,
   agents, MCP servers, settings keys - against what the repo ships. A dangling name is a defect, not a style
   issue: the step silently does nothing. An edge that tells the model to run an entry whose frontmatter blocks
   model invocation is recorded as a blocked edge.
8. **The duplication map.** Blocks that repeat across two or more commands - a rules list, an error table, a
   setup step. Record each cluster with the commands involved and the right fix: a script or a shared file the
   commands read through the plugin root, a registered restatement in each, or leaving it local.
