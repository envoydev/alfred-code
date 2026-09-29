'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
for (const k of Object.keys(process.env)) if (k.startsWith('CLAUDE_STACK_') || k === 'CLAUDE_DOCS_PATH') delete process.env[k]; // C19: a 1.x install's ambient spelling answers through envOf too - legacy-name

const HOOKS_DIR = path.join(__dirname, '..', 'stack', 'hooks');
// Every hook the manifest wires, read from the manifest itself - a hand list drifted twice ('fifteen'
// over seventeen rows). The engines (docs.js, memory.js, history.js) are copied beside them and never
// wired, so they carry no gate.
const { loadManifest } = require('./install/manifest.js');
const WIRED = [...new Set(loadManifest(path.join(__dirname, '..')).catalogs.hooks.map((e) => e.split('::')[0].replace(/\.js$/, '')))];

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
    // Set up: a project with no install record is gate 4's case (the last test here), not these.
    fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'version: 2.0.0\n');
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

test('every wired hook carries the gate block, and the engines do not', () => {
    assert.ok(WIRED.length >= 17, `the manifest read back ${WIRED.length} wired hooks`);
    for (const hook of WIRED)
    {
        const text = fs.readFileSync(path.join(HOOKS_DIR, hook + '.js'), 'utf8');
        assert.ok(text.includes('STACK HOOK GATES'), `${hook} must carry the gate block`);
        // Options may follow the name (the dispatch guard's `{ setUp: false }`, M9); the name is what is held.
        assert.ok(text.includes(`standDown('${hook}')`) || text.includes(`standDown('${hook}',`), `${hook} must name ITSELF in standDown`);
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

// R54 / Task 16 review M8: under a user-scope core every hook runs in every repo the user opens. A repo
// never set up gets nothing written - no .claude/docs/ ledger, history, state or compact file - from
// any of them, whatever the event. Each payload is one the hook acts on in a set-up project. R86: the
// PROTECTIVE guards stay live there (the rm guard still blocks `rm -rf /`), and skip their row.
test('in a never-set-up project every plugin-launched hook writes nothing, and only the protective guards speak', () => {
    const { PROTECTIVE } = require(path.join(HOOKS_DIR, 'hook-prelude.js'));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-unset-'));
    execFileSync('git', ['init', '-q', repo]);
    fs.writeFileSync(path.join(repo, 'big.js'), 'x'.repeat(200000));
    const events = [
        { hook_event_name: 'SessionStart', source: 'startup' },
        { hook_event_name: 'UserPromptSubmit', prompt: 'hello' },
        { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(repo, 'big.js') } },
        { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } },
        { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(repo, 'a.ts') } },
        { hook_event_name: 'PreCompact', trigger: 'auto' },
        { hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Done \u2014 all good.' },
    ];
    try
    {
        for (const hook of WIRED)
            for (const event of events)
            {
                let out = '';
                let status = 0;
                try
                {
                    out = execFileSync(process.execPath, [path.join(HOOKS_DIR, hook + '.js')], {
                        input: JSON.stringify({ session_id: 'unset-test', cwd: repo, ...event }), encoding: 'utf8', timeout: 20000,
                        stdio: ['pipe', 'pipe', 'pipe'],
                        env: { ...process.env, CLAUDE_PROJECT_DIR: repo, CLAUDE_PLUGIN_ROOT: '/cfg/plugins/cache/envoydev/alfred-code/2.0.0', ALFRED_CODE_HOOKS_OFF: '', ALFRED_CODE_INSTRUMENT: '1', ALFRED_CODE_TURN_CHECK: '1' },
                    });
                }
                catch (err) { status = err.status; out = String(err.stdout || '') + String(err.stderr || ''); }
                if (PROTECTIVE.has(hook))
                {
                    const destructive = event.tool_input && event.tool_input.command === 'rm -rf /';
                    assert.strictEqual(status, hook === 'guard-catastrophic-rm' && destructive ? 2 : 0, `${hook} on ${event.hook_event_name} stays live: ${out.slice(0, 200)}`);
                }
                else
                {
                    assert.strictEqual(status, 0, `${hook} on ${event.hook_event_name} must stand down, got ${status}: ${out.slice(0, 200)}`);
                    assert.strictEqual(out.trim(), '', `${hook} on ${event.hook_event_name} printed: ${out.slice(0, 200)}`);
                }
                assert.ok(!fs.existsSync(path.join(repo, '.claude')), `${hook} on ${event.hook_event_name} wrote .claude/ into a repo never set up`);
            }
    }
    finally { fs.rmSync(repo, { recursive: true, force: true }); }
});
