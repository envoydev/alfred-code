'use strict';
// secret-chain.js - the engine that reads, merges and masks the workspace chain's secret stores (release 2, T3, AC19).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const chain = require('../stack/hooks/secret-chain.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-chain-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const env0 = { CLAUDE_CONFIG_DIR: path.join(TMP, 'no-account'), ALFRED_CODE_WORKSPACE: '1' };   // the workspace is off until 3.0.0
// `spec` maps a folder to { file, store, storeName, data, local } - `file` the workspace file's text, `store` the store's
// text (or a Buffer), written as `storeName` (default .secrets) under `data` (default .alfred); `local` its
// settings.local.json. Every folder is stamped.
const tree = (spec) =>
{
    const top = fs.mkdtempSync(path.join(TMP, 't-'));
    for (const [rel, o] of Object.entries(spec))
    {
        const dir = path.join(top, ...rel.split('/'));
        const data = path.join(dir, ...(o.data || '.alfred').split('/'));
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'sha: x\n');
        fs.mkdirSync(data, { recursive: true });
        if (o.file !== undefined) fs.writeFileSync(path.join(data, 'workspace'), o.file);
        if (o.store !== undefined) fs.writeFileSync(path.join(data, o.storeName || '.secrets'), o.store);
        if (o.local !== undefined) fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), o.local);
    }
    return (rel = '.') => fs.realpathSync.native(path.join(top, ...rel.split('/')));
};
const three = (extra = {}) => tree({
    'ws': { file: 'child api\n', store: 'A=root-a\nB=root-b\n', ...extra.ws },
    'ws/api': { file: 'parent ..\nchild tool\n', store: 'A=child-a\n', ...extra.api },
    'ws/api/tool': { file: 'parent ..\n', ...extra.tool },
});

test('nearest value wins and the source is the nearest folder (AC19)', () =>
{
    const at = three();
    const got = chain.chainOf(at('ws/api'), { env: env0 });
    assert.deepStrictEqual(got.values, { A: 'child-a', B: 'root-b' });
    assert.deepStrictEqual(got.from, { A: '.', B: '..' });
    assert.deepStrictEqual(got.stores.map((s) => s.rel), ['.', '..']);
    assert.deepStrictEqual(got.notes, []);
    const tool = chain.chainOf(at('ws/api/tool'), { env: env0 });
    assert.deepStrictEqual(tool.values, { A: 'child-a', B: 'root-b' });
    assert.deepStrictEqual(tool.from, { A: '..', B: '../..' });
});

test('ignore secret drops an inherited key, never the project\'s own', () =>
{
    const at = three({ api: { file: 'parent ..\nchild tool\nignore secret B\nignore secret A\n' } });
    const got = chain.chainOf(at('ws/api'), { env: env0 });
    assert.deepStrictEqual(got.values, { A: 'child-a' }, 'B is gone, the child\'s own A stays');
    assert.deepStrictEqual(got.from, { A: '.' });
});

test('a grandchild loses what its parent ignores', () =>
{
    const at = three({ api: { file: 'parent ..\nchild tool\nignore secret B\n', store: 'C=child-c\n' } });
    const got = chain.chainOf(at('ws/api/tool'), { env: env0 });
    assert.deepStrictEqual(got.values, { A: 'root-a', C: 'child-c' }, 'A from the root (api has none now), no B');
    assert.deepStrictEqual(got.from, { A: '../..', C: '..' });
});

test('both file names are read, .secrets first', () =>
{
    const at = three({ ws: { store: 'B=legacy-b\n', storeName: '.sensitive-data' } });
    assert.deepStrictEqual(chain.chainOf(at('ws/api'), { env: env0 }).values, { A: 'child-a', B: 'legacy-b' });
    fs.writeFileSync(path.join(at('ws'), '.alfred', '.secrets'), 'B=new-b\n');
    assert.deepStrictEqual(chain.chainOf(at('ws/api'), { env: env0 }).values.B, 'new-b', '.secrets is read before .sensitive-data');
    const deny = chain.storesOf(at('ws/api'), { env: env0, forDeny: true }).map((s) => path.basename(s.file)).sort();
    assert.deepStrictEqual(deny, ['.secrets', '.secrets', '.sensitive-data'], 'a deny lists every store file of both names');
});

test('a parent\'s custom data root is found', () =>
{
    const at = three({ ws: { data: 'var/data', local: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: 'var/data' } }) } });
    const got = chain.chainOf(at('ws/api'), { env: env0 });
    assert.deepStrictEqual(got.values, { A: 'child-a', B: 'root-b' });
    assert.strictEqual(got.stores[1].file, path.join(at('ws'), 'var', 'data', '.secrets'));
    assert.strictEqual(got.stores[1].real, fs.realpathSync(path.join(at('ws'), 'var', 'data', '.secrets')));
});

test('UTF-16 and BOM stores read, an empty one and a folder named .secrets skipped, no throw', () =>
{
    const wide = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('W=wide-value\r\n', 'utf16le')]);
    const at = tree({
        'ws': { file: 'child api\n', store: wide },
        'ws/api': { file: 'parent ..\nchild tool\n', store: '\uFEFFBOM=bom-value\r\n' },
        'ws/api/tool': { file: 'parent ..\n', store: '' },
    });
    const got = chain.chainOf(at('ws/api/tool'), { env: env0 });
    assert.deepStrictEqual(got.values, { BOM: 'bom-value', W: 'wide-value' });
    fs.rmSync(path.join(at('ws/api'), '.alfred', '.secrets'));
    fs.mkdirSync(path.join(at('ws/api'), '.alfred', '.secrets'));
    const folder = chain.chainOf(at('ws/api/tool'), { env: env0 });
    assert.deepStrictEqual(folder.values, { W: 'wide-value' }, 'a folder named .secrets is no store');
    assert.ok(!folder.stores.some((s) => s.rel === '..'), 'nor listed');
});

test('the kill switch reads only the project\'s own store, and forDeny still lists the parent\'s', () =>
{
    const at = three({ api: { local: JSON.stringify({ env: { ALFRED_CODE_WORKSPACE: '0' } }) } });
    assert.deepStrictEqual(chain.chainOf(at('ws/api'), { env: env0 }).values, { A: 'child-a' });
    assert.deepStrictEqual(chain.storesOf(at('ws/api'), { env: env0 }).map((s) => s.rel), ['.']);
    assert.deepStrictEqual(chain.storesOf(at('ws/api'), { env: env0, forDeny: true }).map((s) => s.rel), ['.', '..']);
    assert.deepStrictEqual(chain.chainOf(at('ws/api'), { env: { ...env0, ALFRED_CODE_WORKSPACE: '0' } }).values, { A: 'child-a' }, 'env too');
});

test('the project\'s own store is found from a sub-folder and in a settings-only data root', () =>
{
    const at = three({ api: { data: '.kid', store: 'K=kid-value\n', local: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: '.kid' } }) } });
    fs.mkdirSync(path.join(at('ws/api'), '.git'));
    fs.mkdirSync(path.join(at('ws/api'), 'src', 'deep'), { recursive: true });
    fs.mkdirSync(path.join(at('ws/api'), '.kid'), { recursive: true });
    fs.writeFileSync(path.join(at('ws/api'), '.kid', 'workspace'), 'parent ..\n');
    const got = chain.chainOf(path.join(at('ws/api'), 'src', 'deep'), { env: env0 });
    assert.deepStrictEqual(got.values, { K: 'kid-value', A: 'root-a', B: 'root-b' });
});

test('masker shows <KEY> for values of 4+ characters, longest first', () =>
{
    const mask = chain.masker({ SHORT: 'abc', FOUR: 'abcd', LONG: 'abcdefgh', RE: 'a.b*c+(d)' });
    assert.strictEqual(mask('abc abcd abcdefgh a.b*c+(d) axbxc'), 'abc <FOUR> <LONG> <RE> axbxc');
    assert.strictEqual(chain.masker({ A: 'secret-value' }, 20)('secret-value'), 'secret-value', 'under min stays');
    assert.strictEqual(chain.masker({})('text'), 'text');
});

test('readStore is the guard\'s reader: export, quotes, comments, = in a value, CRLF', () =>
{
    const file = path.join(TMP, 'one.secrets');
    fs.writeFileSync(file, '\uFEFF# c\r\nexport A_ONE="quoted value"\r\nB_TWO=\'single\'\r\n  C_THREE = spaced  \r\nD_URL=postgres://u:p@h/db?x=1\r\nE_EMPTY=\r\n;not a key\r\n');
    assert.deepStrictEqual(chain.readStore(file), { A_ONE: 'quoted value', B_TWO: 'single', C_THREE: 'spaced', D_URL: 'postgres://u:p@h/db?x=1', E_EMPTY: '' });
    assert.deepStrictEqual(chain.readStore(path.join(TMP, 'absent')), {});
});

test('a broken chain reads the project alone and carries the chain\'s note', () =>
{
    const at = three({ ws: { file: '# no children\n' } });
    const got = chain.chainOf(at('ws/api'), { env: env0 });
    assert.deepStrictEqual(got.values, { A: 'child-a' });
    assert.strictEqual(got.notes.length, 1);
    assert.match(got.notes[0], /does not list this folder as a child/);
});
