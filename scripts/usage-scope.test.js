'use strict';
// usage-scope.js - which projects a usage audit reads from where it is invoked (W2, D7 to D13): a root reads itself
// and every project joined below it, a child or a standalone project itself alone; what is left out is named once.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tree, session, encode, gitEnv } = require('./usage-fixture.js');
const layout = require('../stack/hooks/layout.js');

const { usageScope, sessionsDirOf } = require('./usage-scope.js');

const rels = (s) => s.projects.map((p) => p.rel);
const ws4 = (extra = {}) => tree({
    ws: { stamp: true, git: true, record: { role: 'root', children: ['api', 'web'] } },
    'ws/api': { stamp: true, git: true, record: { parent: '..', children: ['lib'] } },
    'ws/api/lib': { stamp: true, git: true, record: { parent: '..' } },
    'ws/web': { stamp: true, git: true, record: { parent: '..' } },
    ...extra,
});
const scope = (t, rel, env = {}) => usageScope(t(rel), { env: { ...t.env, ...env } });

test('a standalone project: itself alone, nothing left out, no note', () =>
{
    const t = tree({ solo: { stamp: true, git: true } });
    const s = scope(t, 'solo');
    assert.deepStrictEqual([rels(s), s.projects[0].root, s.leftOut, s.notes], [['.'], t('solo'), [], []]);
});

test('a root: itself and every project joined below it, pre-order, each root its real path', () =>
{
    const t = ws4();
    const s = scope(t, 'ws');
    assert.deepStrictEqual(rels(s), ['.', 'api', 'api/lib', 'web']);
    assert.deepStrictEqual(s.projects.map((p) => p.root), [t('ws'), t('ws/api'), t('ws/api/lib'), t('ws/web')]);
    assert.deepStrictEqual(s.leftOut, []);
});

test('a child, a middle member and a grandchild: each itself alone (D7)', () =>
{
    const t = ws4();
    for (const rel of ['ws/web', 'ws/api', 'ws/api/lib'])
    {
        const s = scope(t, rel);
        assert.deepStrictEqual([rels(s), s.projects[0].root, s.leftOut], [['.'], t(rel), []], rel);
    }
});

test('a gone child is left out as gone', () =>
{
    const t = ws4({ ws: { stamp: true, git: true, record: { role: 'root', children: ['api', 'web', 'old'] } } });
    const s = scope(t, 'ws');
    assert.deepStrictEqual(s.leftOut, [{ rel: 'old', why: 'gone' }]);
    assert.ok(!rels(s).includes('old'));
});

test('a child naming another parent, and the project below it', () =>
{
    const t = tree({
        ws: { stamp: true, git: true, record: { role: 'root', children: ['x'] } },
        'ws/x': { stamp: true, git: true, record: { children: ['y'] } },
        'ws/x/y': { stamp: true, git: true, record: { parent: '..' } },
    });
    const s = scope(t, 'ws');
    assert.deepStrictEqual(s.leftOut, [{ rel: 'x', why: 'names another parent' }, { rel: 'x/y', why: 'under x' }]);
    assert.deepStrictEqual(rels(s), ['.']);
});

test('an ignored project, in the root\'s list and in a child\'s', () =>
{
    const t = ws4({
        ws: { stamp: true, git: true, record: { role: 'root', children: ['api', 'web'], ignoredChildren: ['legacy/app'] } },
        'ws/api': { stamp: true, git: true, record: { parent: '..', children: ['lib'], ignoredChildren: ['tools'] } },
    });
    const s = scope(t, 'ws');
    assert.deepStrictEqual(s.leftOut, [{ rel: 'legacy/app', why: 'ignored' }, { rel: 'api/tools', why: 'ignored' }]);
    assert.ok(!rels(s).includes('legacy/app') && !rels(s).includes('api/tools'));
});

test('an entry in a folder that is no holder does nothing (D20): the project is counted, never named', () =>
{
    const t = tree({
        ws: { stamp: true, git: true, record: { role: 'root', children: ['api'], ignoredChildren: ['api/tools'] } },
        'ws/api': { stamp: true, git: true, record: { parent: '..', children: ['tools'] } },
        'ws/api/tools': { stamp: true, git: true, record: { parent: '..' } },
    });
    const s = scope(t, 'ws');
    assert.ok(rels(s).includes('api/tools'));
    assert.deepStrictEqual(s.leftOut, []);
});

test('the between tree, the mark in the nearer holder\'s list: one row, before and after its own release', () =>
{
    const spec = (p) => ({
        b: { stamp: true, git: true, record: { role: 'root', children: ['mid', 'mid/p'] } },
        'b/mid': { stamp: true, git: true, record: { parent: '..', ignoredChildren: ['p'] } },
        'b/mid/p': { stamp: true, git: true, record: p },
    });
    for (const record of [{ parent: '../..' }, {}])
    {
        const s = scope(tree(spec(record)), 'b');
        assert.deepStrictEqual(rels(s), ['.', 'mid'], JSON.stringify(record));
        assert.deepStrictEqual(s.leftOut, [{ rel: 'mid/p', why: 'ignored' }], JSON.stringify(record));
    }
});

test('the between tree, mid installed and not joined: the row\'s own ignoredBy names it', () =>
{
    const t = tree({
        b: { stamp: true, git: true, record: { role: 'root', children: ['mid/p'] } },
        'b/mid': { stamp: true, git: true, record: { ignoredChildren: ['p'] } },
        'b/mid/p': { stamp: true, git: true, record: { parent: '../..' } },
    });
    const s = scope(t, 'b');
    assert.deepStrictEqual([rels(s), s.leftOut], [['.'], [{ rel: 'mid/p', why: 'ignored' }]]);
});

test('the between tree, the mark in the root\'s list, then in both lists: the same one row', () =>
{
    for (const midList of [undefined, ['p']])
    {
        const t = tree({
            b: { stamp: true, git: true, record: { role: 'root', children: ['mid', 'mid/p'], ignoredChildren: ['mid/p'] } },
            'b/mid': { stamp: true, git: true, record: { parent: '..', ...(midList ? { ignoredChildren: midList } : {}) } },
            'b/mid/p': { stamp: true, git: true, record: { parent: '../..' } },
        });
        const s = scope(t, 'b');
        assert.deepStrictEqual([rels(s), s.leftOut], [['.', 'mid'], [{ rel: 'mid/p', why: 'ignored' }]], String(midList));
    }
});

test('a root whose one child is left out still names it - ignored, gone, naming another parent, no install', () =>
{
    const cases = [
        [{ one: { stamp: true, git: true, record: { role: 'root', ignoredChildren: ['legacy'] } }, 'one/legacy': { stamp: true, git: true } }, { rel: 'legacy', why: 'ignored' }],
        [{ one: { stamp: true, git: true, record: { role: 'root', children: ['old'] } } }, { rel: 'old', why: 'gone' }],
        [{ one: { stamp: true, git: true, record: { role: 'root', children: ['x'] } }, 'one/x': { stamp: true, git: true } }, { rel: 'x', why: 'names another parent' }],
        [{ one: { stamp: true, git: true, record: { role: 'root', ignoredChildren: ['legacy'] } }, 'one/legacy': {} }, { rel: 'legacy', why: 'ignored' }],
    ];
    for (const [spec, row] of cases)
    {
        const s = scope(tree(spec), 'one');
        assert.deepStrictEqual([rels(s), s.leftOut], [['.'], [row]], row.why);
    }
});

test('the switch off names nothing left out, and reads the project alone', () =>
{
    const t = tree({ one: { stamp: true, git: true, record: { role: 'root', ignoredChildren: ['legacy'] } }, 'one/legacy': { stamp: true, git: true } });
    const s = scope(t, 'one', { ALFRED_CODE_WORKSPACE: '0' });
    assert.deepStrictEqual([rels(s), s.leftOut], [['.'], []]);
    assert.deepStrictEqual(rels(scope(ws4(), 'ws', { ALFRED_CODE_WORKSPACE: '0' })), ['.']);
});

test('a run in a child names nothing left out', () =>
{
    const t = ws4({ 'ws/api': { stamp: true, git: true, record: { parent: '..', children: ['lib', 'old'], ignoredChildren: ['tools'] } } });
    assert.deepStrictEqual(scope(t, 'ws/api').leftOut, []);
});

test('a garbage record at the start: the project alone, one note', () =>
{
    const t = ws4();
    fs.writeFileSync(path.join(t('ws'), '.alfred', 'workspace.json'), '{');
    const s = scope(t, 'ws');
    assert.deepStrictEqual(rels(s), ['.']);
    assert.strictEqual(s.notes.length, 1);
    assert.match(s.notes[0], /is not valid JSON/);
});

test('a garbage record in a child: the child is read, nothing below it, one note, nothing on stdout', () =>
{
    const t = ws4();
    fs.writeFileSync(path.join(t('ws/api'), '.alfred', 'workspace.json'), '{');
    const written = [];
    const write = process.stdout.write;
    process.stdout.write = (chunk, ...rest) => { written.push(String(chunk)); return true; };
    let s;
    try { s = scope(t, 'ws'); }
    finally { process.stdout.write = write; }
    assert.ok(rels(s).includes('api') && !rels(s).includes('api/lib'));
    assert.strictEqual(s.notes.length, 1);
    assert.deepStrictEqual(written, []);
});

test('a member with no transcript folder is in scope with no folder, never left out', () =>
{
    const t = ws4();
    const s = scope(t, 'ws');
    const web = s.projects.find((p) => p.rel === 'web');
    assert.deepStrictEqual([web.dirs, s.leftOut], [[], []]);
});

test('dirs: a project that is its own git top, and one in no repository - one folder each, no duplicate', () =>
{
    const t = tree({ api: { stamp: true, git: true }, solo: { stamp: true } });
    for (const rel of ['api', 'solo'])
    {
        session(t, t(rel), `${rel}-1`);
        const s = scope(t, rel);
        assert.deepStrictEqual(s.projects[0].dirs, [path.join(t.config, 'projects', encode(t(rel)))], rel);
    }
});

test('dirs: a package inside a larger repository reads its own folder, never the top\'s', () =>
{
    const t = tree({ mono: { git: true }, 'mono/pkg': { stamp: true } });
    session(t, t('mono'), 'top-1');
    session(t, t('mono/pkg'), 'pkg-1');
    assert.deepStrictEqual(scope(t, 'mono/pkg').projects[0].dirs, [path.join(t.config, 'projects', encode(t('mono/pkg')))]);
});

// A folder whose encoded name is exactly `n` characters, under `under` (a folder of the tree), or null where the temp
// dir is too deep to spell it.
const longRel = (t, under, n) =>
{
    const room = n - encode(path.join(t(under), 'p')).length;
    return room < 1 ? null : `${under}/p${'x'.repeat(room)}`;
};

test('dirs: a project past 200 characters that is its own git top is found where Claude Code names it - at 199, 200, 201', (ctx) =>
{
    for (const n of [199, 200, 201, 230])
    {
        const t = tree({ base: {} });
        const rel = longRel(t, 'base', n);
        if (!rel) { ctx.skip(`the temp dir is too deep for a ${n}-character name`); return; }
        fs.mkdirSync(t(rel), { recursive: true });
        // A `.git` folder, not `git init`: Git for Windows cannot stat a folder past MAX_PATH (gate 0dfbdd3a), and
        // gitTopOf reads the folder with fs alone.
        fs.mkdirSync(path.join(t(rel), '.git'));
        fs.mkdirSync(path.join(t(rel), '.claude'), { recursive: true });
        fs.writeFileSync(path.join(t(rel), '.claude', 'alfred-code.stamp'), 'sha: x\n');
        assert.strictEqual(encode(t(rel)).length, n);
        const folder = path.dirname(layout.defaultMemoryDirs(t(rel), { env: t.env })[0]);
        fs.mkdirSync(folder, { recursive: true });
        assert.ok(scope(t, rel).projects[0].dirs.includes(folder), `${n}`);
    }
});

test('dirs: past 200 characters inside another repository - no folder, and a note says why', (ctx) =>
{
    const t = tree({ mono: { git: true } });
    const rel = longRel(t, 'mono', 230);
    if (!rel) { ctx.skip('the temp dir is too deep for a 230-character name'); return; }
    fs.mkdirSync(path.join(t(rel), '.claude'), { recursive: true });
    fs.writeFileSync(path.join(t(rel), '.claude', 'alfred-code.stamp'), 'sha: x\n');
    const s = scope(t, rel);
    assert.deepStrictEqual(s.projects[0].dirs, []);
    assert.ok(s.notes.includes('.: a path past 200 characters inside another repository - its transcript folder is not looked up'), s.notes.join('\n'));
});

test('dirs: CLAUDE_CODE_PROJECT_DIR_NAME set - the folder sessionsDirOf names, when it exists', () =>
{
    const t = tree({ api: { stamp: true, git: true } });
    session(t, t('api'), 'a-1');
    const s = scope(t, 'api', { CLAUDE_CODE_PROJECT_DIR_NAME: 'my-project' });
    assert.deepStrictEqual(s.projects[0].dirs, [sessionsDirOf(t('api'), t.config)]);
});

test('a start in a sub-folder, and in a linked worktree: the project\'s own root, and a note naming the start (Review Focus 1)', () =>
{
    const t = ws4();
    fs.mkdirSync(path.join(t('ws/api'), 'src'), { recursive: true });
    const sub = scope(t, 'ws/api/src');
    assert.strictEqual(sub.projects[0].root, t('ws/api'));
    assert.ok(sub.notes.some((n) => n.startsWith('scope: started in src - ')), sub.notes.join('\n'));

    const w = tree({ solo: { stamp: true, git: true } });
    const env = gitEnv(w.home);
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: w('solo'), env });
    execFileSync('git', ['worktree', 'add', '-q', path.join(w.top, 'wt')], { cwd: w('solo'), env });
    const wt = scope(w, 'wt');
    assert.strictEqual(wt.projects[0].root, w('solo'));
    assert.ok(wt.notes.some((n) => n.startsWith('scope: started in ')), wt.notes.join('\n'));
});

test('a start typed in another letter case on Windows still finds the member\'s folder', { skip: process.platform !== 'win32' && 'win32 only' }, () =>
{
    const t = tree({ api: { stamp: true, git: true } });
    session(t, t('api'), 'a-1');
    const s = usageScope(t('api').toUpperCase(), { env: t.env });
    assert.ok(s.projects[0].dirs.some((d) => d.toLowerCase() === path.join(t.config, 'projects', encode(t('api'))).toLowerCase()));
});
