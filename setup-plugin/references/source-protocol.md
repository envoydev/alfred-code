# The one-download protocol - shared by the init, update, configure, validate and uninstall commands

The five downloading commands (`/alfred-code:init` - both phases - `update`, `configure`, `validate`,
`uninstall`; `status` never downloads) drive their whole run from ONE source snapshot: each command's steps say
WHEN, this file says WHAT holds. The commands cite it as
`${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md`; read it in ONE Bash `cat`, never in ranges
and never twice. It holds only what every run uses: a test caps it, because it rides every later message of the
run (audit 2026-10-20 C46, b1c22192 - 17,808 chars read to learn one `RESOLVED` line). Two files beside it hold
the rest, each read only when its case applies: `source-protocol-powershell.md` when the Bash tool cannot run
the bash blocks below, and `source-protocol-notes.md` for the why and the rare branches - no plugin cache, a
failed download, a multi-release gap, a same-version re-release, old version dirs in the cache.

## The plugin cache IS the snapshot - the common run downloads nothing

The core's cache entry at `<config>/plugins/cache/<marketplace>/alfred-code/<version>/` is the WHOLE repo, with
no `RELEASE-SOURCE` and no `.git`: its version is its own `setup-plugin/.claude-plugin/plugin.json`, its revision
the `v<version>` tag - never probe for `RELEASE-SOURCE` there. The resolve updates the installed core
first (latest first), picks the newest valid version dir, and copies it to `$TMP/repo`: the run works in that
copy, never in the cache.

## Resolve or reuse - one block, first call or the tenth

It tests its own marker FILE, never `$TMP` (Windows pre-sets a `TMP` variable):

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
  # the core installed for THIS project or the account, at each scope, this project's rows first: "<scope> <id> <version>" - another plugin the catalog lists (preferred-tools, session-inspector) updates on its own
  ROWS=$(claude plugin list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const fs=require("fs"),R=p=>{try{return fs.realpathSync(p)}catch{return require("path").resolve(p)}},here=R(process.cwd());let a=JSON.parse(s);a=(Array.isArray(a)?a:a.installed||[]).filter(x=>/^alfred-code@envoydev$/.test(x.id||"")&&x.scope&&(!x.projectPath||R(x.projectPath)===here));a.sort((x,y)=>(y.projectPath?1:0)-(x.projectPath?1:0));for(const x of a)console.log(x.scope+" "+x.id+" "+x.version)}catch{}})')
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

It prints `RESOLVED TMP=<dir> <version> seed=<seed> running=<version> key=<marketplace key>` on a resolve,
`REUSING TMP=<dir> <version> seed=<seed>` on a reuse (`<version>` the snapshot's), or one `MISSING <what>` line
and nothing else - a `MISSING` line stops the run, said with its consequence. Only this session's marker is
reused; the marker name is derived from the project root, so two projects or two worktrees never share one.

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

- **`$TMP` comes from the marker, every call, and from nowhere else** - never an `ls -dt`, a glob over
  `alfred-code.*` or a remembered path: two temp dirs can exist at once, and one run picked the other one and
  ran the installer with `adds=0` (audit 2026-10-20 C46, 4f2bfdee). `MISSING the run marker` means the resolve
  block runs again, never a guess.
- **Two spellings, one temp dir.** Every SHELL path stays `$TMP`; a path that leaves the shell (the Read tool, a
  `pwsh -File`, a native `node` argv on Windows) is `$TMP_WIN`.
- Every artifact this run writes or reads (`raw.json`, `selection.txt`, `select.out`, `final.json`, a delta) is
  `"$TMP/<file>"`, never a bare name - a bare one resolves against whatever cwd the shell drifted to. A step's
  output that a later call reads goes to a file there, never through a process substitution (`< <(...)` hides a
  failure from `pipefail`).

## Check the plugin itself is current

YOUR numbered steps ship with the plugin this SESSION loaded, the tooling with the snapshot - so compare right
after the resolve: the RESOLVED line's version against `running=`. Hooks follow an update at once; the command
and skill bodies wait for a restart - say that half waits, never that the restart loads hooks already running.

- `running=?` or a snapshot version of `?`: drop the check and emit NO line about it.
- ONE release behind: a report line, and the run CONTINUES. A MULTI-release gap: say so, recommend a restart (the
  resolve already installed the newest), and offer to continue.
- **Never read `${CLAUDE_PLUGIN_ROOT}` from the shell** - it is expanded into a command's text at injection, not
  set in the Bash tool's environment.
- Old version dirs and a same-version re-release: `source-protocol-notes.md`.

## Narrate, don't trace

The user sees every tool call's header, so keep the machinery to few, small calls and put the meaning in your
own narration lines between them:

- ONE quiet call per recompute: write the working file(s) and run `stack-select.js` in a single command, its
  output redirected to a file (`> "$TMP/select.out" 2>&1`), then read the file - never a call per file, never a
  re-run to re-read a result still in context.
- Never paste tool output (`required:` / `orphan:` dumps, listings, diffs) into the chat - the tables and banners
  you compose ARE the presentation. The one exception: a table or report the user decides from (`stack-select.js
  --table`, `plugin-settings.js`) is pasted verbatim in a fenced block BEFORE the ask about it.
- Between steps, one narration line - what just closed, what is being computed, what comes next:

```
Final rule set: the 10 recommended (customize round confirmed no changes). Folding into raw.json and recomputing the agents layer's locked set.
```

- Machinery that decides nothing (mktemp, downloads, cleanup) gets no narration; a failure is narrated with its
  consequence, never a stack trace.
- **Few calls means ONE call, not a parallel batch**: the resolve and any prerequisite probe go in a SINGLE Bash
  call - two in parallel are two approval prompts at once.
- A long file you CONSULT rather than quote (the AGENTS template, a catalog) is read into `$TMP` and narrated as
  a summary line, never `cat`-ed into the chat.

## Use the tools from the snapshot

Everything comes out of `$TMP/repo`, never re-fetched: the installer (`scripts/install/alfred-code.js`, `node`
on every OS), `scripts/stack-select.js` with `meta/stack-graph.json`, the `meta/` catalogs, and
`stack/AGENTS.template.md`. **Read them through the Bash tool, never the Read tool, and never interpolate `$TMP`
into a program's string literal**: a JSON file is `cat "$TMP/repo/meta/<file>.json"` or a `node -e` projection
with the path as an ARGUMENT (never `jq`, which Git for Windows does not ship); a script takes the path as an
argument (`node "$TMP/repo/scripts/x.js" --snapshot "$TMP/repo"`).

## Hand the same snapshot to the installer

**ONE seed, one command on every OS:** `node "$TMP/repo/scripts/install/alfred-code.js" <install|update|uninstall>
[flags]`, Unix flag spellings everywhere (`--scope`, `--selection`). A resolve line reporting `seed=shell` is
refused: print `the shell installers were removed in 2.0.0 - unset ALFRED_CODE_SEED to use the Node installer`
and stop. Never hand the seed a PowerShell spelling (`-Scope` is refused).

- Pass `--source "$TMP/repo"`: one download per run, and the run lands the revision the earlier steps read.
- **Capture the installer's own output** - one fixed form: `2>&1 | tee "$TMP/install.log"` on the call itself,
  opened with `set -o pipefail;` so `$?` is the installer's. Every later step reads `"$TMP/install.log"` - never a
  tail, never a second grep, never a second installer run for a log.
- **A harness denial of the installer call is not a question**: report it with the exact `! <command>` form the
  user can paste, name the settings rule that would pre-authorize it, and stop.

## Clean up the temp dir - ALWAYS

`rm -rf "$TMP" "$MARK"` (PowerShell: `Remove-Item -Recurse -Force $TMP, $Mark`) on EVERY exit path, after the
marker block - by name, never a glob (zsh aborts the whole line on one that matches nothing). Never add the
plugin cache to that line: it is the CLI's own install. After cleanup a stack file is still one `cat` away in
that cache entry - never a new download. Then confirm the project tree holds only installed artifacts - no
archive, no extracted repo, no `raw.json` / `selection.txt`, no installer copy.
