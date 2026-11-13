'use strict';
// THE ONE-TIME MOVE INTO `.alfred` (scripts/install/fixed-root.js) - the data root is always `.alfred`, so an update
// moves what an earlier release left in another folder: entry by entry, only the entries the stack owns by name, the
// secrets store never in a folder whose .gitignore does not cover it, a clash stopping before the first write.
// One test per row of the move's two tables - what happens to one entry, and what stops a whole run - then the
// boundaries, the order and the review's three cases. Every case builds its own temp repository.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const dr = require('../stack/mcp/data-root.js');
const stampLayer = require('./install/stamp.js');
const fixed = require('./install/fixed-root.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fixed-root-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const STORE = dr.SECRETS_FILE;
const STACK_IGNORE = `${dr.DATA_IGNORE_HEAD}\n/*\n!/.gitignore\n!/docs/\n`;
let n = 0;
const git = (p, ...a) => execFileSync('git', ['-c', 'user.email=m@example.com', '-c', 'user.name=m', '-c', 'commit.gpgsign=false', ...a],
    { cwd: p, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const at = (p, rel) => path.join(p, ...rel.split('/'));
const put = (p, rel, text = 'x\n') => { fs.mkdirSync(path.dirname(at(p, rel)), { recursive: true }); fs.writeFileSync(at(p, rel), text); };
const read = (p, rel) => { try { return fs.readFileSync(at(p, rel), 'utf8'); } catch { return null; } };
const has = (p, rel) => fs.existsSync(at(p, rel));
const status = (p) => git(p, 'status', '--porcelain', '--untracked-files=all');

// A temp project: a repository (unless `repo: false`), the old key in one settings file, a stamp, files, and the
// paths git tracks.
function project({ key = 'var/data', keyFile = 'settings.json', stamp = '', files = {}, tracked = [], repo = true } = {})
{
    const p = path.join(TMP, `p${n += 1}`);
    fs.mkdirSync(p, { recursive: true });
    if (repo) { git(p, 'init', '-q', '-b', 'main'); put(p, 'seed.txt'); git(p, 'add', 'seed.txt'); git(p, 'commit', '-qm', 'seed'); }
    if (key) put(p, `.claude/${keyFile}`, JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: key } }));
    if (stamp) put(p, '.claude/alfred-code.stamp', stamp);
    for (const [rel, text] of Object.entries(files)) put(p, rel, text);
    if (tracked.length) { git(p, 'add', '-f', '--', ...tracked); git(p, 'commit', '-qm', 'tracked'); }
    return p;
}
// What an earlier release left in R: the docs, the variables, the workspace record, hook state, the store and the
// stack's own .gitignore.
const OLD = (root = 'var/data', extra = {}) => ({
    [`${root}/docs/a.md`]: 'doc\n', [`${root}/.variables`]: 'K=v\n', [`${root}/workspace.json`]: '{"role":"standalone"}\n',
    [`${root}/state/s.json`]: '{"old":1}\n', [`${root}/${STORE}`]: 'NAME=value\n', [`${root}/.gitignore`]: STACK_IGNORE, ...extra,
});
const infoOf = (p) => ({ ...dr.dataRootOf({ projectDir: p }), recorded: stampLayer.readDataLines(at(p, '.claude/alfred-code.stamp')) });
function run(p, scope = 'project', rt)
{
    const lines = [];
    const r = fixed.moveToFixedRoot({ projectRoot: p, info: infoOf(p), scope, rt, log: (l) => lines.push(l) });
    return { ok: r.ok, out: lines.join('\n') };
}
// Every file under the project but git's own folder, as { rel: text }.
function snapshot(p)
{
    const out = {};
    const walk = (dir, rel) =>
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            if (!rel && e.name === '.git') continue;
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isSymbolicLink()) { out[r] = `link -> ${fs.readlinkSync(path.join(dir, e.name))}`; continue; }
            if (e.isDirectory()) { out[`${r}/`] = 'dir'; walk(path.join(dir, e.name), r); }
            else out[r] = fs.readFileSync(path.join(dir, e.name), 'utf8');
        }
    };
    walk(p, '');
    return out;
}
const ignored = (p, rel) => spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: p }).status === 0;
function unchanged(p, before, r, line)
{
    assert.strictEqual(r.ok, false);
    assert.match(r.out, line);
    assert.deepStrictEqual(snapshot(p), before, 'nothing changed');
}

// ------------------------------------------------------------------ the entry table

test('fixed root move: a free entry moves, tracked by git mv and untracked by rename', () =>
{
    const p = project({ files: OLD(), tracked: ['var/data/docs/a.md', 'var/data/.gitignore'] });
    const r = run(p);
    assert.strictEqual(r.ok, true, r.out);
    assert.match(r.out, /data root: moved var\/data to \.alfred$/m);
    const st = status(p);
    assert.match(st, /^R {2}var\/data\/docs\/a\.md -> \.alfred\/docs\/a\.md$/m, 'a tracked file shows as a rename');
    assert.ok(!st.includes(STORE), 'git status never lists the store');
    assert.strictEqual(read(p, '.alfred/.variables'), 'K=v\n');
    assert.strictEqual(read(p, '.alfred/workspace.json'), '{"role":"standalone"}\n');
    assert.strictEqual(read(p, '.alfred/state/s.json'), '{"old":1}\n');
    assert.strictEqual(read(p, `.alfred/${STORE}`), 'NAME=value\n');
    assert.strictEqual(read(p, '.alfred/.gitignore'), STACK_IGNORE);
    assert.ok(ignored(p, `.alfred/${STORE}`), 'the store is ignored where it landed');
    assert.ok(!has(p, 'var/data'), 'the emptied folder is removed');
});

test('fixed root move: an empty target folder is cleared first, never nested', () =>
{
    for (const tracked of [['var/data/docs/a.md'], []])
    {
        const p = project({ files: OLD(), tracked });
        fs.mkdirSync(at(p, '.alfred/docs'), { recursive: true });
        const r = run(p);
        assert.strictEqual(r.ok, true, r.out);
        assert.strictEqual(read(p, '.alfred/docs/a.md'), 'doc\n');
        assert.ok(!has(p, '.alfred/docs/docs'), 'the folder is not nested in itself');
        assert.ok(!has(p, '.alfred/data'), 'the root is not nested');
    }
});

test('fixed root move: state/ and statistics/ merge file by file', () =>
{
    const p = project({ files: OLD('var/data', {
        'var/data/state/free.json': 'free\n', 'var/data/statistics/l.jsonl': 'r1\nr2\n', 'var/data/statistics/deep/m.jsonl': 'm1\n',
        '.alfred/state/s.json': '{"new":1}\n', '.alfred/statistics/l.jsonl': 'a1', '.alfred/statistics/own.jsonl': 'o1\n',
    }) });
    const r = run(p);
    assert.strictEqual(r.ok, true, r.out);
    assert.match(r.out, /data root: moved var\/data to \.alfred, merged state\/ and statistics\/$/m);
    assert.strictEqual(read(p, '.alfred/state/s.json'), '{"new":1}\n', 'a colliding state file keeps the copy the hooks read');
    assert.strictEqual(read(p, '.alfred/state/free.json'), 'free\n', 'a free file moves');
    assert.strictEqual(read(p, '.alfred/statistics/l.jsonl'), 'a1\nr1\nr2\n', 'a colliding ledger holds both sets of rows, in order');
    assert.strictEqual(read(p, '.alfred/statistics/deep/m.jsonl'), 'm1\n');
    assert.strictEqual(read(p, '.alfred/statistics/own.jsonl'), 'o1\n');
    assert.ok(!has(p, 'var/data'), 'the source is gone');
});

test('fixed root move: the stack\'s .gitignore replaces .alfred\'s, last', () =>
{
    const p = project({ files: OLD('var/data', { '.alfred/.gitignore': `${dr.DATA_IGNORE_HEAD}\n*\n!/.gitignore\n` }) });
    const r = run(p);
    assert.strictEqual(r.ok, true, r.out);
    assert.strictEqual(read(p, '.alfred/.gitignore'), STACK_IGNORE, 'the text that covered the store in R');
    assert.ok(ignored(p, `.alfred/${STORE}`));
});

test('fixed root move: a project\'s own .alfred/.gitignore that differs is a clash', () =>
{
    const p = project({ files: OLD('var/data', { '.alfred/.gitignore': '# ours\n*\n' }) });
    const before = snapshot(p);
    unchanged(p, before, run(p), /!! data root: var\/data and \.alfred both hold \.gitignore - merge them into \.alfred by hand, then run \/alfred-code:update/);
});

test('fixed root move: any other entry at .alfred is a clash', () =>
{
    const p = project({ files: OLD('var/data', { '.alfred/docs/b.md': 'other\n', '.alfred/.variables': 'K=other\n' }) });
    const before = snapshot(p);
    unchanged(p, before, run(p), /!! data root: var\/data and \.alfred both hold docs, \.variables - merge them/);
});

// ------------------------------------------------------------------ the whole-run table

test('fixed root move: no source: nothing moves, an empty named folder is removed, any other is untouched', () =>
{
    const empty = project({});
    fs.mkdirSync(at(empty, 'var/data'), { recursive: true });
    const r = run(empty);
    assert.strictEqual(r.ok, true);
    assert.match(r.out, /data root: removed the empty var\/data/);
    assert.ok(!has(empty, 'var/data'));
    const own = project({ files: { 'var/data/notes.md': 'mine\n' } });
    const before = snapshot(own);
    const kept = run(own);
    assert.deepStrictEqual([kept.ok, kept.out], [true, '']);
    assert.deepStrictEqual(snapshot(own), before);
    const none = project({ key: '.alfred', files: { '.alfred/docs/a.md': 'doc\n' } });
    const same = snapshot(none);
    assert.deepStrictEqual([run(none).ok, run(none).out], [true, '']);
    assert.deepStrictEqual(snapshot(none), same);
    const absent = project({});
    assert.deepStrictEqual([run(absent).ok, run(absent).out, has(absent, '.alfred')], [true, '', false], 'no source makes no .alfred');
});

test('fixed root move: every entry moves: one line per source, R removed', () =>
{
    const plain = project({ files: OLD() });
    assert.match(run(plain).out, /^ *data root: moved var\/data to \.alfred$/m);
    const kept = project({ files: OLD('var/data', { 'var/data/notes.md': 'mine\n', 'var/data/serena/project.yml': 'p\n' }) });
    const r = run(kept);
    assert.strictEqual(r.ok, true, r.out);
    assert.match(r.out, /data root: moved var\/data to \.alfred, var\/data keeps notes\.md, serena - not the stack's, still under its \.gitignore$/m);
    assert.strictEqual(read(kept, 'var/data/notes.md'), 'mine\n', 'an entry of the project\'s own stays byte for byte');
    assert.strictEqual(read(kept, 'var/data/serena/project.yml'), 'p\n');
    assert.deepStrictEqual(fs.readdirSync(at(kept, 'var/data')).sort(), ['.gitignore', 'notes.md', 'serena'], 'the project\'s own entries and the ignore file that covers them are left');
    assert.strictEqual(read(kept, '.alfred/docs/a.md'), 'doc\n');
    const bare = project({ files: { 'var/data/docs/a.md': 'doc\n', 'var/data/notes.md': 'mine\n' } });
    assert.match(run(bare).out, /data root: moved var\/data to \.alfred, var\/data keeps notes\.md - not the stack's$/m, 'no ignore file of the stack\'s in R: the line names none');
});

// Review C1: what an older release's servers left under R (a browser profile, an index) was kept out of git by R's own
// stack .gitignore. Moving that file away would hand git the profile's cookies at the next `git add`.
test('fixed root move: what R keeps stays out of git - R\'s .gitignore stays beside it and a copy lands in .alfred', () =>
{
    const p = project({ files: OLD('var/data', { 'var/data/chrome-control/Default/Cookies': 'c\n', 'var/data/notes.md': 'mine\n' }) });
    assert.ok(ignored(p, 'var/data/chrome-control/Default/Cookies'), 'ignored before the move');
    const r = run(p);
    assert.strictEqual(r.ok, true, r.out);
    assert.ok(ignored(p, 'var/data/chrome-control/Default/Cookies'), 'the profile is still ignored after the move');
    assert.ok(ignored(p, 'var/data/notes.md'), 'and so is the project\'s own file, as it was');
    assert.doesNotMatch(status(p), /var\/data\/(chrome-control|notes)/);
    assert.strictEqual(read(p, 'var/data/.gitignore'), STACK_IGNORE, 'R keeps its ignore file byte for byte');
    assert.strictEqual(read(p, '.alfred/.gitignore'), STACK_IGNORE, '.alfred gets the same text');
    assert.ok(ignored(p, `.alfred/${STORE}`), 'the store is covered where it landed');
    const again = run(p);
    assert.deepStrictEqual([again.ok, again.out], [true, ''], 'a second run moves nothing: R holds no stack entry but the ignore file');
});

// Review I2: an install caught between the store's two names holds both in one folder. They are one source's own pair,
// never a clash with each other; a store `.alfred` already holds, or an earlier source brought, still is.
test('fixed root move: a source holding both store names moves both', () =>
{
    const OLDER = dr.LEGACY_SECRETS_FILE;
    const p = project({ files: OLD('var/data', { [`var/data/${OLDER}`]: 'OLD=value\n' }) });
    const r = run(p);
    assert.strictEqual(r.ok, true, r.out);
    assert.match(r.out, /^ *data root: moved var\/data to \.alfred$/m);
    assert.strictEqual(read(p, `.alfred/${STORE}`), 'NAME=value\n');
    assert.strictEqual(read(p, `.alfred/${OLDER}`), 'OLD=value\n');
    assert.ok(ignored(p, `.alfred/${STORE}`) && ignored(p, `.alfred/${OLDER}`), 'both are covered where they landed');
    assert.ok(!has(p, 'var/data'));
    const two = project({ key: 'var/a', stamp: 'data-root: var/b\n', files: { [`var/a/${STORE}`]: 'A=1\n', [`var/b/${OLDER}`]: 'B=2\n' } });
    unchanged(two, snapshot(two), run(two), new RegExp(`!! data root: var/b and \\.alfred both hold \\${OLDER} - merge them`));
    const open = project({ files: { [`var/data/${STORE}`]: 'A=1\n', [`var/data/${OLDER}`]: 'B=2\n', '.alfred/.gitignore': `# mine\n/${STORE}\n` } });
    unchanged(open, snapshot(open), run(open), new RegExp(`!! data root: \\.alfred/\\.gitignore does not keep \\${OLDER} out of git`));
});

test('fixed root move: two sources, K first; an entry both hold is a clash unless it merges', () =>
{
    const files = { 'var/a/docs/a.md': 'doc\n', 'var/a/state/x.json': 'ax\n', 'var/b/.variables': 'K=v\n', 'var/b/state/y.json': 'by\n', 'var/b/state/x.json': 'bx\n' };
    const p = project({ key: 'var/a', stamp: 'data-root: var/b\n', files });
    const r = run(p);
    assert.strictEqual(r.ok, true, r.out);
    assert.deepStrictEqual(r.out.split('\n').map((l) => l.trim()),
        ['data root: moved var/a to .alfred', 'data root: moved var/b to .alfred, merged state/']);
    assert.strictEqual(read(p, '.alfred/docs/a.md'), 'doc\n');
    assert.strictEqual(read(p, '.alfred/.variables'), 'K=v\n');
    assert.strictEqual(read(p, '.alfred/state/x.json'), 'ax\n', 'the first source\'s copy is the one kept');
    assert.strictEqual(read(p, '.alfred/state/y.json'), 'by\n');
    assert.ok(!has(p, 'var/a') && !has(p, 'var/b'));
    const both = project({ key: 'var/a', stamp: 'data-root: var/b\n', files: { ...files, 'var/b/docs/b.md': 'other\n' } });
    const before = snapshot(both);
    unchanged(both, before, run(both), /!! data root: var\/b and \.alfred both hold docs - merge them/);
});

test('fixed root move: local scope: a folder named in settings.json, or tracked by git, is the team\'s - exit line, nothing changed', () =>
{
    const shared = project({ files: OLD() });
    unchanged(shared, snapshot(shared), run(shared, 'local'),
        /!! data root: var\/data is the team's \(named in \.claude\/settings\.json\) - a project-scope update moves it; nothing changed/);
    const tracked = project({ keyFile: 'settings.local.json', files: OLD(), tracked: ['var/data/docs/a.md'] });
    unchanged(tracked, snapshot(tracked), run(tracked, 'local'),
        /!! data root: var\/data is the team's \(tracked by git\) - a project-scope update moves it; nothing changed/);
    const mine = project({ keyFile: 'settings.local.json', files: OLD() });
    const r = run(mine, 'local');
    assert.strictEqual(r.ok, true, r.out);
    assert.strictEqual(read(mine, '.alfred/docs/a.md'), 'doc\n', 'this machine\'s own folder moves at local scope');
});

test('fixed root move: a clash stops before the first write', () =>
{
    const p = project({ files: OLD('var/data', { '.alfred/workspace.json': '{"role":"root"}\n', '.alfred/state/s.json': '{"new":1}\n' }), tracked: ['var/data/docs/a.md'] });
    const before = snapshot(p);
    const st = status(p);
    unchanged(p, before, run(p), /!! data root: var\/data and \.alfred both hold workspace\.json - merge them/);
    assert.strictEqual(status(p), st, 'nothing staged');
});

test('fixed root move: a .alfred/.gitignore that does not ignore the store stops the run', () =>
{
    const files = OLD('var/data', { '.alfred/.gitignore': '# ours\nscratch/\n' });
    delete files['var/data/.gitignore'];
    const p = project({ files });
    const store = STORE.replace(/\./g, '\\.');
    unchanged(p, snapshot(p), run(p), new RegExp(`!! data root: \\.alfred/\\.gitignore does not keep ${store} out of git - add it there, then run /alfred-code:update`));
});

test('fixed root move: a move that fails part way stops at once and a re-run finishes', { skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0) }, () =>
{
    const p = project({ files: OLD() });
    fs.chmodSync(at(p, 'var/data/state'), 0o555);
    let r;
    try { r = run(p); }
    finally { fs.chmodSync(at(p, 'var/data/state'), 0o755); }
    assert.strictEqual(r.ok, false);
    assert.match(r.out, /!! data root: var\/data\/state not moved \((EACCES|EPERM)\) - what moved is in \.alfred, the rest is still in var\/data; fix it, then run \/alfred-code:update/);
    assert.strictEqual(read(p, '.alfred/docs/a.md'), 'doc\n', 'what moved before the failure is in .alfred');
    assert.strictEqual(read(p, `var/data/${STORE}`), 'NAME=value\n', 'the store is still in R');
    assert.ok(ignored(p, `var/data/${STORE}`), 'under R\'s own .gitignore');
    assert.ok(dr.dataRootOf({ projectDir: p }).sources.includes('var/data'), 'R is still a source');
    const again = run(p);
    assert.strictEqual(again.ok, true, again.out);
    assert.strictEqual(read(p, `.alfred/${STORE}`), 'NAME=value\n');
    assert.ok(!has(p, 'var/data'));
});

test('fixed root move: a data-pending line: the store moves when its name is free, else it is named', () =>
{
    const stamp = `sha: a\ndata-pending: sensitive old/${STORE} -> var/data/${STORE}\n`;
    const free = project({ key: '.alfred', stamp, files: { [`old/${STORE}`]: 'NAME=value\n' } });
    const r = run(free);
    assert.strictEqual(r.ok, true, r.out);
    assert.ok(r.out.includes(`data root: moved old/${STORE} -> .alfred/${STORE}`), r.out.replace(/=.*/g, '='));
    assert.strictEqual(read(free, `.alfred/${STORE}`), 'NAME=value\n');
    assert.ok(ignored(free, `.alfred/${STORE}`));
    const taken = project({ key: '.alfred', stamp, files: { [`old/${STORE}`]: 'NAME=value\n', [`.alfred/${STORE}`]: 'NAME=other\n' } });
    const t = run(taken);
    assert.strictEqual(t.ok, true, 'a pending store never stops the run');
    assert.ok(t.out.includes(`data root: old/${STORE} not moved - .alfred/${STORE} already holds a store; merge them by hand`));
    assert.strictEqual(read(taken, `old/${STORE}`), 'NAME=value\n');
    assert.strictEqual(read(taken, `.alfred/${STORE}`), 'NAME=other\n');
});

// ------------------------------------------------------------------ the boundaries

test('fixed root move: a trailing slash and a ./ in the key name the same folder', () =>
{
    const p = project({ key: './var/data/', files: OLD() });
    const r = run(p);
    assert.strictEqual(r.ok, true, r.out);
    assert.match(r.out, /data root: moved var\/data to \.alfred$/m);
    assert.strictEqual(read(p, '.alfred/docs/a.md'), 'doc\n');
});

test('fixed root move: a source inside .alfred moves its entries up', () =>
{
    const p = project({ key: '.alfred/data', files: OLD('.alfred/data') });
    const r = run(p);
    assert.strictEqual(r.ok, true, r.out);
    assert.strictEqual(read(p, '.alfred/docs/a.md'), 'doc\n');
    assert.strictEqual(read(p, `.alfred/${STORE}`), 'NAME=value\n');
    assert.ok(!has(p, '.alfred/data'));
});

test('fixed root move: .alfred an empty folder, and .alfred holding only the stack\'s .gitignore', () =>
{
    const empty = project({ files: OLD() });
    fs.mkdirSync(at(empty, '.alfred'));
    const only = project({ files: OLD('var/data', { '.alfred/.gitignore': STACK_IGNORE }) });
    for (const p of [empty, only])
    {
        const r = run(p);
        assert.strictEqual(r.ok, true, r.out);
        assert.deepStrictEqual(fs.readdirSync(at(p, '.alfred')).sort(), ['.gitignore', '.variables', 'docs', 'state', 'workspace.json', STORE].sort());
        assert.ok(!has(p, 'var/data'));
    }
});

// ------------------------------------------------------------------ the order

test('fixed root move: failed at each entry in turn, the store always sits under a .gitignore that covers it', () =>
{
    const entries = ['docs', 'state', '.variables', 'workspace.json', STORE, '.gitignore'];
    for (const failing of entries)
    {
        const p = project({ files: OLD() });
        const real = fs.renameSync;
        let r;
        fs.renameSync = (from, to) =>
        {
            if (path.basename(from) === failing && from.startsWith(at(p, 'var/data'))) throw Object.assign(new Error('locked'), { code: 'EBUSY' });
            return real(from, to);
        };
        try { r = run(p); }
        finally { fs.renameSync = real; }
        const label = failing === STORE ? 'the store' : failing;
        assert.strictEqual(r.ok, false, label);
        assert.match(r.out, /!! data root: var\/data\/\S+ not moved \(EBUSY\)/, label);
        const home = has(p, `var/data/${STORE}`) ? `var/data/${STORE}` : `.alfred/${STORE}`;
        assert.ok(has(p, home), `${label}: the store is whole on one side`);
        assert.ok(!(has(p, `var/data/${STORE}`) && has(p, `.alfred/${STORE}`)), `${label}: never on both`);
        assert.ok(ignored(p, home), `${label}: git ignores the store where it sits`);
        assert.ok(!status(p).includes(STORE), `${label}: git status never lists it`);
        const again = run(p);
        assert.strictEqual(again.ok, true, `${label}: the re-run finishes - ${again.out.replace(/=.*/g, '=')}`);
        assert.strictEqual(read(p, `.alfred/${STORE}`), 'NAME=value\n', label);
        assert.strictEqual(read(p, '.alfred/docs/a.md'), 'doc\n', label);
        assert.ok(!has(p, 'var/data'), label);
        assert.ok(ignored(p, `.alfred/${STORE}`), label);
    }
});

// ------------------------------------------------------------------ the review's cases

test('fixed root move: .alfred is a link and the key names its target: nothing moves', (t) =>
{
    const p = project({ key: 'store/real', files: OLD('store/real') });
    try { fs.symlinkSync(at(p, 'store/real'), at(p, '.alfred'), 'junction'); }
    catch (err) { t.diagnostic(`no link on this disk (${err.code})`); return; }
    const before = snapshot(p);
    const r = run(p);
    assert.deepStrictEqual([r.ok, r.out], [true, '']);
    assert.deepStrictEqual(snapshot(p), before, 'the link and its target are byte-identical');
    assert.ok(fs.lstatSync(at(p, '.alfred')).isSymbolicLink());
});

test('fixed root move: a merge interrupted after the append loses no row', () =>
{
    const p = project({ files: { 'var/data/statistics/l.jsonl': 'r1\nr2\n', '.alfred/statistics/l.jsonl': 'a1\n' } });
    assert.strictEqual(run(p).ok, true);
    // The crash: the append landed, R's copy was never removed - both files are there again at the next update.
    put(p, 'var/data/statistics/l.jsonl', 'r1\nr2\n');
    const again = run(p);
    assert.strictEqual(again.ok, true, again.out);
    const rows = read(p, '.alfred/statistics/l.jsonl').split('\n').filter(Boolean);
    for (const row of ['a1', 'r1', 'r2']) assert.ok(rows.includes(row), `${row} is in the merged ledger`);
    assert.ok(!has(p, 'var/data'));
});

test('fixed root move: a project that is no repository moves by rename', () =>
{
    const p = project({ repo: false, files: OLD() });
    const r = run(p);
    assert.strictEqual(r.ok, true, r.out);
    assert.match(r.out, /^ *data root: moved var\/data to \.alfred$/);
    assert.strictEqual(read(p, `.alfred/${STORE}`), 'NAME=value\n', 'nothing can stage the store, so it moves');
    assert.strictEqual(read(p, '.alfred/docs/a.md'), 'doc\n');
    assert.ok(!/git|fatal/i.test(r.out), 'no git error reaches the report');
    assert.ok(!has(p, 'var/data'));
});

test('fixed root plan: it reads and writes nothing, and names each step', () =>
{
    const p = project({ files: OLD('var/data', { 'var/data/notes.md': 'mine\n', '.alfred/state/n.json': '{}\n' }), tracked: ['var/data/docs/a.md'] });
    const before = snapshot(p);
    const plan = fixed.planFixedRoot({ projectRoot: p, info: infoOf(p), scope: 'project' });
    assert.deepStrictEqual(snapshot(p), before);
    assert.strictEqual(plan.stop, null);
    assert.deepStrictEqual(plan.sources.map((s) => [s.root, s.kept]), [['var/data', ['notes.md']]]);
    assert.deepStrictEqual(plan.sources[0].steps, [
        { entry: 'docs', how: 'move', tracked: true }, { entry: '.variables', how: 'move', tracked: false },
        { entry: 'workspace.json', how: 'move', tracked: false }, { entry: 'state', how: 'merge', tracked: false },
        { entry: STORE, how: 'move', tracked: false }, { entry: '.gitignore', how: 'copy', tracked: false },
    ]);
    assert.deepStrictEqual([plan.pending, plan.empty], [[], []]);
});
