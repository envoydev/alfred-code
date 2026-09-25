'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { placement, costOf, costToday, CORE, LIBRARY } = require('./plugin-placement.js');

const REPO = path.resolve(__dirname, '..');
const p = placement();

test('the core plugin is exactly the always closure - 28 skills, 8 agents', () => {
    const core = p.plugins[CORE];
    assert.ok(core, 'the core plugin must exist');
    assert.strictEqual(core.skills.length, 28);
    assert.strictEqual(core.agents.length, 8);
    for (const s of ['project-agent-capabilities', 'project-solve-cross-task'])
        assert.ok(core.skills.includes(s), `${s} is always-closure, so it belongs to the core`);
    for (const a of ['integration-reviewer', 'security-auditor'])
        assert.ok(core.agents.includes(a), `${a} is always-closure, so it belongs to the core`);
    assert.deepStrictEqual(core.dependencies, [], 'the core depends on nothing');
});

// R106: the method skills the superpowers pack used to carry each ride the CORE, so every install
// has them and every citer - a baseline pointer, a seat's preload, a flow's Skill call, a hook's
// message, a path-scoped rule - may name them. A library copy could be switched off per project.
// Task 21 added the sixth, skill writing.
test('the six habits land in the core, never the library', () => {
    const six = ['alfred-habits-root-cause', 'alfred-habits-done-gate', 'alfred-habits-test-first', 'alfred-habits-plan-writing', 'alfred-habits-clarify',
        'alfred-habits-skill-writing'];
    for (const s of six)
    {
        assert.ok(p.plugins[CORE].skills.includes(s), `${s} belongs to the core`);
        assert.ok(!p.library.skills.includes(s), `${s} is never a library copy`);
    }
});

test('the core is the only plugin; every other item is library', () => {
    assert.deepStrictEqual(Object.keys(p.plugins), [CORE]);
    assert.strictEqual(LIBRARY, 'library');
    const graph = JSON.parse(fs.readFileSync(path.join(REPO, 'meta/stack-graph.json'), 'utf8'));
    const core = p.plugins[CORE];
    for (const s of Object.keys(graph.skills))
        assert.ok(core.skills.includes(s) !== p.library.skills.includes(s), `skill ${s} has exactly one home`);
    for (const a of Object.keys(graph.agents))
        assert.ok(core.agents.includes(a) !== p.library.agents.includes(a), `agent ${a} has exactly one home`);
    assert.strictEqual(p.library.skills.length + core.skills.length, Object.keys(graph.skills).length);
    assert.strictEqual(p.library.agents.length + core.agents.length, Object.keys(graph.agents).length);
    assert.ok(p.library.skills.includes('angular-conventions'));
    assert.ok(p.library.agents.includes('angular-test-resolver'));
});

test('the opt-in skills and the opt-in agent are library like every stack item', () => {
    for (const s of ['plugin-authoring', 'postgres', 'project-related-context', 'dotnet-web-backend'])
        assert.ok(p.library.skills.includes(s), `${s} is library`);
    assert.ok(p.library.agents.includes('related-project-analyzer'));
    assert.ok(!(LIBRARY in p.plugins), 'the library is a set of files, never a plugin entry');
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
