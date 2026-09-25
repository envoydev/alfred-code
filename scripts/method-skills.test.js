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
    const gates = squash(read('stack/rules/baseline-quality-gates.md'));
    assert.ok(gates.includes('the FIRST action is the `alfred-habits-done-gate` Skill call, before the claim lands'));
    for (const moved of ['tail long runs to the verdict', 'SCOPED test command', 'never suppress a warning, weaken a test'])
        assert.ok(!gates.includes(moved), `baseline-quality-gates still carries the done gate's method: '${moved}'`);

    const interaction = squash(read('stack/rules/baseline-interaction.md'));
    for (const skill of ['alfred-habits-plan-writing', 'alfred-habits-test-first', 'alfred-habits-root-cause', 'alfred-habits-clarify'])
        assert.match(interaction, new RegExp(`the FIRST action is the \`${skill}\` Skill call, before `), `${skill} pointer`);
    for (const moved of ['bite-sized', 'watch it fail', 'read the full error and quote'])
        assert.ok(!interaction.includes(moved), `baseline-interaction still carries method text: '${moved}'`);
});

test('every verifier, implementer and resolver preloads the done gate, every implementer test-first, the resolvers root-cause', () => {
    const preloads = (seat) => graph.agents[seat].skills;
    const verifiers = agents.filter((a) => a.endsWith('-verifier'));
    const implementers = agents.filter((a) => a.endsWith('-implementer'));
    assert.strictEqual(verifiers.length, 10);
    assert.strictEqual(implementers.length, 10);
    const resolvers = ['dotnet-build-error-resolver', 'dotnet-test-failure-resolver', 'ng-build-error-resolver', 'angular-test-resolver'];
    // a resolver's whole output is a 'green' claim, and the done gate is Stop-only - the preload is its trigger
    for (const seat of [...verifiers, ...implementers, ...resolvers])
        assert.ok(preloads(seat).includes('alfred-habits-done-gate'), `${seat} preloads alfred-habits-done-gate`);
    for (const seat of implementers)
        assert.ok(preloads(seat).includes('alfred-habits-test-first'), `${seat} preloads alfred-habits-test-first`);
    for (const seat of ['dotnet-build-error-resolver', 'dotnet-test-failure-resolver', 'ng-build-error-resolver', 'angular-test-resolver',
        'ci-failure-diagnoser', 'runtime-failure-diagnoser'])
        assert.ok(preloads(seat).includes('alfred-habits-root-cause'), `${seat} preloads alfred-habits-root-cause`);
    // Scoped to the core, the spelling a stale library copy cannot shadow (Spike S6).
    for (const seat of [...verifiers, ...implementers, ...resolvers])
        assert.match(read(`stack/agents/${seat}.md`), /^\s*-\s*alfred-code:alfred-habits-done-gate$/m, `${seat} scopes the preload to the core`);
});

test('the flows load their method skills by name, at the step that needs them', () => {
    assert.match(squash(read('stack/skills/project-solution-design/SKILL.md')),
        /4\. \*\*Decompose into an ordered, minimal plan\.\*\* Load `alfred-habits-plan-writing` first/, 'solution-design loads it at method step 4');
    for (const skill of ['project-verify-plan', 'project-implementer'])
        assert.ok(squash(read(`stack/skills/${skill}/SKILL.md`)).includes('Before reading the plan, load `alfred-habits-plan-writing`'), `${skill} loads the plan format before reading a plan`);
    assert.ok(squash(read('stack/skills/project-implementer/SKILL.md')).includes('and `alfred-habits-test-first`, the loop every card\'s `test:` runs on'));

    assert.match(squash(read('stack/skills/project-solve-task/SKILL.md')), /1\. \*\*DESIGN\*\* - run `project-solution-design`, with `alfred-habits-clarify` loaded first/);
    assert.match(squash(read('stack/skills/project-solve-cross-task/SKILL.md')), /## Clarify before you design \(feature family\) Before you scope a feature or dispatch any designer, load `alfred-habits-clarify`/);
    assert.match(squash(read('stack/skills/project-build-from-scratch/SKILL.md')), /### 1\. DESIGN - in-session, on Opus Load `alfred-habits-clarify` first/);
});

test('the clarify discipline and the plan format each have one home', () => {
    for (const file of ['stack/skills/project-solve-cross-task/SKILL.md', 'stack/skills/project-solve-task/SKILL.md', 'stack/skills/project-build-from-scratch/SKILL.md'])
        for (const phrase of ['one question at a time', '2-3 concrete options', 'until one reading'])
            assert.ok(!squash(read(file)).toLowerCase().includes(phrase), `${file} restates the clarify loop: '${phrase}'`);
    const clarify = squash(read('stack/skills/alfred-habits-clarify/SKILL.md'));
    for (const phrase of ['Ask one question at a time.', '2-3 concrete options, the recommended one marked', 'Until one reading is left.'])
        assert.ok(clarify.includes(phrase), `alfred-habits-clarify carries '${phrase}'`);

    assert.ok(!fs.existsSync(path.join(ROOT, 'stack/skills/project-solution-design/references/plan-format.md')), 'the plan format lives in alfred-habits-plan-writing now');
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

// R112: the five method skills are one group, the habits, named `alfred-habits-<method>`. None of
// them shipped under the old `project-` spelling in a release (v0.2.84 through v1.3.0), so there is
// no retirement entry - and no shipped surface may keep the old name, since a cite of it resolves to
// nothing. The old spelling is built from parts so this file never matches itself.
test('the five method skills are the habits group, and no shipped surface names the old spelling', () => {
    const methods = ['root-cause', 'done-gate', 'test-first', 'plan-writing', 'clarify'];
    for (const m of methods)
    {
        const name = `alfred-habits-${m}`;
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
    for (const rel of ['stack', 'setup-plugin', 'meta', 'scripts', '.claude-plugin', 'README.md', 'CLAUDE.md', 'docs/alfred-code.html'])
        if (fs.existsSync(path.join(ROOT, rel))) scan(path.join(ROOT, rel));
    assert.deepStrictEqual(hits, [], 'a shipped surface still names a habit by its old spelling');
});
