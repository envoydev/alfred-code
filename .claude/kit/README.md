# Managed by claude-kit

The files listed in `lock.json` come from [envoydev/claude-kit](https://github.com/envoydev/claude-kit), the one
source of the Claude Code rules and skills these repos share. Do not edit them here: change them in claude-kit and
run its sync, which rewrites them in every repo.

- `npm run kit:check` (or `node .claude/kit/check.mjs`) fails when a managed file was edited or removed here.
- `repo.json` here is this repo's own: the values the kit's templates (`solve-task`, `execution.md`) are filled
  with - its name, its checks, its commit rule. Edit it here, then run claude-kit's sync to rewrite those files.
- Everything else under `.claude/` is this repo's own: its `CLAUDE.md`, the `repo-*` rules and skills,
  `plugin-handling.md`.
