'use strict';
// secrets-run.js - the MCP server launcher (workspace layering release 2, T5, AC21): a server registered through it gets
// the workspace chain's values in its environment, stdout passes untouched (it is the protocol), stderr is masked.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const runtime = require('./install/runtime.js');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-run-')));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const ENV = (() =>
{
    const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(TMP, 'no-account') };
    for (const k of Object.keys(env)) if (/^ALFRED_CODE_|^CLAUDE_PROJECT_DIR$/.test(k)) delete env[k];
    env.ALFRED_CODE_WORKSPACE = '1';   // the workspace is off until 3.0.0; the chain cases run it on
    return env;
})();
// `spec` maps a folder to { file, store, data, local } (secret-chain.test.js's tree); every folder is stamped and gets
// the runner with the two engines it requires beside it, as an install copies them.
const tree = (spec) =>
{
    const top = fs.mkdtempSync(path.join(TMP, 't-'));
    for (const [rel, o] of Object.entries(spec))
    {
        const dir = path.join(top, ...rel.split('/'));
        const data = path.join(dir, ...(o.data || '.alfred').split('/'));
        fs.mkdirSync(path.join(dir, '.claude', 'hooks'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'sha: x\n');
        for (const f of ['secrets-run.js', 'secret-chain.js', 'layout.js']) fs.copyFileSync(path.join(HOOKS, f), path.join(dir, '.claude', 'hooks', f));
        fs.mkdirSync(data, { recursive: true });
        if (o.file !== undefined) fs.writeFileSync(path.join(data, 'workspace'), o.file);
        if (o.store !== undefined) fs.writeFileSync(path.join(data, '.secrets'), o.store);
        if (o.local !== undefined) fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), o.local);
    }
    return (rel = '.') => path.join(top, ...rel.split('/'));
};
const VALUES = { kid: 'kid-a1', rootA: 'root-a', rootB: 'root-b' };
const three = (extra = {}) => tree({
    'ws': { file: 'child api\n', store: `A=${VALUES.rootA}\nB=${VALUES.rootB}\n`, ...extra.ws },
    'ws/api': { file: 'parent ..\n', store: `A=${VALUES.kid}\n`, ...extra.api },
});
// The test server: `presence K...` prints each key's type and length, `stderr K` writes the value to stderr, `bulk K`
// writes 200 KB of JSON-RPC lines with the value in one, `exit N` exits with N.
const SERVER = path.join(TMP, 'server.js');
fs.writeFileSync(SERVER, [
    "'use strict';",
    'const [how, ...rest] = process.argv.slice(2);',
    "if (how === 'presence') for (const k of rest) { const v = process.env[k]; console.log(`${k} ${typeof v} ${v === undefined ? '-' : v.length}`); }",
    "if (how === 'stderr') console.error(`the value is ${process.env[rest[0]]}`);",
    "if (how === 'bulk') { const lines = []; for (let i = 0; i < 2000; i++) lines.push(JSON.stringify({ jsonrpc: '2.0', id: i, result: { pad: 'x'.repeat(80), v: i === 1000 ? process.env[rest[0]] : null } })); process.stdout.write(lines.join('\\n') + '\\n'); }",
    "if (how === 'exit') process.exit(Number(rest[0]));",
    '',
].join('\n'));
const runner = (proj) => path.join(proj, '.claude', 'hooks', 'secrets-run.js');
const launch = (proj, cwd, args, env = {}) => spawnSync(process.execPath, [runner(proj), '--', process.execPath, SERVER, ...args], { cwd, env: { ...ENV, ...env }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const filesUnder = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test('the server gets the chain\'s keys, presence printed, no value (AC21)', () =>
{
    const at = three();
    const r = launch(at('ws/api'), at('ws/api'), ['presence', 'A', 'B']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout.replace(/\r/g, ''), `A string ${VALUES.kid.length}\nB string ${VALUES.rootB.length}\n`);
    assert.match(r.stderr, /^# secrets-run: /m);
    assert.match(r.stderr, /\bA\b/);
    assert.match(r.stderr, /\bB\b/);
    for (const value of Object.values(VALUES))
    {
        assert.ok(!r.stdout.includes(value) && !r.stderr.includes(value), `${value} printed`);
        for (const f of filesUnder(at())) if (path.basename(f) !== '.secrets') assert.ok(!fs.readFileSync(f, 'utf8').includes(value), `${value} written into ${f}`);
    }
});

test('a value the server writes to stderr arrives as <KEY>', () =>
{
    const at = three();
    const r = launch(at('ws/api'), at('ws/api'), ['stderr', 'B']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /the value is <B>/);
    assert.ok(!r.stderr.includes(VALUES.rootB), r.stderr);
});

test('stdout passes byte for byte - it is the protocol (R4)', () =>
{
    const at = three();
    const r = launch(at('ws/api'), at('ws/api'), ['bulk', 'A']);
    assert.strictEqual(r.status, 0, r.stderr);
    const lines = [];
    for (let i = 0; i < 2000; i++) lines.push(JSON.stringify({ jsonrpc: '2.0', id: i, result: { pad: 'x'.repeat(80), v: i === 1000 ? VALUES.kid : null } }));
    const want = lines.join('\n') + '\n';
    assert.ok(want.length > 200 * 1024);
    assert.strictEqual(r.stdout, want);
});

test('cwd in a workspace descendant reads the descendant\'s nearest value', () =>
{
    const at = three();
    const r = launch(at('ws'), at('ws/api'), ['presence', 'A', 'B']);
    assert.strictEqual(r.stdout.replace(/\r/g, ''), `A string ${VALUES.kid.length}\nB string ${VALUES.rootB.length}\n`, r.stderr);
});

test('cwd in an unrelated folder passes no chain value and says so in one stderr line', () =>
{
    const at = three();
    const other = tree({ 'elsewhere': { store: 'A=other-a1\n' } });
    const r = launch(at('ws'), other('elsewhere'), ['presence', 'A', 'B']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout.replace(/\r/g, ''), 'A undefined -\nB undefined -\n');
    const lines = r.stderr.split(/\r?\n/).filter((l) => l.startsWith('# secrets-run: '));
    assert.strictEqual(lines.length, 1, r.stderr);
    assert.match(lines[0], /no chain value/);
    const sibling = launch(at('ws/api'), at('ws'), ['presence', 'A']);
    assert.strictEqual(sibling.stdout.replace(/\r/g, ''), 'A undefined -\n', 'a parent is no descendant of the child\'s runner');
});

test('the kill switch passes only the cwd project\'s own store', () =>
{
    const env = three();
    assert.strictEqual(launch(env('ws/api'), env('ws/api'), ['presence', 'A', 'B'], { ALFRED_CODE_WORKSPACE: '0' }).stdout.replace(/\r/g, ''), `A string ${VALUES.kid.length}\nB undefined -\n`);
    const set = three({ api: { local: JSON.stringify({ env: { ALFRED_CODE_WORKSPACE: '0' } }) } });
    assert.strictEqual(launch(set('ws/api'), set('ws/api'), ['presence', 'A', 'B']).stdout.replace(/\r/g, ''), `A string ${VALUES.kid.length}\nB undefined -\n`, 'the settings switch too');
    assert.strictEqual(launch(set('ws'), set('ws/api'), ['presence', 'A']).stdout.replace(/\r/g, ''), 'A undefined -\n', 'with the chain off a descendant is not proved');
});

test('a custom data root set only in settings.local.json is found with no env', () =>
{
    const at = three({ ws: { data: 'var/data', local: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: 'var/data' } }) } });
    assert.ok(!('ALFRED_CODE_DATA_PATH' in ENV));
    assert.strictEqual(launch(at('ws/api'), at('ws/api'), ['presence', 'B']).stdout.replace(/\r/g, ''), `B string ${VALUES.rootB.length}\n`);
});

test('the exit code is the command\'s; a missing command exits 1 with one line', () =>
{
    const at = three();
    assert.strictEqual(launch(at('ws/api'), at('ws/api'), ['exit', '7']).status, 7);
    const missing = spawnSync(process.execPath, [runner(at('ws/api')), '--', 'no-such-command-xyz-91'], { cwd: at('ws/api'), env: ENV, encoding: 'utf8' });
    assert.strictEqual(missing.status, 1);
    assert.match(missing.stderr, /^# secrets-run: could not start no-such-command-xyz-91/m);
    const bare = spawnSync(process.execPath, [runner(at('ws/api')), '--'], { cwd: at('ws/api'), env: ENV, encoding: 'utf8' });
    assert.notStrictEqual(bare.status, 0);
    assert.match(bare.stderr, /^# secrets-run: usage:/m);
});

test('on win32 the command line is runtime.js commandPlan\'s', () =>
{
    const run = require('../stack/hooks/secrets-run.js');
    for (const [bin, full] of [['tool', 'C:\\bin\\tool.exe'], ['shim', 'C:\\bin\\shim.cmd']])
        for (const argv of [['--stdio'], ['{"k":"a&b"}'], ['%PATH%', 'x y'], ['a\nb'], []])
        {
            const seams = { platform: 'win32', resolve: () => full };
            const opts = { env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' } };
            assert.deepStrictEqual(run.commandPlan(bin, argv, opts, seams), runtime.commandPlan(bin, argv, opts, seams), `${bin} ${JSON.stringify(argv)}`);
        }
    assert.ok(run.commandPlan('shim', ['a\nb'], {}, { platform: 'win32', resolve: () => 'C:\\bin\\shim.cmd' }).why, 'a line break is refused');
    assert.deepStrictEqual(run.commandPlan('node', ['x'], {}, { platform: 'darwin' }), { cmd: 'node', args: ['x'], opts: {} });
    for (const [cmd, pathEnv] of [['tool', 'C:\\a;C:\\b'], ['C:\\b\\tool.cmd', '']])
    {
        const isFile = (p) => p === 'C:\\b\\tool.cmd';
        assert.strictEqual(run.resolveWin(cmd, { PATH: pathEnv }, isFile), runtime.resolveWin(cmd, { PATH: pathEnv }, isFile));
    }
});
