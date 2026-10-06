# Usage audit - step 0 question chain

Read at step 0, after detection and before the first ask.

## Q1 - EVIDENCE - always first, alone

- `Audit what is already collected` (recommended when the root holds bundles - say how many)
- `Collect from particular projects, then audit` - one or more project roots the user names, this
  one included when they name it

Ask nothing else until this answer is in: it picks the chain.

## The schema - which answer opens which question

Read it as a tree: a question exists only on the branch its parent answer opened. Nothing on
another branch is asked, and no question is asked twice.

```
Q-EVIDENCE  (always first, alone)
|
+- 'Audit what is already collected'      -> nothing about collecting is ever asked
|    +- Q-BUNDLES
|         +- every bundle | only bundles with no audit file yet | a named subset
|              +- Q-EXECUTION  [asked only if dispatch available AND >3 bundles in scope]
|                   +- inline | fan-out  -> Phase B -> Phase C -> Q-ROUTING
|
+- 'Collect from particular projects'
     +- Q-PROJECTS  (free text paths; resolve each BEFORE the next ask)
     |    +- none resolved -> STOP: no history and no bundles on this machine for those paths
     +- Q-DATA  - is the data already generated for those projects, or must it be generated?
          |
          +- 'already generated'  -> no analyzer runs; Phase A copies what the projects hold
          |    +- Q-SCOPE   [+ 'exclude this session' only when the list includes this project]
          |         +- Q-AFTER
          |
          +- 'generate what is missing' (recommended) | 'generate everything fresh'
               +- Q-SECTIONS  - authored | skeleton
                    +- Q-SCOPE   [same this-session note]
                         +- Q-AFTER
                              +- collect only -> Phase A -> STOP (no Q-EXECUTION, no Q-ROUTING)
                              +- audit now    -> Q-EXECUTION [same gate as above]
                                                   -> Phase A + B -> Phase C -> Q-ROUTING
```

| Question | Asked only when | The answer sets | Read later by |
|---|---|---|---|
| Q-EVIDENCE | always, first, alone | `evidence` = audit-existing / collect | picks the chain; `audit-existing` skips Phase A entirely |
| Q-BUNDLES | `evidence` = audit-existing | `bundles` = all / no-audit-file-yet / subset | Phase B0 enumeration |
| Q-PROJECTS | `evidence` = collect | `projects[]` (absolute paths) | Phase A, every route |
| Q-DATA | `evidence` = collect, after the paths resolved | `data` = already-generated / fill-gaps / regenerate | Phase A route per project |
| Q-SECTIONS | `data` != already-generated | `sections` = authored / skeleton | Phase A routes 2 and 3 |
| Q-SCOPE | `evidence` = collect | `scope`, and `include_self` when this project is in the list | Phase A session list |
| Q-AFTER | `evidence` = collect | `after` = audit-now / collect-only | the stop condition after Phase A |
| Q-EXECUTION | the run will audit (`evidence` = audit-existing, or `after` = audit-now) AND dispatch is available AND >3 bundles are in scope | `execution` = inline / fan-out | Phase B1 delegated execution |
| Q-ROUTING | Phase C only, never step 0 - the punch-list must exist first | `routing` | Phase C apply step |

## The questions

- **Q-BUNDLES** (auditing what exists) - `every bundle` / `only bundles with no audit file yet`
  (recommended when `AUDIT/` already holds some - say how many of how many) / `a named subset or a
  date range` (Other). State the bundle and audit-file counts detection found.
- **Q-PROJECTS** (collecting) - absolute paths, free text; offer this project's own root as the
  pre-filled option when the session is running inside one. Before the next ask, resolve each path
  to its history folder under `~/.claude*/projects/` AND check whether it already has a bundle set
  (its own docs root, or a folder under the collection root), then say per project what was found -
  that inventory is what makes the next question answerable. No project name or path ever reaches a
  tracked file.
- **Q-DATA** (collecting, after the paths resolved) - is the data already there, or must it be
  generated? `generate only what is missing` (recommended - name the counts: N sessions with a
  bundle, M without) / `it is already generated - just collect it` / `regenerate everything, even
  where a bundle exists`. A project with bundles and no history folder can only answer the second;
  a project with history and no bundles can only answer the first or third - say so instead of
  offering a choice that cannot run.
- **Q-SECTIONS** (only when something is being generated) - `authored` - invoke
  `/alfred-capture-usage-report` so a model fills each report's judgment sections (slower, richer,
  needs a session inside that project) - or `skeleton` - `analyze-usage.js --report-md` only,
  judgment left unwritten because the audit re-derives it anyway (recommended for more than one
  project, and the only route that works from outside the project).
- **Q-SCOPE** (collecting) - `every session found` / `only sessions not collected yet` (recommended
  when the projects in scope already have bundles) / `a date range or explicit session ids`
  (Other). State the session count the previous answers resolved. When the project list includes
  the project this session is running in, this question carries the extra choice `exclude this
  session` (recommended - auditing the tail of the session doing the auditing reads its own
  output); otherwise it is not mentioned at all.
- **Q-AFTER** (collecting) - `audit now, in this run` (recommended) / `collect only, audit later in
  a fresh session`. On `collect only` the chain ends here: Phase A runs and the run stops.
- **Q-EXECUTION** (auditing in this run) - `audit inline in this session` / `fan each bundle's
  fact-gathering out to read-only subagents` (recommended when dispatch is available and more than
  three bundles are in scope). No dispatch capability, or three bundles or fewer: inline, no
  question.

Fix routing is NOT asked here. It is asked once, in Phase C, with the punch-list on screen - asking
it up front means asking a question whose own recommended answer is 'ask me later'.

Hold every answer for the whole run. Re-asking a settled question mid-run is a defect.
