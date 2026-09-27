# Plugin authoring in full

Read before a first manifest, a new component type, or a publish, and whenever a one-line rule in SKILL.md needs its reason or measurement.

**Contents:** [When this skill applies](#when-this-skill-applies), [The manifest - `.claude-plugin/plugin.json`](#the-manifest---claude-pluginpluginjson), [Paths inside a plugin](#paths-inside-a-plugin), [Loading and precedence](#loading-and-precedence), [Distribution and versioning](#distribution-and-versioning), [Per-component rules](#per-component-rules), [Verify before publishing](#verify-before-publishing)

## When this skill applies

- A `.claude-plugin/plugin.json` or `marketplace.json` is being created or edited.
- A command, skill, agent, hook, MCP server or LSP server is being added to a plugin.
- A plugin is being published, versioned, installed for a test, or measured.
- A plugin's behaviour is being tested (`claude plugin eval`) or its cost read (`claude plugin details`).

Not for a project's own `.claude/` folder (skills, agents and hooks there load without a manifest)
and not for a single skill's body - that is `alfred-habits-skill-writing`, the same inside or
outside a plugin.

## The manifest - `.claude-plugin/plugin.json`

`name` is the only required field. Kebab-case, unique within the marketplace, and it becomes the
namespace of every command, skill and agent the plugin ships (`/<plugin>:<command>`). The rest is
optional: `version` (semver), `description`, `author` (an OBJECT with `name`, plus optional `email`
and `url`), `homepage`, `repository`, `license`, `keywords`, and the component path fields
(`commands`, `agents`, `skills`, `hooks`, `mcpServers`, `lspServers`, `outputStyles`,
`workflows`, `userConfig`). Full schema, path semantics and the marketplace shape:
`references/manifest-and-marketplace.md`.

Four rules the schema does not shout about:

- **A component path is relative to the plugin root and starts with `./`.** Nothing may reach
  above the root with `../` - a plugin copied out of a marketplace clone loses whatever `../`
  pointed at, and validate rejects the shape.
- **Path fields REPLACE the default folder for that component, except `skills`, which ADDS.**
  Setting `commands: ["./cmd"]` means `./commands/` is no longer scanned; setting `skills` scans both,
  unless the entry is sourced from the marketplace root, where the listed skill folders are the
  whole set. Hooks, MCP and LSP servers merge by their own rules.
- **The cache entry is the whole SOURCE, not the paths the entry lists.** An entry sourced from a
  repo ROOT caches that repo entire - every sibling folder, not just the subdir it serves as the
  plugin (measured on a real install). That is free tooling if you mean it: a plugin whose
  installer needs the repo's scripts reads them out of
  `<config>/plugins/cache/<marketplace>/<plugin>/<version>/` instead of downloading anything. It is
  also the leak to watch - anything in that repo ships to every machine that installs the plugin.
- **`version` in plugin.json is authoritative, silently.** A version in the marketplace entry is
  ignored when plugin.json carries one - set it in ONE place and let the other inherit. An explicit
  version also gates updates: a source change that does not bump the version is not delivered.

Only `.claude-plugin/plugin.json` lives inside `.claude-plugin/`; `commands/`, `skills/`,
`agents/`, `hooks/` sit at the plugin ROOT. A `CLAUDE.md` at the plugin root is not loaded - the
plugin's standing instruction, if it needs one, is a skill or a hook.

## Paths inside a plugin

- `${CLAUDE_PLUGIN_ROOT}` - the plugin's install directory, used in hook commands, MCP `command`
  / `args` and LSP config. It changes on every update (the cache is versioned), so nothing durable
  is written under it. Hard-coded absolute paths break for every other install.
- `${CLAUDE_PLUGIN_DATA}` - the plugin's persistent data directory
  (`~/.claude/plugins/data/<plugin-id>/`), the same across updates and across projects. State a
  plugin owns (an index, a cache, a preference the user set through it) goes here, never into the
  project tree and never into `${CLAUDE_PLUGIN_ROOT}`.
- `${CLAUDE_PROJECT_DIR}` - the project the session runs in; hooks read and write project files
  through it. Any other value a plugin needs at runtime comes from `userConfig`, whose
  `sensitive: true` entries land in secure storage and reach the process as environment variables,
  or from the session's own environment.
- Plugin MCP tools arrive as `mcp__plugin_<plugin>_<server>__<tool>`; plugin skills as
  `<plugin>:<skill>`. Name them that way in any body that routes to them.

## Loading and precedence

A plugin loads at session start; `/reload-plugins` re-reads skills, agents, hooks and plugin MCP / LSP config without a restart. `claude --plugin-dir <path>` loads a local plugin for one session and OVERRIDES an installed plugin of the same name - that is the test route. The rest (what overrides what, what a plugin agent may not declare, which `settings.json` keys a plugin honours) is under 'Loading and precedence' in `references/manifest-and-marketplace.md`; read it before wiring a component.

## Distribution and versioning

- A marketplace is a git repo (or a URL) carrying `.claude-plugin/marketplace.json`: `name`,
  `owner.name`, and `plugins[]` with `name` + `source` each. Source kinds and the reserved
  marketplace names are in the reference. `metadata.pluginRoot` (2.1.239+) sets a common
  base directory; `renames` is append-only, `null` marking a removed plugin.
- Pinning: `sha` beats `ref` in a git source. A marketplace submitted to the official catalog is
  pinned to a commit and re-synced nightly, so a fix ships when the pin moves, not when you push.
- Auto-update is ON by default for the official Anthropic marketplaces and OFF for third-party and
  local ones (a user toggles it per marketplace; an admin sets `autoUpdate: true` on a managed
  `extraKnownMarketplaces` entry). So a plugin you distribute yourself reaches its users on THEIR
  `claude plugin update`, and an updater the plugin ships is what makes that reliable.
- Managed settings can restrict what installs: `strictKnownMarketplaces`, `blockedMarketplaces`,
  `disableCommandPluginSources`, `allowManagedHooksOnly`, `disableSideloadFlags`. A plugin that
  needs a `command` source or side-loading may be blocked in an enterprise install - say so in
  its README.
- `bin/` under the plugin root is added to the Bash PATH for the session; it is not allowed for
  plugins distributed through a claude.ai organization.
- Node dependencies install automatically only with a `package.json` plus a supported lockfile
  (`package-lock.json`; `yarn.lock` / `pnpm-lock.yaml` are skipped), always with
  `--ignore-scripts`. A plugin that needs a post-install script has no supported way to run it.
- Bump the version on every user-visible change, in the ONE place that owns it. A release tag
  named `v<version>` from that field keeps the tag, the manifest and the marketplace listing equal
  by construction, and a lint that reads both files catches the drift a human edit introduces.

## Per-component rules

- **Commands** (`commands/<name>.md`, listed as `/<plugin>:<name>`): one job, imperative body,
  arguments through `$ARGUMENTS`. `allowed-tools` is a per-turn PERMISSION pre-approval, not a
  restriction and not a context saving - it covers the turn the command runs in and nothing after,
  so a multi-turn walk gains nothing from it. Commands and skills are both listed as slash entries;
  the difference that matters is DISPLAY: a plugin command lists namespaced-only, a plugin skill
  named exactly like the plugin lists bare (`/<plugin>`) - choose by what the user should see.
- **Skills** (`skills/<name>/SKILL.md`): load `alfred-habits-skill-writing` before the first write.
- **Agents** (`agents/<name>.md`): a `tools:` allowlist of tools that exist, a model / effort pin
  with the measurement that justifies it, and no `hooks` / `mcpServers` / `permissionMode`.
- **Hooks** (`hooks/hooks.json`): a `command` hook without `timeout` gets Claude Code's 600s
  default - one stalled child freezes the session for ten minutes, so every entry carries a short
  timeout (the house value is 10s; a hook runs in ~25ms, almost all of it the runtime spawn).
  Paths go through `${CLAUDE_PLUGIN_ROOT}`. A hook is a deterministic gate at a discrete event;
  advice belongs in a skill. A `UserPromptSubmit` denial erases the user's prompt, so that event
  injects and never denies.
- **MCP servers** (`.mcp.json` at the plugin root, or `mcpServers` in the manifest): a registered
  server re-injects its tool schemas into every session, so ship one only where the plugin's whole
  purpose needs it, and prefer a runtime the user already has. Credentials come from `userConfig`
  `sensitive` entries or the account settings `env`, never from a literal in the config.
- **LSP servers** (`lspServers`): the binary is the user's to install; the config names the command
  and the file extensions, and a missing binary fails at launch, so the README says what to install.

## Verify before publishing

Run these in this order; each is cheap and each catches a class the previous one cannot.

1. `claude plugin validate <plugin-dir> --strict` - schema, paths, frontmatter; `--strict` turns
   warnings into failures. Run it on the marketplace root too when one exists.
2. `claude --plugin-dir <plugin-dir>` in a scratch project, then `/reload-plugins` after each edit.
   Check the slash list shows the entries you meant (namespaced commands, bare or namespaced
   skills) and nothing you did not.
3. `claude plugin details <plugin>@<marketplace>` for the installed copy, or
   `claude --plugin-dir <plugin-dir> plugin details <plugin>` for the working tree (a bare path is
   not accepted) - the always-on and on-invoke token cost. The inventory lists skills, agents, hooks,
   MCP and LSP servers; COMMANDS are not in it, and neither is an agent LISTED by file in an
   `agents` array - it reads `Agents (0)` and leaves those descriptions out of the always-on number,
   yet every such seat registers (measured 2026-09-22: 42 of 42 listed seats in a real session's
   init list; the same three seats read `Agents (0)`, ~456 tok listed and `Agents (3)`, ~828 tok
   from a default `agents/` folder). So a plugin that lists its agents pays their descriptions ON
   TOP of the number. The estimate also ignores `disable-model-invocation`
   (the skills docs say such a description is NOT in context, yet a user-only skill still shows an
   always-on number - measured on the alfred-code router: ~210 tok reported, 0 loaded). Read the
   number as the cost of every description the MODEL can see. The always-on number is what every session pays before
   the first message; a description that grows by a paragraph is costed here, never assumed free.
4. `claude plugin eval <plugin-dir>` (Claude Code 2.1.269+) - behavioural cases under `evals/`,
   each run with and without the plugin. The command shapes, the case layout and how to read the
   with / without delta: `references/evals.md`. A `tool_used: Skill` grader that fails on natural
   phrasing sends you to the description rules in `alfred-habits-skill-writing`. A plugin with NO
   model-invocable component is still evaluable, and 'nothing here is model-invocable' is not a
   reason to skip this step: a case's `prompt.md` is a USER turn, which is exactly how a `disable-model-invocation`
   command is invoked, so a read-only walk makes a valid case whose without-arm cannot resolve the
   command at all - a clean delta. Reach for a named substitute only where every walk MUTATES a real
   install, and say so.
5. The security pass - `references/security-and-governance.md` - before the first publish and
   after any change to hooks, MCP config or dependencies.

A behaviour claim ('the plugin makes X cheaper', 'it still catches Y') ships with the eval delta
or a measured token number, never asserted.
