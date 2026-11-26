'use strict';
// layout.js's loader reads a workspace member's mode file (mode inheritance D1): a joined child that holds no value of
// a mode key at any of its own layers takes the nearest member's mode-file value, and inheritedModes names where from.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const layout = require('../stack/hooks/layout.js');
const { putWorkspace } = require('./workspace-fixture.js');
const { realLong } = require('./test-paths.js');

const TMP = realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'layout-mode-inherit-')));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const ACCT = path.join(TMP, 'acct');
fs.mkdirSync(ACCT, { recursive: true });
const ON = { CLAUDE_CONFIG_DIR: ACCT, ALFRED_CODE_WORKSPACE: '1' };
const UNSET = { CLAUDE_CONFIG_DIR: ACCT };

// `spec` maps a folder to { stamp, git, ws, data, local, vars } - `ws` its workspace record, `vars` its .variables text,
// `local` an object (or text) written as .claude/settings.local.json. The same shape as layout-variables.test.js's tree.
function tree(spec, base = TMP)
{
    const top = fs.mkdtempSync(path.join(base, 't-'));
    for (const [rel, o] of Object.entries(spec))
    {
        const dir = path.join(top, ...rel.split('/'));
        fs.mkdirSync(dir, { recursive: true });
        if (o.git) execFileSync('git', ['init', '-q'], { cwd: dir });
        const claude = path.join(dir, '.claude');
        const json = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
        if (o.stamp) { fs.mkdirSync(claude, { recursive: true }); fs.writeFileSync(path.join(claude, 'alfred-code.stamp'), 'sha: x\n'); }
        if (o.local !== undefined) { fs.mkdirSync(claude, { recursive: true }); fs.writeFileSync(path.join(claude, 'settings.local.json'), json(o.local)); }
        const data = path.join(dir, ...(o.data || '.alfred').split('/'));
        if (o.ws !== undefined || o.vars !== undefined) fs.mkdirSync(data, { recursive: true });
        if (o.ws !== undefined) putWorkspace(dir, o.ws, { dataRoot: o.data || '.alfred' });
        if (o.vars !== undefined) fs.writeFileSync(path.join(data, '.variables'), o.vars);
    }
    return (rel = '.') => fs.realpathSync.native(path.join(top, ...rel.split('/')));
}
const varsOf = (root, env = ON) => layout.variablesOf(root, { env: { ...env } });
const K = (s) => `ALFRED_CODE_${s}`;

// Mode inheritance D1: a workspace member's mode file reaches a joined child that holds no value of its own.
const rootAndChild = (root = {}, child = {}) => tree({
    'root': { stamp: true, git: true, ws: { children: ['child'] }, ...root },
    'root/child': { stamp: true, git: true, ws: { parent: '..' }, ...child },
});
const modeEnv = (env) => ({ local: { env } });
const MODE_ON = { [K('SCORING')]: '1', [K('SCORING_LEVEL')]: '90' };

test('a child takes the root\'s mode-file scoring keys, named by the root\'s bare rel, and modeFrom lists them', () =>
{
    const at = rootAndChild(modeEnv(MODE_ON));
    const { values, from, modeFrom } = varsOf(at('root/child'));
    assert.deepStrictEqual([values[K('SCORING')], values[K('SCORING_LEVEL')]], ['1', '90']);
    assert.deepStrictEqual([from[K('SCORING')], from[K('SCORING_LEVEL')]], ['..', '..']);
    assert.deepStrictEqual([...modeFrom].sort(), [K('SCORING'), K('SCORING_LEVEL')]);
});

test('the child\'s own 0 wins over the root\'s mode file', () =>
{
    const at = rootAndChild(modeEnv(MODE_ON), modeEnv({ [K('SCORING')]: '0' }));
    const { values, from, modeFrom } = varsOf(at('root/child'));
    assert.deepStrictEqual([values[K('SCORING')], from[K('SCORING')]], ['0', 'settings.local.json']);
    assert.ok(!modeFrom.has(K('SCORING')));
    assert.strictEqual(values[K('SCORING_LEVEL')], '90', 'the key the child does not hold still comes from the root');
});

test('the child\'s own .variables beats the root\'s mode file', () =>
{
    const at = rootAndChild(modeEnv({ [K('SCORING_LEVEL')]: '95' }), { vars: `${K('SCORING_LEVEL')}=80\n` });
    const { values, from, modeFrom } = varsOf(at('root/child'));
    assert.deepStrictEqual([values[K('SCORING_LEVEL')], from[K('SCORING_LEVEL')]], ['80', 'own']);
    assert.ok(!modeFrom.has(K('SCORING_LEVEL')));
});

test('the root\'s mode file beats the root\'s .variables, and a key only in .variables is no mode-file key', () =>
{
    const at = rootAndChild({ ...modeEnv({ [K('SCORING_LEVEL')]: '95' }), vars: `${K('SCORING_LEVEL')}=60\n${K('SCORING_ROUNDS')}=5\n` });
    const { values, from, modeFrom } = varsOf(at('root/child'));
    assert.deepStrictEqual([values[K('SCORING_LEVEL')], from[K('SCORING_LEVEL')]], ['95', '..']);
    assert.deepStrictEqual([values[K('SCORING_ROUNDS')], from[K('SCORING_ROUNDS')]], ['5', '..']);
    assert.deepStrictEqual([...modeFrom], [K('SCORING_LEVEL')], 'the rounds came from the .variables file');
});

test('an ignore env line stops the key, and the workspace switch 0 stops every member read', () =>
{
    const stopped = rootAndChild(modeEnv(MODE_ON), { ws: { parent: '..', ignore: { env: [K('SCORING')] } } });
    const skipped = varsOf(stopped('root/child'));
    assert.strictEqual(skipped.values[K('SCORING')], undefined);
    assert.strictEqual(skipped.values[K('SCORING_LEVEL')], '90', 'only the named key stops');
    const at = rootAndChild(modeEnv(MODE_ON));
    const off = varsOf(at('root/child'), { ...UNSET, [K('WORKSPACE')]: '0' });
    assert.deepStrictEqual(off.values, { [K('WORKSPACE')]: '0' });
    assert.strictEqual(off.modeFrom.size, 0);
});

test('a member with a mode file and no .variables still hands on its keys through a member with neither', () =>
{
    const at = tree({
        'root': { stamp: true, git: true, ws: { children: ['mid'] }, local: { env: MODE_ON } },
        'root/mid': { stamp: true, git: true, ws: { parent: '..', children: ['leaf'] } },
        'root/mid/leaf': { stamp: true, git: true, ws: { parent: '..' } },
    });
    assert.ok(!fs.existsSync(path.join(at('root'), '.alfred', '.variables')), 'the fixture holds no .variables');
    const { values, from } = varsOf(at('root/mid/leaf'));
    assert.deepStrictEqual([values[K('SCORING')], from[K('SCORING')]], ['1', '../..']);
});

test('an unparseable member mode file is no value and throws nothing', () =>
{
    for (const text of ['{ not json', '{"env": 3}', '{"env": ["a"]}', 'null'])
    {
        const at = rootAndChild({ local: text, vars: `${K('SCORING_LEVEL')}=70\n` });
        const { values, modeFrom } = varsOf(at('root/child'));
        assert.strictEqual(values[K('SCORING')], undefined, text);
        assert.strictEqual(values[K('SCORING_LEVEL')], '70', `${text}: the .variables still reads`);
        assert.strictEqual(modeFrom.size, 0, text);
    }
});

test('inheritedModes names the member and file after applyVariables, AUTO_RUN included', () =>
{
    const at = rootAndChild(modeEnv({ ...MODE_ON, [K('AUTO_RUN')]: '1' }));
    const child = at('root/child');
    const env = { ...ON };
    layout.applyVariables(child, env);
    const file = path.join(at('root'), '.claude', 'settings.local.json');
    const record = layout.inheritedModes(env);
    assert.strictEqual(record.root, child);
    assert.deepStrictEqual(record.modes, {
        [K('SCORING')]: { value: '1', from: '..', file },
        [K('SCORING_LEVEL')]: { value: '90', from: '..', file },
        [K('AUTO_RUN')]: { value: '1', from: '..', file },
    });
    assert.strictEqual(env[K('AUTO_RUN')], undefined, 'the loader never sets AUTO_RUN');
});

test('inheritedModes of a fresh env is { root: null, modes: {} }', () =>
{
    assert.deepStrictEqual(layout.inheritedModes({}), { root: null, modes: {} });
});

test('a child with its own AUTO_RUN records none, and the nearest member\'s value stands for the key', () =>
{
    const at = rootAndChild(modeEnv({ [K('AUTO_RUN')]: '1' }), modeEnv({ [K('AUTO_RUN')]: '0' }));
    const own = { ...ON };
    layout.applyVariables(at('root/child'), own);
    assert.strictEqual(layout.inheritedModes(own).modes[K('AUTO_RUN')], undefined);
    const near = tree({
        'root': { stamp: true, git: true, ws: { children: ['mid'] }, local: { env: { [K('AUTO_RUN')]: '1' } } },
        'root/mid': { stamp: true, git: true, ws: { parent: '..', children: ['leaf'] }, local: { env: { [K('AUTO_RUN')]: '0' } } },
        'root/mid/leaf': { stamp: true, git: true, ws: { parent: '..' } },
    });
    const env = { ...ON };
    layout.applyVariables(near('root/mid/leaf'), env);
    const held = layout.inheritedModes(env).modes[K('AUTO_RUN')];
    assert.deepStrictEqual([held.value, held.from], ['0', '..']);
});

test('inheritedModes records no AUTO_RUN under an ignore env line or the switch 0', () =>
{
    const at = rootAndChild(modeEnv({ [K('AUTO_RUN')]: '1' }), { ws: { parent: '..', ignore: { env: [K('AUTO_RUN')] } } });
    const ignored = { ...ON };
    layout.applyVariables(at('root/child'), ignored);
    assert.deepStrictEqual(layout.inheritedModes(ignored).modes, {});
    const plain = rootAndChild(modeEnv({ [K('AUTO_RUN')]: '1' }));
    const off = { ...UNSET, [K('WORKSPACE')]: '0' };
    layout.applyVariables(plain('root/child'), off);
    assert.deepStrictEqual(layout.inheritedModes(off), { root: path.join(plain('root'), 'child'), modes: {} });
});

test('a member inside the root\'s repository hands on nothing: the credit goes to the member that owns the file', { skip: process.platform === 'win32' && 'Windows reads a subfolder\'s own settings.local.json (layout.localSettingsFile), so no member shares the root\'s mode file' }, () =>
{
    const at = tree({
        'root': { stamp: true, git: true, ws: { children: ['mid'] }, local: { env: { [K('AUTO_RUN')]: '1', [K('SCORING')]: '1' } } },
        'root/mid': { stamp: true, ws: { parent: '..', children: ['leaf'] } },
        'root/mid/leaf': { stamp: true, git: true, ws: { parent: '..' } },
    });
    const leaf = at('root/mid/leaf');
    assert.strictEqual(layout.modeFile(at('root/mid')), path.join(at('root'), '.claude', 'settings.local.json'), 'mid reads root\'s file');
    assert.strictEqual(varsOf(leaf).from[K('SCORING')], '../..', 'from names root, never mid');
    const env = { ...ON };
    layout.applyVariables(leaf, env);
    const file = path.join(at('root'), '.claude', 'settings.local.json');
    assert.deepStrictEqual(layout.inheritedModes(env).modes, {
        [K('SCORING')]: { value: '1', from: '../..', file },
        [K('AUTO_RUN')]: { value: '1', from: '../..', file },
    });
});

test('only the mode keys cross: a non-mode key in the root\'s mode file reaches no child', () =>
{
    const at = rootAndChild(modeEnv({ [K('HISTORY')]: '4', ...MODE_ON }));
    const { values, from, modeFrom } = varsOf(at('root/child'));
    assert.strictEqual(values[K('HISTORY')], undefined);
    assert.strictEqual(from[K('HISTORY')], undefined);
    assert.ok(!modeFrom.has(K('HISTORY')));
    assert.strictEqual(values[K('SCORING')], '1', 'the mode keys of the same file still cross');
});

// A session started in a sub-folder of a joined child (CLAUDE_PROJECT_DIR is the launch folder) takes what a session at
// the child's root takes: applyVariables resolves the folder to the project that owns it first.
const subFolderTree = (srcSpec = {}, root = modeEnv({ ...MODE_ON, [K('AUTO_RUN')]: '1' })) => tree({
    'root': { stamp: true, git: true, ws: { children: ['child'] }, ...root },
    'root/child': { stamp: true, git: true, ws: { parent: '..' } },
    'root/child/src': srcSpec,
});

test('a session in a joined child\'s sub-folder takes the root\'s scoring keys, named from the child, and the root of the record is the child', () =>
{
    const at = subFolderTree();
    const env = { ...ON };
    layout.applyVariables(at('root/child/src'), env);
    assert.deepStrictEqual([env[K('SCORING')], env[K('SCORING_LEVEL')]], ['1', '90']);
    const file = path.join(at('root'), '.claude', 'settings.local.json');
    const record = layout.inheritedModes(env);
    assert.strictEqual(record.root, at('root/child'));
    assert.deepStrictEqual(record.modes, {
        [K('SCORING')]: { value: '1', from: '..', file },
        [K('SCORING_LEVEL')]: { value: '90', from: '..', file },
        [K('AUTO_RUN')]: { value: '1', from: '..', file },
    });
});

test('a session at the child\'s root and one in its sub-folder read the same variables', () =>
{
    const at = subFolderTree();
    const atChild = { ...ON };
    const atSub = { ...ON };
    layout.applyVariables(at('root/child'), atChild);
    layout.applyVariables(at('root/child/src'), atSub);
    assert.deepStrictEqual(atSub, atChild);
    assert.deepStrictEqual(layout.inheritedModes(atSub).modes, layout.inheritedModes(atChild).modes);
    assert.strictEqual(atChild[K('SCORING')], '1');
});

test('a plain folder with no record up to the git top reads its own files as before', () =>
{
    const at = tree({ 'plain': { git: true }, 'plain/sub': { local: { env: { [K('HISTORY')]: '4' } } } });
    const env = { ...UNSET };
    layout.applyVariables(at('plain/sub'), env);
    assert.strictEqual(env[K('HISTORY')], '4');
    assert.strictEqual(layout.inheritedModes(env).root, at('plain/sub'));
});

test('a sub-folder holding its own install record is its own project and inherits nothing from the child\'s chain', () =>
{
    const at = subFolderTree({ stamp: true });
    const env = { ...ON };
    layout.applyVariables(at('root/child/src'), env);
    assert.strictEqual(env[K('SCORING')], undefined);
    assert.deepStrictEqual(layout.inheritedModes(env), { root: at('root/child/src'), modes: {} });
});
