---
paths:
  - "stack/**"
  - "setup-plugin/**"
  - "meta/**"
  - "scripts/**"
  - ".claude-plugin/**"
  - "package.json"
---

# Plugin handling

Adding, changing, renaming or removing anything the plugin ships. `CLAUDE.md` holds the why; this is the order of work.

## One home per item

- A skill is `stack/skills/<name>/SKILL.md`, an agent `stack/agents/<seat>.md`, a rule `stack/rules/alfred-<job>.md`, a hook `stack/hooks/<name>.js` plus its `hooks[]` row, an MCP server its manifest row plus `meta/mcp-pins.json`, a command `setup-plugin/commands/<name>.md`.
- `meta/stack-manifest.json` is hand-edited and lists every one of them. Change the item and its manifest row in the same step.
- A rename adds a `renamed` row (old to new), a removal a `retired` row, or installed projects keep the old copy or prune it wrongly.
- New names are `alfred-code` / `ALFRED_CODE_`. A 1.x spelling is written only where `CLAUDE.md` allows it, with its `legacy-name` mark.

## Generated files are regenerated, never edited

- `meta/plugin-entries.json`, the `plugins[]` of `.claude-plugin/marketplace.json` and `meta/stack-graph.json` come from `npm run marketplace` and `npm run graph`.
- Run them after any item is added, renamed or removed, then `npm run lint`. A stale generated file fails lint; fixing the output by hand is overwritten by the next run.
- The repo root is a plugin source. Never add `skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `bin/` or another reserved root name (`CLAUDE.md` lists them); declare hooks and servers inline in the entry.

## One version

- The version lives in `setup-plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (`metadata.version`) and `package.json`. Bump all three together on `develop` with any release-worthy change; lint fails on drift.
- The release tags `v<version>` from `plugin.json`. A version whose tag already names another commit fails the release job, so bump before merging, never after.

## Release

- `develop` is where work lands and `main` is the release branch. Never commit feature work to `main`.
- Merging `develop` into `main` is the release: do it only on the user's explicit word, after the proof below, and report what was not run.

## Proof

- A change to any shipped item runs `npm run lint` and the tests that cover it per batch, the full `npm test` once at the end, and is exercised from this working tree in a throwaway project (`--source <repo>`), never a real consuming project. Read the written files, not the exit code.
- A description stays inside its cap (agent 300, skill 160 characters) and the always-on budget of lint check 33; a longer trigger goes in the body.
- The repo is public: no private project names or absolute local paths in a tracked file.
