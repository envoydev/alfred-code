# The one-download protocol - the why and the rare branches

`source-protocol.md` is the contract every run reads; this file is read only when one of its cases applies - no
plugin cache, a failed download, a multi-release gap, a same-version re-release, old version dirs - or when a
change to the protocol needs the measurements behind it.

## Why the plugin cache is the snapshot

Every marketplace entry shares the REPO ROOT as its `source`, so the core's cache entry is the whole repo
(`stack/`, `meta/`, `scripts/` - measured on a real install), and it is by construction the revision the enabled
plugins run from: no probe, no archive.

- **Latest first.** Only `claude plugin update` lands a newer version dir (a refreshed catalog does not, and this
  marketplace has auto-update off - code.claude.com/docs/en/discover-plugins). So the resolve refreshes the
  `envoydev` catalog and updates the installed CORE at each of its scopes before it picks - the stack's one entry
  since 2.10.1; another plugin the catalog lists (preferred-tools) is the user's and updates on its own. It keeps the core's
  version from BEFORE that update as `running=` - the one this session loaded.
- The pick is the NEWEST valid version dir across marketplaces (the dir names are versions, sorted as versions),
  valid only with both `stack/skills` and `stack/agents` and no `.orphaned_at` mark. No second cache of the
  stack's own exists (`stack-source` and `STACK_SOURCE_CACHE` are retired).
- The run works in its own `$TMP/repo` COPY: a release landing mid-run cannot pull files out from under it, and
  cleanup stays `rm -rf "$TMP"`.
- The archive route stays for the two cases with no cache: no `claude` CLI, and the copy route (both
  `ALFRED_CODE_*_VIA_PLUGIN` switches off). The Node seed resolves the same cache the same way
  (`scripts/install/source.js`), so a script install and a guided walk land one revision.

## Why the resolve block is shaped the way it is

- **Guards first.** A Windows-form PATH (`C:\...;C:\...`, where Git Bash finds no coreutils and no `node`) is
  converted in place; a tool still missing stops the call on one `MISSING <tool>` line, and so does an empty
  `$TMP`, before any copy or marker write (session 5b9ce9c5 ran on and printed `RESOLVED TMP= ?` over an empty
  marker - 216k to repair).
- **Only this session's marker is reused.** The resolve writes `$CLAUDE_CODE_SESSION_ID` into
  `$TMP/run-session`; a marker whose `$TMP/repo` is gone, whose session differs, or that names no session
  resolves fresh. A cleanup the user rejected left a marker that the next day's update reused - a 2.1.6 snapshot
  with 2.1.8 installed, its preflight reading 'no change' (sessions a9e06780, bca100bd).
- The marker name is DERIVED from the project root - a readable prefix plus a hash of the whole root - so two
  sessions in two projects, or two sibling worktrees, never share one; a fixed name handed one run's `$TMP` to
  the other, and its cleanup deleted a live run's files. It and `$TMP` live under `$TMPDIR`: a sandboxed command
  writes only there and in the project (code.claude.com/docs/en/sandboxing).
- **Two spellings.** On Windows `$TMP` is a Git Bash path the Read tool, `pwsh` and a native `node` cannot open;
  three sessions paid 209k-233k each rediscovering `cygpath -w`, so the marker block resolves `$TMP_WIN` once.
- The protocol was read in ranges and twice when a 30,382-byte copy spilled past the Bash tool's output cap
  (audit 2026-10-11, sessions 37d7a42c and 902182d2): the PowerShell route moved beside it then, and this file in
  2026-10-20.

## Fallbacks - no cache, or the download fails

- The archive is the newest release (`releases/latest/download/...`), republished on every release merge to
  `main` and tagged `v<version>`; its `RELEASE-SOURCE` names the exact commit and version. Never fetch a
  `raw.githubusercontent.com` URL, not even as a fallback - per-file, CDN-cached and stale for minutes.
- **The download fails** (no release reachable, a proxy, a release being recreated): `git clone --depth 1 -b
  main https://github.com/envoydev/alfred-code "$TMP/repo"` - keep `-b main`, the release branch. Both fail: say
  so and stop; never assemble a source from raw URLs.
- Never write the archive, the extracted repo or a working file into the project tree.

## The plugin-current check - its rarer cases

- An update lands on disk and the session's HOOKS follow it at once - each hook launches from the newest cache
  entry (measured on CLI 2.1.296, session 5f9fec85) - while the command and skill bodies, and their listings,
  stay on the version the session started with until a restart. `running=` is read BEFORE the resolve's own
  update: a fresh `claude plugin list` would report the version just installed.
- Narrating a skipped check costs what the check would; a run that ASKED on one release behind spent 5 turns and
  reconciled nothing; reading `${CLAUDE_PLUGIN_ROOT}` from the shell silently skipped the check in five sessions.
- Old version dirs in the cache are the CLI's: it marks them orphaned on an update and sweeps them about 14 days
  later, so a concurrent session keeps running (code.claude.com/docs/en/plugins-reference). Never offer to delete
  one and never delete one; when the listing shows more than one, say so in ONE close-out line - the count and
  the keeper - and that Claude Code clears the rest itself.
- A same-version re-release that changed nothing loaded: `claude plugin uninstall alfred-code@<key> --scope
  <scope>` then `claude plugin install alfred-code@<key> --scope <scope>` - `<key>` the resolve line's `key=`,
  `<scope>` the core's own (never `managed`; without `--scope` the CLI picks `user`).

## Why the narration and tool rules

- Two parallel calls were two approval prompts at once; both were rejected once, and the run ended.
- A command re-run to re-read a result still in context is re-sent either way (~119k measured).
- Reading a snapshot file through the Read tool, or a `$TMP` path embedded in a program's string literal (`\r` in
  a Windows path is an escape), cost five sessions ~882k between them.
- `${PIPESTATUS[0]}` reads empty in zsh, so the installer capture opens with `set -o pipefail;`.
- The installer cleans only a source IT fetched, never one passed with `--source`. A run once pulled the 1.4MB
  archive again after cleanup to read one 75-line file - the plugin cache entry holds the same tree.
- The revision a run lands is `RELEASE-SOURCE`'s commit in an archive, the `v<version>` tag of its `plugin.json`
  in a cache copy, or a clone's HEAD; `stamp-compare.js` reads either and diffs the stamp against it through the
  GitHub compare API.
