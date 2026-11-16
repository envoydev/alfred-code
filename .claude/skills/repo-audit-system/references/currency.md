# System audit - Phase 1b currency check

Read at Phase 1b, before any row drives a score or an edit. Re-read each row below against the live page
(through WebFetch or the documentation server); verdict per row CURRENT | DRIFTED | UNVERIFIABLE, and a
DRIFTED row is corrected in the same run at this file's source in claude-kit (`shared/skills/`) - an edit where
the run is in that repo, a handoff line in the report otherwise - and never in a synced `.claude/` copy, which
the next sync overwrites; it is corrected too in the session-surface tool a `notes` line names when that tool
encodes it (its comments should name the page each rule came from). The plugin mechanics the packaging grade
reads - manifest fields, path-field semantics, versioning, marketplace entries, validate, details, eval - are
the facts A1-A5 state in `rubric.md`, not rows here: re-read each against its live page
(`plugins/manifest-reference`, `plugins/marketplace-reference`, `plugins/loading`, `plugins/cli-reference`,
`plugin-evals`) and give it a verdict row in the report's currency table.

**OFFICIAL, read 2026-10-16** - session loading (`code.claude.com/docs/en/memory`): CLAUDE.md,
`.claude/CLAUDE.md` and `CLAUDE.local.md` in the working directory and every directory above it load at launch,
root first, concatenated; a subdirectory's load on demand; `AGENTS.md` and `.claude/AGENTS.md` are read
instead only while none of those three sits on that path (`~/.claude/CLAUDE.md`, a managed CLAUDE.md and
`.claude/rules/` files do not count), from v2.1.277; `@path` imports expand at launch, relative to the
importing file, four hops deep, skipping code spans and fenced blocks, an import outside the working directory
needing a one-time approval; block-level HTML comments stripped, ones inside code blocks kept; a rule without
`paths` loads at launch at `.claude/CLAUDE.md`'s priority, a path rule when Read, Write or Edit touches a
matching file or a Bash command that counts as a read (`cat` or `head` on one file) views it, its frontmatter removed (`paths` the only field read; unparseable YAML loads it as pathless).
The skill listing (`code.claude.com/docs/en/skills`): `description` plus `when_to_use` truncated at 1,536
characters per entry (the `skillListingMaxDescChars` default, row below); a `disable-model-invocation: true` skill's description not in context; `skillOverrides`
`on` / `name-only` / `user-invocable-only` (hidden from the listing, still in the `/` menu) / `off`, absent
read as `on`. Hooks (`code.claude.com/docs/en/hooks`): matcher values - SessionStart `startup`, `resume`,
`clear`, `compact`, `fork`; PreCompact `manual`, `auto`; SubagentStart and SubagentStop the agent type
(plugin-scoped as `<plugin>:<name>`); UserPromptExpansion the command name; `*`, empty or none match all; only
letters, digits, `_`, `-`, spaces, `,` and `|` is an exact name or a `|` / `,` list; anything else an
UNANCHORED JavaScript regex; a matcher on UserPromptSubmit, PostToolBatch, Stop, TeammateIdle, TaskCreated,
TaskCompleted, WorktreeCreate, WorktreeRemove, MessageDisplay or CwdChanged is silently ignored; all matching
hooks run in parallel, and an identical handler defined in more than one settings file runs once while a plugin's or
a skill's copy of it stays separate; plain stdout is added as context on
UserPromptSubmit, UserPromptExpansion, SessionStart and PostModelSwitch only; `hookSpecificOutput.additionalContext`
on SessionStart, SubagentStart, UserPromptSubmit, UserPromptExpansion, PreToolUse, PostToolUse,
PostToolUseFailure, PostToolBatch, Stop, SubagentStop and PostModelSwitch; timeouts default to 600 seconds for
`command` / `http` / `mcp_tool`, 30 for `prompt`, 60 for `agent`, lowered to 30 on UserPromptSubmit,
PreModelSwitch and PostModelSwitch and to 10 on MessageDisplay.

**OFFICIAL, read 2026-11-03** - `skillListingMaxDescChars` (`code.claude.com/docs/en/settings-reference`,
`skillListingMaxDescChars`; `code.claude.com/docs/en/skills`, 'Skill descriptions are cut short'): the per-skill
cap on `description` plus `when_to_use` in the listing, a positive integer of characters, default `1536`, scope
'Any file'; raising it keeps long descriptions at more context per turn, lowering it fits more skills under
`skillListingBudgetFraction` (default `0.01` of the window). A map reads it from the fixture's settings, so a
changed value is taken as it stands; a surface tool that hard-codes a fallback (a `notes` line names it) is checked
against this row.
The **Project instructions** setting (`code.claude.com/docs/en/memory`, 'Choose which instruction files load';
`code.claude.com/docs/en/settings-reference`, `pluginConfigs`): which instruction files load, set in `/config`
or as `pluginConfigs["cc-plugin-agents-md@builtin"].options.instructionFiles` (`agents-md@builtin` before
v2.1.285, either ID read after), read from the user file, a `--settings` file or managed settings, ignored in
project and local files - `claude-md-or-agents-md` (the default: `AGENTS.md` only while no `CLAUDE.md`,
`.claude/CLAUDE.md` or `CLAUDE.local.md` sits on the path), `claude-md-and-agents-md` (each directory's
`CLAUDE.md` files first, its `AGENTS.md` after, a file already loaded skipped), `claude-md`, and `managed-only`
(the managed `CLAUDE.md` and auto memory at launch; project, local and user `CLAUDE.md`, `.claude/rules/` and
every `AGENTS.md` left out, path rules still on demand); absent from `/config` before v2.1.277 or with the
built-in plugin disabled. The map models the default only: a fixture account that sets another value has its
memory rows reported as off-model, never scored.

**MEASURED on plugin fixtures** - the skill listing budget: `skillListingBudgetFraction` of the window in TOKENS,
counted in characters at four to a token (measured at a 200K window and the `0.01` default on Claude Code 2.1.284),
over it the least-used descriptions dropped whole - re-read the fraction on the skills page each run and pass it to
the map; an agent denied as `Agent(<plugin>:<agent>)` leaves the listing and the bill (re-measured 2026-10-16 on 2.1.301:
the Agent tool listed only the allowed agents while `/context`'s 'Custom agents' row still counted every definition,
so read the listing, never that row, for the agent cost); a bare MCP tool name in `permissions.deny` removes the tool
from context (`code.claude.com/docs/en/permissions`, re-read 2026-10-14); a plugin MCP server ranks below local,
project and user registrations and is matched by endpoint, so a manual registration of the same command or url
replaces it (measured 2026-09-26 on 2.1.282); MCP tool schemas deferred behind tool
search, their names only in the listing. The repo's own evidence for these rows, where it keeps any, is a `notes`
line.

**NOT MEASURED by the map** - a server's runtime instructions (its `initialize` reply) and the deferred tool names;
the system prompt and the harness's own tool descriptions; anything a live session alone shows. Each is a
`NOT MEASURED` line in the map, stated in the report, never estimated.
