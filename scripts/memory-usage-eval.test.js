'use strict';
// memory-usage.eval.js is billed (it drives `claude -p`), so its runs are never part of `npm test`.
// What is pinned here is the code path, offline: R90 N3 - since 2.0.0 an `update` imports no notes and
// leaves Claude's own memory on until `/alfred-code:init` runs `memory.js init`, so `--setup update`
// runs that step after the update or every assertion that follows reads a project init never touched.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const evalScript = require('./memory-usage.eval.js');

test('runInitAfterUpdate: memory.js init from the same snapshot, at the project level, over the sandbox account (N3)', () =>
{
    const calls = [];
    const spawn = (cmd, argv, opts) => { calls.push({ cmd, argv, opts }); return { status: 0, stdout: 'memory: initialised\n', stderr: '' }; };
    const env = { CLAUDE_CONFIG_DIR: '/acct' };
    const { log } = evalScript.runInitAfterUpdate({ relSrc: '/src', projectDir: '/proj', acctDir: '/acct', env, spawn });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].cmd, process.execPath);
    assert.deepStrictEqual(calls[0].argv, [path.join('/src', 'scripts', 'install', 'memory.js'), 'init', '--project-root', '/proj', '--level', 'project', '--config-dir', '/acct']);
    assert.strictEqual(calls[0].opts.cwd, '/proj');
    assert.strictEqual(calls[0].opts.env, env);
    assert.match(log, /^\$ memory\.js init --level project\nexit=0\n/);
    assert.match(log, /memory: initialised/);
});

test('runInitAfterUpdate: a failed init throws with its output, never reads as set up (N3)', () =>
{
    const spawn = () => ({ status: 1, stdout: '', stderr: 'no uvx' });
    assert.throws(() => evalScript.runInitAfterUpdate({ relSrc: '/src', projectDir: '/proj', acctDir: '/acct', env: {}, spawn }), /memory\.js init .*failed: exit 1 - no uvx/);
    const broken = () => ({ error: new Error('ENOENT'), status: null });
    assert.throws(() => evalScript.runInitAfterUpdate({ relSrc: '/src', projectDir: '/proj', acctDir: '/acct', env: {}, spawn: broken }), /ENOENT/);
});

test('buildProjectUpdate runs init after the update and before its assertions (N3)', () =>
{
    const body = evalScript.buildProjectUpdate.toString();
    const update = body.indexOf("'update', '--scope', 'project', '--installed-only'");
    const init = body.indexOf('runInitAfterUpdate(');
    const firstAssert = body.indexOf('const asserts = []');
    assert.ok(update > 0 && init > update && firstAssert > init, `update ${update}, init ${init}, asserts ${firstAssert}`);
});
