# System audit - Phase 1b currency check

Read at Phase 1b, before any row drives a score or an edit. Re-read each row below against the live page
(through WebFetch or the documentation server); verdict per row CURRENT | DRIFTED | UNVERIFIABLE, and a
DRIFTED row is corrected in this file in the same run - and in `scripts/session-surface.js` when the script
encodes it (its comments name the page each rule came from). The plugin mechanics the packaging grade
reads - manifest fields, path-field semantics, versioning, marketplace entries, validate, details, eval -
are `/repo-audit-plugins`' `references/currency.md`: read those rows there, never copy them here.

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
characters per entry; a `disable-model-invocation: true` skill's description not in context; `skillOverrides`
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

**MEASURED in this repo** - the skill listing budget: `skillListingBudgetFraction` of the window in TOKENS,
counted in characters at four to a token (CLAUDE.md: '39 skills, 19901 chars > 8000 budget' at a 200K window
and the `0.01` default, Claude Code 2.1.284), over it the least-used descriptions dropped whole - re-read the
fraction on the skills page each run and pass it as `--listing-fraction`; a seat denied as `Agent(<plugin>:<seat>)`
leaves the listing and the bill (spike S3, `docs/plugin-migration-evidence.md`; re-measured 2026-10-16 on 2.1.301 in
an aspnet install of 2.5.0 - the Agent tool listed 21 seats, none of the 23 denied - while `/context`'s 'Custom agents'
row still counted all 44 definitions, so read the listing, never that row, for the seat cost); a bare MCP tool name in
`permissions.deny` removes the tool from context (`code.claude.com/docs/en/permissions`, re-read 2026-10-14,
`.claude/rules/repo-installer.md`); a plugin MCP server ranks below local, project and user registrations and is
matched by endpoint, so a manual registration of the same command or url replaces it (measured 2026-09-26 on
2.1.282, `/repo-audit-plugins` currency); MCP tool schemas deferred behind tool search, their names only in the
listing.

**NOT MEASURED by the map** - a server's runtime instructions (its `initialize` reply) and the deferred tool names;
the system prompt and the harness's own tool descriptions; anything a live session alone shows. Each is a
`NOT MEASURED` line in the map, stated in the report, never estimated.
