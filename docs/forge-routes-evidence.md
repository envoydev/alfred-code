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

`glab mcp serve` also exists in glab 1.124.0 (marked deprecated in favour of GitLab's hosted server, still shipping), so
`glab mcp` is one of the launch marks that list a configured server as a forge server in the session line. tea ships no
MCP command.

## MCP routes - from each server's documentation

The MCP rows in the corpus take their tool names and operation selectors from each server's documentation: GitHub's
`github-mcp-server`, GitLab's hosted server (`/api/v4/mcp`) and `@zereight/mcp-gitlab`, `@azure-devops/mcp`,
`gitea-mcp` and Atlassian's Rovo server. The classifier reads them by their words, so a server keyed under any name, or
one nobody listed, classifies the same way. What Claude Code actually sends is the stub-session probe below.

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
2,003 transcripts, 149,034 calls (139,239 shell, 9,795 MCP, of which 2,716 were the stack's own servers and never
classified).

| Read as | Calls | Checked by hand |
|---|---|---|
| merge (a publish) | 10 | All 10 are real `gh pr merge <n>` calls; the receipt heredocs around them are prose |
| create | 13 | All 13 are real `gh pr create` calls |
| release | 1 | A real `gh release create` call |
| an ask (unknown verb) | 7 before the fix, 0 after | See below |
| read, watch, pipeline, annotate | 1,574 | Never gated |
| not a forge call | 147,436 | - |

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
| Fresh install, copy route | `forge-session.js`, `forge.js`, `forge-lexicon.json` copied; `settings.json` wires forge-session at SessionStart, SubagentStart, PostToolUse (`Bash\|PowerShell` and the non-stack `mcp__` pattern) and Stop, and the commit guard at PreToolUse for shell and non-stack MCP calls; `ALFRED_CODE_FORGE_WATCH=all` |
| Fresh install, plugin route | `ALFRED_CODE_HOOKS_OFF` does not name forge-session (the core plugin runs it) |
| Re-run (install, update, update) | Second update changes 0 files on both routes; the first changes only the stamp's `action:` line |
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

## The 6 s ls-remote cap

A fake ssh command slept N seconds, then served the bare repository (`core.sshCommand`, answering git's `-G` probe at
once). Under the cap the snapshot holds the refs; at and over it the watch says not checked, and every call returned
within 6.03 s.

| Delay | Result | Wall time |
|---|---|---|
| 4.5 s | ok | 4,538 ms |
| 5.9 s | ok | 5,947 ms |
| 6.0 s | not checked (no answer within 6s) | 6,013 ms |
| 6.1 s | not checked | 6,010 ms |
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

## Not run

- A plugin-provided MCP server in the stub probe (its `mcp__plugin_<plugin>_<server>__` names are read from past
  transcripts instead), and an interactive session in `auto` mode answering a hook's `ask`.
- The Sonnet probe: a GitLab-only temp project, 'merge it once CI is green' repeated. Billed, and not chosen.
- The cost rows on the Windows VM.
- The Atlassian Rovo server's action field name and GitHub ignoring push options remain unverified from the docs alone.
