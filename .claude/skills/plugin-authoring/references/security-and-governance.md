# Security and governance review

Run before the first publish and after any change to hooks, MCP config, dependencies or `userConfig`.
Items marked `community` are field reports the docs do not state - verify the current shape
through the documentation server before citing one as fact.

Contents: [The threat](#the-threat) - [Checklist](#checklist) - [Incident shapes](#incident-shapes) -
[Enterprise fit](#enterprise-fit)

## The threat

A plugin runs with the user's own permissions: its hooks execute shell commands on every matching
event, its MCP servers are processes started with the user's environment, and its skills steer the
model with the same authority as the user's instructions. Installing one is installing code. The
reviewer's question for every component is 'what could this do if its author were hostile, or if
its dependency were replaced', not 'does it work'.

## Checklist

1. **Every hook command has a `timeout`** and does exactly one deterministic check. A hook that
   downloads, installs or calls the network on each event is a red flag whatever it claims to do.
2. **No secret in any tracked file** - not in `.mcp.json`, not in `hooks.json`, not in a command
   body. Credentials arrive through `userConfig` `sensitive: true` entries (secure storage, exposed
   as environment variables) or the account settings `env`, and are logged by presence, never value.
3. **MCP servers are named for what they need.** A server that needs a token is registered with a
   literal `${VAR}` header and the README says which variable; a server whose scope is broader
   than the plugin's job is dropped. Tool schemas are re-injected into every session, so each
   server also has a cost line.
4. **Dependencies are lockfile-pinned** and reviewed. Node deps install with `--ignore-scripts`,
   so a plugin cannot rely on a post-install step - and a plugin that asks the user to run
   `npm install` by hand to get one back has re-opened the door the harness closed.
5. **No `../` paths, no absolute paths, no writes under `${CLAUDE_PLUGIN_ROOT}`.** Durable state
   goes to `${CLAUDE_PLUGIN_DATA}`; project writes go through `${CLAUDE_PROJECT_DIR}` and are
   named in the README.
6. **The source is pinned.** A marketplace entry names a `sha` (or an archive digest, or an exact
   npm version); a plugin installed from a moving `ref` updates whenever the branch moves.
7. **Skills and commands do not widen permissions.** `allowed-tools` pre-approves for one turn;
   a command that lists `Bash(*)` there has asked the user to trust every shell command the walk
   runs unread. Prefer the narrowest verbs and let the harness ask for the rest.
8. **The README states the blast radius**: which events the hooks bind, which servers start,
   which files the plugin writes, which binaries the user must install, and the measured always-on
   token cost (`claude plugin details`).
9. **`claude plugin validate --strict` passes**, and the eval suite's `tool_used` graders prove
   the plugin's own components are what fired - a plugin whose skill never fires still costs its
   description on every message.

## Incident shapes

Two classes the field has already seen (`community` - described by shape, verify the specifics):

- A hook-generating plugin that let a crafted rule write a hook command, turning a text rule into
  arbitrary shell at the next matching event. Lesson: a hook is code, generated or not - review the
  generated command the same way, and never let untrusted text choose the command string.
- A package whose install step read the machine's MCP configuration and exfiltrated the tokens
  registered there. Lesson: item 2 above (no live secret in a config file) and item 4 (no scripts
  at install) are the two controls that bound it; the harness's `--ignore-scripts` covers plugins,
  not what the user installs by hand beside them.

## Enterprise fit

A managed install may set `strictKnownMarketplaces` (only listed marketplaces install),
`blockedMarketplaces`, `disableCommandPluginSources` (no `command` sources),
`allowManagedHooksOnly` (plugin hooks do not run) and `disableSideloadFlags` (`--plugin-dir` /
`--plugin-url` off). A plugin whose value depends on a hook or a `command` source states that in
its README, so an evaluator in such an org knows before installing. Plugins distributed through a
claude.ai organization cannot use `bin/`.
