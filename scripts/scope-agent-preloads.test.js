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

// Spike S11: a scoped cite resolves even when the skill lives in a DIFFERENT plugin, which is the
// majority case here. Spike S6: the BARE form preloads a stale project copy when one is present.
test('a core cite is scoped to the core, a library cite is bare - the project copy', () => {
    const core = new Set(place.plugins[CORE].skills);
    const library = new Set(place.library.skills);
    let scoped = 0;
    let bare = 0;
    for (const r of rows)
    {
        for (const line of r.wanted.split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean))
        {
            if (line === 'skills:' || (line.includes(':') && !line.startsWith(`${CORE}:`))) continue;   // foreign
            if (line.startsWith(`${CORE}:`))
            {
                scoped++;
                assert.ok(core.has(line.slice(CORE.length + 1)), `${r.file}: ${line} is not a core skill`);
            }
            else
            {
                bare++;
                assert.ok(library.has(line), `${r.file}: bare ${line} must be a library skill`);
            }
        }
    }
    assert.ok(scoped > 0 && bare > 0, `both forms must occur (scoped ${scoped}, bare ${bare}), or this proves nothing`);
});

// No shipped agent preloads a foreign skill since R72, so a fixture seat carries one.
test('a FOREIGN cite is left exactly as it is - this generator owns house skills only', () => {
    const os = require('node:os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preload-foreign-'));
    try
    {
        fs.writeFileSync(path.join(dir, 'ci-failure-diagnoser.md'),
            '---\nname: ci-failure-diagnoser\nskills:\n  - other-plugin:some-skill\n  - alfred-habits-root-cause\n---\n\nbody\n');
        const [row] = scopedFor({ agentsDir: dir });
        assert.strictEqual(row.problem, null, row.problem);
        assert.strictEqual(row.wanted, 'skills:\n  - other-plugin:some-skill\n  - alfred-code:alfred-habits-root-cause\n',
            'the foreign cite is untouched, the house one scoped');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// R72: the root-cause method is a CORE house skill, and both diagnosers are core seats - so each
// preloads it scoped to the core, which Spike S6 showed is the spelling that cannot pick up a stale copy.
test('both diagnosers preload the house root-cause skill, scoped to the core', () => {
    for (const file of ['ci-failure-diagnoser.md', 'runtime-failure-diagnoser.md'])
    {
        const r = rows.find(x => x.file === file);
        assert.ok(r, `${file} declares preloads`);
        assert.match(r.block, /^\s*-\s*alfred-code:alfred-habits-root-cause$/m, `${file} preloads alfred-code:alfred-habits-root-cause`);
        assert.doesNotMatch(r.block, /superpowers/, `${file} still preloads a superpowers skill`);
    }
    assert.ok(place.plugins[CORE].skills.includes('alfred-habits-root-cause'), 'the core carries the skill both core seats preload');
});

test('a core agent cites no library skill - the core would not carry what it preloads', () => {
    const coreAgents = new Set(place.plugins[CORE].agents);
    for (const r of rows.filter(x => coreAgents.has(x.agent)))
        assert.doesNotMatch(r.wanted, /^\s*-\s*[a-z0-9-]+\s*$/m, `${r.file} is a core seat citing a bare (library) skill`);
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
