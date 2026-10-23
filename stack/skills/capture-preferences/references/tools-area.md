# The tools area - `/capture-preferences tools`

The run that ranks which tools each job uses first and which servers stay with the main session. It writes two files: `<docs-path>/preferences/TOOLS-PREFERENCES.md`, the user's decisions in `doc-shape.md`'s 'The tools doc' shape, which may be committed; and `<data root>/state/tools-inventory.json`, this machine's servers and their tools, which never is. Every command runs from the project root through `node`.

## The flow

1. **The session's own names.** Write every `mcp__` tool name this session's tool listing shows - deferred ones included - one per line, to a scratch file outside the project (the session's scratch folder, else the system temp). A server the script cannot start (a claude.ai connector, one behind OAuth) is known only by these names.
2. **The inventory.** Run it and paste its lines byte for byte:

   ```bash
   node .claude/skills/capture-preferences/scripts/tools.js inventory --session-tools <file>
   ```

   Each line is `tools: <prefix> - <type>[ <version>] - <n> tools (<how>)`: `table` is a known type read from the adapter table and never started, `exchange` a server listed now, `session` one known by the step 1 names alone, `failed` one with no tools - it cannot be ranked until a later run lists it. A server the stack does not know gets `own:<its name, lower-cased>`; when the user calls it something else, run the command again with `--label <prefix>=own:<label>`, since the doc names the label, never the registration.
3. **Group.** A known type serves the jobs the table gives it (`serena` navigation, `context7` documentation, `memory-service` memory, `playwright` browser, `windows-mcp` and `macos-mcp` desktop, `appium` mobile). Read the inventory file for each `own:` server's tools and propose a job per tool from its name and hints - `find_`, `symbol`, `usages` navigation; `docs`, `search` documentation; `click`, `navigate`, `screenshot` browser; `query`, `sql` a user job such as `database` - and leave a tool no name fits out. Show the grouping as one table (job, server, tools), then:

   ```ask
   I grouped the servers the stack does not know as the table shows. Does that grouping stand?
   - 'Yes, as shown (Recommended)' - each job's ask offers those tools
   - 'Change it' - I ask which tools move to which job next, in plain text
   ```

4. **One ask per job with more than one server candidate**, up to four jobs in one AskUserQuestion call; a job with one server or none keeps the stack's order and gets no entry. A job the doc already ranks offers its current first rank first. The candidates past the first three are reached through Other. The purpose in the question is the table's for its jobs, a one-line proposal for the user's own:

   ```ask
   Which tool should <job> (<purpose>) use first?
   - '<first candidate> (Recommended)' - <why: the stack's default, or the one the user ranked or named>
   - '<second candidate>' - <what it serves>
   - 'Keep the stack's order' - no entry for this job; the defaults apply
   ```

   The rest of the order follows the pick: the other candidates as offered, then the job's built-ins from the table's default (`LSP > Grep`, `WebFetch`). A rank names the tools of its server that serve the job: an own server's from the grouping (`own:jetbrains find_usages, get_symbol_info`), a known type's from the table's list for that job (`serena find_symbol, find_referencing_symbols, get_symbols_overview`) - lint refuses a type with no tools.
5. **May agents use it?** One question per server the user did not rank, up to four per call. A server that holds a tool the inventory marks `destructive: true`, or acts outside the repo - a connector (`session`), a desktop, mobile or browser server - carries this one:

   ```ask
   May agents use <server>?
   - 'Main session only (Recommended)' - <it has a destructive tool | it acts outside the repo>
   - 'Agents too' - every seat whose tools grant it may call it
   ```

   Every other server carries this one:

   ```ask
   May agents use <server>?
   - 'Agents too (Recommended)' - it only reads, inside the repo
   - 'Main session only' - its type joins the `deny` entry; seats never call it
   ```

   Each 'Main session only' adds the server's type to the one `Job: deny` entry's `Deny:` line.
6. **Write.** Read the doc first; it may not exist. Write it whole: the title, `Updated: <today>`, `Retired:` once an id has been removed, the entries in id order, a new one taking the id `node .claude/skills/capture-preferences/scripts/tools.js next` prints. No entry at all writes no doc - the defaults stand. Then lint, fixing every problem line until it prints `tools: ok`; a `note:` line goes in the report:

   ```bash
   node .claude/skills/capture-preferences/scripts/tools.js lint
   node .claude/skills/capture-preferences/scripts/tools.js order
   ```

   `order` prints the start line the next session gets.
7. **Report.**

   ```text
   Docs: TOOLS-PREFERENCES.md - <ids added | changed | removed> | no doc - the defaults stand
   Inventory: <n> servers - <n> table, <n> exchange, <n> session, <n> failed
   Lint: <the script's tools: line, verbatim>
   Order: <tools.js order's lines, verbatim>
   ```

   Close with one line: the order binds from the next session start, and every update after this run re-lists the servers whose registration changed.
