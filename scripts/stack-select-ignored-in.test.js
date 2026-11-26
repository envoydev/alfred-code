'use strict';
// stack-select.js --redundant --ignored-in <dir>: a root's fit check skips what a child project already ignores.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { putWorkspace } = require('./workspace-fixture.js');

const CLI = path.join(__dirname, 'stack-select.js');
const RECS = path.join(__dirname, '..', 'meta', 'recommendations.json');
const GRAPH = path.join(__dirname, '..', 'meta', 'stack-graph.json');
const INVENTORY = { rules: ['wpf-conventions'], agents: ['wpf-implementer'], skills: ['dotnet-wpf', 'csharp'], mcps: [], plugins: [], hooks: [] };
const ALL_ROWS = ['redundant: agent wpf-implementer', 'redundant: rule wpf-conventions', 'redundant: skill dotnet-wpf'];

function withChild(body)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-ignored-'));
    try
    {
        const inventory = path.join(dir, 'installed.json');
        fs.writeFileSync(inventory, JSON.stringify(INVENTORY));
        const child = path.join(dir, 'child');
        fs.mkdirSync(child);
        const run = (...extra) =>
        {
            const r = spawnSync(process.execPath, [CLI, '--redundant', '--installed', inventory, '--recs', RECS, '--graph', GRAPH, '--stacks', 'aspnet', ...extra], { encoding: 'utf8' });
            const rows = r.stdout.split('\n').filter(Boolean).map((l) => l.split(' - ')[0]).sort();
            return { rows, err: r.stderr, code: r.status };
        };
        body(run, child, dir);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('--ignored-in drops the row the child already ignores and keeps the others', () =>
{
    withChild((run, child) =>
    {
        putWorkspace(child, { ignore: { skill: ['dotnet-wpf'] } });
        const got = run('--ignored-in', child);
        assert.strictEqual(got.code, 0, got.err);
        assert.deepStrictEqual(got.rows, ['redundant: agent wpf-implementer', 'redundant: rule wpf-conventions']);
    });
});

test('without --ignored-in the ignored row still prints', () =>
{
    withChild((run, child) =>
    {
        putWorkspace(child, { ignore: { skill: ['dotnet-wpf'] } });
        assert.deepStrictEqual(run().rows, ALL_ROWS);
    });
});

test('--ignored-in matches the category and the name together', () =>
{
    withChild((run, child) =>
    {
        putWorkspace(child, { ignore: { rule: ['dotnet-wpf'], skill: ['wpf-conventions'] } });
        assert.deepStrictEqual(run('--ignored-in', child).rows, ALL_ROWS, 'a name under another category drops nothing');
    });
});

test('--ignored-in on a folder with no workspace record prints every row and exits 0', () =>
{
    withChild((run, child) =>
    {
        const got = run('--ignored-in', child);
        assert.strictEqual(got.code, 0, got.err);
        assert.deepStrictEqual(got.rows, ALL_ROWS);
    });
});

test('--ignored-in on a folder that does not exist prints every row and exits 0', () =>
{
    withChild((run, child, dir) =>
    {
        const got = run('--ignored-in', path.join(dir, 'absent'));
        assert.strictEqual(got.code, 0, got.err);
        assert.deepStrictEqual(got.rows, ALL_ROWS);
    });
});

test('--ignored-in with a garbage workspace.json prints every row and exits 0', () =>
{
    withChild((run, child) =>
    {
        const file = putWorkspace(child, { ignore: { skill: ['dotnet-wpf'] } });
        fs.writeFileSync(file, '{ not json');
        const got = run('--ignored-in', child);
        assert.strictEqual(got.code, 0, got.err);
        assert.deepStrictEqual(got.rows, ALL_ROWS);
    });
});

test('--ignored-in with no value prints every row and exits 0', () =>
{
    withChild((run, child) =>
    {
        putWorkspace(child, { ignore: { skill: ['dotnet-wpf'] } });
        const got = run('--ignored-in');
        assert.strictEqual(got.code, 0, got.err);
        assert.deepStrictEqual(got.rows, ALL_ROWS);
    });
});

test('--only and --ignored-in both filter', () =>
{
    withChild((run, child, dir) =>
    {
        putWorkspace(child, { ignore: { skill: ['dotnet-wpf'] } });
        const only = path.join(dir, 'added.txt');
        fs.writeFileSync(only, 'skill dotnet-wpf\nrule wpf-conventions\n');
        const got = run('--only', only, '--ignored-in', child);
        assert.strictEqual(got.code, 0, got.err);
        assert.deepStrictEqual(got.rows, ['redundant: rule wpf-conventions']);
    });
});
