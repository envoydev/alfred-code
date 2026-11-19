'use strict';
// stack-select.js --redundant --only <file>: the audit limited to the items a file names.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, 'stack-select.js');
const RECS = path.join(__dirname, '..', 'meta', 'recommendations.json');
const GRAPH = path.join(__dirname, '..', 'meta', 'stack-graph.json');
const INVENTORY = { rules: ['wpf-conventions'], agents: ['wpf-implementer'], skills: ['dotnet-wpf', 'csharp'], mcps: [], plugins: [], hooks: [] };

function withInventory(body)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-only-'));
    try
    {
        const inventory = path.join(dir, 'installed.json');
        fs.writeFileSync(inventory, JSON.stringify(INVENTORY));
        const run = (...extra) =>
        {
            const r = spawnSync(process.execPath, [CLI, '--redundant', '--installed', inventory, '--recs', RECS, '--graph', GRAPH, '--stacks', 'aspnet', ...extra], { encoding: 'utf8' });
            return { out: r.stdout, err: r.stderr, code: r.status };
        };
        body(run, dir);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('--only prints only the redundant lines the file names', () =>
{
    withInventory((run, dir) =>
    {
        const only = path.join(dir, 'added.txt');
        fs.writeFileSync(only, 'skill dotnet-wpf\nagent not-installed\n');
        const all = run();
        assert.match(all.out, /^redundant: rule wpf-conventions /m, 'without --only the whole list prints');
        const got = run('--only', only);
        assert.strictEqual(got.code, 0, got.err);
        assert.deepStrictEqual(got.out.split('\n').filter(Boolean).map((l) => l.split(' - ')[0]), ['redundant: skill dotnet-wpf']);
    });
});

test('--only matches the category and the name together', () =>
{
    withInventory((run, dir) =>
    {
        const only = path.join(dir, 'added.txt');
        fs.writeFileSync(only, 'rule dotnet-wpf\n');
        assert.strictEqual(run('--only', only).out, '', 'a name under another category matches nothing');
    });
});

test('--only with a missing file exits 2 with one stderr line and prints nothing on stdout', () =>
{
    withInventory((run, dir) =>
    {
        const got = run('--only', path.join(dir, 'absent.txt'));
        assert.strictEqual(got.code, 2);
        assert.strictEqual(got.out, '', 'never the full list');
        assert.strictEqual(got.err.trim().split('\n').length, 1, got.err);
        assert.match(got.err, /^stack-select: cannot read --only /);
    });
});

test('--only with an empty file prints no line', () =>
{
    withInventory((run, dir) =>
    {
        const only = path.join(dir, 'added.txt');
        fs.writeFileSync(only, '');
        const got = run('--only', only);
        assert.strictEqual(got.code, 0, got.err);
        assert.strictEqual(got.out, '');
    });
});
