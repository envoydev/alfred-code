# The instruction file - its name and its place

Read by `/alfred-code:init` (install phase, step 1), `/alfred-code:configure` (step 12) and `/alfred-code:update` (the
walk - the name alone, on its `update=` verdict): which name this project's instruction file carries - `AGENTS.md` or
`CLAUDE.md` - and where it lives, the root or `.claude/`. Claude Code reads either name at the root and in `.claude/` alike (<https://code.claude.com/docs/en/memory>; AGENTS.md from 2.1.277, and
only while no CLAUDE.md or CLAUDE.local.md sits beside or above it), so both are the team's call. The seed, the fill
(`habits-adjust-agents-md`), its check and a part's own file all follow the name; the stamp keeps it.

**The facts, never a guess.** `node "$TMP/repo/scripts/update-preflight.js" --offers --root <root>` writes nothing and
prints the two lines these asks read (configure's step 1 already printed them; update's full read prints the first):

- `instructions-file: <agents|claude> files=<none|agents|claude|both> answer=<agents|claude|none> local=<yes|no>
  update=<ask-rename|ask|record-claude|none>` - the name the install works with (AGENTS.md until a name was answered),
  the names the files at the root and in `.claude/` carry, the answer the stamp keeps (`none` on an install from 2.9.0
  or earlier, never asked), whether a CLAUDE.local.md sits at the root or in `.claude/`, and what an update does;
- `instructions: none` or `claude` / `root` / `split` followed by each file found.

Ask the template for each case, the name first, both in ONE call - never an improvised one.

## The name

**`local=yes` with `files=none` or `files=claude`: no name ask** (unless `answer=claude` already). A CLAUDE.local.md
keeps every AGENTS.md unread - Claude Code reads one only while no CLAUDE.md or CLAUDE.local.md sits beside or above it -
so the answer is CLAUDE.md: pass `--instructions-file claude` and say why in one line.

**`/alfred-code:update` reads the line's `update=` verdict, never the cases below on its own:** `ask-rename` asks the
first template here, `ask` the one for the line's `files=`, `record-claude` is the rule above (passed unasked), and
`none` asks nothing. The place is configure's alone.

`update=ask-rename` - update only: an install from 2.9.0 or earlier whose one CLAUDE.md is `.claude/CLAUDE.md` (the
user's rulings of 2026-10-22 keep the nudge 2.9.0's update gave it; a root CLAUDE.md is the team's own file, which no
update renamed, so it gets `update=ask` and the `files=claude` template, Keep first):

```ask
This project's instruction file is still CLAUDE.md. Rename it to AGENTS.md, or keep CLAUDE.md?
- 'Rename to AGENTS.md (Recommended)' - Cursor and other agents read it too; git mv at the root, in .claude/ and in each part (web/CLAUDE.md), so history follows; a file already named AGENTS.md is never overwritten
- 'Keep CLAUDE.md' - nothing is renamed; the stack works with CLAUDE.md and the update asks no more
```

`files=none` - init only; configure and update skip it, since neither seeds:

```ask
Which instruction file should the stack work with? Claude Code reads either; the seed, the fill and its check follow the answer.
- 'AGENTS.md (Recommended)' - Claude Code 2.1.277+ reads it, and Cursor and other agents read it too
- 'CLAUDE.md' - Claude Code's own name, read by every version; other tools do not read it
```

`files=agents` or `files=claude` - `<have>` is the name the files carry, `<other>` the other one:

```ask
This project's instruction file is <have>. Keep working with it, or rename it to <other>?
- 'Keep <have> (Recommended)' - nothing is renamed; the stack works with <have>
- 'Rename to <other>' - git mv at the root, in .claude/ and in each part (web/<have>), so history follows; a file already named <other> is never overwritten
```

`files=both` - `<now>` is the line's first word as a file name, `<other>` the other one:

```ask
This project has both an AGENTS.md and a CLAUDE.md. Which should the stack work with? Neither is renamed while the other exists.
- '<now> (Recommended)' - the one the install works with now
- '<other>' - the seed refresh, the fill and its check move to it
```

**The answer goes to the installer as one flag**, `--instructions-file agents|claude` - the name picked or kept: 'Keep
<have>' passes <have>, a rename the other name. The stamp records it, so an update asks no more. Init passes it on every
answer; configure and update when it differs from the line's `answer=` (any answer on `answer=none`), each a change on
its own, so the installer runs. A Keep, or `files=both`, renames nothing: the installer renames only while no root or
`.claude/` file carries the answered name. Then it renames each file of the other name - each part's own too, since
Claude Code reads no AGENTS.md at all while a CLAUDE.md sits in the working directory or above it - says each rename,
names a file the new name already blocks, and re-spells a `!.claude/<old>` re-include in `.gitignore` or
`.git/info/exclude` - relay those lines. CLAUDE.local.md is Claude Code's personal file and keeps its name.

## The place

`instructions: none` - init only; configure skips it:

```ask
Where should this project's instruction file live? Claude Code reads it at the root and in .claude/ alike.
- '.claude/ (Recommended)' - keeps the root tidy; a '.claude/*' + '!.claude/<file>' gitignore pair keeps it committed
- 'The project root' - beside the code; no gitignore line needed
```

`instructions: claude ...` or `instructions: root ...` - `<files>` is the line's own list, `<other>` the place they are not:

```ask
This project's instruction files are <files>. Keep them there, or move them to <other>?
- 'Keep them where they are (Recommended)' - nothing moves
- 'Move them to <other>' - git mv where git tracks a file, so history follows; a file already at <other> is never overwritten
```

`instructions: split ...`:

```ask
This project's instruction files are split: <files>. Keep them as they are, or gather them in one place?
- 'Keep them as they are (Recommended)' - nothing moves
- 'Gather them at the root' - each .claude/ file moves up; one already at the root is never overwritten
- 'Gather them in .claude/' - each root file moves in; one already in .claude/ is never overwritten
```

**The answer goes to the installer as one flag.** The root -> `--instructions-at root`, `.claude/` ->
`--instructions-at claude`; 'Keep' and the fresh `.claude/` answer pass none (a seed goes to `.claude/` by default). The
installer renames first, then moves each file and logs it, names a file it could not move or that one at the other place
blocks, and names the `!.claude/<file>` re-include a moved, untracked file needs under a `.claude/*` line - relay those
lines, never write the `.gitignore` here. `CLAUDE.local.md` stays at the root, the one place Claude Code reads it.
