'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scopesOf } = require('./install/installed-scopes.js');

const SCRIPT = path.join(__dirname, 'install', 'installed-scopes.js');
const SCOPES = { 'typescript-lsp': 'global', 'claude-hud': 'project' };
const EXIT = { ok: 0, failed: 1, usage: 2 };

function run(args)
{
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    return { code: result.status, out: result.stdout, err: result.stderr };
}

function withFile(text, check)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'installed-scopes-'));
    try
    {
        const file = path.join(dir, 'installed.json');
        fs.writeFileSync(file, text);
        check(file);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('scopesOf returns the read-back\'s scopes map and an empty one for anything else', () =>
{
    assert.deepEqual(scopesOf({ scopes: SCOPES, rules: [] }), SCOPES);
    for (const bad of [null, undefined, 'x', 3, [], {}, { scopes: null }, { scopes: 'global' }]) assert.deepEqual(scopesOf(bad), {}, JSON.stringify(bad));
});

test('the script prints the scopes of the file as one JSON line, as the walk\'s node -e did', () =>
{
    withFile(JSON.stringify({ rules: ['a'], scopes: SCOPES }), (file) =>
    {
        const r = run([file]);
        assert.equal(r.code, EXIT.ok);
        assert.equal(r.out, `${JSON.stringify(SCOPES)}\n`);
    });
});

test('the script prints {} for a read-back with no scopes and reads one that starts with a BOM', () =>
{
    withFile(JSON.stringify({ rules: [] }), (file) => assert.equal(run([file]).out, '{}\n'));
    withFile(`\uFEFF${JSON.stringify({ scopes: SCOPES })}`, (file) => assert.equal(run([file]).out, `${JSON.stringify(SCOPES)}\n`));
});

test('the script exits 1 on a missing or garbage file and 2 on a wrong argument count', () =>
{
    assert.equal(run([path.join(os.tmpdir(), 'installed-scopes-absent.json')]).code, EXIT.failed);
    withFile('not json', (file) =>
    {
        const r = run([file]);
        assert.equal(r.code, EXIT.failed);
        assert.match(r.err, /not a readable read-back/);
        assert.equal(r.out, '');
    });
    assert.equal(run([]).code, EXIT.usage);
    assert.equal(run(['a', 'b']).code, EXIT.usage);
});
