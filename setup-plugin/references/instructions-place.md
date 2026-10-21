# The instruction files' place - the root or .claude/

Read by `/alfred-code:init` (install phase, step 1) and `/alfred-code:configure` (step 12): where this project keeps its
`AGENTS.md` and `CLAUDE.md`. Claude Code reads each at the root and in `.claude/` alike
(<https://code.claude.com/docs/en/memory>), so the place is the team's call - nothing loads differently.

**The fact, never a guess.** `node "$TMP/repo/scripts/update-preflight.js" --offers --root <root>` writes nothing and
prints one `instructions:` line: `none`, or `claude` / `root` / `split` followed by each file found (configure's step 1
already printed it). Ask the template for the case - never an improvised one.

`instructions: none` - init only; configure skips the ask, since an update seeds nothing:

```ask
Where should this project's AGENTS.md live? Claude Code reads it at the root and in .claude/ alike.
- '.claude/AGENTS.md (Recommended)' - keeps the root tidy; the '.claude/*' + '!.claude/AGENTS.md' gitignore pair keeps it committed
- 'AGENTS.md at the root' - beside the code; no gitignore line needed
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
`--instructions-at claude`; 'Keep' and the fresh `.claude/AGENTS.md` pass none (a seed goes to `.claude/` by default). The
installer moves each file and logs it, names a file it could not move or that one at the other place blocks, and names
the `!.claude/<file>` re-include a moved, untracked file needs under a `.claude/*` line - relay those lines, never write the
`.gitignore` here. `CLAUDE.local.md` stays at the root, the one place Claude Code reads it.
