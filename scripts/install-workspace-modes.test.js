'use strict';
// Mode inheritance D3b: the installer's readers of a workspace root's mode file. An inherited mode-file value is read live
// by the loader, so `modes.js refresh` never copies it into a child, `pruneChained` never takes a child's own line for it
// away, and `keepOnLeave` carries it into the leaving child's own MODE FILE, never its tracked `.variables`.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const layout = require('../stack/hooks/layout.js');
const wsLib = require('./install/workspace.js');
const modes = require('./install/modes.js');
const { applyEnv } = require('./install/settings.js');
const { putWorkspace } = require('./workspace-fixture.js');
const { realLong } = require('./test-paths.js');

const TMP = realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'install-ws-modes-')));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const ACCT = path.join(TMP, 'acct');
fs.mkdirSync(ACCT, { recursive: true });
const ON = { CLAUDE_CONFIG_DIR: ACCT, ALFRED_CODE_WORKSPACE: '1' };
const K = (s) => `ALFRED_CODE_${s}`;
const [SCORING, LEVEL, COMPACT, AUTO_RUN, HISTORY] = ['SCORING', 'SCORING_LEVEL', 'AUTO_COMPACT', 'AUTO_RUN', 'HISTORY'].map(K);

// `spec` maps a folder to { stamp, git, ws, local, vars } - `ws` its workspace record, `vars` its .variables text, `local`
// an object (or text) written as .claude/settings.local.json. The same shape as layout-mode-inheritance.test.js's tree.
function tree(spec)
{
    const top = fs.mkdtempSync(path.join(TMP, 't-'));
    for (const [rel, o] of Object.entries(spec))
    {
        const dir = path.join(top, ...rel.split('/'));
        fs.mkdirSync(dir, { recursive: true });
        if (o.git) execFileSync('git', ['init', '-q'], { cwd: dir });
        const claude = path.join(dir, '.claude');
        const json = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
        if (o.stamp) { fs.mkdirSync(claude, { recursive: true }); fs.writeFileSync(path.join(claude, 'alfred-code.stamp'), 'sha: x\n'); }
        if (o.local !== undefined) { fs.mkdirSync(claude, { recursive: true }); fs.writeFileSync(path.join(claude, 'settings.local.json'), json(o.local)); }
        if (o.ws !== undefined) putWorkspace(dir, o.ws);
        if (o.vars !== undefined) { fs.mkdirSync(path.join(dir, '.alfred'), { recursive: true }); fs.writeFileSync(path.join(dir, '.alfred', '.variables'), o.vars); }
    }
    return (rel = '.') => fs.realpathSync.native(path.join(top, ...rel.split('/')));
}
const rootAndChild = (root = {}, child = {}) => tree({
    'root': { stamp: true, git: true, ws: { children: ['child'] }, ...root },
    'root/child': { stamp: true, git: true, ws: { parent: '..' }, ...child },
});
const modeEnv = (env) => ({ local: { env } });
const modeFileOf = (dir) => path.join(dir, '.claude', 'settings.local.json');
const modeEnvOf = (dir) => { try { return JSON.parse(fs.readFileSync(modeFileOf(dir), 'utf8')).env || {}; } catch { return null; } };
const textOf = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const varsTextOf = (dir) => textOf(path.join(dir, '.alfred', '.variables'));

// ------------------------------------------------------------------ modes.js refresh

test('refresh leaves the child\'s mode file as it is when its compact 1 comes from the root\'s mode file', () =>
{
    const at = rootAndChild(modeEnv({ [COMPACT]: '1' }), { local: `${JSON.stringify({ env: { [SCORING]: '0' } }, null, 2)}\n` });
    const child = at('root/child');
    const before = textOf(modeFileOf(child));
    const lines = [];
    modes.refresh({ projectRoot: child, configDir: ACCT, log: (l) => lines.push(l) });
    assert.strictEqual(textOf(modeFileOf(child)), before);
    assert.deepStrictEqual(lines, []);
    assert.strictEqual(layout.variablesOf(child, { env: ON }).values[COMPACT], '1', 'the child still reads it live');
});

test('refresh writes no mode file into a child that holds none, for a compact 1 from the root\'s mode file', () =>
{
    const at = rootAndChild(modeEnv({ [COMPACT]: '1' }));
    modes.refresh({ projectRoot: at('root/child'), configDir: ACCT, log: () => {} });
    assert.strictEqual(fs.existsSync(modeFileOf(at('root/child'))), false);
});

test('refresh still copies a compact 1 a member\'s .variables holds (the team\'s value)', () =>
{
    const at = rootAndChild({ vars: `${COMPACT}=1\n` });
    modes.refresh({ projectRoot: at('root/child'), configDir: ACCT, log: () => {} });
    assert.strictEqual(modeEnvOf(at('root/child'))[COMPACT], '1');
});

// ------------------------------------------------------------------ chainModes

test('chainModes names the keys the root\'s mode file wins, never one only its .variables holds', () =>
{
    const at = rootAndChild({ ...modeEnv({ [SCORING]: '0', [LEVEL]: '90' }), vars: `${COMPACT}=1\n${HISTORY}=5\n` });
    assert.deepStrictEqual([...wsLib.chainModes(at('root/child'), { env: ON })].sort(), [SCORING, LEVEL]);
    assert.deepStrictEqual(Object.keys(wsLib.chainValues(at('root/child'), { env: ON })).sort(), [COMPACT, HISTORY], 'chainValues is the members\' .variables alone');
});

test('chainModes: a nearer member\'s .variables decides the key before a farther member\'s mode file', () =>
{
    const at = tree({
        'root': { stamp: true, git: true, ws: { children: ['mid'] }, ...modeEnv({ [LEVEL]: '95', [SCORING]: '1' }) },
        'root/mid': { stamp: true, git: true, ws: { parent: '..', children: ['child'] }, vars: `${LEVEL}=80\n` },
        'root/mid/child': { stamp: true, git: true, ws: { parent: '..' } },
    });
    assert.deepStrictEqual([...wsLib.chainModes(at('root/mid/child'), { env: ON })], [SCORING]);
});

test('chainModes: an ignore env line and the switch at 0 stop it', () =>
{
    const at = rootAndChild(modeEnv({ [SCORING]: '0', [LEVEL]: '90' }), { ws: { parent: '..', ignore: { env: [SCORING] } } });
    assert.deepStrictEqual([...wsLib.chainModes(at('root/child'), { env: ON })], [LEVEL]);
    assert.deepStrictEqual([...wsLib.chainModes(at('root/child'), { env: { ...ON, ALFRED_CODE_WORKSPACE: '0' } })], []);
});

test('chainModes: a mode file that is not JSON or holds an env that is no object hands nothing on', () =>
{
    const bad = rootAndChild({ local: '{ not json' });
    assert.deepStrictEqual([...wsLib.chainModes(bad('root/child'), { env: ON })], []);
    const odd = rootAndChild({ local: { env: ['x'] } });
    assert.deepStrictEqual([...wsLib.chainModes(odd('root/child'), { env: ON })], []);
});

// ------------------------------------------------------------------ pruneChained and envPlan

test('pruneChained keeps a child\'s SCORING=1 line when the root\'s mode file holds 0 and its .variables 1', () =>
{
    const at = rootAndChild({ ...modeEnv({ [SCORING]: '0' }), vars: `${SCORING}=1\n${HISTORY}=5\n` }, { vars: `${SCORING}=1\n${HISTORY}=5\n` });
    const child = at('root/child');
    const got = wsLib.pruneChained(child, { env: ON, log: () => {} });
    assert.ok(got.own.includes(SCORING), JSON.stringify(got));
    assert.deepStrictEqual(got.dropped, [HISTORY], 'a value only the team\'s .variables hands on is still pruned');
    assert.strictEqual(varsTextOf(child), `${SCORING}=1\n`);
});

test('envPlan with --auto-compact on keeps the child\'s own ALFRED_CODE_AUTO_COMPACT when the root\'s mode file also holds 1', () =>
{
    const at = rootAndChild(modeEnv({ [COMPACT]: '1' }), { stamp: true });
    const child = at('root/child');
    const plan = wsLib.envPlan({ workspace: { on: true, members: wsLib.chain(child, { env: ON }).members, ignores: [] }, args: { action: 'update', scope: 'project' },
        projectRoot: child, env: ON, claudeDir: path.join(child, '.claude'), ledger: null });
    assert.ok(!Object.hasOwn(plan.memberEnv, COMPACT), 'memberEnv reads .variables alone');
    const env = { [COMPACT]: '1' };
    const lines = [];
    applyEnv(env, { catalog: [], migrations: { renames: [], reseed: [], retire: [], off: [] }, autoCompact: { value: '1' }, chain: { values: plan.memberEnv, ignored: plan.ignored }, log: (l) => lines.push(l) });
    assert.strictEqual(env[COMPACT], '1');
    assert.ok(!lines.some((l) => /comes from the workspace/.test(l)), lines.join('\n'));
});

// ------------------------------------------------------------------ keepOnLeave

const keep = (dir, env = ON) => { const lines = []; const got = wsLib.keepOnLeave(dir, { env, log: (l) => lines.push(l) }); return { got, lines }; };

test('a leaving child that inherited ALFRED_CODE_SCORING_LEVEL from the root\'s mode file holds it in its own mode file, its .variables unchanged', () =>
{
    const at = rootAndChild(modeEnv({ [LEVEL]: '90' }), { vars: `${HISTORY}=7\n`, ...modeEnv({ [SCORING]: '1' }) });
    const child = at('root/child');
    const before = varsTextOf(child);
    const { got, lines } = keep(child);
    assert.deepStrictEqual(modeEnvOf(child), { [SCORING]: '1', [LEVEL]: '90' });
    assert.strictEqual(varsTextOf(child), before);
    assert.deepStrictEqual(got.written, []);
    assert.ok(lines.some((l) => l.includes(LEVEL) && /mode file/.test(l) && !/!!/.test(l)), lines.join('\n'));
    assert.strictEqual(layout.variablesOf(child, { env: { ...ON, ALFRED_CODE_WORKSPACE: '0' } }).values[LEVEL], '90', 'it reads the same with no workspace');
});

test('a leave writes the team\'s values into .variables and the inherited mode keys into the mode file, apart', () =>
{
    const at = rootAndChild({ ...modeEnv({ [LEVEL]: '90', [COMPACT]: '0' }), vars: `${HISTORY}=5\n` });
    const child = at('root/child');
    const { got } = keep(child);
    assert.deepStrictEqual(got.written, [HISTORY]);
    assert.strictEqual(varsTextOf(child), `${HISTORY}=5\n`, 'no mode key reaches the tracked file');
    assert.deepStrictEqual(modeEnvOf(child), { [LEVEL]: '90', [COMPACT]: '0' });
});

test('a leave logs that auto-run ends here when it was inherited as own, and writes it nowhere', () =>
{
    const at = rootAndChild(modeEnv({ [AUTO_RUN]: '1', [LEVEL]: '90' }));
    const child = at('root/child');
    const { lines } = keep(child);
    assert.ok(lines.includes('workspace: auto-run was inherited from .. - it ends here; /alfred-code:mode:auto-run on in this project keeps it'), lines.join('\n'));
    assert.ok(!Object.hasOwn(modeEnvOf(child), AUTO_RUN));
});

test('a leave logs no auto-run line when the root\'s auto-run is 0', () =>
{
    const at = rootAndChild(modeEnv({ [AUTO_RUN]: '0', [LEVEL]: '90' }));
    const { lines } = keep(at('root/child'));
    assert.ok(!lines.some((l) => /auto-run/.test(l)), lines.join('\n'));
});

test('a leave whose mode write is refused (git tracks the child\'s mode file) logs the !! line and goes on', () =>
{
    const at = rootAndChild({ ...modeEnv({ [LEVEL]: '90' }), vars: `${HISTORY}=5\n` }, modeEnv({ ALFRED_CODE_MEMORY: 'default' }));
    const child = at('root/child');
    execFileSync('git', ['add', '-f', '.claude/settings.local.json'], { cwd: child });
    const before = textOf(modeFileOf(child));
    const { got, lines } = keep(child);
    assert.ok(lines.includes(`!! workspace: ${LEVEL} were inherited from ..'s mode file and could not be kept here (git tracks the file) - they read the stack's defaults now`), lines.join('\n'));
    assert.strictEqual(textOf(modeFileOf(child)), before);
    assert.deepStrictEqual(got.written, [HISTORY], 'the leave goes on: the team\'s value is still kept');
    assert.strictEqual(got.why, undefined);
});
