# Plugin CLI evidence - what Claude Code does with a renamed, dropped or re-installed plugin

The findings from the 2026-09-24 / 25 rename spikes that current code still relies on, kept under
their spike numbers so each citation holds. Measured against Claude Code 2.1.281 (S11-S25) and
2.1.282 (S28), macOS, with an isolated `HOME` / `CLAUDE_CONFIG_DIR` per case. The marketplace was a
local git repo served over smart HTTP, and sessions ran against a Messages API stub, so no model
was billed. In the fixtures, `old-core` / `old-hooks` stand for the two v1 plugin ids and
`new-core` for the v2 id. The full spike log, with the verbatim CLI output, is in git history
under `docs/rebrand-evidence.md` (deleted 2026-10-07).

| Spike | What was run | Finding |
|---|---|---|
| S11 | v1 marketplace with `old-core` and `old-hooks` installed, then v2 pushed with a top-level `renames` map folding both into `new-core`; `marketplace update`, then sessions. | **A rename leaves a session with no guard hooks, and it does not self-heal.** `enabledPlugins` points at an id the CLI's own `installed_plugins.json` / `plugin update` never installs, and every session in between runs with zero hooks from either generation until an explicit `claude plugin install <new-id>@<key> -s <scope> -y` repairs it. `plugin list --json` read `enabled: false` for the broken row. |
| S13 | The S11 sequence against a third, independent fixture, with the second id dropped (no rename entry for it at all). | **Dropping an id fails the same way.** The dropped id stays enabled in `settings.json` with nowhere to load from and never fires, and the new id reaches S11's not-actually-installed state. A row the catalog no longer lists shows its failure only in `plugin list --json`'s `errors` field. |
| S16 | v1 = one root-sourced plugin (an inline `SessionStart` hook plus one skill), v2 = the same plugin renamed 1:1, at project and at user scope; three sessions each. | **A plain 1:1 rename breaks too.** No hook and no skill content reaches any of the three sessions at either scope, even at user scope where `enabledPlugins`, `installed_plugins.json` and `plugin list --json` all look correct. At project scope the bookkeeping never records the new name. |
| S22 | From an install whose catalog lists the old ids as aliases: `claude plugin install new-core@<key> --scope project -y`, then `uninstall` of both old ids, then three sessions. | Each session fires exactly one `SessionStart` hook and lists one skill, and project `enabledPlugins` holds `new-core@<key>: true` alone. **`plugin list --json` shows the row `"enabled": false` while the plugin visibly runs every session** - the listing's flag is no evidence of whether a plugin runs. |
| S25 | A v3 catalog under the same key that lists only `new-core` (both old aliases dropped), pushed to a project still enabled on an old id; `marketplace update`, then sessions. | **An id the catalog drops stops loading at once, silently.** The project falls into a full hook blackout the moment the marketplace refreshes, with no warning beyond an unread `plugin list --json` error field. An alias can leave the catalog only on evidence that no install still resolves through it. |
| S28 | An engine plugin installed first, then `claude plugin install` over it from a project: (a) user scope, disabled; (b) user scope, enabled; (c) project scope, disabled; (d) project scope, enabled. Then `enable` on an enabled one, `disable` on a disabled one, `update` on a disabled one, `uninstall` on a disabled one and on one not installed. | **`install` is not a no-op over an installed plugin.** (a), (b): a second, enabled project-scope install beside the user row. (c): project `enabledPlugins` flips from `false` to `true`. (d): `already installed`, exit 0, nothing changed. Every case prints `Successfully installed`, so the output cannot tell a new install from an existing one. `enable` over enabled and `disable` over disabled exit 1 (`is already enabled/disabled at project scope`), and `update` over a disabled plugin exits 0 with the flag left `false`. `uninstall` of a disabled plugin exits 0 and drops its row and its `enabledPlugins` key. `uninstall` of one not installed exits 1. A project `uninstall` leaves the user-scope row alone. |

## What this settles

- The marketplace ships no `renames` key, and lint 49 fails on one (S11, S16). A renamed or retired
  id is migrated by update: the successor is installed first, then the old id is uninstalled.
- A plugin's enabled state is read from the settings file at the row's scope before the listing's
  flag, and the locked core counts as enabled whatever the listing says (S22).
- The seed never runs `install` over a plugin it knows is there. It runs `update` at the plugin's
  own scope, which keeps the flag. A toggle the settings file shows already made is skipped,
  because a no-op toggle exits 1 (S28).
- `/alfred-code:status` reads each row's `errors` field, the only place a plugin that cannot load
  says so (S13, S25).
