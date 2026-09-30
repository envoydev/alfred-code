# Solve Task - step mechanics

Read by `alfred-task-solve` at step 3 APPROVE, before the approve ask is built; complete on its own.
Five rules live here, each applied at the step named: the mode-fit rule (step 3), the APPROVAL
stamp's write mechanics and lifetime (step 3 onward), the build bar (step 4), the reviewer-fit
rule (the step-4 stop) and the doc-drift surface list (step 6). The
step-3 stop's `Result:` line carries `mechanics: read` - the line that proves this file was loaded
this cycle, not remembered from an earlier one.

## Mode fit - the step-3 approve ask

Two build modes, the recommendation decided per plan, the reason in the option's description:

- **session** - `alfred-task-implement` runs the tasks in this chat. Fits when the tasks are few,
  serial, or one stack's.
- **agents** - each task card goes to its stack's `<stack>-implementer` seat, up to 3 at once,
  frontmatter models unless the user names one. Fits when the plan holds independent tasks that
  can build in parallel (the measured multi-slice exception: built inline, such a plan cost a
  multiple of its dispatched build).

A fixed default is not a recommendation. Agents mode exists only where subagent dispatch is
available; where it is not, the ask offers session only and says so.

## The APPROVAL stamp - writing it, and its lifetime

The stamp's path, its `AUTO` first line and the 'an earlier session's stamp is not consent' rule
are in `SKILL.md`; these are the mechanics around them.

- Only where the docs root still sits under `.claude/` (the old `.claude/docs` default, kept) is the
  write protected: a prompt for it offers 'Yes, and allow Claude to edit files in this project's .claude
  folder for this session' - take that, since `permissions.allow` cannot pre-approve it.
- A relative write follows whatever cwd the shell drifted to, and the dispatch then bounces
  because the guard reads the absolute path.
- If BOTH the Write tool and an absolute-path Bash write are refused by the harness's classifier,
  stop and put the choice through AskUserQuestion (retry the stamp, or run this stage inline)
  rather than retrying blind or dispatching around the gate.
- **Lifetime.** The AUTO stamp lives until step 6's close deletes it. Step 4's
  delete-when-fan-out-completes applies to per-plan APPROVED stamps, and a step-5 punch-list
  re-dispatch under AUTO rides the still-live waiver.

## The build bar - both modes

Both modes build to the bar `alfred-task-implement` and every `<stack>-implementer` seat carry - the
quality loop's five stages met on the first pass, comments carrying the why, each judgment call
decided against the codebase's precedent - and the plan's `## Decisions` ledger grows as they
land: appended directly in session mode, folded in from each seat's `decisions:` report lines as
its report lands in agents mode. A return with no closing status line - a seat stopped at its `maxTurns` (Claude Code marks the output partial from 2.1.246) or killed mid-task - is never DONE and never resumed as-is, since a resume hands a runaway a fresh budget: re-dispatch it ONCE with a scoped resume brief (its handoff note and partial diff name what landed); a second status-less return from that task goes to the user as BLOCKED.

## Reviewer fit - the step-4 stop's recommendation

Three options, one recommended, reason stated:

- **'alfred-task-verify-code in-session'** - a routine diff: no dispatch, stays in this context.
- **'the stack's `<stack>-verifier` seat'** - the diff is large, trips a risk trigger (auth,
  migration, concurrency, security, a big refactor), or was built in this session and deserves
  eyes that did not write it; frontmatter model unless the user names one.
- **'skip'** - straight to step 6's done-gate; never the recommendation.

For a broad parallel sweep the user can still invoke `/code-review` themselves - it is not part of
this flow. The user can inspect the diff themselves at this stop before answering.

## The step-6 memory purge

**The purge is counted, not claimed.** At close, from the project root: `node -e "const fs=require('fs');const f=process.argv[1];let n=0;function walk(d,rel){let es=[];try{es=fs.readdirSync(d,{withFileTypes:true})}catch(e){return}for(const e of es){const r=rel?rel+'/'+e.name:e.name;if(e.isDirectory())walk(d+'/'+e.name,r);else if(e.name.endsWith('.md')){if(r.startsWith(f+'/'))n++;else if(r.startsWith(f+'__'))n++}}}walk((process.env.ALFRED_CODE_DATA_PATH||'.alfred')+'/serena/memories','');walk('.serena/memories','');console.log(n)" <feature>` with the feature's slug - it counts what is left of the feature's navigation-server notes (the `<feature>/` folder, the cycle note included, and a pre-2.1.6 run's flat `<feature>__*` notes), in node so no `find` first on PATH decides it. Above zero the close is not done - delete the rest, then count again.

## Doc-drift surfaces - the step-6 close line

An architecture-critical surface, any one of which earns the close report's one-line pointer to
the architecture capture: a schema / EF migration, a new module or project, a moved boundary or
dependency direction, a changed cross-stack seam or eventing contract, a new external dependency.
