'use strict';
// THE NAME: the marketplace key is read from what is registered (a registered key never changes),
// the core and the stamp under the one current spelling.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const brand = require('./install/brand.js');
const { marketKey, isCore, stampFile, alwaysOn, rowOn, BRAND } = brand;

test('the marketplace key follows the installed core, not the manifest name', () =>
{
    assert.equal(marketKey({ listing: [{ id: 'alfred-code@any-key', enabled: true }], marketplaces: [] }), 'any-key');
    assert.equal(marketKey({ listing: [], marketplaces: [{ name: 'envoydev', source: { repo: 'envoydev/alfred-code' } }] }), 'envoydev');
    assert.equal(marketKey({ listing: [], marketplaces: [] }), BRAND.marketplace);
});

test('both keys registered: the one carrying the installed core wins', () =>
{
    const marketplaces = [{ name: 'fork-key', source: { repo: 'envoydev/alfred-code' } }, { name: 'envoydev', source: { repo: 'envoydev/alfred-code' } }];
    assert.equal(marketKey({ listing: [{ id: 'alfred-code@envoydev', enabled: true }], marketplaces }), 'envoydev');
});

test('only the core name is the core', () =>
{
    assert.ok(isCore('alfred-code') && !isCore('alfred-code-hooks') && !isCore('serena'));
});

// 2.0.0 folds the hooks into the core: there is no hooks entry to name.
test('the hooks ride the core - no hooks entry name, and the core reads enabled whatever its flag', () =>
{
    assert.strictEqual(BRAND.hooks, undefined);
    assert.ok(!('isHooks' in brand));
    assert.ok(alwaysOn('alfred-code') && !alwaysOn('alfred-code-hooks') && !alwaysOn('serena'));
    assert.strictEqual(rowOn({ name: BRAND.core, enabled: false }), true, 'the core reads enabled whatever its flag (S22)');
    assert.strictEqual(rowOn({ name: 'serena', enabled: false }), false, 'any other row - its flag is just its flag');
});

test('the stamp is read and written as alfred-code.stamp, and no stamp at all reads as null', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
    try
    {
        assert.equal(stampFile(dir).read, null);
        assert.equal(stampFile(dir).write, path.join(dir, BRAND.stamp));
        assert.deepStrictEqual(Object.keys(stampFile(dir)).sort(), ['read', 'write']);
        fs.writeFileSync(path.join(dir, BRAND.stamp), 'new\n');
        assert.equal(stampFile(dir).read, path.join(dir, BRAND.stamp));
        assert.equal(path.basename(stampFile(dir).write), 'alfred-code.stamp');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the marketplace list rows are read in the shape the CLI prints them, git and github alike', () =>
{
    // `claude plugin marketplace list --json` (evidence S7): {name, source: 'git', url} for a git
    // source, {name, source: 'github', repo} for a github one - the KEY is `name`.
    assert.equal(marketKey({ listing: [], marketplaces: [{ name: 'old-key', source: 'github', repo: 'envoydev/alfred-code' }] }), 'old-key');
    assert.equal(marketKey({ listing: [], marketplaces: [{ name: 'k', source: 'git', url: 'https://github.com/envoydev/alfred-code.git' }] }), 'k');
    assert.equal(marketKey({ listing: [], marketplaces: [{ name: 'k', source: 'github', repo: 'someone/else' }] }), BRAND.marketplace);
    // Another repo registered beside it, no core installed: the current slug's key is the one used.
    const both = [{ name: 'other', source: 'github', repo: 'envoydev/other-repo' }, { name: 'envoydev', source: 'github', repo: 'envoydev/alfred-code' }];
    assert.equal(marketKey({ listing: [], marketplaces: both }), 'envoydev');
});

test('a directory marketplace matches by the MARKETPLACE setting', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-'));
    try
    {
        const rows = [{ name: 'local-key', source: 'directory', path: dir }];
        assert.equal(marketKey({ listing: [], marketplaces: rows, env: { ALFRED_CODE_MARKETPLACE: dir } }), 'local-key');
        assert.equal(marketKey({ listing: [], marketplaces: rows, env: { ALFRED_CODE_MARKETPLACE: '' } }), BRAND.marketplace, 'an empty setting is unset');
        assert.equal(marketKey({ listing: [], marketplaces: rows, env: {} }), BRAND.marketplace, 'a directory source nobody named is not ours');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an enabled core wins over a parked one, and a parsed listing row reads like a raw one', () =>
{
    const listing = [{ id: 'alfred-code@parked-key', enabled: false }, { id: 'alfred-code@live-key', enabled: true }];
    assert.equal(marketKey({ listing, marketplaces: [] }), 'live-key');
    assert.equal(marketKey({ listing: [{ name: 'alfred-code', marketplace: 'parsed-key', enabled: true }], marketplaces: [] }), 'parsed-key');
    assert.equal(marketKey({ listing: 'garbage', marketplaces: null }), BRAND.marketplace);
});

const { spawnSync } = require('node:child_process');
const SEED = path.join(__dirname, 'install', 'alfred-code.js');
const scrubbed = () => { const env = { ...process.env }; for (const k of Object.keys(env)) if (/^ALFRED_CODE_/.test(k)) delete env[k]; return env; };

test('the seed prints its usage on --help', () =>
{
    const seed = spawnSync(process.execPath, [SEED, '--help'], { encoding: 'utf8', env: scrubbed() });
    assert.match(seed.stderr, /Usage: node alfred-code\.js <install\|update\|uninstall>/);
});

// D1: the frozen twins are gone, so the seed refuses the shell route before it touches anything.
test('the shell seed is refused with one line and exit 1', () =>
{
    const want = 'the shell installers were removed in 2.0.0 - unset ALFRED_CODE_SEED to use the Node installer';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-d1-'));
    try
    {
        const r = spawnSync(process.execPath, [SEED, 'install', '--print-plan'], { cwd: dir, encoding: 'utf8', env: { ...scrubbed(), ALFRED_CODE_SEED: 'shell', HOME: dir, CLAUDE_CONFIG_DIR: path.join(dir, 'acct') } });
        assert.strictEqual(r.status, 1, `${r.stdout}${r.stderr}`);
        assert.strictEqual(r.stderr.trim(), want);
        assert.strictEqual(r.stdout, '', 'nothing ran before the refusal');
        assert.deepStrictEqual(fs.readdirSync(dir), [], 'the refusal wrote nothing');
        const node = spawnSync(process.execPath, [SEED, 'bogus'], { cwd: dir, encoding: 'utf8', env: { ...scrubbed(), ALFRED_CODE_SEED: 'node' } });
        assert.doesNotMatch(node.stderr, /shell installers were removed/, 'any other value is the Node seed');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The seed's own top-of-file comment described the PRE-D1 behavior (twins reachable behind the
// flag for one release) and was left stale when Phase 7b made the flag a hard refusal - the exact
// file and lines the D1 change itself sits in. Pin the header to what the code now does.
test('the seed header comment describes the D1 refusal, not the retired R1 fallback', () =>
{
    const header = fs.readFileSync(SEED, 'utf8').split('\n', 20).join('\n');
    assert.doesNotMatch(header, /stay reachable/, 'the header still claims the twins are reachable behind the flag');
    assert.doesNotMatch(header, /for one release \(R1\)/, 'the header still describes the retired R1 fallback window');
    assert.match(header, /removed in 2\.0\.0/, 'the header does not say the installers were removed');
});
