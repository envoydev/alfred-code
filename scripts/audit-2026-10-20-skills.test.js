'use strict';
// Usage audit 2026-10-20, the rules / agents / skills track. One file for the track's prose pins, so the parallel
// apply branches never collide in a shared test file. Each block names its cluster and the sessions behind it; the
// behavioural halves (the inventory script's live-only line, spec-check's stop line) are pinned in their own suites.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');
const body = (rel) => read(rel).replace(/^---\n[\s\S]*?\n---\n/, '');

// C34 (b4033453, c5287cc1): a local start ran ~6 min against a production database on a typed 'it points at alpha'
// and one connection row seen elsewhere. The always-on gate reads the resolved target first; the run book records
// where each environment's target is picked; a fact the user types is a NOTE the capture writes, not a path.
test('C34: a data-store start reads its resolved target first, and the run book records it', () =>
{
    const gates = flat(read('stack/rules/alfred-quality-gates.md'));
    assert.match(gates, /Before you start a process that reaches a data store or a remote service .* read the target it will actually resolve .* count-only check per environment .* state it in the start line; a production match waits for the user's ask\. A typed 'it points at X', a 'connected' log line or a connection seen on X is no proof\./);
    const book = flat(read('stack/skills/capture-awareness/references/project.md'));
    assert.match(book, /- Data target: <per environment - the file or variable that picks the database a local start reaches, and the count-only check that names it/);
    assert.match(book, /More than one environment config .* the Data target line names the file that picks it/);
    assert.match(book, /Before a local start, run the Data target check/);
    const skill = flat(read('stack/skills/capture-awareness/SKILL.md'));
    assert.match(skill, /Any other text is a NOTE - a fact the user typed for the run book/);
    assert.match(skill, /\*\*NOTE\*\* - the doc exists and the arguments carry a typed fact .* no gate and no DISCOVER/);
    assert.ok(skill.indexOf('**NOTE**') < skill.indexOf('**CURRENT**'), 'a note is routed before the CURRENT shortcut can swallow it');
    assert.match(skill, /Project: <created \| refreshed \| appended \| current \| kept>/);
});

// C33 (1b432dd2, a09fc7d6, 0685cd0b, b4033453, b5f384d2, d340e944): one clause each in the always-on interaction rule.
test('C33: do the step yourself, answer the typed question first, re-read state, check the recommended effect', () =>
{
    const rule = flat(read('stack/rules/alfred-interaction.md'));
    assert.match(rule, /A step this session's tools can do .* is never handed to the user as an instruction - check the tools you hold before you ask, then do it/);
    assert.match(rule, /A question typed while you work is answered in your next text, before the work goes on; one that questions what is running or what it touched first stops or holds that process\./);
    assert.match(rule, /Re-read state carried from an earlier turn or session .* before it becomes an ask, and check a Recommended option's stated effect with one read - an unchecked one is worded as unverified\./);
});

// C35 (a2920886, eace9df8, 81ebfa5f): PARTIAL meant 'sampled by risk' in 9 of 9 hand-backs, so the re-gather step
// could not hold; an INLINE capture dispatched seats; the round cap surprised an unattended run's user.
test('C35: PARTIAL is files left unread, a risk sample is CHARACTERIZED, INLINE dispatches no seat', () =>
{
    const seat = flat(read('stack/agents/code-quality-analyzer.md'));
    assert.match(seat, /\*\*CHARACTERIZED\*\* - every handed rule source judged over the files you read\. A module sampled by risk at the depth run is CHARACTERIZED/);
    assert.match(seat, /\*\*PARTIAL\*\* - a file the dispatch required, or a handed rule source, stayed unread/);
    assert.match(seat, /`coverage: <files read> of <files in the module> - <whole \| sampled by risk: what the sample took>`/);
    const capture = flat(read('stack/skills/capture-code-quality/SKILL.md'));
    assert.match(capture, /came back PARTIAL \(a required file or rule source left unread - a module sampled by risk is CHARACTERIZED, its sample named\)/);
    assert.match(capture, /A run handed INLINE dispatches no seat/);
    const loop = flat(read('stack/skills/loop-code-quality/SKILL.md'));
    assert.match(loop, /a scope too small to fan out - one module, never several slices/);
    assert.match(loop, /'3 rounds, then STOP with the remainder listed'/);
});

// C37 (7c1af769, 818d7cbf, feb34e2b, 71d5428a, d340e944, 18e5ba52): the solve flow's contract gaps. The body sits at
// its re-attach cap, so the rules every size needs live in full-spec.md, the one reference every size reads.
test('C37: repro status, the answered question, the sibling route, the stamp order and the push count', () =>
{
    const spec = flat(read('stack/skills/task-solve/references/full-spec.md'));
    assert.match(spec, /a bug's `Result:` adds `Repro: <the reported error matched \| differs: <what it showed> \| not reproduced>`/);
    assert.match(spec, /a question in the arguments .* is answered in the stop's first sentence, before the fields/);
    assert.match(spec, /The files this names live in <sibling>, not here\./);
    const mech = flat(read('stack/skills/task-solve/references/step-mechanics.md'));
    assert.match(mech, /The plan's `Approved:` line is written after this ask is answered, quoting the answer - never in the edit that appends the gate block/);
    assert.match(mech, /each backend route that handler calls confirmed to exist in THIS repo/);
    assert.match(read('stack/skills/task-solve/SKILL.md'), /<sha> on <branch> \(<N> commits\) is not pushed to <remote>/);
});

// C38 (9a0314ed, 0685cd0b, fc4fec40): 'pre-existing' and 'uncapped' closes with no run of the unpatched code; an
// acceptance bar never tied to the reported symptom.
test('C38: a pre-existing or uncapped claim needs a baseline run; a bug plan\'s acceptance reproduces the symptom', () =>
{
    assert.match(flat(read('stack/skills/task-implement/SKILL.md')), /A red called pre-existing, or a fix closed on a pass the unpatched code was never seen to fail .* needs that check run on the base .* else the report says `unproven`/);
    assert.match(flat(read('stack/skills/task-verify-plan/SKILL.md')), /A bug plan's acceptance run reproduces the reported symptom .* an unapproved stand-in is a finding/);
});

// C40 (8f130789): the closing `rm -rf <tmp>` chained with other steps waited ~10 h for a permission answer.
test('C40: the usage report removes its temp dir alone, in the last call, and stays under its cap', () =>
{
    const raw = read('stack/skills/capture-usage-report/SKILL.md');
    assert.match(raw, /Then, alone in the run's last Bash call, `rm -rf "<tmp>"` with the printed path\./);
    assert.doesNotMatch(raw, /(&&|;)\s*rm -rf "<tmp>"/);
    assert.ok(raw.length < 19000, `SKC06 cap: ${raw.length}`);
});

// C42 (56ca25cb) + C32 (a8804432#6): compound shell in worktree briefs (862k of refusals), a stamp that blocked the
// checkpoint's seat, an invented reuse ask; notification polls while seats ran.
test('C42: worktree briefs ask for plain commands, the loops clear their stamp before the commit ask, reuse is an ask', () =>
{
    for (const skill of ['loop-architecture-quality', 'loop-code-quality', 'loop-test-coverage', 'task-build-from-scratch', 'task-solve-cross'])
    {
        const trio = flat(read(`stack/skills/${skill}/references/domain-trio-protocol.md`));
        assert.match(trio, /run each Bash call as ONE plain command from the worktree root/, skill);
        assert.match(trio, /After a dispatch, end the turn: each hand-back arrives on its own/, skill);
    }
    for (const skill of ['loop-architecture-quality', 'loop-code-quality', 'loop-test-coverage'])
        assert.match(flat(read(`stack/skills/${skill}/SKILL.md`)), /delete the round's APPROVED stamp first .* - then the commit decision is the ask below/, skill);
    assert.match(flat(read('stack/skills/loop-architecture-quality/SKILL.md')), /through the reuse ask in `references\/loop-mechanics\.md`/);
    assert.match(read('stack/skills/loop-architecture-quality/references/loop-mechanics.md'), /- 'Reuse it as the work list \(Recommended\)'/);
});

// C22 (8396b5df, a8804432, 29e4002f) + C32: a next command typed into a 250k chat; polls while seats ran.
test('C22 + C32: capture closes name /clear before the next command; dispatching captures end the turn', () =>
{
    assert.match(flat(read('stack/skills/capture-architecture/references/report-fields.md')), /reads `\/clear, then <command>` - in the option label when it is an ask/);
    for (const skill of ['capture-architecture-quality', 'capture-code-quality'])
        assert.match(flat(read(`stack/skills/${skill}/SKILL.md`)), /reads `\/clear, then <command>`/, skill);
    for (const skill of ['capture-architecture', 'capture-architecture-quality', 'capture-code-quality'])
        assert.match(flat(read(`stack/skills/${skill}/SKILL.md`)), /After the dispatch, end the turn: each hand-back arrives on its own/, skill);
});

// C43 (add5a91e, ce3fd60a, a09fc7d6): an 'always' role skipped silently, a seat dispatched after the first write, an
// invented lighter path on an assessment recomputed at the same sha.
test('C43: one vocabulary cell per role, no probe after the first write, one sanctioned INLINE lighter path', () =>
{
    assert.match(flat(read('stack/skills/capture-architecture/references/vocabulary-roles.md')), /An `always` role is never n\/a/);
    assert.match(flat(read('stack/skills/capture-architecture/references/report-fields.md')), /one cell per row of the roles table/);
    assert.match(flat(read('stack/skills/capture-architecture/SKILL.md')), /no seat dispatch and no source read either/);
    const caq = flat(read('stack/skills/capture-architecture-quality/SKILL.md'));
    assert.match(caq, /when the assessment's `As of:` sha is HEAD on a clean tree, VERIFY \+ REWRITE/);
    assert.match(caq, /a run whose HEAD moved - the loop's reconcile after shipped fixes included - runs in full/);
});

// C44 (fabea019, 4a210c3c): a key added after the browser server started, setup scripts DISCOVER skipped, a
// hand-check that met its data blockers one browser call at a time.
test('C44: the run book names the reconnect, the setup scripts and each flow\'s data', () =>
{
    const book = flat(read('stack/skills/capture-awareness/references/project.md'));
    assert.match(book, /a key added after the server started needs a reconnect \(`\/mcp`\) first/);
    assert.match(book, /the setup, start and run scripts and task-runner files/);
    assert.match(book, /; needs: <the account, record or setting holding the data it reads - or 'any'>/);
});

// C46: the per-item skill and rule gaps.
test('C46: the per-item gaps', () =>
{
    assert.match(flat(read('stack/skills/habits-create-ticket/SKILL.md')), /named an existing empty or placeholder ticket and asked to put the content in it: that request is the confirmation/);
    assert.match(flat(read('stack/skills/habits-plan-writing/SKILL.md')), /A card ticked `DONE` collapses to its title, its status line and one evidence pointer/);
    const rc = read('stack/skills/habits-root-cause/SKILL.md');
    assert.match(rc, /^description: ".*build or auth error.*"$/m);
    assert.match(flat(rc), /Each option names the measured quantity it changes/);
    assert.match(flat(read('stack/skills/ilspy-decompile/SKILL.md')), /its answer good for THIS session only/);
    // 2026-10-21: the git seed keeps only its crucial lines; the scope ask's order lives in the checkpoint's ask step.
    assert.match(flat(read('stack/skills/habits-commit-checkpoint/SKILL.md')), /anything still owed \(a gate not run, a review skipped\), then put ONE AskUserQuestion - after steps 1-4, since an answer given before the review ran is void/);
    const sec = flat(read('stack/rules/alfred-security.md'));
    assert.match(sec, /A check a server enforces .* is never patched around client-side/);
    assert.match(sec, /the guard is the file the session's `Sensitive data:` line runs, never a `\.claude\/hooks\/` copy/);
    assert.match(flat(read('stack/rules/alfred-quality-gates.md')), /text inside quote marks is copied from the retrieved result, never paraphrased/);
});

// The always-on budget the clauses above are charged to (lint 33 holds the cap; this holds the track's own share).
test('the clauses stay inside the always-on budget, and task-solve inside its re-attach cap', () =>
{
    const { alwaysOnSurface } = require('./always-on-surface.js');
    const s = alwaysOnSurface({ rulesDir: path.join(ROOT, 'stack', 'rules'), agentsDir: path.join(ROOT, 'stack', 'agents'), skillsDir: path.join(ROOT, 'stack', 'skills') });
    assert.ok(s.total < 80000, `${s.total}`);
    assert.ok(body('stack/skills/task-solve/SKILL.md').length < 17700, 'task-solve stays under its re-attach cap');
});

// C07 (fabea019): a stop 22 minutes into a cycle, at 275k on a 1M window, printed a resume block, and the model's
// answer to 'why at 280k?' claimed the cycle spanned hours. The offer is put only past one of the three conditions or
// on the user's word, and the clock is the hook's. Room came from step 5's mechanics, moved beside the reviewer fit.
test('C07: task-solve puts the fresh-session option and resume block only past a condition or on the user\'s ask', () =>
{
    const solve = flat(body('stack/skills/task-solve/SKILL.md'));
    assert.match(solve, /Below all three \(a new cycle's first ask and the compaction stop aside\), no ask carries it and no resume block prints unless the user asks; hours and gaps are the hook's clock, never your guess/);
    assert.match(solve, /INVOKE the reviewer chosen at the step-4 stop, and re-review each punch-list fix, by the step mechanics' conformance rules\./);
    assert.doesNotMatch(solve, /a punch-list fix is unreviewed code/, 'the step-5 mechanics have one home');
    const mech = flat(read('stack/skills/task-solve/references/step-mechanics.md'));
    assert.match(mech, /## Conformance - step 5 The reviewer the step-4 stop chose RUNS: a Skill tool call on `task-verify-code`, or an Agent dispatch of the seat/);
    assert.match(mech, /a punch-list fix is unreviewed code/);
    assert.match(mech, /- Conformance - step 5 /, 'listed in the contents');
    assert.ok(body('stack/skills/task-solve/SKILL.md').length < 17500, `task-solve keeps room under its cap: ${body('stack/skills/task-solve/SKILL.md').length}`);
});
