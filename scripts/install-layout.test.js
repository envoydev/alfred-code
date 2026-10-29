'use strict';
// THE 2.8.0 LAYOUT MOVE (docs.migrateLayout, stack/hooks/layout.js LAYOUT_MOVES): an older project's hook state and ledgers
// leave the docs root for the data root's state/ and statistics/, its working papers gather under work/ and the quality
// loops' output under quality/. Each case builds the 2.7.0 layout in a temp git repo and reads the tree back: tracked
// docs move as git renames, a clash keeps the old file, any failure puts every file back, a second run changes nothing.

const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const docs = require('./install/docs.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-layout-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let seq = 0;
const git = (root, ...args) => execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', ...args], { cwd: root, encoding: 'utf8' });
function repo()
{
    const root = path.join(TMP, `p-${seq++}`);
    fs.mkdirSync(root, { recursive: true });
    git(root, 'init', '-q');
    return root;
}
const put = (root, rel, text = `${rel}\n`) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const has = (root, rel) => fs.existsSync(path.join(root, ...rel.split('/')));
const text = (root, rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
// Every file and folder under the project but .git, as `<rel>` / `<rel>/` with each file's bytes.
function tree(root)
{
    const out = {};
    const walk = (dir) =>
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            if (e.name === '.git') continue;
            const p = path.join(dir, e.name);
            const rel = path.relative(root, p).split(path.sep).join('/');
            if (e.isDirectory()) { out[`${rel}/`] = ''; walk(p); }
            else out[rel] = fs.readFileSync(p, 'utf8');
        }
    };
    walk(root);
    return out;
}
const migrate = (root, opts = {}) =>
{
    const logs = [];
    const r = docs.migrateLayout({ projectRoot: root, docsPath: '.alfred/docs', dataPath: '.alfred', log: (m) => logs.push(m), ...opts });
    return { ...r, logs };
};

// The 2.7.0 layout: one file in each of the fourteen old homes (an empty .branches/ the fourteenth).
const OLD = {
    'flow/APPROVAL': 'state/approvals/APPROVAL', 'flow/SECRET-READ-ALLOW': 'state/approvals/SECRET-READ-ALLOW',
    'flow/turn-check-x': 'state/sessions/turn-check-x', 'flow/compact-points.json': 'state/sessions/compact-points.json',
    'history/s1.json': 'state/history/s1.json', 'hook-blocks/s1.jsonl': 'statistics/hook-blocks/s1.jsonl',
    'tools-usage/s1.jsonl': 'statistics/tools-usage/s1.jsonl', 'usage-report/r1/REPORT.md': 'statistics/usage-report/r1/REPORT.md',
    'docs-log.jsonl': 'statistics/docs-log.jsonl',
    'plans/a.md': 'docs/work/plans/a.md', 'specs/s.md': 'docs/work/specs/s.md', 'diagnoses/d.md': 'docs/work/diagnoses/d.md',
    'cross-project-tasks/other.md': 'docs/work/cross-project-tasks/other.md', 'related-context/paper.md': 'docs/work/cross-project-tasks/paper.md',
    'test-coverage/COVERAGE.md': 'docs/quality/COVERAGE-QUALITY.md', 'test-coverage/raw/dotnet/x.xml': 'docs/quality/coverage-raw/dotnet/x.xml', 'loops/run.md': 'docs/quality/loops/run.md',
};
function oldLayout(root)
{
    for (const rel of Object.keys(OLD)) put(root, `.alfred/docs/${rel}`);
    put(root, '.alfred/docs/architecture/ARCHITECTURE.md', '# arch\n');
    fs.mkdirSync(path.join(root, '.alfred', 'docs', '.branches'));
}

test('moves every old folder to its new home, byte for byte, and the old folders are gone', () =>
{
    const root = repo();
    oldLayout(root);
    const r = migrate(root);
    for (const [from, to] of Object.entries(OLD))
    {
        assert.ok(has(root, `.alfred/${to}`), `${from} -> .alfred/${to}\n${r.logs.join('\n')}`);
        assert.strictEqual(text(root, `.alfred/${to}`), `.alfred/docs/${from}\n`, `${to} holds the old bytes`);
    }
    for (const dir of ['flow', 'history', 'hook-blocks', 'tools-usage', 'usage-report', 'docs-log.jsonl', 'plans', 'specs', 'diagnoses',
        'cross-project-tasks', 'related-context', 'test-coverage', 'loops', '.branches'])
        assert.ok(!has(root, `.alfred/docs/${dir}`), `${dir} left the docs root`);
    assert.strictEqual(text(root, '.alfred/docs/architecture/ARCHITECTURE.md'), '# arch\n', 'a domain is not touched');
    assert.ok(r.logs.some((m) => /layout: \.alfred\/docs\/plans -> \.alfred\/docs\/work\/plans \(1 file\)/.test(m)), r.logs.join('\n'));
    assert.ok(r.logs.some((m) => /layout: removed empty \.branches\//.test(m)), r.logs.join('\n'));
    assert.strictEqual(r.kept.length, 0);
    assert.ok(r.moved.length >= 13 && r.removed.includes('.alfred/docs/.branches'), JSON.stringify(r));
});

test('splits flow/ by kind - a receipt the user\'s yes wrote is an approval, the rest session scratch', () =>
{
    const root = repo();
    for (const name of ['APPROVAL', 'COMMIT-GATE', 'PUSH-GATE', 'SECRET-READ-ALLOW', 'turn-check-x', 'compact-points.json', 'untracked-at-start-abc', 'COMPACT-STATE'])
        put(root, `.alfred/docs/flow/${name}`);
    const r = migrate(root);
    assert.deepStrictEqual(fs.readdirSync(path.join(root, '.alfred', 'state', 'approvals')).sort(), ['APPROVAL', 'COMMIT-GATE', 'PUSH-GATE', 'SECRET-READ-ALLOW']);
    assert.deepStrictEqual(fs.readdirSync(path.join(root, '.alfred', 'state', 'sessions')).sort(), ['COMPACT-STATE', 'compact-points.json', 'turn-check-x', 'untracked-at-start-abc']);
    assert.ok(r.logs.some((m) => /layout: \.alfred\/docs\/flow -> \.alfred\/state\/approvals \(4 files\)/.test(m)), r.logs.join('\n'));
    assert.ok(r.logs.some((m) => /layout: \.alfred\/docs\/flow -> \.alfred\/state\/sessions \(4 files\)/.test(m)), r.logs.join('\n'));
    assert.ok(!has(root, '.alfred/docs/flow'));
});

test('tracked docs move as git renames', () =>
{
    const root = repo();
    put(root, '.alfred/docs/plans/a.md', '# a\n');
    put(root, '.alfred/docs/specs/s.md', '# s\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'docs');
    migrate(root);
    const status = git(root, 'status', '--porcelain').trim().split('\n').sort();
    assert.deepStrictEqual(status, ['R  .alfred/docs/plans/a.md -> .alfred/docs/work/plans/a.md', 'R  .alfred/docs/specs/s.md -> .alfred/docs/work/specs/s.md']);
});

test('merges related-context/ into work/cross-project-tasks/ and removes it', () =>
{
    const root = repo();
    put(root, '.alfred/docs/cross-project-tasks/api.md');
    put(root, '.alfred/docs/related-context/notes.md');
    put(root, '.alfred/docs/related-context/deep/more.md');
    migrate(root);
    for (const rel of ['api.md', 'notes.md', 'deep/more.md']) assert.ok(has(root, `.alfred/docs/work/cross-project-tasks/${rel}`), rel);
    assert.ok(!has(root, '.alfred/docs/related-context') && !has(root, '.alfred/docs/cross-project-tasks'));
});

test('a doc clash keeps the old file and names it - nothing is overwritten', () =>
{
    const root = repo();
    put(root, '.alfred/docs/plans/a.md', 'old\n');
    put(root, '.alfred/docs/plans/b.md', 'b\n');
    put(root, '.alfred/docs/work/plans/a.md', 'new\n');
    const r = migrate(root);
    assert.strictEqual(text(root, '.alfred/docs/work/plans/a.md'), 'new\n');
    assert.strictEqual(text(root, '.alfred/docs/plans/a.md'), 'old\n', 'the old one stays where it was');
    assert.strictEqual(text(root, '.alfred/docs/work/plans/b.md'), 'b\n', 'the rest of the folder still moves');
    assert.deepStrictEqual(r.kept, ['.alfred/docs/plans/a.md']);
    assert.ok(r.logs.some((m) => m.includes('layout: kept .alfred/docs/plans/a.md - .alfred/docs/work/plans/a.md already holds it')), r.logs.join('\n'));
});

test('an empty .branches/ is removed, a non-empty one kept', () =>
{
    const empty = repo();
    fs.mkdirSync(path.join(empty, '.alfred', 'docs', '.branches'), { recursive: true });
    fs.writeFileSync(path.join(empty, '.alfred', 'docs', '.branches', '.DS_Store'), '');
    const a = migrate(empty);
    assert.ok(!has(empty, '.alfred/docs/.branches'), 'OS litter alone is empty');
    assert.ok(a.logs.some((m) => /layout: removed empty \.branches\//.test(m)), a.logs.join('\n'));
    const full = repo();
    put(full, '.alfred/docs/.branches/feature/architecture/ARCHITECTURE.md');
    const b = migrate(full);
    assert.ok(has(full, '.alfred/docs/.branches/feature/architecture/ARCHITECTURE.md'), 'a doc version is never deleted');
    assert.ok(b.logs.some((m) => /layout: kept \.branches\/ - it holds doc versions, prune them first/.test(m)), b.logs.join('\n'));
    assert.deepStrictEqual(b.kept, ['.alfred/docs/.branches']);
});

test('a second run moves nothing and logs layout: current; a file an older hook wrote since moves on the next run', () =>
{
    const root = repo();
    oldLayout(root);
    migrate(root);
    const before = tree(root);
    const again = migrate(root);
    assert.deepStrictEqual(tree(root), before, 'nothing changed');
    assert.deepStrictEqual(again.logs, ['  layout: current']);
    assert.deepStrictEqual([again.moved, again.kept, again.removed], [[], [], []]);
    put(root, '.alfred/docs/flow/turn-check-late');
    const late = migrate(root);
    assert.ok(has(root, '.alfred/state/sessions/turn-check-late') && !has(root, '.alfred/docs/flow'), late.logs.join('\n'));
    const fresh = repo();
    assert.deepStrictEqual(migrate(fresh).logs, ['  layout: current'], 'a project with no docs root at all');
});

// Final review C2: an older hook still running beside a 2.8.0 one writes the old home while the new one writes the new,
// so both hold a ledger or a scratch file. Kept at the old path, that pair clashed on every run and the old folder never
// left; a ledger's rows are appended to the new file, any other state file keeps the new home's copy, a doc still clashes.
test('a ledger or scratch file at both homes merges into the new one; a second run is current', () =>
{
    const root = repo();
    put(root, '.alfred/docs/docs-log.jsonl', '{"old":1}\n');
    put(root, '.alfred/statistics/docs-log.jsonl', '{"new":1}\n');
    put(root, '.alfred/docs/hook-blocks/s1.jsonl', '{"old":2}\n');
    put(root, '.alfred/statistics/hook-blocks/s1.jsonl', '{"new":2}\n');
    put(root, '.alfred/docs/flow/compact-points.json', '{"old":3}\n');
    put(root, '.alfred/state/sessions/compact-points.json', '{"new":3}');
    put(root, '.alfred/docs/flow/APPROVAL', 'APPROVED - newer, by an older hook\n');
    put(root, '.alfred/state/approvals/APPROVAL', 'Completed: older\n');
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(root, '.alfred/state/approvals/APPROVAL'), past, past);
    const r = migrate(root);
    assert.strictEqual(text(root, '.alfred/statistics/docs-log.jsonl'), '{"new":1}\n{"old":1}\n', r.logs.join('\n'));
    assert.strictEqual(text(root, '.alfred/statistics/hook-blocks/s1.jsonl'), '{"new":2}\n{"old":2}\n');
    assert.strictEqual(text(root, '.alfred/state/sessions/compact-points.json'), '{"new":3}', 'the new home keeps its scratch file');
    assert.strictEqual(text(root, '.alfred/state/approvals/APPROVAL'), 'Completed: older\n', 'an old approval never replaces the new one');
    assert.ok(r.logs.includes('  layout: removed .alfred/docs/flow/APPROVAL - .alfred/state/approvals/APPROVAL is the copy the hooks read'), r.logs.join('\n'));
    for (const old of ['docs-log.jsonl', 'hook-blocks', 'flow']) assert.ok(!has(root, `.alfred/docs/${old}`), old);
    assert.deepStrictEqual(r.kept, [], r.logs.join('\n'));
    assert.ok(r.logs.some((m) => m === '  layout: merged .alfred/docs/docs-log.jsonl into .alfred/statistics/docs-log.jsonl'), r.logs.join('\n'));
    assert.deepStrictEqual(migrate(root).logs, ['  layout: current']);
});

test('a failure after a merge puts both copies of the ledger back as they were', () =>
{
    const root = repo();
    put(root, '.alfred/docs/docs-log.jsonl', '{"old":1}\n');
    put(root, '.alfred/statistics/docs-log.jsonl', '{"new":1}');
    put(root, '.alfred/docs/plans/a.md');
    const before = tree(root);
    const real = fs.renameSync;
    fs.renameSync = () => { throw new Error('EBUSY: the plan'); };
    try { assert.throws(() => migrate(root), /EBUSY: the plan/); }
    finally { fs.renameSync = real; }
    assert.deepStrictEqual(tree(root), before);
});

test('a failure on the third file puts the first two back and rethrows', () =>
{
    const root = repo();
    for (const rel of ['plans/a.md', 'plans/b.md', 'specs/c.md', 'flow/APPROVAL']) put(root, `.alfred/docs/${rel}`);
    const before = tree(root);
    const real = fs.renameSync;
    let calls = 0;
    fs.renameSync = (...args) => { calls += 1; if (calls === 3) throw new Error('EBUSY: the third file'); return real(...args); };
    try { assert.throws(() => migrate(root), /EBUSY: the third file/); }
    finally { fs.renameSync = real; }
    assert.deepStrictEqual(tree(root), before, 'the tree equals the starting tree, no new folder left behind');
});

test('a docs root outside the data root - the state follows the data root', () =>
{
    const root = repo();
    put(root, 'docs/flow/APPROVAL');
    put(root, 'docs/hook-blocks/s.jsonl');
    put(root, 'docs/plans/a.md');
    const r = migrate(root, { docsPath: 'docs', dataPath: '.alfred' });
    assert.ok(has(root, '.alfred/state/approvals/APPROVAL'), r.logs.join('\n'));
    assert.ok(has(root, '.alfred/statistics/hook-blocks/s.jsonl'));
    assert.ok(has(root, 'docs/work/plans/a.md'));
    assert.ok(!has(root, 'docs/flow') && !has(root, 'docs/hook-blocks'));
});

test('tutorial/ moves to explanations/ (item 6); a file where a folder move expects a folder is left and named', () =>
{
    const root = repo();
    put(root, '.alfred/docs/tutorial/x.html', '<svg/>\n');
    const r = migrate(root);
    assert.strictEqual(text(root, '.alfred/docs/explanations/x.html'), '<svg/>\n');
    assert.ok(!fs.existsSync(path.join(root, '.alfred', 'docs', 'tutorial')), 'the emptied folder goes');
    assert.ok(r.logs.some((m) => m.includes('layout: .alfred/docs/tutorial -> .alfred/docs/explanations (1 file)')), r.logs.join('\n'));
    const file = repo();
    put(file, '.alfred/docs/tutorial', 'a file, not a folder\n');
    const f = migrate(file);
    assert.strictEqual(text(file, '.alfred/docs/tutorial'), 'a file, not a folder\n', 'left as it is');
    assert.deepStrictEqual(f.kept, ['.alfred/docs/tutorial']);
    assert.ok(f.logs.some((m) => m.includes('layout: kept .alfred/docs/tutorial - a file where a folder moving to .alfred/docs/explanations belongs')), f.logs.join('\n'));
    assert.ok(!f.logs.some((m) => m.includes('layout: current')), 'a kept file is no current layout');
});

// 2026-10-29: the coverage doc moves up into quality/ under a new name - a row's `rename` maps the first segment of each
// file under its folder (COVERAGE.md -> COVERAGE-QUALITY.md, raw/ -> coverage-raw/), and a file it does not map stays.
const RENAME = { 'COVERAGE.md': 'COVERAGE-QUALITY.md', raw: 'coverage-raw' };
const QMOVES = [{ from: 'quality/test-coverage', base: 'docs', to: 'quality', rename: RENAME }, { from: 'test-coverage', base: 'docs', to: 'quality', rename: RENAME }];

test('a rename row moves only the mapped entries', () =>
{
    const root = repo();
    put(root, '.alfred/docs/quality/test-coverage/COVERAGE.md', 'doc\n');
    put(root, '.alfred/docs/quality/test-coverage/raw/dotnet/cobertura.xml', '<x/>\n');
    put(root, '.alfred/docs/quality/test-coverage/NOTES.md', 'mine\n');
    const r = migrate(root, { moves: QMOVES });
    assert.strictEqual(text(root, '.alfred/docs/quality/COVERAGE-QUALITY.md'), 'doc\n');
    assert.strictEqual(text(root, '.alfred/docs/quality/coverage-raw/dotnet/cobertura.xml'), '<x/>\n');
    assert.strictEqual(text(root, '.alfred/docs/quality/test-coverage/NOTES.md'), 'mine\n', 'the unmapped file stays');
    assert.ok(!has(root, '.alfred/docs/quality/test-coverage/raw'), 'the emptied raw/ goes');
    assert.ok(r.logs.includes('  layout: kept .alfred/docs/quality/test-coverage/NOTES.md - no new home for it'), r.logs.join('\n'));
    assert.ok(r.kept.includes('.alfred/docs/quality/test-coverage/NOTES.md'));
});

test('a rename row: a tracked file moves with git mv', () =>
{
    const root = repo();
    put(root, '.alfred/docs/quality/test-coverage/COVERAGE.md', 'doc\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'doc');
    migrate(root, { moves: QMOVES });
    assert.match(git(root, 'status', '--porcelain'), /^R {2}\.alfred\/docs\/quality\/test-coverage\/COVERAGE\.md -> \.alfred\/docs\/quality\/COVERAGE-QUALITY\.md$/m);
});

test('a rename row: both homes present - the 2.8 doc moves, the pre-2.8 one is kept and named, nothing overwritten', () =>
{
    const root = repo();
    put(root, '.alfred/docs/quality/test-coverage/COVERAGE.md', 'the 2.8 doc\n');
    put(root, '.alfred/docs/test-coverage/COVERAGE.md', 'the pre-2.8 doc\n');
    const r = migrate(root, { moves: QMOVES });
    assert.strictEqual(text(root, '.alfred/docs/quality/COVERAGE-QUALITY.md'), 'the 2.8 doc\n', 'the first row wins');
    assert.strictEqual(text(root, '.alfred/docs/test-coverage/COVERAGE.md'), 'the pre-2.8 doc\n', 'kept where it is');
    assert.ok(r.logs.includes('  layout: kept .alfred/docs/test-coverage/COVERAGE.md - .alfred/docs/quality/COVERAGE-QUALITY.md already holds it'), r.logs.join('\n'));
});

test('a rename row: a second run is current', () =>
{
    const root = repo();
    put(root, '.alfred/docs/test-coverage/COVERAGE.md', 'doc\n');
    put(root, '.alfred/docs/test-coverage/raw/a.xml', '<a/>\n');
    migrate(root, { moves: QMOVES });
    assert.strictEqual(text(root, '.alfred/docs/quality/coverage-raw/a.xml'), '<a/>\n');
    assert.ok(!has(root, '.alfred/docs/test-coverage'), 'the emptied pre-2.8 folder goes');
    const before = tree(root);
    const again = migrate(root, { moves: QMOVES });
    assert.deepStrictEqual(again.logs, ['  layout: current']);
    assert.deepStrictEqual(tree(root), before);
});

test('a rename row: a failing move puts every file back', () =>
{
    const root = repo();
    put(root, '.alfred/docs/quality/test-coverage/COVERAGE.md', 'doc\n');
    put(root, '.alfred/docs/quality/test-coverage/raw/a.xml', '<a/>\n');
    const before = tree(root);
    const real = fs.renameSync;
    let calls = 0;
    fs.renameSync = (...args) => { calls += 1; if (calls === 2) throw new Error('EACCES: the second file'); return real(...args); };
    try { assert.throws(() => migrate(root, { moves: QMOVES }), /EACCES: the second file/); }
    finally { fs.renameSync = real; }
    assert.deepStrictEqual(tree(root), before);
});
