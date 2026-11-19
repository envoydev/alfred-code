# Plugin audit - several kinds in one run

Read before step 1 of the flow when the user asked for audits together. Contents: the kinds in two waves - the
run, steps 1 to 13 - signs it was skipped. 'The flow' below is the numbered steps of `SKILL.md`; each kind goes
through them with its own audit skill, rubric and run folder, and this file says which kinds run, in what order -
one kind at a time unless the request says `parallel` - and what happens between them.

## The kinds, in two waves

- **Wave 1 - the parts:** `skills`, `commands`, `agents`, `rules`, `agent-md`, `tools`, `hooks`, `code`. `hooks`
  goes after the instruction kinds: it reads the most for the least. `code` goes last of all: its conversion
  renames and rewrites files the other kinds read ('`code`, after the others' below).
- **Wave 2 - the whole:** `system`, `usage`. They judge everything wave 1 may have changed, so they start only
  after wave 1's edits are applied.

That is also the run order: wherever one kind goes before another - planning, applying edits, the rows of a
table - it is this order, whatever order the request names them in.

**One kind at a time** is the default: every planner seat running at one time belongs to one kind, which keeps a
wide run under the planner model's limit. With `auto_approve` on, steps 5 to 9 are done for one kind, end to
end - plan, grade, approval, apply and commit, verify and record - before the next kind's planner starts. With
it off, the kinds are planned and graded one after another, step 7's one hand-over follows the last grade, and
the approved plans are then applied and verified one kind at a time. **`parallel`** after the command, or 'side
by side' in chat, is the other mode: steps 5, 6 and 9 run across a wave's kinds at once, four planner seats at a
time.

**`code`, after the others.** The conversion and `code`'s planners start only once every other wave 1 kind's plan
is applied, committed under the run's `commit` word and recorded - a kind whose plan is left waiting or `NOT RUN`
does not hold them back, since it edits nothing; a waiting plan whose targets the conversion edits goes stale,
and its freshness check (the flow's step 7) sends it back to its planner on approval - so no other kind's planner
reads a file the conversion edits mid-way and no applied plan goes stale:

- `auto_approve` on, one kind at a time: the run order already holds it - `code`'s turn comes after the kinds
  before it are done end to end.
- `auto_approve` off: the other wave 1 kinds are planned, graded and handed over together; `code` is a second
  part of the run, as step 1 allows for kinds added later, started after those approved plans are applied and
  recorded. Its conversion plan and its audit plan each get their own hand-over.
- `parallel`: the other wave 1 kinds run side by side; the conversion starts after the last of them is applied
  and recorded, and `code`'s planners after the conversion.

At `code`'s turn its audit skill's own step comes first: the conversion, run by the `ts-convert` skill. The
conversion's size ask, with 'One batch first', is put then all the same - the run's ask of step 4 never replaces
it. The run's `commit` word covers the conversion's batches; without it, the conversion's own commit ask is put
there too. A conversion that ends before its last batch ends the kind for this run: its queue line reads
`converting <done>/<N> batches - audit waits`, and no `code` planner starts. Where the run commits nothing and an
earlier kind edited a path the conversion checks - `git status --porcelain -- <code's roots> <instruction file>
.claude/kit/repo.json package.json <lockfile> 'tsconfig*.json'` prints a line - `code` is
`NOT RUN - targets edited by <kind>, uncommitted`, as step 8 says: the conversion starts only on a clean tree.

## The run

1. **Kinds.** Read the words typed after the command - `SKILL.md` gives them under 'When to use' - or what the
   request says in chat. Kinds are separated by commas, colons or spaces, with or without the `repo-audit-` prefix.
   - None named: every kind.
   - After `exclude` (or 'except', 'without', 'but not'): every kind but the ones that follow it -
     `exclude tools, usage, system` runs the seven others.
   - Otherwise: the kinds named, and only those.

   The word `commit` is no kind: it is step 8's word for committing each kind's edits. Neither is `parallel`, the
   mode above, nor `full`, the flow's word for auditing every item. Any other word that is no
   kind is named back with the list above, and the run goes on with the rest. Say in one line which kinds run and
   which were left out, before anything else. Then read `.claude/kit/repo.json` -> `audit`: a kind with no entry
   there is listed as `no targets` and not run.
   Kinds the user adds after the edits of the kinds first named are applied join the same run as a second part:
   add them to the queue file under the first part's lines and take them through steps 3 to 12 in the run order.
   The word `commit` carries from the request that started the run, and step 13's one self-review runs after the
   last kind of the last part.
2. **The queue file.** Write `docs/superpowers/audits/<date>-all/queue.md`: one line per kind with its wave, its
   status - `pending`, `planning`, `converting <done>/<N> batches - audit waits`, `graded <score>`,
   `waiting for approval`, `applying`, `verifying`,
   `done <baseline> -> <final>`, `done - all <n> items carried`, `no targets`, `NOT RUN - <why>` - its run folder,
   its seats' ids and its
   commit - and under those lines one `Next:` line for the run, with the step it is at and the one after it. Update
   a kind's line whenever its status changes, and `Next:` at every step. After a compaction, Read it before the
   next step: it is how the run outlives the summary.
3. **Each audit's skill.** For every kind that will run, Read `.claude/skills/repo-audit-<kind>/SKILL.md` with the
   Read tool - the audits are typed-only, so the Skill tool cannot load them, and the user's ask for this run is
   their word for each audit in it. Its line that loads this skill is already done. This session coordinates only:
   it reads no audited file and scores nothing.
4. **Size and models, once for the run.** Do the flow's steps 1 to 3 for each kind, its scope included, then state
   `Size:` with one entry per kind (items audited and carried, files, characters, batches - and for `code` the
   JavaScript files and characters under its roots that no `keep_js` path matches, as the conversion's estimate,
   since its plan does not exist yet) and the total planner
   seats, `Models:` as the flow gives them, and under them each kind's `age:` line, its line that its audit skill
   changed and its `audit-scope:` line, where its scope printed one.
   With more than one kind to run, ask once before the first planner starts:

   ```ask
   This run audits <K> kinds - <kind: characters, ...> - <total> characters: <N> planner seats on <model>, <one kind at a time, two seats at a time | side by side, four seats at a time><, each plan graded>. Start?
   - 'All <K> kinds (Recommended)' - every kind listed runs, in the run order
   - 'Pick kinds' - name the kinds to run or to leave out; the rest stay pending
   - 'Cancel' - nothing is started
   ```

   Under `auto-run` the ask is not put: the recommended option is taken and ledgered. It replaces each kind's own
   size ask (the flow's step 4) for this run.
5. **Plan.** One kind at a time: at each kind's turn in the run order, before its planner starts, repeat the
   flow's step 1 for it - the clean check and the scope - since an earlier kind's edits may have reached its
   items; the later result is the one its planner gets and its `run.md` keeps. A kind step 4 found all carried
   takes its turn too: with an `audit` line now it is planned like any other, with none it stays
   `done - all <n> items carried`. A kind whose targets hold an earlier kind's uncommitted edits is
   `NOT RUN - targets edited by <kind>, uncommitted` before any seat starts. Then dispatch its planners (the
   flow's step 5), two seats at a time, and put its open questions (step 6) when they return. With `parallel`:
   dispatch the planners of every wave 1 kind but `code` in one message, at most four planner seats running at a time
   across all kinds and batches, a seat that frees taking the next waiting batch; each kind's open questions are
   gathered and put together, at most four per ask. Either cap is for planning, where a seat reads its targets:
   the verify messages of step 9 go to every seat of a kind in one turn.
6. **Grade.** Run the plan's freshness check and grade (step 7), twice at most as that step says: a plan still
   under the pass score after its second grade waits for the user, and the run goes on with the next kind (step
   11). With `parallel` and `Plan grade: on`, the first reviewer of every plan is dispatched in one message. A
   plan's revision is its own planner's.
7. **Approval** follows the `plan-approval` rule, per plan, and replaces the flow's step 8 ask for this run:
   - `auto_approve=on`: every plan that passed is approved by the run and ledgered, and before its editor starts
     every edit of it that stands on a ruling taken under auto-run is printed with its `New` text - the user has
     not seen that answer, and no ask will show it.
   - `auto_approve=off`: hand all the plans over in one message - one row per kind with its baseline grades, plan
     path, score path and edit count, and every edit that stands on a ruling taken under auto-run, with its `New`
     text - and notify the user. Never park on one kind's plan while another kind is
     still unplanned.
8. **Apply one plan at a time, in run order** (step 9). Editors never run side by side: each runs the repo's checks,
   and a check must not see another plan half applied. An audit leaves its edits uncommitted, and the flow applies
   no plan to targets that hold uncommitted changes, so:
   - where the request said to commit - the word `commit` after the command, 'commit each audit' in chat - commit
     each kind's edited files by pathspec - the plan's last check lists them - under the repo's own commit rule,
     one commit per kind, before the next plan is applied; then the repo's own copies are refreshed, or reported
     as stale, as the flow's step 10 says, before the next kind's checks read them. Never push. A plan whose
     targets that commit changed goes back to its planner first, as the flow's freshness check says;
   - where it did not, commit nothing: a kind whose targets an earlier kind edited is
     `NOT RUN - targets edited by <kind>, uncommitted`, and the close names the commit that unblocks it.
9. **Verify and record** (step 10): send the applied kind's planners their verify message in one turn - with
   `parallel`, every applied kind's - and record the kind's grades as soon as its last `final.md` is written -
   outside `parallel`, that is before the next plan is applied. Where another kind's plan was applied after this kind's planner started -
   `auto_approve` off, or `parallel` - first run its scope once more and name in the verify message each
   carried item that now reads `changed`: `final.md` and the scorecard list it as 'changed after planning - not
   audited', never as carried. One that now reads `older than` stays carried for this run - the day changed, not
   the item. A kind that is `done - all <n> items carried` is scoped once more the same way
   before the close, and its scorecard lists such an item the same way. Where that plan edits a path under this
   kind's roots or its `scope_with`, the
   kind is not recorded, as the flow's step 10 says.
10. **Wave 2.** Run steps 5 to 9 again for whichever of `system` and `usage` the run includes, on the tree as wave 1
    left it. Where wave 1 edited
    their targets and nothing was committed, they are `NOT RUN` as step 8 says.
11. **A kind that stops does not stop the run.** Targets with uncommitted changes, a plan whose grade ended under the
    pass score, a question only the user can answer, a seat that failed twice: write the reason on its queue line and
    go on with the others. It is not retried in this run.
12. **Close.** Each kind's scorecard as the flow's step 11 prints it, then the run's own:

    ```text
    Scorecard: <K> kinds, <n> items
    | kind | items | at A before -> after | mean before -> after | plan grade | status | commit |
    Overall: at A <before> -> <after> of <n>; mean <before> -> <after>
    ```

    Items a kind's scorecard lists as not scored are in neither `<n>` nor a mean.

    Then the path of each kind's `final.md` for its full report and owed checks, one line per seat with the model it
    ran on, and under `Left for you` every kind not run with its reason, every plan still waiting, a conversion's
    remaining batches with the command that continues them, and every commit not made.
13. **Self-review, once for the run** (the flow's step 12), and only where this repo is the audit skills' home:
    anywhere else the run ends at step 12. The planners wrote their retro files with their last verify; send the
    `retro` message, in one turn, only to a planner that has none. Add this run's own findings - a kind that was
    `NOT RUN`, a seat left idle, a plan that went back after another kind's edits - and merge everything into
    `docs/superpowers/audits/<date>-all/retro.md`: one ranked list, a finding several kinds hit counted once and
    ranked higher, the top seven kept. One `retro-plan.md` there goes through the flow's steps 7 to 9. It
    replaces each kind's own step 12.

## Signs it was skipped

- An audit run from memory of its skill, its `SKILL.md` never Read in this run.
- Two kinds' planners running at once in a run that did not say `parallel`, or more planner seats planning at
  once than the cap in force: two, or four with `parallel`.
- A kind recorded although a plan applied after its planner started edits a path under its roots or its
  `scope_with`, or a planner started without the flow's step 1 repeated for its kind.
- Two editors running at the same time, or a plan applied on top of another kind's uncommitted edits to the same
  targets.
- A commit made without the user's word for it, or a push.
- `code`'s conversion or its planners started while another wave 1 kind's plan was unapplied, uncommitted or
  unrecorded, or the run's size ask taken as the conversion's own.
- No `queue.md`, no overall scorecard, no `retro.md` in the audit skills' home, or a close that leaves out a kind
  the request named.
