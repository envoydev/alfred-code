---
description: House baseline - the user's preferences docs, when to read them and what they outrank. Always-on (no paths), installer-managed - update overwrites local edits.
---

# The user's preferences

The docs in `__DOCS_ROOT__/preferences/` bind every session and seat - the personal doc the main session alone - each one that exists:

- `PERSONAL-PREFERENCES.md` - how the user wants you to work with them: answers, language, asks, habits.
- `PROJECT-CODE-PREFERENCES.md` - how this codebase writes each language, a section per language.
- `PERSONAL-CODE-PREFERENCES.md` - how the user wants one unit written.
- `ARCHITECTURE-PREFERENCES.md` - how the user wants units to relate.
- `GIT-PREFERENCES.md` - branches, commits, pull requests and history; its `locked` entries are the consent, checkpoint, safety, attribution and checks lines.

- The personal doc is pushed into the main session's start and again after each compaction - a seat answers the main session, not the user; when it exists and is not in your context, read it before your first reply.
- Read the project, personal code and architecture docs before changing code, before writing a design plan, and when the user asks to discuss code; read the git doc before any git write (stage, commit, push, merge, rebase, reset, a branch or tag made or deleted). No commit or push without the user's word. Once per session and per seat, again after a compaction - a hook hands them over at the first edit and the first git write where it runs.
- They rank above every skill, house convention, quality-loop prompt and the architecture map, in this order: the personal code and architecture docs, the project doc, the decision log and AGENTS.md, a loop prompt, a convention skill. Where an entry and a skill or another instruction disagree, ask the user which wins, the entry's side marked (Recommended) - a seat names the clash in its report and carries on with the entry's side; a waiver is the entry's own `Except:` line.
- They never override security, input validation, error handling or accessibility, never open a hook's gate, and no entry weakens a `locked` one.
- The preferences capture changes the personal, personal code, architecture and git docs; the code-style capture refreshes the project doc. Never edit a doc to make a change pass.
- A personal, code, architecture or git preference the user states in chat is named back to them as `/capture-preferences <their words>` to run - only the preferences docs reach every session.
