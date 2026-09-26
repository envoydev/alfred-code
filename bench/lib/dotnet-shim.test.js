'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { POSIX_ONLY } = require('../test/posix-only.js');
if (POSIX_ONLY)
{
    test('harness process tests', { skip: POSIX_ONLY }, () => {});
    return;
}
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { installShims, SWITCHES, VERBS } = require('./dotnet-shim.js');

// A stand-in `dotnet` that prints the argv it was handed, one per line.
function world(t)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-shim-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const realDir = path.join(dir, 'sdk dir');
    fs.mkdirSync(realDir);
    const real = path.join(realDir, 'dotnet');
    fs.writeFileSync(real, `#!${process.execPath}\nfor (const a of process.argv.slice(2)) console.log(a);\n`, { mode: 0o755 });
    const bin = path.join(dir, 'bin');
    return { dir, real, bin, PATH: `${realDir}${path.delimiter}${process.env.PATH}` };
}

const run = (shim, args) => execFileSync(shim, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim().split('\n');

test('the switches and the verbs they reach', () =>
{
    assert.deepStrictEqual(SWITCHES, ['-m:1', '-nodeReuse:false']);
    assert.deepStrictEqual(VERBS, ['build', 'test', 'publish', 'pack', 'msbuild']);
});

test('a build verb runs in one MSBuild node with no node reuse, its own arguments kept whole', (t) =>
{
    const w = world(t);
    const shim = path.join(installShims({ bin: w.bin, PATH: w.PATH }), 'dotnet');
    assert.deepStrictEqual(run(shim, ['build', 'src/My App.csproj', '-c', 'Release']), ['build', 'src/My App.csproj', '-c', 'Release', ...SWITCHES]);
    for (const verb of VERBS) assert.deepStrictEqual(run(shim, [verb]), [verb, ...SWITCHES]);
});

test('the switches go before a -- so they never reach the test application', (t) =>
{
    const w = world(t);
    const shim = path.join(installShims({ bin: w.bin, PATH: w.PATH }), 'dotnet');
    assert.deepStrictEqual(run(shim, ['test', '--no-build', '--', 'xUnit.MaxParallelThreads=1', '--']), ['test', '--no-build', ...SWITCHES, '--', 'xUnit.MaxParallelThreads=1', '--']);
});

test('run and every other command pass through untouched: dotnet run hands unknown tokens to the app', (t) =>
{
    const w = world(t);
    const shim = path.join(installShims({ bin: w.bin, PATH: w.PATH }), 'dotnet');
    assert.deepStrictEqual(run(shim, ['run', '--project', 'src/Api']), ['run', '--project', 'src/Api']);
    assert.deepStrictEqual(run(shim, ['--info']), ['--info']);
    assert.deepStrictEqual(run(shim, ['ef', 'migrations', 'add', 'X']), ['ef', 'migrations', 'add', 'X']);
});

test('the shim calls the real dotnet by its absolute path, never itself, and is installed only where one exists', (t) =>
{
    const w = world(t);
    const bin = installShims({ bin: w.bin, PATH: `${w.bin}${path.delimiter}${w.PATH}` });
    assert.strictEqual(bin, w.bin);
    const text = fs.readFileSync(path.join(bin, 'dotnet'), 'utf8');
    assert.ok(text.includes(`real='${fs.realpathSync(w.real)}'`), 'the real dotnet by its real path, quoted');
    assert.ok(fs.statSync(path.join(bin, 'dotnet')).mode & 0o111, 'executable');
    const none = path.join(w.dir, 'none');
    assert.strictEqual(installShims({ bin: none, PATH: path.join(w.dir, 'empty') }), null);
    assert.ok(!fs.existsSync(none), 'no dotnet on the PATH, no shim');
});
