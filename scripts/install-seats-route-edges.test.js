'use strict';
// Edges of the agents route switch the whole-branch review found: a flag against a shared key still lets a shell export
// stand, the plan's seats-switch reason, a missing seat source, a relative --root, and an own seat equal to the render.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('./install/plugins.js');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const os = require('node:os');
const { readLedger } = require('./install/stamp.js');
const { cleanExport } = require('./clean-export.js');

const KEY = 'ALFRED_CODE_SKILLS_VIA_PLUGIN';
const SCOPE = ['--scope', 'project'];
const ROOT = path.join(__dirname, '..');
const SEAT = 'evidence-gatherer';
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('routes: --seats-route against a settings.json key still lets a shell export the local file does not hold stand', () =>
{
    const logs = [];
    const out = P.committedRoutes({ env: { [KEY]: 'false' }, shared: { [KEY]: 'true' }, personal: {}, scope: 'project', flag: 'copy', log: (m) => logs.push(m) });
    assert.deepStrictEqual({ skills: out.skills, skillsFrom: out.skillsFrom }, { skills: false, skillsFrom: 'env' });
    assert.deepStrictEqual(logs, [`!! seats route: settings.json sets ${KEY}=true for everyone - change it there`]);
});

test('install: --seats-route copy against a settings.json key and a shell false takes the copy route and writes no key', POSIX_ONLY, () =>
{
    const { out, result } = seedRun('install', 'skill csharp\n', {
        env: { [KEY]: 'false' }, args: [...SCOPE, '--seats-route', 'copy'],
        prepare: (repo) => { fs.mkdirSync(path.join(repo, '.claude'), { recursive: true }); fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ env: { [KEY]: 'true' } })); },
        inspect: (repo) =>
        {
            const local = path.join(repo, '.claude', 'settings.local.json');
            return { key: fs.existsSync(local) ? (readJson(local).env || {})[KEY] : undefined, ledgered: Object.keys((readLedger(path.join(repo, '.claude', 'alfred-code.stamp')).env || {})['settings.local.json'] || {}).includes(KEY) };
        },
    });
    assert.ok(out.includes(`!! seats route: settings.json sets ${KEY}=true for everyone - change it there`), out);
    assert.match(out, /seats: copy route/);
    assert.deepStrictEqual(result, { key: undefined, ledgered: false });
});

test('copy route: a picked seat whose stack source is missing prints no overwrite line and keeps the edited copy', POSIX_ONLY, () =>
{
    const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-source-'));
    try
    {
        cleanExport(ROOT, exportDir);
        fs.rmSync(path.join(exportDir, 'stack', 'agents', `${SEAT}.md`));
        const seat = (repo) => path.join(repo, '.claude', 'agents', `${SEAT}.md`);
        const { outs, result } = seedRun(['install', 'update'], `skill csharp\nagent ${SEAT}\n`, {
            env: { [KEY]: 'false' }, source: [ROOT, exportDir], args: [SCOPE, SCOPE],
            each: (repo, i) => { if (i === 0) fs.appendFileSync(seat(repo), '\nhand-edited line\n'); },
            inspect: (repo) => fs.readFileSync(seat(repo), 'utf8'),
        });
        assert.match(result, /hand-edited line/, 'the copy is not touched');
        assert.doesNotMatch(outs[1], /overwriting a hand-edited copy: agent evidence-gatherer/);
    }
    finally { fs.rmSync(exportDir, { recursive: true, force: true }); }
});

// A seat file with no record whose text is the stack's own render is the stack's, not the project's: no 'kept' line.
const OWN_LINE = /!! agent kept: evidence-gatherer\.md - a project seat of that name/;
const LISTING = JSON.stringify(['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory']
    .map((name) => ({ id: `${name}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));
const plantStackSeat = (repo) =>
{
    fs.mkdirSync(path.join(repo, '.claude', 'agents'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'stack', 'agents', `${SEAT}.md`), path.join(repo, '.claude', 'agents', `${SEAT}.md`));
};

test('plugin route: an unrecorded seat file that equals the stack\'s text is pruned as the stack\'s, not kept as the project\'s', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update'], 'skill csharp\n', {
        env: {}, plugins: LISTING, args: [SCOPE, SCOPE],
        each: (repo, i) => { if (i === 0) plantStackSeat(repo); },
        inspect: (repo) => fs.existsSync(path.join(repo, '.claude', 'agents', `${SEAT}.md`)),
    });
    assert.doesNotMatch(outs[1], OWN_LINE);
    assert.equal(result, false, 'pruned: the core carries it');
});

test('copy route: an unrecorded seat file that equals the stack\'s text is refreshed and recorded, not kept', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update'], 'skill csharp\n', {
        env: { [KEY]: 'false' }, args: [SCOPE, SCOPE],
        each: (repo, i) => { if (i === 0) { plantStackSeat(repo); fs.writeFileSync(path.join(repo, '..', 'sel.txt'), `skill csharp\nagent ${SEAT}\n`); } },
        inspect: (repo) => (readLedger(path.join(repo, '.claude', 'alfred-code.stamp')).files || {})[`agents/${SEAT}.md`] || null,
    });
    assert.doesNotMatch(outs[1], OWN_LINE);
    assert.ok(result, 'the seat is recorded in managed-files');
});
