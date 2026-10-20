'use strict';
// THE PROFILE FIXTURE BUILDS A PROJECT PER STACK - markers for every seed, the selection setup would accept, and the
// two external commands in the order that installs THIS tree. The real install is the temp-project matrix's run.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MARKERS, selectionFor, fixture, clean, main } = require('./profile-fixture.js');

const recs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'recommendations.json'), 'utf8'));
const roots = [];
test.after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });
const workdir = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-'))); roots.push(d); return d; };
// The export a dry run reads: this tree itself, linked (a junction on Windows needs no privilege). A dry run reads
// stack-select from it and never runs its installer.
function fakeExport(dir)
{
    const src = path.join(dir, 'export');
    fs.symlinkSync(path.join(__dirname, '..'), src, 'junction');
    return src;
}

test('every stacks seed has markers, and nothing has markers without a seed', () =>
{
    assert.deepEqual(Object.keys(MARKERS).filter((p) => p !== 'bare').sort(), Object.keys(recs.stacks).sort());
});

test('the selection is the always seed plus the profile own, each name once', () =>
{
    const ts = selectionFor(recs, 'typescript');
    for (const s of recs.stacks.typescript.skills) assert.ok(ts.skills.includes(s));
    for (const s of recs.always.skills) assert.ok(ts.skills.includes(s));
    assert.equal(new Set(ts.skills).size, ts.skills.length);
    assert.deepEqual(selectionFor(recs, 'bare').skills, recs.always.skills, 'bare is the always seed alone');
});

test('a dry run writes the markers and the selection and prints the marketplace add before the install', () =>
{
    const dir = workdir();
    const lines = [];
    const f = fixture('aspnet', dir, { exportDir: fakeExport(dir), dryRun: true, out: (l) => lines.push(l) });
    assert.ok(fs.existsSync(path.join(f.project, 'src', 'Api', 'Api.csproj')));
    assert.ok(fs.existsSync(path.join(f.project, '.git')), 'the fixture is a git repo, as setup expects');
    assert.match(fs.readFileSync(f.selection, 'utf8'), /^skill /m, 'stack-select emitted the selection');
    const add = lines.findIndex((l) => /plugin marketplace add/.test(l));
    const install = lines.findIndex((l) => /alfred-code\.js install --source/.test(l));
    assert.ok(add >= 0 && install > add, 'the export is registered before the installer runs');
    assert.ok(lines.every((l) => !/would run/.test(l) || l.includes(`CLAUDE_CONFIG_DIR=${f.account}`)), 'every external command runs on the isolated account');
    assert.equal(path.dirname(f.home), dir, 'one HOME is shared across the profiles');
});

test('a fixture is installed fresh: an existing project is refused, an unknown profile named', () =>
{
    const dir = workdir();
    const src = fakeExport(dir);
    fixture('bare', dir, { exportDir: src, dryRun: true, out: () => {} });
    assert.throws(() => fixture('bare', dir, { exportDir: src, dryRun: true, out: () => {} }), /exists - a fixture is installed fresh/);
    assert.throws(() => fixture('cobol', dir, { exportDir: src, dryRun: true }), /unknown profile 'cobol'/);
});

test('--scope reaches the installer, and only the three scopes the installer takes', () =>
{
    const dir = workdir();
    const src = fakeExport(dir);
    const lines = [];
    fixture('bare', dir, { exportDir: src, scope: 'local', dryRun: true, out: (l) => lines.push(l) });
    assert.ok(lines.some((l) => /install --source .* --scope local/.test(l)));
    assert.throws(() => fixture('typescript', dir, { exportDir: src, scope: 'global', dryRun: true }), /--scope must be project, user or local/);
});

test('usage: two positionals or exit 2', () =>
{
    const err = console.error;
    console.error = () => {};
    try
    {
        assert.equal(main(['typescript']), 2);
        assert.equal(main(['--clean']), 2, '--clean takes exactly one workdir');
    }
    finally { console.error = err; }
});

test('--clean deletes the fixtures, the export and the home - a linked export as the link - and keeps anything else, named', () =>
{
    const dir = workdir();
    const src = fakeExport(dir);
    for (const p of ['aspnet', 'bare']) fixture(p, dir, { exportDir: src, dryRun: true, out: () => {} });
    fs.writeFileSync(path.join(dir, 'report.md'), 'the results\n');
    fs.writeFileSync(path.join(dir, 'bare', 'mine.txt'), 'not the fixture\n');
    const lines = [];
    const r = clean(dir, { out: (l) => lines.push(l) });
    assert.deepEqual(r.removed.sort(), ['aspnet', 'bare', 'export', 'home']);
    assert.deepEqual(r.left.sort(), ['bare', 'report.md']);
    assert.deepEqual(lines, [`removed: ${r.removed.join(', ')}`, `left: ${r.left.join(', ')}`]);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'bare')), ['mine.txt'], "a file of anyone else's stays in its folder");
    assert.ok(fs.existsSync(path.join(__dirname, 'profile-fixture.js')), 'the linked export went as the link; the tree it named is untouched');
    assert.deepEqual(clean(dir, { out: () => {} }), { removed: [], left: r.left }, 'a re-run removes nothing more');
});

test('--clean: an emptied workdir goes too; a missing one is nothing; a home with no fixture beside it is no fixture home', () =>
{
    const dir = workdir();
    fixture('bare', dir, { exportDir: fakeExport(dir), dryRun: true, out: () => {} });
    clean(dir, { out: () => {} });
    assert.ok(!fs.existsSync(dir), 'nothing left, so the workdir is removed');
    assert.deepEqual(clean(path.join(dir, 'gone'), { out: () => {} }), { removed: [], left: [] });
    const other = workdir();
    fs.mkdirSync(path.join(other, 'home'));
    assert.deepEqual(clean(other, { out: () => {} }), { removed: [], left: ['home'] });
});

test('--clean refuses the home dir, a filesystem root and a git checkout', () =>
{
    assert.throws(() => clean(os.homedir(), { out: () => {} }), /refuses/);
    assert.throws(() => clean(path.parse(process.cwd()).root, { out: () => {} }), /refuses/);
    const repo = workdir();
    fs.mkdirSync(path.join(repo, '.git'));
    assert.throws(() => clean(repo, { out: () => {} }), /a git checkout is no fixture workdir/);
    assert.ok(fs.existsSync(path.join(repo, '.git')));
});
