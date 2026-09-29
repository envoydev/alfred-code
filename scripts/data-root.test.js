'use strict';
// THE PROJECT DATA ROOT (stack/mcp/data-root.js) - one folder, `.alfred` by default, for everything the
// stack and its servers keep for a project: the docs, the navigation server's index and handoff notes,
// the browser profiles and a project-level memory database. One module answers where each lives, so
// the three launchers and the installer can never disagree.
//
// Every case builds its own tree under a temp dir and a temp HOME - the real ~/.memory-mcp is never read.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dr = require('../stack/mcp/data-root.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'data-root-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let n = 0;
const fresh = (name) => { const dir = path.join(TMP, `${name}-${n += 1}`); fs.mkdirSync(dir, { recursive: true }); return dir; };
const put = (file, text = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const settings = (dir, env, name = 'settings.json') => put(path.join(dir, '.claude', name), JSON.stringify({ env }));

// ------------------------------------------------------------------ the setting

test('data path: a relative folder is the answer; everything that would break a server or prompt is refused', () =>
{
    const rows = [
        ['.alfred', true, '.alfred'],
        ['./.data/', true, '.data'],
        ['tools\\alfred', true, 'tools/alfred'],
        ['var//alfred', true, 'var/alfred'],
        ['', false],
        ['   ', false],
        ['/abs/alfred', false],
        ['C:/alfred', false],
        ['..', false],
        ['x/../y', false],
        ['.', false],
        ['.claude', false],
        ['.claude/data', false],
        ['.git/alfred', false],
        ['my data', false],
        ['$HOME/x', false],
    ];
    for (const [raw, ok, value] of rows)
    {
        const got = dr.checkDataPath(raw);
        assert.strictEqual(got.ok, ok, `${JSON.stringify(raw)} -> ${JSON.stringify(got)}`);
        if (ok) assert.strictEqual(got.value, value, JSON.stringify(raw));
        else assert.ok(got.why && got.why.length > 3, `${JSON.stringify(raw)} says why it is refused`);
    }
});

test('data root: absent is .alfred; the setting is read from the shell, then settings.local.json, settings.json and the account', () =>
{
    const p = fresh('root');
    const acct = path.join(p, 'acct');
    const env = { CLAUDE_CONFIG_DIR: acct };
    assert.deepStrictEqual(dr.dataRootOf({ env, projectDir: p }), { root: '.alfred', source: 'default' });
    put(path.join(acct, 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: '.acct' } }));
    assert.strictEqual(dr.dataRootOf({ env, projectDir: p }).root, '.acct');
    settings(p, { ALFRED_CODE_DATA_PATH: '.shared' });
    assert.strictEqual(dr.dataRootOf({ env, projectDir: p }).root, '.shared');
    settings(p, { ALFRED_CODE_DATA_PATH: '.mine' }, 'settings.local.json');
    assert.deepStrictEqual(dr.dataRootOf({ env, projectDir: p }), { root: '.mine', source: 'setting' });
    assert.strictEqual(dr.dataRootOf({ env: { ...env, ALFRED_CODE_DATA_PATH: '.shell' }, projectDir: p }).root, '.shell');
});

test('data root: a refused value falls back to .alfred and says why, never to a folder under .claude/', () =>
{
    const p = fresh('bad-root');
    settings(p, { ALFRED_CODE_DATA_PATH: '.claude/data' });
    const got = dr.dataRootOf({ env: { CLAUDE_CONFIG_DIR: path.join(p, 'acct') }, projectDir: p });
    assert.strictEqual(got.root, '.alfred');
    assert.strictEqual(got.source, 'invalid');
    assert.match(got.why, /\.claude/);
});

test('layout: every kind of data has one place under the root', () =>
{
    const l = dr.layout('.data');
    assert.strictEqual(l.docs, '.data/docs');
    assert.strictEqual(l.serena, '.data/serena');
    assert.strictEqual(l.serenaHome, '.data/serena/home');
    assert.strictEqual(l.browser('firefox'), '.data/browser/firefox');
    assert.strictEqual(l.memory, '.data/.alfred-memory');
    assert.strictEqual(l.memoryDb, '.data/.alfred-memory/memory.db');
    assert.strictEqual(dr.targetOf('serena', '.data'), '.data/serena');
    assert.strictEqual(dr.targetOf('browser-webkit', '.data'), '.data/browser/webkit');
    assert.strictEqual(dr.targetOf('memory', '.data'), '.data/.alfred-memory');
    assert.strictEqual(dr.legacyOf('serena'), '.serena');
    assert.strictEqual(dr.legacyOf('browser-chrome'), '.playwright/chrome');
    assert.strictEqual(dr.legacyOf('memory'), '.memory-mcp');
    assert.strictEqual(dr.rootOfPlace('serena', '.data/serena'), '.data');
    assert.strictEqual(dr.rootOfPlace('browser-chrome', 'x/y/browser/chrome'), 'x/y');
    assert.strictEqual(dr.rootOfPlace('memory', '.alfred/.alfred-memory'), '.alfred');
    assert.strictEqual(dr.rootOfPlace('serena', '.serena'), null, 'a 2.0.0 place has no root');
});

// ------------------------------------------------------------------ the memory folder (Task 7a)

test('memory: every level names .alfred-memory - the home folder for global and scoped, the data root for project', () =>
{
    const home = '/h/me';
    const projectRoot = '/w/app';
    assert.strictEqual(dr.memoryDbFor('global', { home }), path.join(home, '.alfred-memory', 'memory.db'));
    assert.strictEqual(dr.memoryDbFor('scoped', { home, space: 'work' }), path.join(home, '.alfred-memory', 'memory_work.db'));
    assert.strictEqual(dr.memoryDbFor('scoped', { home }), path.join(home, '.alfred-memory', 'memory_default.db'));
    assert.strictEqual(dr.memoryDbFor('project', { home, projectRoot }), path.join(projectRoot, '.alfred', '.alfred-memory', 'memory.db'));
    assert.strictEqual(dr.memoryDbFor('project', { home, projectRoot, root: '.data' }), path.join(projectRoot, '.data', '.alfred-memory', 'memory.db'));
    assert.strictEqual(dr.memoryDbFor('project', { home }), '', 'no project, no project database');
});

test('memory: the level of a path reads the new AND the old folder, and nothing else', () =>
{
    const home = '/h/me';
    const projectRoot = '/w/app';
    const at = (p) => dr.memoryLevelOf(p, { home, projectRoot });
    assert.strictEqual(at(path.join(home, '.alfred-memory', 'memory.db')), 'global');
    assert.strictEqual(at(path.join(home, '.memory-mcp', 'memory.db')), 'global');
    assert.strictEqual(at(path.join(home, '.alfred-memory', 'memory_x.db')), 'scoped');
    assert.strictEqual(at(path.join(home, '.memory-mcp', 'memory_default.db')), 'scoped');
    assert.strictEqual(at(path.join(projectRoot, '.alfred', '.alfred-memory', 'memory.db')), 'project');
    assert.strictEqual(at(path.join(projectRoot, '.data', '.alfred-memory', 'memory.db')), 'project', 'a custom data root is still this project');
    assert.strictEqual(at(path.join(projectRoot, '.memory-mcp', 'memory.db')), 'project');
    assert.strictEqual(at(path.join('/elsewhere', '.alfred-memory', 'memory.db')), '');
    assert.strictEqual(at(path.join(home, 'notes', 'memory.db')), '');
    assert.strictEqual(at(''), '');
});

test('memory: the old twin of a new path - the home folder by name, the project database at its old place', () =>
{
    const home = '/h/me';
    const projectRoot = '/w/app';
    assert.strictEqual(dr.legacyTwinOf(path.join(home, '.alfred-memory', 'memory_w.db'), { home, projectRoot }), path.join(home, '.memory-mcp', 'memory_w.db'));
    assert.strictEqual(dr.legacyTwinOf(path.join(projectRoot, '.data', '.alfred-memory', 'memory.db'), { home, projectRoot }), path.join(projectRoot, '.memory-mcp', 'memory.db'));
    assert.strictEqual(dr.legacyTwinOf('/custom/place/memory.db', { home, projectRoot }), null);
});

test('home memory: an idle ~/.memory-mcp moves to ~/.alfred-memory, backups and all, and the old path still resolves', { skip: process.platform === 'win32' && 'the junction case is Windows-only and measured there' }, () =>
{
    const home = fresh('home-move');
    put(path.join(home, '.memory-mcp', 'memory.db'), 'DB');
    put(path.join(home, '.memory-mcp', 'memory_work.db'), 'SCOPED');
    put(path.join(home, '.memory-mcp', 'backups', 'reembed-1.jsonl'), '{}');
    const got = dr.moveHomeMemory({ home });
    assert.strictEqual(got.state, 'moved');
    assert.strictEqual(got.linked, true);
    assert.strictEqual(fs.readFileSync(path.join(home, '.alfred-memory', 'memory.db'), 'utf8'), 'DB');
    assert.ok(fs.existsSync(path.join(home, '.alfred-memory', 'backups', 'reembed-1.jsonl')), 'the backups moved with the folder');
    assert.ok(fs.lstatSync(path.join(home, '.memory-mcp')).isSymbolicLink(), 'the old path is a link');
    assert.strictEqual(fs.readFileSync(path.join(home, '.memory-mcp', 'memory_work.db'), 'utf8'), 'SCOPED', 'Cursor and an older install still read it through the link');
    assert.strictEqual(dr.moveHomeMemory({ home }).state, 'linked', 'a second call changes nothing');
});

test('home memory: a database with a -wal or -shm beside it is held open - nothing moves', () =>
{
    for (const sidecar of ['-wal', '-shm'])
    {
        const home = fresh('home-busy');
        put(path.join(home, '.memory-mcp', 'memory.db'), 'DB');
        put(path.join(home, '.memory-mcp', `memory.db${sidecar}`), 'LIVE');
        const got = dr.moveHomeMemory({ home });
        assert.strictEqual(got.state, 'busy', sidecar);
        assert.deepStrictEqual(got.busy, ['memory.db']);
        assert.ok(fs.statSync(path.join(home, '.memory-mcp')).isDirectory(), 'the folder stays where it is');
        assert.ok(!fs.existsSync(path.join(home, '.alfred-memory')), 'nothing was created at the new path');
    }
});

test('home memory: nothing to move, an empty new folder, and a new folder that already holds data', () =>
{
    assert.strictEqual(dr.moveHomeMemory({ home: fresh('home-none') }).state, 'absent');
    const emptyNew = fresh('home-empty-new');
    put(path.join(emptyNew, '.memory-mcp', 'memory.db'), 'DB');
    fs.mkdirSync(path.join(emptyNew, '.alfred-memory'));
    assert.strictEqual(dr.moveHomeMemory({ home: emptyNew }).state, 'moved', 'an empty new folder is no conflict');
    const both = fresh('home-both');
    put(path.join(both, '.memory-mcp', 'memory.db'), 'OLD');
    put(path.join(both, '.alfred-memory', 'memory.db'), 'NEW');
    const got = dr.moveHomeMemory({ home: both });
    assert.strictEqual(got.state, 'exists');
    assert.strictEqual(fs.readFileSync(path.join(both, '.memory-mcp', 'memory.db'), 'utf8'), 'OLD', 'neither side is touched');
});

test('live memory db: the configured path, else its old twin while it has not moved', () =>
{
    const home = fresh('live-db');
    const projectRoot = path.join(home, 'app');
    const want = path.join(home, '.alfred-memory', 'memory.db');
    assert.strictEqual(dr.liveMemoryDb(want, { home, projectRoot }), want, 'nothing anywhere: the configured path');
    put(path.join(home, '.memory-mcp', 'memory.db'));
    assert.strictEqual(dr.liveMemoryDb(want, { home, projectRoot }), path.join(home, '.memory-mcp', 'memory.db'));
    put(want);
    assert.strictEqual(dr.liveMemoryDb(want, { home, projectRoot }), want);
});

// I2: the rename commits before the link is tried, so a link that cannot be made (no junction, or another
// server re-created ~/.memory-mcp in between - EEXIST) leaves the data at the NEW place only. Every reader then
// resolves the old spelling to it, and nothing re-creates the old folder as a second, empty database.
test('I2 home memory: a link that cannot be made leaves the data at the new place, and the old spelling resolves to it', () =>
{
    const home = fresh('home-nolink');
    put(path.join(home, '.memory-mcp', 'memory.db'), 'DB');
    const eperm = () => { const err = new Error('operation not permitted'); err.code = 'EPERM'; throw err; };
    const got = dr.moveHomeMemory({ home, symlink: eperm });
    assert.strictEqual(got.state, 'moved');
    assert.strictEqual(got.linked, false);
    assert.strictEqual(fs.readFileSync(path.join(home, '.alfred-memory', 'memory.db'), 'utf8'), 'DB');
    assert.ok(!fs.existsSync(path.join(home, '.memory-mcp')), 'no link and no folder at the old path');
    const old = path.join(home, '.memory-mcp', 'memory.db');
    assert.strictEqual(dr.liveMemoryDb(old, { home }), path.join(home, '.alfred-memory', 'memory.db'), 'the old spelling reads the moved file');
});

test('I2 live memory db: an old home path that is gone names the new spelling even before anything is there', () =>
{
    const home = fresh('home-gone');
    assert.strictEqual(dr.liveMemoryDb(path.join(home, '.memory-mcp', 'memory_work.db'), { home }), path.join(home, '.alfred-memory', 'memory_work.db'),
        'never the 2.0.0 folder a launcher would then create empty');
    put(path.join(home, '.memory-mcp', 'memory.db'), 'OLD');
    assert.strictEqual(dr.liveMemoryDb(path.join(home, '.memory-mcp', 'memory.db'), { home }), path.join(home, '.memory-mcp', 'memory.db'), 'an unmoved old database is still served where it is');
});

// ------------------------------------------------------------------ the move plan

test('move plan: a tree holding every kind of data - the old layout and a prior root - names each move once', () =>
{
    const p = fresh('plan');
    put(path.join(p, '.serena', 'project.yml'), 'project_name: app');
    put(path.join(p, '.serena', 'home', 'serena_config.yml'), 'projects: []');
    put(path.join(p, '.playwright', 'chrome', 'Default', 'Cookies'));
    put(path.join(p, '.alfred', 'browser', 'firefox', 'prefs.js'));
    put(path.join(p, '.memory-mcp', 'memory.db'));
    put(path.join(p, '.data', 'browser', 'webkit', 'x'));          // already at the new root: nothing to do
    const rows = dr.dataMovePlan({ projectRoot: p, root: '.data', prior: '.alfred', engines: ['chrome', 'firefox', 'webkit'], memory: true });
    assert.deepStrictEqual(rows, [
        { cls: 'serena', from: '.serena', to: '.data/serena', conflict: false },
        { cls: 'browser-chrome', from: '.playwright/chrome', to: '.data/browser/chrome', conflict: false },
        { cls: 'browser-firefox', from: '.alfred/browser/firefox', to: '.data/browser/firefox', conflict: false },
        { cls: 'memory', from: '.memory-mcp', to: '.data/.alfred-memory', conflict: false },
    ]);
    assert.deepStrictEqual(dr.dataMovePlan({ projectRoot: p, root: '.data', prior: '.alfred', engines: [], memory: false }).map((r) => r.cls), ['serena'],
        'an engine not kept and a memory level other than project are not this run\'s to move');
});

test('move plan: data at both places is a conflict, and an empty target is not', () =>
{
    const p = fresh('plan-conflict');
    put(path.join(p, '.serena', 'project.yml'));
    put(path.join(p, '.alfred', 'serena', 'project.yml'));
    fs.mkdirSync(path.join(p, '.playwright', 'chrome'), { recursive: true });
    put(path.join(p, '.playwright', 'chrome', 'x'));
    fs.mkdirSync(path.join(p, '.alfred', 'browser', 'chrome'), { recursive: true });
    const rows = dr.dataMovePlan({ projectRoot: p, root: '.alfred', prior: null, engines: ['chrome'], memory: false });
    assert.deepStrictEqual(rows, [
        { cls: 'serena', from: '.serena', to: '.alfred/serena', conflict: true },
        { cls: 'browser-chrome', from: '.playwright/chrome', to: '.alfred/browser/chrome', conflict: false },
    ]);
});

test('move: a target holding only a .gitignore is no data - the move still runs', () =>
{
    const p = fresh('move-ignore');
    put(path.join(p, '.memory-mcp', 'memory.db'), 'M');
    put(path.join(p, '.alfred', '.alfred-memory', '.gitignore'), '*\n');
    assert.deepStrictEqual(dr.dataMovePlan({ projectRoot: p, root: '.alfred', engines: [], memory: true }).map((r) => r.conflict), [false]);
    const got = dr.liveDir({ projectDir: p, cls: 'memory', root: '.alfred', pending: [{ cls: 'memory', from: '.memory-mcp', to: '.alfred/.alfred-memory' }], busy: dr.busyDbs });
    assert.strictEqual(got.state, 'moved');
    assert.strictEqual(fs.readFileSync(path.join(p, '.alfred', '.alfred-memory', 'memory.db'), 'utf8'), 'M');
});

test('pending lines: rendered and read back; a malformed or foreign line is dropped', () =>
{
    const rows = [
        { cls: 'serena', from: '.serena', to: '.alfred/serena' },
        { cls: 'browser-chrome', from: '.playwright/chrome', to: '.alfred/browser/chrome' },
    ];
    const text = `sha: abc\n${dr.renderPending(rows).join('\n')}\ndata-pending: rm -rf / -> x\ndata-pending: serena ../out -> .alfred/serena\n`;
    assert.deepStrictEqual(dr.readPending(text), rows);
});

// ------------------------------------------------------------------ the launchers' view

test('live dir: a pending move runs once nothing holds the data; without a pending line the old place is served, never moved', () =>
{
    const p = fresh('live');
    put(path.join(p, '.serena', 'project.yml'), 'P');
    const pending = [{ cls: 'serena', from: '.serena', to: '.alfred/serena' }];
    const got = dr.liveDir({ projectDir: p, cls: 'serena', root: '.alfred', pending });
    assert.deepStrictEqual({ dir: got.dir, state: got.state }, { dir: '.alfred/serena', state: 'moved' });
    assert.strictEqual(fs.readFileSync(path.join(p, '.alfred', 'serena', 'project.yml'), 'utf8'), 'P');
    assert.ok(!fs.existsSync(path.join(p, '.serena')));
    assert.strictEqual(dr.liveDir({ projectDir: p, cls: 'serena', root: '.alfred', pending }).state, 'current', 'a re-run finds it in place');

    const q = fresh('live-legacy');
    put(path.join(q, '.playwright', 'chrome', 'Cookies'));
    const legacy = dr.liveDir({ projectDir: q, cls: 'browser-chrome', root: '.alfred', pending: [] });
    assert.deepStrictEqual({ dir: legacy.dir, state: legacy.state }, { dir: '.playwright/chrome', state: 'legacy' });
    assert.ok(fs.existsSync(path.join(q, '.playwright', 'chrome', 'Cookies')), 'no answer, no move');
    assert.strictEqual(dr.liveDir({ projectDir: fresh('live-fresh'), cls: 'serena', root: '.alfred', pending: [] }).state, 'fresh');
});

test('live dir: a browser profile a running browser holds stays put this start', () =>
{
    const p = fresh('live-busy');
    put(path.join(p, '.playwright', 'chrome', 'Cookies'));
    fs.symlinkSync('host-123', path.join(p, '.playwright', 'chrome', 'SingletonLock'));   // Chromium's lock: a dangling link
    const pending = [{ cls: 'browser-chrome', from: '.playwright/chrome', to: '.alfred/browser/chrome' }];
    const got = dr.liveDir({ projectDir: p, cls: 'browser-chrome', root: '.alfred', pending, busy: dr.profileLocks });
    assert.strictEqual(got.state, 'busy');
    assert.strictEqual(got.dir, '.playwright/chrome');
    assert.match(got.why, /SingletonLock/);
    assert.ok(!fs.existsSync(path.join(p, '.alfred')), 'nothing was created at the new place');
});

test('live dir: a project memory folder whose database is open is served where it is', () =>
{
    const p = fresh('live-mem');
    put(path.join(p, '.memory-mcp', 'memory.db'));
    put(path.join(p, '.memory-mcp', 'memory.db-wal'));
    const pending = [{ cls: 'memory', from: '.memory-mcp', to: '.alfred/.alfred-memory' }];
    const got = dr.liveDir({ projectDir: p, cls: 'memory', root: '.alfred', pending, busy: dr.busyDbs });
    assert.deepStrictEqual({ dir: got.dir, state: got.state }, { dir: '.memory-mcp', state: 'busy' });
});

// ------------------------------------------------------------------ the navigation server's own config

test('serena config: the per-project folder key points under the data root; a user\'s own central path is kept', () =>
{
    const home = fresh('serena-home');
    const file = path.join(home, 'serena_config.yml');
    assert.strictEqual(dr.ensureSerenaConfig(home, '.alfred/serena'), 'written');
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /^projects: \[\]$/m, 'serena refuses a config with no projects key');
    assert.match(text, /^project_serena_folder_location: "\$projectDir\/\.alfred\/serena"$/m);
    assert.strictEqual(dr.ensureSerenaConfig(home, '.alfred/serena'), 'current');

    fs.writeFileSync(file, 'log_level: 20\nproject_serena_folder_location: "$projectDir/.serena"\nprojects:\n- /w/app\n');
    assert.strictEqual(dr.ensureSerenaConfig(home, '.data/serena'), 'rewritten', 'serena\'s own default is the stack\'s to move');
    assert.match(fs.readFileSync(file, 'utf8'), /project_serena_folder_location: "\$projectDir\/\.data\/serena"\nprojects:\n- \/w\/app\n$/);
    assert.strictEqual(dr.ensureSerenaConfig(home, '.alfred/serena'), 'rewritten', 'an earlier root is the stack\'s too');

    fs.writeFileSync(file, 'projects: []\n');
    assert.strictEqual(dr.ensureSerenaConfig(home, '.alfred/serena'), 'appended');
    fs.writeFileSync(file, 'projects: []\nproject_serena_folder_location: "/meta/$projectFolderName/.serena"\n');
    assert.strictEqual(dr.ensureSerenaConfig(home, '.alfred/serena'), 'kept');
    assert.match(fs.readFileSync(file, 'utf8'), /\/meta\/\$projectFolderName\/\.serena/);
});
