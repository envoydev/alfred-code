# npm 11.10 - 11.x - the project `.npmrc` baseline

The baseline for a project still on npm 11 (docs.npmjs.com labels v11 'Legacy'); npm 12 moved dependency install scripts behind `allowScripts` and its baseline is in the skill body. Read `npm -v` first - below 11.10.0 two of the four lines are unknown settings.

The four-line baseline:

```ini
ignore-scripts=true
min-release-age=7
allow-git=none
engine-strict=true
```

Why each line: lifecycle scripts are the worm execution vector; malicious versions are usually pulled within hours, so a 7-day cooldown filters nearly all of them (needs npm >= 11.10.0); a git dependency can ship its own `.npmrc` that swaps the git binary path - code execution even with scripts ignored - so git/file/remote sources are shut off (npm >= 11.10.0; the v12 default). `ignore-scripts` still runs your own `npm start`/`test` scripts.

Landing the baseline, in order:

1. List every dependency that carries an install script - the lockfile marks each one `"hasInstallScript": true`, a `binding.gyp` build included, which `npm query ':attr(scripts, [postinstall])'` misses (measured on npm 11.6.1):

   ```bash
   node -e 'for (const [k, v] of Object.entries(require("./package-lock.json").packages)) if (v.hasInstallScript) console.log(k)'
   ```

2. Vet each one: a known publisher, and a script that only builds native code - anything that fetches or runs more stays out of the list.
3. Adding the baseline is its own change: when the task did not ask for it, propose it through ONE AskUserQuestion naming the vetted list:

   ```ask
   Add the npm 11 baseline? The vetted install scripts run by `npm rebuild`: <the vetted list>.
   - 'Add the baseline (Recommended)' - merged into an existing `.npmrc`, never an overwrite
   - 'Leave npm config as it is' - nothing is written
   ```

4. Write the four lines.
5. Verify the baseline landed - `npm config get ignore-scripts min-release-age allow-git engine-strict` prints one key-prefixed line per key and must show `ignore-scripts=true`, `min-release-age=7`, `allow-git=none`, `engine-strict=true` with no `npm warn Unknown project config` line above them. That warning means npm is older than the setting and the line is being ignored, not applied - npm still echoes the raw value from `.npmrc`, so the value alone proves nothing (measured on npm 11.6.1).
6. Run the vetted ones explicitly after every install: `npm rebuild <name> --ignore-scripts=false` (a bare `npm rebuild` under the committed `ignore-scripts=true` runs nothing and still exits 0 - measured on the same npm). Record that command as a project script - `npm run` still runs the script it names - so CI runs the same list after `npm ci`.
7. Close on the project's build and test run with their result lines quoted, never on the config echo alone.
