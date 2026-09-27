'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { envOf } = require('../stack/hooks/hook-prelude.js');

const ROOT = path.join(__dirname, '..');

// This process may inherit real project secrets and 1.x settings from the dev shell that started it
// (measured here: a live CLAUDE_STACK_SENTRY_AUTH, SENTRY_ACCESS_TOKEN and CONTEXT7_API_KEY all // legacy-name
// answered a lookup meant to see only what a test wrote). Every case in this file needs a known,
// empty starting environment, so both settings prefixes and the credential names the house rules'
// temp-project list names are stripped once for the whole process before any test runs - never
// restored, since this process runs only these tests and exits after.
for (const k of Object.keys(process.env))
{
    if (k.startsWith('ALFRED_CODE_') || k.startsWith('CLAUDE_STACK_')) delete process.env[k]; // legacy-name
}
for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY', 'CLAUDE_PROJECT_DIR', 'CLAUDE_DOCS_PATH', 'MCP_MEMORY_SQLITE_PATH'])
{
    delete process.env[k];
}

// A child env with the ALFRED_CODE_ spelling of `key` removed, so only whatever the case sets under
// CLAUDE_STACK_ (or nothing) is left to answer - deleting beats setting `undefined`, which some // legacy-name
// child_process implementations stringify to the literal text "undefined".
function withoutFresh(key, extra)
{
    const env = { ...process.env, ...extra };
    delete env[key];
    return env;
}

function tmpProject()
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-legacy-'));
    execFileSync('git', ['init', '-q', dir]);
    return dir;
}

test('the new name wins, the old one answers alone, empty is absent', () =>
{
    assert.equal(envOf({ ALFRED_CODE_MONITOR: 'inject', CLAUDE_STACK_MONITOR: 'log' }, 'MONITOR'), 'inject'); // legacy-name
    assert.equal(envOf({ CLAUDE_STACK_MONITOR: 'log' }, 'MONITOR'), 'log'); // legacy-name
    assert.equal(envOf({ ALFRED_CODE_MONITOR: '', CLAUDE_STACK_MONITOR: 'log' }, 'MONITOR'), 'log'); // legacy-name
    assert.equal(envOf({}, 'MONITOR'), undefined);
    assert.equal(envOf({ CLAUDE_DOCS_PATH: 'docs' }, 'DOCS_PATH'), 'docs');
});

test('docs.js resolves DOCS_ROOT from CLAUDE_STACK_DOCS_PATH alone', () => // legacy-name
{
    const dir = tmpProject();
    try
    {
        const out = execFileSync(process.execPath, ['-e', `process.stdout.write(require(${JSON.stringify(path.join(ROOT, 'stack', 'hooks', 'docs.js'))}).DOCS_ROOT)`], {
            env: withoutFresh('ALFRED_CODE_DOCS_PATH', { CLAUDE_PROJECT_DIR: dir, CLAUDE_STACK_DOCS_PATH: 'custom/docs' }), // legacy-name
            encoding: 'utf8',
        });
        assert.equal(out, path.join(dir, 'custom', 'docs'));
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('history.js historyDir resolves from CLAUDE_STACK_DOCS_PATH alone', () => // legacy-name
{
    const { historyDir } = require('../stack/hooks/history.js');
    const dir = tmpProject();
    const savedFresh = process.env.ALFRED_CODE_DOCS_PATH;
    const savedOld = process.env.CLAUDE_STACK_DOCS_PATH; // legacy-name
    delete process.env.ALFRED_CODE_DOCS_PATH;
    process.env.CLAUDE_STACK_DOCS_PATH = 'custom/docs'; // legacy-name
    try { assert.equal(historyDir(dir), path.join(dir, 'custom', 'docs', 'history')); }
    finally
    {
        if (savedFresh === undefined) delete process.env.ALFRED_CODE_DOCS_PATH; else process.env.ALFRED_CODE_DOCS_PATH = savedFresh;
        if (savedOld === undefined) delete process.env.CLAUDE_STACK_DOCS_PATH; else process.env.CLAUDE_STACK_DOCS_PATH = savedOld; // legacy-name
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('memory.js level CLI falls back to a settings.json holding only CLAUDE_STACK_MEMORY_DB', () => // legacy-name
{
    const dir = tmpProject();
    try
    {
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_STACK_MEMORY_DB: '.memory-mcp/legacy.db' } })); // legacy-name
        const out = execFileSync(process.execPath, [path.join(ROOT, 'stack', 'hooks', 'memory.js'), 'level', dir], {
            env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(dir, 'no-such-account-dir') },
            encoding: 'utf8',
        });
        assert.match(out, /legacy\.db/);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('guard-answer-length.js stands down on CLAUDE_STACK_HOOKS_OFF alone', () => // legacy-name
{
    // A real UserPromptSubmit payload, the one shape this hook actually acts on - an empty `{}`
    // payload matches none of the hook's `payload.hook_event_name === ...` branches and falls
    // through to a silent `process.exit(0)` on EVERY path, gated or not, so it would stay green
    // with the CLAUDE_STACK_ branch (or the whole standDown gate) deleted from the hook entirely. // legacy-name
    const payload = JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        session_id: 'env-legacy-hooks-off',
        cwd: os.tmpdir(),
        prompt: 'does CLAUDE_STACK_HOOKS_OFF alone still stand this hook down', // legacy-name
    });

    const off = execFileSync(process.execPath, [path.join(ROOT, 'stack', 'hooks', 'guard-answer-length.js')], {
        input: payload,
        env: withoutFresh('ALFRED_CODE_HOOKS_OFF', { CLAUDE_STACK_HOOKS_OFF: 'guard-answer-length' }), // legacy-name
        encoding: 'utf8',
    });
    assert.equal(off, '');

    // Positive control, the SAME payload with the gate unset: proves the empty result above is the
    // switch actually firing, not the hook ignoring a payload it never reads either way.
    const on = execFileSync(process.execPath, [path.join(ROOT, 'stack', 'hooks', 'guard-answer-length.js')], {
        input: payload,
        env: withoutFresh('ALFRED_CODE_HOOKS_OFF', {}),
        encoding: 'utf8',
    });
    assert.match(on, /"hookEventName":"UserPromptSubmit"/);
    assert.notEqual(on, '');
});

// memory-launch.js falls back to the ACCOUNT settings.json (~/.claude/settings.json by default) when
// a project file names nothing - which on a real developer machine may hold a real credential. The
// case below points CLAUDE_CONFIG_DIR at an empty temp dir so the launcher never opens the real
// account file: the account directory is a REQUIRED file argument, not a HOME-derived one, once
// CLAUDE_CONFIG_DIR is set.
function withIsolatedAccountDir(fn)
{
    const dir = tmpProject();
    const acct = fs.mkdtempSync(path.join(os.tmpdir(), 'env-legacy-acct-'));
    const savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = acct;
    try { return fn(dir); }
    finally
    {
        if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(acct, { recursive: true, force: true });
    }
}

test('memory-launch.js resolveDb falls back to a settings.json holding only CLAUDE_STACK_MEMORY_DB', () => // legacy-name
{
    const { resolveDb } = require('../stack/mcp/memory-launch.js');
    const savedPath = process.env.MCP_MEMORY_SQLITE_PATH;
    delete process.env.MCP_MEMORY_SQLITE_PATH;
    try
    {
        withIsolatedAccountDir((dir) =>
        {
            fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
            fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_STACK_MEMORY_DB: '.memory-mcp/legacy.db' } })); // legacy-name
            assert.match(resolveDb(dir), /legacy\.db$/);
        });
    }
    finally { if (savedPath === undefined) delete process.env.MCP_MEMORY_SQLITE_PATH; else process.env.MCP_MEMORY_SQLITE_PATH = savedPath; }
});

test('uv-python.js pythonRequest falls back to CLAUDE_STACK_UV_PYTHON alone', () => // legacy-name
{
    const { pythonRequest } = require('../stack/mcp/uv-python.js');
    assert.equal(pythonRequest({ env: { CLAUDE_STACK_UV_PYTHON: '3.12' } }), '3.12'); // legacy-name
});

test('seed-sandbox.js scrubs both ALFRED_CODE_ and CLAUDE_STACK_ prefixes', () => // legacy-name
{
    const { scrubLegacyEnv } = require('./seed-sandbox.js');
    const scrubbed = scrubLegacyEnv({ ALFRED_CODE_FOO: '1', CLAUDE_STACK_FOO: '1', KEEP_ME: '1' }); // legacy-name
    assert.deepEqual(scrubbed, { KEEP_ME: '1' });
});
