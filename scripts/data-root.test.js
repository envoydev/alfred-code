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

// ------------------------------------------------------------------ the fixed root's reader (2026-11-11)
// The data root is always `.alfred`. The reader finds a folder an EARLIER release left elsewhere - from the old key in the
// project's two settings files and the stamp's `data-root:` line - so the installer can move it. It writes nothing.
const stampAt = (dir, text) => put(path.join(dir, '.claude', 'alfred-code.stamp'), text);
const KEY = (value) => ({ ALFRED_CODE_DATA_PATH: value });

test('fixed root reader: no key and no stamp line is .alfred, no source', () =>
{
    const p = fresh('reader-none');
    assert.deepStrictEqual(dr.dataRootOf({ projectDir: p }), { root: '.alfred', sources: [], refused: [], candidates: [] });
    assert.deepStrictEqual(dr.dataRootOf({}), { root: '.alfred', sources: [], refused: [], candidates: [] }, 'no project');
    put(path.join(p, 'var', 'data', 'docs', 'x.md'));
    assert.deepStrictEqual(dr.dataRootOf({ projectDir: p, env: KEY('var/data') }).sources, [], 'an env argument is ignored');
});

test('fixed root reader: each candidate alone names its folder when it holds a stack entry', () =>
{
    for (const from of ['settings.local.json', 'settings.json', 'stamp'])
    {
        const p = fresh('reader-one');
        put(path.join(p, 'var', 'data', 'docs', 'x.md'));
        if (from === 'stamp') stampAt(p, 'sha: abc\ndata-root: var/data\n');
        else settings(p, KEY('var/data'), from);
        const got = dr.dataRootOf({ projectDir: p });
        assert.strictEqual(got.root, 'var/data', from);
        assert.deepStrictEqual(got.sources, ['var/data'], from);
        assert.deepStrictEqual(got.candidates, [{ root: 'var/data', from }]);
    }
    const q = fresh('reader-stampfile');
    put(path.join(q, 'var', 'data', 'state', 's.json'));
    put(path.join(q, 'elsewhere.stamp'), 'data-root: var/data\n');
    assert.strictEqual(dr.dataRootOf({ projectDir: q, stampFile: path.join(q, 'elsewhere.stamp') }).root, 'var/data', 'a stamp file handed in');
});

test('fixed root reader: the order is local, shared, stamp', () =>
{
    const p = fresh('reader-order');
    for (const r of ['a', 'b', 'c']) put(path.join(p, r, 'docs', 'x.md'));
    settings(p, KEY('a'), 'settings.local.json');
    settings(p, KEY('b'));
    stampAt(p, 'data-root: c\n');
    const got = dr.dataRootOf({ projectDir: p });
    assert.deepStrictEqual(got.sources, ['a', 'b', 'c']);
    assert.strictEqual(got.root, 'a');
});

test('fixed root reader: a refused key is skipped and reported, with and without a stamp line', () =>
{
    for (const raw of ['../x', '/abs/data'])
    {
        const p = fresh('reader-refused');
        settings(p, KEY(raw));
        const alone = dr.dataRootOf({ projectDir: p });
        assert.strictEqual(alone.root, '.alfred');
        assert.deepStrictEqual(alone.refused, [{ raw, file: 'settings.json', why: dr.checkDataPath(raw).why }]);
        assert.deepStrictEqual(alone.candidates, []);
        put(path.join(p, 'var', 'data', 'docs', 'x.md'));
        stampAt(p, 'data-root: var/data\n');
        const withStamp = dr.dataRootOf({ projectDir: p });
        assert.strictEqual(withStamp.root, 'var/data', 'the stamp answers past a refused key');
        assert.strictEqual(withStamp.refused.length, 1);
    }
});

test('fixed root reader: a BOM is read, a malformed file says nothing', () =>
{
    const p = fresh('reader-bom');
    put(path.join(p, 'var', 'data', 'docs', 'x.md'));
    put(path.join(p, '.claude', 'settings.json'), `${String.fromCharCode(0xFEFF)}${JSON.stringify({ env: KEY('var/data') })}`);
    assert.strictEqual(dr.dataRootOf({ projectDir: p }).root, 'var/data');
    const q = fresh('reader-malformed');
    put(path.join(q, 'other', 'docs', 'x.md'));
    put(path.join(q, '.claude', 'settings.json'), '{ nope');
    put(path.join(q, '.claude', 'settings.local.json'), '');
    stampAt(q, 'data-root: other\n');
    const got = dr.dataRootOf({ projectDir: q });
    assert.deepStrictEqual(got.candidates, [{ root: 'other', from: 'stamp' }]);
    assert.strictEqual(got.root, 'other');
});

test('fixed root reader: an absent, an empty and a project-only folder are no source', () =>
{
    const rows = [
        ['absent', () => {}],
        ['empty', (p) => fs.mkdirSync(path.join(p, 'var', 'data'), { recursive: true })],
        ['a file of the project\'s own', (p) => put(path.join(p, 'var', 'data', 'notes.md'))],
        ['a .gitignore without the stack\'s header', (p) => put(path.join(p, 'var', 'data', '.gitignore'), '*.tmp\n')],
    ];
    for (const [label, build] of rows)
    {
        const p = fresh('reader-nosource');
        settings(p, KEY('var/data'));
        build(p);
        const got = dr.dataRootOf({ projectDir: p });
        assert.deepStrictEqual(got.sources, [], label);
        assert.strictEqual(got.root, '.alfred', label);
        assert.deepStrictEqual(got.candidates, [{ root: 'var/data', from: 'settings.json' }], label);
    }
});

test('fixed root reader: a folder holding only the stack\'s .gitignore is a source', () =>
{
    const p = fresh('reader-ignore-only');
    settings(p, KEY('var/data'));
    put(path.join(p, 'var', 'data', '.gitignore'), `${dr.DATA_IGNORE_HEAD}\n*\n!/.gitignore\n`);
    assert.deepStrictEqual(dr.dataRootOf({ projectDir: p }).sources, ['var/data']);
    assert.deepStrictEqual(dr.stackEntries(path.join(p, 'var', 'data')), ['.gitignore']);
    assert.deepStrictEqual(dr.stackEntries(path.join(p, 'nowhere')), []);
});

// Review C1: the one-time move leaves an older folder its ignore file where the folder keeps entries of its own, so they
// stay out of git. That folder holds no data of the stack's any more - nothing may read it as the data root again.
test('fixed root reader: the stack\'s .gitignore beside only the project\'s own entries is no source', () =>
{
    const p = fresh('reader-ignore-kept');
    settings(p, KEY('var/data'));
    put(path.join(p, 'var', 'data', '.gitignore'), `${dr.DATA_IGNORE_HEAD}\n/*\n!/.gitignore\n`);
    put(path.join(p, 'var', 'data', 'chrome-control', 'Default', 'Cookies'));
    const got = dr.dataRootOf({ projectDir: p });
    assert.deepStrictEqual([got.sources, got.root], [[], '.alfred']);
    put(path.join(p, 'var', 'data', 'state', 'x.json'), '{}\n');
    assert.deepStrictEqual(dr.dataRootOf({ projectDir: p }).sources, ['var/data'], 'one entry of the stack\'s beside them makes it a source again');
});

test('fixed root reader: .Alfred on a case-insensitive disk and a key naming a .alfred link\'s target are .alfred', (t) =>
{
    const linked = fresh('reader-link');
    put(path.join(linked, 'store', 'real', 'docs', 'x.md'));
    try { fs.symlinkSync(path.join(linked, 'store', 'real'), path.join(linked, '.alfred'), 'junction'); }
    catch (err) { t.diagnostic(`no link on this disk (${err.code})`); return; }
    settings(linked, KEY('store/real'));
    const got = dr.dataRootOf({ projectDir: linked });
    assert.deepStrictEqual(got.sources, [], 'the link\'s target is .alfred');
    assert.strictEqual(got.root, '.alfred');
    const p = fresh('reader-case');
    put(path.join(p, '.alfred', 'docs', 'x.md'));
    if (!fs.existsSync(path.join(p, '.Alfred'))) { t.diagnostic('a case-sensitive disk: the case half is skipped'); return; }
    settings(p, KEY('.Alfred'));
    assert.deepStrictEqual(dr.dataRootOf({ projectDir: p }).sources, [], '.Alfred is .alfred here');
});

test('fixed root reader: two candidates that both hold data are two sources', () =>
{
    const p = fresh('reader-two');
    put(path.join(p, 'var', 'a', 'docs', 'x.md'));
    put(path.join(p, 'var', 'b', '.variables'), 'K=v\n');
    settings(p, KEY('var/a'));
    stampAt(p, 'data-root: var/b\n');
    assert.deepStrictEqual(dr.dataRootOf({ projectDir: p }).sources, ['var/a', 'var/b']);
    const same = fresh('reader-same');
    put(path.join(same, 'var', 'a', 'docs', 'x.md'));
    settings(same, KEY('var/a'));
    settings(same, KEY('./var/a/'), 'settings.local.json');
    stampAt(same, 'data-root: var/a\n');
    assert.deepStrictEqual(dr.dataRootOf({ projectDir: same }).sources, ['var/a'], 'one folder named three times is one source');
});

test('fixed root reader: readRootLine and stamp.readDataLines agree', () =>
{
    const stampLayer = require('./install/stamp.js');
    for (const [text, want] of [['sha: a\ndata-root: var/data\n', 'var/data'], ['data-root: ../out\n', ''], ['data-root: .claude/x\n', ''], ['sha: a\n', ''], ['', '']])
    {
        const p = fresh('reader-line');
        stampAt(p, text);
        assert.strictEqual(dr.readRootLine(text), want, text);
        assert.strictEqual(stampLayer.readDataLines(path.join(p, '.claude', 'alfred-code.stamp')).root, want, text);
    }
});

// ------------------------------------------------------------------ the move plan

test('pending lines: an older stamp\'s line is read back; a server\'s line, a malformed or foreign line is dropped', () =>
{
    const rows = [{ cls: 'sensitive', from: '.alfred/.sensitive-data', to: 'var/data/.sensitive-data' }];
    const text = 'sha: abc\ndata-pending: sensitive .alfred/.sensitive-data -> var/data/.sensitive-data\n'
        + 'data-pending: serena .serena -> .alfred/serena\ndata-pending: chrome-control .playwright/chrome -> .alfred/chrome-control\n'
        + 'data-pending: rm -rf / -> x\ndata-pending: sensitive ../out/.sensitive-data -> .alfred/.sensitive-data\n';
    assert.deepStrictEqual(dr.readPending(text), rows);
});

// ------------------------------------------------------------------ the project's sensitive data (2026-10-13)

test('sensitive data: its place is <root>/.secrets, no server class has one, and a pending line is read back', () =>
{
    assert.strictEqual(dr.targetOf('sensitive', '.data'), '.data/.secrets');
    for (const cls of ['serena', 'memory', 'chrome-control', 'browser']) assert.strictEqual(dr.targetOf(cls, '.data'), null, `${cls} has no place`);
    assert.deepStrictEqual(dr.readPending('data-pending: sensitive .alfred/.sensitive-data -> .data/.sensitive-data\n'),
        [{ cls: 'sensitive', from: '.alfred/.sensitive-data', to: '.data/.sensitive-data' }]);
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
});

test('phase 1 writes no .secrets beside an old .sensitive-data: ensure and adopt keep the found name (item 3)', () =>
{
    const dir = fresh('secrets-phase1');
    put(path.join(dir, '.alfred', '.sensitive-data'), 'K=v\n');
    assert.strictEqual(dr.ensureSensitiveFile({ projectDir: dir, check: () => true }), 'present');
    assert.ok(!fs.existsSync(path.join(dir, '.alfred', '.secrets')));
    put(path.join(dir, '.alfred', 'docs', 'project-capabilities', 'credentials.local.env'), 'T=1\n');
    assert.strictEqual(dr.adoptCredentials({ projectDir: dir, check: () => true }).to, '.alfred/.sensitive-data');
    assert.ok(!fs.existsSync(path.join(dir, '.alfred', '.secrets')));
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

// The project split (spec 2026-10-29 section 3, Review Focus 5): the run book is RUN-AND-DEBUG-AWARENESS.md now, its old
// name still read for an install not yet updated; the user's own awareness file never reaches git.
test('the credentials re-point reaches the renamed run book', () =>
{
    const dir = fresh('secrets-repoint-renamed');
    const book = path.join(dir, 'team-docs', 'awareness', 'RUN-AND-DEBUG-AWARENESS.md');
    const old = path.join(dir, 'team-docs', 'awareness', 'PROJECT-AWARENESS.md');
    put(book, 'Credentials live in: `.alfred/.sensitive-data`, key `API_KEY`\n');
    put(old, 'Credentials live in: `.alfred/.sensitive-data`, key `API_KEY`\n');
    put(path.join(dir, '.alfred', '.secrets'), 'K=v\n');
    assert.strictEqual(dr.repointRunBooks({ projectDir: dir, docsPath: 'team-docs', root: '.alfred' }), 2);
    assert.match(fs.readFileSync(book, 'utf8'), /`\.alfred\/\.secrets`/, 'the renamed run book');
    assert.match(fs.readFileSync(old, 'utf8'), /`\.alfred\/\.secrets`/, 'the old name is still re-pointed');
    assert.ok(dr.DOCS_STATE_IGNORE.includes('/awareness/USER-AWARENESS.md'), 'the user\'s own notes stay out of git');
});

test('old credentials: the renamed run book is re-pointed too', () =>
{
    const p = fresh('adopt-renamed');
    oldCapture(p);
    const runBook = path.join(p, '.alfred', 'docs', 'awareness', 'RUN-AND-DEBUG-AWARENESS.md');
    fs.mkdirSync(path.dirname(runBook), { recursive: true });
    fs.renameSync(path.join(CAP(p), 'PROJECT-CAPABILITIES.md'), runBook);
    const r = dr.adoptCredentials({ projectDir: p, check: IGNORED });
    assert.deepStrictEqual([r.state, r.repointed], ['moved', 2]);
    const text = fs.readFileSync(runBook, 'utf8');
    assert.match(text, /Credentials live in: `\.alfred\/\.secrets`, key `ADMIN_PASSWORD`/);
    assert.doesNotMatch(text, /credentials\.local\.env/);
});
