# Manifest and marketplace schema

Checked against the Claude Code plugins reference and marketplaces pages on 2026-09-12. Re-verify
a field through context7 before relying on a detail that is not in the body of this file.

Contents: [plugin.json](#pluginjson) - [Layout](#layout) - [marketplace.json](#marketplacejson) -
[Loading and precedence](#loading-and-precedence) -
[Source kinds](#source-kinds) - [Reserved names and governance](#reserved-names-and-governance) -
[Where things live on disk](#where-things-live-on-disk) - [CLI](#cli)

## plugin.json

```json
{
  "name": "my-plugin",
  "version": "1.2.0",
  "description": "One sentence: what it adds and when it fires.",
  "author": { "name": "Team", "email": "team@example.com", "url": "https://example.com" },
  "homepage": "https://example.com/docs",
  "repository": "https://github.com/org/my-plugin",
  "license": "MIT",
  "keywords": ["review", "ci"],
  "commands": ["./commands/review.md"],
  "agents": "./agents/",
  "skills": "./extra-skills/",
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./.mcp.json",
  "lspServers": "./.lsp.json",
  "outputStyles": "./output-styles/",
  "userConfig": {
    "apiToken": { "description": "Tracker API token", "sensitive": true }
  }
}
```

| Field | Notes |
|---|---|
| `name` | REQUIRED. Kebab-case; the namespace of every command / skill / agent (`/<name>:<cmd>`). Unique within its marketplace. |
| `version` | Semver. Authoritative over a version in the marketplace entry, silently. When present, an update ships only on a bump. |
| `author` | An OBJECT with `name` (plus `email`, `url`). A bare string fails strict validation. |
| Component paths | Relative to the plugin root, starting `./`; a string or an array; a file or a directory. `commands`, `agents`, `outputStyles`, `workflows` REPLACE the default folder; `skills` ADDS to `./skills/` (except in an entry sourced from the marketplace root, where the listed folders are the whole set); `hooks`, `mcpServers`, `lspServers` merge by their own rules. `../` is rejected - a copied plugin cannot reach above its root (a symlink inside the root is the workaround). |
| `userConfig` | Named values the user is asked for on install; `sensitive: true` stores in secure storage and reaches hooks / servers as an environment variable. |
| `experimental.evals` | The eval suite directory when `evals/` is taken (see `evals.md`). |

## Layout

```
my-plugin/
├── .claude-plugin/plugin.json     # the ONLY file inside .claude-plugin/
├── commands/<name>.md             # /my-plugin:<name>
├── skills/<name>/SKILL.md         # my-plugin:<name>
├── agents/<name>.md
├── hooks/hooks.json               # ${CLAUDE_PLUGIN_ROOT}/... for every script path
├── .mcp.json                      # or mcpServers in the manifest
├── bin/                           # on the Bash PATH for the session (not for claude.ai org distribution)
├── evals/                         # claude plugin eval cases
└── README.md                      # install line, what the user must install themselves, the cost
```

A `CLAUDE.md` at the plugin root is NOT loaded. A `package.json` with `package-lock.json` gets its
dependencies installed with `--ignore-scripts`; `yarn.lock` and `pnpm-lock.yaml` are skipped.

## marketplace.json

At `.claude-plugin/marketplace.json` in the marketplace repo:

```json
{
  "name": "acme-tools",
  "owner": { "name": "Acme", "email": "tools@acme.example" },
  "metadata": { "description": "Acme's Claude Code plugins", "version": "0.4.0", "pluginRoot": "./plugins" },
  "renames": { "old-name": "new-name", "dropped": null },
  "plugins": [
    { "name": "my-plugin", "source": "./my-plugin", "description": "...", "category": "productivity" }
  ]
}
```

Required: `name`, `owner.name`, and per plugin `name` + `source`. `metadata.pluginRoot`
(Claude Code 2.1.239+) resolves BARE source names (no `/`) under that directory. `renames`
(2.1.193+) is an object keyed by the OLD name, append-only history; `null` marks a plugin that was
removed. A setting still naming the old name is rewritten to the new one with a one-line notice.
Never set `version` in both plugin.json and the marketplace entry - plugin.json wins silently.

An ENTRY may carry any field of the plugin manifest schema alongside the marketplace-specific ones,
so it can declare `lspServers`, `mcpServers`, `hooks`, `commands`, `agents` or `skills` itself. That
is how a published plugin can hold nothing but a LICENSE and a README - the entry IS the plugin.
`strict` (default `true`) decides who owns the definition: leave it true and the package's own
`plugin.json` is authoritative; set it `false` and the ENTRY becomes the entire definition, at which
point a package that also declares components is a load-failing conflict. So a component-carrying
entry ships either an empty package or `strict: false`, never both halves declaring.

## Loading and precedence

- A plugin loads at session start; `/reload-plugins` re-reads skills, agents, hooks and plugin
  MCP / LSP config without a restart (an MCP change waits for an interactive terminal).
- `claude --plugin-dir <path>` loads a local plugin for one session and OVERRIDES an installed
  plugin of the same name (a managed force-enabled or force-disabled plugin excepted). A `.zip`
  works too, and a folder of plugins needs Claude Code 2.1.265 or later. This is the test route.
- A project or user `.claude/agents/<name>.md` overrides a plugin agent of the same name; plugin
  skills COEXIST with local ones because they are namespaced.
- A plugin agent cannot declare `hooks`, `mcpServers` or `permissionMode` - those belong to the
  plugin, not to one seat.
- A plugin's `settings.json` honours only `agent` and `subagentStatusLine`; permissions, env and
  hook wiring do not ship through it.
- Boolean frontmatter accepts `yes`/`no`/`on`/`off`/`1`/`0`/`true`/`false`.

## Source kinds

| `source` | Shape | Pin |
|---|---|---|
| relative path | `"./my-plugin"` | the marketplace's own commit |
| github | `{ "source": "github", "repo": "org/repo", "ref": "main", "sha": "<40 hex>" }` | `sha` beats `ref` |
| git url | `{ "source": "url", "url": "https://...git", "ref": "...", "sha": "..." }` | same |
| git subdirectory | `{ "source": "git-subdir", "url": "...", "path": "plugins/x" }` | same |
| npm | `{ "source": "npm", "package": "@org/plugin", "version": "1.2.0" }` | exact version |
| archive | `{ "source": "archive", "url": "https://.../x.zip", "sha256": "..." }` | the digest |
| command | `{ "source": "command", "command": "..." }` | none - managed settings can disable it |

## Reserved names and governance

- Reserved MARKETPLACE names (rejected on add): `claude-plugins-official`, `claude-community`,
  `anthropic-plugins` and the other Anthropic-owned names the reference lists. Plugin names are not
  reserved by prefix.
- Managed settings that shape what a user can install: `strictKnownMarketplaces`,
  `blockedMarketplaces`, `disableCommandPluginSources`, `allowManagedHooksOnly`,
  `disableSideloadFlags` (turns `--plugin-dir` / `--plugin-url` off), `pluginSuggestionMarketplaces`.
- An official-catalog or community submission goes through the in-app form; the listing is pinned
  to a commit SHA and re-synced nightly.
- `CLAUDE_CODE_PLUGIN_SEED_DIR` pre-seeds plugins onto a machine image; a seeded plugin is copied,
  so it cannot reference `../`.

## Where things live on disk

| What | Path |
|---|---|
| Installed plugin cache (versioned; changes on update) | `~/.claude/plugins/cache/...` = `${CLAUDE_PLUGIN_ROOT}` |
| Persistent plugin data | `~/.claude/plugins/data/<plugin-id>/` = `${CLAUDE_PLUGIN_DATA}` |
| Marketplace clones | `~/.claude/plugins/marketplaces/<name>/` (the whole repo) |
| Install registry | `~/.claude/plugins/installed_plugins.json` |

`$CLAUDE_CONFIG_DIR` replaces `~/.claude` when set.

## CLI

```
claude plugin init [dir]                      # scaffold a manifest + folders
claude plugin validate <dir> [--strict]       # schema + paths; --strict fails on warnings
claude plugin install <name>@<marketplace>    # also: --scope user|project|local
claude plugin update|uninstall|enable|disable|prune
claude plugin list [--json [--available]]       # --available lists marketplace plugins too
claude plugin tag [path]                      # cut a release git tag from the manifest version
claude plugin details <name>@<marketplace>    # installed copy: components + always-on / on-invoke token cost
claude --plugin-dir <dir> plugin details <name>  # the same for a working tree (commands are not inventoried)
claude plugin eval <dir> ...                  # behavioural suite (evals.md)
claude --plugin-dir <dir|zip> [--plugin-dir ...]   # one-session load; overrides a same-named install
claude --plugin-url <url>                     # one-session load from a URL
claude plugin marketplace add|remove|update <source>
/reload-plugins                               # in-session: skills, agents, hooks, plugin MCP + LSP
```
