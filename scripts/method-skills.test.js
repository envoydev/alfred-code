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
    assert.ok(gates.includes('the FIRST action is the `project-done-gate` Skill call, before the claim lands'));
    for (const moved of ['tail long runs to the verdict', 'SCOPED test command', 'never suppress a warning, weaken a test'])
        assert.ok(!gates.includes(moved), `baseline-quality-gates still carries the done gate's method: '${moved}'`);

    const interaction = squash(read('stack/rules/baseline-interaction.md'));
    for (const skill of ['project-plan-writing', 'project-test-first', 'project-root-cause'])
        assert.match(interaction, new RegExp(`the FIRST action is the \`${skill}\` Skill call, before `), `${skill} pointer`);
    for (const moved of ['bite-sized', 'watch it fail', 'read the full error and quote'])
        assert.ok(!interaction.includes(moved), `baseline-interaction still carries method text: '${moved}'`);
});

test('every verifier and implementer preloads the done gate, every implementer test-first, the resolvers root-cause', () => {
    const preloads = (seat) => graph.agents[seat].skills;
    const verifiers = agents.filter((a) => a.endsWith('-verifier'));
    const implementers = agents.filter((a) => a.endsWith('-implementer'));
    assert.strictEqual(verifiers.length, 10);
    assert.strictEqual(implementers.length, 10);
    for (const seat of [...verifiers, ...implementers])
        assert.ok(preloads(seat).includes('project-done-gate'), `${seat} preloads project-done-gate`);
    for (const seat of implementers)
        assert.ok(preloads(seat).includes('project-test-first'), `${seat} preloads project-test-first`);
    for (const seat of ['dotnet-build-error-resolver', 'dotnet-test-failure-resolver', 'ng-build-error-resolver', 'angular-test-resolver',
        'ci-failure-diagnoser', 'runtime-failure-diagnoser'])
        assert.ok(preloads(seat).includes('project-root-cause'), `${seat} preloads project-root-cause`);
    // Scoped to the core, the spelling a stale library copy cannot shadow (Spike S6).
    for (const seat of [...verifiers, ...implementers])
        assert.match(read(`stack/agents/${seat}.md`), /^\s*-\s*alfred-code:project-done-gate$/m, `${seat} scopes the preload to the core`);
});

test('the flows load their method skills by name, at the step that needs them', () => {
    assert.match(squash(read('stack/skills/project-solution-design/SKILL.md')),
        /4\. \*\*Decompose into an ordered, minimal plan\.\*\* Load `project-plan-writing` first/, 'solution-design loads it at method step 4');
    for (const skill of ['project-verify-plan', 'project-implementer'])
        assert.ok(squash(read(`stack/skills/${skill}/SKILL.md`)).includes('Before reading the plan, load `project-plan-writing`'), `${skill} loads the plan format before reading a plan`);
    assert.ok(squash(read('stack/skills/project-implementer/SKILL.md')).includes('and `project-test-first`, the loop every card\'s `test:` runs on'));

    assert.match(squash(read('stack/skills/project-solve-task/SKILL.md')), /1\. \*\*DESIGN\*\* - run `project-solution-design`, with `project-clarify` loaded first/);
    assert.match(squash(read('stack/skills/project-solve-cross-task/SKILL.md')), /## Clarify before you design \(feature family\) Before you scope a feature or dispatch any designer, load `project-clarify`/);
    assert.match(squash(read('stack/skills/project-build-from-scratch/SKILL.md')), /### 1\. DESIGN - in-session, on Opus Load `project-clarify` first/);
});

test('the clarify discipline and the plan format each have one home', () => {
    for (const file of ['stack/skills/project-solve-cross-task/SKILL.md', 'stack/skills/project-solve-task/SKILL.md', 'stack/skills/project-build-from-scratch/SKILL.md'])
        for (const phrase of ['one question at a time', '2-3 concrete options', 'until one reading'])
            assert.ok(!squash(read(file)).toLowerCase().includes(phrase), `${file} restates the clarify loop: '${phrase}'`);
    const clarify = squash(read('stack/skills/project-clarify/SKILL.md'));
    for (const phrase of ['Ask one question at a time.', '2-3 concrete options, the recommended one marked', 'Until one reading is left.'])
        assert.ok(clarify.includes(phrase), `project-clarify carries '${phrase}'`);

    assert.ok(!fs.existsSync(path.join(ROOT, 'stack/skills/project-solution-design/references/plan-format.md')), 'the plan format lives in project-plan-writing now');
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
