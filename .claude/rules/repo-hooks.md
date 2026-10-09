---
paths:
  - "stack/hooks/**"
  - "setup-plugin/hooks/**"
  - "scripts/*hook*"
  - "scripts/*guard*"
  - "scripts/shell-*"
---

# Hooks

The eighteen hooks folded into the core plugin: gates, guards, engines and what each one does. Moved here verbatim from the repo `CLAUDE.md` so it loads only when you edit these files.

- `stack/hooks/` - eighteen hooks, folded INTO the core `alfred-code` plugin (2.0.0 - there is no
  hooks plugin). Nothing is copied or wired per project except the three engines (`docs.js`,
  `memory.js`, `history.js`) and `model-windows.json` in `.claude/hooks/`, because 22 bodies shared
  with cursor-stack run `node .claude/hooks/docs.js` (and the history block points at `history.js
  rulings`). The core's hooks block is GENERATED from the manifest's `hooks[]` table after the core's
  own two per event (`mergeHooks`, lint check 48); every hook carries `"timeout": 10` (a hook with none
  gets Claude Code's 600s) except `check-turn-build.js`'s 60 on its `Stop` wiring, `shell-guards.js`'s 80 and `file-guards.js`'s 50, from the
  `HOOK_TIMEOUTS` table (per file, per event) the seed writes, and launches as `node "${CLAUDE_PLUGIN_ROOT}/<file>"` (a bare path needs the exec bit, and
  never runs on Windows). `ALFRED_CODE_HOOKS_VIA_PLUGIN=false` restores the 0.2.x copy route (the
  core's copies stand down for the wired ones); the walk writes the hooks it did NOT pick into
  `ALFRED_CODE_HOOKS_OFF`. The six gates live in `hook-prelude.js`, never inlined: the csv opt-out;
  the core's `hook_profile` userConfig (`/config`, account-level; `minimal` keeps only the rm, secret,
  force-push and desktop exec guards, `strict` reads `ALFRED_CODE_TURN_CHECK` as on, the csv still wins);
  the plugin copy standing down beside a still-wired copied twin; a repo never set up (no install
  record in it, any folder between it and its git top level (a monorepo package with its own install), the top itself -
  never a repo kept at the home directory, for the installer's `gitRoot` as much as the hooks, seam m3 - or - for a git
  worktree - its main checkout, so a worktree of an
  installed checkout counts as set up; under a user-scope core such a repo is written nothing and only
  the rm, secret, force-push and desktop exec guards stay live, writing no row - R54, R86 - plus the dispatch guard's
  implementer gate, M9. Known ceiling: such a repo still lists all 44 core seats, 12,532 characters of
  descriptions in every session's first call where 2.0.0 listed 9, since no deny is written into a repo the
  stack never touched - revisit when a plugin's agents can be scoped per project); and a Cursor host, judged from the PAYLOAD alone (`cursor_version`, or a camelCase event name - never Cursor's environment variables, which a `claude` session in its terminal inherits): Cursor loads Claude hooks by default and turns a Stop block into an unbounded follow-up, so only the rm, secret, force-push and desktop exec guards run there and every other hook stands down silently, no ledger row. Each non-protective hook makes the call itself, `cursorStandDown(payload, __filename)`, right after parsing its own payload (no stdin is read or patched by the prelude; a test fails a hook file that lacks it). All fail open. Beside the gates,
  `unattended(input)` says nobody is at the terminal - `ALFRED_CODE_UNATTENDED=1`; else
  `CLAUDE_CODE_ENTRYPOINT` when set (the 2.1.283 CLI sets `sdk-cli` in print mode, rewriting an inherited
  `cli`, and keeps an SDK launch's `sdk-ts` / `sdk-py`, which stay interactive); else the transcript's newest
  row carrying an `entrypoint` (`sdk-cli` for `claude -p`, `cli` interactive; bookkeeping rows carry none). A
  suite that drives these hooks deletes the runner's own `CLAUDE_CODE_ENTRYPOINT` first. Then the hooks that ASK a person stay quiet: no docs hold or Stop FINISH ask, no
  stop-contract prose-question, pending-close or fresh-session block (a `mode: unattended` row
  instead), no answer-length Stop block, no fresh-session offer, and the credential rotation ask becomes one
  `mode: unattended` row per exposure (it replaced 2 of 12 pilot-3 finals). Every protective denial is
  unchanged; a missing, empty or torn-last-row transcript reads as a person.
  The fresh-session arithmetic (trigger per window tier, window lookup, cold floor) lives in one
  engine, `fresh-session.js`, which the two fresh-session hooks and the monitor require from their
  own directory; a hook that runs before it lands keeps every offer off. `shell-writes.js` parses a
  shell command's writes for the cross-project guard and the done gate, after blanking heredoc bodies
  and comments (an apostrophe in a comment flipped every quoted span after it, and the source-protocol
  snippet read as a redirect to `/@`); a write verb counts only at a command position and within its own line (2.1.6 H1:
  `install` ending a folder name, and a `\s` crossing the newline, read a sed script's `/g` as a copy destination) -
  past a wrapper and its values (`timeout 5`, `sudo -u root`), spelled by path or escaped (`/bin/rm`, `\cp`) or after a
  `case` arm; a `\`-newline continuation is joined first, a `sh -c` script is read as shell, a copy target may sit before
  a redirection or name itself with `-t`, a subshell's `cd` ends with it and `popd` returns, and a runtime's script
  (`node -e`, `python3 - <<`) is read only when the runtime is the command it is fed to - `cat > run-node.txt <<` is
  text - and read whole, quote-aware (the review's corpus plus the runtime and carried-script shapes,
  `scripts/fixtures/cross-write-corpus.json`, replayed in guard-hooks.test.js). It is the ONE home of shell text
  carried into a shell (`carriedScripts`, re-verify N4, re-verify 2 R2-M5 / R2-m2): `sh -c` (long options and `-o
  <name>` before the `-c`), `eval`, a heredoc, a here-string, `< file`, an `echo` / `printf` (its format cycled over its
  arguments) / `cat <file>` stage piped in past any `tee`, and a script FILE a shell runs (`bash x.sh`, `. x.sh`,
  `source`, `./x.sh` with a shell shebang or none), read from disk against the caller's cwd - or from the text the same
  command wrote into it first - inside the scan budget (`hook-prelude.js` `SCAN_LIMITS`: 8MB of text scanned, 3 levels
  of carried scripts and 48 destructive git calls judged by the rm guard, work counts and never time, so a verdict never depends on machine load; each byte is charged
  once, where it comes from - the command, and a script file as it is read up to its first NUL byte, so a
  self-extracting installer costs its shell head; past it the rest is unread and judged conservatively); `-n` and `-o
  noexec` run nothing, and what `curl` prints does not exist when the hook fires. `gitText` is the ONE reader of a command for every guard that judges a git call (commit, push, force-push, the rm guard's git half):
  aliases expanded, every carried script joined, one scan budget, one parse, and `callDir(call)` for where each call runs. It is also the one home of git ALIAS
  expansion (`expandGitAliases`, T20, R2-m1): every spelling of the call (`/usr/bin/git`, `\git`, `-P`, `--git-dir .git`,
  `--work-tree .`), looked up with its `-c`, `--config-env`, `GIT_CONFIG*` / `HOME` / `XDG_CONFIG_HOME` / `GIT_DIR`
  assignments and an alias the same command defines; a `!` alias runs at the repo's top level; an xargs-fed subcommand
  or an unanswered lookup is `unreadAt`. The cross-project guard scans with both (an unread alias or script asks once,
  opened by a `CROSS-WRITE-ALLOW` line naming its path or `unread`); the done gate reads neither. It is also the one home of the SHELL ROUTE, `SHELL_TOOLS` / `isShellTool`
  (Bash, PowerShell and Monitor - Monitor runs its `command` under Bash's permission rules, and a `ws` watch carries
  none), which every shell guard requires and the dispatcher's `MATCHER` spells (2.1.4 audit I1: no guard saw a
  Monitor command). The eight guards with a
  `Bash|PowerShell|Monitor` row are wired as ONE hook, `shell-guards.js` (R11; both generators fold the rows,
  `wiringRows`): each guard runs in-process with its own gates and ledger row (its `global.BLOCK_DETAIL` cleared before and after it), every block reason
  reaches the model, a throwing guard fails open alone - except that a PROTECTIVE guard's exit 2 (force-push, rm,
  secret) is answered at once, since the guards run one after another and a later one stalling past the budget would
  drop it (a timed-out `command` hook's output is discarded and, on PreToolUse, the call CONTINUES through the normal
  permission flow with every verdict dropped - code.claude.com/docs/en/hooks, 'Timeouts': 'don't count on a stalled
  hook to act as a gate'; the agent-sdk page's deny-on-timeout is the SDK callback family, not these; 2.1.5 M2 - every
  git call in the docs engine carries a 5s timeout),
  and the protective ones run first (`RUN_ORDER`; the messages keep the manifest's order).
  The five guards with a file-tool row ride ONE hook the same way, `file-guards.js` (2.1.5 M3: a Read or a Write paid
  three node processes): the read guard, the secret guard, the config and cross-project guards and docs-session, each
  run only for the tools its own manifest row names (its `GUARDS` table, held to the manifest by a test), the secret
  guard run first and its exit 2 answered at once; instrumentation stays its own `.*` row. Both still launch in shell form (below).
  Every guard appends one row per BLOCK to `<docs-path>/hook-blocks/<session>.jsonl`
  (`analyze-usage.js --hook-blocks` tallies it) - the block RATE is what says a gate earns its keep.
  THE STOP CHAIN (hooks audit 2026-10-08 S1): four hooks can block a `Stop` - the stop contract, answer length,
  docs-session and the turn build check - and `stop_hook_active` is true after ANY of them blocked ('true when Claude
  Code is already continuing as a result of a stop hook', code.claude.com/docs/en/hooks), so a hook that stood down on
  the flag alone never judged the close rewritten after a sibling's block. Each marks its own block (`hook-prelude.js`
  `markStopHeld`, a file under `ALFRED_CODE_HOOK_LOG_DIR` or the temp dir) and stands down on a continuation only when
  IT held this cycle (`stopHeldThisCycle`); a Stop with the flag false opens a new cycle and clears the marker. So
  every blocker judges each rewritten close and blocks at most ONCE per cycle - at most four continuations, in no fixed
  order (the four run in parallel; answer length yields its wording to the stop contract's marker or ledger row), with
  Claude Code's 8-consecutive-continuation cap the outer guard - and an unwritable marker dir stands a continuation
  down, the old reading. The stop contract's per-turn probes skip a continuation (the same turn), and its SubagentStop
  hold keeps the plain flag beside its own once-marker (`guard-hooks.test.js`: never held again, marker or not).
  STATE HYGIENE (audit 2026-10-08 S9): a hook that writes per-session state sweeps its own prefix's files untouched for 7
  days, once per process inside 50ms (`hook-prelude.js` `sweepStale`, the docs-session sweep's pattern) - the stop
  contract at each Stop (`guard-stop-*`, the `alfred-stop-held-*` chain markers, and its log capped to the newest 256KB
  past 1MB, `capLog`), the fresh-session hook when it writes an offer (`guard-fresh-*`), the read guard when it logs a
  range (`guard-read-*`), the monitor at each prompt (`<docs>/flow/monitor-*`) and the commit guard when it writes its
  trivial ledger (`<docs>/flow/trivial-*`).
  A denial that needs the user's decision ends in ONE AskUserQuestion, and an 'allow' answer is
  honoured through a `<docs-path>/flow/*-ALLOW` receipt (this session's own, under 8h).
  - `guard-protected-force-push.js` - blocks force-push to protected branches. It reads the command through
    `shell-writes.js`'s `gitText` (below), so a push counts past a wrapper (`timeout 60`, `env A=1`, `nohup`), in an
    `if` / `for` body, `bash -c '...'`, a heredoc or here-string into a shell, `eval`, a script file and a git alias
    (`alias.pf = push --force`), each from the directory a leading `cd` moved it to; a computed name (`bash -c "$(...)"`,
    `source <(...)`, a loop variable) is out of model (2.1.6 seam review M3). It loads `shell-writes.js` inside a try and
    passes the call when the file is absent (the parity test's copy set), as the rm and commit guards do. An option's
    value is never a refspec (`-o ci.skip`, `--repo x`), a `-d` inside a short cluster deletes (`-ud`), and a wildcard
    destination forced or under `--prune` is the `--all` case (audit 2026-10-08).
  - `guard-catastrophic-rm.js` (PreToolUse, the shell route) - a recursive `rm` of an unrecoverable target (a bare `.git` included, a `$VAR/.git` path not; and a
    literal `find <target> -delete` / `-exec rm` with no filter test before the action in its `-o` branch, or a piped `Get-ChildItem <target> | Remove-Item`
    with `-Recurse` on either side - 2.1.5 M1; read past any wrapper of shell-writes.js's list, an `if` / `do` body, a subshell
    or group (`(cd d && rm -rf x)`, `{ ...; }`, `! rm`, whose parens `groupsAsCuts` reads as cuts), `bash -c`,
    a heredoc into a shell and `eval`; `xargs rm` fed a listing and `find -exec sh -c` stay out of model), and
    EVERY git call in the command, read from its argv by `gitText` (the same wrappers, bodies, scripts and aliases as the
    force-push guard; only the nine verbs that can lose work spawn git, and past `SCAN_LIMITS.gitJudged` the rest of a command reads
    as one whole-tree discard, so N `git add` calls cost no git and the count never lets a discard through - seam M3, m4;
    each call past the cap is also read by its own plan from its argv when that plan is a clean, a stash, a reflog or an
    object loss (one read per directory and kind, at most 16, past them an unread loss), and text the reader could not
    read (`unreadAt`) is a whole-tree discard where the shell runs - audit 2026-10-08;
    PowerShell's paths reach the reader with backslash and backtick swapped, and its rm targets with every backslash
    read as `/` - `.\`, `..\`): a
    path `checkout` / `restore` of the working tree / `reset --hard` / a forced `checkout` or `switch` only
    when the PATHSPEC it names is dirty (judged where git runs: cwd, a leading `cd`, `-C`; `status -z`, so
    a non-ASCII name reads as written; an untracked file counts only when the target tracks it, `-` being
    the previous branch), `clean -f` by its own `-n` dry run (ignored files included), plus
    `stash drop` / `stash clear` / `reflog expire` / `prune` / a `gc` given a prune date or a `-c gc.*Expire`
    by what they destroy; one block names every loss. PowerShell `Remove-Item -Recurse`
    counts. A `claude plugin marketplace remove|rm` with no `--scope` - the binary by its path or inside `bash -c` too -
    is denied (2.1.7): the CLI then removes the
    declaration from every scope and uninstalls every plugin installed from it, in every project. A SQL `DROP` or `dotnet ef database drop` writes a log-only probe row. A 'discard it' answer
    is honoured via `<docs-path>/flow/DISCARD-ALLOW` (paths, `stash@{N}`, or `*`).
  - `guard-read-whole-file.js` (PreToolUse `Read` + the shell route) - blocks whole-file dumps (also through the
    shell, any oversized file, a sweep over `.md` files). A shell loop is a sweep only when a `cat` in its body
    reads the loop VARIABLE and a gated extension names what it walks, judged with quoted spans blanked (I4: a
    `cat` inside an `echo "..."` payload was denied). An unexpanded `$VAR` target is not judged; a `cat` glob
    operand is denied as a sweep; a
    leading `cd` moves the anchor; a runtime script - inline (`-e` / `-c`) or fed through a heredoc - is read whole and
    judged by what it PRINTS: a count, a length, a test, a map of those, one element, a helper's result or a slice with
    literal bounds within the Read half's own cap (THRESHOLD lines, BIG_BYTES characters) is not a dump, nor a window
    whose two bounds share one base the script never reassigns (`lines[i-5:i+5]`, `sed -n "$((n-5)),$((n+5))p"`) and a
    print guarded by a match test on the element it prints (a `grep -C` or `grep -o` loop - a match call that spans lines,
    `re.S`, is the content); the content, a match-all rebuild of it (`s.match(/.*/g).join('\n')`), a slice with an open,
    oversized or unbounded end, every element in a loop or a collection it was put into is (2.1.6 K2 and its concerns
    round). A heredoc body is its program's script only when that program takes its script from stdin
    (`stdinIsScript`, one walker in both guards, `heredoc-stdin-script` in shared-rules.json): each option word is read
    the way that interpreter's own parser reads it (a `STDIN_FLAGS` row for the shells, node, python, ruby, perl and
    php), so a script file named, or a script handed as `-c` / `-e` / `-m` / php's `-r`, makes the body input data;
    an option's value, bundled or the next word, is never a script file (`bash -euo pipefail`, `--rcfile x`, `node
    --max-old-space-size 4096`, `python3 -Q new`, `perl -Mstrict -we`); an option the table does not know takes the
    next word as its value, and a script option with no script word after it leaves the body the script; a runtime's
    `-` (and php's `--`) is stdin with the script's argv after it, while a shell's `-` or `--` only ends its options; a
    program with no row (deno, bun, pwsh) always runs its body. A shell body is then judged as commands, like `-c`, and
    a runtime body as its script. A verb that prints a whole file under another name is size-gated like `cat` (nl, tac,
    sort, base64, xxd, `dd if=`, a copy onto `/dev/stdout`, curl `file://`, vim's print, `look ''`, an identity sed /
    awk / `perl -p`, grep with an empty pattern, a read loop echoing every line, perl's handle read, php's
    `file_get_contents` / `readfile`); a bounded run, or one into a file, is not. A verb, `;` or `|` inside a quoted string is
    text (`grep -c 'cat -n' f` runs no cat), unless a shell runs the string (a shell's `-c`, `eval`, `watch`, a stage piped
    into `sh`), and pairing stops trusting quotes after a comment's apostrophe; `echo "$(cat f)"` prints what its
    substitution read, an assignment of one does not. Only a gated file over the threshold
    is a content source; a print reached through an alias is followed, one passed along or called by bracket is a dump.
    Heredoc spans come from `heredocsOf` in this guard and the secret guard alike, so every opener spelling it accepts
    (`<<\EOT`, `<<-'EOT'`, `<< 'EOT'`) is judged the same (seam M1; a table test runs each spelling through both), a runtime
    or shell here-string is read as its inline flag, `deno` / `bun` / `pwsh` bodies are judged, and an unquoted heredoc's `$(...)`
    is a command (m2, m5). TWO budgets, both counts of work and never time: this guard's own judging budget below, and the scan
    budget of `hook-prelude.js` `SCAN_LIMITS` (8MB of text, 3 script levels, 48 judged git calls) that the shared reader spends.
    Judging scales linearly with the command inside one budget of WORK, never time, so a command gets the same verdict
    on any machine: each judging step charges the characters it reads, the two thresholds at the top of each guard
    (`JUDGE_MAX_WORK`, 20x the costliest of 54,503 recorded commands; `JUDGE_MAX_DEPTH`). A test holds each
    40,000-character pathological shape to linear work in both guards, and a command past the work budget is blocked
    while code nested past the depth cap is read as printing what it read (the secret guard blocks it) - never let
    through; nothing stops reading silently at a count; a shell heredoc nested past three levels is out of budget and
    blocks (audit 2026-10-08: five `bash <<EOF` levels passed). The audit 2026-10-08 route fixes: a pipe into a filter
    exempts a segment only when the filter bounds it - an identity filter (`grep ""`, `awk 1`, wholeFiles' rules) or a
    `head` / `tail` past THRESHOLD lets the print through - and a literal span on the file (`head -n 9999`, `sed -n
    1,99999p`, `tail -n +2`) is a dump when it prints past THRESHOLD lines and more than half the file; a glob of any
    sweep extension (`cat skills/*/SKILL.md`) and a listing substitution (`cat $(find ...)`) are sweeps; any other
    extension printed whole to the terminal past BIG_BYTES is blocked, as the Read half blocks it (route gap S2), unless a
    program reads the output (`| jq`). On the Read half a rendered image (PNG, JPEG, GIF, WebP - its pixels, at most 4,784
    visual tokens, are sent, never its bytes: platform.claude.com/docs/en/build-with-claude/vision) and a PDF Read naming
    `pages` pass the size test, extensions match in any case, and the 60% range cap is a per-session log of ranges
    appended before each verdict and replayed in order, keyed by real path, so parallel Reads cannot each pass it.
    Every denial on a file the navigation server indexes carries the
    `ToolSearch select:` line that loads the navigation server's tools (a size denial on another extension and a tree it
    never indexes name grep instead). Its convention-rule announcement
    names only a rule in the project's own `.claude/rules` - a plugin-launched hook's sibling `rules/` is
    the whole catalog (it named `winforms-conventions.md` to a project without it, the 2026-09-26 pilot); with no rules
    directory anywhere it cannot tell and names the rule (a recorded choice, pinned in `guard-read-write.test.js`).
  - `guard-secret-value.js` (PreToolUse `Read` + `Grep` + the shell route) - credentials are read for PRESENCE, never
    value. Judged by file CONTENT (a JSON, dotenv, INI - `~/.aws/credentials`, `~/.pypirc`, a `[section]` file,
    `~/.npmrc` - netrc or URL-per-line (`~/.git-credentials`) file holding a `secret_key_pattern` key with a live
    value; a key that names a key, `signingkey` or `publicKeyToken`, holds none, nor does a field named exactly `key` unless
    its value is credential-shaped (a Confluence `space.key` of `SD`, a Jira `customfield_10010` - 2.1.7), and neither does a file path, a switch
    or a template reference). The 2.1.6 concerns round read every other format a credential ships in, the same way:
    YAML by indentation (a kubeconfig, gh's `hosts.yml`, a Kubernetes Secret's data, a compose environment list,
    bundler's host keys), XML (maven's `settings.xml`, a NuGet.Config's key/value pair, a web.config connection
    string, a publish profile), HCL (only a quoted value - `var.x` is an expression), properties and the `.cnf` /
    `.conf` / `.toml` spellings (a `.conf`'s `key value`), `.pgpass` and `.htpasswd` by position, yarn v1's
    space pairs, a JSON credential keyed by its host (composer's `auth.json`), a private key file (PEM, OpenSSH,
    PuTTY, GnuPG), a token file and a binary key store (`.p12`, `.jks`, `.kdbx`), judged by its kind; a file's key
    also reads `pass`, `client-key-data` and a camelCase `userPass` / `userPWD`, which a variable name does not.
    The redacted view and the git stream masker mask what the reader judged, where it stands; a stream with no header
    naming the file (`git show <rev>:<path>`) reads the generic pairs only, never an HCL attribute. A UTF-16 file
    (either byte order) is judged by its decoded content, and a file printed under another verb's name is a dump too
    (`dd if=`, `iconv`, curl `file://`, vim's print, a copy onto `/dev/stdout`, sqlite3's `readfile()`, php's
    `file_get_contents` / `getenv`), a bare name after a `cd` resolved against the `cd` target. On the shell route the dump / `echo $SECRET` / bare `env` are REWRITTEN via
    `hookSpecificOutput.updatedInput` to redacted forms (`--redacted <file>`, `--redacted-env`); the
    Read tool and a credential literal stay blocked. The comparison verbs (`diff`, `sdiff`, `cmp`, `comm`, `rev`)
    are judged like `cat` (I2). A git command that prints file content (`git diff`, `git show`, `git log -p`,
    `git stash show -p`) is PROBED - the same read run as argv, no shell, 3s / 8MB, external diff, textconv and
    fsmonitor off, at most four probes per call - and only when its output would carry a credential, or it cannot be probed (a word the shell
    expands, `-c` config, `--output`, a `cd` or a changing step before it - the probe runs before the command, so
    `git add -N . && git diff HEAD` would read the tree without the new file - a failed run, a fifth probe, a repository-local
    `filter.*` config that a working-tree diff would run; audit 2026-10-08), gets `| node <guard> --redact-stdin` where
    it stands: a stream mode masking a credential key's value (JSON, dotenv, YAML, an INI / properties / `.npmrc` pair) in a config file the diff header
    names, a URL password, a credential shape and a PEM body line by line, the note on stderr. A clean diff runs
    as written - an unconditional pipe would make every read-only `git diff` ask permission. Summary forms and
    `--quiet` / `--exit-code` are left alone (a pipe replaces git's exit status - `git diff --exit-code` prints
    unmasked, a stated ceiling); bash family only, like the env pass. A file rewrite SPLICES the view into its own segment where
    it can, and the other segments run as written - judged first, shell strings included (2.1.7: a consuming project's
    sessions were refused `cat settings.json; claude plugin list`, `git check-ignore`, `cygpath` and the
    source-protocol `$(git rev-parse ... || pwd)` as dropped steps). Only what the rewrite really drops counts: the
    read's other pipe stages, or the whole command when no splice is possible (and every variable rewrite), so one
    carrying a CHANGING step there (an edit, a redirect, a build) is blocked instead - read-only verbs (cygpath, uname,
    the read forms of git and `claude plugin|mcp list`) and an inline runtime that neither writes, spawns nor reaches
    the network are no changing step, and a `$(...)` / backtick keeps its separators; and so is a
    judged stage that itself WRITES - an in-place flag on sed / perl / ruby among its flags, gawk's
    `-i inplace`, inline code that writes, or a runtime run on a script FILE, which the guard cannot see into
    (pilot 3's `node -e ...writeFileSync` and `perl -0pi` came back as the view, the edit never
    ran); the denial names the Edit tool, which changes the file without printing it. A `sed` whose FIRST
    flag is `-i` is never judged - an edit, not a dump - unless its script writes to a terminal stream
    (`w /dev/stdout`), runs a command (`e`) or sits in a `-f` file; then it is judged, and blocked. A filtering
    read (`grep`, `jq .path`, `head`) keeps its filter over the view. A recursive search (`grep -rn`, `rg`) is probed as argv
    like the git branch (3s / 8MB) and piped through `--redact-stdin --grep` only when its output carries a credential, a clean
    one runs as written; the Grep TOOL cannot be piped, so a tree hit is blocked - its pattern read as ripgrep writes it (a
    leading `(?i)`, `\A` / `\z`; one JavaScript cannot compile matches every line), its walk breadth-first with dependency
    folders (`.venv`, `vendor`, `target`, ...) last, and unjudged past 4,000 files its filters let through, 32MB or 100,000
    entries (a stated ceiling). A path-qualified verb (`./tools/grep`,
    `bin/rg`) is never spawned - the probe runs before the permission prompt, so it would run whatever script sits there
    (audit 2026-10-08, replayed) - and is piped unprobed. `git remote -v` / `get-url` / `show` and
    `git config --list` / `--get` are probed the same way (a tokened URL is masked; a config write is never probed). A print
    piped into a login that reads stdin (`--password-stdin`, `--with-token`) is a use, `${NAME:+word}` prints no value, a
    `{...process.env}` spread is no dump, and a command whose stdout IS a token (`gh auth token`, `op read`, a keychain `-w`)
    is a print when it ends the pipeline. An environment dump is replaced
    stage by stage where it stands (`--redacted-env --note-to-stderr | <filter>`), so nothing is dropped
    and nothing blocks it (the pilot's `env | grep -i msbuild; env | grep -i dotnet_cli` was blocked). A
    lone `&` is a step boundary like `;` (`true & env` was never judged), never the `&` of `2>&1` / `&>`. A heredoc
    body is data (`shell-writes.js`'s blanker, its first line kept as shell) unless the command word of its stage, or
    of one piped from it, is a runtime or a shell - a `.sh` in the name of the file it writes is neither; a runtime
    body under a quoted tag reaches the runtime verbatim, so `$NAME` in it is text, never a path, unless the code
    reads NAME from the environment (2.1.6 K1). A runtime body reads the environment only in its own spelling
    (`os.environ` in Python, `process.env` in node), never through a shell stage, and a runtime's `-` is stdin with its
    argv after it (`python3 - <file> <<'EOF'`). A `~/` string in runtime code is text - no runtime expands the tilde -
    unless the code expands it (`expanduser`, `expand_path`, a glob, a replace) or the runtime is PowerShell. A command
    string a runtime hands to a shell (`execSync("cat <file>")`, `os.system('env')`, Ruby or Perl backticks, `sh -c`) is
    judged as that shell, and so is one it BUILDS from the home directory (`execSync("cat " + os.homedir() + "/...")`), a
    shell's own `-c` string (its options read with the shell row of `STDIN_FLAGS`), `eval`, `watch`, `su -c` / `script -c`,
    what a print stage pipes into a shell and a printed `$(...)` or backtick substitution (`echo "$(cat <file>)"`) - each
    read past any wrapper word and that wrapper's own flags and operands (`timeout 30`, `env -u X A=1`, `nice -n 5`,
    `sudo -u root`, `stdbuf -oL`, `ionice -c 3`, `nohup`, `time`, `command`, `exec`; env's `-S` string is the command
    itself, and a wrapper the module lists - `doas`, `caffeinate`, `chronic`, `unbuffer`, `setsid`, `npx`, `uv run`, `xargs`, `find -exec`,
    a here-string into a shell), ONE walker, `shell-writes.js` `commandIndex` (it also passes a body keyword, `!`, `{`, `(`), that the
    read and rm guards walk too (2.1.6 seam review M2; a table test runs every wrapper of the module's own list through both guards).
    The read and rm guards cut a command at a subshell's or group's parens too (`groupsAsCuts`, seam delta 1), and the read guard
    judges a here-string into a runtime (`python3 - <<<`, `deno run - <<<`) as a heredoc body, `pwsh -Command "Get-Content f"` included (delta 3). A credential path a runtime BUILDS from `os.homedir()`,
    `process.env.HOME` / `CLAUDE_CONFIG_DIR`, `Path.home()` or `Dir.home` is judged like the literal path, unless the
    script assigns HOME itself first. A connection-string / URL password and a PEM
    private key count as credentials whatever the key. `--presence <file> [KEY ...]` is the sanctioned
    one-key read (a KEY spelled `A.B.C`, `A:B:C` or `A__B__C` reads a nested JSON key; with no KEY it lists at
    most 200 string leaves plus a count, a credential-shaped key name masked); the guard ships only
    in the plugin, so every denial and view names it by its absolute path. 'Show' is honoured through the `<docs-path>/flow/SECRET-READ-ALLOW` receipt - where the call names its session, only with a `session: <id>` line naming it, the stop contract's rotation read included (audit 2026-10-08: time alone opened it to a second session on the project). The
    name rule is what catches a credential a `$(...)` COMPUTES (`gh auth token`, a keychain or vault read),
    so a stack snippet never assigns a credential-shaped name (the source-protocol snippet's marketplace key
    is `MKT`; as `KEY` it was blocked twice in pilot 2). A rewrite is no block but is counted: one `mode: rewrite` row
    (tool, branch - `file`, `env`, `env-stage`, `git-stage`, `variable` - and a file's basename, never the value), which
    the block rate skips like the probe rows (2.1.5 M17).
  - `guard-unapproved-dispatch.js` (PreToolUse `Task|Agent`) - blocks an `*-implementer` dispatch (bare or
    `alfred-code:`-prefixed; a foreign plugin's is not the flow's seat) without the `<docs-path>/flow/APPROVAL` gate file (written on explicit approval or an AUTO waiver),
    blocks a generic `general-purpose`/`claude` dispatch while that stamp is live (stamps older than 8h
    or the session are absent), and blocks an `Explore`/generic dispatch asking a SYMBOL question ('reference to' /
    'usages of' count only before a code identifier - backticked, CamelCase, `name(`, `A.B` / `A::B` - never a
    kebab-case or file-shaped token, and 'where is X defined' / 'what type' need one too: I5, a text sweep for a skill name was the week's one block;
    so do the caller and definition shapes - 'who calls', 'call sites of', 'definition of', 'implementations of',
    'subclasses of', 'find the class' - which also take a backticked or capitalised name, a lowercase word being prose;
    audit 2026-10-08). An
    `Explore` / `Plan` brief gets the untrusted-content sentence appended (`updatedInput`, never a deny). The APPROVAL
    root is `CLAUDE_PROJECT_DIR`, else the payload's `cwd`, as its ledger reads it, and every block row names its branch
    (`symbol-question`, `diagnoser-pin`, `implementer-unapproved` / `-stale-stamp`, `generic-while-stamped`).
    A diagnoser CALLER (the payload's `agent_type`, bare or house-prefixed) dispatches only `evidence-gatherer` -
    a subagent's `Agent(<type>)` list is ignored, so the grant alone let it start a writing seat (2.1.5 M48).
    In a repo never set up only an `alfred-code:`-spelled implementer target is judged - the diagnoser pin,
    then the implementer gate - and no block row is written (M9, `standDown(..., { setUp: false })`).
  - `guard-ungated-commit.js` (PreToolUse, the shell route) - blocks a non-trivial `git commit` without the
    `<docs-path>/flow/COMMIT-GATE` receipt, and `git push` / `gh pr merge` without `PUSH-GATE`. A dry
    run or a branch level with upstream is never gated; `ALFRED_CODE_PUSH_GATE=0` turns the push half off. 'Level' is
    read BEFORE the command runs, so a history mover (commit, merge, cherry-pick, am, rebase, revert, pull, reset) or an
    unreadable git call chained ahead of the push counts as ahead (audit 2026-10-08: `git commit -am x && git push`
    published ungated). So does a push of anything but the current branch, `HEAD` or `@` under its own name (`origin
    feature`, `feature:main`, a tag, a delete) or of a set (`--all`, `--tags`, `--mirror`, `--follow-tags`), and a
    first push's scope reads the commits no remote holds. A PUSH-GATE written before this session began is absent
    (the transcript's birthtime, the dispatch guard's APPROVAL rule); a `WAIVED` quote must waive the review in the
    user's own words (skip, without the review, just push - a bare 'commit it' is no waiver, an option label this run
    wrote is no user's words); `head:` is the first sha word on its line; the act a denial echoes is capped at 200
    characters with a URL credential masked, and the publish denial names `habits-commit-checkpoint`.
    Both are judged in the repo git runs in (the shell's cwd, a leading `cd`, `-C`) - a worktree is its own.
    A PUSH-GATE receipt spanning more than one MANIFEST-owning directory needs a `scope:` line naming
    what the probe actually ran (a plain top-level folder is no project, so an ordinary repo never asks).
    Every commit, trivial or not, first gets a scan of the lines it ADDS (the index, plus what `-a` or a
    chained `git add` takes in; a commit NAMING paths, the working tree of those paths - alone under
    `--only`, on top of the index under `--include`; at most 2MB, a binary file or one past the cap
    skipped, and past the total the scan stops reading but keeps its hits): a conflict marker, a debugger, a focused test (a comment-only line and an ordinary call such as `fit(...)` never count), a
    credential-shaped literal or a hidden character (`hidden-chars.js`, the lint's class; a byte-0 BOM
    passes, and so does a joiner or direction mark a script needs) blocks, and no COMMIT-GATE receipt opens it - a hit meant to land goes
    through one ask and `<docs-path>/flow/STAGED-SCAN-ALLOW` (`file:line`, a file or `*`).
    What was untracked when the change started (`docs-session.js`'s HEAD-keyed record, below) is not the change: it
    leaves the receipt's `spec:` count and the trivial bar, and a `git add` whose own dry run would stage one of
    those paths without naming it (`-A`, `.`, `:/`, a directory, a glob) blocks until `<docs-path>/flow/UNTRACKED-ALLOW`
    lists it (a path, a directory ending in `/`, or `*`) - pilot 3's ~150 harness files drove 19 denials and one sweep.
    The receipt's `spec:` count is measured on what the commit takes in - the scan's set, each add and commit path placed
    where its own git call runs (the cwd, a cd, its `-C`) as a `:(top)` pathspec (2.1.6 H2: on the whole tree, narrowing a
    commit never helped) - and on the whole tree when the command does not spell that set out (a path word the shell
    expands, an add fed by `xargs` or `--pathspec-from-file`, an interactive add or commit, `git $C`, a chained `git rm` /
    `git stash pop`) or its named paths resolve to nothing while the tree is dirty. The trivial bar is cumulative per
    SESSION (review M2): this commit's set plus the session's earlier commits the guard itself let through as trivial -
    its ledger `<docs-path>/flow/trivial-<session>`, one row per trivial pass (the HEAD it was made on, its files and
    churn), counted while any of its files still differs between the session start and HEAD - so an amend or a rebase
    keeps it and a branch switch drops it; rows repeating one head and file set count once (a retried chain), an
    `--amend` is judged as the whole commit it leaves (its parent's diff plus this delta, the replaced row skipped), and a
    commit a valid receipt covers writes no row; commits a pull, a merge or a rebase brought in add nothing (re-verify
    N1, re-verify 2 R2-M4). So one small commit stays exempt and a split change gates at the
    slice that crosses it. The session is gated by the start sha history-session.js pins in
    `<docs-path>/history/<session>.json` at the first SessionStart (kept across a resume or compaction): a new session
    begins a new change, and with no record the bar is the whole tree; a start the session rewrote (amended, rebased) is
    read from where it meets HEAD. The git calls are read by shell-writes.js's walker (`gitCalls`), as are the
    git aliases and carried scripts (`expandGitAliases`, `carriedScripts`, above): each alias is expanded in place and each carried script, its own aliases expanded, joins
    the command after a newline; an alias still standing after 5 steps, a lookup git cannot answer, an xargs-fed
    subcommand, or text past the scan budget that names git gates the call as a commit, unread. Every check reads
    git however it is spelled (`/usr/bin/git`, `\git`, `--git-dir <d>`, `--work-tree <d>`), and behind a runner no
    list names (`xcrun`, `arch -arm64`, `bundle exec`, `op run --`, `flock`): a bare `git` word after a head that does
    more than print, read or edit data is the call (`DATA_HEADS` in shell-writes.js, so `echo` / `grep` / `ls` stay text;
    re-verify 4 R4-M2). Consent is read per clause
    and per gate (re-verify 2 R2-M3): a commit verb consents to the COMMIT-GATE and a publish verb (push, merge, release,
    open the PR) to the PUSH-GATE; a negation before or after the verb ('don't push', 'no need to commit', 'commit is
    not needed'), a stop ('hold off on the push'), a deferral (a wait on CI defers a push, a release or a ship, never a
    merge: 'merge it once CI is green' consents), the user keeping the act ('I'll push it myself') or a
    statement about the verb refuses it, and only its own gate. Opening a pull request ('open the PR', 'відкрий PR') is
    consent; a question, a negation or the PR's description / template / page is not (H3).
  - `guard-stop-contract.js` (`Stop` + `SubagentStop`; PreToolUse `AskUserQuestion` - its notes INJECTED, and a
    PreToolUse note lands beside the tool result, which for an ask is the user's ANSWER, so each is worded for that
    moment ('the ask just answered ... verify, re-ask if it moved'); the one DENY is the ask's own house voice (an
    em- or en-dash or a horizontal bar - `hook-prelude.js` `HOUSE_DASH`, the answer-length block's class too - or a straight or
    curly double quote; audit 2026-10-08) outside a backticked span or fenced block, which it neither judges nor rewrites
    (R5: a string's delimiters in code stay double), once per ask text (a marker the log dir cannot hold goes under the temp
    dir, so a missing dir never re-denies), carrying the corrected strings (I3);
    LOG-ONLY: `PostToolUse` + `PostToolUseFailure` on the shell tools) - blocks a turn ending on a decision-shaped question in prose (the quality
    loop's mode and stage-close asks worded as statements included), or a 'done, next step pending' close - unless every pending item the close states is a WAIT ('still running',
    'waiting on', 'awaiting') on work this session launched that is still out and ENDS (an async Agent, one a SendMessage
    resumed, a Monitor, a background shell whose command names finite work - a test, build, lint, install, migrate, deploy
    run - and no watcher: re-verify 2 R2-B1 turned a list of servers into a list of work that finishes; read from the
    transcript's newest 8MB, 2.1.6 H4 - and before it, at Stop, the payload's own `background_tasks` registry when it
    carries one: a running subagent, workflow, teammate, cloud session, MCP task or monitor, or a finite shell, is live work,
    and an empty registry outranks the lagging transcript, audit 2026-10-08; when
    that cannot be read, an agent / review / implementer still running or a waiter that wakes the session); a wait counts only when
    it names the running work (a report, a verdict, an agent - an approval, a go-ahead, a decision or a sign-off is a
    hand-back), a dev server, `dotnet run`, `docker compose up` or another server or watcher is no work that ends, and a
    wait on the user, a next step, 'tell me' or 'nothing reports' keeps it a stall, in English, Ukrainian and Russian
    (review B2, re-verify N-B2, N4) - except that 'tell me', 'let me know', 'ping me' and the Ukrainian and Russian
    forms are an OFFER when an offer word follows (if, in case, how, what, whether, about - not before an infinitive:
    'tell me whether to push' asks for the decision), and a when / once / after condition still hands back (re-verify 4 R4-M3). A HAND-BACK anywhere in the close (an approval, a go-ahead, 'let me know', a
    question to the user) wins over every wait and every text exemption (R2-M1), the first-person past done forms read
    in Ukrainian and Russian ('Зробив', 'Сделал', 'Закоммитил' - R2-M2), and a wait on the stack's own seats (a designer,
    a diagnoser, an analyzer) is a wait on work (R2-m3); holds ONCE a subagent that stops on a wait nobody will end ('I'll wait for...' or its own
    ScheduleWakeup) with no background work of its own; a close saying the RUN has nothing pending (the pinned line in shared-rules.json) is
    finished. A fork, subagent or worker is work that ends; a `queue-operation` row that only QUEUED a task notice
    (`enqueue`) has not ended it - the delivered one does; 'remains' is pending only in its pending forms ('still remains',
    'remains to be done'), so 'only sentry remains' is a status; and the fresh-session branch passes a close whose turn
    already ANSWERED an ask carrying the fresh-session choice (2.1.7, a consuming project's session audit). Credential branch: asks for rotation ONCE per exposure (`ALFRED_CODE_ROTATE_ASK=0` off; any ask
    answered or declined after its block is the answer, a free-text 'Other' included), judged
    on what the model was SENT - a tool result's `message`, never the CLI's stored `toolUseResult` copy (an
    Edit's `originalFile` held a JWT the secret guard had kept out of context, pilot 3).
    Three LOG-ONLY probes (2026-09-25 - the habits skills lean on their descriptions and the flows that load
    them, and the misses are counted, never held or injected): a done claim over a turn's source edit
    (file tool, a shell write on the whole shell route, or a navigation `rename_symbol` / `safe_delete_symbol` credited to
    its declaring file - R8) writes one `done-gate` row per turn - `unrun` when nothing ran after the edit,
    with the skill load, the project's test markers and any instruction line against running tests
    (`ALFRED_CODE_DONE_GATE=0` off) - and the first red build or test run of a streak writes one
    `root-cause` row (one streak per actor) that `analyze-usage.js --hook-blocks` resolves against the
    transcript: the skill loaded before the next fix, in context, after it, or MISSED. A close dismissing a
    failure ('pre-existing', 'unrelated to my change', 'flaky', 'skipping tests for now') in a turn with a red
    run, a skipped test or an added skip marker writes one `rationalization` row per turn.
    Fresh-session offer on a clean close past the window's ABSOLUTE trigger:
    `ALFRED_CODE_FRESH_SESSION_200K` (default 150000), `_1M` (400000), `_DEFAULT` (300000, any other or
    unreadable window); `0` switches that case off; seeded absent-only. The window comes from ONE table (the session
    model's row in the shipped `model-windows.json`, else `ALFRED_CODE_DEFAULT_CONTEXT_WINDOW`, seeded 300000; no id
    suffix, carry or compaction is read), never declared. A key matches its id, a dated snapshot, a Bedrock version, the `[1m]` suffix and a provider prefix, never a point release: `claude-opus-5-5` took `claude-opus-5`'s row until every model got its own (2.1.5 M6, which added Opus 4.5 and Sonnet 4.5 at 200K). A trigger at or above its window is clamped
    inside it, and `_DEFAULT` must stay below the smallest window it can land on. The offer fires only
    when a resume recovers something (carry minus the session's first-message floor >= 40% of carry),
    re-arms at 1.5x growth, and never mid-response. A long-idle or long-span session takes the same
    offer under the window (`ALFRED_CODE_FRESH_SESSION_AFTER_HOURS`, default 2, unseeded, `0` off).
  - `guard-fresh-session-start.js` - denies the MODEL's own PreToolUse `Skill` call on a
    `disable-model-invocation` skill (read from its frontmatter - the personal copy first, then the project's, then the
    running plugin's own root, then the plugin caches newest version first, the order Claude Code resolves a name in, M10; the user's slash turn is untouched;
    a plugin COMMAND and the router skill too - `commands/`, `setup-plugin/commands/`, `setup-plugin/skills/` - audit
    2026-10-08: the seven guided commands and `alfred-code` were never resolved), and
    offers a fresh session before a deliberate orchestration run (capture, loop, solve flow, review,
    guided walk; only the `alfred-code:` namespace is stripped, so another plugin's `other:task-solve` is not one) when the
    context is past the window trigger OR (slash route only) this session already
    TYPED a run - a Skill call is a phase of a run in flight, and harness-written user rows are no turn. The size offer
    stands until an ask is answered after it (its file records the transcript size; a retry with no ask between was a
    soft gate), and a Skill call whose turn already ANSWERED an ask carrying the fresh-session choice (task-solve's stop
    asks) is not offered again - `freshAskAnsweredThisTurn`, one home in `fresh-session.js`, the stop contract's too. Routes:
    PreToolUse `Skill` BLOCKS; `UserPromptExpansion` INJECTS for slash-invoked runs (2.1.5 M14: the event fires on a
    typed command and names it in `command_name`, the typed prompt settling a plugin command's namespace; its matcher, a
    regex with no colon, lists the orchestration commands, so no ordinary prompt spawns it; never blocks - a blocked
    expansion shows its reason to the user only); `SessionStart` matcher `compact` injects the ask plus two lines: answer in
    the language of the user's prompts (unless a loaded skill sets it), and re-read a live plan file's header first. `PreCompact` writes
    `<docs-path>/flow/COMPACT-STATE` first (the live plan, the open flow stamps with their ages, the
    files this session wrote, no model call), and the compact start points at it - even with every
    fresh-session offer off.
  - `guard-cross-project-write.js` (PreToolUse `Write`/`Edit`/`MultiEdit`/`NotebookEdit` + the shell route) - a write outside
    the project root is blocked (file tools and shell routes: redirection, `tee`, in-place `sed`/`perl`,
    `cp`/`mv` destination, `rm`/`mkdir`/`chmod`, `git -C <other>` mutating, `cd <other>` then a write);
    the change goes to a task card under `<docs-path>/cross-project-tasks/`. Reading stays open. A shell path is
    anchored at the payload's `cwd` (the Bash tool's persisted cwd, as the rm and config guards read it; a missing,
    relative or vanished one is the project root), a file-tool path at the project root (audit 2026-10-08). Session
    scratch (the harness root `/tmp/claude-<uid>` listed on its own, so a project kept under `/tmp` still reaches it),
    `~/.claude` / `~/.claude-<space>`, a relocated `CLAUDE_CONFIG_DIR` and `/dev` stay writable; paths compared as REAL paths in their on-disk
    letter case (the native realpath, and on win32 a case-folded compare as well - M9); a Git Bash mount path (`/c/...`,
    `/cygdrive/c/...`) is translated first (`shell-writes.js` `nativePath`, the one home every path-resolving guard
    requires - 2.1.5 M8). 'Allow' is honoured through the
    `<docs-path>/flow/CROSS-WRITE-ALLOW` receipt; `ALFRED_CODE_ALLOW_WRITE_OUTSIDE` opens a second
    tree permanently. The log-only fork-liveness probe is retired (2026-10-09, the user's ruling after its rows were read:
    56 probe rows over two weeks in three projects, none naming a collision; the per-call head reads cost 12-22ms).
  - `guard-config-protection.js` (PreToolUse `Write`/`Edit`/`MultiEdit`/`NotebookEdit` + the shell route) - a
    check is never made green by weakening the check: a change to a lint / format / analyzer config that
    ALREADY exists (eslint, prettier, stylelint, biome, `.editorconfig`, a ruleset) is blocked, and in
    tsconfig / MSBuild files only a change to the strictness keys (compared as key=value pairs, so any
    other edit passes). Creating a config passes; the shell routes are the in-place edit, redirect, `tee`,
    `rm`, `mv` and a `cp` onto it, read through `scanShell` (a wrapper, a carried script, a `cd`'s anchor) and then the
    guard's own segment parser. Audit 2026-10-08: the ignore files (`.eslintignore`, `.prettierignore`,
    `.stylelintignore`) are whole-file configs; a commented-out setting is no setting (JSONC comments string-aware, XML
    comments, an unterminated start running to the end); an MSBuild property's attributes are part of its pair
    (`Condition="false"`); an Edit is judged on the whole file it leaves; a shell write that replaces or removes a keyed
    file holding a strictness key blocks; PowerShell's backslash is a separator; and paths compare as real paths.
    'Allow' is honoured through `<docs-path>/flow/CONFIG-EDIT-ALLOW` (a
    file, its basename or `*`); `ALFRED_CODE_CONFIG_PROTECT=0` turns it off. A lockfile, a migration, the central
    package file and a solution file are a recorded DECLINE (2.1.5 M13, in its header): legitimate work edits each, and
    whether a migration was applied lives in a database no hook reads.
  - `guard-desktop-exec.js` (PreToolUse on the desktop servers' two process launchers, both routes' spellings, one
    anchored pattern each - the copy route's bare server spelling is never literal text, lint check 54) - the
    user's ruling of 2026-09-29 (I10): Windows-MCP's `App` with `mode: launch_executable` (any executable, caller-given
    args - the server excludes tools by NAME, never by mode) and every MacOS-MCP `Shell` call (a shell command no
    shell guard sees) are denied; `App`'s `launch` / `switch` / `resize` pass. 'Allow' is honoured through
    `<docs-path>/flow/DESKTOP-EXEC-ALLOW` (`App`, `Shell`, one executable's path or file name, or `*`); the denial
    suggests the full path, since a file-name line opens that name in every directory, and a Shell block row keeps
    the command's verb only, never the command (audit 2026-10-08). PROTECTIVE
    (final review IM2, the user's ruling): it holds under `minimal`, a Cursor payload and a repo never set up, where
    it writes no row - the Shell it gates is one the other protective guards never see.
  - `monitor-session.js` (`PostToolUse` on every tool + `UserPromptSubmit`) - a live monitor that never
    denies: one actor running the same tool with the same input 5 times in a turn, more than 20 distinct files
    written in a turn, the context at 80% of the fresh-session trigger (read from `fresh-session.js`, once per
    session). Each call appends its own row to the turn's log (`<docs-path>/flow/monitor-<session>.jsonl`, emptied at a
    prompt) and counts the rows up to it, so parallel calls lose no count (2.1.5 M15); the context note is claimed by an
    exclusive marker. Each note is one `mode: monitor` row in the hook-blocks ledger; `ALFRED_CODE_MONITOR` is seeded
    `log` (rows only, the observation week), `inject` hands the note back as `additionalContext`, `0` is off.
  - `check-turn-build.js` (`PostToolUse` on `Write|Edit|MultiEdit` and the navigation server's `rename_symbol` /
    `safe_delete_symbol` - the file in `relative_path`, from the project root, both routes' spellings - + `Stop`) - seeded OFF
    (`ALFRED_CODE_TURN_CHECK=0`; `1` turns it on per project after a measured week - validate and status
    paste `analyze-usage.js --turn-check-advice`'s one row at 3 unchecked done claims in the newest 10
    sessions, never setting it). The PostToolUse half
    lists the turn's written paths in `<docs-path>/flow/turn-edits-<session>`; at `Stop` it runs ONE scoped
    check per nearest root - the project's own `tsc --noEmit -p` for TypeScript, `dotnet build --no-restore
    -v q` for C# - and hands the first 20 error lines back as a block, once per turn (its own continuation Stop
    passes). A missing compiler or a timeout is a pass, and so is a C# project never restored (every error line
    `NETSDK1004`, which `--no-restore` cannot get past), written as one `mode: probe` row (audit 2026-10-08).
  - `guard-answer-length.js` (`UserPromptSubmit` + `Stop`) - injects the answer budget every turn; the
    Stop half blocks prose past 1800 chars when the user asked for no depth, and blocks an em-dash (en-dash and horizontal
    bar too, `HOUSE_DASH`) in prose at any length. After the third consecutive short correction following a long answer it injects
    the format ask (injection only). A correction turn (short, after an answer, carrying a correction marker -
    the test the analyzer shares, `correction-turn-test`) writes one `correction` probe row;
    `ALFRED_CODE_CORRECTION_NUDGE` is seeded `log`, `inject` adds the memory-save line with the `ToolSearch select:`
    line that loads the deferred `memory_store` (M11), `0` is off.
  - `instrument-tool-usage.js` - wired env-gated: skipped unless `ALFRED_CODE_INSTRUMENT` (seeded "0")
    is exactly "1". It runs `async: true` on both routes (`settings.js asyncFor`, the one async hook - a log never
    blocks or decides, so no call waits on its spawn; code.claude.com/docs/en/hooks, 'Run hooks in the background').
    The copy route also skips the spawn with a `[ ... ] ||` shell test; the plugin route does not, since a shell-form
    hook runs under PowerShell where Git Bash is absent ('Exec form and shell form') and the test would fail every
    call there. A `detail` hint (a description, a pattern) is masked with the pinned credential shapes before it is
    cut (audit 2026-10-08).
  - `docs-session.js` (`SessionStart`, `SubagentStart`, `SubagentStop`, PreToolUse on Read/Edit/Write/MultiEdit/NotebookEdit/Grep/Glob, the shell route and the navigation server's two kept edit tools `rename_symbol` / `safe_delete_symbol` - held like an Edit, the file in `relative_path`, both routes' spellings (I12); a rename is credited to that declaring file alone - the references it rewrote in other files fall to the Stop ask's 'no actor claimed' bucket and outside the turn check's root, an accepted gap (final review R9) - `Stop`) with its engine `docs.js` (copied beside it, not wired) - every docs DOMAIN (a top-level folder under the docs root holding a `watch.json`, plus the grandfathered `architecture/`) follows the branch, and HOW is declared at install time in `ALFRED_CODE_DOCS_VERSIONING` (`--docs-versioning` writes it; absent, ONE rule seeds it and is the engine's fallback, in three homes - `install/docs.js`, `stamp-docs-root.js`, `docs.js` - pinned by one table-driven test: `local` only when the docs are kept out of git - no domain tracked, and a domain exists or git ignores the docs root - else `git`, a fresh project included): `git` means the docs are committed and git versions them per branch, `local` means per-branch section overlays under `<docs-path>/.branches/`, folded into mainline at the first mainline session after the branch merges. The setting WINS over what the repo does, and a disagreement is reported in `status` and the start block rather than resolved the other way. The start block pushes `ORIENTATION.md`, cut at 4KB with a note so the read lines after it survive the harness's 10,000-character context cap (audit 2026-10-08), and names conflict markers and duplicate ids from the engine's `integrity()` (one parse per file, never the whole lint) - a PROVISIONAL one (the first-look scan's, `scan-evidence.js --orientation`) with a stale warning, and `status` / `stale` call it stale by definition; the first change under a source root waits for a section read (two holds, then a logged bypass; no hold when no doc file can be read by section) - a `docs.js show` the shell RUNS of a ref the engine resolves, or a Read, Grep or reading shell command of a `.md` under a domain; a Glob, an `ls`, a `watch.json` read, an echoed show line and a show of a missing ref are no read (audit 2026-10-08); the FINISH ask fires only when a changed file hits the capture's `watch.json` - at `SubagentStop` for what that agent WROTE (a tool event carries `agent_id` only inside a subagent, so every write is attributed to its actor - the main session included, under one key of its own - and intersected with the tree diff; a read-only seat running beside a writer is never asked, a write the gate DENIED is never credited, and paths are compared in git's spelling on every platform), then once at `Stop` for what the session wrote itself plus every change no actor claimed (a script's output, a tool this hook is not wired on), both in the same shape: the section named, its file, its current FIRST SENTENCE quoted, and a `set ... --expect <hash>` that refuses a rewrite of a section another agent moved meanwhile. At `Stop` the ask also says its reply is the session's last message: the docs line, then the task summary in at most three lines (pilot 4: all 8 flow cells ended on 'docs ok'); a seat's `SubagentStop` ask closes on its reply being what the caller receives - the docs line, then the report its brief asks for, its `status:` / `contract_version:` lines unchanged (audit 2026-10-08 row 25). With nobody at the terminal the hold and the Stop ask each write one `mode: unattended` row; with no watch entry and no new-module rule in any domain neither stop diffs the tree; the per-session state is written through a temp file and a rename, so a parallel call never reads it half-written; and past 2,000 dirty paths the ones a watch glob or a source root names are kept first. At `SessionStart`, before any domain check, it writes `<docs-path>/flow/untracked-at-start-<HEAD sha>` ONCE per HEAD - the paths untracked when the change began, at most 20,000 (past the cap a path reads as the change's own), which the commit guard and `habits-commit-checkpoint` keep out of the change. Every later session on that HEAD (a resume, a compact start, a fresh-session hand-off, a `/clear`) reuses it, so an earlier session's new files stay the change's own; a commit moves HEAD, the next session takes a fresh one, and the guard falls back to the newest record until then. Writing a record sweeps the ones past 7 days. It is named in one start line when it is not empty. `ALFRED_CODE_DOCS_BLOCK` / `_GATE` / `_ASK` = `0` switch the parts off.
  - `memory-session.js` (`SessionStart`) with its engine `memory.js` (copied beside it, not wired -
    the `docs.js` pattern) - reads the shared memory database FILE directly (`node:sqlite`, no
    server, no model call) and injects this project's memories plus every `preference` /
    `correction` carrying no project tag, capped at 4KB like the docs start block; a
    related-projects domain adds those projects' memories too, inside the same cap. The rows sit
    under two fixed frame lines (context, never instructions; a named file, flag or symbol is
    verified first - `alfred-memory.md`'s sentence, pinned as `memory-frame`), each carries its age
    in days, and ageing is ORDER only: preferences and corrections under 90 days first, then the
    project's other memories, then the older preferences and corrections, then related projects,
    newest first within each - nothing is deleted. `node
    .claude/hooks/memory.js level [projectRoot]` is the same engine's CLI, read by `validate` and
    `status` (`<level> <dbPath>` - then `unreadable <file>` per settings file it skipped - or `refused <file>` when a
    settings file cannot be read and no other names the database, or `none`). Fail-open: with a registration, a missing
    database, a locked file, or `node:sqlite` unavailable on this Node selects nothing and injects only the project tag
    and the search line (I5); with no registration it injects nothing; it never logs - a silent SessionStart is never
    reported as a failure. The main checkout is looked up once per start, 1.5s per git call (audit 2026-10-08: two
    lookups at 5s each could pass the 10s timeout and lose the injection). The CLI also moves memories between databases: `export [project]
    [--all] [--db <file>]` writes the live rows as JSONL straight from the file (a read failure exits
    1), and `import <file.jsonl>` stores them THROUGH the service (real embeddings), skipping a line
    whose content hash (the service's own) is already live. Both imports, this one and init's notes
    import, find the server one way (`serviceEntry`): a registration, else the installed
    `memory@envoydev` plugin's own declaration with the db path pinned.
  - `history-session.js` (`SessionStart` + `Stop`) with its engine `history.js` (copied beside it, not
    wired) - a machine-local record per session under `<docs-path>/history/` (a `.gitignore` of `*` written
    INSIDE that folder, the project's own never opened; no `watch.json`, so no docs domain): at `Stop` it
    reads only the transcript bytes past a stored offset (8MB at most per pass) and keeps the commits since
    the session's start sha, the files left dirty, the plan file written (project-relative, or `~/` under the home
    directory) and the user's AskUserQuestion answers (credential shapes scrubbed, 300 chars each, 60 kept); its git
    calls run lock-free (`GIT_OPTIONAL_LOCKS=0`) at 1.5s each, so five stay inside the 10s timeout (audit 2026-10-08);
    at `SessionStart` it injects the last
    three records of the SAME branch in at most 600 chars, framed as history, never instructions, and
    prunes past 200 records or 180 days. No model call, fail-open, `ALFRED_CODE_HISTORY=0` off.
  - Formatter after an edit: DECLINED (hooks audit 2026-10-08, coverage map) - no measured incident; formatting is
    the project's lint and the verifier's job, and a PostToolUse formatter rewrites files under the model between its
    own edits, so the next `old_string` misses.
  The guided walk's hooks layer makes them selectable, the whole catalog recommended (a selection with
  no `hook` lines keeps every hook on; setup's None emits `hook none` through `stack-select.js
  --hooks-answered`, setup only, which switches every hook off).
