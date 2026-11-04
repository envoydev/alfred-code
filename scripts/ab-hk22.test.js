'use strict';
// HK-22 replay runner (scripts/ab-hk22.js): the prompt read, the pinned model, the per-row cache, the spend cap and
// the score. A stub `claude` (a node script set through AB_CLAUDE_BIN) answers by a marker in its stdin; nothing billed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const RUNNER = path.join(__dirname, 'ab-hk22.js');
const ab = require('./ab-hk22.js');

const STUB = `'use strict';
const fs = require('fs');
let s = '';
process.stdin.on('data', (d) => { s += d; }).on('end', () => {
    if (process.env.STUB_LOG) fs.appendFileSync(process.env.STUB_LOG, 'call\\n');
    if (s.includes('MARK_GARBAGE')) { process.stdout.write('not json'); return; }
    const ok = !s.includes('MARK_HOLD');
    const result = ok ? '{"ok":true}' : '{"ok":false,"reason":"r"}';
    process.stdout.write(JSON.stringify({ result, total_cost_usd: 0.001 }));
});
`;

function sandbox(rows)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-hk22-test-'));
    const stub = path.join(dir, 'claude-stub.js');
    fs.writeFileSync(stub, STUB);
    const closes = path.join(dir, 'closes.jsonl');
    fs.writeFileSync(closes, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return { dir, stub, closes, cache: path.join(dir, 'cache.jsonl'), log: path.join(dir, 'stub.log') };
}

function runCli(box, args)
{
    const env = { ...process.env, AB_CLAUDE_BIN: box.stub, STUB_LOG: box.log };
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    delete env.ANTHROPIC_API_KEY;
    return spawnSync(process.execPath, [RUNNER, ...args], { cwd: ROOT, env, encoding: 'utf8' });
}

const calls = (box) => (fs.existsSync(box.log) ? fs.readFileSync(box.log, 'utf8').split('\n').filter(Boolean).length : 0);

test('readPrompt reads the plain file and refuses one without $ARGUMENTS', () =>
{
    const shipped = path.join(ROOT, ab.DEFAULT_PROMPT);
    assert.strictEqual(ab.readPrompt(shipped), fs.readFileSync(shipped, 'utf8').trim());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-hk22-test-'));
    try
    {
        const bad = path.join(dir, 'prompt.txt');
        fs.writeFileSync(bad, 'Judge it.');
        assert.throws(() => ab.readPrompt(bad), /\$ARGUMENTS/);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('claudeArgs pins the full model id', () =>
{
    const args = ab.claudeArgs(ab.DEFAULT_MODEL, { bare: false });
    const at = args.indexOf('--model');
    assert.deepStrictEqual(args.slice(at, at + 2), ['--model', 'claude-haiku-5-5']);
    const tools = args.indexOf('--tools');
    assert.deepStrictEqual(args.slice(tools, tools + 2), ['--tools', '']);
    const budget = args.indexOf('--max-budget-usd');
    assert.deepStrictEqual(args.slice(budget, budget + 2), ['--max-budget-usd', '0.05']);
    assert.throws(() => ab.claudeArgs('haiku', { bare: false }), /alias/);
});

test('the shipped prompt carries the Cursor release line right after the stop_hook_active line', () =>
{
    const lines = fs.readFileSync(path.join(ROOT, ab.DEFAULT_PROMPT), 'utf8').split(/\r?\n/);
    const at = lines.findIndex((l) => l.startsWith('If `stop_hook_active` is true'));
    assert.ok(at >= 0, 'the stop_hook_active line');
    const next = lines.slice(at + 1).find((l) => l.trim());
    assert.match(next, /cursor_version/);
    assert.match(next, /`stop` in lower case/);
});

test('--live without --run, --cache and --cap exits 2', () =>
{
    const box = sandbox([{ id: 'a', close: 'Done.' }]);
    try
    {
        const r = runCli(box, ['--live', '--closes', box.closes]);
        assert.strictEqual(r.status, 2);
        assert.match(r.stderr, /--live needs --run, --cache and --cap/);
        assert.strictEqual(calls(box), 0);
    }
    finally { fs.rmSync(box.dir, { recursive: true, force: true }); }
});

test('a cached row is never called again', () =>
{
    const box = sandbox([{ id: 'a', close: 'One.' }, { id: 'b', close: 'Two.' }, { id: 'c', close: 'Three.' }]);
    try
    {
        const args = ['--live', '--closes', box.closes, '--run', '1', '--cache', box.cache, '--cap', '1'];
        const first = runCli(box, args);
        assert.strictEqual(first.status, 0, first.stderr);
        assert.match(first.stdout, /run 1: 3 rows, 3 new, 0 cached, 0 unparsed/);
        const second = runCli(box, args);
        assert.strictEqual(second.status, 0, second.stderr);
        assert.match(second.stdout, /run 1: 3 rows, 0 new, 3 cached, 0 unparsed/);
        assert.strictEqual(calls(box), 3);
    }
    finally { fs.rmSync(box.dir, { recursive: true, force: true }); }
});

test('the cap stops the run', () =>
{
    const box = sandbox([{ id: 'a', close: 'One.' }, { id: 'b', close: 'Two.' }, { id: 'c', close: 'Three.' }]);
    try
    {
        const r = runCli(box, ['--live', '--closes', box.closes, '--run', '1', '--cache', box.cache, '--cap', '0.0015']);
        assert.strictEqual(r.status, 3);
        assert.match(r.stdout + r.stderr, /cap: \$0\.0020 of \$0\.0015 reached - 1 rows not run/);
        assert.strictEqual(calls(box), 2);
    }
    finally { fs.rmSync(box.dir, { recursive: true, force: true }); }
});

test('an unparsed verdict scores as release', () =>
{
    const box = sandbox([{ id: 'g', close: 'MARK_GARBAGE' }]);
    try
    {
        const r = runCli(box, ['--live', '--closes', box.closes, '--run', '1', '--cache', box.cache, '--cap', '1']);
        assert.strictEqual(r.status, 0, r.stderr);
        const rows = [...ab.readCache(box.cache).values()];
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].verdict, 'unparsed');
        const t = ab.tally({ rows, labels: { g: 'release' }, runs: [1] });
        assert.strictEqual(t.perRun[0].unparsed, 1);
        assert.strictEqual(t.perRun[0].right, 1);
        assert.strictEqual(t.perRun[0].releasesRight, 1);
    }
    finally { fs.rmSync(box.dir, { recursive: true, force: true }); }
});

test('tally and checkBar', () =>
{
    const labels = { a: 'hold', b: 'release', c: 'release', d: 'hold' };
    const right = { a: 'hold', b: 'release', c: 'release', d: 'hold' };
    const rows = [];
    for (const run of [1, 2, 3])
    {
        for (const [id, v] of Object.entries(right)) rows.push({ id, run, verdict: run === 2 && id === 'd' ? 'release' : v });
    }
    const t = ab.tally({ rows, labels, runs: [1, 2, 3] });
    assert.deepStrictEqual(t.perRun.map((r) => r.right), [4, 3, 4]);
    assert.strictEqual(t.median, 4);
    assert.strictEqual(t.min, 3);
    assert.strictEqual(t.flips, 1);
    assert.strictEqual(t.perRun[1].misses, 1);
    assert.deepStrictEqual(ab.checkBar(t, 'flips<=0').failed, ['flips 1 > 0']);
    assert.strictEqual(ab.checkBar(t, 'median>=4,min>=3').pass, true);
});

test('cacheKey changes with model, run or stdin', () =>
{
    const base = ab.cacheKey('claude-haiku-5-5', 1, 'x');
    const keys = new Set([base, ab.cacheKey('claude-sonnet-5-5', 1, 'x'), ab.cacheKey('claude-haiku-5-5', 2, 'x'), ab.cacheKey('claude-haiku-5-5', 1, 'y')]);
    assert.strictEqual(keys.size, 4);
    assert.match(base, /^[0-9a-f]{64}$/);
});
