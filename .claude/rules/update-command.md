# A change an install needs reaches it through the update command

- A fix or a feature can change what an earlier version left on a user's machine or in their project: a file, a folder, a setting, a hook, an environment key, a plugin id or a data format. Such a change ships its update step in the same change. Why: some fixes never reached an install after a plugin update, because the update command had no step for them (the user, 2026-11-25).
- Check each change: after `/<plugin>:update`, does an install of the last released version still hold the old state? If yes, add an update step, or make the new version read the old state as it is and name that reader in the close.
- No update step is needed for a change to the plugin's own files - its code, skills and docs, which the plugin update replaces. The same holds for a copy the update command already refreshes on each run.
- Where the update step goes:
  - alfred-code: the installer's update (`scripts/install/`), with its lists in `meta/stack-manifest.json` and `meta/retired-plugins.json`. It re-copies the installed files and re-wires the hooks on each run. Use `meta/migrations.json` only to remove a generated file or to change an `env` key. Add no update step to the update walk.
  - alfred-mods: `hooks/update/`, which `/alfred-mods:update` runs. Old names and ids go in `hooks/update/constants.ts`.
  - alfred-tools: a row in `catalog/fixes.json` with an `upgrade` version, its `detect` and `fix` in `scripts/fix/`. `/alfred-tools:update` offers it. The update pass already refreshes the copied helpers and the pins.
  - claude-kit has no update command: the sync carries each change. Name a dropped plugin, server or kit script in `shared/retired.json`.
- An update step finds the old state by what is there, never by a version number alone. So it runs safely twice, and on an install that skipped versions.
- An update step changes only what an earlier version of the plugin made. It never removes what the user made or changed without the user's yes. It says what it did.
- An update step reaches no install without a version bump. Its `since` or `upgrade` value is that new version.
- A test starts from the old state and shows that the update command ends in the new one.
- In alfred-code, alfred-mods and alfred-tools, the close of a change carries one line: `Update step: <its id or path> - <what it changes>`, `Update step: reader - <what reads the old state>`, or `Update step: none - <why>`.
