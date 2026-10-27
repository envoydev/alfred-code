'use strict';
// THE PROJECT DATA ROOT (stack/mcp/data-root.js) - one folder, `.alfred` by default, for what the stack keeps for a
// project: the docs, the hooks' state and statistics and the project's sensitive data. One module answers where each
// lives, so the installer, init's plan and the hooks can never disagree. The stack ships no MCP server since 2.10.1, so
// what an older release's servers left under the root is no row of any plan here.
//
// Every case builds its own tree under a temp dir.
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

// ------------------------------------------------------------------ the move plan

test('move plan: only the sensitive-data file moves, and only on a root change - an older release\'s server data is no row', () =>
{
    const p = fresh('plan');
    put(path.join(p, '.serena', 'project.yml'), 'project_name: app');
    put(path.join(p, '.playwright', 'chrome', 'Default', 'Cookies'));
    put(path.join(p, '.alfred', 'serena', 'project.yml'));
    put(path.join(p, '.alfred', 'firefox-control', 'prefs.js'));
    put(path.join(p, '.memory-mcp', 'memory.db'));
    put(path.join(p, '.alfred', '.sensitive-data'), 'K=v\n');
    assert.deepStrictEqual(dr.dataMovePlan({ projectRoot: p, root: '.alfred' }), [], 'no prior root: nothing moves');
    assert.deepStrictEqual(dr.dataMovePlan({ projectRoot: p, root: '.alfred', prior: '.alfred' }), [], 'the same root: nothing moves');
    assert.deepStrictEqual(dr.dataMovePlan({ projectRoot: p, root: '.data', prior: '.alfred' }),
        [{ cls: 'sensitive', from: '.alfred/.sensitive-data', to: '.data/.sensitive-data', conflict: false }]);
    for (const cls of ['serena', 'memory', 'chrome-control', 'browser']) assert.strictEqual(dr.targetOf(cls, '.data'), null, `${cls} has no place`);
    assert.strictEqual(dr.movePlace({ projectDir: p, cls: 'serena', from: '.serena', to: '.data/serena' }).state, 'absent', 'a server\'s folder is never moved');
    assert.ok(fs.existsSync(path.join(p, '.serena', 'project.yml')));
});

test('pending lines: rendered and read back; a server\'s line an older release wrote, a malformed or foreign line is dropped', () =>
{
    const rows = [{ cls: 'sensitive', from: '.alfred/.sensitive-data', to: 'var/data/.sensitive-data' }];
    const text = `sha: abc\n${dr.renderPending(rows).join('\n')}\n`
        + 'data-pending: serena .serena -> .alfred/serena\ndata-pending: chrome-control .playwright/chrome -> .alfred/chrome-control\n'
        + 'data-pending: rm -rf / -> x\ndata-pending: sensitive ../out/.sensitive-data -> .alfred/.sensitive-data\n';
    assert.deepStrictEqual(dr.readPending(text), rows);
});

// ------------------------------------------------------------------ the project's sensitive data (2026-10-13)

test('sensitive data: its place is <root>/.secrets (an old <root>/.sensitive-data read too); a root change moves the file and nothing else does', () =>
{
    assert.strictEqual(dr.targetOf('sensitive', '.data'), '.data/.secrets');
    assert.strictEqual(dr.rootOfPlace('sensitive', 'var/data/.sensitive-data'), 'var/data');
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

// The capture's credentials file before 2026-10-13 moves into the store (the user's call: one credential home, by update).
const CAP = (p, docs = '.alfred/docs') => path.join(p, ...docs.split('/'), 'project-capabilities');
const IGNORED = () => true;
// The store's pairs as the installer reads them - UTF-16 LE behind its BOM, else UTF-8 - the values unquoted.
function storeOf(p, root = '.alfred')
{
    return dr.storeValues(fs.readFileSync(path.join(p, ...root.split('/'), (dr.findSecretsFile(p, root) || { name: dr.SECRETS_FILE }).name)));
}
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
    assert.deepStrictEqual(r, { state: 'moved', from: '.alfred/docs/project-capabilities/credentials.local.env', to: '.alfred/.secrets', keys: ['ADMIN_EMAIL', 'ADMIN_PASSWORD'], added: ['ADMIN_EMAIL', 'ADMIN_PASSWORD'], repointed: 2 });
    const store = path.join(p, '.alfred', '.secrets');
    assert.deepStrictEqual(storeOf(p), { ADMIN_EMAIL: 'me@x.io', ADMIN_PASSWORD: 'pa55 w0rd' }, 'the values as written, quotes and all');
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(store).mode & 0o777, 0o600, 'a new store is the user\'s alone');
    assert.ok(fs.readFileSync(path.join(p, '.alfred', '.gitignore'), 'utf8').startsWith(dr.DATA_IGNORE_HEAD), 'the root ignores it');
    assert.ok(!fs.existsSync(path.join(CAP(p), 'credentials.local.env')));
    assert.strictEqual(fs.readFileSync(path.join(CAP(p), '.gitignore'), 'utf8'), 'credentials.local.env\n');
    const book = fs.readFileSync(path.join(CAP(p), 'PROJECT-CAPABILITIES.md'), 'utf8');
    assert.match(book, /Credentials live in: `\.alfred\/\.secrets`, key `ADMIN_PASSWORD`/);
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
    assert.ok(fs.existsSync(path.join(CAP(p), 'credentials.local.env')) && !fs.existsSync(path.join(p, '.alfred', '.secrets')));
    assert.strictEqual(dr.adoptCredentials({ projectDir: p, check: () => null }).state, 'moved', 'no repository: nothing to commit it to');
    const q = fresh('adopt-dir');
    oldCapture(q);
    fs.mkdirSync(path.join(q, '.alfred', '.secrets'), { recursive: true });
    assert.strictEqual(dr.adoptCredentials({ projectDir: q, check: IGNORED }).state, 'blocked', 'a folder under the name a new store takes');
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
    assert.deepStrictEqual([r.state, r.to, r.repointed], ['moved', 'var/data/.secrets', 2]);
    assert.deepStrictEqual(storeOf(p, 'var/data'), { APP_TEST_USER: '', APP_TEST_PASSWORD: '' });
    const w = fresh('adopt-utf16');
    oldCapture(w);
    put(path.join(w, '.alfred', '.sensitive-data'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('WIDE=one\r\n', 'utf16le')]));
    assert.strictEqual(dr.adoptCredentials({ projectDir: w, check: IGNORED }).state, 'moved');
    const buf = fs.readFileSync(path.join(w, '.alfred', '.sensitive-data'));
    assert.deepStrictEqual([buf[0], buf[1]], [0xff, 0xfe], 'still UTF-16 LE');
    assert.deepStrictEqual(storeOf(w), { WIDE: 'one', ADMIN_EMAIL: 'me@x.io', ADMIN_PASSWORD: 'pa55 w0rd' });
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

test('secrets file: .secrets first, .sensitive-data second, a folder is neither (item 3)', () =>
{
    const dir = fresh('secrets-find');
    assert.strictEqual(dr.findSecretsFile(dir, '.alfred'), null);
    fs.mkdirSync(path.join(dir, '.alfred', '.secrets'), { recursive: true });
    assert.strictEqual(dr.findSecretsFile(dir, '.alfred'), null, 'a folder under the new name is no store');
    put(path.join(dir, '.alfred', '.sensitive-data'), 'K=v\n');
    assert.deepStrictEqual(dr.findSecretsFile(dir, '.alfred'), { rel: '.alfred/.sensitive-data', name: '.sensitive-data' });
    fs.rmSync(path.join(dir, '.alfred', '.secrets'), { recursive: true });
    put(path.join(dir, '.alfred', '.secrets'), 'K=v\n');
    assert.strictEqual(dr.findSecretsFile(dir, '.alfred').name, '.secrets');
    assert.strictEqual(dr.targetOf('sensitive', '.alfred'), '.alfred/.secrets');
    assert.strictEqual(dr.rootOfPlace('sensitive', '.data/.sensitive-data'), '.data');
    assert.strictEqual(dr.rootOfPlace('sensitive', '.data/.secrets'), '.data');
});

test('phase 1 writes no .secrets beside an old .sensitive-data: ensure, adopt and the move keep the found name (item 3)', () =>
{
    const dir = fresh('secrets-phase1');
    put(path.join(dir, '.alfred', '.sensitive-data'), 'K=v\n');
    assert.strictEqual(dr.ensureSensitiveFile({ projectDir: dir, check: () => true }), 'present');
    assert.ok(!fs.existsSync(path.join(dir, '.alfred', '.secrets')));
    put(path.join(dir, '.alfred', 'docs', 'project-capabilities', 'credentials.local.env'), 'T=1\n');
    assert.strictEqual(dr.adoptCredentials({ projectDir: dir, check: () => true }).to, '.alfred/.sensitive-data');
    assert.ok(!fs.existsSync(path.join(dir, '.alfred', '.secrets')));
    assert.deepStrictEqual(dr.dataMovePlan({ projectRoot: dir, root: '.data', prior: '.alfred' }),
        [{ cls: 'sensitive', from: '.alfred/.sensitive-data', to: '.data/.sensitive-data', conflict: false }]);
    const empty = fresh('secrets-none');
    assert.strictEqual(dr.ensureSensitiveFile({ projectDir: empty, check: () => true }), 'written');
    assert.ok(fs.existsSync(path.join(empty, '.alfred', '.secrets')));
});

test('renameSecrets: renames where git ignores the new name, refuses both / exposed / blocked (item 3)', () =>
{
    const dir = fresh('secrets-rename');
    put(path.join(dir, '.alfred', '.sensitive-data'), 'K=v\n');
    assert.strictEqual(dr.renameSecrets({ projectDir: dir, roots: ['.alfred'], check: () => true })[0].state, 'renamed');
    assert.strictEqual(fs.readFileSync(path.join(dir, '.alfred', '.secrets'), 'utf8'), 'K=v\n');
    assert.ok(!fs.existsSync(path.join(dir, '.alfred', '.sensitive-data')));
    put(path.join(dir, '.alfred', '.sensitive-data'), 'X=y\n');
    assert.strictEqual(dr.renameSecrets({ projectDir: dir, roots: ['.alfred'], check: () => true })[0].state, 'both');
    assert.strictEqual(fs.readFileSync(path.join(dir, '.alfred', '.sensitive-data'), 'utf8'), 'X=y\n', 'neither file changes');
    const open = fresh('secrets-exposed');
    put(path.join(open, '.alfred', '.sensitive-data'), 'K=v\n');
    assert.strictEqual(dr.renameSecrets({ projectDir: open, roots: ['.alfred'], check: () => false })[0].state, 'exposed');
    assert.ok(fs.existsSync(path.join(open, '.alfred', '.sensitive-data')));
    const folder = fresh('secrets-folder');
    put(path.join(folder, '.alfred', '.sensitive-data'), 'K=v\n');
    fs.mkdirSync(path.join(folder, '.alfred', '.secrets'));
    assert.strictEqual(dr.renameSecrets({ projectDir: folder, roots: ['.alfred'], check: () => true })[0].state, 'blocked');
    assert.strictEqual(dr.renameSecrets({ projectDir: fresh('secrets-empty'), roots: ['.alfred'], check: () => true })[0].state, 'none');
});

test('repointRunBooks: both run-book line shapes under the given docs root, never another path or a store not renamed (item 3)', () =>
{
    const dir = fresh('secrets-repoint');
    const book = path.join(dir, 'team-docs', 'awareness', 'PROJECT-AWARENESS.md');
    put(book, 'Credentials live in: `.alfred/.sensitive-data`, key `API_KEY`\nCredentials: keys in .alfred/.sensitive-data, ignored: yes\nSee also notes/.sensitive-data-howto.md\n');
    put(path.join(dir, '.alfred', '.sensitive-data'), 'K=v\n');
    assert.strictEqual(dr.repointRunBooks({ projectDir: dir, docsPath: 'team-docs', root: '.alfred' }), 0, 'not renamed yet: nothing moves');
    fs.renameSync(path.join(dir, '.alfred', '.sensitive-data'), path.join(dir, '.alfred', '.secrets'));
    assert.strictEqual(dr.repointRunBooks({ projectDir: dir, docsPath: 'team-docs', root: '.alfred' }), 2);
    const text = fs.readFileSync(book, 'utf8');
    assert.match(text, /Credentials live in: `\.alfred\/\.secrets`/);
    assert.match(text, /keys in \.alfred\/\.secrets, ignored/);
    assert.match(text, /notes\/\.sensitive-data-howto\.md/, 'a path under another folder is not the store');
    assert.strictEqual(dr.repointRunBooks({ projectDir: dir, docsPath: 'team-docs', root: '.alfred' }), 0, 'a second run changes nothing');
});
