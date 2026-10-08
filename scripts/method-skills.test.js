'use strict';
// R106: the five method skills the superpowers pack used to carry are each loaded by a FIXED
// trigger - a one-line baseline pointer, a seat's `skills:` preload, a flow's Skill call, or a hook
// (guard-stop-method.test.js pins the two hook branches) - never by a description alone. This pins
// every trigger that lives in shipped text, and that the method left the baselines for the skills.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');
const graph = JSON.parse(read('meta/stack-graph.json'));
const agents = fs.readdirSync(path.join(ROOT, 'stack', 'agents')).map((f) => f.replace(/\.md$/, ''));

test('each baseline keeps one pointer per method, in the pinned imperative form, and none of the method', () => {
    const gates = squash(read('stack/rules/alfred-quality-gates.md'));
    assert.ok(gates.includes('the FIRST action is the `habits-done-gate` Skill call, before the claim lands'));
    assert.ok(gates.includes('the FIRST action is the `habits-code-comments` Skill call, before it is written'), 'code-comments pointer');
    // the defaults ride the pointer line: a resumed session never re-reads the skill
    for (const held of ['none by default', 'the code cannot say it', 'Never a ticket id', 'unasked `TODO`', 'conventions and language win', 'updated or deleted'])
        assert.ok(gates.includes(held), `alfred-quality-gates lost the code-comments default: '${held}'`);
    assert.ok(!gates.includes('without a ticket ref'), 'a TODO with a ticket ref contradicts the no-ticket-id comment rule');
    for (const moved of ['tail long runs to the verdict', 'SCOPED test command', 'never suppress a warning, weaken a test'])
        assert.ok(!gates.includes(moved), `alfred-quality-gates still carries the done gate's method: '${moved}'`);

    const interaction = squash(read('stack/rules/alfred-interaction.md'));
    for (const skill of ['habits-plan-writing', 'habits-test-first', 'habits-root-cause', 'habits-clarify', 'habits-execution-strategy'])
        assert.match(interaction, new RegExp(`the FIRST action is the \`${skill}\` Skill call, before `), `${skill} pointer`);
    // the defaults ride the pointer line: a session resumed mid-task never re-fires the 'start of a task' trigger
    for (const held of ['one agent;', 'independent tool calls batched', 'the heavy suite once at the end', 'a CI-parity run before a push'])
        assert.ok(interaction.includes(held), `alfred-interaction lost the execution-strategy default: '${held}'`);
    for (const moved of ['bite-sized', 'watch it fail', 'read the full error and quote'])
        assert.ok(!interaction.includes(moved), `alfred-interaction still carries method text: '${moved}'`);
});

test('every verifier, implementer and resolver preloads the done gate, every implementer but devops test-first, the resolvers root-cause', () => {
    const preloads = (seat) => graph.agents[seat].skills;
    const verifiers = agents.filter((a) => a.endsWith('-verifier'));
    const implementers = agents.filter((a) => a.endsWith('-implementer'));
    assert.strictEqual(verifiers.length, 10);
    assert.strictEqual(implementers.length, 10);
    const resolvers = ['dotnet-build-error-resolver', 'dotnet-test-failure-resolver', 'ng-build-error-resolver', 'angular-test-resolver'];
    // a resolver's whole output is a 'green' claim, and the done gate is Stop-only - the preload is its trigger
    for (const seat of [...verifiers, ...implementers, ...resolvers])
        assert.ok(preloads(seat).includes('habits-done-gate'), `${seat} preloads habits-done-gate`);
    // 2.1.5 M53: devops-implementer's loop validates config and scripts, never writes a test, and the skill
    // itself says it is not for a config-only edit - 2,766 chars per dispatch for a method it never runs.
    for (const seat of implementers.filter((s) => s !== 'devops-implementer'))
        assert.ok(preloads(seat).includes('habits-test-first'), `${seat} preloads habits-test-first`);
    assert.ok(!preloads('devops-implementer').includes('habits-test-first'), 'devops-implementer does not');
    for (const seat of ['dotnet-build-error-resolver', 'dotnet-test-failure-resolver', 'ng-build-error-resolver', 'angular-test-resolver',
        'issue-diagnoser-ci', 'issue-diagnoser-runtime'])
        assert.ok(preloads(seat).includes('habits-root-cause'), `${seat} preloads habits-root-cause`);
    // Bare since 2.1.0: every skill is a project copy, and a plugin seat's bare preload loads it (Spike S6).
    for (const seat of [...verifiers, ...implementers, ...resolvers])
        assert.match(read(`stack/agents/${seat}.md`), /^\s*-\s*habits-done-gate$/m, `${seat} preloads the project copy, bare`);
});

test('the flows load their method skills by name, at the step that needs them', () => {
    assert.match(squash(read('stack/skills/task-design/SKILL.md')),
        /4\. \*\*Decompose into an ordered, minimal plan\.\*\* Load `habits-plan-writing` first/, 'solution-design loads it at method step 4');
    for (const skill of ['task-verify-plan', 'task-implement'])
        assert.ok(squash(read(`stack/skills/${skill}/SKILL.md`)).includes('Before reading the plan, load `habits-plan-writing`'), `${skill} loads the plan format before reading a plan`);
    assert.ok(squash(read('stack/skills/task-implement/SKILL.md')).includes('and `habits-test-first`, the loop every card\'s `test:` runs on'));

    assert.match(squash(read('stack/skills/task-solve/SKILL.md')), /1\. \*\*DESIGN\*\* - run `task-design`, with `habits-clarify` loaded first/);
    assert.match(squash(read('stack/skills/task-solve-cross/SKILL.md')), /## Clarify before you design \(feature family\) Before you scope a feature or dispatch any designer, load `habits-clarify`/);
    assert.match(squash(read('stack/skills/task-build-from-scratch/SKILL.md')), /### 1\. DESIGN - in-session, on Opus Load `habits-clarify` first/);
});

test('the clarify discipline and the plan format each have one home', () => {
    for (const file of ['stack/skills/task-solve-cross/SKILL.md', 'stack/skills/task-solve/SKILL.md', 'stack/skills/task-build-from-scratch/SKILL.md'])
        for (const phrase of ['one question at a time', '2-3 concrete options', 'until one reading'])
            assert.ok(!squash(read(file)).toLowerCase().includes(phrase), `${file} restates the clarify loop: '${phrase}'`);
    const clarify = squash(read('stack/skills/habits-clarify/SKILL.md'));
    for (const phrase of ['Ask one question at a time.', '2-3 concrete options, the recommended one marked', 'Until one reading is left.'])
        assert.ok(clarify.includes(phrase), `habits-clarify carries '${phrase}'`);

    assert.ok(!fs.existsSync(path.join(ROOT, 'stack/skills/task-design/references/plan-format.md')), 'the plan format lives in habits-plan-writing now');
    const stale = [];
    for (const dir of ['stack', 'setup-plugin'])
        (function walk(d) {
            for (const e of fs.readdirSync(d, { withFileTypes: true }))
            {
                const p = path.join(d, e.name);
                if (e.isDirectory()) walk(p);
                else if (/\.(md|json|js)$/.test(e.name) && fs.readFileSync(p, 'utf8').includes('plan-format.md')) stale.push(path.relative(ROOT, p));
            }
        })(path.join(ROOT, dir));
    assert.deepStrictEqual(stale, [], 'nothing shipped points at the old reference');
});

// R112: the five method skills are one group, the habits, named `habits-<method>`. None of
// them shipped under the old `project-` spelling in a release (v0.2.84 through v1.3.0), so there is
// no retirement entry - and no shipped surface may keep the old name, since a cite of it resolves to
// nothing. The old spelling is built from parts so this file never matches itself.
test('the five method skills are the habits group, and no shipped surface names the old spelling', () => {
    const methods = ['root-cause', 'done-gate', 'test-first', 'plan-writing', 'clarify'];
    for (const m of methods)
    {
        const name = `habits-${m}`;
        assert.match(read(`stack/skills/${name}/SKILL.md`), new RegExp(`^name: ${name}$`, 'm'), `${name} names itself`);
        assert.ok(!fs.existsSync(path.join(ROOT, 'stack', 'skills', 'proj' + `ect-${m}`)), `the old ${m} folder is gone`);
    }
    const old = new RegExp(`\\bproj${'ect'}-(${methods.join('|')})\\b`);
    const hits = [];
    const scan = (p) =>
    {
        const st = fs.statSync(p);
        if (st.isDirectory())
        {
            for (const e of fs.readdirSync(p)) if (e !== 'node_modules') scan(path.join(p, e));
            return;
        }
        if (!/\.(md|json|js|html|ya?ml)$/.test(p)) return;
        fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) =>
        {
            if (old.test(line)) hits.push(`${path.relative(ROOT, p)}:${i + 1}`);
        });
    };
    for (const rel of ['stack', 'setup-plugin', 'meta', 'scripts', '.claude-plugin', 'README.md', ...require('./claude-docs.js').claudeDocFiles(), 'docs/alfred-code.html', 'docs/install-footprint.md'])
        if (fs.existsSync(path.join(ROOT, rel))) scan(path.join(ROOT, rel));
    assert.deepStrictEqual(hits, [], 'a shipped surface still names a habit by its old spelling');
});

// Task 21: the sixth habit, skill writing, replaces the optional plugin's skill-authoring method.
// Its fixed trigger is a path-scoped rule on skill files in the pinned convention-rule form, installed
// everywhere like the markdown rule (a path-scoped rule costs nothing until a matching file is
// touched), and plugin-authoring points at it for the skill half instead of restating it.
test('the skill-writing habit is the sixth habit, in the core, and says what a skill is for and how it is proven', () => {
    const body = read('stack/skills/habits-skill-writing/SKILL.md');
    assert.match(body, /^name: habits-skill-writing$/m, 'it names itself');
    const desc = (body.match(/^description:\s*"?(.*?)"?$/m) || [])[1] || '';
    assert.match(desc, /^Use when /, 'the description opens on its trigger');
    assert.match(desc, /\bNot for\b/, 'and says what must not fire it');
    const flat = squash(body);
    for (const heading of ['## Is it a skill at all', '## The description is the trigger', '## One home per piece', '## The body', '## Prove it before shipping'])
        assert.ok(flat.includes(heading), `the habit carries '${heading}'`);
    for (const phrase of ['WITHOUT the skill', 'WITH it', 'adverse', 'explicit, plain and adverse'])
        assert.ok(flat.includes(phrase), `the proof names '${phrase}'`);
    // Review M4: each phrase below is the one a deleted bullet takes with it - the cite-by-description
    // rule (lint 25/26's reason), the retold-procedure rule, and every sign that the habit was skipped.
    for (const phrase of ['guaranteed to sit beside the citer', 'describe what it covers', 'retells the procedure gets obeyed in place of the body',
        'no run seen failing without it', 'retells the steps', 'restated in a second file', 'not guaranteed beside', 'only one step reads'])
        assert.ok(flat.includes(phrase), `the habit carries '${phrase}'`);
    // Review M2: a lookup skill is proven by retrieval; pressure is for a discipline only.
    assert.ok(flat.includes('proven by retrieval'), 'a lookup skill is proven by retrieval');
    assert.ok(flat.includes('pressure applies only to a discipline'), 'the adverse step is for a discipline skill');
    // Review M1: the opener is the trigger, and a pre-act gate opens on it too.
    assert.ok(flat.includes('`Use when`') && flat.includes('`Use before`') && flat.includes('`Load before`'), 'the pre-act openers are allowed');
    // R121: every opener the house descriptions use is one the habit allows.
    assert.ok(flat.includes('`Load when`'), 'the Load when opener is allowed');
    // Review I3: the frontmatter facts every skill needs live here, where every install has them.
    // 2.1.2: the listing budget and the per-entry cap are version-coupled, so the habit points at the
    // docs page to read at use instead of pinning a number, and states the house cap (lint 15c) and
    // the shape that fits under it.
    for (const fact of ['At most 160 characters', 'https://code.claude.com/docs/en/skills', 'never from memory', '`when_to_use`',
        'One short `Not for` boundary, and only where it stops a real mis-fire', '`## When to use` section of the body',
        'defaults to the folder name', '`disable-model-invocation: true`', '`user-invocable: false`'])
        assert.ok(flat.includes(fact), `the habit states '${fact}'`);
    for (const pinned of ['1% of the context window', '1,536'])
        assert.ok(!flat.includes(pinned), `the habit reads the budget at use, never pins '${pinned}'`);
    const recs = JSON.parse(read('meta/recommendations.json'));
    assert.ok(recs.always.skills.includes('habits-skill-writing'), 'seeded in the always set, like the other five');
    assert.match(read('setup-plugin/references/walk.md'), /the `habits-\*` habits/, 'the walk names the habits without a count - the count drifted from the always list');
});

test('the skill-authoring rule attaches on skill files and its first action is the habit', () => {
    const rule = read('stack/rules/skill-authoring.md');
    assert.match(rule, /^paths: \["\*\*\/SKILL\.md", "\*\*\/skills\/\*\*\/\*\.md"\]$/m, 'the two skill-file globs');
    assert.ok(squash(rule).includes('the FIRST action after this rule attaches is the `habits-skill-writing` Skill call, before the NEXT write'),
        'the pinned convention-rule first-action form, naming the habit');
    const pin = JSON.parse(read('meta/shared-rules.json')).rules['convention-rule-first-action'];
    assert.ok(pin.sites.some((s) => s.file === 'stack/rules/skill-authoring.md'), 'the form is pinned in this rule too');

    const recs = JSON.parse(read('meta/recommendations.json'));
    assert.ok(recs.always.rules.includes('skill-authoring'), 'installed on every install, like markdown-docs');
    const manifest = JSON.parse(read('meta/stack-manifest.json'));
    assert.ok(manifest.rules.some((r) => r.file === 'skill-authoring.md'), 'the manifest ships it');
    assert.deepStrictEqual(graph.rules['skill-authoring'].skills, ['habits-skill-writing'], 'the rule pulls the habit');
    assert.deepStrictEqual(graph.rules['skill-authoring'].paths, ['**/SKILL.md', '**/skills/**/*.md']);

    // The attach, through the analyzer's own model of a `paths:` glob (the subset the harness honours).
    const { globToRe } = require('./analyze-usage.js');
    const attaches = (p) => graph.rules['skill-authoring'].paths.some((g) => globToRe(g).test(p));
    for (const p of ['stack/skills/csharp/SKILL.md', '.claude/skills/my-skill/SKILL.md', 'SKILL.md', '/work/app/skills/api/references/endpoints.md',
        'stack/skills/devops/references/compose.md'])
        assert.ok(attaches(p), `attaches on ${p}`);
    for (const p of ['README.md', 'docs/skills.md', 'stack/skills/csharp/scripts/run.js', 'stack/rules/csharp-conventions.md', 'skill.md'])
        assert.ok(!attaches(p), `does not attach on ${p}`);
});

// plugin-authoring left the shipped catalog in 2.1.0; this repo's own copy in .claude/skills is tracked through a .gitignore negation.
test('plugin-authoring is self-contained (it names no stack skill), and the repo notes name the habit instead of the plugin method', () => {
    const raw = read('.claude/skills/plugin-authoring/SKILL.md');
    const pa = squash(raw);
    const bullet = raw.split('\n').filter((l, i, all) => l.startsWith('- **Skills**') || (i && all[i - 1].startsWith('- **Skills**') && /^  \S/.test(l)));
    assert.strictEqual(bullet.length, 1, 'the Skills bullet is one line');
    assert.ok(!pa.includes('habits-skill-writing'), 'plugin-authoring names no stack skill: it is this repo\'s own and stands alone');
    for (const moved of ['Body under 500 lines', 'references one level deep', 'third person, what it covers', '1,536', 'skillListingBudgetFraction',
        'user-invocable', 'description, not the body'])
        assert.ok(!pa.includes(moved), `plugin-authoring still carries the habit's text: '${moved}'`);
    const evals = squash(read('.claude/skills/plugin-authoring/references/evals.md'));
    assert.ok(!/DESCRIPTION is wrong, not the body/.test(evals), 'the eval reference no longer restates the trigger rule');
    assert.ok(!evals.includes('habits-skill-writing'), 'the eval reference names no stack skill either');
    const md = squash(read('CLAUDE.md'));
    assert.ok(md.includes('Authoring a skill in `stack/skills/`: the method is `habits-skill-writing`'), 'CLAUDE.md points at the habit');
    assert.ok(!md.includes('writing-skills is a reference'), 'and no longer at the optional plugin');
});

// Review I2 + R118: the habit's own rule - a description that retells the procedure gets obeyed in
// place of the body - holds for every habit. Each description says when, and what it is NOT for with
// where that case goes, and never walks its loop.
test('the habit descriptions are triggers only - when, and what they are not for with its destination', () => {
    const retold = {
        'habits-root-cause': ['reproduce', 'hypothesis', 'localize', 'compare with'],
        'habits-clarify': ['one question at a time', '2-3', 'until one reading', 'find its readings'],
        'habits-test-first': ['watch it fail', 'minimal code', 'refactor', 'see it green'],
        'habits-done-gate': ['output quoted', 'scoped runs', 'full suite', 'red trace'],
        'habits-code-comments': ['ticket id', 'change narration', 'one short line', 'CS1573'],
        'habits-execution-strategy': ['single agent', 'parallel tool calls', 'three tiers', 'contracts first'],
    };
    for (const skill of [...Object.keys(retold), 'habits-skill-writing'])
    {
        const text = read(`stack/skills/${skill}/SKILL.md`);
        const desc = (text.match(/^description:\s*"?(.*?)"?$/m) || [])[1] || '';
        const extra = (text.match(/^when_to_use:\s*"?(.*?)"?$/m) || [])[1] || '';
        assert.match(desc, /^(Use when|Use before|Load when|Load before) /, `${skill} opens on its trigger`);
        assert.match(desc, /\bNot for\b.*\b(that is|which|goes to|owns|belongs to)\b/, `${skill} names where its 'Not for' case goes`);
        assert.ok(desc.length + extra.length <= 1536, `${skill} fits the listing's per-entry cap`);
        for (const step of retold[skill] || [])
            assert.ok(!desc.includes(step), `${skill}'s description retells its loop: '${step}'`);
    }
});

test('the solve and diagnose flows load the execution strategy before they decide how the work runs', () => {
    const body = (n) => squash(read(`stack/skills/${n}/SKILL.md`));
    const solve = body('task-solve');
    const at = (text, needle) => text.indexOf(needle);
    const load = 'load `habits-execution-strategy` (the Skill tool)';
    assert.ok(at(solve, load) > at(solve, '3. **APPROVE**') && at(solve, load) < at(solve, 'The plan is gated.'), 'task-solve loads it before the step-3 mode ask');
    assert.ok(at(solve, '`habits-execution-strategy` load come first') < at(solve, 'Full spec - designed and audited'), 'the merged approval loads it first too');
    const cross = body('task-solve-cross');
    assert.ok(at(cross, load) > -1 && at(cross, load) < at(cross, 'Size <size> across'), 'task-solve-cross loads it before its mode ask');
    const diag = body('issue-diagnoser');
    assert.ok(at(diag, load) > at(diag, '4b. PLAN TASKS') && at(diag, load) < at(diag, 'Then decompose the minimal change'), 'issue-diagnoser loads it before the fix cards');
    assert.match(squash(read('stack/skills/task-solve/references/step-mechanics.md')), /`parallel seats` recommends agents/, 'the mode-fit rule follows the verdict');
    const strategy = squash(read('stack/skills/habits-execution-strategy/SKILL.md'));
    assert.doesNotMatch(strategy, /Not inside a stamped solve flow/, 'the flows are no longer excluded');
    assert.match(strategy, /how the work runs, not only what it changes/, 'it reasons about how the work runs');
    assert.match(strategy, /can these units run at the same time without losing quality\?/, 'it asks the parallel question');
    assert.match(strategy, /\*\*parallel is the recommendation\*\*/, 'parallel is recommended when quality holds');
    assert.match(strategy, /Execution: route <direct \| the flow offered> - mode <serial \| batched \| parallel seats: <n>> - model </, 'one verdict names route, mode and model');
    for (const route of ['**Direct**', 'gated single-chat solve flow', 'cross-domain solve flow', 'diagnose flow', 'greenfield or framework-upgrade flows'])
        assert.ok(strategy.includes(route), `the route list holds ${route}`);
    assert.match(strategy, /never a silent switch/, 'a flow route is offered, never taken silently');
    assert.match(strategy, /the effort cannot/, 'only the model is overridable per dispatch');
    assert.match(strategy, /never below the pin on auth, a migration/, 'a risk path keeps the seat pin');
    const always = squash(read('stack/rules/alfred-interaction.md'));
    assert.match(always, /Every task settles how it runs before its first edit - route, mode, model\. A small task settles it inline, no Skill call/, 'every task decides how it runs');
});

test('audit 2026-10-08: the execution verdict stays out of plan files, small tasks get no plan, direct-route edits never dispatch', () => {
    const strategy = squash(read('stack/skills/habits-execution-strategy/SKILL.md'));
    // C7: a plan never carries the run (habits-plan-writing, task-design) - a flow's plan file included
    assert.match(strategy, /never a plan file - a flow's plan file included: there the `Execution:` line rides the flow's mode ask/, 'the verdict rides the mode ask');
    assert.doesNotMatch(strategy, /the flow's own plan or findings file/, 'no plan or findings file carries the verdict');
    const diag = squash(read('stack/skills/issue-diagnoser/SKILL.md'));
    assert.match(diag, /never written into the findings file/, 'the diagnoser states the verdict in its close');
    // the direct route never dispatches an implementer: the guard needs a stamp only a flow writes
    assert.match(strategy, /on the direct route the seats are read-only ones/, 'direct-route seats are read-only');
    assert.match(strategy, /Edit seats are the house `<stack>-implementer`, inside a flow/, 'edit seats live inside a flow');
    assert.match(strategy, /```ask This task fits <the flow>/, 'the route offer is an ask template');
    assert.match(strategy, /Up to 3 at once by default, more only on the user's ask/, 'the fan-out cap matches the flows');
    // C1: the 10+ file mechanical change is a small task with no plan, not a second rule beside the trigger
    const rule = read('stack/rules/alfred-interaction.md');
    assert.doesNotMatch(rule, /^- A mechanical change across 10\+ files: confirm the scope list, no plan\./m, 'the separate no-plan line is folded in');
    assert.match(squash(rule), /A small task settles it inline, no Skill call, and gets no plan: a typo, a one-line fix, formatting, a dep bump, a single-file rename, or a mechanical change across 10\+ files once the user confirms its scope list\. Any other task/, 'one line holds both sides of the threshold');
});

test('the inline task skills load their method skill through the Skill tool at the right point', () => {
    const body = (n) => squash(read(`stack/skills/${n}/SKILL.md`));
    const design = body('task-design');
    assert.match(design, /Before you orient or design anything, load `habits-clarify` \(the Skill tool\) and run it/, 'design loads clarify first');
    assert.match(design, /Load `habits-plan-writing` first \(the Skill tool\)/, 'design loads plan-writing');
    assert.match(body('task-implement'), /load `habits-plan-writing` \(the Skill tool\)[^.]*and `habits-test-first`/, 'implement loads test-first');
    const verify = body('task-verify-code');
    assert.match(verify, /Before the verdict is stamped, load `habits-done-gate` \(the Skill tool\)/, 'verify-code loads the done gate');
    assert.match(verify, /only on a build and suite run this session/, 'a pass needs a run this session');
});
