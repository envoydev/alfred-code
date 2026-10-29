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
  gets Claude Code's 600s) except `history-session.js`'s 60 on its `Stop` wiring (the turn build check rides it, below), `shell-guards.js`'s 100 and `file-guards.js`'s 70 (10 for each guard a dispatcher runs), from the
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
  implementer gate, M9. Known ceiling: such a repo still lists all 45 core seats, 13,008 characters of
  descriptions in every session's first call where 2.0.0 listed 9, since no deny is written into a repo the
  stack never touched - revisit when a plugin's agents can be scoped per project); and a Cursor host, judged from the PAYLOAD alone (`cursor_version`, or a camelCase event name - never Cursor's environment variables, which a `claude` session in its terminal inherits): Cursor loads Claude hooks by default and turns a Stop block into an unbounded follow-up, so only the rm, secret, force-push and desktop exec guards run there and every other hook stands down silently, no ledger row. Each non-protective hook makes the call itself, `cursorStandDown(payload, __filename)`, right after parsing its own payload (no stdin is read or patched by the prelude; a test fails a hook file that lacks it). All fail open. Before the gates, loading the prelude applies the stack's variables to the hook's
  `process.env` (`layout.applyVariables`, 3.0.0): the project's `settings.local.json`, its `.variables`, the settings
  `env`, the launch env, then each workspace member's `.variables` - so a hook reads `process.env.ALFRED_CODE_*` as
  before, whichever file holds the value. Beside the gates,
  The csv opt-out reads a hook's OLD name too (`HOOK_RENAMED`, the manifest's `renamed.hooks` copied inline and held equal
  by `hook-prelude.test.js`: `guard-answer-length` still switches guard-answer off - audit 2026-10-20, the hooks track's
  minor list). AN ASK NOBODY ANSWERED (ruling S3, 2026-10-20): Claude Code 2.1.304 closes an AskUserQuestion left idle past
  its auto-continue timeout itself - `afkTimeoutMs` on the result, 'No response after <N>s - the user may be away from
  keyboard' in the text the model reads, partial picks after it (the 2.1.304 bundle;
  code.claude.com/docs/en/tools-reference, 'Question auto-continue timeout'). `askTimedOut` reads either, and every
  answer reader (`fresh-session.js` `answeredBlock` / `askAnsweredSince`, the stop contract's anchored answer
  wording) counts no timed-out ask; the answer hook writes the session's `askTimeoutMarker` and the dispatch guard reads it.
  `unattended(input)` says nobody is at the terminal - `ALFRED_CODE_UNATTENDED=1`; a live AUTO waiver of this session
  (`<data root>/state/approvals/APPROVAL` opening `AUTO`, under 8h and not older than the transcript - the dispatch guard's
  stamp, `autoStampLive`; audit 2026-10-10 - or, for a stamp naming its session on a `session:` line, that session
  alone for up to a week, `approvalStamp`, which the dispatch guard reads too); else
  `CLAUDE_CODE_ENTRYPOINT` when set (the 2.1.283 CLI sets `sdk-cli` in print mode, rewriting an inherited
  `cli`, and keeps an SDK launch's `sdk-ts` / `sdk-py`, which stay interactive); else the transcript's newest
  row carrying an `entrypoint` (`sdk-cli` for `claude -p`, `cli` interactive; bookkeeping rows carry none). A
  suite that drives these hooks deletes the runner's own `CLAUDE_CODE_ENTRYPOINT` first. Then the hooks that ASK a person stay quiet: no docs hold or Stop FINISH ask, no
  stop-contract prose-question, pending-close or fresh-session block (a `mode: unattended` row
  instead), no fresh-session offer, and the credential rotation ask becomes one
  `mode: unattended` row per exposure (it replaced 2 of 12 pilot-3 finals). Every protective denial is
  unchanged; a missing, empty or torn-last-row transcript reads as a person.
  **auto-run** (the stack-modes spec of 2026-10-27, the user's rulings of 2026-10-25/26; it was auto-mode, a per-run
  `--auto-mode` first after the command, from the rulings of 2026-10-14 to 2026-10-17): four mode flags,
  `--mode-auto-run-on|off` and `--mode-output-scorer-on|off`, count only in the LEADING RUN right after a `task-*`,
  `capture-*`, `loop-*`, `issue-*` or `mode-*` command group (`hook-prelude.js modeFlags`, the ONE parser every reader
  calls - the start and end hooks, the scorer switch, the ON line, the banner, the dispatch guard and the stop contract's
  solve-flow mark; a flag later in the request only marks the line `late`, a prose mention starts nothing, off wins over
  on; the expansion matcher takes every family name, audit 2026-10-14 HK06). Two files. The MODE STAMP
  `<data root>/state/approvals/APPROVAL` (`AUTO - "<the typed words>"`, `session:`, `skill:`, `at:`, `taken-from:` on a
  takeover) is written by the first `--mode-auto-run-on` or `/mode-auto-run <request>` (its typed request is its own
  `-on`), kept while live for the session and deleted only by `--mode-auto-run-off`. The RUN MARKER
  `<data root>/state/sessions/AUTO-RUN-<session>` (`skill:`, `prompt:` the typed line's 12-hex sha1, `at:`) is written by
  each typed family command while the stamp is live - none by a flag-only `mode-` line; a writer finding the same
  `skill:` and `prompt:` leaves the file and its mtime - and deleted by that run's close or `-off`. The typed route is
  `UserPromptExpansion`; the model's `Skill` call writes or keeps the stamp only, never a marker, and only when its own
  args lead with the flag and the user's newest TYPED prompt's `modeFlags` gives `family` and `autoRun: 'on'` (audit
  HK04: a skill body, a seat's hand-back, a task notice or a tool result is no typed prompt); a seat never starts one.
  ONE refusal check, `autoRunRefusal` - another session RUNNING a stamped run here (its transcript beside this one
  written in the last 10 minutes), a data root that cannot be written, an empty `/mode-auto-run`, a seat - is asked by
  the start hook and the ON line alike; a refused start writes an `auto-start-refused` row and its banner says why. A
  start over another session's idle stamp writes `taken-from:` and an `auto-takeover` row, and the losing session's next
  typed prompt gets the takeover notice once (`AUTO-TAKEN-<session>`). Each run under the mode gets the full contract as
  `additionalContext`, naming its marker, so its own offers and every person-directed hook read the session as
  unattended. `/mode-auto-run <request>`'s ON contract carries a `Solve flow:` line naming the library copy of
  `task-solve/SKILL.md` (`skillCopyState`: personal, then project, `on` or `user-invocable-only`; `switched off here` when
  `skillOverrides` turns it off and `not installed here` only when absent, M8; never the plugin cache's source). A code
  change READS that body and follows it, because Claude Code refuses the model's own `Skill` call of a
  `disable-model-invocation` flow whatever a hook says (code.claude.com/docs/en/skills); `flowLine` in the stop contract
  marks the solve run on the first Read of a `task-solve/SKILL.md` after a typed `/mode-auto-run` row with a request, and
  the next typed prompt disarms it (M1). A refused `/mode-auto-run` start gets no fresh-session offer (M7), nor does a `/mode-auto-run` line with no request, which
  only flips a switch; an `-on` line that opens no run but carries a request (`/mode-output-scorer --mode-auto-run-on <request>`)
  is told the request runs under the mode, the flag-only one that nothing else happens (final review 2026-10-27, I2 / I3). An old flag
  (`--auto-mode`, `--score-on`, `--score-off`) is stripped with a pointer line - the auto one says the run is attended,
  for the skew window where a flow skill copied before the update still reads the old flag - an unknown `--mode-*` gets
  its reason line, and a flag run after a non-family command switches nothing and gets the 'count only after' line
  (`mode-flag-old` / `mode-flag-unknown` rows); a prompt opening on a mode flag with no command before it switches nothing
  and gets the pointer to `/mode-auto-run --mode-auto-run-off` (`mode-flag-bare`, final review m9).
  `guard-stop-contract.js`
  then answers - under a stamp naming THIS session only, never a hand-written one (audit HK02: it answered a second
  session's asks) - each `AskUserQuestion` whose every question marks ONE `(Recommended)` option - `allow` with the questions
  echoed and an `answers` map in `updatedInput` (code.claude.com/docs/en/hooks, 'Tools that require user interaction'), a
  real answer the commit gate's `answered:` reads - taking the next option when the marked one is the fresh-session
  hand-off, and leaving to the user an ask with an unmarked question or a recommended OUTWARD act (`AUTO_OUTWARD_RE`:
  push, merge, deploy, publish, release, ship, a PR, an issue or ticket filed, post, send, upload, a remote branch or tag
  deleted, a hard reset, a database dropped, rotate, revoke, pay - audit HK01: an auto-answered 'Open the PR' was push
  consent to the commit gate; 2026-10-16, the user's report: 'pay for seats' and the fresh-session cost line 're-sends
  about 401k tokens per message' read as outward and sent an approval ask to the user - over 2,656 recommended questions
  in real transcripts the narrowed pattern drops 91 hits, all of those shapes or a `/purchases/` path, and adds none);
  under a live auto-run stamp of this session (`autoRun`) the new-cycle fresh-option deny and the fresh-session note
  route stand down too, so no deny turns an auto-answered ask into one that waits;
  and it sends a Stop back to the run while the stamp is live for this session AND its run marker stands
  (`auto-continue`, bounded by the Stop chain's `workSince`: held again only after a tool call; counted per marker beside
  the chain marker, `<marker>.auto` keyed `<session>@<marker mtime>`, and the 50th Stop passes with one
  `auto-continue-cap` row - audit HK05: Claude Code's own 8-continuation cap resets on every tool call; a Stop while the
  Stop input's `background_tasks` shows the run's own work out passes with one `auto-wait` row, and so does the
  `auto-fields` hold - audit 2026-10-20 C02: 7 of 7 holds in one session sent back a turn that could only wait, ~3.4M
  across three sessions), until the run's close deletes the marker. Between runs, with the mode on, Stop is not held:
  asks are still answered and the session waits for the next prompt. A message typed mid-run is INPUT to the run
  (`UserPromptSubmit`, `modePrompt`; the user's ruling of 2026-10-15), kept with an `auto-input` row and a note saying so;
  when it asks to stop the run, the model prints the close and deletes the marker, and the mode stays on. Only
  `--mode-auto-run-off` after a command ends the mode: it deletes this session's stamp and the marker, writes an
  `auto-end` row and injects 'auto-run is OFF for this session' ('stop auto-mode' and a bare 'stop' are plain input
  since 2026-10-27). A harness prompt - a task notice, a command's output, a seat's hand-back, `hook-prelude.js`
  `harnessPrompt`, HK14 - is no input. A hand-written stamp (task-solve's, no `session:` line) is never held there. The compaction point is no runtime act: Claude Code reads `autoCompactWindow` at
  session START only (measured 2026-10-14 on 2.1.299: written mid-session it changed nothing, set before the start it
  compacted at 76k of a 100k window), so the installer seeds it per model where the project compacts instead
  (`ALFRED_CODE_AUTO_COMPACT=1`; `settings.js compactWindowSeeds`, `repo-installer.md`). **Compact instead** (the user's
  ruling, 2026-10-14): `ALFRED_CODE_AUTO_COMPACT=1` is `fresh-session.js` `COMPACT_INSTEAD`, which sets `FRESH_OFF`, so
  every offer, ask note and hold below stands down; `guard-fresh-session-start.js` says so once per session at the first
  orchestration run and at an automatic compaction's start (the summary's 'continue' line stands there, no hold), and
  `guard-stop-contract.js` denies an `AskUserQuestion` still carrying a fresh-session option (check 13, once per ask
  text, the fix handed back with the option dropped and its `(Recommended)` mark moved to the first option left).
  **The mode banner** (the user's ruling, 2026-10-15): every typed `task-*`, `capture-*`, `loop-*`, `issue-*` or `mode-*`
  command (the expansion matcher takes each family whole) gets two fixed lines its first reply opens with, said once - the
  expansion fires once per typed command and the lines forbid a repeat: `**Auto-run: ON**` (each ask answered with its
  Recommended option, an outward one or an unmarked one still waiting; on for the session until `--mode-auto-run-off`)
  or `**Auto-run: OFF**` (each ask waits; a refused start says why, and a flag past the leading run is said to count only
  right after the command), then `**Context:**` - auto-run or
  `COMPACT_INSTEAD` compacts (at the seeded `autoCompactWindow` when one is set, else Claude Code's own point), offers off
  compact too, and otherwise the fresh-session refresh past `ctxThreshold()` - with the window and model the engine read,
  no number invented for an unknown window, and an auto-compact window past the model's capacity (a `/model` switch to a
  smaller model) quoted as the capacity it is capped at (code.claude.com/docs/en/model-config, 'Set the auto-compact
  window': 'Claude Code caps it at the model's context window', verified 2026-10-21). It rides AFTER the contract, the compact note or the offer
  (`expansionOut`), so each of those keeps its shape; a seat, the Skill route and nobody at the terminal get none - judged
  without the session's own AUTO stamp, which is the auto-mode the banner reports (`auto-mode.test.js`, 'mode banner').
  The fresh-session arithmetic (trigger per window tier, window lookup, cold floor) lives in one
  engine, `fresh-session.js`, which the stop contract and the fresh-session start hook require from their
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
  `scripts/fixtures/cross-write-corpus.json`, replayed in guard-hooks.test.js). Audit 2026-10-10 C13: a runtime's write
  through a NAME takes every literal the script binds it to (`p = '<file>'` then `open(p, 'w')`, `writeFileSync(f, ...)`,
  `Path(p).write_text`; a verb, open or binding inside a string literal is no write, a `$NAME` the shell expands in a
  double-quoted `-e` or unquoted heredoc takes the latest literal the command assigned it, and `process.argv[N]` /
  `sys.argv[N]` take the word passed to the script - audit 2026-10-20 C31 / C25), and one through a computed path is one `unknown` target spelled `$UNKNOWN_INTERPRETER_WRITE`
  (guards skip it as an unexpanded variable; docs-session counts it as a source write only under a root the command names - audit 2026-10-20 C25, 4f2bfdee: a temp-path script was held twice as a source write); a sed `s` with another
  delimiter (`s#a#b#`, `s|a|b|`) and an address's `a\` / `i\` / `c\` text are scripts, chmod's mode and chown's owner
  are no path, `NAME=( ... )` is an array assignment and never a subshell, and a `git tag` listing (`--contains`,
  `--points-at`, `--merged`, `-l`, `-n`) is a read. It is the ONE home of shell text
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
  Monitor command). The ten guards with a
  `Bash|PowerShell|Monitor` row are wired as ONE hook, `shell-guards.js` (R11; both generators fold the rows,
  `wiringRows`): each guard runs in-process with its own gates and ledger row (its `global.BLOCK_DETAIL` cleared before and after it), every block reason
  reaches the model, a throwing guard fails open alone - except that a PROTECTIVE guard's exit 2 (force-push, rm,
  secret) is answered at once, since the guards run one after another and a later one stalling past the budget would
  drop it (a timed-out `command` hook's output is discarded and, on PreToolUse, the call CONTINUES through the normal
  permission flow with every verdict dropped - code.claude.com/docs/en/hooks, 'Timeouts': 'don't count on a stalled
  hook to act as a gate'; the agent-sdk page's deny-on-timeout is the SDK callback family, not these; 2.1.5 M2 - every
  git call in the docs engine carries a 5s timeout),
  and the protective ones run first (`RUN_ORDER`; the messages keep the manifest's order). The dispatcher's entry
  carries `onFailure: "block"` on both routes (`settings.js` `BLOCK_ON_FAILURE` / `onFailureFor`, read by
  `build-marketplace.js`; audit 2026-10-14 HK07, the user's ruling): on 2.1.295+ a dispatcher that cannot start, exits
  other than 0 / 2, prints invalid output or stalls past its budget blocks the call as an exit 2 would ('Block the action
  when a hook fails'), the price being that a broken install blocks every shell call until fixed - the file dispatcher
  and every other hook keep the default `continue`. An older Claude Code drops the key: its hook entry is a non-strict
  zod object, so the entry parses with the key stripped (the 2.1.100 and 2.1.294 bundles read 2026-10-14; the 2.1.294
  plugin validator says 'Claude Code ignores unrecognized fields at load time'). The copy route backfills the key onto
  an older entry.
  The dispatcher makes six checks of its OWN before any guard (`ownChecks`, audit 2026-10-10 C14 / C25), where the
  stack's non-protective hooks run (`standDown`, `cursorStandDown`): a READ-ONLY SEAT (the payload's `agent_type`, bare or
  `alfred-code:`-prefixed: `*-verifier`, `*-solution-designer`, `*-analyzer`, `integration-reviewer`, `security-auditor`,
  `evidence-gatherer`, `issue-diagnoser-*`) is denied a literal shell write target outside the OS temp dirs and `/dev`
  (`scanShell`'s targets, PowerShell's write cmdlets included) and every git call that moves the index, the tree, a ref or
  a stash (`gitMutates` plus the plumbing; `stash list`, `clean -n`, `apply --check` read) - audit 2026-10-20 A-T1: a
  verifier's `git reset -q` unstaged a user's `git rm`; a target the shell expands at run time passes, and implementers,
  resolvers and the main session are never judged (`readOnlySeatWrite`, one `read-only-seat` block row); under zsh (`$SHELL`) a tool-owned glob
  (`--include=` / `--exclude=` / `--exclude-dir=`, `-name` / `-path` and their `i` forms, a brace list expanded one
  word per alternative) and a bare word opening with `=` (`=====`, a `==` outside `[[ ]]` / `(( ))`) are single-quoted
  and every guard judges the fixed command (`updatedInput`, a guard's own rewrite of it wins; zsh aborts the whole
  command on either - 44 aborted scans in one session); a FOREGROUND `until` / `while` loop that sleeps on Bash, or a
  `tail -f` / `-F` / `--follow`, is blocked, naming `run_in_background` and the Monitor tool (a `while read` loop, a
  background run and `timeout`s that SUM to 120s or less pass - one `timeout 60` per poll in an unbounded loop summed to
  hours, deep hooks review 2026-10-16); an unaddressed `sed -i` `s///` whose pattern matches more than one line of its file gets an
  `additionalContext` note naming the lines; the FIRST `run_in_background: true` Bash call of each actor (the main
  session, or one `agent_id`) gets `BACKGROUND_NOTE` as `additionalContext` - how to watch it: a lone command needs
  nothing, a suite or a condition takes `Monitor`, no whole-log re-read, no bare process-name grep, and the user hears ONE
  start line with its finish time, then nothing until the result or a failure (the 2026-10-17 usage audit: 35 progress
  finals cost ~5.07M in one session, users asked 'still running?' 3 and 2 times in others) - once, through an
  exclusive `alfred-bg-note-<session>-<agent|main>` marker in the hook temp dir (a dir it cannot write stays silent),
  plus a `mode: probe`, `bg-note` row (audit 2026-10-14 RU04: the text left `alfred-quality-gates.md`, 533 chars in
  every session, for the 24.8% of sessions that start a background call; a week of `bg-note` rows against the
  background-call rate is the owed comparison); the first `Monitor` call of each actor gets `MONITOR_NOTE` (one start
  line, never a reply per sample) under its own marker and a `monitor-note` probe row (audit 2026-10-20 C32: a 30 s
  sample loop woke 12 turns, 2.82M, and the Bash note never reached a Monitor start); and a recursive grep for a code identifier (CamelCase, a call) in the
  main session writes one `mode: probe` row. Each writes its row under `shell-guards.js`. Each guard body is compiled
  through V8's code cache (`compileGuard`: `alfred-v8-<guard>-<sha16>.bin` in the temp dir, keyed on the source and the
  Node version, written once after the guard ran; the helpers it requires take Node's own `enableCompileCache`) - p50
  58.9 to 48.6 ms per shell call (deep hooks review 2026-10-16); any cache failure is a plain compile.
  A dispatcher run past 1,000ms, timed from its own process start, writes one `mode: probe`, `kind: slow` row with each
  guard's ms, its own checks' and the boot's (`slowProbe`, audit 2026-10-14 HK15: 86 runs of 1s or more in a week, max
  12,086ms, and no row named the guard) - read a week of them before any guard's budget is tuned.
  The seven guards with a file-tool row ride ONE hook the same way, `file-guards.js` (2.1.5 M3: a Read or a Write paid
  three node processes): the read guard, the secret guard, the post-compaction hold, the config and cross-project guards,
  docs-session and preferences-session, each
  run only for the tools its own manifest row names (its `GUARDS` table, held to the manifest by a test), the secret
  guard run first and its exit 2 answered at once; instrumentation stays its own `.*` row. Both still launch in shell form (below).
  Every guard appends one row per BLOCK to `<data root>/statistics/hook-blocks/<session>.jsonl`
  (`analyze-usage.js --hook-blocks` tallies it, split main session / seat by the row's `agent`, joined to its call by
  `tool_use_id`) - the block RATE is what says a gate earns its keep.
  THE STOP CHAIN (hooks audit 2026-10-08 S1): three hooks can block a `Stop` - the stop contract,
  docs-session and the turn build check (answer length did until 2026-10-20) - and `stop_hook_active` is true after ANY of them blocked ('true when Claude
  Code is already continuing as a result of a stop hook', code.claude.com/docs/en/hooks), so a hook that stood down on
  the flag alone never judged the close rewritten after a sibling's block. Each marks its own block (`hook-prelude.js`
  `markStopHeld`, a file under `ALFRED_CODE_HOOK_LOG_DIR` or the temp dir) and stands down on a continuation only when
  IT held this cycle (`stopHeldThisCycle`); a Stop with the flag false opens a new cycle and clears the marker. So
  every blocker judges each rewritten close and blocks at most ONCE per cycle - at most three continuations, in no fixed
  order (the three run in parallel), with
  Claude Code's 8-consecutive-continuation cap the outer guard - and an unwritable marker dir stands a continuation
  down, the old reading. The stop contract's per-turn probes skip a continuation (the same turn), and its SubagentStop
  hold keeps the plain flag beside its own once-marker (`guard-hooks.test.js`: never held again, marker or not). The
  stop contract alone opts into `workSince` (audit 2026-10-11 SD10, 31da645f): a continuation that made a tool call
  after its own block (the marker's ISO stamp) reopens its cycle, so new work's close is judged; a bare rewrite stays held.
  STDIO BLOCKS (2026-10-10): Node writes a pipe async on macOS and `process.exit()` drops what the pipe has not taken,
  so a decision past 64KB (8KB on Node 22.16) reached the harness cut off - the secret guard's rewrite of a 100KB
  command arrived unparseable and the call ran raw. Loading `hook-prelude.js` makes stdout and stderr blocking
  (`blockingStdio`, libuv's `setBlocking`); every other entry that writes and exits calls it in its main block, the
  self-contained ones through a pinned inline copy (`blocking-stdio` in `meta/shared-rules.json`), and a sweep in
  `hook-prelude.test.js` fails an entry that does neither. Launchers under `stack/mcp/` are exempt: they hand stdio to a server.
  GIT FROM A HOOK (audit 2026-10-20 H2): a hook runs before the permission prompt, often in a repository the model only
  named, and the read, rm and commit guards ran that repository's own `core.fsmonitor` program (replayed). Every git a hook
  spawns goes through `hook-prelude.js gitSafe(argv, opts)` - `-c core.fsmonitor=false` and `GIT_OPTIONAL_LOCKS=0` - or,
  in the engines copied without the prelude (`docs.js`, `history.js`, `memory.js`) and `check-turn-build.js` /
  `shell-writes.js`, spells the same two inline; the rm, force-push and commit guards keep an inline twin for a missing
  prelude, and a sweep in `hook-prelude.test.js` fails a git spawn that does neither. Known ceiling: a repository-local
  `filter.*.clean` still runs inside a status refresh (the secret guard's probe alone checks for one).
  STATE HYGIENE (audit 2026-10-08 S9): a hook that writes per-session state sweeps its own prefix's files untouched for 7
  days, inside 50ms, at most once a day per dir and prefix (`hook-prelude.js` `sweepStale`, the docs-session sweep's pattern; a
  `.alfred-sweep-<prefix>` stamp gates it, since listing a 52,840-entry temp dir twice cost 78ms of every Stop) - the stop
  contract at each Stop (`guard-stop-*`, the `alfred-stop-held-*` chain markers, and its log capped to the newest 256KB
  past 1MB, `capLog`), the fresh-session hook when it writes an offer (`guard-fresh-*`), the read guard when it logs a
  range (`guard-read-*`) and the commit guard when it writes its
  trivial ledger (`<data root>/state/sessions/trivial-*`).
  A denial that needs the user's decision ends in ONE AskUserQuestion, and an 'allow' answer is
  honoured through a `<data root>/state/approvals/*-ALLOW` receipt (this session's own, under 8h).
  - `guard-protected-force-push.js` - blocks force-push to protected branches. It reads the command through
    `shell-writes.js`'s `gitText` (below), so a push counts past a wrapper (`timeout 60`, `env A=1`, `nohup`), in an
    `if` / `for` body, `bash -c '...'`, a heredoc or here-string into a shell, `eval`, a script file and a git alias
    (`alias.pf = push --force`), each from the directory a leading `cd` moved it to; a computed name (`bash -c "$(...)"`,
    `source <(...)`, a loop variable) is out of model (2.1.6 seam review M3). It loads `shell-writes.js` inside a try and
    passes the call when the file is absent (the parity test's copy set), as the rm and commit guards do. An option's
    value is never a refspec (`-o ci.skip`, `--repo x`), a `-d` inside a short cluster deletes (`-ud`), and a wildcard
    destination forced or under `--prune` is the `--all` case (audit 2026-10-08). The remote's DEFAULT branch is protected
    beside main / master / develop - read from `refs/remotes/<remote>/HEAD` (clone or `git remote set-head` sets it; no
    network), and only for a force or a delete, so an ordinary push spawns no git; no recorded remote HEAD, no default. The
    denial says the push is the user's to run themselves, the exact command handed over, never a route around (audit
    2026-10-20, the hooks track's minor list).
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
    by what they destroy; one block names every loss. A `merge` / `rebase` / `cherry-pick` / `revert` / `am --abort`
    earlier in the command, of an operation in progress in that repo, takes that operation's rows (staged-only or
    unmerged) out of a later discard's loss - its abort drops them first (audit 2026-10-10 C17, session 349e4825: 37
    merge rows blocked an approved abort-and-reset); a row the work tree also changes is still judged. PowerShell `Remove-Item -Recurse`
    counts, and so does `cmd /c rd /s` (`cmd /c` and Git Bash's `//c` read as a wrapper, `/s` as recursion). A target is
    read as the shell expands it where that is fixed - `${HOME:?}` / `${HOME:-x}` is `$HOME`, `$(pwd)` is `$PWD` - and a
    literal path is resolved and compared with the home directory, the project root and the cwd, or any folder holding the
    first two (audit 2026-10-20 H6: each spelling passed). A `claude plugin marketplace remove|rm` with no `--scope` - the binary by its path or inside `bash -c` too -
    is denied (2.1.7): the CLI then removes the
    declaration from every scope and uninstalls every plugin installed from it, in every project. A SQL `DROP` or `dotnet ef database drop` writes a log-only probe row. A 'discard it' answer
    is honoured via `<data root>/state/approvals/DISCARD-ALLOW` (paths, `stash@{N}`, or `*`).
  - `guard-read-whole-file.js` (PreToolUse `Read` + the shell route) - blocks whole-file dumps (also through the
    shell, any oversized file, a sweep over `.md` files). THRESHOLD is 400 lines, and the range cap and every shell span
    rule bind only above it (200 before the deep hooks review 2026-10-16, the user's ruling: 485 of 590 sized blocks in
    two weeks hit 200-400-line files, and after a block the model read about 80% of the file anyway, one request later). A shell loop is a sweep only when a `cat` in its body
    reads the loop VARIABLE and a gated extension names what it walks, judged with quoted spans blanked (I4: a
    `cat` inside an `echo "..."` payload was denied). An unexpanded `$VAR` target is not judged; a `cat` glob
    operand is sized by what it expands to (segment by segment, at most 2,000 entries) and passes while its files
    together stay within THRESHOLD lines and BIG_BYTES, and a loop, `find -exec cat` or `xargs cat` whose next stage is
    `wc` is a count (audit 2026-10-20 C28: a two-file glob and a `| wc -l` were denied as sweeps); a
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
    Audit 2026-10-10 C11: a row counts only for its own actor (the main session, or a seat by `agent_id`) and file
    version (mtime and line count); the cap does not bind `code-quality-analyzer` (bare or `alfred-code:`, by the payload's
    `agent_type` beside an `agent_id` - audit 2026-10-14 HK16, the user's ruling: its 85 runs made 143 of a week's 277
    range-cap blocks, the verifiers 9), whose size and sweep gates still do; the shell's literal spans (`sed -n a,bp`, `head`, `tail`, `awk 'NR>=a && NR<=b'`)
    printed to the terminal are rows on the same log; a file the working tree ADDS completes past the cap, and a
    changed one's denial names `git diff HEAD -- <file>`; an inverted grep (`grep -v`, or a pipe into one) prints the
    file minus its matches and is judged like `cat`; a loop whose `cat` reads its variable over literal paths or a
    one-folder glob is sized per file (no sweep while all of them print at most THRESHOLD lines and BIG_BYTES); a
    relative target with no file at any anchor prints nothing unless a `cd` the guard cannot follow came first; a
    `.md` under the docs root's `work/plans/` (or the pre-2.8.0 `plans/`) reads whole, and so does one under `<data root>/state/sessions/scorer/` - the output scorer's draft, the grader's mandated input (`guard-read-write.test.js`); a markup template's denial names `grep -n`, never the symbol
    overview; and the convention-rule notice reads no `>` inside quotes and no write target outside the project. Audit
    2026-10-20 H7: a `find <dirs> -name <one literal name> -exec cat` (or `| xargs cat`) is a sweep of whatever files that
    name matches - a bounded walk from the find's start points (`NAMED_FIND_CAP`, 20,000 entries) sizes each match, and
    one over THRESHOLD lines (a gated extension) or BIG_BYTES (any other) blocks as `named-find-dump`; a name with a glob
    character stays the sweep rule's.
    Every denial on a source file names the navigation line of the session-start tool order and the LSP
    `documentSymbol` / `goToDefinition` / `findReferences` calls (a size denial on another extension and a tree it
    never indexes name grep instead - a file outside `CLAUDE_PROJECT_DIR` among them, and a range-cap denial states how many
    of the file's lines the cap still leaves; audit 2026-10-11 SD16, 5984019e). Its convention-rule announcement
    names only a rule in the project's own `.claude/rules` - a plugin-launched hook's sibling `rules/` is
    the whole catalog (it named `winforms-conventions.md` to a project without it, the 2026-09-26 pilot); with no rules
    directory anywhere it cannot tell and names the rule (a recorded choice, pinned in `guard-read-write.test.js`); a
    target is resolved where the shell stands after a `cd` (`cd /tmp && cat > x.ts` names no rule - audit 2026-10-10).
  - `guard-secret-value.js` (PreToolUse `Read` + `Grep` + the shell route + a Playwright server's `browser_file_upload` under any
    registration name (N6), whose
    `tool_input.paths` each take the Read judgement - a page asking for an upload got any workspace file, audit 2026-10-14
    PL3) - credentials are read for PRESENCE, never
    value. A leading `NAME=value` word and every `$(...)` / backtick body are judged as commands of their own, quote-
    and nesting-aware (audit 2026-10-20 C17: the source protocol's own `MARK="...$(printf ... | ...)"` read as a
    changing step); a count or a facts-only print (a length, a boolean, a type, a label) runs as written, never one routed
    to stderr, a throw or an assert; a store name built from literals the same command assigned is masked or refused like
    the spelled name (a concatenated name was used to dodge a refusal). Judged by file CONTENT (a JSON, dotenv, INI - `~/.aws/credentials`, `~/.pypirc`, a `[section]` file,
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
    Read tool and a credential literal stay blocked - but a FETCH of a short-lived link passes the literal check (the
    user's ruling 2026-10-14, after a Jira image download's `?token=<JWT>` was refused in every session): a token in a
    link's query whose link states an hour or less (`hook-prelude.js` `shortLivedLinks` - a JWT's `exp`, and `exp - iat`
    when it has one; S3's `X-Amz-Expires` beside an `AKIA`/`ASIA` credential and a signature), when every step naming it
    is a fetch (curl, wget, xh, httpie, `Invoke-WebRequest` / `-RestMethod`) whose first URL carries it and no other shape
    is left once it is blanked (`withoutShortLived`). A header, a lifeless or longer token, a write, an assignment and a
    post to another host keep the block; each pass writes one `short-lived-link` probe row (host, seconds, kind, key -
    never the token). The JWT is decoded, never verified: a forged short `exp` buys a forger nothing. The comparison verbs (`diff`, `sdiff`, `cmp`, `comm`, `rev`)
    are judged like `cat` (I2). A git command that prints file content (`git diff`, `git show`, `git log -p`,
    `git stash show -p`) is PROBED - the same read run as argv, no shell, 3s / 8MB, external diff, textconv, signature
    checks and fsmonitor off (`hook-prelude.js gitSafe`), at most four probes per call - and only when its output would carry a credential, or it cannot be probed (a word the shell
    expands, `-c` config, `--output`, an option that RUNS a program - grep's `-O` pager in any cluster or abbreviation,
    `--ext-diff`, `--textconv`, `--show-signature`, `--submodule=diff`; audit 2026-10-20 H1, BLOCKER: the probe runs
    before the permission prompt, and `git grep -O'touch X' key` created X), a `cd` the guard cannot follow or a changing step before it (the probe runs before
    the command, so `git add -N . && git diff HEAD` would read the tree without the new file), a failed run, a fifth probe, a
    repository-local `filter.*` config that a working-tree diff would run; audit 2026-10-08). A `cd` / `pushd` to ONE
    inert word naming a directory that exists is followed, and the probe runs there (`literalCdTarget`; deep hooks review
    2026-10-16: every `cd`, the project root's own included, piped about two thirds of 3,957 stages unprobed - a replay of
    9,991 real commands rewrote 399 fewer, each `cd` resolving where a real shell lands); a subshell or group no longer
    hides the dump or the walk (`(cd sub && git diff)`, `(git diff)` and `(grep -rn KEY .)` each printed a credential raw;
    the temp-project matrix found the last two), the pipe going inside the group. Such a call
    gets `| node <guard> --redact-stdin` where
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
    (audit 2026-10-08, replayed) - and is piped unprobed, as is a walk naming a program-running option (`--pre`, `--hostname-bin`,
    ugrep's `--filter`, `--pager`, `--view`, `-Q`, a config file; audit 2026-10-20 H1). Audit 2026-10-10 (C12): a word's inner quotes count
    (`--include='*.cs'` is probed), `l` / `c` / `q` anywhere in a flag cluster prints no line, the `--grep` pipe exits 1 on
    empty input (grep's status), a walk rewrite's row says `walk-stage`, and a pattern naming password / secret / token /
    api key adds `--literals` (every quoted literal on a matched line masked but an email, a path or a dotted name). A
    runtime's code is no shell: a string in it, or any word of a heredoc body, is globbed only when the code calls a glob
    (`/**` in a JSDoc named a credential file 7 times), and `/**` globs `/`. `T=$(<reader>)` whose `$T` only reaches
    another command's arguments (no print verb, runtime, `curl -v` or `set -x`) prints nothing; a grep over a credential
    file and others searches each credential file through its own view and the others as written (`-H --label`), a
    missing operand keeping grep's own error and a directory or an unexpandable operand named on stderr as not searched.
    Audit 2026-10-11 SD01 (`grepArgs`): a narrowed filter never carries a recursion option, and every walk spelling -
    `-rC2`, `-d recurse`, ugrep's `-NUM` / `--depth`, and a directory operand with no `-r`, which ugrep (the Bash tool's
    `grep` on every OS) walks - is probed with `-r` (a kept `-rn` walked the cwd and printed the credential raw); `git grep`
    is probed like the other git reads; a sibling step that names the file but prints none of it (`git ls-files`,
    `check-ignore`, a non-patch `git log`, a count, an `echo`) no longer forces the whole-command rewrite; a heredoc-written
    file is code only as the runtime's SCRIPT operand or with a code extension, never as a data argument, and the
    dropped-steps note lists no body lines (sessions ae38c08f, 5f9fec85); a loop's `cat "$f"` becomes `--redacted "$f"` with the
    loop and every other step kept; `--presence` prints `KEY=empty (present, no value)` for `''` / `null`. `git remote -v` / `get-url` / `show` and
    `git config --list` / `--get` are probed the same way (a tokened URL is masked; a config write is never probed). A git
    dump in a loop or branch body (`do`, `then`, `else`, a group) or run by `xargs` over a listing takes the same pipe where
    it stands - the xargs-fed one unprobed, a condition (`if`, `while`) left as written (audit 2026-10-11, session 42951e5b:
    the per-file `git diff --no-index -- /dev/null <file>` review read ran unmasked in a `while read` loop and behind xargs). A print
    piped into a login that reads stdin (`--password-stdin`, `--with-token`) is a use, `${NAME:+word}` prints no value, a
    `{...process.env}` spread is no dump, and a command whose stdout IS a token (`gh auth token`, `op read`, a keychain `-w`)
    is a print when it ends the pipeline. PowerShell's own prints are judged too (audit 2026-10-20 H8): the env: drive through
    Get-Content and its aliases (`gc env:X`, `type env:X`), an expandable string statement around a reference
    (`"token: $env:X"`), cmd's `set` on either shell (`cmd /c set`, the masked listing) and .NET's file reads
    (`[IO.File]::ReadAllText('.env')`, the redacted view). An environment dump is replaced
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
    private key count as credentials whatever the key. The guard's path through a variable is its own read when the
    command binds it - a literal, or a `$(...)` whose every stage is ls / find / head / tail / sort naming
    `guard-secret-value.js` (audit 2026-10-20, the hooks track's minor list: `G=$(ls -d ~/.claude/plugins/cache/*/alfred-code/*/stack/hooks/guard-secret-value.js | tail -1); node "$G" --presence .env` was refused as an opaque script);
    an unbound `$G` or any other binding stays one. `--presence <file> [KEY ...]` is the sanctioned
    one-key read (a KEY spelled `A.B.C`, `A:B:C` or `A__B__C` reads a nested JSON key; with no KEY it lists at
    most 200 string leaves plus a count, a credential-shaped key name masked); the guard ships only
    in the plugin, so every denial and view names it by its absolute path. 'Show' is honoured through the `<data root>/state/approvals/SECRET-READ-ALLOW` receipt - where the call names its session, only with a `session: <id>` line naming it, the stop contract's rotation read included (audit 2026-10-08: time alone opened it to a second session on the project). The
    name rule is what catches a credential a `$(...)` COMPUTES (`gh auth token`, a keychain or vault read),
    so a stack snippet never assigns a credential-shaped name (the source-protocol snippet's marketplace key
    is `MKT`; as `KEY` it was blocked twice in pilot 2). A rewrite is no block but is counted: one `mode: rewrite` row
    (tool, branch - `file`, `env`, `env-stage`, `git-stage`, `walk-stage`, `variable` - and a file's basename, never the value), which
    the block rate skips like the probe rows (2.1.5 M17). The row carries the payload's `permissionMode` when it has one
    (audit 2026-10-10 C09: an auto-mode classifier gave one rewritten call no verdict and stalled it 80s, 1 of 89
    rewrites in that session) - the rate a denial-in-auto would be decided on; the dispatcher's `zsh-quote` row does too.
    THE PROJECT'S SENSITIVE DATA (the user's ruling of 2026-10-13: per project, model-blind): `<data root>/.secrets`
    (`.sensitive-data` before item 3, 2026-10-25: both names read for 2.x, `.secrets` first; a `.secrets` is the store only
    where its path, as written or real, ends in `<data root>/.secrets`, so a project's own one elsewhere - nektos/act's
    default `--secret-file` - is neither masked by name nor refused by mention, `isDataRootSecrets`; both names and the data root
    in any letter case, since a case-insensitive disk opens `.ALFRED/.SECRETS` too - final review 2026-10-25 C2), a dotenv the user fills by hand, in the checkout the call runs in, else its main worktree (`sensitiveFile`, memory.js
    `projectRootOf`; the root from `ALFRED_CODE_DATA_PATH`, relative and `..`-free, else `.alfred`). Its kind is `sensitive` by
    NAME: every value is a credential whatever its key (`DB_HOST` too), so a Read and a Grep of its content block and a dump
    becomes the redacted view with every value masked; the stream masker reads a line out of it - a walk's `<path>/.secrets:N:` (either name)
    prefix, `git grep`'s, a diff header naming it - by the same rule, a line that is no `KEY=value` pair masked whole (audit
    2026-10-20 H3: a walk through the store and a diff of a tracked store printed every value raw), so the probe finds it
    and the stage is piped. A shell command NAMING it is refused unless it only looks
    (`test`, `[`, `ls`, `stat`, `wc`, the PowerShell `Test-Path` / `Get-Item` / `Get-ChildItem`; and since the 2026-10-17 usage
    audit, as the LAST stage of its pipe only - a name printed into `| xargs cat` is a read - git's `check-ignore` / `check-attr`
    / `ls-files` / `status`, a count-only, quiet or list grep or another `isReducer` stage, an `echo` / `printf` naming it with
    no substitution and no redirect onto it, and a data heredoc's body, which is text the command writes) or runs the guard itself -
    a `source`, a `cp`, a `git add` or an `rm` would carry the values somewhere the chat can read (`refuseSensitiveMention`,
    probed: `source` then `echo` and a `cp` then `cat` both leaked before it) - named also as the shell would spell it
    (audit 2026-10-14 HK11: `source .alfred/.sens*`, `git add -f .alfred/.sens*`, `--env-file`, `tar cf - .alfred | tar xOf -`
    passed): quoted spans joined, each operand of the steps the shell runs resolved through the dump judge's own resolver
    (globs, braces, list variables, a `cd`) to its real path - the store itself, or on an archive / `git add` / recursive copy
    verb a folder holding it directly - at EVERY anchor the operand exists at (2.8.0: the project dir's own `.alfred`, listed
    before the cwd, hid a nested cwd's store from `tar cf - .alfred`). A verb that takes a TREE whole - an archive being created, a recursive copy's source
    (not its destination), a forced `git add` - is refused on any folder above the store too, unless the command excludes
    the store or a folder on its way (`--exclude`, zip's `-x`, matched as globs); a tar or 7z extract and a copy into the
    project pass (deep hooks review 2026-10-16, the user's ruling: `cp -R . x` and `rsync -a ./ x` copied it and passed).
    Final review 2026-10-25 C1: the name also counts as TEXT, between any two non-name characters - `.sensitive-data`
    anywhere, `.secrets` behind its data root (`"$(pwd)/.alfred/.secrets"`, `$R/...`, a script's `open('<path>', 'r')`, which
    no resolver follows) or bare in a pipe whose stages name the data root (`ls -a .alfred | grep .secrets | xargs ...`) -
    and a `find` handing what it finds to a reader (an `-exec` / `-ok` action, a pipe on, a `$(...)` around it) is refused
    when its walk reaches the store and a `-name` / `-path` test matches the store's name, or, from the data root itself,
    no name test narrows it; a `-maxdepth` short of the store passes. The same day the dump half took `$(pwd)` / a backtick
    `pwd` as `$PWD` and `$(git rev-parse --show-toplevel)` as the work tree above it (a walk up to `.git`, no git spawned), so
    `cat "$(pwd)/.env"` is the file it names and a print of the store through either prefix is masked like the literal
    path's; any other substitution (`$(whoami)/.env`) still leaves the token unjudged.
    The run that USES the values:
    `node <guard> --with-sensitive -- "<command line>"` puts them in that command's environment (the file wins over an
    inherited value - the run asked for the project's) and prints each value of 4+ characters as `<KEY>` in its stdout and
    stderr, line-buffered - its EXACT text only: an encoded, split or reversed print is not caught, so it is leak protection
    against accidents, never a wall against a deliberate read (the session-start line says so and forbids the transform); the exit code is the command's. SessionStart (its own manifest row, silent with no store, an
    empty or an unparseable one) says the KEYS and that command line, plus a warning when `git check-ignore` exits 1 (not
    ignored, or tracked). No server gets a value: the stack ships none since 2.10.1 (the browser and mobile launchers that read the store
    left with them); the installer reads the store through `data-root.js` (the old credentials' clash check) and the guard
    through its own parser, `guard-sensitive-data.test.js` holding both to one fixture.
  - `guard-unapproved-dispatch.js` (PreToolUse `Task|Agent|SendMessage`, `SubagentStart`, `SubagentStop`) - blocks an `*-implementer` dispatch (bare or
    `alfred-code:`-prefixed; a foreign plugin's is not the flow's seat) without its plan's gate file (written on explicit approval or an AUTO waiver) -
    PER PLAN since 2.8.0 (spec Part 4, the user's ruling of 2026-10-20: two sessions on two plans shared one stamp): the brief
    names its plan on a `plan: <plan id>` line (`layout.js planIdOf`: a path or `.md` name reduced to its basename, an
    invalid id denied as `implementer-bad-plan-id`), and only `<data root>/state/approvals/<plan id>/APPROVAL`
    (`approvalPath`) passes it, or a live root `AUTO` (auto-mode's, a solve flow's typed waiver); a root `APPROVED` passes
    only a brief with no `plan:` line - a pre-2.8.0 skill copy's, for the 2.x line. The generic rule, the timeout-write
    deny, `history.js stamps` and the compaction state read every plan stamp (`approvalStamps`), listed as `<plan id>/APPROVAL`;
    blocks a generic `general-purpose`/`claude` dispatch while that stamp is live (stamps older than 8h
    or the session are absent), and blocks an `Explore`/generic dispatch asking a SYMBOL question ('reference to' /
    'usages of' count only before a code identifier - backticked, CamelCase, `name(`, `A.B` / `A::B` - never a
    kebab-case or file-shaped token, and 'where is X defined' / 'what type' need one too: I5, a text sweep for a skill name was the week's one block;
    so do the caller and definition shapes - 'who calls', 'call sites of', 'definition of', 'implementations of',
    'subclasses of', 'find the class' - which also take a backticked or capitalised name, a lowercase word being prose;
    audit 2026-10-08). An
    `Explore` / `Plan` brief gets the untrusted-content sentence appended (`updatedInput`, never a deny). The APPROVAL
    root is `CLAUDE_PROJECT_DIR`, else the payload's `cwd`, as its ledger reads it, and every block row names its branch
    (`symbol-question`, `diagnoser-pin`, `implementer-unapproved` / `-stale-stamp` / `-ask-timed-out`,
    `generic-while-stamped`). Audit 2026-10-20 H5: a live stamp naming THIS session whose `skill:` dispatches generic seats
    by design (`GENERIC_DISPATCH_SKILLS`: `capture-usage-report`, whose bundle authors are generic seats on a named model)
    passes a generic dispatch; another session's or a hand-written stamp naming no session is no exemption, and the
    generic denial ends in one AskUserQuestion and says never to delete or edit the stamp (one session ran `rm .../APPROVAL`
    on the old 'clear the stamp file' escape). Ruling S1 (2026-10-20): the implementer denial names a no-stops run as the
    user's `--mode-auto-run-on` right after the command; a hand-written AUTO waiver belongs to task-solve and task-solve-cross
    alone. Ruling S3: an implementer dispatch on an APPROVED or AUTO stamp written after an ask the idle timeout closed
    (the answer hook's marker, under the hook temp dir) is denied once - 'the question timed out - re-ask' - and the
    marker is spent; a stamp older than the timeout stands.
    Its `no-execution-verdict` probe (audit 2026-10-10) was dropped in the deep hooks review 2026-10-16: 85 rows nobody
    read, and an 8MB transcript read on every main-session Agent call (+23ms on a 226MB transcript).
    A diagnoser CALLER (the payload's `agent_type`, bare or house-prefixed) dispatches only `evidence-gatherer` -
    a subagent's `Agent(<type>)` list is ignored, so the grant alone let it start a writing seat (2.1.5 M48).
    In a repo never set up only an `alfred-code:`-spelled implementer target is judged - the diagnoser pin,
    then the implementer gate - and no block row is written (M9, `standDown(..., { setUp: false })`).
    THE AGENT CAP (`ALFRED_CODE_MAXIMUM_RUN_AGENTS`, the user's task of 2026-10-27; the maximum-run-agents design): how many
    of a session's agents may run at once - default 5, `0` no cap, at most 50, anything not a whole number read as 5
    (`agent-cap.js capOf`). `agent-cap.js` is a module the three hooks require inside a try (`HOOK_MODULES`, copied on
    the copy route), so a copy without it runs unchanged. A PreToolUse payload carries no list of running agents, so the
    session keeps one in `<data root>/state/sessions/`: `AGENT-CAP-<sid>-P-<tool_use_id>` (a dispatch not started, 60s),
    `-R-<agent_id>` (a started agent, counted while its own `at` or its transcript's mtime is under 12 minutes old; after
    its SubagentStop only when the transcript moved more than 5 s past it - a hold sent it back (a hand-back's own hook rows land up to 3.65 s after it) - and kept 2 minutes so a
    resume finds it; a file a counted one names as `parent` counts too), `.lock` (exclusive create, 20ms retries, 1.5s
    wait, broken past 5s) and `.denied`; ids cleaned to `[A-Za-z0-9_-]`, the `AGENT-CAP-` prefix swept after 7 days.
    The three event branches run first and exit 0 before any dispatch rule (a SubagentStart payload has no
    `subagent_type` and would read as `general-purpose`): SubagentStart takes the oldest pending file of its type and
    tells a seat its number ('Agents at once: <n> (ALFRED_CODE_MAXIMUM_RUN_AGENTS)', nothing at 5), SubagentStop marks
    the file, and a `SendMessage` to a STOPPED seat is judged like a dispatch. A dispatch at or past the cap - a seat's
    own included - is denied with the running count and up to eight types, one `branch: agent-cap` row; the text never
    says how to lift it (the setting is the user's), a seat is told to do the step itself, and a main-session denial
    writes `.denied`. A later rule's exit 2 drops the call's pending file (a second exit wrapper after the shared
    telemetry one). The stop contract's main-session Stop, behind the same `capGates` as the deny, reconciles against
    `background_tasks` right after its sweep (its pendings go; running files matched by id, else the most recent N kept;
    one `agent-cap-reconciled` row) and, after the scorer backstop and never while it is owed, sends the turn back ONCE
    per `.denied` file when the count is under the cap again (`agent-cap-continue`); guard-answer's typed prompt deletes
    `.denied` and its context names the number when it is not 5. Stand-downs, writing nothing: the csv or `:cap` opt-out,
    either hook off, `minimal`, a repo never set up, a Cursor payload, cap `0`, no session id; guard-answer off stops the
    continuation only. A lock not taken passes with one `agent-cap-unjudged` row, a started file that expired with no
    stop writes `agent-cap-expired`. Revisit (14 days of rows): continue rows past 1 in 10 denials, expired rows past 1
    in 10 transcripts, any unjudged row, or a reported stall.
  - `guard-ungated-commit.js` (PreToolUse, the shell route) and the same gate on every MCP server (`^mcp__.*` - the stack's own
    exemption went with its servers, 2026-10-24) - blocks a non-trivial `git commit` without the
    `<data root>/state/approvals/COMMIT-GATE` receipt, and `git push` / `gh pr merge` without `PUSH-GATE`. A dry
    run or a branch level with upstream is never gated; `guard-ungated-commit:push` in `ALFRED_CODE_HOOKS_OFF` turns the push half off
    (`hook-prelude.js partOff`, the env audit of 2026-10-21; the old `ALFRED_CODE_PUSH_GATE=0` is still read for the 2.x
    line and an update folds it in). 'Level' is
    read BEFORE the command runs, so a history mover (commit, merge, cherry-pick, am, rebase, revert, pull, reset) or an
    unreadable git call chained ahead of the push counts as ahead (audit 2026-10-08: `git commit -am x && git push`
    published ungated). So does a push of anything but the current branch, `HEAD` or `@` under its own name (`origin
    feature`, `feature:main`, a tag, a delete) or of a set (`--all`, `--tags`, `--mirror`, `--follow-tags`), and a
    first push's scope reads the commits no remote holds. A PUSH-GATE or COMMIT-GATE written before this session began is
    absent (the transcript's birthtime, the dispatch guard's APPROVAL rule; the commit half since audit 2026-10-20 H4 - a
    WAIVED commit receipt carries no `head:` and opened every session's commits for 2h); a `WAIVED` quote must waive the review in the
    user's own words (skip, without the review, just push - a bare 'commit it' is no waiver, an option label this run
    wrote is no user's words - unless a turn the user TYPED carries the quote, audit 2026-10-10 f24eb967); `head:` is the
    first sha word on its line, and one receipt covers a reviewed BATCH: a `head:` that is an ancestor of HEAD passes
    when no merge landed since it, every commit since it was made after the receipt was written, and those commits plus
    this act take in only the paths `spec:` names (or no more files than its count). A COMMIT receipt carries
    `format: <the formatter check run> - clean over <N> staged files` (or a quoted user waiver on that line; audit
    2026-10-10 C18), and `findings: <the review's Findings field>` (a 'skipped' one only with the user's quoted
    waiver); a `security: ... - over <N> files` count below what the commit takes in refuses, and so does a staged
    file changed more than 2s after the receipt was written (the review never saw it). An `answered:` ask answered
    before every review the transcript shows (a verify Skill call - `review-code` and `review-security` count, the
    built-in reviews no longer since 2026-10-22 - a typed verify command, a verifier or reviewer seat) is no consent to the reviewed commit, and a refused consent quote names the session's latest ask answer.
    A VERIFIED line that names a review (`task-verify-code`, a quality loop, `review-code`, `review-security`) needs a
    run of EACH one it names in this session - the model's Skill call or the user's typed command - both sides read by
    kind (`reviewKind`: every rename kept the words that say what the review checks, so an old spelling is read from its
    words, never a copied list of old names, which only the renamed map may hold; guard-commit-gate.test.js runs each of
    the map's review rows through the gate) - unless the receipt says `carried:`. Any skill load once passed for it, so a
    receipt could claim a review that never ran (2026-10-22). A COMMIT line that names no review of the code (none, or
    only the plan review) needs one in the session all the same - a review skill by either route, or a verifier /
    reviewer seat (`codeReviewRan`) - unless the receipt says `carried:`; a PUSH line names what is published and is not
    judged (a side agent's note and the user's ruling 'Need any review run', 2026-10-22: `VERIFIED the checkpoint` passed
    with no review at all).
    The newest review of the code must also have STARTED after the last change to every file the commit takes in (2s
    slack, the receipt check's): its time is the transcript row's `timestamp` (`lastCodeReviewMs`; a plan review never
    counts), and a file whose mtime is later is named, `review-code` on it asked for (`editedAfterReview`). A file gone
    from the tree whose index still stages a version of its own is late whatever the times say (that version is
    committed; a staged removal commits no content and is skipped). A review with no time on record judges nothing;
    `carried:` skips it. A second side note and the user's ruling 'After the last edit', 2026-10-22: one review early in a
    long session covered every later commit. A quality loop passes because its verifier seats return after its fixes.
    A file's time moves when its code does not too, so a review of the code that STARTS - the model's review skill or a
    verifier / reviewer seat (`guard-fresh-session-start.js` on PreToolUse `Skill` / `Agent`, before its early exits) or
    the typed command (its UserPromptExpansion) - writes `<data root>/state/sessions/review-snapshot-<sid>@<call>.json`:
    the sha1 of each file `git diff HEAD` and the untracked list hold (newest 8 reviews, 2000 files, 4MB a file, 64MB read
    in all, swept after 7 days; `hook-prelude.js snapshotReview`), and a late file whose bytes match passes
    (`heldByReview`) - a stash and pop, a branch round-trip. A file past 4MB, past the first 2000 or past the 64MB total is
    not recorded, so its time alone decides: the stricter rule, never a pass - and the total keeps the hashing inside the
    hook's 10s timeout. One file per call (the review of 2026-10-23): two seats dispatched in one message start two hooks
    at once, and one shared file each read, extended and renamed kept only the last one's snapshot. A third side note and
    the user's ruling 'Snapshot at review', 2026-10-22. The review words (`bareSkill`, `reviewKind`, `REVIEW_SKILL`,
    `REVIEW_SEAT`, `codeReviewCall`) moved to the prelude for both hooks; the commit guard loads them inside a try, and
    without them (a prelude older than the hook) it sees no review - every check that needs one refuses, a carried review
    or the user's waiver still passes - where an unguarded load threw and the dispatcher passed every commit (2026-10-23).
    SPACING IS A CHANGE in every format. A fourth side note and the user's ruling 'Exact for those types', 2026-10-22,
    took Python, YAML and a Makefile out of both spacing exemptions (a line moved out of an `if`, a YAML key one level
    up); the user's 'Fix ALL left gaps' the same day removed both everywhere, since spacing inside a string and `rm -rf /
    tmp` for `/tmp` are code too: a whitespace-only commit needs a review like any other (git's `-w` proof and
    `whitespaceOnly` are gone), and the snapshot holds one hash, the bytes (its whitespace-blind hash and
    `WHITESPACE_MEANS` are gone). The cost: a formatter-only commit runs `review-code` first, cheap on a spacing diff.
    A review CALL another hook refused is no review (a fifth side note, 2026-10-22: the fresh-session gate refused
    review-code late in a session and the refused call passed): the transcript scan defers each Skill / seat call to its
    end and drops one whose `tool_result` carries `is_error: true` (a hook's denial, an unknown skill) - for the named
    review, the no-name rule and the freshness time alike - and the snapshot the call took (its `id`).
    A review covers only what it was pointed at (a sixth side note; the user's ruling 'Match path targets', 2026-10-22: a
    `review-code` of one file cleared five). `review-code` and `review-security` read their target from the call's `args`,
    the typed `<command-args>` or the expansion's `command_args` (`hook-prelude.js reviewTargets`: each word naming an
    existing file or folder, realpath'd from the row's `cwd`; words naming none - a branch, a PR - cover none of the
    uncommitted change); no target word, `task-verify-code` and a loop cover the whole change. A SEAT covers what its
    brief names (`briefTargets`; 'Fix ALL left gaps': a seat cleared every file): a `git diff` with no range, no second
    revision, no `--no-index` and no pathspec covers the whole change; else each path-shaped word that exists (a `:line`
    suffix dropped); else nothing - the house verifier briefs (review-code's and review-security's seat dispatch) name
    their read commands. Each committed file is judged by the newest timed review covering it (`reviewCovers`,
    `timedCodeReviews`), one no review covered is refused as such, and a pointed review's snapshot holds only its targets.
    A review SEAT counts only once it reported (a seventh side note; the user's ruling 'Seats must finish', 2026-10-22:
    a seat still running, or sent to the background, counted from its dispatch): a foreground seat at its own
    `tool_result`, a background one - whose result is the launch notice, `toolUseResult.status: async_launched` - at its
    `<task-notification>` naming its `<tool-use-id>` with `<status>completed</status>`; until then its time and the
    snapshot its dispatch took count for nothing.
    A review SKILL counts only once its RESULT LINE followed it ('Fix ALL left gaps': its result only ever says it
    launched): `Findings:` for `review-code`, `review-security`, `task-verify-code` and `task-verify-plan`, `Outcome:` for a
    loop (`hook-prelude.js REVIEW_PROOF` / `reviewProof`; bold, a list marker, a table cell and ` - ` after the word count),
    in the model's own text or in the report of a seat dispatched after the call (review-code and review-security hand a
    large change to one). Each line closes the NEWEST open review when it is that review's kind and nothing otherwise, so
    a review left unfinished stays open under a later one; a refused call takes none. The typed command is held the same
    way, and the snapshot its expansion took (no call id) counts beside a typed review that counted, started within two
    minutes of it. review-security's Report carries the line since this ruling, and loop-test-coverage-quality names its
    `**Outcome**` field. The model can write the line without the review: the rule catches an abandoned or interrupted
    review, not a forged one.
    THE TOOL-USAGE LEDGER IS NO EVIDENCE ('Fix ALL left gaps'): its row is written at PreToolUse and keeps no target, no
    result and no refusal, so a review the newest 64MB of the transcript does not hold is a review to run again.
    The snapshot reads the work tree, while a plain commit takes the index: a late file whose index stages a version of
    its own passes only when a review saw BOTH (`versionsCommitted`, `stagedBlob` - `git diff --cached --quiet`, then `git
    cat-file blob :0:<path>`), so staging an unreviewed version and putting the reviewed text back in the tree is refused
    (found in the close of the rulings above, 2026-10-22; the user's 'Fix that gap'). Conservative for `-a`, which takes
    the tree alone.
    The consent lists read ENGLISH ONLY (deep hooks review 2026-10-16, the user's ruling): a quote holding any letter
    outside ASCII is no consent (`foreignQuote` - the Ukrainian lists it replaced read 'committed it, don't push' as
    consent), and the denial says to ask instead. A waiver can be a picked option too - `WAIVED - answered: <label>`,
    `format:` / `findings: skipped - answered: <label>` (`answeredWaiver`) - when the label skips the review in the waiver
    words, an ask THIS session answered carries it, and the run is not unattended (auto-mode answers its own Recommended
    option, and a skipped review is never the run's call).
    An unknown receipt line is never refused. A verify-skill VERIFIED line needs a Skill run in THIS session, read from the
    whole transcript (newest 64MB) - a 256KB tail refused three sessions whose review sat further back.
    A `git add -N .` survey chained to a bare `git reset -q` blocks while the index holds staged work (the reset
    would unstage it); the denial names `git diff HEAD --stat; git ls-files -o --exclude-standard`. The act a
    denial echoes is capped at 200 characters with a URL credential masked, and the publish denial names `habits-commit-checkpoint`.
    Both are judged in the repo git runs in (the shell's cwd, a leading `cd`, `-C`) - a worktree is its own. A `cd "$VAR"`
    follows the newest LITERAL the same command assigned before it (`gitText`'s `callDir`), and a commit in a checkout other
    than the project's, on a detached HEAD, under the temp dir or the harness scratch root is scratch and needs no receipt
    - the staged scan still runs (audit 2026-10-11 SD16, 2ca8e8ee).
    A PUSH-GATE receipt spanning more than one MANIFEST-owning directory needs a `scope:` line naming
    what the probe actually ran (a plain top-level folder is no project, so an ordinary repo never asks).
    Every commit, trivial or not, first gets a scan of the lines it ADDS (the index, plus what `-a` or a
    chained `git add` takes in; a commit NAMING paths, the working tree of those paths - alone under
    `--only`, on top of the index under `--include`; at most 2MB, a binary file or one past the cap
    skipped, and past the total the scan stops reading but keeps its hits): a conflict marker, a debugger, a focused test (a comment-only line and an ordinary call such as `fit(...)` never count), a
    credential-shaped literal or a hidden character (`hidden-chars.js`, the lint's class; a byte-0 BOM
    passes, and so does a joiner or direction mark a script needs) blocks, and no COMMIT-GATE receipt opens it - a hit meant to land goes
    through one ask and `<data root>/state/approvals/STAGED-SCAN-ALLOW` (`file:line`, a file or `*`).
    What was untracked when the change started (`docs-session.js`'s record, below - the one this session's first start
    named in `untracked-session-<sid>`, else the HEAD-keyed one, else the newest) is not the change: it
    leaves the receipt's `spec:` count and the trivial bar, and a `git add` whose own dry run would stage one of
    those paths without naming it (`-A`, `.`, `:/`, a directory, a glob) blocks until `<data root>/state/approvals/UNTRACKED-ALLOW`
    lists it (a path, a directory ending in `/`, or `*`) - pilot 3's ~150 harness files drove 19 denials and one sweep.
    The receipt's `spec:` count is measured on what the commit takes in - the scan's set, each add and commit path placed
    where its own git call runs (the cwd, a cd, its `-C`) as a `:(top)` pathspec (2.1.6 H2: on the whole tree, narrowing a
    commit never helped) - and on the whole tree when the command does not spell that set out (a path word the shell
    expands, an add fed by `xargs` or `--pathspec-from-file`, an interactive add or commit, `git $C`, a chained `git rm` /
    `git stash pop`) or its named paths resolve to nothing while the tree is dirty. The trivial bar is cumulative per
    SESSION (review M2): this commit's set plus the session's earlier commits the guard itself let through as trivial -
    its ledger `<data root>/state/sessions/trivial-<session>`, one row per trivial pass (the HEAD it was made on, its files and
    churn), counted while any of its files still differs between the session start and HEAD - so an amend or a rebase
    keeps it and a branch switch drops it; rows repeating one head and file set count once (a retried chain), an
    `--amend` is judged as the whole commit it leaves (its parent's diff plus this delta, the replaced row skipped), and a
    commit a valid receipt covers writes no row; commits a pull, a merge or a rebase brought in add nothing (re-verify
    N1, re-verify 2 R2-M4). So one small commit stays exempt and a split change gates at the
    slice that crosses it. The session is gated by the start sha history-session.js pins in
    `<data root>/state/history/<session>.json` at the first SessionStart (kept across a resume or compaction): a new session
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
    statement about the verb refuses it, and only its own gate. Opening a pull request ('open the PR') is
    consent; a question, a negation or the PR's description / template / page is not (H3).
  - `guard-stop-contract.js` (`Stop` + `SubagentStop`; PreToolUse `SubagentHandback` - the output-scorer seal, below; PreToolUse `AskUserQuestion` - its notes INJECTED, and a
    PreToolUse note lands beside the tool result, which for an ask is the user's ANSWER, so each is worded for that
    moment ('the ask just answered ... verify, re-ask if it moved'); the ask's own SHAPE is FIXED IN PLACE when every reason is
    mechanical (the 2026-10-17 usage audit: a deny for missing numbers cost a red block and a re-sent ask) - the corrected
    questions go out through `updatedInput` with no permissionDecision, so the dialog is the user's as ever, plus a note and one
    `mode: rewrite`, `ask-fixed` row - and denied once per ask text, carrying them, only beside a reason it cannot fix (an
    unmarked question, type-into-Other, a blind approval, a missing review, a new cycle) or a compact-instead drop that leaves
    a question one option. The mechanical reasons: its house voice (an
    em- or en-dash or a horizontal bar - `hook-prelude.js` `HOUSE_DASH` - or a straight or
    curly double quote; audit 2026-10-08) outside a backticked span or fenced block, which it neither judges nor rewrites
    (R5: a string's delimiters in code stay double), once per ask text (a marker the log dir cannot hold goes under the temp
    dir, so a missing dir never re-denies), carrying the corrected strings (I3); a fresh-session option quoting no number
    within 20% of the measured carry (both numbers appended to its description); a fresh option pointing at a resume block
    'above' that no fence since the typed turn shows (`ASK_ABOVE_RE`, reworded to 'the resume block, printed after this
    answer'); and, with no mechanical fix, an option
    telling the user to type into Other (`OTHER_RE`, module scope - lint check 61 reads that one line and fails a shipped
    ask template it matches, audit 2026-10-20 C01: 14 template lines in 10 skills taught the wording this denies), a single-select question without exactly one '(Recommended)' listed first (an
    unmarked one whose text says why none is recommended passes), and - off auto-mode and with offers on - a new cycle's
    first ask with no fresh option after a typed prompt followed this session's plan `Completed:` stamp (once per stamp;
    audit 2026-10-10 C08 / C09 / C26); a question shaped as an approval (approve, as shown, is ready, post / file /
    publish / send this) with no chat text since the user's last typed turn that carries its subject - 200 characters or
    more naming its noun (audit 2026-10-11, session 2ca8e8ee: a staged plan and a ticket comment approved unseen); and a
    small solve-task close whose `Result:` line has no `review:` field (session 5984019e) - a close stating no `Size:` is
    judged on the cycle's size, read from the transcript: the newest one stated, raised by a `size check: raise to
    standard`, else spec-check's `size floor:` (a trivial floor counts, since a trivial run has no stop), only after a
    source edit this cycle and never where task-design / verify-plan / implement ran or a plan file was read or written
    (audit 2026-10-20 C37, 4a210c3c). The solve-task FLOW STOP FIELDS note reads the whole transcript once per session
    for the flow's marker (`guard-stop-flow-*` keeps how far it read), and accepts a field opening a sentence inside a
    one-line question; the same read places the stop, so the note also names a RECEIPT the stop owes and left out - `Size:`
    at a cycle's first stop (no ask answered since its marker or its new-scope prompt, an opening fresh hand-off excepted),
    `mechanics: read` at the approval (an 'Approve' option), `memories purged:` at the close (no ask answered since the
    `Completed:` stamp, or the cross close report) and `ceilings:` in the cross close report (audit 2026-10-10, T4
    cross-track), and `Repro:` at a bug cycle's stop past design (spec-check printed `bug: yes`, or a plan carrying a
    `## Repro` section was read or written; past design is a standard step, a plan read or written, or a source edit - audit
    2026-10-20 C37, 7c1af769, 11 of its stops); under a live AUTO waiver a solve-task done close without the three fields is held once at `Stop`;
    no shell-result wiring since the deep hooks review 2026-10-16 dropped its async PostToolUse / PostToolUseFailure
    root-cause probe - 27,380 runs for 250 rows nobody read) - blocks a turn ending on a decision-shaped question in prose (the quality
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
    wait on the user, a next step, 'tell me' or 'nothing reports' keeps it a stall
    (review B2, re-verify N-B2) - except that 'tell me', 'let me know' and 'ping me'
    are an OFFER when an offer word follows (if, in case, how, what, whether, about - not before an infinitive:
    'tell me whether to push' asks for the decision), and a when / once / after condition still hands back (re-verify 4 R4-M3). A HAND-BACK anywhere in the close (an approval, a go-ahead, 'let me know', a
    question to the user) wins over every wait and every text exemption (R2-M1), and a wait on the stack's own seats (a designer,
    a diagnoser, an analyzer) is a wait on work (R2-m3). Its word lists read ENGLISH ONLY (deep hooks review 2026-10-16,
    the user's ruling: the Ukrainian halves decided 4 closes in 4 weeks, 2 of them false blocks): a close in another
    language is judged only on its neutral signals (a closing '?', the ask rule, the background registry), auto-mode never
    answers an ask it cannot read (`autoAnswers`, `hook-prelude.js unreadable` - 30% or more of the letters outside ASCII),
    and the markers it reads stay English whatever the answer's language (alfred-interaction.md); holds ONCE a subagent that stops on a wait nobody will end ('I'll wait for...' or its own
    ScheduleWakeup) with no background work of its own; a close saying the RUN has nothing pending (the pinned line in shared-rules.json) is
    finished. A fork, subagent or worker is work that ends; a `queue-operation` row that only QUEUED a task notice
    (`enqueue`) has not ended it - the delivered one does; 'remains' is pending only in its pending forms ('still remains',
    'remains to be done'), so 'only sentry remains' is a status; and the fresh-session branch passes a close whose turn
    already ANSWERED an ask carrying the fresh-session choice (2.1.7, a consuming project's session audit). That close
    carries its paste text in a fenced block (the user's ruling, 2026-10-15: a close said 'paste the resume block above'
    with none on screen): a hand-off pick this turn (`RESUME_PICK_RE` - resume, start or continue in a fresh or new
    session, never a setting such as 'Offer a fresh session') closing with no non-empty fence is held once, `resume-block` -
    and so is a close POINTING at a resume block above (`RESUME_ABOVE_RE`) with no fence in it or since the typed turn (the
    2026-10-17 usage audit: task-solve's compaction ask promised 'the paste-ready block above', now 'the resume block ends
    this turn'). Audit
    2026-10-10 C15 widened both halves from measured misses, each replayed over the bundles' turn-ending closes: the
    offer shapes ('Say 'commit' when ...', 'I can X if you want', 'If you want ..., I can', 'I can X next, or',
    'My recommendation is to ... Otherwise'), `pushed` as done, a 'Not run:' label, 'never ran', 'still open', an open
    item, 'put off' and 'still building' as pending; a prose-ask block whose close also names pending work loses the
    restate escape, and the done-close escape says a deferred item either side owes goes in the ask. A 'nothing pending
    on my side' line naming the user's own run is no exit; under live work the mandated 'uncommitted for your review'
    line and a step gated on the running work ('once the agent is done') are status, a resumed seat's 'its sign-off' is
    a wait, 'your allow' is a hand-back, and a `gh run watch` ends. An answer to the user's own question listing only a
    third party's or deferred items passes, and so does the close after a fresh-session ask answered this turn. The
    ask branch's typed-turn count follows the live `parentUuid` chain, and its stale-scope note counts `push` only in a
    git shape. Audit 2026-10-11 SD10: a line opening `Deferred by you:` is nothing owed when an ask answered THIS turn
    carries a deferral in its answer (the pinned contract with validate's close; with no such answer it is judged as
    written); an answer to an informational prompt ('Show me ...', a question) from a turn whose every call reads
    (a read tool, a whitelisted read-only shell command) passes when it states only waits and states - no step, offer of
    its own or approval hand-back; an ask just answered no longer exempts a close handing the user a NEW run-and-report
    action ('Run the pull, then tell me when it's done'); a merge, PR, remote or CI ask's stale-scope note (each half its imperative alone since the deep hooks review
    2026-10-16, the stories in `docs/baseline-rules-evidence.md`) needs a
    remote-aware read (`git fetch`, a `git log origin/...`, `git branch -r`, `gh pr`), never `git status`; and a production
    file the streak CREATED ('File created') beside a test edit is test-first scaffolding, not a root-cause streak. Hooks
    review 2026-10-16 (20 done-close blocks read against their transcripts: 3 right, 15 wrong; the replay of the sample
    clears 9 of the 15 and keeps the 2 right ones it reproduces): the DONE half reads `doneProse` - a done word under a
    negation ('Nothing is committed or pushed', 'isn't committed', 'nothing gets pushed') reports
    nothing done, while the pending half keeps 'not pushed' as its item - and counts a check that `passed` and the resume
    close's 'saved for a fresh session', which had read as done only through their negated 'committed';
    'nothing is unpushed or uncommitted' is a negated pending item, read only right after its 'nothing'; and the
    informational-answer exemption vetoes on the model's move or a hand-back only beside a named pending item - with
    none named, only a hand-back that puts a DECISION to the user (`DECISION_HANDOFF_RE`: 'up to you', 'your call',
    'say the word', 'when you decide') still holds the close, and a descriptive one ('tell me when it's done and I'll
    read it', 'your own login', 'it needs to come from you') does not. Two single-row causes followed, each replayed over
    all 74 Stop blocks since 2026-10-11 (3 released, all waits or records, no right block lost): `WORK_WORDS` takes a
    seat's `fixes` and `checks` ('Still waiting on the libs/ui fixes and the cheat check' under running seats), and
    `blankPast` drops a RECORD of decisions taken (`DECISION_RECORD_RE`: a line naming decisions and a past verb -
    'Decisions auto-mode made for you:' - over list items, never 'Decisions to be made') before the forward hand-back
    read, so a picked label 'Commit: commit now' is no commit handed over. Row 20 stays held: widening the 3-call
    `askJustAnswered` window to reach its answer (8 calls back) also releases right row 2 (6 calls back, whose answer
    never settled the push), and an auto-mode-close exemption would release next-step asks the user took. A tool-ended transcript read retries once after 300ms (`no-tail` probe row). Credential branch: asks for rotation ONCE per exposure (`guard-stop-contract:rotate` in `ALFRED_CODE_HOOKS_OFF` off; any ask
    answered or declined after its block is the answer, a free-text 'Other' included), judged
    on what the model was SENT - a tool result's `message`, never the CLI's stored `toolUseResult` copy (an
    Edit's `originalFile` held a JWT the secret guard had kept out of context, pilot 3) - with a short-lived link's own
    token blanked first (`withoutShortLived`, the secret guard's rule), so a ten-minute media link in a Jira read asks
    no rotation.
    Audit 2026-10-20 H9: the done-close's PENDING half reads no single-quoted span and no parenthetical right after a sha or
    a code span (`QUOTED_OUTPUT_RE`: '15f00b6c (not pushed)' quoted git's own line and held a finished close, session
    7ec6c7db); the same words unquoted still hold. Each done-close exemption is one named entry of `DONE_EXEMPTIONS`, and
    the first that fires on a close the base test held writes one `mode: probe`, `kind: done-close-exempt` row naming it -
    the rate a change to one is measured on (C03 had no row). THE ASK-FIXED ROW WAITS (the hooks track's minor list):
    PreToolUse hooks on one matcher run in parallel, and on `AskUserQuestion` the core lists the plugin's
    `guard-layer-table.js` first and this hook second - each a node start per ask, p50 28ms and 44ms on an 830KB
    transcript (measured 2026-10-20, this machine); since 2026-10-28 (F4) the layer gate's PreToolUse half judges only a
    layer table that never ran and configure step 1's inventory, and its paste check voids at PostToolUse. So the layer
    gate can deny the ask this hook fixed in place: the `ask-fixed` row waits in
    `guard-stop-askfixed-<session>.jsonl` (hook temp dir) with the call's `tool_use_id`, and this hook's next ask or Stop
    writes it once the call's result is on disk - dropped when that result is a hook's denial, written as it stands past a
    day - and a fix in place spends no deny marker (only a deny does, so a sibling's denial never costs the re-sent ask its
    own).
    Two LOG-ONLY probes (2026-09-25 - the habits skills lean on their descriptions and the flows that load
    them, and the misses are counted, never held or injected): a done claim over a turn's source edit
    (file tool, a shell write on the whole shell route, or a navigation `rename_symbol` / `safe_delete_symbol` credited to
    its declaring file - R8) writes one `done-gate` row per turn - `unrun` when nothing ran after the edit,
    with the skill load, the project's test markers and any instruction line against running tests
    (`guard-stop-contract:done` in `ALFRED_CODE_HOOKS_OFF` off). The `root-cause` / `test-first-red` rows a red run's streak wrote went with the
    shell-result wiring (deep hooks review 2026-10-16); `analyze-usage.js --hook-blocks` still resolves the ones older
    ledgers hold. A run is red only on the RUNNER's verdict (a failing count, `not ok N`, Nx's 'Failed tasks:'). A close dismissing a
    failure ('pre-existing', 'unrelated to my change', 'flaky', 'skipping tests for now') in a turn with a red
    run, a skipped test or an added skip marker writes one `rationalization` row per turn. Two flow probes, the same
    log-only footing (audit 2026-10-10, T4 cross-track): a turn that loaded habits-execution-strategy with no `Execution:`
    line after it writes one `execution-line` row, and a source edit under a new prompt after this session's plan
    `Completed:` stamp, with no new plan file, one `post-close-edit` row per stamp. A third, once per session: edits
    across 2+ files with no habits-execution-strategy load before the first, read from the same whole-transcript flow
    state, one `no-execution-strategy` row (audit 2026-10-11, session 7f8803eb: 21 Edits over 5 files, never loaded) -
    counting only source files inside the project (no plan, docs root, `.claude`, `.alfred` or scratch file), settled by an
    `Approved:` plan read before the first edit, and a mode-naming ask after the load is the `Execution:` line (audit
    2026-10-20 C08: the probes fired on every flow run that edited its plan). An auto-answered solve-task stop gets the
    stop-field notes before it returns (`flowFieldNotes()`, C04), and an approval after this cycle's task-verify-plan
    owes the gate's `Passes:` line (a09fc7d6). A read-only survey loop (`$(...)`, for / if / assignments judged as the
    commands they run) answering the user's question is no done-close stall (C03), and since the user's ruling of
    2026-10-20 neither is a write under a TYPED question (the prompt's last line ends on '?' and is no 'can / could /
    would / will you' request): the own-move, hand-back and pending-step vetoes still hold it.
    Fresh-session offer on a clean close past the window's ABSOLUTE trigger:
    `ALFRED_CODE_CONTEXT_WINDOW_FOR_1M` (default 400000, a window of 1M or more), `_FOR_300K` (280000, 300k up to
    1M), `_FOR_200K` (180000, 200k up to 300k); `0` switches that tier off; seeded absent-only (2026-10-16, the user's ruling:
    renamed from `ALFRED_CODE_FRESH_SESSION_1M` / `_200K`, the 150000 seed moved to 180000, `_DEFAULT` retired - every
    window lands in one of three tiers - and `ALFRED_CODE_DEFAULT_CONTEXT_WINDOW` renamed `ALFRED_CODE_CONTEXT_WINDOW_DEFAULT`;
    `meta/migrations.json` carries each). The window is the session model's own capacity from ONE table (its FULL id's row in
    the shipped `model-windows.json`; no id suffix, carry or settings alias is read - the settings `model` key holds `sonnet`,
    which named no row, the user's report of 2026-10-21), never declared. A session with no tier - an unlisted or not yet known
    model, a window under 200k, a tier variable unset or garbage - takes `ALFRED_CODE_CONTEXT_WINDOW_DEFAULT` as the TRIGGER
    itself (seeded 180000; the user's ruling of 2026-10-21 - it was a WINDOW, seeded 300000, before, and `migrations.json`
    moves that seed); it is never a window and never an auto-compact window (`settings.js compactWindowSeeds` seeds a
    model under 200k nothing). So the whole off switch (`FRESH_OFF`) is all four keys at `0` - the walk's fresh-session
    question carries the DEFAULT as a rider of the 1M row, and an update carries a stack-seeded or absent DEFAULT to `0` where
    the three tiers already are (`off_settings_env`, `settings.js offWithTiers` - a typed value stays) - or
    `ALFRED_CODE_AUTO_COMPACT=1`. The id is the newer of two: the `model` SessionStart and `to_model` PostModelSwitch hand
    `guard-fresh-session-start.js` (saved per session in `<data root>/state/sessions/models.json`, the newest 40; the
    only id before the first reply) and the transcript's last model row. A known window is only LOWERED by two measured facts (audit 2026-10-10 C08): the install's
    documented auto-compact window (`CLAUDE_CODE_AUTO_COMPACT_WINDOW`, else the highest settings file naming one - its
    `modelSettings` entry for the model first, then its top-level `autoCompactWindow` - the USER file's included, 'Scope:
    Any file' with no model limit in the settings reference; the Opus 5 / Fable 5.1 limit is `effortLevel`'s, audit HK03)
    and 90% of the lowest automatic compaction this project recorded for the model
    (`<data root>/state/sessions/compact-points.json`, 30 days). The TIER is the model's own window (its table row; no row is no tier): a lowered window only clamps the trigger inside it, so a 1M model under the 400k window the installer seeds
    keeps its 1M trigger, held at 360k - tiering by the lowered window had dropped it to the 300k DEFAULT trigger of that time (2026-10-14). A context read stops at a `compact_boundary` row (unknown until
    the next model call), and the model id read widens to 8MB and takes the harness's `model` attachment row. A key matches its id, a dated snapshot, a Bedrock version, the `[1m]` suffix and a provider prefix, never a point release: `claude-opus-5-5` took `claude-opus-5`'s row until every model got its own (2.1.5 M6, which added Opus 4.5 and Sonnet 4.5 at 200K). A trigger at or above its window is clamped
    inside it (90% of it). The offer fires only
    when a fresh session pays back with the cache warm (THE VERDICT below),
    re-arms at 1.5x growth - counted from its own block or the newest fresh-session ask answered in ANY turn, at that
    ask's carry (`fresh-session.js` `freshAskAnsweredCtx`; audit 2026-10-11 SD11, 7f8803eb) - and never mid-response. A long-idle or long-span session takes the same
    offer under the window (`ALFRED_CODE_FRESH_SESSION_AFTER_HOURS`, default 2, unseeded, `0` off). The offer waits
    while work this session launched is still out (it said 'the work in this turn is finished' 3s after a verifier left).
    THE VERDICT (the cache-aware design of 2026-10-28; the user's report of offers near 100k with the prompt cache warm):
    every route that offers, recommends, holds for or demands a fresh session asks `fresh-session.js` `freshVerdict(ctx)`
    (`worthResuming` returns its `pays`; the 40% rule, `MIN_RECOVERABLE_SHARE`, is retired). The floor F is the
    session's first main-session assistant row with a usage (`coldFloor`: forward in 512KB chunks to 8MB, a row that
    straddles a chunk read whole, never a sidechain or `<synthetic>` row - the old single 512KB read found none in 93 of
    212 sessions, whose first reply sat 511KB to 1,159KB in, and answered yes at any carry). A fresh session carries
    G = F + R (`RESUME_READ`, 13,000: what a resumed session re-reads). With r the session model's cache read rate
    (`CACHE_READ_RATES`, thousandths of the input price: 50 for claude-opus-5-5 and claude-sonnet-5-5, 25 for
    claude-fable-5-1 and claude-mythos-5-1, 100 for any other model or none; held to `meta/model-prices.json` by a test),
    w its TTL's write rate (2000 for 1h, 1250 for 5m; the newest usage row's `cache_creation` split, else 5m) and P the
    payback window (`ALFRED_CODE_FRESH_SESSION_PAYBACK`, a whole number 0 to 1000, anything else 30, unseeded, `0` no
    offer), a fresh session pays when ctx > G and G x (w - r) < P x (ctx - G) x r - integers, so the comparison is exact
    (claude-opus-5-5, 1h, F 79k: no at 211,600, yes from 211,601). A carry of 0, an unmeasured floor and P 0 never pay.
    Every route is priced WARM: each one speaks after the request that would have met a cold cache (the idle-gap offer
    rides that prompt, the holds deny a later call), so the carry is cached again when the choice is put; a block of the
    prompt itself would be a new interaction. The texts state the price ('... a turn re-reads it at <r>x the input price.
    A fresh session restarts at ~<F>k, written new at <w>x, and pays back in about <N> messages'), never 're-sends all of
    it'. The compact and idle holds pass a changing call at a carry of 0 without spending the hold, so the first call
    with a reading is judged, and a hold whose verdict does not pay releases (`not-worth-resuming`). Each route that
    reaches the verdict writes one `mode: probe`, `kind: fresh-verdict` row per session, route and value of `pays`
    (route, ctx, floor, ttl, ttlFrom, version, readRate, readShare, breakEven, payback, resumeRead, the old 40% answer
    as `share40`, and `unattended` when nobody was at the terminal) - the rows the design's reopen list reads. CHECK 15 (the ask branch): a single-select question carrying
    a fresh-session HAND-OFF (`isFreshHandoff`: a label opening on Resume, Start, Continue or Build that moves the work
    'in a fresh session' - or a new one, or a chat - with no 'no', 'not', 'never' or 'without' before it; 'Build the new
    session expiry check', a setting such as 'Offer a fresh session' and capture-usage-report's 'Hand off to a fresh
    session' are none) where the verdict does not pay has it dropped in place, the mark moved to the first option left,
    the not-pay text as the note and one `fresh-ask` verdict row; a question of hand-offs alone is left as written, and
    one the drop would leave with one option is refused once, naming the option to take, and left out of the re-send.
    It stands down for `guard-stop-contract:fresh-ask` in
    `ALFRED_CODE_HOOKS_OFF`, `FRESH_OFF`, a live auto-run stamp of this session, nobody at the terminal, a seat, no
    measured carry or floor, a multi-select question and a newest typed prompt naming a fresh or new session, chat or
    conversation, `/clear`, clearing the context or starting over. The
    numbers check reads hand-offs only. The skills list the in-session option first and mark the fresh one only where a
    hook's text says it pays. The measurements are `docs/fresh-session-cache-evidence.md`.
    THE SCORER BACKSTOP (mode-output-scorer, spec 2026-10-24 5.9): while `scorerState` is usable (a loadable skill copy,
    neither hook nor its `scorer` part off), a close that owes a `Scored:` line and lacks it is held ONCE per typed prompt.
    One `walkBack` pass reads back to the cycle's opening row - the newest typed row that is no harness prompt, compaction
    summary or `Stop hook feedback:` row - so a grader's notification turn stays in the cycle. The evidence: T1 a Write of a
    `.draft.md` in this session's scorer folder (on, or the cycle stacked); T2 a plan Write under the docs root's
    `work/plans/` (on, `designer-plan` listed; not where a draft was written, a plan reader - `task-implement`,
    `task-verify-plan`, `task-verify-code` - ran, or the loop released that `target:`); T3 a findings write whose `Cause:`
    is set, or a diagnoser seat that settled (on, `root-cause` listed); T4 a typed stack naming `mode-output-scorer` (on
    or off; a flag-only `/mode-output-scorer --mode-output-scorer-off` line is no stack, the stack-modes spec section 4). A `Scored:` line clears the newest trigger only when a `rounds.log` of this session's folder or a `self-*` one
    holds a `released` / `final` line written since the cycle opened (2s slack); a typed one is no receipt and writes one
    `scorer-receipt-unbacked` row. The `SCORER-HELD-<session>` marker holds the cycle's key (the row's uuid, else its
    timestamp, else its hash), and the check sits BEFORE the `stopHeld` exit, so a rewrite after this hook's own hold for
    another reason is still judged while the marker keeps it to one hold. A live `output-scorer` seat in
    `background_tasks` is the loop's own wait, never held; a seat's Stop and a transcript-less Stop judge nothing; no
    opening row writes one `scorer-cycle-unread` row. The hold's block row names `branch: scorer` (AC11, AC14, AC16, AC17,
    AC19, AC24, AC25; `guard-stop-closes.test.js`, 'scorer backstop'). THE SEAL (5.10): an `output-scorer` seat's report
    names its score file on its first line (`*` and backticks dropped); PreToolUse `SubagentHandback` - or SubagentStop's
    `last_assistant_message` for a run with no hand-back, before that route's `stop_hook_active` exit - writes it as
    `seal: sha256 <hex>` then the report as delivered, only into this session's scorer folder (both sides realpathed, so
    macOS's `/var` is `/private/var` and a symlinked parent leads nowhere), only a `.score.md` that does not exist yet
    (`wx` - a second delivery never rewrites it), one `scorer-seal` probe row either way; the hand-back is never delayed
    or denied, and `scorecard.js grade` fails a card whose seal is missing or broken with exit 3 (AC18, AC22).
  - `guard-fresh-session-start.js` - denies the MODEL's own PreToolUse `Skill` call on a
    `disable-model-invocation` skill (read from its frontmatter - the personal copy first, then the project's, then the
    running plugin's own root, then the plugin caches newest version first, the order Claude Code resolves a name in, M10; the user's slash turn is untouched;
    a plugin COMMAND and the router skill too - `commands/`, `setup-plugin/commands/`, `setup-plugin/skills/` - audit
    2026-10-08: the guided commands - six since setup merged into init, 2026-10-17 - and `alfred-code` were never resolved;
    a plugin COMMAND is read only under its plugin's namespace, since a bare name is a personal or project command or a
    built-in - audit 2026-10-20 H10: the built-in `/init` reached the Skill route as `init`, matched the core's flagged
    `commands/init.md` and was denied; a plugin SKILL still answers to its bare name), denies the same call to Claude Code's BUILT-IN `code-review` /
    `security-review` (bare, a leading `/` stripped) when no skill of that name sits where `skillHeads` looks and ours is loadable
    (`oursLoadable`: a personal or project copy that `skillOverrides` neither turns `off` nor leaves `user-invocable-only` -
    never the core's own `stack/skills` source in the plugin cache, so the skew window before update passes; final review
    2026-10-22 I1), naming
    `/review-code` / `/review-security` (one block row, `branch: 'builtin-review'`; a namespaced call, a personal, project or
    plugin copy of the name, the user's typed expansion and `guard-fresh-session-start:builtin-review` in
    `ALFRED_CODE_HOOKS_OFF` pass - the user's ruling of 2026-10-22, 'Stop the model using theirs'), and
    offers a fresh session before a deliberate orchestration run (capture, loop, solve flow, review,
    guided walk; only the `alfred-code:` namespace is stripped, so another plugin's `other:task-solve` is not one) when the
    context is past the window trigger OR (slash route only) this session already
    TYPED a run (one that made two tool calls - a one-turn model-gate refusal is no run, audit 2026-10-20 C13) - a Skill call is a phase of a run in flight, and harness-written user rows are no turn. The size offer
    stands until an ask is answered after it (its file records the transcript size; a retry with no ask between was a
    soft gate), and a Skill call whose turn already ANSWERED an ask carrying the fresh-session choice (task-solve's stop
    asks) is not offered again - `freshAskAnsweredThisTurn`, one home in `fresh-session.js`, the stop contract's too. The
    same Skill route holds a GATED solve-task cycle's stops once per step call (audit 2026-10-10 C19): where spec-check
    printed `path: gated`, `task-verify-plan` waits for an answered ask or typed prompt after `task-design` wrote the plan,
    and `task-implement` for one after `task-verify-plan` - the whole transcript read in 4MB chunks on those two calls; a
    seat and nobody at the terminal (an AUTO waiver) pass, and the second call passes with a `gated-stop` row (corpus: 58
    gate / build calls, 1 held - the audited miss). Routes:
    PreToolUse `Skill` BLOCKS; `UserPromptExpansion` INJECTS for slash-invoked runs (2.1.5 M14: the event fires on a
    typed command and names it in `command_name`, the typed prompt settling a plugin command's namespace; its matcher, a
    regex with no colon, lists the orchestration commands, so no ordinary prompt spawns it; never blocks - a blocked
    expansion shows its reason to the user only; the chained offer is spent only once an ask is answered after it, so a
    double-submitted command re-injects on the live branch); `SessionStart` (every source saves the session's `model`, and
    `PostModelSwitch` its `to_model`, then leaves - the 2026-10-21 ruling above) with the source `compact` - an AUTOMATIC compaction
    only, a typed `/compact` gets just the two lines below - names the summary's 'continue without asking' line as
    superseded and leaves a one-shot HOLD (`guard-fresh-compact-*`): the first changing call after it that this hook is
    wired on (`Write` / `Edit` / `MultiEdit` / `NotebookEdit` and the shell route - both rows fold into their
    dispatcher, which runs the hook in-process, one process per call (2.1.5 M3) - `Agent` / `Task`, a `Skill`) is denied with this session's measured
    carry and cold floor until an ask is answered or the turn writes 'single short step', released with no deny when a
    fresh session would not pay back (THE VERDICT), nobody is at the terminal, a seat made the call or it has denied twice (audit
    2026-10-10 C09: the injection alone lost to the summary line in six sessions), plus two lines: answer in
    the language of the user's prompts (unless a loaded skill sets it), and re-read a live plan file's header first. `PreCompact` writes
    `<data root>/state/sessions/COMPACT-STATE-<session>` first (one per session, so a parallel session's PreCompact never
    overwrites it - loading audit 2026-10-21 G10; the compact start still finds an older shared `COMPACT-STATE`) (the live plan, the newest orchestration run with its route and SKILL.md path,
    the open flow stamps with their ages, the files this session wrote, no model call) and records an automatic
    compaction's context in `compact-points.json`; the compact start points at the state file - and, for a SLASH run,
    says to re-read its body, which the harness re-attaches only for a Skill call - even with every fresh-session offer off.
    `UserPromptSubmit` carries only the idle-gap offer: the prompt that ends a gap past the clock route's
    `ALFRED_CODE_FRESH_SESSION_AFTER_HOURS` since the last reply injects the ask once per gap (`guard-fresh-idle-*`), with
    the carry and cold floor, when a fresh session pays back with the cache warm - never for a task notice, a seat, a carry past a compaction
    or nobody at the terminal (audit 2026-10-10 C09: a next-day resume ran 14 messages at 289.9k unoffered). The
    injection was spent on a question answered from context (audit 2026-10-11 SD11, fdce35ae / 2ca8e8ee), so the gap
    also leaves the compaction route's one-shot hold marked `idle` (a compaction hold already standing is kept): a
    shell call that writes nothing passes it, and the first CHANGING call is denied with the numbers (`idle-hold`
    rows), released exactly as the compaction hold is. The compaction hold passes a shell call that writes nothing too,
    idle or not (audit 2026-10-20 C12: a read-only `cat COMPACT-STATE` was the first post-compaction call and forced an
    ask); a changing call after an `AskUserQuestion` whose answer came past the clock route's hours arms the idle hold
    once per ask (C49: an ask answered next morning never reached the prompt-route offer). A compaction point more than
    5% over the configured `autoCompactWindow`, in a session started after the settings file was written, makes
    `autoCompactWindow()` return null - the hook says once that the window was not honoured and names `/autocompact`
    (C10: a 350k value in `settings.local.json` compacted at 466.8k-469.7k in three sessions; cause unproven, the docs
    name no local-scope rule). A user-scope file is named `~/`-relative with `/`, never by its whole path (audit 2026-10-20,
    the hooks track's minor list).
  - `guard-cross-project-write.js` (PreToolUse `Write`/`Edit`/`MultiEdit`/`NotebookEdit` + the shell route) - a write outside
    the project root is blocked (file tools and shell routes: redirection, `tee`, in-place `sed`/`perl`,
    `cp`/`mv` destination, `rm`/`mkdir`/`chmod`, `git -C <other>` mutating, `cd <other>` then a write);
    the change goes to a task card under `<docs-path>/work/cross-project-tasks/`. Reading stays open. A shell path is
    anchored at the payload's `cwd` (the Bash tool's persisted cwd, as the rm and config guards read it; a missing,
    relative or vanished one is the project root), a file-tool path at the project root (audit 2026-10-08). Session
    scratch (the harness root `/tmp/claude-<uid>` listed on its own, so a project kept under `/tmp` still reaches it),
    `~/.claude` / `~/.claude-<name>`, a relocated `CLAUDE_CONFIG_DIR` and `/dev` stay writable; paths compared as REAL paths in their on-disk
    letter case (the native realpath, and on win32 a case-folded compare as well - M9); a Git Bash mount path (`/c/...`,
    `/cygdrive/c/...`) is translated first (`shell-writes.js` `nativePath`, the one home every path-resolving guard
    requires - 2.1.5 M8). 'Allow' is honoured through the
    `<data root>/state/approvals/CROSS-WRITE-ALLOW` receipt; `ALFRED_CODE_ALLOW_WRITE_OUTSIDE` opens a second
    tree permanently. A removal (`rm`, PowerShell's remove) of a symbolic link is judged where the link lives - its folder
    resolved, its name kept - unless a trailing slash follows it (audit 2026-10-10 C31, session 0d070bcc: `rm -f` of the
    session's own link to a sibling repo was blocked as a write into it). A PowerShell command's backslashes read as `/`
    before the scan (`..\sib\x` named no parent on a POSIX host and passed), and the main block's row names its branch
    (`file-tool`, `shell-write`, `git-write`; audit 2026-10-20, the hooks track's minor list). A LINKED WORKTREE of the project's own repository
    is the project - read from git's own files, no git call: the target's nearest `.git` file, its `gitdir:` and that dir's
    `commondir` must reach ROOT's common git dir; a clone, a forged or malformed `.git` file stays outside (audit
    2026-10-11 SD16, session 42951e5b: a `git worktree add` sibling blocked, 569.1k). The log-only fork-liveness probe is retired (2026-10-09, the user's ruling after its rows were read:
    56 probe rows over two weeks in three projects, none naming a collision; the per-call head reads cost 12-22ms).
    Its `interpreter-write` probe (audit 2026-10-10) was dropped in the deep hooks review 2026-10-16 (622 rows nobody
    read); the denial is cut to the ask and its three options (1,553 to ~600 fixed chars).
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
    'Allow' is honoured through `<data root>/state/approvals/CONFIG-EDIT-ALLOW` (a
    file, its basename or `*`); `guard-config-protection` in `ALFRED_CODE_HOOKS_OFF` turns it off (the old `ALFRED_CODE_CONFIG_PROTECT=0` folds in). Audit 2026-10-20 (the hooks track's minor
    list): `RunAnalyzers` / `RunAnalyzersDuringBuild` / `EnableNETAnalyzers` are keyed (true is the strict value); a
    tsconfig `extends` (the base the strictness comes from) and `exclude` (the files no check reads) are judged like a
    key, an array compared without its whitespace; and an in-place edit naming no key (`sed -i '3s/true/false/'`) is
    applied in memory - each `s` script with a line or /regex/ address (or a range), sed's basic syntax unless -E / -r -
    and judged on the pairs it leaves, the file tool's rule; a script it cannot apply keeps the keyword rule. An MSBuild edit that only TIGHTENS passes
    (audit 2026-10-11 SD16, 2ca8e8ee: a `NoWarn` entry removed was blocked): every changed property moves one way - a
    `NoWarn` / `WarningsNotAsErrors` list only loses entries, `WarningsAsErrors` only gains, `TreatWarningsAsErrors` /
    `EnforceCodeStyleInBuild` go true, `WarningLevel` up, `Nullable` toward enable; a property named twice, an attribute
    change or any other key keeps the block. The same one-way rule reaches tsconfig and eslint (audit 2026-10-14 HK19:
    `strict` false -> true and `"warn"` -> `"error"` were blocked): a tsconfig key moves to its strict value (true, false for
    `allowUnreachableCode` / `allowUnusedLabels` / `skipLibCheck`; a removal blocks), and an eslint config passes when the
    file it leaves differs only in rule severities, each raised (off / 0 -> warn / 1 -> error / 2) - token by token in JSON
    and JS with the value straight inside a `rules` object, line by line in YAML under `rules:` (`severitiesOnlyRise`).
    A lockfile, a migration, the central
    package file and a solution file are a recorded DECLINE (2.1.5 M13, in its header): legitimate work edits each, and
    whether a migration was applied lives in a database no hook reads.
  - `guard-desktop-exec.js` (PreToolUse on the desktop server types' two process launchers, `App` and `Shell`, under any
    registration name - `^mcp__.+__App$|^mcp__.+__Shell$`, since the stack ships no server and the name is the user's
    (2026-10-24, ruling N6); a bare server spelling in a test is never literal text, lint check 54 - and the browser server
    type's code runner `browser_run_code_unsafe` the same way, `|^mcp__.+__browser_run_code_unsafe$`: Playwright's README
    calls it 'RCE-equivalent' and no flag switches it off, so the settings deny 2.5.0 to 2.10.0 wrote under the stack's own
    server names is lifted and this gate holds it under any name, its block row keeping `from: code|file`, never the code
    (2026-10-24, ruling N9, a side note's finding: an add-back under the record name ran it unjudged)) - the
    user's ruling of 2026-09-29 (I10): Windows-MCP's `App` with `mode: launch_executable` (any executable, caller-given
    args - the server excludes tools by NAME, never by mode) and every MacOS-MCP `Shell` call (a shell command no
    shell guard sees) are denied; `App`'s `launch` / `switch` / `resize` pass. 'Allow' is honoured through
    `<data root>/state/approvals/DESKTOP-EXEC-ALLOW` (`App`, `Shell`, `browser_run_code_unsafe`, one executable's FULL path - either slash, and either case on
    a Windows path - or `*`; a bare file name opens only a call naming it bare, never that name in every directory - audit
    2026-10-20, the hooks track's minor list); the denial suggests the full path - and names a live bare line that
    missed it, with the full path to write in its place - and a Shell block row keeps
    the command's verb only, never the command (audit 2026-10-08). PROTECTIVE
    (final review IM2, the user's ruling): it holds under `minimal`, a Cursor payload and a repo never set up, where
    it writes no row - the Shell it gates is one the other protective guards never see.
  - `check-turn-build.js` (`Stop` only) - seeded OFF
    (`ALFRED_CODE_TURN_CHECK=0`; `1` turns it on per project after a measured week - validate and status
    paste `analyze-usage.js --turn-check-advice`'s one row at 3 unchecked done claims in the newest 10
    sessions, never setting it). The turn's files come from git: every path `git status --porcelain -z
    --untracked-files=all` lists (a rename by its new name, a deleted file skipped) whose mtime is past the previous
    Stop's marker `<data root>/state/sessions/turn-check-<session>`, or past the session's start (the transcript's first
    timestamp) on its first Stop; the marker moves to now before the check, and a continuation after its own block
    leaves it, so the fix-up edits are the next turn's. Its PostToolUse half (every Write / Edit and the navigation
    server's two edit tools, listing paths in `turn-edits-<session>`) is gone - a process waited on after every edit in
    every project while no project had the check on (hooks review 2026-10-16); git also sees a shell `sed -i` the
    old list never did. Outside a git work tree, or with no marker and no readable start, nothing is this turn's. Then
    it runs ONE scoped check per nearest root - the project's own `tsc --noEmit -p` for TypeScript, `dotnet build --no-restore
    -v q` for C# - and hands the first 20 error lines back as a block, once per turn (its own continuation Stop
    passes). A missing compiler or a timeout is a pass, and so is a C# project never restored (every error line
    `NETSDK1004`, which `--no-restore` cannot get past), written as one `mode: probe` row (audit 2026-10-08). It starts
    no process of its own (the user's ruling of 2026-10-16: a node start every Stop, in every project, to read a switch
    that is off): `history-session.js`'s Stop runs its `stopCheck` in-process with the check's OWN gates (`HOOKS_OFF`,
    `TURN_CHECK`, the Cursor and Stop chain gates), so either hook switched off leaves the other running, and both
    generators fold its Stop row into history-session's (`history-session.js wiringRows`, `RIDERS`), which takes its 60s;
    with history-session not picked its own row stays.
  - `guard-answer.js` (`guard-answer-length.js` before 2026-10-20 - the user's ruling; `renamed.hooks` carries it) (`UserPromptSubmit` + `SessionStart:compact` + `PostToolUse` `AskUserQuestion`; never blocks) - injects the answer budget every turn (a
    341-char delta of the rule's section - its lift list names 'step by step' beside in detail / walk me through / write a
    plan since ruling S9 (the user's, 2026-10-20), which stays its home - audit 2026-10-14 RU06; it was 751 on every prompt), and
    again after a compaction, which drops that injection - only then since the deep hooks review 2026-10-16 (startup,
    resume and clear get it from the first prompt; 256 starts paid a second copy). Its Stop half - the 1800-char prose
    block and the em-dash block - is gone (the user's ruling of 2026-10-20: a hard cap held mandated closes and depth
    asks in other languages and read as a hook error mid-conversation); the budget is a HARD rule in
    `alfred-interaction.md` that the model holds itself, and a Stop payload wired by hand exits 0 silently. After the third consecutive short correction following a long answer it injects
    the format ask (injection only). A correction turn (short, after an answer, carrying a correction marker -
    the test the analyzer shares, `correction-turn-test`; the weak 'it should' inside a wh-clause - 'what type of a
    ticket it should be' - is a request, audit 2026-10-11 SD14, session 5f9fec85; so is 'why you' after an explain / tell me
    verb and a 'not working' inside a because-clause, audit 2026-10-20 C20) writes one `correction` probe row;
    `ALFRED_CODE_CORRECTION_NUDGE` is seeded `log`, `inject` adds the save line (`SAVE_LINE`) - a stated preference into the preferences docs
    (`/capture-preferences`, audit 2026-10-11 SD16, ce9d4811), the lesson or a project fact the correction states into
    Claude Code's own memory (audit 2026-10-10, T5 cross-track); no memory server since 2.10.1 - `0` is off. Its `PostToolUse` `AskUserQuestion` half reads an
    answer typed into an ask (matching no offered label): one `ask-answer-typed` probe row, the same correction test and
    row over a short one, and a note to open a path it names and restate what it changes (audit 2026-10-10 C15 / C07).
    An ask the idle timeout closed (ruling S3, `hook-prelude.js` `askTimedOut`) gets one `ask-timeout` probe row, the
    session's timeout marker and a note that it is no answer - no approval, consent or pick, re-ask when the user is
    back; the next answered ask or typed prompt clears the marker.
    THE SCORER'S LINES (mode-output-scorer, spec 2026-10-24 5.2 / 5.12; the flags by the stack-modes spec of 2026-10-27):
    `--mode-output-scorer-on` / `-off` in a family command's leading run (`modeFlags`; off wins when both are typed) write
    the session's `SCORER-<session>` file, which outranks `ALFRED_CODE_SCORER`, and count for their own prompt even where
    the file cannot be written; while on, every typed prompt - and a compaction's start, which drops injected text -
    carries one `scorer: on (level, rounds, source[, auto-run]) ...` line naming the listed
    outputs in words, so an ordinary reply never reads as one; a message that turns it off carries `scorer: off for this
    session`. A typed stack - the skill's slash name as a word of the prose, a `<command-args>` row included, or the bare name
    right after a usage word (`using`, `with`, `via`, `run`, `stack`, `through`; final review 4) -
    adds `scorer: stacked for this request ...` with the switch off too, and on a `user-invocable-only` copy. All of it
    needs `scorerState` usable: either hook or its `scorer` part in `ALFRED_CODE_HOOKS_OFF`, or no loadable copy, and no
    line is injected, so nothing is graded and the backstop owes nothing (AC1-AC6, AC13, AC19, AC20, AC23-AC25;
    `guard-answer.test.js`). A flag-only line is no stack. While auto-run is on, the context also carries `auto-run: on
    for this session - ...`. THE ON LINE (the stack-modes spec section 3): every typed prompt while a mode is on gets one
    user-visible `systemMessage`, `Modes ON: auto-run, output-scorer (level N)`, listing only the modes on - each computed
    from the prompt's own flag (auto-run's `-on` only when `autoRunRefusal` says nothing), else the stored state, never read
    back after the start hook's write, since the two run in parallel; a compaction's start re-emits both context lines and
    no `systemMessage`. A seat's prompt carries none: the session that receives its report grades what it acts on.
    After its stdout write it hands `modesText`'s own `autoRun` and `scorer` to `session-status.js onPrompt`, under
    `standDown('history-session')`, which rewrites the status file only when one of the two changed (spec section 4).
  - `instrument-tool-usage.js` - wired env-gated: skipped unless `ALFRED_CODE_INSTRUMENT` (seeded "0")
    is exactly "1". It runs `async: true` on both routes (`settings.js asyncFor`, the one async hook since the stop contract's shell-result halves went in the deep hooks review 2026-10-16 - a log never
    blocks or decides, so no call waits on its spawn; code.claude.com/docs/en/hooks, 'Run hooks in the background').
    The copy route also skips the spawn with a `[ ... ] ||` shell test; the plugin route does not, since a shell-form
    hook runs under PowerShell where Git Bash is absent ('Exec form and shell form') and the test would fail every
    call there. A `detail` hint (a description, a pattern) is masked with the pinned credential shapes before it is
    cut (audit 2026-10-08).
  - `docs-session.js` (`SessionStart`, `SubagentStart`, `SubagentStop`, PreToolUse on Read/Edit/Write/MultiEdit/NotebookEdit/Grep (no Glob since 2026-10-16: it did nothing there), the shell route and a navigation server's two edit tools `rename_symbol` / `safe_delete_symbol` under any registration name (N6) - held like an Edit, the file in `relative_path` (I12); a rename is credited to that declaring file alone - the references it rewrote in other files fall to the Stop ask's 'no actor claimed' bucket and outside the turn check's root, an accepted gap (final review R9) - PreToolUse `SubagentHandback`, `Stop`) with its engine `docs.js` (copied beside it, not wired) - every docs DOMAIN (a top-level folder under the docs root holding a `watch.json`, plus the grandfathered `architecture/`) follows the branch, and HOW is declared at install time in `ALFRED_CODE_DOCS_VERSIONING` (`--docs-versioning` writes it; absent, ONE rule seeds it and is the engine's fallback, in three homes - `install/docs.js`, `stamp-docs-root.js`, `docs.js` - pinned by one table-driven test: `local` only when the docs are kept out of git - no domain tracked, and a domain exists or git ignores the docs root - else `git`, a fresh project included): `git` means the docs are committed and git versions them per branch, `local` means per-branch section overlays under `<docs-path>/.branches/`, folded into mainline at the first mainline session after the branch merges. The setting WINS over what the repo does, and a disagreement is reported in `status` and the start block rather than resolved the other way. The start block pushes `ORIENTATION.md`, cut at 4KB with a note so the read lines after it survive the harness's 10,000-character context cap (audit 2026-10-08), each branch list after it (conflicts, deleted-unmerged, on-mainline, overrides, stranded) cut at six names with a count (audit 2026-10-20, the hooks track's minor list), less any line that copies the hook's own footer (`docs.js HOOK_FOOTER`; one project's file carried a stale copy into 310 starts, and `docs.js lint` now names it - deep hooks review 2026-10-16); `SubagentStart` skips Claude Code's own seats that write no project code (`Explore`, `Plan`, `claude-code-guide`, `statusline-setup`: no block, no snapshot, never asked - the block was 27% of all hook text, 40 of its starts on those seats), and names conflict markers and duplicate ids from the engine's `integrity()` (one parse per file, never the whole lint) - a PROVISIONAL one (the first-look scan's, `scan-evidence.js --orientation`) with a stale warning, and `status` / `stale` call it stale by definition; the first change under a source root waits for a section read, per actor - a section handed to a seat never reached the main context, nor the main session's read a seat (loading audit 2026-10-21 G4) - (two holds, then a logged bypass; no hold when no doc file can be read by section) - a `docs.js show` the shell RUNS of a ref the engine resolves, or a Read, Grep or reading shell command of a `.md` under a domain; a Glob, an `ls`, a `watch.json` read, an echoed show line and a show of a missing ref are no read (audit 2026-10-08), and a read of a plan under `<docs-path>/work/plans/` credits the sections its `Oriented:` line names when the engine resolves them (audit 2026-10-20 C25: the first edit of every /clear resume was held); the hold pastes only a section that DECLARES a cover of the target, as 'the documented context for this path', and never one of the preferences domain - preferences-session hands those over, so one denial never carries a section twice (2026-10-21; a covering code-style section was pasted first, as 'the convention this change follows', before); word-only hits are named as candidates with their `show` line and the hold does not repeat (audit 2026-10-10 C03 / C23: a cover-less section matched on words was pasted as the convention for a test helper); a path git ignores, or one under a `TestResults/` folder, is a run artifact and leaves the hold's targets (audit 2026-10-11 SD09, session 5f9fec85: `rm -f` of an ignored `.trx` was held); the FINISH ask fires only when a changed file hits the capture's `watch.json` - for what a seat WROTE at its first `SubagentHandback`, denied once with the ask so the report it sends again carries the docs line (deep hooks review 2026-10-16: asked at `SubagentStop`, 48 of 48 asks came after the hand-back had delivered the report and 41 were the transcript's last row; PreToolUse fires on that tool, 35 runs recorded), else at `SubagentStop` for a seat that stopped without one (a harness with no such tool, Cursor among them) (a tool event carries `agent_id` only inside a subagent, so every write is attributed to its actor - the main session included, under one key of its own - and intersected with the tree diff; a read-only seat running beside a writer is never asked, a write the gate DENIED is never credited, and paths are compared in git's spelling on every platform), then once at `Stop` for what the session wrote itself plus every change no actor claimed - that bucket only once the main session ran a shell command that may write (`recordRun`: any step outside `READ_STEP`, or a redirect; the 2026-10-17 usage audit: a session that only read was asked about another session's uncommitted diff no claim named; a `changed-unclaimed` row instead; a `git stash` push / pop / apply records the files it moves as `moved`, claimed against sibling sessions and never asked of the session that only moved them, and the Stop ask is deferred - at most three times, an `ask-deferred` row each - while the payload's `background_tasks` shows unsettled work: audit 2026-10-20 C25) (a script's output, a tool this hook is not wired on), both in the same shape: the section named, its file, its current FIRST SENTENCE quoted, and a `set ... --expect <hash> < <file holding its new text>` that refuses a rewrite of a section another agent moved meanwhile, with a line saying the new text is the section as `show` prints it, from a file or piped in (audit 2026-10-11 SD09, session 2ca8e8ee). A section whose own text names a hit file verbatim (`docs.js` `namingSections`) is asked about before the watch entry's sections, and 'changed' counts only the commits made since the snapshot (merges aside) within the tree diff, so a checkout or merge bringing another branch's commit in is not the session's change (audit 2026-10-10 C23: sessions f6c591fa and 349e4825). HEAD's reflog since the snapshot says how each commit arrived (audit 2026-10-11 SD09, sessions cc87fa6c / e7c8cbb6): a `commit` entry (amend, initial) is the session's own, a rebase or cherry-pick pick is its own only when AUTHORED after the snapshot, and a pull, merge or checkout brings commits no entry names; with no entry since the snapshot the committer clock decides. An unclaimed change whose file was last written inside an idle span of the transcript (10 minutes or more between rows, 30s off each edge, newest 32MB) is the user's own: logged as `changed-outside-session`, never asked (session fdce35ae: a version bump made in the IDE during a 4h33m gap). So is a change another session on the same checkout recorded as its own write: each actor file carries the project `root` beside `wrote`, and one written after this session's snapshot claims its paths for that session - logged as `changed-by-other-session`, never asked; a file this session wrote too stays its own, and a claim with no `root`, another root, an older write or an unreadable file claims nothing (2026-10-16: a read-only session was asked about a parallel session's migration). At `Stop` the ask also says its reply is the session's last message: the docs line, then the task summary in at most three lines (pilot 4: all 8 flow cells ended on 'docs ok'); a seat's `SubagentStop` ask closes on its reply being what the caller receives - the docs line, then the report its brief asks for, its `status:` / `contract_version:` lines unchanged (audit 2026-10-08 row 25) - and the hand-back ask on the report not being delivered: answer, then `SubagentHandback` again with the docs line first and the report unchanged; that retry passes and writes the `ask-answer` row (`via: handback`). With nobody at the terminal the hold and the Stop ask each write one `mode: unattended` row - once per kind per session, an exclusive `alfred-docs-unattended-<session>-<kind>` marker in the hook temp dir (audit 2026-10-20 H11: one per Stop and per held write, 61 in one session); with no watch entry and no new-module rule in any domain neither stop diffs the tree; the per-session state is written through a temp file and a rename, so a parallel call never reads it half-written; and past 2,000 dirty paths the ones a watch glob or a source root names are kept first. At `SessionStart`, before any domain check, it writes `<data root>/state/sessions/untracked-at-start-<HEAD sha>` ONCE per HEAD - the paths untracked when the change began, at most 20,000 (past the cap a path reads as the change's own), which the commit guard and `habits-commit-checkpoint` keep out of the change. Every later session on that HEAD (a resume, a compact start, a fresh-session hand-off, a `/clear`) reuses it, so an earlier session's new files stay the change's own; a commit moves HEAD, the next session takes a fresh one, and the guard falls back to the newest record until then. Only a first start (`source` startup, clear or none) snapshots, and it names the record in `<data root>/state/sessions/untracked-session-<sid>`: a compact or resume start reuses that record and never snapshots a HEAD the session itself moved (audit 2026-10-10 C09, session c6142301: a compact start after a checkout listed 7 of the session's own new files), and the commit guard reads the session's pointer first. Writing a record sweeps the ones past 7 days. It is named in one start line when it is not empty. Also at PreToolUse, before any domain check: a write to `<docs-path>/work/plans/<name>.md` stamped `Completed:` is denied unless every line it adds or removes is a stamp line (Gated, Approved, Conformance, Completed, Status, Deviations, Result) - an Edit by its strings, a Write against the file, a shell write always - except the close that ADDED the stamp: its own actor's writes to that plan pass until an ask is answered or a prompt typed after it (`closeStillOpen`, a temp-dir marker holding the transcript's size; the 2026-10-17 usage audit: the memories line written right after the stamp was denied) - since new scope after the stamp is a new plan file or a stated `ungated: <why>` (audit 2026-10-10, session 84eedb4b). Beside it (the user's ruling S3, 2026-10-20): while this session's ask-timeout marker stands (the answer hook writes it when an AskUserQuestion closes on Claude Code's idle timeout and clears it on the next answer or typed prompt), a main-session write that puts an `APPROVED` / `AUTO` line into `<data root>/state/approvals/APPROVAL` - a file tool, or a shell write carrying the word - is denied 'the question timed out - re-ask'; a delete of the stamp and every other flow file pass. Also before any domain check (a first capture writes before one exists): a main-session write under `<docs-path>/architecture/` - a file tool, a shell write, a `docs.js set` of an architecture ref - is denied while a capture analyzer seat (`architecture` / `code-quality` / `code-style` / `related-project` / `test-coverage-analyzer`, bare or `alfred-code:`) this session dispatched has not handed back: its tool_result, or for a background seat a DELIVERED task notification with a status, its `[Subagent hand-back]` message or a TaskStop naming it, read only on such a write and only past where the last read stopped (`seatsOut`, newest 8MB); held once per dispatch (the write sent again passes, a `seat-bypass` row), never for a seat's own call, an unreadable transcript or `_GATE=0` (audit 2026-10-20 C43, add5a91e: 42 reference Edits landed while a sixth analyzer ran; a replay of the 130 audit transcripts holds that one write and no other). `docs-session:block` / `:gate` / `:ask` in `ALFRED_CODE_HOOKS_OFF` switch the parts off (the old
    `ALFRED_CODE_DOCS_BLOCK` / `_GATE` / `_ASK` at `0` are read for the 2.x line, and an update folds them in). The engine's `ceilings [--prune]` lists the map's Known-ceilings rows that are closed (a revisit cell opening on lifted / closed / resolved / done) and moves them to `architecture/history/known-ceilings-closed.md`, one appended table, through `set` with the section's own hash - the register only grew before (audit 2026-10-20 C27, the user's ruling 'prune only'); a row whose `where` path (holding a '/') is gone is named `stale` and kept, never moved, since a rename or move in a refactor leaves the shortcut in the code.
  - `preferences-session.js` (PreToolUse on Read/Edit/Write/MultiEdit/NotebookEdit/Grep, every MCP call (a navigation server's
    two edit tools and five lookups read by tool name, N6), LSP, Skill and the shell route, the file and shell rows run inside
    their dispatchers; `SessionStart`, every source; `SubagentStart`; `UserPromptExpansion` on the run names) - the user's
    preferences docs under `<docs-path>/preferences/` bind every actor, and a rule only asks for the read (the user's rulings
    of 2026-10-21: `alfred-preferences.md` is a read-on-trigger pointer, this hook makes the read happen). The FIRST file edit
    of each actor (the main session, and each seat by `agent_id`) is held until the code docs that exist were read -
    the entries of `PERSONAL-CODE-PREFERENCES.md` and `ARCHITECTURE-PREFERENCES.md` whose `Scope:` reaches the target
    (`scopeOf`: preferences.js's glob reading, a glob with no `/` matched on the file name, a path with none matching
    everything under it; a plain area or no `Scope:` reaches every edit), each without its `Check:` line, then
    `PROJECT-CODE-PREFERENCES.md`'s sections that cover the target plus its cover-less ones, the other entries and sections
    only named (a later edit a not-yet-handed entry or section reaches waits again). The user's two docs have no doc cap
    (the user's ruling of 2026-10-22: the hand-over is capped, never their docs): an entry that does not fit the room stays
    unmarked and the retry hands it over, every doc after it waiting its turn (`codeParts` `later`), and only an entry no
    room holds whole is cut once with a Read line - `preferences.js lint` fails one past 5,000; a designer's start, which has
    no retry, names what did not fit. A glob reaching no file would hide its entry from every edit, so `preferences.js lint`
    notes it and every update names it (`docs.deadScopeLines`, through the capture's `deadScopes`; the hook reads
    `Scope:` through the script's own `scopeOf`, one reader since review 2026-10-23, so the two cannot drift); a glob aimed at the wrong EXISTING folder no script can
    judge, so `preferences.js reach` shows what each `Scope:` takes (count, file types, three paths - the capture reports
    it; the capture asks the user to confirm each new glob's reach) and `lint` and every update name a `Check:` that measures files its `Scope:` does not reach (`reachIn`, `docs.mismatchLines` through the capture's `scopeMismatches`) - and the FIRST git write (`shell-writes.js` `gitMutates`, plus a branch, tag or worktree branch made by
    name, `gh pr merge` / `create`, `gh release create` / `edit` / `delete`, and text naming git that `gitText` could not read)
    until `GIT-PREFERENCES.md` was, read live with its `<!-- locked: <key> -->` entries first as the SEED states them (an
    edited copy is named, never handed over as locked). The denial HANDS THE DOCS OVER, so a retry is all it costs; both
    holds share ONE room when one command triggers both, git first (`INLINE_CAP` 7,000 of pasted text, the names of what was
    left out capped at 700, the rest named as a `node .claude/hooks/docs.js show <ref>` line when the engine and
    `preferences/watch.json` are there, else a Read line). Only a WHOLE read marks a doc read (audit 2026-10-21 H-Q1): a Read
    with no range or one reaching its last line, a whole-file shell reader naming it (no `head`, `grep` or pipe into one), a
    `docs.js show` of each of its sections. A judge (`JUDGE`: an `agent_type` ending `solution-designer` or `-verifier`, or
    one of the four finding seats `code-quality-analyzer`, `security-auditor`, `integration-reviewer`, `output-scorer` (the grader is handed the code docs it grades a plan against, AC27) - `alfred-code:<seat>`
    always, a BARE name only where the install stamp's `library-agents:` line records its copy (`copiedSeats`: the copy
    route; none on the plugin route), so another plugin's or the project's own `security-auditor` is no judge: side notes
    of 2026-10-22, the user's rulings 'Alfred's own, all judges' and 'drop the names') holds no edit tool (checked against `meta/seat-tools.json`), so no edit hold reaches it: `SubagentStart` hands it the code
    docs, every project-doc section the room fits, and marks them in its record; the entries one room could not hold come
    with its first reads (the user's ruling of 2026-10-22) - each Read, Grep (`path`) or LSP call (`filePath`) outside the preferences folder - a held Grep's denial adds
    `GREP_STEER`, locate through the navigation tools (the LSP), Grep only for a literal already located (the user's
    ruling 'Hold both, steer off Grep'; Grep rides `file-guards.js`, LSP its own row) - and each
    navigation-server symbol lookup (`NAV_READ`: `find_symbol`, `find_referencing_symbols`, `get_symbols_overview`,
    `find_declaration`, `find_implementations` - a seat told to locate before it reads may never call Read), and each
    shell read of a file (`shellReads`: `cat`, `sed`, `head`, `grep`, `rg` ... with an argument naming a path on disk outside
    the preferences folder - as written, through a variable the command itself sets (`scanShell` `expandVars`), or as a glob
    one entry matches; never `wc`, `ls`, a pattern or a sed / awk program; a search given no path, `rg` reading no pipe or
    `<` input or a recursive `grep`, reads the folder it runs in, as the Grep tool does; so does a reader `find -exec` or
    `xargs` runs, and a `Select-String` fed by a file listing; a grep word earns the steer too - the user's answer 'Stale
    run + cheap shell cases'; a computed path `$(...)` and an inline script `node -e` stay unseen, the next visible read
    holding instead), is denied with the next part
    until every entry has come, so an install whose docs fit one room sees no Read held. The main session's RUN - the last
    `capture-` / `loop-` / `task-` / `issue-` skill, `review-code` or `review-security` (or a built-in `code-review` /
    `security-review` the user types) it started, bare - is kept in its
    record: from a `Skill` call, or from `UserPromptExpansion`, since a typed command makes no Skill call
    (code.claude.com/docs/en/hooks, read 2026-10-22: typing /name bypasses PreToolUse); a skill that is no run leaves it.
    A review run (`REVIEW_RUN`: `review-code`, `review-security`, the two built-in reviews and the code and architecture quality captures and loops) is the
    main session reviewing without an edit, which no edit hold reached (the user's ruling 'Hold its first review skill'):
    its first Skill call is denied with the code docs in parts, a typed one is handed them at its expansion, and the main
    session's reads then hold like a judge's until every entry has come. A design run (`DESIGN_RUN`: `task-design`, `issue-diagnoser`,
    `task-build-from-scratch`; item 4, 2026-10-25) ends in a plan and may never make a scoped edit, so its chat load - the
    Skill call or the typed expansion - is handed the code docs as `additionalContext` beside the skill's text and never
    denied: one room (`INLINE_CAP`), the rest named one `read <doc> '<entry>'` line each (capped at `NAMED_CAP`), only what
    was pasted whole marked, so the actor's first scoped edit still hands the rest; a seat's load gets nothing new. The architecture analyzer is handed
    `ARCHITECTURE-PREFERENCES.md` alone at its start, told to report a departure as a smell by id, only inside an
    architecture quality run (`ARCH_RUN`; the user's ruling 'Hook pushes the arch doc', which replaced the brief's
    hand-listed entries) - the map capture, the solve flow's scoping pass and the version upgrade dispatch the same seat
    to describe the code as it is, so a side note of 2026-10-22 kept them out (up to 7,000 chars per module seat, and a
    smell the map should not carry; the user kept it, 2026-10-22); a seat handed it keeps an `arch` mark so its reads bring the rest.
    Where no hook ran, the quality brief opens with `Run: architecture quality` and the seat reads the doc itself on that mark
    (the user's answer 'Yes, the brief marks the run'). The run ENDS at
    the user's next typed turn - any but the run's own `<command-name>` row; a skill body, a summary, a command's output, a
    notification, a hand-back frame, a `!` shell row, an Esc's interrupt marker (a user row with no `isMeta`, measured) and a
    tool result are no turn, nor a reply that only says go on (`GO_ON`: continue, go on, proceed, carry on, resume, keep
    going, yes, ok - the user's answer 'Keep go-on replies', after a side note that a typed 'continue' after an Esc ended
    the run) (`typedTurn`) - checked only where it matters, an analyzer's start and a
    reviewing main session's held read, from the transcript offset the record took when the run started (`runAt`,
    `runFile`; the user's answer 'Transcript check at the hold', so no hook runs per prompt); an ended review run is dropped
    from the record, and a transcript that cannot be read keeps the run. A compaction keeps the run and the `arch` mark, a
    `/clear` ends both. Any other typed message ends it; a later analyzer then reads the doc on the brief's mark. The actor key
    drops an `agent-` prefix, since the documented examples spell one seat's id with it on one event and without it on
    another. Any other seat gets nothing there: the other analyzers and diagnosers record or diagnose rather than judge
    against the preferences, so alfred-preferences.md alone points them at the docs. The record is per actor, `<data root>/state/sessions/preferences-<session>-<actor>.json` (the OS temp
    dir when that cannot be written, and a one-line note instead of a hold when neither can), written through a temp file and
    a rename and swept past 7 days (`sweepStale`); a `compact` or `clear` start deletes that actor's marks, since the summary
    dropped the docs (a compaction keeps the run and the `arch` mark), and a seat's own compaction - which runs the SessionStart hooks inside the seat, the payload carrying
    its `agent_id` (loading audit 2026-10-21 G3: 77 of 77 seat compactions) - deletes only its record and pushes nothing.
    `PERSONAL-PREFERENCES.md` - how the user wants the assistant to work (the user's ruling of 2026-10-21: loaded at session
    start and present after a compaction) - binds every main turn, so every main SessionStart (startup, resume, clear,
    compact, fork) PUSHES it as `additionalContext`, comment lines dropped, cut at a line past `PUSH_CAP` (3,200;
    preferences.js lints the doc at 3,000) with a Read line naming the rest; a resume or fork pushes it again (ruling G7: the
    duplicate is cheaper than a session without it); a missing doc, an empty one or one with no `##` entry pushes nothing, and
    the rule says to read it before the first reply when the push is missing (the hook off, `minimal`). A seat answers the
    main session, never the user: nothing is pushed into one.
    THE TOOL ORDER (tool preferences phase 1, 2026-10-24; spec `docs/superpowers/specs/2026-10-23-tool-preferences-design.md`,
    machine-local): after the personal doc, every main SessionStart pushes the capture-preferences script's `toolsLine`
    (`stack/skills/capture-preferences/scripts/tools.js`, required from `../skills/` beside the hook; absent, the line is
    absent and every other push stands) - one line per job, its ranks from `TOOLS-PREFERENCES.md` or, for a job the doc
    leaves out, the adapter table's defaults (`tool-adapters.json`, built from `meta/tool-adapters.json`), each rank the
    doc chose that this machine cannot reach named once and left out - a DEFAULT rank the actor cannot reach is left out
    unnamed, the normal state once the stack shipped no server (no-MCP plan Task 11, 2026-10-24: the line named two or three
    servers the user never had at every start) - each job with its `ToolSearch select:` load line (the memory tools' line
    lives here alone since memory-session retired, 2026-10-24). A malformed doc - its shape, never a tool this machine or this pin lacks, which only skips that rank - states only the entries
    that resolve plus three of its problems, never a default; an over-cap one states nothing but its problem. The line has its own
    cap (`TOOLS_LINE_CAP`, 4,000 chars): past it the Load clauses go, then the tail, so the personal push before it and the
    line together stay well under Claude Code's hook-output cap. Once
    per project with no doc it suggests `/capture-preferences tools` (`suggestOnce`, a `<data root>/state/tool-preferences/
    suggested` marker; one that cannot be written says it again). Every SubagentStart but Claude Code's two guides
    (`claude-code-guide`, `statusline-setup`) gets the seat's own order after any doc push: a seat whose definition the hook
    finds - the core's `stack/agents/<seat>.md` for `alfred-code:<seat>`, else the project's `.claude/agents/<name>.md` -
    only the ranks its `tools:` / `disallowedTools:` grant, with no load line when it has a `tools:` line; any other seat
    the main session's, no suggestion; a seat's own compaction re-sends its order. `preferences-session:tools` in
    `ALFRED_CODE_HOOKS_OFF` switches the line off and nothing else. Measured on a default install (no doc, no
    server, 2026-10-24): 364 chars at a main start - LSP and WebFetch are deferred built-ins (`deferred` in
    meta/tool-adapters.json), so each carries its own `Load: ToolSearch select:` clause, the one the navigation rule and
    LOAD_NAV point at (final review B2; 303 before it) - 303 at a verifier's or an implementer's, which load none, 225 at
    the evidence gatherer's; 846 at a main start with the record's serena, context7 and memory-service registered (1,104 /
    603 / 450 with 2.10.0's three stack plugins, against the 207 / 321 chars of the memory line it replaced).
    THE HOST'S SHELL TRAPS (audit 2026-10-14 RU13, the user's ruling; here since memory-session.js retired on 2026-10-24): every
    push it makes at a start - a main session's, every seat's (the guides' too) and a seat's own compaction - ends on THIS host's
    `hostLines`: the Windows Git Bash line on win32, the two zsh lines under a zsh `$SHELL`, nothing on bash, so a start with
    nothing else to push still says them. They left the always-on `alfred-navigation.md`; a per-host hook line is no per-OS
    rule copy (`rule-prose.test.js` M68). `preferences-session:host` in `ALFRED_CODE_HOOKS_OFF` drops them and nothing else.
    Its stdin is read as the guards read theirs, `fs.readFileSync(0)` (the file and shell dispatchers run it in-process, which a
    bounded async reader cannot serve); Claude Code closes the pipe after the payload.
    Each doc is read where it first sits - the session's folder,
    its checkouts up to the git top level, then a linked worktree's main checkout (`hook-prelude.js checkoutsOf`), which alone
    holds the two personal docs git keeps out (audit 2026-10-21 Q-1; `preferences.js` reads the same way); a doc that is a
    link where it first sits is never read, nor passed over for another copy (PF-1: a cloned repo could point one at a
    credential store). A target in a seat's `.claude/worktrees/<n>/` is judged as the project path it mirrors. Exempt
    targets: outside the project, the data root and the docs root (bar the plan folders - a plan under `work/plans/` is
    held), `.claude/` and `.git/`. It holds with nobody at the terminal - it asks nothing, it hands content over - writes one
    block row per hold (`kind` `code`, `git` or `git+code`), and fails open: malformed state reads as no record and is
    rewritten.
  - A workspace child's start and writes (release 3, 2026-10-27; `layout.js` resolves every path, the switch at `0`
    turns all of it off). `docs-session.js` names each linked ancestor whose docs root holds a domain, nearest first -
    `Workspace root docs (read-only): <abs docs root> - <areas>`, the areas by `docs.js domains()`'s rule - in the main
    session only, and in a child with no domain of its own too; `ignore docs root` here or in a nearer member drops it.
    `preferences-session.js` reads a doc the child lacks from each ancestor's preferences folder after its own
    (`layout.ancestorPrefsDirs`, `ignore doc <file>` skipping one) and points a hold at it by absolute path, and its main
    start adds the workspace root's memory index: `Workspace root memory (read-only): <dir>/MEMORY.md`, then the first 60
    lines, 6 KB of UTF-8 and the room the personal doc, the tool order and the host lines left of 9,500 characters, each
    cut at a line, the path alone under 300 left (Claude Code swaps a hook context past 10,000 characters for a preview).
    `guard-cross-project-write.js` denies a write into ANY linked member's memory folder before the account-dir allowance,
    with no allow route (branch `ancestor-memory`, the block naming the child's own memory); a folder the child also owns
    stays writable.
  - `history-session.js` (`SessionStart` + `Stop`) with its engine `history.js` (copied beside it, not
    wired; its Stop process also runs the turn build check, above) - a machine-local record per session under `<data root>/state/history/` (no `.gitignore` of its own since 2026-10-13 - the data root's
    one file keeps it out, and an update removes the `*` file earlier releases wrote; no `watch.json`, so no docs domain): at `Stop` it
    reads only the transcript bytes past a stored offset (8MB at most per pass) and keeps the commits since
    the session's start sha, the files left dirty, the plan file written (project-relative, or `~/` under the home
    directory) and the user's AskUserQuestion answers (credential shapes scrubbed, 300 chars each, 60 kept); its git
    calls run lock-free (`GIT_OPTIONAL_LOCKS=0`) at 1.5s each, so five stay inside the 10s timeout (audit 2026-10-08);
    at `SessionStart` it injects the last
    `ALFRED_CODE_HISTORY` records of the SAME branch (a count since 2026-10-21, item 10: seeded 3, at most 10, `history.js
    historyCount`) in at most 150 chars plus 150 per record (600 at the seed - a flat 200 per record left no room for one
    record beside the ~160-char frame), framed as history, never instructions - a record that read no
    transcript row and holds no commit, ruling or plan takes no slot, and a plan no longer on disk is left out (audit
    2026-10-10 C23); a plan still on disk carries where it stands NOW (`planStates`, the user's run order of 2026-10-28:
    the next session had to open the plan to find its next task) - `(<done>/<all> done; <its Resume: line>)` from the
    habits-plan-writing cards (counted only beside a `status:` line - a superpowers plan's `### Task N:` headings carry
    none, and a finished one read `(0/N done)`) and the Resume: line that skill rewrites after every tick, or `(completed)` once its
    `Completed:` line is there - read from the plan as the block renders, never recorded at Stop, the Resume: text
    scrubbed and cut at 80 chars; another format, no regular file (a fifo would hold the start), an unreadable one or one
    over 1 MB keeps the path alone; a question is
    shown once, at its newest answer, and past the cap the ruling lines leave round-robin across sessions, each session's
    newest kept longest, then the older sessions' plan states (oldest first), then an older session's own line (audit
    2026-10-11 SD16, e90a1845: the older session's rulings were cut whole and re-asked), and the newest session's plan
    state last, its Resume: text before its count - and prunes past 200 records or 180 days. No model call, fail-open, `ALFRED_CODE_HISTORY=0` off (nothing recorded or injected); an update moves the stack's
    old on seed `1` to `3` (`history-switch-is-a-count`).
    THE STATUS FILE (session-inspector, the user's contract of 2026-10-29; the sections cited are its spec's):
    `session-status.js`, a module with
    no stdin carried beside the hooks (`HOOK_MODULES`, lint's ENGINES), keeps `<cwd>/.claude/session-inspector/status/<session
    id>.json`, schema 1 - `schema`, `session`, `fullContext`, `updatedAt`, `model`, `window`, `resumeAt`, `autoRun`,
    `scorer`, `handoffPrompt`, a public contract that only ever gains fields. The base is the live `cwd` (A1), written only
    when it is the project's own (inside its root, or a linked worktree of its checkout - A8), the id matches
    `^[A-Za-z0-9_-]{1,128}$`, the payload is no seat's and no `session-inspector` / `status` folder is a link (section 1).
    The fields are fresh-session's own numbers, `autoRunFor` (one decision with guard-answer's line - stricter than
    `autoStampLive`, the stamp must name the session), `scorerState` and the newest open plan's `Resume:` text from
    `history.js openPlan` (section 2, 3; null while `ALFRED_CODE_HISTORY=0`). `fullContext` reads `compact` wherever no
    fresh session is offered - `autoRun` true, or nobody at the terminal (`hook-prelude.js unattended`, which also reads
    the hand-written `AUTO` stamp `autoRunFor` refuses) - else fresh-session's rule; a Stop whose second read finds
    `autoRun` changed rebuilds. Written at SessionStart (always), at Stop
    when a field but `updatedAt` changed (an unchanged file over 24 hours old gets its mtime moved) and at
    guard-answer's prompt when auto-run or the scorer changed - tmp plus rename, a failure swallowed (section 4, 5). The
    gates are this hook's (`historyOff`, Cursor), so `HOOKS_OFF=history-session` stops it at all three events. The
    SessionStart prunes every status file past 7 days (`now - mtime > 7 days`, the session's own kept) under the `cwd` and
    each base in `<data root>/state/sessions/status-folders.json` (at most 32), and puts an anchored
    `/<rel>/.claude/session-inspector/status/` line under `# alfred-code: session-inspector status files` into the common
    dir's `info/exclude` - one `gitSafe` spawn per common dir, none past 8s of the process (section 6). Each write leaves a
    `status-write` probe row (`ok`, `slow` past 200ms, `failed`), an exclude that failed or came late a `status-exclude` one.
  - `forge-session.js` (`SessionStart` + `SubagentStart`, PostToolUse on the shell route and every MCP server outside the
    stack, `Stop`) with its engine `forge.js` (a library, the classifier) and `forge-lexicon.json` (the vocabulary, overlaid by
    `<data root>/forge-lexicon.json`) - the forge-neutral half of the git gates (spec 2026-10-23, the user's rulings: concepts,
    not a list of CLIs or servers). `forge.js` reads any call as a concept by its WORDS - a CLI's noun then verb, an API
    call's method and path, an MCP tool's name and its selector values - so `guard-ungated-commit.js` gates a merge or a
    branch write on every transport and `preferences-session.js` holds the first one; a forge noun with no known verb is
    `unknown` (an ask, a deny when unattended). On the MCP route a branch, tag, file or release word counts only on a
    FORGE-SHAPED server (repo coordinates in the input, a forge word in the key with no local `repo_path`, or launched as
    a forge server) - Supabase branches, Sentry releases and AWS tags are not forge calls (final review F3). Every publish
    the gate allows, the push half off included, is ledgered in `<data root>/state/forge/ACTS-<session>.jsonl` under the
    REPOSITORY's root (`forge.js ledgerRoot` - a worktree and its main checkout share one), a `git push` one row per
    ref it names (`forge.js pushTargets`), each with its `tool_use_id`; the watch trusts a row once its PostToolUse
    confirmed it.
    The hook itself: one line under 200 chars at start (the remote, its host and kind, the forge CLIs on PATH, the MCP
    servers that are forge servers by launch command or URL, never by name, the watch state); then the REF WATCH -
    a detached `--snapshot` child takes the baseline (`REFS-<session>.json`, every branch and tag by `git ls-remote`,
    `GIT_TERMINAL_PROMPT=0`, ssh BatchMode, 6s cap); PostToolUse after a merge, branch write, release or unknown call
    re-reads and blocks on a LOUD move no act covers; `Stop` diffs once more when the turn ran anything but a known read
    (an allowlist of read tools), a PostToolUse marked the cycle (a seat's call), or the last turn left background work
    running. An act covers the ref it aims at; one naming no ref lands ONE move (at its head, else the single loud
    candidate - with several it covers none and says so); an armed auto-merge persists across turns until it lands.
    Loud: the default branch, the upstream, a branch GIT-PREFERENCES.md names in backticks, a commit a local branch holds, any
    tag - blocked once per cycle; the rest is one summary `systemMessage`. An ASKED act covers nothing (Task 6 ruling,
    revising Task 2's). `REFS-LAST.json` carries the end snapshot to the next session, which reports only after an
    asked call. Unreachable is `not checked (<why>)`, never clean. `forge-session:watch` in `ALFRED_CODE_HOOKS_OFF` off,
    `ALFRED_CODE_FORGE_WATCH=loud-only` drops the summary (the session line says so). A check that fails or takes over 3 s
    (a key waiting for a touch, an approval dialog) pauses the catch-all for 30 min (`PAUSE-<session>.json`, said once);
    a turn marked `strong` (a forge call, a gated push PostToolUse confirmed) still checks, an answer within 3 s lifts
    it, and `publish-only` holds the catch-all to those turns. A held turn marks the baseline `skipped`, so the next
    diff says `since the last check`. A quick key tap never trips the pause (timing cannot tell it from the network), so
    the first check over an SSH remote names `publish-only` once per repo (`SSH-NOTICE.json`). The start snapshot reads
    HEAD and the refs in ONE call. Evidence: `docs/forge-routes-evidence.md`, 'The pause and publish-only'. The verified routes it is tested
    against are `scripts/fixtures/forge-corpus.js`.
  - Formatter after an edit: DECLINED (hooks audit 2026-10-08, coverage map) - no measured incident; formatting is
    the project's lint and the verifier's job, and a PostToolUse formatter rewrites files under the model between its
    own edits, so the next `old_string` misses.
  The guided walk's hooks layer makes them selectable, the whole catalog recommended (a selection with
  no `hook` lines keeps every hook on; the install phase's None emits `hook none` through `stack-select.js
  --hooks-answered`, that phase only, which switches every hook off).
