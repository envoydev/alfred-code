# The one-download protocol - shared by the init, update, configure, validate and uninstall commands

The five downloading commands (`/alfred-code:init` - both phases - `update`, `configure`, `validate`,
`uninstall`; `status` never downloads) drive their whole run from ONE source snapshot. This file is the
shared contract - each command's steps say WHEN, this file says WHAT holds. The commands cite it as
`${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md`; read it in ONE Bash `cat`, never in
ranges and never twice - it stays under the Bash tool's output cap (a test holds it there), and a file past it spilled
to a tool-results file and was read a second time (audit 2026-10-11, sessions 37d7a42c and 902182d2). The
PowerShell route lives in `source-protocol-powershell.md` beside it: read that only when the Bash tool
cannot run the bash blocks below.

## The plugin cache IS the snapshot - the common run downloads nothing

Every marketplace entry shares the REPO ROOT as its `source`, so the core's cache entry at
`<config>/plugins/cache/<marketplace>/alfred-code/<version>/` is the WHOLE repo (`stack/`, `meta/`,
`scripts/` - measured on a real install) - but with NO `RELEASE-SOURCE` and no `.git`: only the
release archive carries that file. A cache copy's version is its own `setup-plugin/.claude-plugin/plugin.json`
(the resolve line reads it) and its revision the `v<version>` tag (`stamp-compare.js` and the installer fall
back to it) - never probe for `RELEASE-SOURCE` there. Take the cache: no probe, no archive, and it is by
construction the revision the enabled plugins run from.

- **Latest first.** Only `claude plugin update` lands a newer version dir (a refreshed catalog does not, and
  this marketplace has auto-update off - code.claude.com/docs/en/discover-plugins). So the resolve refreshes
  the `envoydev` catalog and updates EVERY installed stack entry at its OWN scope before it picks: an entry
  left on its old version can name a file that version lacks (docs/uv-python-pin-evidence.md). It keeps the
  core's version from BEFORE that update as `running=` - the one this session loaded.
- Pick the NEWEST valid version dir across marketplaces (the dir names are versions, sorted as versions),
  valid only with both `stack/skills` and `stack/agents` and no `.orphaned_at` mark. No second cache of the
  stack's own exists (`stack-source` and `STACK_SOURCE_CACHE` are retired).
- The run works in its own `$TMP/repo` COPY, never in place: a release landing mid-run cannot pull files
  out from under it, and cleanup stays `rm -rf "$TMP"` - the cache is the CLI's own install, never inside it.
- The archive route stays for the two cases with no cache: no `claude` CLI, and the copy route (both
  `ALFRED_CODE_*_VIA_PLUGIN` switches off). The Node seed resolves the same cache the same way
  (`scripts/install/source.js`), so a script install and a guided walk land one revision.

## Resolve or reuse - one block, first call or the tenth

It tests its own marker FILE, never `$TMP`: Windows pre-sets a `TMP` variable, so a `[ -z "$TMP" ]` guard
read the OS value and silently skipped the resolve.

```bash
command -v tr >/dev/null 2>&1 || PATH="/usr/bin:/bin:/mingw64/bin:$(/usr/bin/cygpath -u -p "$PATH" 2>/dev/null || printf '%s' "$PATH")"   # Git Bash handed a Windows-form PATH
for T in git tr cut mktemp node; do command -v "$T" >/dev/null 2>&1 || { echo "MISSING $T on the Bash PATH - nothing resolved"; exit 1; }; done
RUN_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
TD="${TMPDIR:-/tmp}"; TD="${TD%/}"   # a sandboxed command writes only under $TMPDIR (and the project)
MARK="$TD/alfred-code-run.$(printf '%s' "$RUN_ROOT" | tr -c 'A-Za-z0-9' '-' | cut -c1-60)-$(printf '%s' "$RUN_ROOT" | git hash-object --stdin | cut -c1-12).path"
OLD=$(cat "$MARK" 2>/dev/null)
if [ -n "$OLD" ] && [ -d "$OLD/repo" ] && [ -f "$OLD/run-session" ] && [ "$(cat "$OLD/run-session")" = "${CLAUDE_CODE_SESSION_ID:-}" ]; then
  TMP=$OLD; STATE=REUSING   # this session's own marker; another session's, or one from before the session check, resolves fresh
else
STATE=RESOLVED
REPO_URL=https://github.com/envoydev/alfred-code
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
TMP=$(mktemp -d "$TD/alfred-code.XXXXXX")   # the template names the dir: macOS mktemp -d alone ignores $TMPDIR
[ -n "$TMP" ] && [ -d "$TMP" ] || { echo "MISSING a temp dir under $TD - nothing resolved"; exit 1; }
WAS=""        # LATEST first: only `plugin update` lands a newer cache entry, and the newest entry IS the snapshot
MKT=""        # the marketplace key the core is listed under
if command -v claude >/dev/null 2>&1; then
  claude plugin marketplace update envoydev >/dev/null 2>&1
  # every stack entry installed for THIS project or the account, this project's rows first: "<scope> <id> <version>", each by its own id
  ROWS=$(claude plugin list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const fs=require("fs"),R=p=>{try{return fs.realpathSync(p)}catch{return require("path").resolve(p)}},here=R(process.cwd());let a=JSON.parse(s);a=(Array.isArray(a)?a:a.installed||[]).filter(x=>/@envoydev$/.test(x.id||"")&&x.scope&&(!x.projectPath||R(x.projectPath)===here));a.sort((x,y)=>(y.projectPath?1:0)-(x.projectPath?1:0));for(const x of a)console.log(x.scope+" "+x.id+" "+x.version)}catch{}})')
  WAS=$(printf '%s\n' "$ROWS" | awk '$2~/^alfred-code@/{print $3;exit}')
  MKT=$(printf '%s\n' "$ROWS" | awk '$2~/^alfred-code@/{sub(/^[^@]*@/,"",$2);print $2;exit}')
  printf '%s\n' "$ROWS" | while read -r SCOPE ID _; do [ -n "$ID" ] && claude plugin update "$ID" --scope "$SCOPE" -y </dev/null >/dev/null 2>&1; done
fi
SRC=$(for d in "$CFG"/plugins/cache/*/*/*; do   # one glob: zsh aborts the whole loop when any named glob matches nothing
  PN=${d%/*}; PN=${PN##*/}; [ "$PN" = alfred-code ] || continue   # newest valid entry, any marketplace
  [ -d "$d/stack/skills" ] && [ -d "$d/stack/agents" ] && [ ! -e "$d/.orphaned_at" ] && printf '%s\t%s\n' "$(basename "$d")" "$d"
done 2>/dev/null | sort -V | tail -1 | cut -f2)
if [ -n "$SRC" ]; then
  cp -R "$SRC" "$TMP/repo"; rm -rf "$TMP/repo/.git"     # the CLI already fetched it: nothing is downloaded
else
  curl -fsSL "$REPO_URL/releases/latest/download/alfred-code.tar.gz" -o "$TMP/alfred-code.tar.gz"
  mkdir -p "$TMP/repo" && tar -xzf "$TMP/alfred-code.tar.gz" -C "$TMP/repo"
fi
printf '%s\n' "${CLAUDE_CODE_SESSION_ID:-}" > "$TMP/run-session"; printf '%s\n' "$TMP" > "$MARK"
fi
VER=$(sed -n 's/^version: //p' "$TMP/repo/RELEASE-SOURCE" 2>/dev/null | head -1)   # the archive's; a plugin-cache entry carries none
[ -n "$VER" ] || VER=$(node -e 'try{process.stdout.write(String(require(process.argv[1]).version||""))}catch{}' "$TMP/repo/setup-plugin/.claude-plugin/plugin.json")
if [ "$STATE" = RESOLVED ]; then echo "RESOLVED TMP=$TMP ${VER:-?} seed=${ALFRED_CODE_SEED:-node} running=${WAS:-?} key=${MKT:-?}"; else echo "REUSING TMP=$TMP ${VER:-?} seed=${ALFRED_CODE_SEED:-node}"; fi
```

- **Guards first.** A Windows-form PATH (`C:\...;C:\...`, where Git Bash finds no coreutils and no `node`) is
  converted in place; a tool still missing stops the call on one `MISSING <tool>` line, and so does an empty
  `$TMP`, before any copy or marker write (session 5b9ce9c5 ran on and printed `RESOLVED TMP= ?` over an
  empty marker - 216k to repair).
- **Only this session's marker is reused.** The resolve writes `$CLAUDE_CODE_SESSION_ID` (set in every tool
  shell) into `$TMP/run-session`; a marker whose `$TMP/repo` is gone, whose session differs, or that names no
  session resolves fresh. A cleanup the user rejected left a marker that the next day's update reused - a
  2.1.6 snapshot with 2.1.8 installed, its preflight reading 'no change' (sessions a9e06780, bca100bd).
- The marker name is DERIVED from the project root - a readable prefix plus a hash of the whole root - so
  two sessions in two projects, or two sibling worktrees, never share one; a fixed name handed one run's
  `$TMP` to the other, and its cleanup deleted a live run's files. It and `$TMP` live under `$TMPDIR`: a
  sandboxed command writes only there and in the project (code.claude.com/docs/en/sandboxing).
- `RESOLVED TMP=<dir> <version> seed=<seed> running=<version> key=<marketplace key>` on a resolve,
  `REUSING TMP=<dir> <version> seed=<seed>` on a reuse. `<version>` is the snapshot's: the archive's
  `RELEASE-SOURCE`, else the copied `plugin.json`.

## Every later call re-reads the marker

Each Bash call is its own shell, so `$TMP` set in one call is gone by the next. Open every later call with:

```bash
command -v tr >/dev/null 2>&1 || PATH="/usr/bin:/bin:/mingw64/bin:$(/usr/bin/cygpath -u -p "$PATH" 2>/dev/null || printf '%s' "$PATH")"   # Git Bash handed a Windows-form PATH
RUN_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
TD="${TMPDIR:-/tmp}"; TD="${TD%/}"   # a sandboxed command writes only under $TMPDIR (and the project)
MARK="$TD/alfred-code-run.$(printf '%s' "$RUN_ROOT" | tr -c 'A-Za-z0-9' '-' | cut -c1-60)-$(printf '%s' "$RUN_ROOT" | git hash-object --stdin | cut -c1-12).path"
TMP=$(cat "$MARK" 2>/dev/null); [ -n "$TMP" ] || { echo "MISSING the run marker - run the resolve block first"; exit 1; }
TMP_WIN=$(cygpath -w "$TMP" 2>/dev/null || printf '%s' "$TMP")         # Windows spelling, empty-safe
```

- **Two spellings, one temp dir.** On Windows `$TMP` is a Git Bash path the Read tool, `pwsh` and a native
  `node` cannot open: every SHELL path stays `$TMP`, and a path that leaves the shell (the Read tool, a
  `pwsh -File`, a node argv) is `$TMP_WIN`, resolved once above (three sessions paid 209k-233k each
  rediscovering `cygpath -w`).
- Every artifact this run writes or reads (`raw.json`, `selection.txt`, `select.out`, `final.json`) is
  `"$TMP/<file>"`, never a bare name - a bare one resolves against whatever cwd the shell drifted to.

## Fallbacks

- The archive is the newest release (`releases/latest/download/...`), republished on every release merge to
  `main` and tagged `v<version>`; its `RELEASE-SOURCE` names the exact commit and version. Never fetch a
  `raw.githubusercontent.com` URL, not even as a fallback - per-file, CDN-cached and stale for minutes.
- **The download fails** (no release reachable, a proxy, a release being recreated): `git clone --depth 1 -b
  main https://github.com/envoydev/alfred-code "$TMP/repo"` - keep `-b main`, the release branch. Both fail:
  say so and stop; never assemble a source from raw URLs.
- Never write the archive, the extracted repo or a working file into the project tree.

## Check the plugin itself is current

The tooling comes from the snapshot, but YOUR numbered steps ship with the plugin this SESSION loaded - so
compare right after the resolve: the snapshot's version on the RESOLVED line against `running=` (read BEFORE
the resolve's own update; a fresh `claude plugin list` would report the version just installed). An update
lands on disk and the session's HOOKS follow it at once - each hook launches from the newest cache entry
(measured on CLI 2.1.296, session 5f9fec85) - while the command and skill bodies, and their listings, stay on
the version the session started with until a restart. So say which half waits for the restart (the
commands), never that the restart loads hooks already running.

- `running=?` (no CLI, or no `alfred-code` row), or a snapshot version of `?` (neither file readable): drop
  the check and emit NO line about it - narrating the skip costs what the check would.
- **Never read `${CLAUDE_PLUGIN_ROOT}` from the shell** - it is expanded into a command's text at injection,
  not set in the Bash tool's environment, so the check silently skipped itself (five sessions).
- ONE release behind: a report line, and the run CONTINUES - the tooling is current either way (a run that
  asked instead spent 5 turns and reconciled nothing). A MULTI-release gap: say so, recommend a restart (the
  resolve already installed the newest), and offer to continue.
- Old version dirs in the cache are the CLI's: it marks them orphaned on an update and sweeps them about 14
  days later, so a concurrent session keeps running (code.claude.com/docs/en/plugins-reference). Never offer to
  delete one and never delete one; when the listing shows more than one, say so in ONE close-out line - the
  count and the keeper - and that Claude Code clears the rest itself.
- A same-version re-release that changed nothing loaded: `claude plugin uninstall alfred-code@<key> --scope
  <scope>` then `claude plugin install alfred-code@<key> --scope <scope>` - `<key>` the resolve line's `key=`,
  `<scope>` the core's own (never `managed`; without `--scope` the CLI picks `user`).

## Narrate, don't trace

The user sees every tool call's header, so keep the machinery to few, small calls and put the meaning in your
own narration lines between them:

- ONE quiet call per recompute: write the working file(s) and run `stack-select.js` in a single command,
  its output redirected to a file (`> "$TMP/select.out" 2>&1`), then read the file - never a call per file,
  never a re-run to re-read.
- Never paste tool output (`required:` / `orphan:` dumps, listings, diffs) into the chat - the tables and
  banners you compose ARE the presentation. The one exception: a table or report the user decides from
  (`stack-select.js --table`, `plugin-settings.js`) is pasted verbatim in a fenced block BEFORE the ask about it.
- Between steps, one narration line - what just closed, what is being computed, what comes next:

```
Final rule set: the 10 recommended (customize round confirmed no changes). Folding into raw.json and recomputing the agents layer's locked set.
24 locked skills. Computing the extras list (release catalog minus locked) before presenting the table.
```

- Machinery that decides nothing (mktemp, downloads, cleanup) gets no narration; a failure is narrated with
  its consequence, never a stack trace.
- **Few calls means ONE call, not a parallel batch**: the resolve and any prerequisite probe go in a SINGLE
  Bash call - two in parallel are two approval prompts at once (both were rejected once, and the run ended).
- Never re-run a command to re-read a result still in context - it is re-sent either way (~119k measured).
- A long file you CONSULT rather than quote (the AGENTS template, a catalog) is read into `$TMP` and
  narrated as a summary line, never `cat`-ed into the chat.

## Use the tools from the snapshot

Everything comes out of `$TMP/repo`, never re-fetched: the installer (`scripts/install/alfred-code.js`,
`node` on every OS), `scripts/stack-select.js` with `meta/stack-graph.json`, the `meta/` catalogs
(`recommendations.json`, `evidence.json`, `judgment.json`), `stack/AGENTS.template.md`, and the snapshot's
revision - `RELEASE-SOURCE`'s commit in an archive, the `v<version>` tag of its `plugin.json` in a cache
copy; `stamp-compare.js` reads either and diffs the stamp against it through the GitHub compare API.

**Read them through the Bash tool, never the Read tool, and never interpolate `$TMP` into a program's string
literal** - the Read tool cannot open a Git Bash path, and `\r` in an embedded Windows path is an escape (five
sessions, ~882k between them):

- a catalog or JSON file -> `cat "$TMP/repo/meta/<file>.json"`, or a `node -e` projection of it with the path as
  an argument - never `jq`, which Git for Windows does not ship
- a script that needs the path -> pass it as an ARGUMENT (`node "$TMP/repo/scripts/x.js" --snapshot "$TMP/repo"`)
- genuinely needing the Windows spelling -> `"$(cygpath -w "$TMP")"`, once, into a variable

## Hand the same snapshot to the installer

**ONE seed, one command on every OS:** `node "$TMP/repo/scripts/install/alfred-code.js" <install|update|uninstall>
[flags]`, Unix flag spellings everywhere (`--scope`, `--selection`). A resolve line reporting `seed=shell`
(`ALFRED_CODE_SEED=shell` in this session's environment) is refused: print
`the shell installers were removed in 2.0.0 - unset ALFRED_CODE_SEED to use the Node installer` and stop -
the line the seed itself prints. Never hand the seed a PowerShell spelling (`-Scope` is refused).

- Pass `--source "$TMP/repo"`: one download per run, and the run lands the revision the earlier steps read.
  The installer writes `alfred-code.stamp` naming that revision (an archive's `RELEASE-SOURCE`, a cache copy's
  `v<version>` tag, or a clone's HEAD) and never deletes a source it was handed.
- **Capture the installer's own output** - one fixed form: `2>&1 | tee "$TMP/install.log"` on the call itself, opened with
  `set -o pipefail;` so `$?` is the installer's (`${PIPESTATUS[0]}` reads empty in zsh). Every later step
  reads `"$TMP/install.log"` - never a tail, never a second grep, never a second installer run for a log.
- **A harness denial of the installer call is not a question**: report it with the exact `! <command>` form
  the user can paste, name the settings rule that would pre-authorize it, and stop - re-asking buys a second
  identical denial.

## Clean up the temp dir - ALWAYS

`rm -rf "$TMP" "$MARK"` (PowerShell: `Remove-Item -Recurse -Force $TMP, $Mark`) on EVERY exit path - the
marker goes with the temp dir it names. Never add the plugin cache to that line: it is the CLI's own install.
The installer cleans only a source IT fetched, never one passed with `--source`.

After cleanup a stack file is still one `cat` away in the PLUGIN CACHE - the entry at
`<config>/plugins/cache/<marketplace>/alfred-code/<version>` is the whole tree `$TMP/repo` was copied from -
never a new download (a run once pulled the 1.4MB archive again to read one 75-line file). Then confirm the
project tree holds only installed artifacts - no archive, no extracted repo, no `raw.json` / `selection.txt`,
no installer copy.
