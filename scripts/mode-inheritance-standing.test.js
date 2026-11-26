'use strict';
// Mode inheritance D2: a joined child takes the workspace member's standing auto-run, where git vouches the member's mode
// file is that person's alone. mode-settings.js autoRunInherited, and hook-prelude.js autoRunStanding that reads it.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const layout = require('../stack/hooks/layout.js');
const M = require('../stack/hooks/mode-settings.js');
const { putWorkspace } = require('./workspace-fixture.js');
const { realLong } = require('./test-paths.js');

const PRELUDE = path.join(__dirname, '..', 'stack', 'hooks', 'hook-prelude.js');
const TMP = realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'mode-inherit-standing-')));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const ACCT = path.join(TMP, 'acct');
fs.mkdirSync(ACCT, { recursive: true });
const K = (s) => `ALFRED_CODE_${s}`;
const GIT_OK = spawnSync('git', ['--version']).status === 0;
const SKIP_GIT = !GIT_OK;
const SKIP_LINK = !GIT_OK || process.platform === 'win32';
const freshEnv = () => ({ CLAUDE_CONFIG_DIR: ACCT });
const gitIn = (cwd, args) => execFileSync('git', args, { cwd, stdio: 'ignore' });
const modeFileOf = (dir) => path.join(dir, '.claude', 'settings.local.json');

// `spec` maps a folder to { git, ws, local } - `ws` its workspace record, `local` the env of its mode file. Every call gets
// folders of its own, so the per-root memo of autoRunInherited never carries a verdict from one case to the next.
function tree(spec)
{
    const top = fs.mkdtempSync(path.join(TMP, 't-'));
    for (const [rel, o] of Object.entries(spec))
    {
        const dir = path.join(top, ...rel.split('/'));
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'sha: x\n');
        if (o.git) gitIn(dir, ['init', '-q']);
        if (o.local !== undefined) fs.writeFileSync(modeFileOf(dir), JSON.stringify({ env: o.local }));
        if (o.ws !== undefined) putWorkspace(dir, o.ws, { dataRoot: '.alfred' });
    }
    return (rel = '.') => fs.realpathSync.native(path.join(top, ...rel.split('/')));
}
const rootAndChild = (root = {}, child = {}) => tree({
    'root': { git: true, ws: { children: ['child'] }, ...root },
    'root/child': { git: true, ws: { parent: '..' }, ...child },
});
const RUN = (value) => ({ local: { [K('AUTO_RUN')]: value } });
const inheritedFor = (at, env = freshEnv()) => M.autoRunInherited(at('root/child'), env);

test('a root 1 its git does not track is an own, inherited auto-run named by the root\'s rel', { skip: SKIP_GIT }, () =>
{
    assert.deepStrictEqual(inheritedFor(rootAndChild(RUN('1'))), { held: 'own', from: '..' });
});

test('a root 1 that git tracks is said as tracked, never taken', { skip: SKIP_GIT }, () =>
{
    const at = rootAndChild(RUN('1'));
    gitIn(at('root'), ['add', '-f', '.claude/settings.local.json']);
    assert.deepStrictEqual(inheritedFor(at), { held: 'tracked', from: '..' });
});

test('a root 1 in a linked .claude folder is unvouched', { skip: SKIP_LINK }, () =>
{
    const at = rootAndChild(RUN('1'));
    const root = at('root');
    const real = fs.mkdtempSync(path.join(TMP, 'real-'));
    fs.cpSync(path.join(root, '.claude'), real, { recursive: true });
    fs.rmSync(path.join(root, '.claude'), { recursive: true });
    fs.symlinkSync(real, path.join(root, '.claude'), 'dir');
    assert.deepStrictEqual(inheritedFor(at), { held: 'unvouched', from: '..' });
});

test('a root value that is the number 1 is held 0: the own file\'s bar is the string 1', { skip: SKIP_GIT }, () =>
{
    const at = rootAndChild(RUN(1));
    assert.strictEqual(M.autoRunHeld(at('root')), '', 'the same number in an own file is no standing auto-run');
    assert.deepStrictEqual(inheritedFor(at), { held: '0', from: '..' });
});

test('a sub-folder of a joined child reads its checkout\'s inherited auto-run', { skip: SKIP_GIT }, () =>
{
    const at = rootAndChild(RUN('1'));
    const sub = path.join(at('root/child'), 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    assert.deepStrictEqual(M.autoRunInherited(sub, freshEnv()), { held: 'own', from: '..' }, 'an env never applied');
    const again = rootAndChild(RUN('1'));
    const env = freshEnv();
    layout.applyVariables(again('root/child'), env);
    const subAgain = path.join(again('root/child'), 'src');
    fs.mkdirSync(subAgain, { recursive: true });
    assert.deepStrictEqual(M.autoRunInherited(subAgain, env), { held: 'own', from: '..' }, 'an env applied for the checkout');
});

test('a root 0 is held 0', () => assert.deepStrictEqual(inheritedFor(rootAndChild(RUN('0'))), { held: '0', from: '..' }));

test('a child\'s own 0 or own 1 is no inheritance', { skip: SKIP_GIT }, () =>
{
    assert.strictEqual(inheritedFor(rootAndChild(RUN('1'), RUN('0'))), null);
    assert.strictEqual(inheritedFor(rootAndChild(RUN('1'), RUN('1'))), null);
});

test('the switch off, an ignore env line and a root with no value give null', () =>
{
    assert.strictEqual(inheritedFor(rootAndChild(RUN('1')), { ...freshEnv(), [K('WORKSPACE')]: '0' }), null);
    const ignored = rootAndChild(RUN('1'), { ws: { parent: '..', ignore: { env: [K('AUTO_RUN')] } } });
    assert.strictEqual(inheritedFor(ignored), null);
    assert.strictEqual(inheritedFor(rootAndChild({ local: { [K('SCORING')]: '1' } })), null);
});

test('a middle member\'s 0 before the root\'s 1 is held 0, never own', { skip: SKIP_GIT }, () =>
{
    const at = tree({
        'root': { git: true, ws: { children: ['mid'] }, ...RUN('1') },
        'root/mid': { git: true, ws: { parent: '..', children: ['leaf'] }, ...RUN('0') },
        'root/mid/leaf': { git: true, ws: { parent: '..' } },
    });
    assert.deepStrictEqual(M.autoRunInherited(at('root/mid/leaf'), freshEnv()), { held: '0', from: '..' });
});

test('an env the loader never ran on resolves from the launch env and is left unchanged', { skip: SKIP_GIT }, () =>
{
    const at = rootAndChild({ local: { [K('AUTO_RUN')]: '1', [K('SCORING')]: '1' } });
    const env = freshEnv();
    assert.deepStrictEqual(layout.inheritedModes(env), { root: null, modes: {} });
    assert.deepStrictEqual(M.autoRunInherited(at('root/child'), env), { held: 'own', from: '..' });
    assert.deepStrictEqual(env, freshEnv(), 'the caller\'s env got no winner written (the loader would set the scoring key)');
    assert.deepStrictEqual(layout.inheritedModes(env), { root: null, modes: {} }, 'and no record either');
});

test('an env the loader ran for another root is resolved again for this one, on the launch values', { skip: SKIP_GIT }, () =>
{
    const first = tree({ 'alone': { local: { [K('WORKSPACE')]: '0' } } });
    const env = freshEnv();
    layout.applyVariables(first('alone'), env);
    assert.strictEqual(env[K('WORKSPACE')], '0', 'the first root\'s switch 0 was applied to env');
    const at = rootAndChild(RUN('1'));
    assert.deepStrictEqual(M.autoRunInherited(at('root/child'), env), { held: 'own', from: '..' });
});

test('an env applied for this very root is read as it stands', { skip: SKIP_GIT }, () =>
{
    const at = rootAndChild(RUN('1'));
    const env = freshEnv();
    layout.applyVariables(at('root/child'), env);
    assert.deepStrictEqual(M.autoRunInherited(at('root/child'), env), { held: 'own', from: '..' });
});

test('the verdict is memoised per root for the process', { skip: SKIP_GIT }, () =>
{
    const at = rootAndChild(RUN('1'));
    assert.deepStrictEqual(inheritedFor(at), { held: 'own', from: '..' });
    fs.writeFileSync(modeFileOf(at('root')), JSON.stringify({ env: { [K('AUTO_RUN')]: '0' } }));
    assert.deepStrictEqual(inheritedFor(at), { held: 'own', from: '..' }, 'a null or a verdict is read once');
    assert.strictEqual(inheritedFor(rootAndChild(RUN('0'))).held, '0', 'another root has its own verdict');
});

// autoRunStanding is memoised per process, so each case loads the prelude in a child of its own. `calls` run in the
// child, which prints their JSON.
function inPrelude(cwd, calls)
{
    const script = `const p = require(${JSON.stringify(PRELUDE)}); const out = {}; ${calls}; process.stdout.write(JSON.stringify(out));`;
    const env = { ...process.env, CLAUDE_CONFIG_DIR: ACCT };
    for (const key of Object.keys(env)) if (/^ALFRED_CODE_/.test(key) || key === 'CLAUDE_PROJECT_DIR') delete env[key];
    const r = spawnSync(process.execPath, ['-e', script], { cwd, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    return JSON.parse(r.stdout);
}

test('autoRunStanding is true in a child under the root\'s own 1, and the stamp reads live for a named session', { skip: SKIP_GIT }, () =>
{
    const child = rootAndChild(RUN('1'))('root/child');
    const out = inPrelude(child, `out.standing = p.autoRunStanding(${JSON.stringify(child)});
        out.stamp = p.approvalStamp({ session_id: 'sess-a', cwd: ${JSON.stringify(child)} });
        out.lasts = p.autoLasts(${JSON.stringify(child)});`);
    assert.strictEqual(out.standing, true);
    assert.deepStrictEqual([out.stamp.first, out.stamp.session, out.stamp.live], ['AUTO - "ALFRED_CODE_AUTO_RUN=1"', 'sess-a', true]);
    assert.match(out.lasts, /new sessions included/);
});

test('autoRunStanding stays false for a tracked, a 0, a child\'s own 0 and the switch 0', { skip: SKIP_GIT }, () =>
{
    const tracked = rootAndChild(RUN('1'));
    gitIn(tracked('root'), ['add', '-f', '.claude/settings.local.json']);
    const cases = [tracked('root/child'), rootAndChild(RUN('0'))('root/child'), rootAndChild(RUN('1'), RUN('0'))('root/child')];
    for (const child of cases) assert.strictEqual(inPrelude(child, `out.v = p.autoRunStanding(${JSON.stringify(child)})`).v, false, child);
    const off = rootAndChild(RUN('1'), { local: { [K('WORKSPACE')]: '0' } })('root/child');
    assert.strictEqual(inPrelude(off, `out.v = p.autoRunStanding(${JSON.stringify(off)})`).v, false, 'the workspace switch 0 in the child');
});

test('autoRunStanding of a sub-folder of the child is true too', { skip: SKIP_GIT }, () =>
{
    const at = rootAndChild(RUN('1'));
    const sub = path.join(at('root/child'), 'src');
    fs.mkdirSync(sub, { recursive: true });
    const plain = tree({ 'plain': {} })('plain');
    assert.strictEqual(inPrelude(plain, `out.v = p.autoRunStanding(${JSON.stringify(sub)})`).v, true);
});

test('a hook whose payload names another checkout than the prelude applied for reads that checkout\'s record', { skip: SKIP_GIT }, () =>
{
    const at = rootAndChild(RUN('1'));
    const plain = tree({ 'plain': {} })('plain');
    const out = inPrelude(plain, `out.plain = p.autoRunStanding(${JSON.stringify(plain)}); out.child = p.autoRunStanding(${JSON.stringify(at('root/child'))});`);
    assert.deepStrictEqual(out, { plain: false, child: true });
});
