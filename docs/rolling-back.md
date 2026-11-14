# Rolling back to an earlier release

How to move from 3.11.0 back to 3.10.0, and forward again. The same steps take you to any earlier release: put its
tag where these say `v3.10.0`.

## Read this first: a rollback covers every project on the machine

The plugin comes from the `envoydev` marketplace, which Claude Code keeps once for your whole account, not per project.
Measured with Claude Code 2.1.323 on a throwaway account (one plugin installed at `local` scope in two projects):

- `claude plugin marketplace remove` uninstalled the plugin in BOTH projects - with no `--scope`, and with
  `--scope user`, the scope the marketplace is declared at.
- It also deleted the plugin's saved options and data ('The removal also deletes their saved options, secrets and data
  where it can').
- The other project's `.claude/settings.local.json` still listed the plugin as enabled, yet nothing was installed there
  until `claude plugin install` ran in it again.

The installer without the plugin does not escape this: 3.10.0's installer refreshes the same marketplace and installs
the core plugin from it, because the hooks ride the plugin. So every project on the machine moves to the release the
marketplace points at. Plan the rollback for all of them, and run step 1 in each.

`claude plugin uninstall alfred-code@envoydev --scope local` in one project leaves the others alone (measured: the
second project kept its install, enabled) - but the next 3.10.0 install in that project would bring the plugin back
from the marketplace at whatever release it points to.

## Use uninstall, then install - not update

3.11.0 keeps the skills and rules in `.alfred/stack/` and links them into `.claude/`. 3.10.0 knows neither the store
nor the links. Measured on a throwaway project (3.10.0 installed, updated to 3.11.0, then updated from 3.10.0's
source):

- at both scopes, no stack rule is left where 3.10.0 loads rules (`.claude/rules/`);
- at `local` scope, every skill link is gone from `.claude/skills/` as well.

Uninstalling with 3.11.0 first, then installing 3.10.0, leaves the project exactly as a fresh 3.10.0 install, at
`local` and at `project` scope (same test). Your docs under `.alfred/docs/`, your `AGENTS.md` or `CLAUDE.md`, and
anything of yours the install did not record stay as they are.

## The steps

1. **Uninstall in every project that has the stack**, while 3.11.0 is still installed: inside Claude Code,
   `/alfred-code:uninstall` (or, installed without the plugin,
   `node .claude/alfred-code-src/scripts/install/alfred-code.js uninstall --source .claude/alfred-code-src`). In a
   workspace, the projects below first and the root last.
2. **Pin the marketplace to the release**, once, in a shell. A marketplace name can be registered only once, so it is
   removed first - which uninstalls the plugin everywhere, as above:

   ```bash
   claude plugin marketplace remove envoydev --scope user
   claude plugin marketplace add envoydev/alfred-code#v3.10.0
   ```

   A release tag up to 3.11.0 still carries its own marketplace file, so it is added from this repo; the live
   marketplace moved to envoydev/plugins-marketplaces after it.

   `claude plugin marketplace list --json` shows the scope it is declared at, if not `user`.
3. **Install 3.10.0 in each project.**
   - With the plugin: `claude plugin install alfred-code@envoydev --scope local` (the scope the project had: `local`,
     `project` or `user`), restart Claude Code, then `/alfred-code:init` - and after the restart it asks for,
     `/alfred-code:init` again.
   - Without the plugin:

     ```bash
     rm -r .claude/alfred-code-src && mkdir -p .claude/alfred-code-src
     curl -fsSL https://github.com/envoydev/alfred-code/releases/download/v3.10.0/alfred-code.tar.gz \
       | tar -xz -C .claude/alfred-code-src
     node .claude/alfred-code-src/scripts/install/alfred-code.js install --source .claude/alfred-code-src --scope local
     ```

The pinned marketplace stays on that tag: `claude plugin marketplace update` fetches the tag again, never a newer
release.

## What 3.10.0 does not read

These stay after the uninstall, because they are yours. 3.10.0 ignores them:

| File | What to do |
| --- | --- |
| `.alfred/agents.json` (a seat's model per project) | nothing - 3.10.0 does not read it; the seats run on their own models |
| `.alfred/workspace.json` with `ignore` keys in the plural (`skills`, `rules`, ...) | rename them to the singular (`skill`, `rule`, ...) - 3.10.0 reads only those |
| `.alfred/workspace.json` with `ignoredChildren` | nothing - 3.10.0 does not read it, so a project you marked ignored is treated like any other project below the root |
| `.claude/settings.local.json` with `autoCompactEnabled` or `modelSettings` written by `/alfred-code:mode:auto-compact` | remove them by hand if you do not want them |
| a mode you switched on (`ALFRED_CODE_AUTO_RUN`, `ALFRED_CODE_SCORING`) | 3.10.0 uses the `--mode-*` flags instead; its grader key is `ALFRED_CODE_SCORER` |

## Forward again

Unpin the marketplace - this again uninstalls the plugin in every project - then install and update in each project:

```bash
claude plugin marketplace remove envoydev --scope user
claude plugin marketplace add envoydev/plugins-marketplaces
claude plugin install alfred-code@envoydev --scope local
```

Then `/alfred-code:update` in the project. A plain update works from 3.10.0: it moves the copies into the store, and
the settings into `settings.local.json`, as the first move to 3.11.0 did.

## What was not tested

- The uninstall-then-install route was run on throwaway projects with the installer alone, at `local` and `project`
  scope, on macOS.
- The marketplace remove and the one-project uninstall were run on a throwaway account with a local marketplace, never
  the real `envoydev` one.
- The pinned add (`owner/repo#v3.10.0`) follows Claude Code's CLI reference and was not run: a local marketplace
  cannot be pinned to a tag the same way.
