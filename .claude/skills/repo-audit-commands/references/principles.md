# Command audit - operating principles

Read before Phase 0: these define what counts as a defect in every later phase.

- Ground every claim in the actual file. Quote the specific line or block you are judging. No score, deduction, or
  fix without cited evidence from the file.
- Preserve intent. You improve how a command is written, never what it does. The same invocation must lead to the
  same steps and the same writes after your edits.
- The typed surface is a public contract. What a user types - the command's name (its file name, its folder as a
  namespace, the plugin's name in front), the order of its arguments and what each means - is remembered, scripted
  and written into docs. Never rename a command, move it between folders or reorder its arguments: record the
  better shape as a candidate and let the user decide. The description and the `argument-hint` are the editable
  half of that surface.
- The user is the trigger. A command is found in the `/` menu and typed, so its menu line - name, description,
  hint - is the whole interface before it runs. Judge that line as a person scanning a list reads it: what does
  this do, when would I run it, what do I pass.
- Invocation control is chosen per command, on purpose. The harness serves a command file and a skill through one
  mechanism, so unless the file says otherwise the model may also run it on a description match. A command that
  writes, installs, publishes, deletes or spends carries `disable-model-invocation: true` - the user owns that
  moment - and its description then leaves the model's context and costs every session nothing. A command left
  open to the model has a description that is also a trigger and is judged as one. Record the choice per command;
  a mismatch is a Dimension 1 defect.
- Arguments are input, not instructions. What follows the command name is whatever the user typed: empty, too
  many, a path with spaces, a value that does not exist. A command says what it reads (`$ARGUMENTS`, a position, a
  named argument), what it does when nothing is passed, and it checks a value before anything is written with it.
  An argument that reaches a shell line unquoted, or is pasted into a pre-run shell line, is a defect scored under
  Dimension 2.
- Side effects are gated in the flow. Before the first write the user did not spell out in the invocation, the
  body shows what will change and asks - one confirmation for the whole plan beats one per step. A command whose
  body applies changes with no such step, and no argument that is itself the confirmation, is a defect.
- User actions go through the question tool. Wherever the flow needs the user to pick, approve or supply a value,
  the body routes the ask through the AskUserQuestion tool - concrete options, a marked recommendation, free text
  through its built-in Other - with plain-text options only as the stated fallback where the harness lacks it. A
  single typed value asked in one plain line that ends the turn is a valid shape when the body says so.
- Pre-run shell lines run before the model reads anything. A `` !`command` `` line or a fenced `!` block executes
  when the command is invoked and its output replaces the line; a failing one aborts the whole invocation. So each
  is read-only, fast, bounded in output, and present because the body needs that state on every run. A line that
  writes, calls the network, prints an unbounded diff or log, or depends on a tool the user may lack is a defect.
- Pre-approval is not restriction. `allowed-tools` lets the listed tools run without a prompt for that turn; it
  removes nothing. Keep it to the exact calls the body makes - a script path with its arguments pattern, never a
  bare `Bash` - because every entry is a prompt the user no longer sees. `disallowed-tools` is the only field that
  takes a tool away.
- Paths go through the harness's variables. A file the command ships is reached through the plugin root or the
  command's own folder variable, never a relative path that depends on where the session started; state that must
  outlive an update goes to the plugin's data folder, never the plugin root. A script is started through its
  interpreter, never as a bare path.
- Manual-only entries are mentioned, never invoked. A body that tells the model to run another command or skill
  whose frontmatter blocks model invocation is a blocked edge: the correct shape names it to the user as the next
  step. Validate every 'run /x' against the target's frontmatter.
- A command is the older form. The harness prefers a skill folder for new work, since a skill can carry
  supporting files and a name of its own. A command that has grown references it cannot bundle, or that the model
  should load on its own, fits a skill better - report it as a candidate with what the move would change (the
  typed name may gain or lose a namespace). Never convert in the audit.
- Treat the command set as one surface. Two commands a person cannot tell apart from the menu, a file the
  manifest never loads, the same block pasted into four bodies - these are set-level defects invisible from any
  single file. Shared procedure belongs in a script the commands call; text that must repeat is registered in the
  repo's multi-home registry (the file its `notes` name), never left as silent copies.
- Anti-gaming over grade-chasing. A high number earned by padding, a stuffed description or a fabricated example
  is a failure, not a pass. Re-score honestly after every edit.
- Reversibility. Snapshot each command before editing so a regression can be undone.
