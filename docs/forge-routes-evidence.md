# Forge routes evidence - the routes forge.js reads, and how the forge-neutral branch was proven

`stack/hooks/forge.js` reads every shell and MCP call as a forge concept (merge, branch write, create, release,
annotate, pipeline write, watch, read) through the WORDS in `stack/hooks/forge-lexicon.json`, never a list of CLIs or
servers. `scripts/fixtures/forge-corpus.js` turns each route below into a classifier fixture, so a lexicon change that
breaks one fails `scripts/forge-classify.test.js`. Measured 2026-10-23 on macOS (arm64) with Claude Code's hook
payload shape; the CLIs ran in the `node:22` Linux image the local gate uses.

## CLI routes checked against each CLI's help

Each corpus row's CLI was installed at its latest release in a `node:22` arm64 container (gh 2.103.1, glab 1.124.0,
tea 0.16.0, azure-cli 2.91.0 with the azure-devops extension 1.0.10). A row passes when `<cli> <words> --help` exits 0
and the help names every flag the row uses. Result: **60 of 60 pass**.

| CLI | Rows | Commands and flags checked |
|---|---|---|
| gh | 23 | `pr create` (`--fill`), `pr new`, `pr merge` (`--squash --auto --rebase --admin`), `pr review` (`--approve`), `pr comment`, `pr edit`, `pr close`, `pr revert`, `pr view` (`--json`), `pr diff`, `pr checks` (`--watch`), `pr list` (`--state`), `release create / edit / delete-asset / upload`, `run list / view` (`--log-failed`) `/ watch` (`--exit-status`) `/ rerun` (`--failed`) `/ cancel`, `workflow run` (`--ref`), `api` (`--method --raw-field --field`) |
| glab | 18 | `mr create` (`--fill --auto-merge`), `mr new`, `mr merge`, `mr accept` (`--squash`), `mr approve`, `mr update` (`--ready`), `mr view / show / diff`, `release create / delete` (`--yes`), `ci status` (`--live`), `pipeline status` (`--wait`), `ci trace / retry / run` (`--branch`) `/ cancel`, `api` (`--method --field --raw-field`) |
| az | 12 | `repos pr create` (`--auto-complete`), `repos pr update` (`--status --auto-complete --bypass-policy --bypass-policy-reason --title`), `repos pr set-vote / show / list`, `pipelines run / build queue / runs list / release create`, `repos ref create`, `devops invoke` (`--area --resource --http-method --in-file`), `devops configure` (`--use-git-aliases`, the `git pr` alias) |
| tea | 7 | `pulls create`, `pr merge` (`--style`), bare `pr`, `releases create` (`--tag`), `actions runs list`, `actions workflows dispatch`, `api` (`--method`) |

## Subcommands of the four CLIs

The corpus checks the routes someone wrote down; it does not show that a subcommand nobody listed reads right. In the
same container (gh 2.103.1, glab 1.124.0, tea 0.16.0, azure-cli 2.91.0 with azure-devops 1.1.0), a script walked
`<cli> <noun> [<sub>] --help` two levels deep under every forge noun and recorded each subcommand with the aliases its
help lists: **315 rows** (gh 42, az 80, tea 140, glab 53), kept as `scripts/fixtures/forge-subcommands.js`. Each
row is classified as `<cli> <subcommand> 1`. The first pass found **29 that asked** (an ask is a deny when unattended):
`tea pulls m` / `c` / `e` and its other short aliases, `glab mr note`, `gh pr lock`, `glab mr subscribe` / `todo`,
`az repos policy approver-count create`, `az repos pr work-item add` and the like. The lexicon gained `shellVerbs`
(short aliases keyed by the object's class) and the missing annotate words. The classifier now reads a review or
annotation noun after a change noun as part of the object, and skips one sub-group word before a verb, but never onto a
merge or a push: `yarn run build git push` is a script's arguments. After that: **0 ask**, and the only publishes are
`az repos ref create / delete`, `gh pr merge`, `glab mr merge`, `tea pulls merge` and `tea pulls m`.
`scripts/forge-classify.test.js` holds all 315.

`glab mcp serve` also exists in glab 1.124.0 (marked deprecated in favour of GitLab's hosted server, still shipping), so
`glab mcp` is one of the launch marks that list a configured server as a forge server in the session line. tea ships no
MCP command.

## MCP routes - from each server's documentation

The MCP rows in the corpus take their tool names and operation selectors from each server's documentation: GitHub's
`github-mcp-server`, GitLab's hosted server (`/api/v4/mcp`) and `@zereight/mcp-gitlab`, `@azure-devops/mcp`,
`gitea-mcp` and Atlassian's Rovo server. The classifier reads them by their words, so a server keyed under any name, or
one nobody listed, classifies the same way. What Claude Code actually sends is the stub-session probe below.

A change-request word and a push count on every server. A branch, tag, file or release word counts only on a
forge-shaped server: the input names a remote repository (`owner` + `repo`, a `group/project` path, a repository id),
or the server's key carries a forge word and the input names no local checkout (`repo_path`, an absolute path), or the
MCP configs launch it as a forge server. So Supabase's and Neon's `create_branch`, Sentry's `create_release`, AWS's
`tag_resource` and a local git server's `git_commit` are not forge calls, and are neither denied nor asked.

## Stub-session probe - the real payload, no model

Claude Code 2.1.309 ran `-p` in a copy-route install with its own `HOME` and `CLAUDE_CONFIG_DIR`, a dummy API key and
`ANTHROPIC_BASE_URL` pointed at a local Messages API stand-in that scripts three calls on a stdio MCP server: a merge
(`merge_merge_request`), a read (`get_merge_request`, declared `readOnlyHint`) and a verb no lexicon word knows
(`frobnicate_merge_request`). A recorder hook logged every payload beside the installed hooks. No model was called.

- The PreToolUse payload carries `tool_input` verbatim and `mcp_server: {name, source}` - `source: "dynamic"` for a
  `--mcp-config` server, `"project"` for one in `.mcp.json`. A server keyed `work forge` is named `mcp__work_forge__*`
  in `tool_name` and `work forge` in `mcp_server.name`.
- Tool annotations (`readOnlyHint`) do not reach the hook, so the classifier cannot lean on them.
- In all five permission modes (`manual`, `auto`, `bypassPermissions`, `dontAsk`, `acceptEdits`) the installed commit
  guard refused the merge, let the read run (its PostToolUse fired), and refused the unknown verb as unattended.
- A hook answering `ask` in print mode is refused in every one of those modes, `bypassPermissions` included - so the
  guard's deny-when-unattended is what the CLI would do with the ask anyway.

## Replay over past sessions

Every shell and MCP call in the local transcript store was replayed through `classify` as the commit guard would see it:
2,004 transcripts, 149,337 calls (139,541 shell, 9,796 MCP, of which 2,717 were the stack's own servers and never
classified). The replay ran again after the final-review fixes, with the same counts in every row.

| Read as | Calls | Checked by hand |
|---|---|---|
| merge (a publish) | 11 | 10 are real `gh pr merge <n>` calls (the receipt heredocs around them are prose); 1 is the final reviewer's own probe script, which embeds `gh pr merge` in a heredoc |
| create | 13 | All 13 are real `gh pr create` calls |
| release | 1 | A real `gh release create` call |
| an ask (unknown verb) | 7 before the fix, then 2 | The 2 are the final reviewer's probes of the raw-text interpreter scan (a heredoc fed to `node`) |
| read, watch, pipeline, annotate | 1,574 | Never gated |
| not a forge call | 147,736 | - |

Zero reads were classified as a publish. The 7 asks were 4 distinct inline-interpreter calls: python heredocs writing a
release-download link, an image link and a repository link into files, and a `node -e` printing one. An ask is a deny in
auto mode, so `forge.js` now reads a URL in inline code as a call only when the code holds a `requestCalls` word
(`fetch(`, `requests.`, `urlopen(`, `Invoke-RestMethod`, ...). Inline code using an HTTP client no word names goes
unasked; the ref watch still reports what it moved.

The replay also found browser tools named `*_run_code*` read as a pipeline write (768 calls). Nothing gates that
concept and the Stop already re-reads refs after any unclassified MCP call, so no behaviour changes.

## Temp-project matrix

Every case ran the installer from a clean export of the branch (`scripts/clean-export.js`) inside `seed-sandbox.js`'s
isolated `HOME` and `CLAUDE_CONFIG_DIR`, with a stub `claude`, and the written files were read back. Copy route =
`ALFRED_CODE_{SKILLS,HOOKS,MCPS}_VIA_PLUGIN=false`.

| Case | Result |
|---|---|
| Fresh install, copy route | `forge-session.js`, `forge.js`, `forge-lexicon.json` copied; `settings.json` wires forge-session at SessionStart, SubagentStart, PostToolUse (`Bash\|PowerShell\|Monitor` and the non-stack `mcp__` pattern) and Stop, and the commit guard at PreToolUse for shell and non-stack MCP calls; `ALFRED_CODE_FORGE_WATCH=all` |
| Fresh install, plugin route | `ALFRED_CODE_HOOKS_OFF` does not name forge-session (the core plugin runs it) |
| Re-run (install, update, update) | Second update changes 0 files on both routes. The first changes the stamp, and on the plugin route also writes `.alfred/serena/home/serena_config.yml` - an install from the branch's base commit writes the same file at the same step, so it predates this branch |
| Update over a 2.10.0 install | Both routes end with forge-session on - a hook new in the release defaults on, as in a fresh install |
| forge-session dropped | Copy route: no forge-session file or rows, `forge.js` and the lexicon stay for the commit guard. Plugin route: `ALFRED_CODE_HOOKS_OFF` names it |
| User's own config | A `settings.json` key, an `env` variable and a `PostToolUse` hook of the user's, and a `.mcp.json` server keyed `My Odd.Server-1`, all kept |
| Scopes | `local` writes every row to `settings.local.json`; `user` copy route keeps them in the project's `settings.json`; `user` plugin route as the plugin route |
| No remote | Line `Forge: no remote; ...; ref watch: off (no remote).`; the Stop is silent |
| Unset, `loud-only` and garbage `ALFRED_CODE_FORGE_WATCH` | `on`, `loud-only` (summary tier dropped), and `on` |
| Malformed overlay | The line still goes out, a `systemMessage` names the ignored file once per session, and the commit guard still blocks an MCP merge |
| Odd-named forge server | `My Odd.Server-1` launched as `glab mcp serve` is listed by its launch command |

## Ref watch on a local bare origin

The installed `forge-session.js` ran with real hook payloads against a local bare repository as `origin`, while a
second clone moved refs as a teammate (or a tool that bypassed the gate) would.

| Scenario | Result |
|---|---|
| main moved, then a read-only turn (`git status`) | Silent - a read-only turn is not diffed |
| main moved, then a non-read turn | Stop blocks once: `Ref watch: main moved <a>..<b> this turn; no gated act explains it ...` |
| The same moves at the next Stop | Silent |
| A tag pushed | Stop blocks: `tag v9 appeared at <sha>` |
| A teammate pushes `feat/x` | `systemMessage` summary line, no block; dropped under `loud-only` |
| main moved after a ledgered merge act | Silent |
| An unreadable MCP verb, then main moved | The PostToolUse window blocks right after the call |
| origin gone after the baseline | `Ref watch: not checked (<git's reason>).` |
| A merge naming no base, then main lands and a teammate pushes `feat/x` | main explained (one landing); `feat/x` the summary line |
| The same merge, while main lands and this checkout pushes `feat/y` | Both loud, plus `one gated merge this turn explains at most one of: feat/y, main` - an ambiguous act covers neither |
| A push aimed at `feat/mine`, whose head also lands on main | `feat/mine` explained; main loud |
| `gh release create v3 --target main`, then tag v3 appears | Silent at PostToolUse and Stop - the tag is read from the verb's argument, never `--target` |
| A teammate branch this checkout fetched | The summary line, not loud - only a commit a local branch holds marks a move as this checkout's |
| A seat ran a build while the main turn only read | Stop blocks: the PostToolUse of the seat's call marks the turn dirty |
| A turn ends with a background task running, main lands after | That Stop is silent; the next read-only turn's Stop still diffs and blocks; once settled, a read-only turn is silent again |
| `SendMessage` in an otherwise read-only turn | Diffed and blocks - only an allowlist of read tools keeps a turn read-only |
| An auto-merge the guard ledgered (`merge_when_pipeline_succeeds`) | Silent at turns 1-3 and at its landing in turn 3; a second landing in turn 4 blocks |
| The guard ledgered a push whose call never finished (no PostToolUse) | Loud - an unconfirmed act explains nothing; the same push confirmed is silent |
| The push half of the guard off | Nothing gated, the push still ledgered, the Stop silent |
| A push from a worktree, the session in the main checkout | The act is ledgered at the repository root and explains `feat/wt`; no ledger in the worktree |
| Supabase / Sentry / local-git `create_branch`, `create_release`, `git_commit` | Neither denied nor asked, attended or not; `github__create_branch {owner, repo}` and `tea pulls m 3` are gated |
| `glab mr subscribe`, `gh pr lock`, `az repos pr reviewer add`, `tea pulls reject` unattended | Not denied |

## No credential prompt

`git ls-remote` runs `GIT_ASKPASS` (then `core.askPass`, then `SSH_ASKPASS`) even with `GIT_TERMINAL_PROMPT=0`. Against a
local stand-in that answers every request `401 Basic`, with a logging askpass program on `GIT_ASKPASS`, the watch's call
asked it for a username and then a password (git 2.56.0). The watch now clears both askpass variables, sets
`SSH_ASKPASS_REQUIRE=never` and `GCM_INTERACTIVE=never`, and passes `-c credential.interactive=false`: the program is not
called, and the watch reports `not checked (...)`. Each layer alone also kept it silent. On the installed hooks the Stop
answered `Ref watch: not checked (unable to get password from user).` and the program was not called, while a plain
`git ls-remote` against the same stand-in, with the same `GIT_ASKPASS`, called it. A stored credential (osxkeychain, a
credential store) still answers.

## The 6 s ls-remote cap

A fake ssh command slept N seconds, then served the bare repository (`core.sshCommand`, answering git's `-G` probe at
once). Under the cap the snapshot holds the refs; at and over it the watch says not checked, and every call returned
within 6.03 s.

| Delay | Result | Wall time |
|---|---|---|
| 4.5 s | ok | 4,551 ms |
| 5.9 s | ok | 5,955 ms |
| 6.0 s | not checked (no answer within 6s) | 6,020 ms |
| 6.1 s | not checked | 6,025 ms |
| 7.5 s | not checked | 6,019 ms |

## Cost

p50 and max of 10 cold runs (a fresh process each, as Claude Code spawns a hook) on macOS arm64, local bare origin. A
bare `node -e 0` is p50 23 ms.

| Row | 1 branch | 5,000 branches |
|---|---|---|
| PreToolUse commit guard, non-forge MCP call | p50 32 ms | - |
| PreToolUse commit guard, forge MCP read | p50 32 ms | - |
| PostToolUse, a call that opens no window (shell or MCP) | p50 34-38 ms | - |
| Stop, read-only turn | p50 49 ms | - |
| SessionStart (line, detached snapshot spawn) | p50 56 ms | p50 63 ms |
| PostToolUse strong window (ls-remote + diff) | p50 87 ms | p50 211 ms |
| Stop, non-read turn (ls-remote + diff) | p50 88 ms | p50 201 ms |

A real remote adds its own `ls-remote` time on top: this repository's GitHub origin measured p50 1,912 ms over SSH (the
handshake alone 1.4-1.7 s) and p50 571 ms over HTTPS, 10 runs each. Over past sessions, 61% of main-session turns
(1,616 of 2,650) ran a call the Stop counts as non-read, so that is the share of turns that pay one `ls-remote`. No
budget is set here; the numbers decide it.

## The pause and publish-only

Some git logins ask the user on every SSH connection: a security key that needs a touch, an approval dialog from the
agent app. `networkEnv`'s batch mode stops git's and ssh's own prompts, but not those, so a check at the end of most
turns could ask on most turns.

A time throttle was measured first and dropped. Over 365 past sessions (2,660 turns, 1,752 of them non-read), turns end a
median 698 s apart (p25 205 s, p75 2,146 s), so a 15 min throttle still checks 68% as often, and a 30 min one 57%.

What shipped instead:

- **The pause.** A check that fails or takes over 3 s - what a key waiting for a touch, or an approval dialog, looks like
  from git's side - pauses the end-of-turn check for 30 min, said to the user once a session. A turn that made a forge
  call or a gated push (the push's ledger act confirmed at PostToolUse) still checks, and an answer within 3 s lifts the
  pause. A held turn loses no move: the next check diffs against the same baseline and says `since the last check N min
  ago`.
- **The SSH notice.** A key tapped quickly answers inside 3 s, so the pause never trips, and timing cannot tell it from a
  slow network. An approval app gives no signal at all. So the first check over an SSH remote names the way out, once per
  repo: `ALFRED_CODE_FORGE_WATCH=publish-only`.
- **publish-only.** Checks the remote only after a turn that made a forge call or a gated push. A move is then reported
  at the next such check, not the turn it happened.
- **One call at the start.** The start snapshot reads HEAD's symref and every branch and tag in one `ls-remote`
  (`HEAD`, `refs/heads/*`, `refs/tags/*`), where it took two before. The refs and shas match the plain call, nested
  branches and annotated tags included.

On the installed hooks, with a fake ssh that sleeps a set time and logs each connection, the start snapshot made 1
connection. A Stop answered in 3.5 s gave the pause line, and the next Stop made no connection and stayed silent while
main moved. The forge call that followed was checked, blocked with `main moved <a>..<b> since the last check`, and lifted
the pause: 5 connections in all. The SSH notice showed once and not in a second session. Under `publish-only`, the session
line says `ref watch: publish-only`, a build turn stays silent and the forge call is checked. A user's own `publish-only`
survives an update on both routes.

## Not run

- A plugin-provided MCP server in the stub probe (its `mcp__plugin_<plugin>_<server>__` names are read from past
  transcripts instead), and an interactive session in `auto` mode answering a hook's `ask`.
- The Sonnet probe: a GitLab-only temp project, 'merge it once CI is green' repeated. Billed, and not chosen.
- The cost rows on the Windows VM.
- The Atlassian Rovo server's action field name and GitHub ignoring push options remain unverified from the docs alone.
