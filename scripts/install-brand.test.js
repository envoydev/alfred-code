'use strict';
// THE NAME, read under either spelling. 2.0.0 renamed the stack, but a 1.x install keeps its
// marketplace KEY (a registered key never changes), its stamp and its seat denies until an update
// rewrites them - so every read takes the old spelling as well, and every write the new one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const brand = require('./install/brand.js');
const { marketKey, isCore, currentName, stampFile, alwaysOn, rowOn, BRAND, LEGACY } = brand;

test('the marketplace key follows the installed core, not the manifest name', () =>
{
    assert.equal(marketKey({ listing: [{ id: 'alfred-code@claude-stack', enabled: true }], marketplaces: [] }), 'claude-stack'); // legacy-name
    assert.equal(marketKey({ listing: [{ id: 'claude-stack@claude-stack', enabled: true }], marketplaces: [] }), 'claude-stack'); // legacy-name
    assert.equal(marketKey({ listing: [], marketplaces: [{ name: 'envoydev', source: { repo: 'envoydev/alfred-code' } }] }), 'envoydev');
    assert.equal(marketKey({ listing: [], marketplaces: [] }), BRAND.marketplace);
});

test('both keys registered: the one carrying the installed core wins', () =>
{
    const marketplaces = [{ name: 'claude-stack', source: { repo: 'envoydev/claude-stack' } }, { name: 'envoydev', source: { repo: 'envoydev/alfred-code' } }]; // legacy-name
    assert.equal(marketKey({ listing: [{ id: 'alfred-code@envoydev', enabled: true }], marketplaces }), 'envoydev');
});

test('either core spelling is the core', () =>
{
    assert.ok(isCore('alfred-code') && isCore('claude-stack') && !isCore('serena')); // legacy-name
});

// 2.0.0 folds the hooks into the core: there is no current hooks entry to name, and the 1.x hooks id
// is kept only for the migration's uninstall (plugins.migrateLegacy).
test('the hooks ride the core - no hooks entry name, the 1.x one kept for the uninstall', () =>
{
    assert.strictEqual(BRAND.hooks, undefined);
    assert.ok(!('isHooks' in brand));
    assert.strictEqual(LEGACY.hooks, 'claude-stack-hooks'); // legacy-name
    assert.ok(alwaysOn('alfred-code') && alwaysOn(LEGACY.core) && !alwaysOn(LEGACY.hooks) && !alwaysOn('alfred-code-hooks'));
    assert.strictEqual(rowOn({ name: LEGACY.core, enabled: false }), true, 'the core reads enabled whatever its flag (S22)');
    assert.strictEqual(rowOn({ name: LEGACY.hooks, enabled: false }), false, 'the hooks alias carries nothing - its flag is just its flag');
});

test('the stamp is read under either name and written under the new one', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
    fs.writeFileSync(path.join(dir, 'claude-stack.stamp'), 'x\n'); // legacy-name
    const s = stampFile(dir);
    assert.equal(path.basename(s.read), 'claude-stack.stamp'); // legacy-name
    assert.equal(path.basename(s.write), 'alfred-code.stamp');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('the new stamp wins when both exist, and no stamp at all reads as null', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
    try
    {
        assert.equal(stampFile(dir).read, null);
        assert.equal(stampFile(dir).write, path.join(dir, BRAND.stamp));
        fs.writeFileSync(path.join(dir, LEGACY.stamp), 'old\n');
        fs.writeFileSync(path.join(dir, BRAND.stamp), 'new\n');
        assert.equal(stampFile(dir).read, path.join(dir, BRAND.stamp));
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the marketplace list rows are read in the shape the CLI prints them, git and github alike', () =>
{
    // `claude plugin marketplace list --json` (evidence S7): {name, source: 'git', url} for a git
    // source, {name, source: 'github', repo} for a github one - the KEY is `name`.
    assert.equal(marketKey({ listing: [], marketplaces: [{ name: 'old-key', source: 'github', repo: 'envoydev/claude-stack' }] }), 'old-key'); // legacy-name
    assert.equal(marketKey({ listing: [], marketplaces: [{ name: 'k', source: 'git', url: 'https://github.com/envoydev/claude-stack.git' }] }), 'k'); // legacy-name
    assert.equal(marketKey({ listing: [], marketplaces: [{ name: 'k', source: 'github', repo: 'someone/else' }] }), BRAND.marketplace);
    // Both registered, no core installed: the current slug's key is the one a fresh install uses.
    const both = [{ name: 'claude-stack', source: 'github', repo: 'envoydev/claude-stack' }, { name: 'envoydev', source: 'github', repo: 'envoydev/alfred-code' }]; // legacy-name
    assert.equal(marketKey({ listing: [], marketplaces: both }), 'envoydev');
});

test('a directory marketplace matches by the MARKETPLACE setting, under either prefix', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-'));
    try
    {
        const rows = [{ name: 'local-key', source: 'directory', path: dir }];
        assert.equal(marketKey({ listing: [], marketplaces: rows, env: { ALFRED_CODE_MARKETPLACE: dir } }), 'local-key');
        assert.equal(marketKey({ listing: [], marketplaces: rows, env: { CLAUDE_STACK_MARKETPLACE: dir } }), 'local-key'); // legacy-name
        assert.equal(marketKey({ listing: [], marketplaces: rows, env: {} }), BRAND.marketplace, 'a directory source nobody named is not ours');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an enabled core wins over a parked one, and a parsed listing row reads like a raw one', () =>
{
    const listing = [{ id: 'alfred-code@parked-key', enabled: false }, { id: 'alfred-code@live-key', enabled: true }];
    assert.equal(marketKey({ listing, marketplaces: [] }), 'live-key');
    assert.equal(marketKey({ listing: [{ name: 'claude-stack', marketplace: 'claude-stack', enabled: true }], marketplaces: [] }), 'claude-stack'); // legacy-name
    assert.equal(marketKey({ listing: 'garbage', marketplaces: null }), BRAND.marketplace);
});

test('currentName maps only the core - the hooks alias and a retired per-stack entry keep their names', () =>
{
    assert.equal(currentName('claude-stack'), 'alfred-code'); // legacy-name
    assert.equal(currentName('claude-stack-hooks'), 'claude-stack-hooks'); // legacy-name
    assert.equal(currentName('claude-stack-dotnet'), 'claude-stack-dotnet'); // legacy-name
    assert.equal(currentName('serena'), 'serena');
});

// A 1.x command body still runs `scripts/install/claude-stack.js` against a 2.0.0 snapshot (Review // legacy-name
// Focus 1): the old path is a shim that runs the renamed entry, same output, same exit code.
const { spawnSync } = require('node:child_process');
const SEED = path.join(__dirname, 'install', 'alfred-code.js');
const SHIM = path.join(__dirname, 'install', `${LEGACY.core}.js`);
const scrubbed = () => { const env = { ...process.env }; for (const k of Object.keys(env)) if (/^(ALFRED_CODE|CLAUDE_STACK)_/.test(k)) delete env[k]; return env; }; // legacy-name

test('the 1.x entry path is a shim - --help prints the same usage and exits the same way', () =>
{
    const env = scrubbed();
    const seed = spawnSync(process.execPath, [SEED, '--help'], { encoding: 'utf8', env });
    const shim = spawnSync(process.execPath, [SHIM, '--help'], { encoding: 'utf8', env });
    assert.match(seed.stderr, /Usage: node alfred-code\.js <install\|update>/);
    assert.deepStrictEqual([shim.status, shim.stdout, shim.stderr], [seed.status, seed.stdout, seed.stderr]);
});

// D1: the frozen twin hardcodes the 1.x names a 2.0.0 registration cannot resolve, so the seed refuses
// the shell route under either spelling of the setting, before it touches anything.
test('the shell seed is refused under either setting name, with one line and exit 1', () =>
{
    const want = 'the shell installers were removed in 2.0.0 - unset ALFRED_CODE_SEED / CLAUDE_STACK_SEED to use the Node installer'; // legacy-name
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-d1-'));
    try
    {
        for (const key of ['ALFRED_CODE_SEED', 'CLAUDE_STACK_SEED']) // legacy-name
        {
            for (const shim of [SEED, SHIM])
            {
                const r = spawnSync(process.execPath, [shim, 'install', '--print-plan'], { cwd: dir, encoding: 'utf8', env: { ...scrubbed(), [key]: 'shell', HOME: dir, CLAUDE_CONFIG_DIR: path.join(dir, 'acct') } });
                assert.strictEqual(r.status, 1, `${key} via ${path.basename(shim)}: ${r.stdout}${r.stderr}`);
                assert.strictEqual(r.stderr.trim(), want);
                assert.strictEqual(r.stdout, '', 'nothing ran before the refusal');
            }
        }
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
