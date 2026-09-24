'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOOKS_DIR = path.join(__dirname, '..', 'stack', 'hooks');
// The fifteen the installers wire. The two engines (docs.js, memory.js) are copied beside them and
// never wired, so they carry no gate.
const WIRED = [
    'guard-protected-force-push', 'guard-catastrophic-rm', 'guard-read-whole-file', 'guard-secret-value',
    'guard-unapproved-dispatch', 'guard-ungated-commit', 'guard-stop-contract', 'guard-fresh-session-start',
    'guard-cross-project-write', 'guard-config-protection', 'guard-answer-length', 'docs-session', 'memory-session',
    'monitor-session', 'check-turn-build', 'history-session', 'instrument-tool-usage',
];

// A payload every hook parses without acting: a benign Bash read in the project root.
const payload = (dir) => JSON.stringify({
    session_id: 'parity-test',
    cwd: dir,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo hello' },
});

function fixture(wiredHook)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-'));
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({
        hooks: {
            PreToolUse: [{
                matcher: 'Bash',
                hooks: [{ type: 'command', command: `"$CLAUDE_PROJECT_DIR/.claude/hooks/${wiredHook}.js"`, timeout: 10 }],
            }],
        },
    }));
    return dir;
}

function run(hook, dir, env)
{
    const file = path.join(HOOKS_DIR, hook + '.js');
    try
    {
        const out = execFileSync(process.execPath, [file], {
            input: payload(dir), encoding: 'utf8', timeout: 20000,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ALFRED_CODE_HOOKS_OFF: '', ...env },
        });
        return { status: 0, out };
    }
    catch (err) { return { status: err.status === undefined ? -1 : err.status, out: String(err.stdout || '') + String(err.stderr || '') }; }
}

test('all thirteen wired hooks carry the gate block, and the two engines do not', () => {
    for (const hook of WIRED)
    {
        const text = fs.readFileSync(path.join(HOOKS_DIR, hook + '.js'), 'utf8');
        assert.ok(text.includes('STACK HOOK GATES'), `${hook} must carry the gate block`);
        assert.ok(text.includes(`standDown('${hook}')`), `${hook} must name ITSELF in standDown`);
        assert.ok(text.includes('require.main === module'), `${hook}'s gate must not fire when required by a test`);
    }
    for (const engine of ['docs', 'memory'])
        assert.ok(!fs.readFileSync(path.join(HOOKS_DIR, engine + '.js'), 'utf8').includes('STACK HOOK GATES'),
            `${engine}.js is an engine, never wired, so it carries no gate`);
});

test('every wired hook stands down when the project still wires its copied twin', () => {
    for (const hook of WIRED)
    {
        const dir = fixture(hook);
        const result = run(hook, dir, { CLAUDE_PLUGIN_ROOT: '/somewhere/plugin' });
        assert.strictEqual(result.status, 0, `${hook} must exit 0 when standing down, got ${result.status}: ${result.out}`);
        assert.strictEqual(result.out.trim(), '', `${hook} must print nothing when standing down, got: ${result.out}`);
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('every wired hook stands down when ALFRED_CODE_HOOKS_OFF names it', () => {
    for (const hook of WIRED)
    {
        const dir = fixture('some-other-hook');
        const result = run(hook, dir, { ALFRED_CODE_HOOKS_OFF: `something-else, ${hook}` });
        assert.strictEqual(result.status, 0, `${hook} must exit 0 when switched off, got ${result.status}: ${result.out}`);
        assert.strictEqual(result.out.trim(), '', `${hook} must print nothing when switched off`);
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a hook whose NEIGHBOUR is wired or switched off still runs', () => {
    for (const hook of WIRED)
    {
        const dir = fixture('guard-not-a-real-hook');
        const result = run(hook, dir, { CLAUDE_PLUGIN_ROOT: '/somewhere/plugin', ALFRED_CODE_HOOKS_OFF: 'guard-nothing' });
        assert.ok(result.status === 0 || result.status === 2,
            `${hook} must run normally (exit 0 or 2), got ${result.status}: ${result.out.slice(0, 200)}`);
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a missing prelude leaves every hook running - the gate is fail-open', () => {
    // Everything a real install carries EXCEPT the prelude: the engines and the window table are
    // copied beside the hooks, so their absence would be a different bug than the one under test.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noprelude-'));
    for (const hook of WIRED) fs.copyFileSync(path.join(HOOKS_DIR, hook + '.js'), path.join(tmp, hook + '.js'));
    for (const extra of ['docs.js', 'memory.js', 'model-windows.json'])
        fs.copyFileSync(path.join(HOOKS_DIR, extra), path.join(tmp, extra));
    const dir = fixture('guard-read-whole-file');
    for (const hook of WIRED)
    {
        const result = (() =>
        {
            try
            {
                const out = execFileSync(process.execPath, [path.join(tmp, hook + '.js')], {
                    input: payload(dir), encoding: 'utf8', timeout: 20000,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: '/p', ALFRED_CODE_HOOKS_OFF: hook },
                });
                return { status: 0, out };
            }
            catch (err) { return { status: err.status === undefined ? -1 : err.status, out: String(err.stderr || '') }; }
        })();
        assert.ok(result.status === 0 || result.status === 2,
            `${hook} without a prelude must still run, got ${result.status}: ${result.out.slice(0, 200)}`);
        assert.ok(!/Cannot find module/.test(result.out), `${hook} must swallow the missing prelude, not report it`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
});
