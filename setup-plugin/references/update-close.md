# /alfred-code:update - the close: AGENTS.md, the post-check, the clean-up

Read in the same call as step 3's `--log` call (`update-walk.md`), on the fast path and the slow path alike - the
installer has run, and this is the rest of the run.

## 6. Reconcile the project's AGENTS.md

Run the check first and paste its output - its rows (a named path that no longer exists, a command that does
not resolve, the template's own text still live) are this step's facts, whatever the reading below finds:

```bash
node "$TMP/repo/scripts/agents-md-check.js" --root .
```

Then read `$TMP/repo/stack/skills/habits-adjust-agents-md/SKILL.md` - the whole body, never a heading
diff (measured: a run that skipped it and diffed the `## ` headings left every improve-mode check unrun) - and follow it inline with
`<stack>` = the `$TMP/repo` path, pasted as a literal, exactly as the sibling `configure` command's step 13: its improve mode adds the
sections the template gained and OFFERS a fix for what its check reports (never in the recommended
option - a check row is heuristic, applied only when the user picks it), an older seed's rules list (a
`stack-rules` row) is offered for removal, the project's own prose is never overwritten, and every change is
shown before writing.
The installer touches the old names only where the stack wrote them: an instruction file it seeded and still
holds at its hash it rewrites from this release's template (`AGENTS.md: the unfilled seed refreshed ...`, `CLAUDE.md:`
on an install whose name answer was CLAUDE.md), and
the generated rules it re-spells (one `renamed: <file> - <n> ...` line per file) - report those lines. A file that is the project's own it only NAMES, and step 3's `--log` call carries
that as `warn: !! <file> is yours and names <n> old stack name(s) ...`. Never splice those by hand (audit
2026-10-11, session b3f8193f: a hand `sed -i` after an ask that showed no diff, on a file git did not track).
The re-spell is three numbered actions, in this order, never merged:

1. **Print the plan:** `node "$TMP/repo/scripts/update-preflight.js" --respell --root .` - `respell: none` asks nothing
   and ends here.
2. **Show the diff as reply TEXT** - its `respell:` / `-` / `+` lines verbatim in a fenced block in your own message,
   not left inside the tool result: the user sees a Bash result collapsed, and three re-spells were approved with the
   diff only there (audit 2026-10-20 C15, e31af926 and e43969a7). The ask goes out only after this message.
3. **Ask once:**

```ask
Re-spell the old stack names in <file>? The diff is in the message before this question, each line exactly as it will be written.
- 'Re-spell them (Recommended)' - each line exactly as the plan shows it, and nothing else in the file
- 'Leave them' - the file keeps the old names, which no longer resolve to a skill or seat
```

On a yes, the same call with `--apply` writes those lines alone and prints `respelled: <file> - <n> line(s)`
- report it. Unattended, take the Recommended option and log it.
The installer has also dealt with the file's name: on step 2's name answer (`--instructions-file`) it renamed each file
of the other name - root, `.claude/` and each part, `git mv` where git tracks it - and named any it left (a file of the
new name beside it); with no answer this run, an unedited `.claude/CLAUDE.md` an earlier release seeded moves to
`.claude/AGENTS.md` on an AGENTS.md install and an edited one is named. Report those lines, and never rename a file
outside that answer.

**Run the compare whatever the delta says** - the template being unchanged UPSTREAM says nothing about whether THIS
project's AGENTS.md still matches it (measured: a user asked it twice, verbatim, five and a half minutes apart, after
the old template-unchanged skip). When it comes back clean, say so in one clause and write nothing.

The step closes on ONE receipt line, which step 7 repeats verbatim: `agents-md: compare <clean|N additions> -
check <N rows>` - the sections the compare offered (`clean` when none) and the rows the check printed (`0
rows` when none). A close with no receipt is a step 6 that did not run (audit 2026-10-11, session 5b9ce9c5).

## 7. Post-check

Every line below is READ from something already in context - step 2's output, the one post-install grep, and the
step-3 `--log` call. Nothing here is stated from memory, and nothing needs another call but the hygiene check and,
after a cascade, the load check.

Report the version delta, then what THIS install refreshed: step 2's `changed-here:` line (the release's own
`changed:` beside it when they differ - 'skills 9 here of the release's 10'), naming the paths from the compare's own
`status<TAB>path` rows - never the installer's `installed/refreshed this run` counts, which are the SELECTION size.
Then the `--log` call's `renamed:` and `pruned:` lines VERBATIM (never a count from memory - measured: a close said
'Renamed: 35' against 34 in the log), each `taking over a copy the stamp did not record` line (an older stack copy
the run refreshed), the PLUGINS line (the plugin version moves), the ENVIRONMENT line, the
NEW-ITEMS line (what arrived, what was taken, what stays off - say where that switch lives - or was left, and any
`unknown`), the release notes step 2 printed, step 6's `agents-md:` receipt, and the restart line.

- **COMPARE** - the signal step 2 named, one line: `no-stamp` or `compare-unreachable` (refreshed without a baseline),
  or on `TRUNCATED`: 'the compare was capped at 300 files - run /alfred-code:configure to reconcile what it may have
  missed', with configure on the suggestion card. No signal: no line.
- **ENVIRONMENT** - the installer prints one line per env change, named by the file the scope writes
  (`settings.json env: <old> renamed to <new>`, `settings.local.json env: ...`, `<key> removed (retired ...)`,
  `<key> seeded (<value>)`, `<key> <old> -> '<new>'`). Report those lines; when there are none, say 'env: nothing
  renamed, removed or seeded this run' - a claim the silent log AND step 2's `env-keys:` before-state support. Never
  assert it from memory. The `settings.local.json: created ...` line also arrives as a `warn:` line - report it once,
  here.
- **DATA ROOT** - every `docs root:` / `docs move:` / `data root:` line the grep caught, verbatim.
- **LAYOUT** - every `layout:` line the grep caught, verbatim, or 'layout: current - nothing moved'; a `layout: kept`
  line goes on the follow-ups card with the one action its shape leaves - three shapes, three actions:
  - `layout: kept <old> - <new> already holds it`: a doc at both homes, the new file the live one; diff the two and delete the old
    (a ledger or state file at both homes settles itself - a `layout: merged` or `layout: removed` line - and leaves nothing).
  - `layout: kept .branches/ - it holds doc versions, prune them first`: those are live branch versions of the docs -
    fold or drop each with `node .claude/hooks/docs.js prune <branch>` and the next update removes the folder; never
    delete it by hand.
  - `!! layout: <folder> holds raw session copies ...`: nothing moved; keep the new folder out of git (the data root's
    `.gitignore`), then re-run `/alfred-code:update`. A session that started before 2.8.0 runs its old hooks until the restart and writes the old
  folders again; the next update moves what it wrote.
- **GIT HYGIENE** - the one extra call this step makes, after the installer and before `$TMP` goes:
  `node "$TMP/repo/scripts/git-hygiene.js" --root .`. A `git-hygiene: offer <root>/<TAB><why>` line
  means git lists the data root as untracked while nothing under it is meant to be committed; ask ONE
  AskUserQuestion (a write, so it is asked - not a follow-up):

  ```ask
  Ignore <root>/ in git? <why>.
  - 'The committed .gitignore (Recommended)' - one anchored line the team shares, so no clone lists it as untracked
  - '.git/info/exclude' - this clone only, no committed file touched
  - 'Leave it' - nothing is written, the next update asks again
  ```

  and apply the answer with `--apply gitignore` or `--apply exclude`, reporting its `applied` /
  `current` line. A `none (...)` line is not reported. Unattended, take the Recommended option and log
  it.
- **WORKSPACE** - read only when `$TMP/cascade.txt` exists (`update-workspace.md` ran the cascade or its hold call): append
  `; [ -f "$TMP/cascade.txt" ] && cat "$TMP/cascade.txt"` to the hygiene call. A `cascade.txt` with no
  `cascade: done` line is a cascade still running: wait for its completion notice and read it again. One row per
  project from its `cascade: <rel><TAB><state>` line - `<rel>`; its version from step 2's plan row, for a `held` row the
  stamped version alone (the left side of its `version=` field), and `-` for a project step 2's plan printed no row for,
  a `gone` or a newly joined one; and `updated` / `unchanged` / `failed` / `skipped` / `gone` / `held` / `gone-kept` -
  each `!!` line under it verbatim, then the `cascade: done ...` line. A `gone-kept` row is a folder that no longer
  holds an install: its line stays in this project's file until a cascade runs. Any `held` row puts ONE line on the
  follow-ups card: '`/alfred-code:update` here again, answering yes, updates the held projects' - and, where the core is
  installed for the whole account, that a held project already runs its new hooks and agents beside its older copies.
  Then ONE call,
  `node "$TMP/repo/scripts/workspace.js" check-loads --root <rel>` for each `updated` child (none: no call), joined by ` ; ` (each is
  one logged-out `claude -p` in a throwaway account, up to 90 s), and paste every `!!` line it prints. A `loaded twice`
  line, and each `failed` or `skipped` child, puts `/alfred-code:update in <rel>` on the follow-ups card.
- **SERVERS** - the `mcp servers:` block the grep caught (an install an earlier release gave MCP servers, on its
  first update onto 2.10.1 or later), verbatim: the removed line, each `add it back:` line, any `mcp <name>: kept` line and the
  `mcp data:` line. No block: say nothing.
- **RESTART / WARN** - the `--log` call's `restart: yes|no` (a report LINE, not a question) and every `warn: <line>` (a
  fail-soft that fell back and continued - not a re-run trigger), verbatim.
- **FOLLOW-UPS** - the `context7-local removed` and `claude-hud has no status line yet` lines, verbatim when caught,
  once each here (both also arrive as `warn:` lines).
- **VALIDATE** - step 2's `validate: yes` (the version delta spans more than one release) or
  `policy-rev: stale ...` (the installed usage-policy rule's stamped revision is behind the shipped
  skill's, or carries none) each add a `/alfred-code:validate` suggestion-card row with that reason. Both absent adds
  nothing. Update prunes only what upstream deleted; what this project stopped needing is validate's pass.

The run rewrote `alfred-code.stamp` - the next update or configure diffs from here. Name `/capture-awareness` (when
installed) as the USER's next step when step 2's `changed-here:` line shows `skills=` or `agents=` above 0 - gated on
THAT number alone (the installer re-copies every file every run, so any other gate is always true; the generated
inventory stamps each skill's first sentence, which drifts with content-only updates). Never invoke it from this
run - the skill is manual-only (`disable-model-invocation`), so a Skill call is DENIED by
`guard-fresh-session-start.js`; the report line is the mechanism.

**The run closes on a suggestion card, never on a question.** After the report, list the follow-ups that are the
USER's to run - the restart, `/capture-awareness` (when the gate above fires), a manual-only capture whose output is
stale, a server's data to delete (the `mcp data:` line) - as `Suggested next steps`, the recommended one first and each with the one reason it matters. **When step 3's `--log` call printed `restart: yes`, the RESTART is row one** - every other follow-up runs against the session still holding the OLD hooks and plugins. A follow-up that is
itself a deliberate run - any capture, a loop - carries a fresh-session note beside it: 'run it in a fresh session;
started here it re-sends this walk's history on every one of its turns'. Under a restart row the note reads 'run it
in the session the restart opens' instead - one action, not two the user can order wrongly. No AskUserQuestion over
them - and read that narrowly: **it forbids an ask about the FOLLOW-UPS, nothing else**; the asks the steps mandate
(new items, the prune confirm, a guard hook's adoption, git hygiene) are unaffected. Close with this line, verbatim,
as the LAST line of the message - nothing after it:
'Nothing is pending on this run - these are yours to run when you choose.' The stop-contract
guard reads that sentence as a finished close; without it a 'done + next step' card is blocked as a stall.
The line is CONDITIONAL: print it only when the card carries nothing OWED. A still-required user action - revoke the old token, fill in a credential, run a rotation - IS pending, so name it and put the close through the ask instead.

## 8. Clean up the temp dir - ALWAYS

Remove `$TMP` per `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/source-protocol.md`, on EVERY exit path:
after the fast path, after refresh + prune, after refresh-only, after a blocker, and after a
user 'no'. Then confirm the project tree holds only installed artifacts by LOOKING, never with
`git status`: the stack's own gitignore advice ignores `.claude/` wholesale, so a porcelain status
over it is empty whatever is sitting there. `ls -a .claude` plus a check that no archive, extracted repo,
`raw.json`, `selection.txt` or `install.log` was left in the project - anything stray is named in
the close-out, not silently ignored.
