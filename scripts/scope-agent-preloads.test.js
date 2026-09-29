'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { scopedFor, parse } = require('./scope-agent-preloads.js');
const { placement, CORE } = require('./plugin-placement.js');

const ROOT = path.join(__dirname, '..');
const rows = scopedFor();
const place = placement();

test('every agent with a preload list is placed, and every cite it makes is reachable', () => {
    assert.ok(rows.length >= 30, `expected the seats to declare preloads, got ${rows.length}`);
    for (const r of rows) assert.strictEqual(r.problem, null, `${r.file}: ${r.problem}`);
});

test('the shipped files are already scoped - the generator has nothing to do', () => {
    const stale = rows.filter(r => r.block !== r.wanted).map(r => r.file);
    assert.deepStrictEqual(stale, [], 'run `npm run scope-preloads` and commit the result');
});

// 2.1.0: every house skill is a project copy and every seat rides the core, so every house cite is
// BARE - the project copy (plugin-migration-evidence S6: a plugin seat's bare preload loaded the project
// copy). The graph closes a picked seat's preloads into its selection, so the copy is there whenever
// the seat is not denied.
test('every house cite is bare - the project copy - and names a library skill', () => {
    const library = new Set(place.library.skills);
    let bare = 0;
    for (const r of rows)
    {
        for (const line of r.wanted.split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean))
        {
            if (line === 'skills:' || line.includes(':')) { assert.ok(!line.startsWith(`${CORE}:`), `${r.file}: ${line} is scoped to the core, which carries no skill`); continue; }
            bare++;
            assert.ok(library.has(line), `${r.file}: bare ${line} must be a library skill`);
        }
    }
    assert.ok(bare > 100, `the seats preload house skills (${bare})`);
});

// No shipped agent preloads a foreign skill since R72, so a fixture seat carries one.
test('a FOREIGN cite is left exactly as it is - this generator owns house skills only', () => {
    const os = require('node:os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preload-foreign-'));
    try
    {
        fs.writeFileSync(path.join(dir, 'alfred-issue-diagnoser-ci.md'),
            '---\nname: alfred-issue-diagnoser-ci\nskills:\n  - other-plugin:some-skill\n  - alfred-code:alfred-habits-root-cause\n---\n\nbody\n');
        const [row] = scopedFor({ agentsDir: dir });
        assert.strictEqual(row.problem, null, row.problem);
        assert.strictEqual(row.wanted, 'skills:\n  - other-plugin:some-skill\n  - alfred-habits-root-cause\n',
            'the foreign cite is untouched, the house one bare');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 'You can't preload skills that set disable-model-invocation: true, since preloading draws from the
// same set of skills Claude can invoke' (code.claude.com/docs/en/sub-agents) - such a cite is skipped
// silently at dispatch, so the generator refuses it.
test('a preload of a manual-only skill is a problem - Claude Code skips it silently', () => {
    const os = require('node:os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preload-dmi-'));
    try
    {
        fs.writeFileSync(path.join(dir, 'aspnet-implementer.md'), '---\nname: aspnet-implementer\nskills:\n  - alfred-task-solve\n  - csharp\n---\n\nbody\n');
        const [row] = scopedFor({ agentsDir: dir });
        assert.match(String(row.problem), /alfred-task-solve is manual-only/);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('both diagnosers preload the house root-cause skill, bare', () => {
    for (const file of ['alfred-issue-diagnoser-ci.md', 'alfred-issue-diagnoser-runtime.md'])
    {
        const r = rows.find(x => x.file === file);
        assert.ok(r, `${file} declares preloads`);
        assert.match(r.block, /^\s*-\s*alfred-habits-root-cause$/m, `${file} preloads alfred-habits-root-cause`);
        assert.doesNotMatch(r.block, /superpowers/, `${file} still preloads a superpowers skill`);
    }
});

test('a flow-style skills: line is reported, never silently guessed at', () => {
    assert.throws(() => parse('---\nname: x\nskills: [a, b]\n---\nbody\n', 'x.md'), /not a YAML list/);
    assert.strictEqual(parse('---\nname: x\n---\nbody\n', 'x.md'), null, 'no list at all is simply nothing to do');
});

test('the graph still stores BARE skill names, or placement and the prefix would define each other', () => {
    const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta/stack-graph.json'), 'utf8'));
    for (const [agent, node] of Object.entries(graph.agents))
        for (const s of node.skills || [])
            assert.ok(!s.includes(':'), `${agent} carries a scoped name in the graph: ${s}`);
});
