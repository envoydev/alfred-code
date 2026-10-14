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
    assert.strictEqual(l.browser('firefox'), '.data/firefox-control');
    assert.strictEqual(l.memory, '.data/.alfred-memory');
    assert.strictEqual(l.memoryDb, '.data/.alfred-memory/memory.db');
    assert.strictEqual(dr.targetOf('serena', '.data'), '.data/serena');
    assert.strictEqual(dr.targetOf('webkit-control', '.data'), '.data/webkit-control');
    assert.strictEqual(dr.targetOf('memory', '.data'), '.data/.alfred-memory');
    assert.strictEqual(dr.legacyOf('serena'), '.serena');
    assert.strictEqual(dr.legacyOf('chrome-control'), '.playwright/chrome');
    assert.strictEqual(dr.legacyOf('memory'), '.memory-mcp');
    assert.strictEqual(dr.rootOfPlace('serena', '.data/serena'), '.data');
    assert.strictEqual(dr.rootOfPlace('chrome-control', 'x/y/chrome-control'), 'x/y');
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
    put(path.join(p, '.alfred', 'firefox-control', 'prefs.js'));
    put(path.join(p, '.memory-mcp', 'memory.db'));
    put(path.join(p, '.data', 'webkit-control', 'x'));          // already at the new root: nothing to do
    const rows = dr.dataMovePlan({ projectRoot: p, root: '.data', prior: '.alfred', engines: ['chrome', 'firefox', 'webkit'], memory: true });
    assert.deepStrictEqual(rows, [
        { cls: 'serena', from: '.serena', to: '.data/serena', conflict: false },
        { cls: 'chrome-control', from: '.playwright/chrome', to: '.data/chrome-control', conflict: false },
        { cls: 'firefox-control', from: '.alfred/firefox-control', to: '.data/firefox-control', conflict: false },
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
    fs.mkdirSync(path.join(p, '.alfred', 'chrome-control'), { recursive: true });
    const rows = dr.dataMovePlan({ projectRoot: p, root: '.alfred', prior: null, engines: ['chrome'], memory: false });
    assert.deepStrictEqual(rows, [
        { cls: 'serena', from: '.serena', to: '.alfred/serena', conflict: true },
        { cls: 'chrome-control', from: '.playwright/chrome', to: '.alfred/chrome-control', conflict: false },
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
        { cls: 'chrome-control', from: '.playwright/chrome', to: '.alfred/chrome-control' },
    ];
    const text = `sha: abc\n${dr.renderPending(rows).join('\n')}\ndata-pending: rm -rf / -> x\ndata-pending: serena ../out -> .alfred/serena\n`;
    assert.deepStrictEqual(dr.readPending(text), rows);
});

// ------------------------------------------------------------------ the project's sensitive data (2026-10-13)

test('sensitive data: its place is <root>/.sensitive-data; a root change moves the file and nothing else does', () =>
{
    assert.strictEqual(dr.layout('.data').sensitive, '.data/.sensitive-data');
    assert.strictEqual(dr.targetOf('sensitive', '.data'), '.data/.sensitive-data');
    assert.strictEqual(dr.rootOfPlace('sensitive', 'var/data/.sensitive-data'), 'var/data');
    assert.strictEqual(dr.legacyOf('sensitive'), null, 'no 2.0.0 place');
    const p = fresh('sensitive-plan');
    put(path.join(p, '.alfred', '.sensitive-data'), 'K=v\n');
    assert.deepStrictEqual(dr.dataMovePlan({ projectRoot: p, root: '.alfred' }), [], 'at its place already');
    assert.deepStrictEqual(dr.dataMovePlan({ projectRoot: p, root: '.data', prior: '.alfred' }),
        [{ cls: 'sensitive', from: '.alfred/.sensitive-data', to: '.data/.sensitive-data', conflict: false }]);
    put(path.join(p, '.data', '.sensitive-data'), 'K=other\n');
    assert.strictEqual(dr.dataMovePlan({ projectRoot: p, root: '.data', prior: '.alfred' })[0].conflict, true, 'a store at both places');
    const q = fresh('sensitive-dir');
    fs.mkdirSync(path.join(q, '.alfred', '.sensitive-data'), { recursive: true });
    put(path.join(q, '.alfred', '.sensitive-data', 'x'));
    assert.deepStrictEqual(dr.dataMovePlan({ projectRoot: q, root: '.data', prior: '.alfred' }), [], 'a folder of that name is no store');
    assert.deepStrictEqual(dr.readPending('data-pending: sensitive .alfred/.sensitive-data -> .data/.sensitive-data\n'),
        [{ cls: 'sensitive', from: '.alfred/.sensitive-data', to: '.data/.sensitive-data' }]);
});

test('sensitive data: the move writes the new root\'s .gitignore first and refuses to overwrite a store already there', () =>
{
    const p = fresh('sensitive-move');
    put(path.join(p, '.alfred', '.sensitive-data'), 'K=v\n');
    assert.deepStrictEqual(dr.movePlace({ projectDir: p, cls: 'sensitive', from: '.alfred/.sensitive-data', to: 'var/data/.sensitive-data' }), { state: 'moved' });
    assert.strictEqual(fs.readFileSync(path.join(p, 'var', 'data', '.sensitive-data'), 'utf8'), 'K=v\n');
    assert.ok(!fs.existsSync(path.join(p, '.alfred', '.sensitive-data')));
    assert.ok(fs.readFileSync(path.join(p, 'var', 'data', '.gitignore'), 'utf8').startsWith(dr.DATA_IGNORE_HEAD), 'the new root ignores it');
    put(path.join(p, '.alfred', '.sensitive-data'), 'K=new\n');
    assert.strictEqual(dr.movePlace({ projectDir: p, cls: 'sensitive', from: '.alfred/.sensitive-data', to: 'var/data/.sensitive-data' }).state, 'conflict');
    assert.strictEqual(fs.readFileSync(path.join(p, 'var', 'data', '.sensitive-data'), 'utf8'), 'K=v\n', 'neither side touched');
    assert.strictEqual(dr.movePlace({ projectDir: p, cls: 'sensitive', from: '.none/.sensitive-data', to: '.x/.sensitive-data' }).state, 'absent');
});

test('sensitive data: a launch takes the store where nothing else set the key, and never logs a value', () =>
{
    const p = fresh('sensitive-env');
    assert.deepStrictEqual(dr.withSensitive({ PATH: '/bin' }, { projectDir: p }), { env: { PATH: '/bin' }, count: 0 }, 'no store: the env as it was');
    put(path.join(p, '.alfred', '.sensitive-data'), '# mine\nAPI_TOKEN="abc-123"\nDB_HOST=db\nPATH=/evil\n');
    assert.deepStrictEqual(dr.withSensitive({ PATH: '/bin', DB_HOST: 'shell' }, { projectDir: p }),
        { env: { PATH: '/bin', DB_HOST: 'shell', API_TOKEN: 'abc-123' }, count: 1 }, 'the shell or a settings file wins: dotenv\'s own rule');
    // PL2: `only` - the keys a server documents; the store's other keys stay out of its environment.
    assert.deepStrictEqual(dr.withSensitive({ PATH: '/bin' }, { projectDir: p, only: ['DB_HOST', 'NOT_THERE'] }),
        { env: { PATH: '/bin', DB_HOST: 'db' }, count: 1 }, 'only a documented key');
    assert.deepStrictEqual(dr.withSensitive({ PATH: '/bin' }, { projectDir: p, only: [] }), { env: { PATH: '/bin' }, count: 0 }, 'no documented key: none');
    put(path.join(p, 'var', 'data', '.sensitive-data'), 'OTHER=1\n');
    assert.deepStrictEqual(dr.withSensitive({}, { projectDir: p, root: 'var/data' }).env, { OTHER: '1' }, 'an explicit root');
    assert.deepStrictEqual(dr.withSensitive({ ALFRED_CODE_DATA_PATH: 'var/data' }, { projectDir: p }).env, { ALFRED_CODE_DATA_PATH: 'var/data', OTHER: '1' }, 'the root setting');
    settings(p, { ALFRED_CODE_DATA_PATH: 'var/data' });
    assert.deepStrictEqual(dr.withSensitive({}, { projectDir: p }).env, { OTHER: '1' }, 'the root a settings file names');
    assert.strictEqual(dr.sensitivePlaceOf({ projectDir: p, root: '.none' }), null);
});

// The capture's credentials file before 2026-10-13 moves into the store (the user's call: one credential home, by update).
const CAP = (p, docs = '.alfred/docs') => path.join(p, ...docs.split('/'), 'project-capabilities');
const IGNORED = () => true;
function oldCapture(p, { cred = 'ADMIN_EMAIL=me@x.io\nADMIN_PASSWORD="pa55 w0rd"\n', docs = '.alfred/docs' } = {})
{
    put(path.join(CAP(p, docs), 'credentials.local.env'), cred);
    put(path.join(CAP(p, docs), '.gitignore'), 'credentials.local.env\n');
    put(path.join(CAP(p, docs), 'PROJECT-CAPABILITIES.md'), `## Reach and log in\n- Credentials live in: \`${docs}/project-capabilities/credentials.local.env\`, key \`ADMIN_PASSWORD\`\n- see credentials.local.env\n`);
}

test('old credentials: a run book\'s credentials.local.env moves into a new store, the run book re-pointed, the folder ignore kept', () =>
{
    const p = fresh('adopt-new');
    oldCapture(p);
    const r = dr.adoptCredentials({ projectDir: p, check: IGNORED });
    assert.deepStrictEqual(r, { state: 'moved', from: '.alfred/docs/project-capabilities/credentials.local.env', to: '.alfred/.sensitive-data', keys: ['ADMIN_EMAIL', 'ADMIN_PASSWORD'], added: ['ADMIN_EMAIL', 'ADMIN_PASSWORD'], repointed: 2 });
    const store = path.join(p, '.alfred', '.sensitive-data');
    assert.deepStrictEqual(dr.readSensitive({ projectDir: p }), { ADMIN_EMAIL: 'me@x.io', ADMIN_PASSWORD: 'pa55 w0rd' }, 'the values as written, quotes and all');
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(store).mode & 0o777, 0o600, 'a new store is the user\'s alone');
    assert.ok(fs.readFileSync(path.join(p, '.alfred', '.gitignore'), 'utf8').startsWith(dr.DATA_IGNORE_HEAD), 'the root ignores it');
    assert.ok(!fs.existsSync(path.join(CAP(p), 'credentials.local.env')));
    assert.strictEqual(fs.readFileSync(path.join(CAP(p), '.gitignore'), 'utf8'), 'credentials.local.env\n');
    const book = fs.readFileSync(path.join(CAP(p), 'PROJECT-CAPABILITIES.md'), 'utf8');
    assert.match(book, /Credentials live in: `\.alfred\/\.sensitive-data`, key `ADMIN_PASSWORD`/);
    assert.doesNotMatch(book, /credentials\.local\.env/);
    assert.deepStrictEqual(dr.adoptCredentials({ projectDir: p, check: IGNORED }).state, 'absent', 'a re-run finds nothing to move');
});

test('old credentials: an existing store keeps its lines; a key it holds with the same value is no clash, one with another value stops the move', () =>
{
    const p = fresh('adopt-append');
    oldCapture(p, { cred: 'ADMIN_EMAIL=me@x.io\r\nADMIN_PASSWORD=old\r\nADMIN_PASSWORD=pw2\r\n' });
    put(path.join(p, '.alfred', '.sensitive-data'), 'API_TOKEN=tok\nADMIN_EMAIL=me@x.io');
    const r = dr.adoptCredentials({ projectDir: p, check: IGNORED });
    assert.deepStrictEqual([r.state, r.added], ['moved', ['ADMIN_PASSWORD']], 'CRLF read; the later line for a key wins');
    assert.strictEqual(fs.readFileSync(path.join(p, '.alfred', '.sensitive-data'), 'utf8'),
        'API_TOKEN=tok\nADMIN_EMAIL=me@x.io\n# from .alfred/docs/project-capabilities/credentials.local.env, moved by the alfred-code installer\nADMIN_PASSWORD=pw2\n');
    const q = fresh('adopt-clash');
    oldCapture(q);
    put(path.join(q, '.alfred', '.sensitive-data'), 'ADMIN_PASSWORD=different\n');
    assert.deepStrictEqual(dr.adoptCredentials({ projectDir: q, check: IGNORED }), { state: 'clash', from: '.alfred/docs/project-capabilities/credentials.local.env', to: '.alfred/.sensitive-data', keys: ['ADMIN_PASSWORD'] });
    assert.strictEqual(fs.readFileSync(path.join(q, '.alfred', '.sensitive-data'), 'utf8'), 'ADMIN_PASSWORD=different\n', 'neither side touched');
    assert.ok(fs.existsSync(path.join(CAP(q), 'credentials.local.env')));
    assert.match(fs.readFileSync(path.join(CAP(q), 'PROJECT-CAPABILITIES.md'), 'utf8'), /credentials\.local\.env/, 'the run book still names where the values are');
});

test('old credentials: nothing moves into a store git would commit, a store that is a folder, or out of a file with no pairs', () =>
{
    const p = fresh('adopt-exposed');
    oldCapture(p);
    assert.strictEqual(dr.adoptCredentials({ projectDir: p, check: () => false }).state, 'exposed');
    assert.ok(fs.existsSync(path.join(CAP(p), 'credentials.local.env')) && !fs.existsSync(path.join(p, '.alfred', '.sensitive-data')));
    assert.strictEqual(dr.adoptCredentials({ projectDir: p, check: () => null }).state, 'moved', 'no repository: nothing to commit it to');
    const q = fresh('adopt-dir');
    oldCapture(q);
    fs.mkdirSync(path.join(q, '.alfred', '.sensitive-data'), { recursive: true });
    assert.strictEqual(dr.adoptCredentials({ projectDir: q, check: IGNORED }).state, 'blocked');
    const e = fresh('adopt-empty');
    oldCapture(e, { cred: '# nothing here\n\n' });
    assert.strictEqual(dr.adoptCredentials({ projectDir: e, check: IGNORED }).state, 'empty');
    assert.ok(fs.existsSync(path.join(CAP(e), 'credentials.local.env')), 'left as it is');
    assert.strictEqual(dr.adoptCredentials({ projectDir: fresh('adopt-none'), check: IGNORED }).state, 'absent');
});

test('old credentials: empty values carry as keys to fill; a custom docs root and data root; a UTF-16 store stays UTF-16', () =>
{
    const p = fresh('adopt-custom');
    oldCapture(p, { cred: 'APP_TEST_USER=\nAPP_TEST_PASSWORD=\n', docs: 'docs' });
    const r = dr.adoptCredentials({ projectDir: p, root: 'var/data', docsPath: 'docs', check: IGNORED });
    assert.deepStrictEqual([r.state, r.to, r.repointed], ['moved', 'var/data/.sensitive-data', 2]);
    assert.deepStrictEqual(dr.readSensitive({ projectDir: p, root: 'var/data' }), { APP_TEST_USER: '', APP_TEST_PASSWORD: '' });
    const w = fresh('adopt-utf16');
    oldCapture(w);
    put(path.join(w, '.alfred', '.sensitive-data'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('WIDE=one\r\n', 'utf16le')]));
    assert.strictEqual(dr.adoptCredentials({ projectDir: w, check: IGNORED }).state, 'moved');
    const buf = fs.readFileSync(path.join(w, '.alfred', '.sensitive-data'));
    assert.deepStrictEqual([buf[0], buf[1]], [0xff, 0xfe], 'still UTF-16 LE');
    assert.deepStrictEqual(dr.readSensitive({ projectDir: w }), { WIDE: 'one', ADMIN_EMAIL: 'me@x.io', ADMIN_PASSWORD: 'pa55 w0rd' });
});

// 2026-10-13 (the user's call): no shared browser folder - each engine's profile is <root>/<engine>-control. A
// profile 2.1.0-2.3.x kept in the root's own <root>/browser/<engine> is a relayout inside the root: a plan row the
// installer never offers, and the folder goes with its last engine.
test('relayout: a profile in the root\'s shared browser folder is a relayout row; a 2.0.0 place or another root\'s is a move', () =>
{
    const p = fresh('relayout-plan');
    put(path.join(p, '.alfred', 'browser', 'chrome', 'Cookies'));
    put(path.join(p, '.alfred', 'browser', 'firefox', 'prefs.js'));
    put(path.join(p, '.playwright', 'firefox', 'old.js'));       // the 2.0.0 place: the shared folder is read first
    put(path.join(p, '.playwright', 'webkit', 'x'));
    const rows = dr.dataMovePlan({ projectRoot: p, root: '.alfred', engines: ['chrome', 'firefox', 'webkit'] });
    assert.deepStrictEqual(rows, [
        { cls: 'chrome-control', from: '.alfred/browser/chrome', to: '.alfred/chrome-control', conflict: false },
        { cls: 'firefox-control', from: '.alfred/browser/firefox', to: '.alfred/firefox-control', conflict: false },
        { cls: 'webkit-control', from: '.playwright/webkit', to: '.alfred/webkit-control', conflict: false },
    ]);
    assert.deepStrictEqual(rows.map((r) => dr.isRelayout(r, '.alfred')), [true, true, false]);

    const q = fresh('relayout-prior');
    put(path.join(q, '.old', 'browser', 'chrome', 'Cookies'));
    const moved = dr.dataMovePlan({ projectRoot: q, root: '.alfred', prior: '.old', engines: ['chrome'] });
    assert.deepStrictEqual(moved, [{ cls: 'chrome-control', from: '.old/browser/chrome', to: '.alfred/chrome-control', conflict: false }]);
    assert.strictEqual(dr.isRelayout(moved[0], '.alfred'), false, 'a root change is the user\'s move to agree to');
    assert.strictEqual(dr.isRelayout({ cls: 'serena', from: '.alfred/browser/serena' }, '.alfred'), false, 'only an engine has a shared place');
});

test('relayout: the shared folder goes with its last engine, and stays while another engine or a file of the user\'s is there', () =>
{
    const p = fresh('relayout-move');
    put(path.join(p, '.alfred', 'browser', 'chrome', 'Cookies'), 'C');
    put(path.join(p, '.alfred', 'browser', 'firefox', 'prefs.js'), 'F');
    const shared = path.join(p, '.alfred', 'browser');
    assert.strictEqual(dr.movePlace({ projectDir: p, cls: 'chrome-control', from: '.alfred/browser/chrome', to: '.alfred/chrome-control' }).state, 'moved');
    assert.strictEqual(fs.readFileSync(path.join(p, '.alfred', 'chrome-control', 'Cookies'), 'utf8'), 'C');
    assert.ok(fs.existsSync(path.join(shared, 'firefox')), 'firefox has not moved yet');
    assert.strictEqual(dr.movePlace({ projectDir: p, cls: 'firefox-control', from: '.alfred/browser/firefox', to: '.alfred/firefox-control' }).state, 'moved');
    assert.ok(!fs.existsSync(shared), 'the last engine out clears the shared folder');

    const q = fresh('relayout-keep');
    put(path.join(q, '.alfred', 'browser', 'chrome', 'Cookies'));
    put(path.join(q, '.alfred', 'browser', 'notes.txt'), 'mine');
    dr.movePlace({ projectDir: q, cls: 'chrome-control', from: '.alfred/browser/chrome', to: '.alfred/chrome-control' });
    assert.strictEqual(fs.readFileSync(path.join(q, '.alfred', 'browser', 'notes.txt'), 'utf8'), 'mine', 'a folder that is not empty is never removed');

    const w = fresh('relayout-legacy');
    put(path.join(w, '.playwright', 'chrome', 'Cookies'));
    put(path.join(w, '.playwright', 'firefox', 'x'));
    dr.movePlace({ projectDir: w, cls: 'chrome-control', from: '.playwright/chrome', to: '.alfred/chrome-control' });
    assert.ok(fs.existsSync(path.join(w, '.playwright')), 'only the shared folder is cleared by a move');
});

test('relayout: a pending line an install before the rename wrote reads as the engine\'s move to its own folder', () =>
{
    const text = [
        'data-pending: browser-chrome .playwright/chrome -> .alfred/browser/chrome',
        'data-pending: browser-firefox .old/browser/firefox -> .data/browser/firefox',
        'data-pending: browser-opera .playwright/opera -> .alfred/browser/opera',
    ].join('\n');
    assert.deepStrictEqual(dr.readPending(text), [
        { cls: 'chrome-control', from: '.playwright/chrome', to: '.alfred/chrome-control' },
        { cls: 'firefox-control', from: '.old/browser/firefox', to: '.data/firefox-control' },
    ], 'an engine the stack never had stays dropped');
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
    const legacy = dr.liveDir({ projectDir: q, cls: 'chrome-control', root: '.alfred', pending: [] });
    assert.deepStrictEqual({ dir: legacy.dir, state: legacy.state }, { dir: '.playwright/chrome', state: 'legacy' });
    assert.ok(fs.existsSync(path.join(q, '.playwright', 'chrome', 'Cookies')), 'no answer, no move');
    assert.strictEqual(dr.liveDir({ projectDir: fresh('live-fresh'), cls: 'serena', root: '.alfred', pending: [] }).state, 'fresh');
});

test('live dir: with no pending line the root\'s shared folder serves before the 2.0.0 place; its relayout line moves it', () =>
{
    const p = fresh('live-shared');
    put(path.join(p, '.alfred', 'browser', 'chrome', 'Cookies'), 'S');
    put(path.join(p, '.playwright', 'chrome', 'Cookies'), 'L');
    const served = dr.liveDir({ projectDir: p, cls: 'chrome-control', root: '.alfred', pending: [] });
    assert.deepStrictEqual({ dir: served.dir, state: served.state }, { dir: '.alfred/browser/chrome', state: 'legacy' });
    const pending = [{ cls: 'chrome-control', from: '.alfred/browser/chrome', to: '.alfred/chrome-control' }];
    const got = dr.liveDir({ projectDir: p, cls: 'chrome-control', root: '.alfred', pending, busy: dr.profileLocks });
    assert.deepStrictEqual({ dir: got.dir, state: got.state }, { dir: '.alfred/chrome-control', state: 'moved' });
    assert.strictEqual(fs.readFileSync(path.join(p, '.alfred', 'chrome-control', 'Cookies'), 'utf8'), 'S');
    assert.ok(!fs.existsSync(path.join(p, '.alfred', 'browser')), 'the emptied shared folder is gone');
    assert.strictEqual(dr.liveDir({ projectDir: p, cls: 'chrome-control', root: '.alfred', pending }).state, 'current', 'a re-run finds it in place');
});

test('live dir: a browser profile a running browser holds stays put this start', () =>
{
    const p = fresh('live-busy');
    put(path.join(p, '.playwright', 'chrome', 'Cookies'));
    fs.symlinkSync('host-123', path.join(p, '.playwright', 'chrome', 'SingletonLock'));   // Chromium's lock: a dangling link
    const pending = [{ cls: 'chrome-control', from: '.playwright/chrome', to: '.alfred/chrome-control' }];
    const got = dr.liveDir({ projectDir: p, cls: 'chrome-control', root: '.alfred', pending, busy: dr.profileLocks });
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

// M5: the project memory folder's 2.0.0 place is linked back after its move, like the home folder - Cursor still
// reads <project>/.memory-mcp. Only that place: a server's other data, and a move between two roots of the stack's
// own, leave no link (a link would keep the old root from being pruned). A linked place is no data anywhere.
test('M5 live dir: a project memory move from .memory-mcp leaves a link; no other move does', { skip: process.platform === 'win32' && 'the junction case is Windows-only' }, () =>
{
    const p = fresh('live-mem-link');
    put(path.join(p, '.memory-mcp', 'memory.db'), 'PROJ');
    const pending = [{ cls: 'memory', from: '.memory-mcp', to: '.alfred/.alfred-memory' }];
    const got = dr.liveDir({ projectDir: p, cls: 'memory', root: '.alfred', pending, busy: dr.busyDbs });
    assert.deepStrictEqual({ dir: got.dir, state: got.state, linked: got.linked }, { dir: '.alfred/.alfred-memory', state: 'moved', linked: true });
    assert.ok(fs.lstatSync(path.join(p, '.memory-mcp')).isSymbolicLink());
    assert.strictEqual(fs.readFileSync(path.join(p, '.memory-mcp', 'memory.db'), 'utf8'), 'PROJ', 'the old path reads the moved file');
    assert.deepStrictEqual(dr.dataMovePlan({ projectRoot: p, root: '.alfred', memory: true }), [], 'a link is no data: nothing to offer, no clash');

    const q = fresh('live-serena-nolink');
    put(path.join(q, '.serena', 'project.yml'), 'P');
    dr.liveDir({ projectDir: q, cls: 'serena', root: '.alfred', pending: [{ cls: 'serena', from: '.serena', to: '.alfred/serena' }] });
    assert.ok(!fs.existsSync(path.join(q, '.serena')), 'serena leaves no link');

    const r = fresh('live-mem-root-change');
    put(path.join(r, '.alfred', '.alfred-memory', 'memory.db'), 'M');
    const moved = dr.liveDir({ projectDir: r, cls: 'memory', root: '.data', pending: [{ cls: 'memory', from: '.alfred/.alfred-memory', to: '.data/.alfred-memory' }] });
    assert.strictEqual(moved.state, 'moved');
    assert.ok(!fs.existsSync(path.join(r, '.alfred', '.alfred-memory')), 'a move between two roots leaves no link');
});

// M2: serena names each start's log after its own pid (`<home>/logs/<date>/mcp_<stamp>_<pid>.txt`, measured on
// serena 1.7.0), so a log whose pid is alive is a serena holding that folder - the running session's own on the
// copy route, or a second session's. No move while one does; a log of a process that has exited holds nothing.
test('M2 serena busy: a log named for a live serena pid holds the folder; an exited one, a reused pid or none does not', () =>
{
    const { spawnSync, spawn } = require('node:child_process');
    const p = fresh('serena-busy');
    put(path.join(p, '.serena', 'project.yml'), 'P');
    assert.deepStrictEqual(dr.serenaBusy(path.join(p, '.serena')), [], 'no logs: idle');
    const gone = spawnSync(process.execPath, ['-e', '0']).pid;
    put(path.join(p, '.serena', 'home', 'logs', '2026-09-28', `mcp_20260928-101010_${gone}.txt`), 'old');
    assert.deepStrictEqual(dr.serenaBusy(path.join(p, '.serena')), [], 'an exited serena holds nothing');
    const unrelated = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)', 'serena-agent'], { stdio: 'ignore' });
    try
    {
        if (process.platform !== 'win32')
        {
            put(path.join(p, '.serena', 'home', 'logs', '2026-09-27', `mcp_20260927-090909_${unrelated.pid}.txt`), 'reused pid');
            assert.deepStrictEqual(dr.serenaBusy(path.join(p, '.serena')), [], 'an old log whose pid now belongs to an unrelated process holds nothing');
        }
        put(path.join(p, '.serena', 'home', 'logs', '2026-09-29', `mcp_20260929-111111_${live.pid}.txt`), 'live');
        assert.deepStrictEqual(dr.serenaBusy(path.join(p, '.serena')), [`serena pid ${live.pid}`]);
        const pending = [{ cls: 'serena', from: '.serena', to: '.alfred/serena' }];
        const got = dr.liveDir({ projectDir: p, cls: 'serena', root: '.alfred', pending, busy: dr.serenaBusy });
        assert.deepStrictEqual({ dir: got.dir, state: got.state }, { dir: '.serena', state: 'busy' });
        assert.ok(fs.existsSync(path.join(p, '.serena', 'project.yml')) && !fs.existsSync(path.join(p, '.alfred')), 'nothing moved under a running serena');
    }
    finally { live.kill(); unrelated.kill(); }
});

// 2026-10-06 (Windows): `namesSerena` said yes for every live pid on win32, so a pid reused by any process held the
// folder for good ('Serena is not busy right now'). One query per platform now reads each pid's command line.
test('serena pids: the Windows query reads the command line, an empty one the image name; a failed query is busy', () =>
{
    const calls = [];
    const win = (stdout, status = 0) => (cmd, args) => { calls.push([cmd, args.join(' ')]); return { status, stdout }; };
    const rows = '101\tnode.exe\tnode server.js\r\n202\tpython.exe\tC:\\uv\\python.exe -m serena start-mcp-server\r\n303\tuvx.exe\t\r\n404\tchrome.exe\t\r\n';
    assert.deepStrictEqual([...dr.serenaPids([101, 202, 303, 404, 505], { platform: 'win32', run: win(rows) })].sort(), [202, 303]);
    assert.strictEqual(calls.length, 1, 'one query for every pid');
    assert.match(calls[0][1], /ProcessId=101 OR ProcessId=202 OR ProcessId=303 OR ProcessId=404 OR ProcessId=505/);
    assert.deepStrictEqual([...dr.serenaPids([7, 8], { platform: 'win32', run: win('', 1) })], [7, 8], 'a failed query is the safe side');
    assert.deepStrictEqual([...dr.serenaPids([7], { platform: 'win32', run: () => ({ error: new Error('ENOENT') }) })], [7]);
    assert.deepStrictEqual([...dr.serenaPids([], { platform: 'win32', run: () => { throw new Error('never called'); } })], []);
});

test('serena pids: POSIX reads one ps call and keeps only the pids whose command names serena', () =>
{
    const run = () => ({ status: 0, stdout: '  11 /usr/bin/uvx --from serena-agent serena start-mcp-server\n  12 /usr/bin/vim notes\n' });
    assert.deepStrictEqual([...dr.serenaPids([11, 12, 13], { platform: 'linux', run })], [11]);
    assert.deepStrictEqual([...dr.serenaPids([11], { platform: 'darwin', run: () => ({ status: null }) })], [11], 'a killed ps is busy');
});

test('serena busy: on Windows a reused pid whose process is not serena holds nothing', () =>
{
    const p = fresh('serena-busy-win');
    put(path.join(p, '.serena', 'home', 'logs', '2026-10-05', `mcp_20261005-101010_${process.ppid}.txt`), 'old');
    const run = () => ({ status: 0, stdout: `${process.ppid}\tcode.exe\tC:\\code.exe --type=renderer\r\n` });
    assert.deepStrictEqual(dr.serenaBusy(path.join(p, '.serena'), { platform: 'win32', run }), []);
    const serena = () => ({ status: 0, stdout: `${process.ppid}\tpython.exe\tpython -m serena\r\n` });
    assert.deepStrictEqual(dr.serenaBusy(path.join(p, '.serena'), { platform: 'win32', run: serena }), [`serena pid ${process.ppid}`]);
});

// Windows refuses fs.writeFileSync (CREATE_ALWAYS) over a HIDDEN file with EPERM - serena marks its own config and
// `.serena/.gitignore` hidden. writeText rewrites such a file in place instead.
test('writeText: an EPERM over an existing file is rewritten in place; a missing one still throws', () =>
{
    const p = fresh('write-text');
    const file = path.join(p, 'serena_config.yml');
    put(file, 'old text that is longer than the new one\n');
    const real = fs.writeFileSync;
    fs.writeFileSync = (f, ...rest) => { if (String(f) === file) { const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e; } return real(f, ...rest); };
    try
    {
        dr.writeText(file, 'new\r\n');
        assert.strictEqual(fs.readFileSync(file, 'utf8'), 'new\r\n', 'truncated, then written');
        fs.rmSync(file);
        assert.throws(() => dr.writeText(file, 'x'), /EPERM/, 'nothing to open in place');
    }
    finally { fs.writeFileSync = real; }
    const plain = path.join(p, 'plain.txt');
    dr.writeText(plain, 'a');
    assert.strictEqual(fs.readFileSync(plain, 'utf8'), 'a');
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
