# Full spec - the check script's lookup

## What a full spec names

A FULL spec names the surface (an endpoint, a component, a table or a file), the observable behaviour, and how it
is verified (the tests or acceptance criteria). A request that misses any item, spans more than one stack, or
touches an auth, secret or payment path (access, visibility, ownership and personal data count) keeps every gate,
and so does any doubt. `scripts/spec-check.js` reads the request for all five.

## The check's lookup

Read first, on every size, to run the full-spec check - its `size floor:` line is the lowest size the
`Size:` line may state, and on `standard` its `spec:` and `path:` lines decide the merged path. The lookup reads this skill's own
copy of the script (`scripts/spec-check.js`): the project copy first, else the newest plugin-cache
entry that has it. The block prints nothing but the check's lines - one per item, then the path and the stop it means:

```bash
SPEC=.claude/skills/task-solve/scripts/spec-check.js
[ -f "$SPEC" ] || SPEC=$(for d in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/*/*; do   # one glob: zsh aborts the loop when any named glob matches nothing
  PN=${d%/*}; PN=${PN##*/}; [ "$PN" = alfred-code ] || continue
  f="$d/stack/skills/task-solve/scripts/spec-check.js"
  [ -f "$f" ] && [ ! -e "$d/.orphaned_at" ] && printf '%s\t%s\n' "$(basename "$d")" "$f"
done 2>/dev/null | sort -V | tail -1 | cut -f2)
if [ -n "$SPEC" ]; then node "$SPEC" <<'REQUEST'
<the user's request, verbatim>
REQUEST
else echo 'path: gated - spec-check not found'; fi
```

A script neither home has prints `path: gated`: keep every gate. A request that is only a ticket link gives the
check nothing to read - fetch the ticket first and put its title and type line above the link in the heredoc, or
`bug:` reads no on a bug. Fetch it by the run book's `Tracker access:` line when it names a route, before any
connector (audit 2026-10-20 C20: three sessions retried a connector the token route had replaced); a route that worked
where the line is absent or wrong is saved to memory and named in the close as the line to fill.

A request that is only a findings path (a diagnosis's `/task-solve <findings path>` hand-off) gives the check
nothing to read either: put `Type: bug`, the file's `Observable:` line and each `## Tasks` card's title, owned
files and acceptance criterion above the path in the heredoc - the bare path reads `bug: no` and `size floor:
trivial` on a diagnosed bug.

Two stop rules every size carries, since this file is the one read on every size: a bug's `Result:` adds
`Repro: <the reported error matched | differs: <what it showed> | not reproduced>`, and a question in the
arguments (is it built, is it still needed) is answered in the stop's first sentence, before the fields.

**Modes.** Auto-run, auto-compact and output scoring are modes the user turns on and off with the mode commands (`/alfred-code:mode:auto-run on`, `/alfred-code:mode:scoring on`); each stays on, new sessions included, until its off command, and a hook line on each prompt says which are on. Under the hook's auto-run contract, follow it. With no hook line (hooks off, a host that runs none), a mode is on only when the user said so in this conversation and holds for this conversation: under auto-run each stop takes its `(Recommended)` option, listed in the close, an unmarked one waits, nothing goes outward, no fresh-session hand-off; under scoring this run's output is graded before it is handed over. A `--mode-*` token after the command is no part of the request and switches nothing: drop it and say the mode commands replaced it.

A request whose named files exist only in a related project (the awareness doc lists its siblings) is settled
before the check - the check, the `Size:` line and every stop run in the repo that owns the task:

```ask
The files this names live in <sibling>, not here. Run it there: its checks and stops belong to the repo that owns it.
- 'I open <sibling> and paste the request there (Recommended)' - this chat stops here
- 'Run here with cross-repo writes allowed' - <what it would write there>
- 'Stop' - nothing runs
```

## The size re-check - before a trivial or small close

Before a trivial or small run's close stop, run the same script from the project root as
`node "$SPEC" --touched <trivial|small>` - the lookup block above with its heredoc call swapped for that
line. It prints ONE `size check:` line: the files the run touched (the tracked diff plus new files, minus
the stack's data root, `.claude/` and what was untracked when the change began) against the row's cap, and the
close's `Progress:` line quotes it. On `raise to standard` the size rises where the run stands - write
the plan folder's `<feature>.md` with the work as its tasks, then record it through `node .claude/hooks/plan-status.js`, in this order - the route has no step-3 ask, and a task is neither started nor closed on a plan that is not approved: `sync`; `approve` with `words:` the request that asked for the work, verbatim, and no `--mode`; per task `start --task <id>`, then `done --task <id>` with `result:` the command this run already ran and its quoted result. Then take standard's step-4 stop (the reviewer ask), step 5 and step 6, whose close runs `complete`; the small row's close is gone. Never edit `status.json`, `scoring.json` or an approved plan: the script is the only writer. Flat plans (until 4.0.0): a plan that is a single file is stamped in the file, by the closing section of the plan shape the build reads.

## The merged path

On `path: merged`, steps 1 and 2 are ONE step: the design and the plan audit both in this session
(neither twin asks its mode), no stop between them. A gap the audit finds that the spec settles is
fixed in the plan in the same step and named in the ask; a gap only the user can settle stamps the
gaps and takes step 2's stop. The approval ask that ends the step is `SKILL.md`'s.
