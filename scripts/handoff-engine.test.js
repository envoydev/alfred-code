'use strict';
// The seats' handoff bus without a memory server (the user's ruling of 2026-10-24: no MCP in the stack). handoff.js is
// an engine copied beside docs.js: a seat stores one note per name through Bash, the next seat lists its run's notes,
// and the orchestrator counts and purges a feature's notes at the close - under the MAIN checkout's
// <data root>/state/handoff/, so a seat in a linked worktree writes where the next seat reads.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const ENGINE = path.join(__dirname, '..', 'stack', 'hooks', 'handoff.js');

function project()
{
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-')));
    execFileSync('git', ['init', '-q', root]);
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'alfred-code.stamp'), 'source: test\n');
    return root;
}
const run = (cwd, args, input = '', env = {}) =>
{
    const r = spawnSync(process.execPath, [ENGINE, ...args], { cwd, input, encoding: 'utf8', env: { ...process.env, ALFRED_CODE_DATA_PATH: '', ...env } });
    return { status: r.status, out: r.stdout, err: r.stderr };
};

test('a stored note is listed for its run, the newest per name first', () =>
{
    const root = project();
    try
    {
        assert.strictEqual(run(root, ['put', 'checkout/v1/designer'], 'seams: OrderService.place\n').status, 0);
        assert.strictEqual(run(root, ['put', 'checkout/v1/implementer/t1'], 'landed: the guard\n').status, 0);
        assert.strictEqual(run(root, ['put', 'checkout/v1/implementer/t1'], 'landed: the guard and its test\n').status, 0);
        assert.strictEqual(run(root, ['put', 'checkout/v2/designer'], 'a later contract\n').status, 0);
        const l = run(root, ['list', 'checkout/v1']);
        assert.strictEqual(l.status, 0);
        assert.match(l.out, /^## checkout\/v1\/implementer\/t1 /m);
        assert.ok(l.out.indexOf('implementer/t1') < l.out.indexOf('checkout/v1/designer'), 'newest first');
        assert.ok(l.out.includes('landed: the guard and its test') && !l.out.includes('landed: the guard\n'), 'the newest note per name wins');
        assert.ok(!l.out.includes('a later contract'), 'another contract version is another run');
        assert.ok(fs.existsSync(path.join(root, '.alfred', 'state', 'handoff', 'checkout.jsonl')));
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a run with no note says none; left counts what a feature still holds; purge empties it', () =>
{
    const root = project();
    try
    {
        assert.deepStrictEqual(run(root, ['list', 'checkout/v1']).out, 'handoff: none\n');
        assert.strictEqual(run(root, ['left', 'checkout']).out.split('\n')[0], '0');
        run(root, ['put', 'checkout/v1/designer'], 'a\n');
        run(root, ['put', 'checkout/v1/verifier'], 'b\n');
        run(root, ['put', 'checkout/v1/verifier'], 'c\n');
        run(root, ['put', 'search/v1/designer'], 'd\n');
        const left = run(root, ['left', 'checkout']).out.split('\n');
        assert.deepStrictEqual(left.slice(0, 3), ['2', 'note checkout/v1/designer', 'note checkout/v1/verifier']);
        assert.strictEqual(run(root, ['left']).out.split('\n')[0], '3', 'no feature counts every feature');
        const p = run(root, ['purge', 'checkout']);
        assert.strictEqual(p.status, 0);
        assert.match(p.out, /^handoff: purged 2 notes \(checkout\/v1\/designer, checkout\/v1\/verifier\)/);
        assert.strictEqual(run(root, ['left', 'checkout']).out.split('\n')[0], '0');
        assert.strictEqual(run(root, ['left', 'search']).out.split('\n')[0], '1', 'another feature is left alone');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a seat in a linked worktree stores under the main checkout', () =>
{
    const root = project();
    const wt = path.join(path.dirname(root), `${path.basename(root)}-wt`);
    try
    {
        execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
        execFileSync('git', ['-C', root, 'worktree', 'add', '-q', wt]);
        assert.strictEqual(run(wt, ['put', 'checkout/v1/implementer/t2'], 'from the worktree\n').status, 0);
        assert.ok(run(root, ['list', 'checkout/v1']).out.includes('from the worktree'));
        assert.ok(!fs.existsSync(path.join(wt, '.alfred', 'state', 'handoff')));
    }
    finally
    {
        spawnSync('git', ['-C', root, 'worktree', 'remove', '--force', wt]);
        fs.rmSync(wt, { recursive: true, force: true });
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('a bad name, an empty note and an unknown command are refused; a long note is cut', () =>
{
    const root = project();
    try
    {
        for (const name of ['checkout', '../x/v1/designer', 'checkout/v1/de signer', 'a/b/c/d/e'])
        {
            const r = run(root, ['put', name], 'x\n');
            assert.strictEqual(r.status, 2, name);
            assert.match(r.err, /handoff: a note name is <feature>\/<contract_version>\/<seat>\[\/<task>\]/);
        }
        assert.match(run(root, ['put', 'checkout/v1/designer'], '  \n').err, /handoff: no note text on stdin/);
        assert.strictEqual(run(root, ['nope']).status, 2);
        run(root, ['put', 'checkout/v1/designer'], `${'x'.repeat(5000)}\n`);
        const l = run(root, ['list', 'checkout/v1']).out;
        assert.ok(l.includes('[cut at 4000 chars]') && l.length < 4200, l.length);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an unreadable store prints no count and exits 1', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () =>
{
    const root = project();
    const dir = path.join(root, '.alfred', 'state', 'handoff');
    try
    {
        run(root, ['put', 'checkout/v1/designer'], 'a\n');
        fs.chmodSync(dir, 0o000);
        const r = run(root, ['left', 'checkout']);
        assert.strictEqual(r.status, 1);
        assert.strictEqual(r.out, '');
        assert.match(r.err, /handoff: the store cannot be read \(EACCES\)/);
    }
    finally { fs.chmodSync(dir, 0o700); fs.rmSync(root, { recursive: true, force: true }); }
});

test('the data root setting places the store', () =>
{
    const root = project();
    try
    {
        run(root, ['put', 'checkout/v1/designer'], 'a\n', { ALFRED_CODE_DATA_PATH: 'var/alfred' });
        assert.ok(fs.existsSync(path.join(root, 'var', 'alfred', 'state', 'handoff', 'checkout.jsonl')));
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});
