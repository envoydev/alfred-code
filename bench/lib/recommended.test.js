'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { recommendedRaw } = require('./recommended.js');

const RECS = {
    always: { rules: ['baseline-git'], hooks: ['guard-a'], mcps: ['serena'] },
    general: { skills: ['never-seeded'] },
    stacks: {
        aspnet: { rules: ['dotnet-conventions'], agents: ['aspnet-implementer'], skills: ['shared'] },
        data: { skills: ['shared', 'sql'] },
    },
};

test('every recommended item of the always set and each confirmed stack, plus the evidence found', () =>
{
    const raw = recommendedRaw({ recs: RECS, stacks: ['aspnet', 'data'], found: { mcps: { playwright: { pkg: 'x' } } } });
    assert.deepStrictEqual(raw, {
        rules: ['baseline-git', 'dotnet-conventions'],
        agents: ['aspnet-implementer'],
        skills: ['shared', 'sql'],
        hooks: ['guard-a'],
        mcps: ['playwright', 'serena'],
        plugins: [],
    });
});

test('the general list is never seeded, and an unknown stack is named', () =>
{
    const raw = recommendedRaw({ recs: RECS, stacks: [], found: {} });
    assert.ok(!raw.skills.includes('never-seeded'));
    assert.throws(() => recommendedRaw({ recs: RECS, stacks: ['angular'], found: {} }), /unknown stack 'angular'/);
});

test('the command line runs the source\'s own scan and closure and writes a selection file', (t) =>
{
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const { execFileSync } = require('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-rec-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const project = path.join(dir, 'project');
    fs.mkdirSync(project);
    const out = path.join(dir, 'selection.txt');
    const src = path.join(__dirname, '..', '..');
    execFileSync(process.execPath, [path.join(__dirname, 'recommended.js'), '--src', src, '--root', project, '--stacks', 'aspnet', '--out', out], { stdio: 'pipe' });
    const lines = fs.readFileSync(out, 'utf8').split('\n');
    const recs = JSON.parse(fs.readFileSync(path.join(src, 'meta', 'recommendations.json'), 'utf8'));
    for (const rule of recs.stacks.aspnet.rules || []) assert.ok(lines.includes(`rule ${rule}`), `rule ${rule}`);
    assert.ok(fs.existsSync(`${out}.raw.json`) && fs.existsSync(`${out}.found.json`));
});
