'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PRELUDE = path.join(__dirname, '..', 'stack', 'hooks', 'hook-prelude.js');
const { hookDisabled, yieldToCopiedTwin, standDown } = require(PRELUDE);

function project(settings)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prelude-'));
    fs.mkdirSync(path.join(dir, '.claude'));
    if (settings !== null) fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), settings);
    return dir;
}

const wiring = (file) => JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `"$CLAUDE_PROJECT_DIR/.claude/hooks/${file}"`, timeout: 10 }] }] },
});

test('ALFRED_CODE_HOOKS_OFF names hooks exactly, with or without the .js suffix', () => {
    const env = { ALFRED_CODE_HOOKS_OFF: 'guard-secret-value, docs-session.js' };
    assert.strictEqual(hookDisabled('guard-secret-value', env), true);
    assert.strictEqual(hookDisabled('guard-secret-value.js', env), true);
    assert.strictEqual(hookDisabled('docs-session', env), true);
    assert.strictEqual(hookDisabled('GUARD-SECRET-VALUE', env), true, 'case is not a way to miss');
    assert.strictEqual(hookDisabled('guard-secret', env), false, 'a prefix is NOT a match');
    assert.strictEqual(hookDisabled('guard-secret-value-extra', env), false);
    assert.strictEqual(hookDisabled('guard-stop-contract', env), false);
});

test('an empty, absent or junk ALFRED_CODE_HOOKS_OFF disables nothing', () => {
    for (const value of [undefined, '', '   ', ',', ' , , '])
        assert.strictEqual(hookDisabled('guard-secret-value', { ALFRED_CODE_HOOKS_OFF: value }), false,
            `value ${JSON.stringify(value)} must disable nothing`);
});

test('a COPIED hook never yields - only the plugin copy steps aside', () => {
    const dir = project(wiring('guard-secret-value.js'));
    assert.strictEqual(yieldToCopiedTwin('guard-secret-value.js', { CLAUDE_PROJECT_DIR: dir }), false,
        'no CLAUDE_PLUGIN_ROOT means this IS the copied hook');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('the plugin copy yields when the project still wires its own twin, and only then', () => {
    const dir = project(wiring('guard-secret-value.js'));
    const env = { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: '/somewhere/plugin' };
    assert.strictEqual(yieldToCopiedTwin('guard-secret-value.js', env), true);
    assert.strictEqual(yieldToCopiedTwin('guard-secret-value', env), true, 'the suffix is optional');
    assert.strictEqual(yieldToCopiedTwin('guard-stop-contract.js', env), false,
        'a different hook being wired is not this hook being wired');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('an unquoted legacy wiring counts too - both spellings shipped', () => {
    const dir = project(JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/.claude/hooks/guard-stop-contract.js' }] }] },
    }));
    assert.strictEqual(yieldToCopiedTwin('guard-stop-contract.js', { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: '/p' }), true);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('a hook wired from somewhere else is not a twin', () => {
    const dir = project(JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: '/Users/someone/own-hooks/guard-stop-contract.js' }] }] },
    }));
    assert.strictEqual(yieldToCopiedTwin('guard-stop-contract.js', { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: '/p' }), false,
        'the user may run their own copy of a same-named hook, and the plugin must not go silent for it');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('both gates FAIL OPEN - a missing, empty or malformed settings file yields nothing and throws nothing', () => {
    const plugin = '/somewhere/plugin';
    for (const body of [null, '', '{', '{"hooks": null}', '[]', 'null'])
    {
        const dir = project(body);
        assert.doesNotThrow(() => yieldToCopiedTwin('guard-secret-value.js', { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: plugin }),
            `body ${JSON.stringify(body)} must not throw`);
        assert.strictEqual(yieldToCopiedTwin('guard-secret-value.js', { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: plugin }), false,
            `body ${JSON.stringify(body)} must not silence the plugin hook`);
        fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.strictEqual(yieldToCopiedTwin('guard-secret-value.js', { CLAUDE_PLUGIN_ROOT: plugin }), false,
        'no project dir at all is not a reason to go silent');
});

test('the prelude reads process.env when no env is handed in', () => {
    const before = process.env.ALFRED_CODE_HOOKS_OFF;
    process.env.ALFRED_CODE_HOOKS_OFF = 'guard-answer-length';
    try { assert.strictEqual(hookDisabled('guard-answer-length'), true); }
    finally { if (before === undefined) delete process.env.ALFRED_CODE_HOOKS_OFF; else process.env.ALFRED_CODE_HOOKS_OFF = before; }
});

// guard-secret-value.js is also the sanctioned CLI for reading a credential's PRESENCE, and
// docs.js / memory.js are run by path from 22 shared bodies. Switching a guard off must not take
// its CLI away - a hook invocation never carries an argument, so a leading flag means CLI.
test('a --flag invocation is never gated, however the env reads', () => {
    const env = { ALFRED_CODE_HOOKS_OFF: 'guard-secret-value', CLAUDE_PLUGIN_ROOT: '/p', CLAUDE_PROJECT_DIR: '/x' };
    assert.strictEqual(standDown('guard-secret-value', env, ['node', 'guard-secret-value.js', '--presence', '/tmp/f']), false);
    assert.strictEqual(standDown('guard-secret-value', env, ['node', 'guard-secret-value.js', '--redacted-env']), false);
    assert.strictEqual(standDown('guard-secret-value', env, ['node', 'guard-secret-value.js']), true, 'the hook route is still gated');
});
