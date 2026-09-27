# The one-download protocol - shared by the setup, init, update, configure, validate and uninstall commands

The six downloading commands (`/alfred-code:setup` - fresh install, `/alfred-code:init` - the
one-time bootstrap after it, `/alfred-code:update` - refresh + prune, `/alfred-code:configure` -
adjust the selection, `/alfred-code:validate` - reconcile to the project, `/alfred-code:uninstall` -
the stack out of the project; `status` never downloads) drive their whole run from ONE
source snapshot. This file is the shared contract; each command's numbered steps say WHEN to
apply it, this file says WHAT holds. It lives at `setup-plugin/references/` under the plugin root -
every entry ships from the repo root, so that is where the cache holds it - and the commands cite it
as `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md`.

## The plugin cache IS the snapshot - the common run downloads nothing

Claude Code installs the core plugin by taking this repo into its own cache at
`<config>/plugins/cache/<marketplace>/alfred-code/<version>/`, and because every marketplace entry
shares the REPO ROOT as its `source`, that entry is the WHOLE repo - not just the `setup-plugin/`
subdir it serves as the plugin. Measured on a real install: `stack/rules`,
`stack/CLAUDE.template.md`, the two hook engines, `stack/hooks/model-windows.json`,
`meta/recommendations.json`, `scripts/selection-plugins.js` and `RELEASE-SOURCE` are all there. So a
project with the stack enabled already holds the snapshot on disk, fetched once per release by the
CLI itself. Take it: no probe, no archive, no marketplace clone - and it is by construction the exact
revision the enabled plugins are running from, so the seed and the plugins can never be two different
releases.

**Latest first.** The cache holds only what the CLI last installed, and a refreshed catalog does not
move it: only `claude plugin update` lands a newer version dir (a `plugin install` of a plugin already
installed does nothing, and this marketplace has auto-update OFF by default -
code.claude.com/docs/en/discover-plugins). So both snippets below refresh the `envoydev`
catalog and update EVERY installed stack entry at its OWN scope before they pick - not the core
alone: Claude Code launches an entry as the marketplace clone declares it, so an entry left on its
old version can name a file that version lacks (docs/uv-python-pin-evidence.md), and a run that
stops at a question never reaches the apply step that would update it. They remember the core's
version from before (`running=` / `$Was`) - the one this session loaded, whatever the cache now
holds. No `claude` CLI, or no stack row: nothing to update, and the pick runs as it always did.

**A 1.x install keeps its key and its old ids**, which 2.0.0 lists as retired aliases carrying the
2.0.0 core, so a refresh plus `plugin update` of every row lands 2.0.0 in the cache under the old
name, and the seed moves the install across (docs/rebrand-evidence.md S20-S22). That is why both
keys are refreshed, and why the 1.x dir `cache/<key>/claude-stack/<version>` counts until the CLI <!-- legacy-name -->
marks it `.orphaned_at` - an orphaned dir is never taken (S3).

Pick the NEWEST valid version directory across marketplaces - the directory names ARE the release
versions the CLI writes, so they sort as versions - and count a directory only when it carries both
`stack/skills` and `stack/agents`, so a half-written entry is rejected rather than half-installed.
The stack keeps no second cache of its own: `<config>/cache/stack-source/...` and its
`STACK_SOURCE_CACHE` switch are RETIRED, and no run writes them any more.

The archive route below stays for the two cases with no plugin cache to read: a machine with no
`claude` CLI, and the copy route (both `ALFRED_CODE_*_VIA_PLUGIN` switches off).

The run still works in its own `$TMP/repo`, copied from the cache - not read in place. A copy costs
0.1s and buys two things: an `update` landing a new release mid-run cannot pull files out from under
this one, and cleanup stays exactly what it was (`rm -rf "$TMP"` - the cache is not inside it, and
must never be added to it: it is the CLI's own plugin install).

**Copy-only, and it tests its own marker file - never `$TMP` itself.** This is the whole
resolve-or-reuse form, first call or the tenth: Windows PRE-SETS a `TMP` environment variable, so a
composed `[ -z "$TMP" ]` guard reads that OS value and never runs the resolve at all (measured: a
Windows run's first call silently no-opped, no `RESOLVED`/`REUSING` line, until a retry added
`unset TMP`). The test below is the marker FILE's own presence and validity instead - true on every
platform, pre-set env var or not:

```bash
RUN_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
TD="${TMPDIR:-/tmp}"; TD="${TD%/}"   # a sandboxed command writes only under $TMPDIR (and the project)
MARK="$TD/alfred-code-run.$(printf '%s' "$RUN_ROOT" | tr -c 'A-Za-z0-9' '-' | cut -c1-60)-$(printf '%s' "$RUN_ROOT" | git hash-object --stdin | cut -c1-12).path"
if [ -f "$MARK" ] && [ -d "$(cat "$MARK")/repo" ]; then
  TMP=$(cat "$MARK"); echo "REUSING TMP=$TMP seed=${ALFRED_CODE_SEED:-${CLAUDE_STACK_SEED:-node}}"   # a valid marker from an earlier call; legacy-name: the 1.x setting too
else
REPO_URL=https://github.com/envoydev/alfred-code
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
TMP=$(mktemp -d "$TD/alfred-code.XXXXXX")   # the template names the dir: macOS mktemp -d alone ignores $TMPDIR
WAS=""        # LATEST first: only `plugin update` lands a newer cache entry, and the newest entry IS the snapshot
MKT=""        # the marketplace key the core is listed under - a 1.x install keeps its own
if command -v claude >/dev/null 2>&1; then
  for K in envoydev claude-stack; do claude plugin marketplace update "$K" >/dev/null 2>&1; done   # legacy-name: a 1.x install keeps its key
  # every stack entry installed for THIS project or the account, this project's rows first: "<scope> <id> <version>", each by its own id
  ROWS=$(claude plugin list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const fs=require("fs"),R=p=>{try{return fs.realpathSync(p)}catch{return require("path").resolve(p)}},here=R(process.cwd());let a=JSON.parse(s);a=(Array.isArray(a)?a:a.installed||[]).filter(x=>/@(envoydev|claude-stack)$/.test(x.id||"")&&x.scope&&(!x.projectPath||R(x.projectPath)===here));a.sort((x,y)=>(y.projectPath?1:0)-(x.projectPath?1:0));for(const x of a)console.log(x.scope+" "+x.id+" "+x.version)}catch{}})')   # legacy-name
  WAS=$(printf '%s\n' "$ROWS" | awk '$2~/^alfred-code@/{n=$3;exit} $2~/^claude-stack@/&&o==""{o=$3} END{print (n!=""?n:o)}')   # legacy-name
  MKT=$(printf '%s\n' "$ROWS" | awk '$2~/^alfred-code@/{sub(/^[^@]*@/,"",$2);n=$2;exit} $2~/^claude-stack@/&&o==""{sub(/^[^@]*@/,"",$2);o=$2} END{print (n!=""?n:o)}')   # legacy-name
  printf '%s\n' "$ROWS" | while read -r SCOPE ID _; do [ -n "$ID" ] && claude plugin update "$ID" --scope "$SCOPE" -y </dev/null >/dev/null 2>&1; done
fi
SRC=$(for d in "$CFG"/plugins/cache/*/alfred-code/* "$CFG"/plugins/cache/*/claude-stack/*; do   # legacy-name: newest valid entry, any marketplace, a 1.x dir until orphaned
  [ -d "$d/stack/skills" ] && [ -d "$d/stack/agents" ] && [ ! -e "$d/.orphaned_at" ] && printf '%s\t%s\n' "$(basename "$d")" "$d"
done 2>/dev/null | sort -V | tail -1 | cut -f2)
if [ -n "$SRC" ]; then
  cp -R "$SRC" "$TMP/repo"; rm -rf "$TMP/repo/.git"     # the CLI already fetched it: nothing is downloaded
else
  curl -fsSL "$REPO_URL/releases/latest/download/alfred-code.tar.gz" -o "$TMP/alfred-code.tar.gz"
  mkdir -p "$TMP/repo" && tar -xzf "$TMP/alfred-code.tar.gz" -C "$TMP/repo"
fi
VER=$(sed -n 's/^version: //p' "$TMP/repo/RELEASE-SOURCE" 2>/dev/null | head -1)
printf '%s\n' "$TMP" > "$MARK"; echo "RESOLVED TMP=$TMP ${VER:-?} seed=${ALFRED_CODE_SEED:-${CLAUDE_STACK_SEED:-node}} running=${WAS:-?} key=${MKT:-?}"   # legacy-name
fi
```

Windows (PowerShell). **Invoke it as a FILE, never as a double-quoted `-Command` string.** The
Bash tool on Windows is Git Bash, so it expands `$TMP`, `$Ver`, `$Src` - every `$Name` in the body -
BEFORE pwsh ever sees them, and the snippet collapses into a command referring to variables that no
longer exist. Write the block to a file and run it:

```bash
cat > "$TMP/step.ps1" <<'PS1'
... the PowerShell below, verbatim ...
PS1
pwsh -NoProfile -File "$TMP/step.ps1"
```

A quoted heredoc (`<<'PS1'`) is what keeps bash out of the body; `pwsh -Command '<single quotes>'`
works for a one-liner with no embedded quote. Measured: this collision cost three runs across two
projects, one of them re-downloading the whole 1.4MB archive after `$TMP` came out empty.

```powershell
$TMP = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $TMP -Force | Out-Null
$RepoUrl = 'https://github.com/envoydev/alfred-code'
$ConfigDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$Was = ''     # LATEST first: only `plugin update` lands a newer cache entry, and the newest entry IS the snapshot
$Key = ''     # the marketplace key the core is listed under - a 1.x install keeps its own
$Seed = if ($env:ALFRED_CODE_SEED) { $env:ALFRED_CODE_SEED } elseif ($env:CLAUDE_STACK_SEED) { $env:CLAUDE_STACK_SEED } else { 'node' }   # legacy-name
if (Get-Command claude -ErrorAction SilentlyContinue) {
  foreach ($k in 'envoydev', 'claude-stack') { claude plugin marketplace update $k *> $null }   # legacy-name: a 1.x install keeps its key
  $list = try { claude plugin list --json 2>$null | Out-String | ConvertFrom-Json } catch { $null }
  # PSObject, never `$list.installed`: over a bare array that is one $null per row - truthy, and no rows
  if ($list -and ($list.PSObject.Properties.Name -contains 'installed')) { $list = $list.installed }
  # every stack entry installed for THIS project or the account, this project's rows first
  $Here = (Get-Item -LiteralPath (Get-Location).Path).FullName
  $rows = @($list | Where-Object { "$($_.id)" -match '@(envoydev|claude-stack)$' -and $_.scope -and (-not $_.projectPath -or [System.IO.Path]::GetFullPath("$($_.projectPath)").TrimEnd('\', '/') -eq $Here.TrimEnd('\', '/')) })   # legacy-name
  $rows = @(@($rows | Where-Object { $_.projectPath }) + @($rows | Where-Object { -not $_.projectPath }))
  $Old = ''; $OldKey = ''
  foreach ($r in $rows) {
    $id = "$($r.id)"   # each row by its own id - a 1.x one lands 2.0.0 under its old name
    if ($id -like 'alfred-code@*') { if (-not $Was) { $Was = $r.version; $Key = ($id -split '@')[1] } }
    elseif ($id -like 'claude-stack@*' -and -not $Old) { $Old = $r.version; $OldKey = ($id -split '@')[1] }   # legacy-name
    claude plugin update $id --scope $r.scope -y *> $null
  }
  if (-not $Was) { $Was = $Old; $Key = $OldKey }
}
$Src = ''
$BestVer = $null
$Base = Join-Path $ConfigDir 'plugins/cache'
if (Test-Path -LiteralPath $Base -PathType Container) {
  foreach ($mkt in (Get-ChildItem -LiteralPath $Base -Directory -ErrorAction SilentlyContinue)) {
    foreach ($core in 'alfred-code', 'claude-stack') {   # legacy-name: a 1.x dir counts until the rename orphans it
      $entry = Join-Path $mkt.FullName $core
      if (-not (Test-Path -LiteralPath $entry -PathType Container)) { continue }
      foreach ($d in (Get-ChildItem -LiteralPath $entry -Directory -ErrorAction SilentlyContinue)) {
        if (-not (Test-Path -LiteralPath (Join-Path $d.FullName 'stack/skills'))) { continue }
        if (-not (Test-Path -LiteralPath (Join-Path $d.FullName 'stack/agents'))) { continue }
        if (Test-Path -LiteralPath (Join-Path $d.FullName '.orphaned_at')) { continue }
        $v = $null
        [void][System.Version]::TryParse(($d.Name -replace '[^0-9.].*$', ''), [ref]$v)
        if (-not $Src -or ($v -and $BestVer -and $v -gt $BestVer) -or ($v -and -not $BestVer)) {
          $Src = $d.FullName; $BestVer = $v
        }
      }
    }
  }
}
if ($Src) {
  Copy-Item -LiteralPath $Src -Destination "$TMP/repo" -Recurse                      # nothing is downloaded
  Remove-Item -LiteralPath "$TMP/repo/.git" -Recurse -Force -ErrorAction SilentlyContinue
} else {
  Invoke-WebRequest -Uri "$RepoUrl/releases/latest/download/alfred-code.zip" -OutFile "$TMP/alfred-code.zip"
  Expand-Archive -LiteralPath "$TMP/alfred-code.zip" -DestinationPath "$TMP/repo"
}
$Ver = ((Get-Content "$TMP/repo/RELEASE-SOURCE" -ErrorAction SilentlyContinue | Where-Object { $_ -match '^version: ' }) -replace '^version: ', '').Trim()
$Show = { param($v) if ($v) { $v } else { '?' } }
Write-Output "RESOLVED TMP=$TMP $(& $Show $Ver) seed=$Seed running=$(& $Show $Was) key=$(& $Show $Key)"
```

The Node seed resolves this same plugin cache from its own `resolveSource` (`scripts/install/source.js`),
in the same order and with the same validity test as the snippet above, so a script install and a
guided walk always land the same revision. Neither WRITES a cache any more, so there is nothing to
switch off and nothing that can fail to be written. Hand the resolved copy to the installer with
`--source "$TMP/repo"` all the same (see below) - that is what keeps the run at one copy and pins
the revision the earlier steps read.

**`$TMP` lives in a MARKER FILE KEYED BY THE PROJECT, and every run artifact is addressed through
it.** Each Bash call is its own shell, so a `TMP=$(mktemp -d)` set in one call is gone by the next -
the resolve-or-reuse block above already keys and tests this marker itself, first call or later, a
stale marker (its `$TMP/repo` gone) falling straight back to a fresh resolve with no separate check.
The marker name is DERIVED, never a fixed path: two Claude Code sessions on one machine run these
commands concurrently in different projects, and a shared `alfred-code-run.path` hands the
second run's `$TMP` to the first - measured: an installer log came back holding the other session's
lines, and the other session's cleanup step deleted the still-live `$TMP` out from under a run in
progress. The name is a readable prefix of the root plus a hash of the WHOLE root: a prefix alone let two
roots under one deep parent (sibling worktrees) share a marker, and one reused the other's stale `$TMP`.
It lives under `$TMPDIR`, as does `$TMP`: a sandboxed command may write only there and in the project
(code.claude.com/docs/en/sandboxing, 'Filesystem isolation'), so a marker in a fixed `/tmp` was refused
and every call resolved a fresh `$TMP`. Every later call in this run just re-reads it:

```bash
RUN_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
TD="${TMPDIR:-/tmp}"; TD="${TD%/}"   # a sandboxed command writes only under $TMPDIR (and the project)
MARK="$TD/alfred-code-run.$(printf '%s' "$RUN_ROOT" | tr -c 'A-Za-z0-9' '-' | cut -c1-60)-$(printf '%s' "$RUN_ROOT" | git hash-object --stdin | cut -c1-12).path"
TMP=$(cat "$MARK")
TMP_WIN=$(cygpath -w "$TMP" 2>/dev/null || printf '%s' "$TMP")         # Windows spelling, empty-safe
```

**Two spellings, one temp dir.** The Bash tool on Windows is Git Bash, so `$TMP` is `/tmp/tmp.XXXX`
- a path the Read tool, `pwsh` and a native `node` cannot open at all ('File does not exist', with
the run's real cwd `C:\...` printed underneath). Every SHELL path stays `$TMP`; the moment a path
leaves the shell - the Read tool, a `pwsh -File`, a node argv - it is `$TMP_WIN`, resolved once
above and never re-derived mid-run (measured: three sessions each paid 2 API messages, 209k-233k
cache-read apiece, rediscovering `cygpath -w` by failing first).

Every artifact this run writes or reads - `raw.json`, `selection.txt`, `select.out`, `final.json` -
is named as `"$TMP/<file>"`, never bare. A bare relative name resolves against whatever cwd the
shell drifted to, and the six sites that carried one were saved only by a model choosing an absolute
path on its own initiative. PowerShell keeps `$TMP` the same way, in a marker of its OWN, keyed on the
full root rather than a prefix plus a hash (Windows path limits bound it); nothing reads one route's
marker from the other:

```powershell
$Root = (git rev-parse --show-toplevel 2>$null); if (-not $Root) { $Root = (Get-Location).Path }
$Mark = Join-Path ([System.IO.Path]::GetTempPath()) ('alfred-code-run.' + (($Root -replace '[^A-Za-z0-9]','-')) + '.path')
```

**Every PowerShell block on this page reaches pwsh through the BASH tool, so it is written to a
`.ps1` and run with `pwsh -NoProfile -File`, never passed inline to a double-quoted `-Command`.**
Bash expands `$Root`, `$Mark`, `$TMP` inside double quotes before pwsh ever sees them, so the
snippet arrives with its variables already blanked and fails on a ParserError that reads like a
PowerShell bug and is not one. Three confirmed instances across two projects, each costing several
turns. Single-quoting a `-Command` works for a ONE-LINER; anything multi-line goes to a file:

```bash
cat > "$TMP/step.ps1" <<'PS1'
<the PowerShell above, verbatim - bash never touches a quoted heredoc body>
PS1
pwsh -NoProfile -File "$TMP/step.ps1"
```

- The archive is the newest release - the repo's release workflow republishes it on every
  release merge to `main`, tagged `v<version>` from the plugin manifest, so the release version
  always equals the plugin/marketplace version; the `releases/latest/download/...` URLs above
  always resolve to the newest one. `main` is the RELEASE branch (development lands on
  `develop`, so an install never picks up unreleased work) - one self-consistent snapshot, whose
  `RELEASE-SOURCE` file names the exact commit and version it was built from. The `raw.githubusercontent.com` URLs are
  per-file and sit behind a CDN that serves a cached copy for ~5 min after a push, so raw can
  hand back a stale installer or a skewed mix of versions. Never fetch anything from a raw URL -
  not even as a fallback.
- **Fallback when the download fails** (no release reachable, a proxy, the moment the workflow
  is recreating the release): `git clone --depth 1 -b main https://github.com/envoydev/alfred-code
  "$TMP/repo"` - the same one-snapshot contract, just fetched with git. Keep the `-b main` pin:
  the fallback must deliver the release branch, never whatever the default branch happens to be.
  If both fail there is no source left: the plugin cache is the only one needing no network at
  all, and it was already tried first. Say so and stop; never assemble a source from raw URLs.
- Never write the archive, the extracted repo, or your working files into the project tree.

## Check the plugin itself is current

The tooling always comes fresh from the snapshot, but YOUR numbered steps ship with the
plugin this SESSION loaded - so compare versions right after the resolve: the snapshot's is the
`version:` line in `$TMP/repo/RELEASE-SOURCE`; the running plugin's is `running=` on the RESOLVED
line (`$Was` in the PowerShell block), read BEFORE the resolve's own update. A fresh `claude plugin
list` after it would report the version just installed, which this session has not loaded - an
update lands on disk, and a session keeps the version it started with until a restart.

**Do NOT read `${CLAUDE_PLUGIN_ROOT}` from the shell to find it.** That variable is expanded into a
command's markdown at injection time, but it is NOT in the Bash tool's environment - a command that
reads it inside the shell gets an empty string, and the check silently skips itself every time
(measured: the same `no CLAUDE_PLUGIN_ROOT` line in five sessions across four projects, so the
currency check had never once run). `running=?` (no CLI, or no `alfred-code` row) -> drop the check and emit NO line about it. 'Skip silently' as prose
produced a narration line about skipping, which is the same cost as the check (measured). When they differ, size the gap before deciding: ONE release behind is a report line and the run
CONTINUES - the tooling is the snapshot's and is current either way, so the only risk is that these
numbered steps lag it by one release (measured: a run that asked instead spent 5 turns on two
meta-asks and ended telling the user to restart, with zero reconciliation done). A MULTI-release
gap is worth the ask: say so, recommend a restart (the resolve already installed the newest, so the
next session loads its steps), and offer to continue anyway. The plugin cache is keyed by version
(`~/.claude/plugins/cache/<key>/alfred-code/<version>/`), so after an update the old
version dirs are stale leftovers. **Do not offer to delete them, and never delete one yourself.**
Claude Code marks the previous version orphaned on an update or uninstall and sweeps it in a
background pass roughly 14 days later; the grace period is deliberate, so that a concurrent session
which already loaded that version keeps running instead of erroring
(https://code.claude.com/docs/en/plugins-reference, verified 2026-09-22). A manual `rm -rf` is
exactly the breakage the grace period exists to prevent. They cost nothing else: the resolve above
takes the NEWEST valid entry, so a stale dir is never the source. When the listing shows MORE THAN
ONE version dir, say so in ONE close-out line - the count and the keeper - and say that Claude Code
clears the rest itself.
And if an update ever does NOT change the running content (a same-version re-release - the trap
every release now avoids by bumping), the hard reset is `claude plugin uninstall alfred-code`
then `claude plugin install alfred-code@<key>`, which rebuilds the cache from the
marketplace - `<key>` is the resolve line's `key=`, the key the core is listed under (a 1.x
install keeps its own; an account with only that key has no `envoydev` to install from).

## Narrate, don't trace

The run must read as a guided installer, not a terminal log. The user sees every tool call's
header, so keep the machinery to as few, small calls as possible and put ALL meaning in your own
narration lines between them:

- ONE quiet call per recompute: write the working file(s) and run `stack-select.js` in a single
  short command - with its output redirected to a file (`> "$TMP/select.out" 2>&1`), never to the
  terminal: the tool-result preview would otherwise dump the whole `required:`/`orphan:` wall
  into the chat. Read the file to parse; the visible result of the call should be empty or one
  count line. Never a call per file, never a re-run to re-read what you already have.
- Never paste tool output (`required:`/`orphan:` dumps, file listings, diffs) into the chat - the
  tables and banners you compose ARE the presentation; raw lines are your input, not the user's.
  The one exception: a table or report the user decides from (`stack-select.js --table`,
  `plugin-settings.js`) is pasted verbatim in a fenced block BEFORE the ask about it.
- Between steps, one narration line in this shape - what just closed, what is being computed,
  what comes next:

```
Final rule set: the 10 recommended (customize round confirmed no changes). Folding into raw.json and recomputing the agents layer's locked set.
24 locked skills. Computing the extras list (release catalog minus locked) before presenting the table.
```

- Machinery that produces no decision (mktemp, downloads, cleanup) gets no narration beyond the
  protocol's own one-liners; a failure is narrated with its consequence, never a stack trace.
- **Few calls means ONE call, not a parallel batch.** The snapshot resolution and any prerequisite
  probe go in a SINGLE Bash call - two fired in parallel are two approval prompts at once on a
  project with an empty `allowedTools`, and that is a doubled chance of a no (measured: both
  rejected, the run abandoned; the retry collapsed download + mkdir + tar into one call and was
  approved).
- **Never re-run a command to re-read a result that is still in context.** A digression does not
  expire an earlier tool result - it is in the same window and is re-sent on every later call
  either way, so re-printing it buys nothing and costs a whole round trip (measured: ~119k of
  re-sent context for output the session already held).
- A long file you need to CONSULT rather than quote - the CLAUDE template, a catalog - is read
  into `$TMP` and narrated as a summary line, never `cat`-ed into the chat (measured: 8,045 raw
  chars of template where one line was needed).

## Use the tools from the snapshot

Everything comes out of `$TMP/repo`:
- the installer - `scripts/install/alfred-code.js`, run with `node` and the same command on every
  OS. The frozen OS twins no longer run: a resolve line reporting `seed=shell` stops the run (the
  refusal is below). `node` is
  already a hard prerequisite of the stack - every hook and every selection step runs it - so the
  default route needs nothing the project does not already have
- `scripts/stack-select.js` and `meta/stack-graph.json` (selection closure + prerequisite check)
- the `meta/` catalogs - `recommendations.json`, `evidence.json`, `judgment.json` (seeds, the
  evidence-scan signals, the judgment gates)
- `stack/CLAUDE.template.md` (the CLAUDE.md fill-in / reconcile step)
- `RELEASE-SOURCE` - the snapshot's commit (the `configure` and `update` commands compare the stamp against it
  via the GitHub compare API; an archive has no git history to diff locally)

Run every later `node`/`bash` step against these snapshot copies - never re-fetch one from a raw
URL; the snapshot is already the newest, consistent copy, and it is the copy the installer runs
from.

**Read them through the Bash tool, never the Read tool - and never interpolate `$TMP` into a
program's string literal.** On Windows `$TMP` is a Git Bash path (`/tmp/tmp.XXXX`): the Read tool
cannot open that spelling at all, and a `node -e` body that embeds it turns `\repo\meta` into
`repometa`, because `\r` is an escape. Both cost whole turns to rediscover - five sessions,
roughly 882k tokens between them. So:

- a catalog or JSON file -> `cat "$TMP/repo/meta/<file>.json"` or a `jq` projection of it
- a script that needs the path -> pass it as an ARGUMENT (`node "$TMP/repo/scripts/x.js" --snapshot
  "$TMP/repo"`), which every tool in the snapshot accepts; never build the path inside the program
- genuinely needing the Windows spelling -> `"$(cygpath -w "$TMP")"`, once, into a variable

## Hand the same snapshot to the installer

**ONE seed, one command on every OS:** `node "$TMP/repo/scripts/install/alfred-code.js" <install|update|uninstall>
[flags]`, with the Unix flag spellings everywhere (`--scope`, `--selection`) because there is one
program now and not two. A resolve line reporting `seed=shell` - `ALFRED_CODE_SEED=shell`, or a
1.x `CLAUDE_STACK_SEED=shell`, in the environment this session started in - is refused: the frozen <!-- legacy-name -->
twins name the 1.x marketplace and entries a 2.0.0 registration cannot resolve, so print
`the shell installers were removed in 2.0.0 - unset ALFRED_CODE_SEED / CLAUDE_STACK_SEED to use the Node installer` and stop, the <!-- legacy-name -->
same line the seed itself prints and exits 1 on. Never hand the Node seed a PowerShell spelling: a
`-Scope` is an unknown flag, and it refuses before the run writes anything.

Pass `--source "$TMP/repo"` (`-Source` on Windows) when running the installer's action. That is
what keeps a guided run at ONE download instead of two, and it guarantees the run lands the same
revision the command's earlier steps inspected. The installer copies out of `$TMP/repo`, writes the
`alfred-code.stamp` naming that revision (from `RELEASE-SOURCE`, or the checkout's HEAD when the
fallback cloned), and never deletes a source it was handed - cleanup is the command's job, below.

**Capture the installer's own output, one fixed form.** Every command that runs the installer
appends `2>&1 | tee "$TMP/install.log"` to that call, always the same filename - never call it
without capture and grep a log nobody wrote, and never call it a second time to get the log a first
call should have kept (measured: a run paid a second full installer pass for exactly this). The pipe
means `$?` is `tee`'s exit code, not the installer's - read `${PIPESTATUS[0]}` instead. Every later
step reads `"$TMP/install.log"`, never a tail, never a second grep.

**A harness denial of the installer call is not a question.** The auto-mode classifier can decline
the call outright; once it has, 'approve and run it here' is not an option AskUserQuestion can
offer, and asking anyway buys a second identical denial. Report the denial with the exact `! <command>`
form the user can paste to run it themselves, name the settings rule that would pre-authorize it
beside it, and stop there.

## Clean up the temp dir - ALWAYS

`rm -rf "$TMP" "$MARK"` (PowerShell: `Remove-Item -Recurse -Force $TMP, $Mark`) - the MARKER goes
with the temp dir it names, or the next run in this project reads a path that no longer exists.
This is also why the source lives OUTSIDE `$TMP`, under the account dir: the line above is
unchanged by it and must stay that way - never add the plugin cache to it, because that directory IS
the CLI's plugin install, not a copy of it. The CLI owns those entries' lifetime; this run tidies
nothing there. The
archive, the extracted repo, and the working files you wrote next to them (`raw.json`,
`selection.txt`) live there and nothing else will remove them - the installer only cleans up a source IT fetched, never the one
you passed via `--source`. Do this on EVERY exit path, not just the happy one - each command's
final step lists its own exit cases.

**After cleanup, a stack-owned file is still one `cat` away - in the PLUGIN CACHE, not in a new
download.** The entry sits at `<config>/plugins/cache/<marketplace>/alfred-code/<version>`, holding
the very tree `$TMP/repo` was copied from. When a later turn needs one file from it (a catalog, a
template, a hook's header), read it there. Measured: a run deleted its snapshot, then seven minutes
later pulled the whole 1.4MB archive again to read one 75-line file - it HAD looked in the plugin
cache, on the old belief that the entry ships `setup-plugin/` only. It does not: the entry is the
whole repo, `stack/` included. Then confirm the project tree holds only installed
artifacts - no archive, no extracted repo, no `raw.json`/`selection.txt`, no installer copy.
