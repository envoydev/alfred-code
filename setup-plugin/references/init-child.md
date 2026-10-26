# /alfred-code:init - the install phase in a child of an installed folder

Read by section 1's detection call only on `parent: <rel><TAB>child=yes`: a folder above this project holds an install
it can join. A child takes that install's set and env, adds its own picks, and can ignore any item it inherits. Every
step of `init-install.md` runs as written, with the changes below; say once in the narration `<rel> holds an install -
this project installs as its child`.

## Screen A

- **Scope** - this template in place of the scope one, `local` first: a child inside a team's folder is usually one
  person's checkout, and its committed settings are the team's.

  ```ask
  Where should the stack's plugins be enabled in this child of <rel>? The library copies, rules, settings and stamp live in this project's .claude/ at every scope.
  - 'local (Recommended)' - this checkout only; the stack's settings go to .claude/settings.local.json and the committed settings.json is left as it is
  - 'project' - .claude/settings.json: everyone who clones this repo
  - 'user' - every project of this account
  ```

- **The instruction file** - no name or place question: a child's file is `.claude/AGENTS.md`, so the installer call
  passes `--instructions-file agents --instructions-at claude`.

## The parent's set - read once, right after screen A

```bash
(cd "<rel>" && node "$TMP/repo/scripts/install/alfred-code.js" update --source "$TMP/repo" --scope "$(node "$TMP/repo/scripts/install/stamp.js" scope .)" --installed-only --print-plan --plan-out "$TMP/parent.json" > "$TMP/parent.out" 2>&1) ; echo "parent-read: $?"
```

`--print-plan` writes nothing there. `parent-read: 0` -> go on as a child. Anything else -> say `the install at <rel>
could not be read - installing standalone; /alfred-code:update offers the join later` and run `init-install.md` as a
standalone install, none of the rest of this file.

## The walk and screen B

- Every `--table` call adds `--inherited "$TMP/parent.json"`, so a row the parent holds reads `from root` (`walk.md`).
  A `from root` row stays unless the user unpicks it, and is never this project's own pick. An unpick is an IGNORE,
  never a drop: leave the row out of `raw.json` and append one `<category> <name>` line to `$TMP/ignores.txt`
  (`rule`, `agent`, `skill`, `hook` or `plugin`).
- Screen B reads the parent's env with `node "$TMP/repo/stack/hooks/guard-secret-value.js" --redacted
  "<rel>/.claude/settings.json"` (and its `settings.local.json` when there is one - its keys win). Each question shows
  the parent's value as its default, marked `from root`. An answer equal to it writes nothing, since the install takes
  the parent's value; only a different answer is merged (or, for the fresh-session group, passed as `--auto-compact`),
  and that key is this project's own from then on. The data question stays this project's own: the data root is never
  inherited.

## Before the install call - the join, then the ignores

ONE call, each `workspace.js` step with `--data-path <folder>` when screen B's data question took a folder other than
`.alfred`:

```bash
node "$TMP/repo/scripts/workspace.js" register --root . ; echo "register: $?" ; [ -f "$TMP/ignores.txt" ] && while IFS= read -r line; do node "$TMP/repo/scripts/workspace.js" ignore --root . --add "$line"; done < "$TMP/ignores.txt"
```

`register: 0` -> the install call (step 10) adds `--parent-plan "$TMP/parent.json"`. Any other code -> paste its `!!`
line and install standalone, without `--parent-plan`; on `3` (the parent's file was locked) say the join is offered
again at the next update. The ignores are written either way, so they apply once the join comes back.

## Git hygiene at `local` scope

At `local` scope the post-check's git-hygiene ask is this template, the clone's own exclude file first, with
`.claude/*` and `/<data root>/` among its lines; at `project` or `user` scope it stays as `init-install.md` writes it.

```ask
Ignore these machine-local paths in this clone? <the exact lines>. The install is local, so the committed .gitignore is the team's.
- '.git/info/exclude (Recommended)' - this clone only, no committed file touched
- 'The committed .gitignore' - one block the team shares, so no clone lists them as untracked
- 'Skip' - nothing is written
```

The data root's line goes through `node "$TMP/repo/scripts/git-hygiene.js" --root . --apply exclude|gitignore`, as in
`init-install.md`.
