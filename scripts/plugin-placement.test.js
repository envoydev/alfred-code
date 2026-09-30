'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { placement, formerCore, costOf, costToday, CORE, LIBRARY } = require('./plugin-placement.js');
const { computeClosure } = require('./stack-select.js');

const REPO = path.resolve(__dirname, '..');
const p = placement();
const graph = JSON.parse(fs.readFileSync(path.join(REPO, 'meta/stack-graph.json'), 'utf8'));
const recs = JSON.parse(fs.readFileSync(path.join(REPO, 'meta/recommendations.json'), 'utf8'));

// 2.1.0: a skill needs a per-project off-switch (a copy can be deleted or set `off` in skillOverrides;
// a plugin skill is locked on, the 2026-09-24 library test), and a seat already has one in
// `permissions.deny` (spike S3). So every skill is a project copy and every seat rides the core.
test('the core carries every seat and no skill', () => {
    const core = p.plugins[CORE];
    assert.ok(core, 'the core plugin must exist');
    assert.deepStrictEqual(core.skills, [], 'no skill rides the core - every one is a project copy');
    assert.deepStrictEqual(core.agents, Object.keys(graph.agents).sort(), 'every seat rides the core');
    for (const a of ['integration-reviewer', 'security-auditor'])
        assert.ok(core.agents.includes(a), `${a} rides the core`);
    assert.deepStrictEqual(core.dependencies, [], 'the core depends on nothing');
});

test('every skill is a library copy, every habit included; no seat is', () => {
    assert.deepStrictEqual(p.library.skills, Object.keys(graph.skills).sort());
    assert.deepStrictEqual(p.library.agents, []);
    for (const s of ['alfred-habits-root-cause', 'alfred-habits-done-gate', 'alfred-habits-test-first', 'alfred-habits-plan-writing',
        'alfred-habits-clarify', 'alfred-habits-skill-writing', 'alfred-habits-execution-strategy', 'alfred-habits-code-comments', 'alfred-habits-commit-checkpoint',
        'alfred-habits-adjust-agents-md', 'alfred-habits-create-ticket', 'alfred-habits-explain-code'])
        assert.ok(p.library.skills.includes(s), `${s} is a project copy`);
});

test('the core is the only plugin; every item has exactly one home', () => {
    assert.deepStrictEqual(Object.keys(p.plugins), [CORE]);
    assert.strictEqual(LIBRARY, 'library');
    const core = p.plugins[CORE];
    for (const s of Object.keys(graph.skills))
        assert.ok(core.skills.includes(s) !== p.library.skills.includes(s), `skill ${s} has exactly one home`);
    for (const a of Object.keys(graph.agents))
        assert.ok(core.agents.includes(a) !== p.library.agents.includes(a), `agent ${a} has exactly one home`);
    assert.ok(p.library.skills.includes('angular-conventions'));
    assert.ok(core.agents.includes('angular-test-resolver') && core.agents.includes('related-project-analyzer'));
    assert.ok(!(LIBRARY in p.plugins), 'the library is a set of files, never a plugin entry');
});

test('the opt-in skills and the opt-in agent are placed like every stack item', () => {
    for (const s of ['postgres', 'alfred-capture-related-projects', 'dotnet-web-backend'])
        assert.ok(p.library.skills.includes(s), `${s} is library`);
    assert.ok(!p.library.skills.includes('plugin-authoring') && !p.plugins[CORE].skills.includes('plugin-authoring'), 'plugin-authoring left the shipped catalog (2.1.0)');
    assert.ok(p.plugins[CORE].agents.includes('related-project-analyzer'), 'the opt-in seat rides the core, denied until picked');
});

// What the core carried BEFORE 2.1.0 - the always closure - is what a 2.0.x install's read-back and
// the 1.x alias still go by.
test('formerCore is the always closure: the skills and seats the core carried before 2.1.0', () => {
    const want = computeClosure(graph, recs.always);
    const former = formerCore();
    assert.deepStrictEqual(former.skills, [...want.skills].sort());
    assert.deepStrictEqual(former.agents, [...want.agents].sort());
    for (const s of ['alfred-habits-done-gate', 'alfred-capture-agent-capabilities', 'alfred-task-solve-cross', 'alfred-habits-adjust-agents-md'])
        assert.ok(former.skills.includes(s), `${s} is always-closure, so the former core carried it`);
    assert.ok(former.agents.includes('security-auditor') && former.agents.includes('integration-reviewer'));
    assert.ok(!former.agents.includes('aspnet-implementer'), 'a stack seat was library then');
});

test('a project pays exactly its per-item closure', () => {
    for (const stacks of [['web-angular'], ['aspnet', 'data'], ['browser-extension']])
        assert.strictEqual(costOf(p, stacks).chars, costToday(stacks).chars, stacks.join('+'));
});

test('costOf never double-counts and grows with the stacks', () => {
    const one = costOf(p, ['aspnet']);
    assert.strictEqual(one.chars, costOf(p, ['aspnet', 'aspnet']).chars, 'a repeated stack is not paid twice');
    assert.deepStrictEqual(one.plugins, [CORE], 'a project enables the core and nothing else of the stack');
    assert.ok(costOf(p, ['aspnet', 'web-angular', 'data']).chars > one.chars, 'more stacks cost more');
});
