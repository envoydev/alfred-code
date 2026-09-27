---
name: plugin-authoring
description: Use when creating or changing a Claude Code plugin - a `.claude-plugin/plugin.json` manifest, a `marketplace.json`, plugin commands / skills / agents / hooks / MCP or LSP config, `${CLAUDE_PLUGIN_ROOT}` paths - or when publishing, versioning or testing one (`claude plugin validate`, `--plugin-dir`, `claude plugin eval`). Covers manifest schema, layout and precedence, distribution, versioning, per-component rules, verification and the security review. Not for a project's own `.claude/` folder, and not for authoring one skill's body.
---

# Plugin authoring

A plugin is a directory Claude Code loads as one unit: a manifest under `.claude-plugin/`, and the component folders beside it. Everything here was checked against the Claude Code plugins docs on 2026-09-12; a claim marked `community` comes from field reports - re-verify it, and anything version-coupled, through the documentation server at the moment of use: the docs are the authority, this file is the map.

**Each rule below is one line; `references/authoring-in-full.md` carries it with its reason and the measurements - read it before a first manifest, a new component type, or a publish.** Not for a project's own `.claude/` folder, and not for a single skill's body - that is `alfred-habits-skill-writing`.

## The manifest and paths
- `.claude-plugin/plugin.json` needs only a kebab-case `name` (the namespace of everything it ships); `author` is an object. Full schema and the marketplace shape: `references/manifest-and-marketplace.md`.
- A component path is relative to the root and starts with `./`, never `../`. A path field REPLACES its default folder, except `skills`, which ADDS.
- The cache entry is the whole SOURCE - an entry sourced from a repo root ships the whole repo to every install.
- `version` in plugin.json wins silently over the marketplace entry and gates updates - set it in ONE place.
- Only `plugin.json` lives in `.claude-plugin/`; the component folders sit at the plugin root; a root `CLAUDE.md` is not loaded.
- `${CLAUDE_PLUGIN_ROOT}` for hook, MCP and LSP commands (it moves on every update - nothing durable under it); `${CLAUDE_PLUGIN_DATA}` for state the plugin owns; `userConfig` (`sensitive: true` for secrets) for runtime values. Tools arrive as `mcp__plugin_<plugin>_<server>__<tool>`, skills as `<plugin>:<skill>`.
- `claude --plugin-dir <path>` loads a local copy for one session, overriding the installed one; `/reload-plugins` re-reads without a restart. Precedence and what a plugin agent may not declare: the reference's 'Loading and precedence'.

## Distribution
- A marketplace carries `.claude-plugin/marketplace.json` (`name`, `owner.name`, `plugins[]`); `sha` pins beat `ref`; auto-update is off for third-party marketplaces, so users update on their own `claude plugin update`.
- Managed settings can block marketplaces, command sources and side-loading - say so in the README when the plugin needs them.
- Node dependencies install only with a `package.json` and `package-lock.json`, always `--ignore-scripts`.
- Bump the version on every user-visible change, in its one home; a `v<version>` release tag keeps tag, manifest and listing equal.

## Per-component rules
- **Commands**: one job, arguments through `$ARGUMENTS`; `allowed-tools` is a per-turn permission pre-approval, never a restriction; a command lists namespaced, a skill named like the plugin lists bare.
- **Skills** (`skills/<name>/SKILL.md`): load `alfred-habits-skill-writing` before the first write.
- **Agents**: a `tools:` allowlist of real tools, a measured model / effort pin, no `hooks` / `mcpServers` / `permissionMode`.
- **Hooks**: every entry carries a short `timeout` (the default is 600s; the house value 10s), paths through `${CLAUDE_PLUGIN_ROOT}`; a `UserPromptSubmit` hook injects, never denies.
- **MCP servers** only where the plugin's purpose needs one (their schemas load every session), credentials from `userConfig` or the account `env`, never a literal. **LSP servers**: the README names the binary to install.

## Verify before publishing

In order: `claude plugin validate <dir> --strict`; `claude --plugin-dir <dir>` in a scratch project, checking the slash list; `claude plugin details` for the always-on cost (commands and agents listed by file are NOT in its number - read the reference); `claude plugin eval <dir>` with and without the plugin (`references/evals.md`); the security pass (`references/security-and-governance.md`) before the first publish and after any hook, MCP or dependency change. A behaviour claim ships with the eval delta or a measured token number.
