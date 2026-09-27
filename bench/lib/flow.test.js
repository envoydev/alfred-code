'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { POSIX_ONLY } = require('../test/posix-only.js');
if (POSIX_ONLY)
{
    test('harness process tests', { skip: POSIX_ONLY }, () => {});
    return;
}
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { run } = require('./session.js');
const { cellPaths } = require('./cells.js');
const flow = require('./flow.js');
const { fakeSdk } = require('../test/fake-sdk.js');

const CLI = path.join(__dirname, '..', 'test', 'fake-claude.js');
const AUTH_VALUE = 'bench-test-auth-value-0123456789';
const SESSION = {
    model: 'claude-sonnet-5', effort: 'medium', permissionMode: 'acceptEdits', settingsFile: '/arms/harness.settings.json',
    env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }, graceSec: 0.3, auth: ['ANTHROPIC_API_KEY'], scrub: [],
};
const BASE = { PATH: process.env.PATH, ANTHROPIC_API_KEY: AUTH_VALUE, CLAUDE_PROJECT_DIR: '/host/project' };
const ARM = { name: 'solo', env: { ARM_OWN: 'yes' }, onboardingEnv: { STACK_UNATTENDED: '1' } };

function cellFor(t)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-flow-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const cell = cellPaths({ benchDir: dir, run: 'r1', arm: 'solo', task: 't1', rep: 1 });
    for (const d of [cell.config, cell.home, cell.repo]) fs.mkdirSync(d, { recursive: true });
    const git = (...a) => execFileSync('git', ['-C', cell.repo, ...a], { stdio: 'pipe' });
    git('init', '-q');
    fs.writeFileSync(path.join(cell.repo, 'app.txt'), 'one\n');
    git('add', '.');
    git('-c', 'user.name=b', '-c', 'user.email=b@example.invalid', 'commit', '-q', '-m', 'one');
    return { dir, cell };
}

// One flow cell through the plain cell's own run(): the flow driver replaces only the CLI call.
async function go(t, { prompts, turns = [], arm = ARM, timeLimitMin = 1, prompt = 'Add the $& thing.\n', lazy = false } = {})
{
    const { dir, cell } = cellFor(t);
    const seen = {};
    const sdk = await fakeSdk({ turns, seen, lazy })();
    const out = await run({ cell, prompt, session: SESSION, arm, timeLimitMin, base: BASE, driver: flow.driver({ sdk, cli: CLI, prompts }) });
    const rows = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
    return { dir, cell, seen, out, approvals: rows(path.join(cell.results, 'approvals.jsonl')), stdout: rows(cell.stdout), record: fs.existsSync(cell.session) ? JSON.parse(fs.readFileSync(cell.session, 'utf8')) : null };
}

test('the prompts go one after another, each only once the turn before it has a result, with the task prompt in place', async (t) =>
{
    const { seen, out, record } = await go(t, { prompts: ['/go {prompt}', 'then build'] });
    assert.deepStrictEqual(seen.inputs.map((i) => i.content), ['/go Add the $& thing.', 'then build'], 'the task prompt is inserted as written, its trailing newline aside');
    assert.deepStrictEqual(seen.inputs.map((i) => i.resultsBefore), [0, 1], 'the second prompt arrived only after the first turn\'s result');
    assert.strictEqual(out.outcome, 'ok');
    assert.strictEqual(record.mode, 'flow');
    assert.deepStrictEqual(record.sent.map((s) => s.template), ['/go {prompt}', 'then build']);
    assert.strictEqual(record.flowStopped, null);
    assert.strictEqual(record.transcript, true);
});

test('an SDK that pulls its input only after a result still gets every prompt: the pump counts results, it never waits on a wake-up it may have missed', async (t) =>
{
    const { seen, out } = await go(t, { prompts: ['{prompt}', 'second', 'third'], lazy: true, timeLimitMin: 0.05 });
    assert.deepStrictEqual(seen.inputs.map((i) => i.content), ['Add the $& thing.', 'second', 'third']);
    assert.strictEqual(out.outcome, 'ok');
});

test('the session is the plain cell\'s: cwd, env, settings layer, model, effort, permission mode, the CLI system prompt, the installed CLI', async (t) =>
{
    const { cell, seen, record } = await go(t, { prompts: ['{prompt}'] });
    const o = seen.options;
    assert.strictEqual(o.pathToClaudeCodeExecutable, CLI);
    assert.strictEqual(o.cwd, cell.repo);
    assert.deepStrictEqual([o.model, o.effort, o.permissionMode, o.settings], ['claude-sonnet-5', 'medium', 'acceptEdits', '/arms/harness.settings.json']);
    assert.deepStrictEqual(o.settingSources, ['user', 'project', 'local'], 'the filesystem settings the CLI loads');
    assert.deepStrictEqual(o.systemPrompt, { type: 'preset', preset: 'claude_code' }, 'claude -p runs the Claude Code system prompt; the SDK default is a minimal one');
    assert.strictEqual(o.sessionId, record.sessionId);
    assert.match(o.allowedTools[0], /^Read\(\/\/(private\/)?tmp\/bench-[^/]+\/\*\*\)$/, 'the session may read its own temp dir, as a plain cell may');
    assert.strictEqual(o.allowedTools.length, 1);
    assert.strictEqual(typeof o.canUseTool, 'function');
    assert.strictEqual(o.env.CLAUDE_CONFIG_DIR, cell.config);
    assert.strictEqual(o.env.HOME, cell.home);
    assert.strictEqual(o.env.ANTHROPIC_API_KEY, AUTH_VALUE);
    assert.strictEqual(o.env.ARM_OWN, 'yes');
    assert.ok(!('STACK_UNATTENDED' in o.env), 'the onboarding-only switch never reaches a measured cell');
    assert.ok(!('CLAUDE_PROJECT_DIR' in o.env), 'nothing of the host crosses');
    assert.ok(o.env.PATH.startsWith(path.join(cell.work, 'bin')), 'the dotnet shim dir is first, as in a plain cell');
    assert.ok(Array.isArray(record.cliArgs) && record.cliArgs.includes('--input-format'), 'the argv the SDK spawned is kept');
    assert.strictEqual(record.sdk, '0.0.0-sdk');
});

test('an ask is answered with its recommended option, else the first, and every answer is one approvals row', async (t) =>
{
    const q1 = { question: 'Gather how?', header: 'Mode', multiSelect: false, options: [{ label: 'Inline', description: 'a' }, { label: 'Seats (Recommended)', description: 'b' }] };
    const q2 = { question: 'Which fix?', header: 'Fix', multiSelect: false, options: [{ label: 'Patch', description: 'a' }, { label: 'Redesign', description: 'b' }] };
    const q3 = { question: 'Which checks?', header: 'Checks', multiSelect: true, options: [{ label: 'Lint (Recommended)', description: 'a' }, { label: 'Types', description: 'b' }, { label: 'Tests (recommended)', description: 'c' }] };
    const { seen, approvals } = await go(t, { prompts: ['{prompt}'], turns: [{ asks: [[q1, q2], [q3]] }] });
    const [first, second] = seen.permissions.map((p) => p.answer);
    assert.deepStrictEqual(first, { behavior: 'allow', updatedInput: { questions: [q1, q2], answers: { 'Gather how?': 'Seats (Recommended)', 'Which fix?': 'Patch' } } });
    assert.deepStrictEqual(second.updatedInput.answers, { 'Which checks?': 'Lint (Recommended), Tests (recommended)' });
    assert.deepStrictEqual(approvals.map((a) => [a.kind, a.question, a.answer, a.by, a.turn]), [
        ['answer', 'Gather how?', 'Seats (Recommended)', 'recommended', 1],
        ['answer', 'Which fix?', 'Patch', 'first', 1],
        ['answer', 'Which checks?', 'Lint (Recommended), Tests (recommended)', 'recommended', 1],
    ]);
    assert.deepStrictEqual(approvals[0].options, ['Inline', 'Seats (Recommended)']);
    assert.ok(approvals.every((a) => a.toolUseId && a.at));
});

test('every other permission request is refused with print mode\'s own words, and recorded', async (t) =>
{
    const tools = [
        { name: 'Bash', input: { command: 'curl https://example.invalid' } },
        { name: 'Write', input: { file_path: '/tmp/x/Program.cs', content: 'x' } },
        { name: 'Read', input: { file_path: '/elsewhere/a.txt' }, blockedPath: '/elsewhere/a.txt' },
        { name: 'mcp__plugin_x_x__go', input: {} },
    ];
    const { seen, approvals, out } = await go(t, { prompts: ['{prompt}'], turns: [{ tools }] });
    assert.deepStrictEqual(seen.permissions.map((p) => p.answer), [
        { behavior: 'deny', message: 'Claude requested permissions to use Bash, but you haven\'t granted it yet.' },
        { behavior: 'deny', message: 'Claude requested permissions to write to /tmp/x/Program.cs, but you haven\'t granted it yet.' },
        { behavior: 'deny', message: 'Claude requested permissions to read from /elsewhere/a.txt, but you haven\'t granted it yet.' },
        { behavior: 'deny', message: 'Claude requested permissions to use mcp__plugin_x_x__go, but you haven\'t granted it yet.' },
    ]);
    assert.deepStrictEqual(approvals.map((a) => [a.kind, a.tool]), [['deny', 'Bash'], ['deny', 'Write'], ['deny', 'Read'], ['deny', 'mcp__plugin_x_x__go']]);
    assert.strictEqual(out.outcome, 'ok', 'a refusal is the session\'s to handle, as in print mode');
});

test('a refusal carries the reason the CLI gives, as print mode shows it; a file tool keeps its own sentence; no reason is the CLI default', async (t) =>
{
    const tools = [
        { name: 'Bash', input: { command: 'dotnet run --project src/Api' }, decisionReason: 'This command requires approval' },
        { name: 'Bash', input: { command: 'rm -f x' } },
        { name: 'Write', input: { file_path: '/elsewhere/Program.cs' }, decisionReason: 'Path is outside allowed working directories' },
    ];
    const { seen, approvals } = await go(t, { prompts: ['{prompt}'], turns: [{ tools }] });
    assert.deepStrictEqual(seen.permissions.map((p) => p.answer.message), [
        'This command requires approval',
        'Claude requested permissions to use Bash, but you haven\'t granted it yet.',
        'Claude requested permissions to write to /elsewhere/Program.cs, but you haven\'t granted it yet.',
    ]);
    assert.deepStrictEqual(approvals.map((a) => a.decisionReason), ['This command requires approval', null, 'Path is outside allowed working directories'], 'the CLI\'s own reason is kept beside the refusal');
});

test('the first turn waits for the plugin MCP servers as print mode does: 2 seconds, every pending server', async (t) =>
{
    const { seen } = await go(t, { prompts: ['{prompt}'] });
    assert.strictEqual(seen.options.env.CLAUDE_CODE_MCP_STARTUP_WAIT_MS, '2000', 'a streaming-input session otherwise waits for no deferred server');
});

test('an ask with no option to pick is refused like any other request', async (t) =>
{
    const { seen, approvals } = await go(t, { prompts: ['{prompt}'], turns: [{ asks: [[{ question: 'Anything?', header: 'X', multiSelect: false, options: [] }]] }] });
    assert.deepStrictEqual(seen.permissions[0].answer, { behavior: 'deny', message: 'Claude requested permissions to use AskUserQuestion, but you haven\'t granted it yet.' });
    assert.deepStrictEqual(approvals.map((a) => a.kind), ['deny']);
});

test('every SDK message lands in stdout.jsonl in stream-json shape, in order', async (t) =>
{
    const { stdout } = await go(t, { prompts: ['{prompt}', 'next'], turns: [{ asks: [[{ question: 'Q?', header: 'H', multiSelect: false, options: [{ label: 'A', description: '' }, { label: 'B', description: '' }] }]] }] });
    assert.deepStrictEqual(stdout.map((m) => m.type), ['system', 'assistant', 'user', 'assistant', 'result', 'assistant', 'result']);
    assert.strictEqual(stdout[0].subtype, 'init');
});

test('a {file:} prompt names the one file the turn before it left, and a pattern that names none or several stops the flow', async (t) =>
{
    const found = await go(t, { prompts: ['{prompt}', '/build {file:.docs/diagnoses/*.md}'], turns: [{ edit: ['.docs/diagnoses/late-copy.md', '.docs/diagnoses/notes.txt'] }] });
    assert.deepStrictEqual(found.seen.inputs.map((i) => i.content), ['Add the $& thing.', '/build .docs/diagnoses/late-copy.md']);
    assert.strictEqual(found.record.sent[1].file, '.docs/diagnoses/late-copy.md');

    const none = await go(t, { prompts: ['{prompt}', '/build {file:.docs/diagnoses/*.md}', 'never'], turns: [{}] });
    assert.deepStrictEqual(none.seen.inputs.map((i) => i.content), ['Add the $& thing.']);
    assert.match(none.record.flowStopped, /prompt 2: \{file:\.docs\/diagnoses\/\*\.md\} names 0 files/);
    assert.strictEqual(none.out.outcome, 'ok', 'the session itself ended well - what it left is graded like any cell');

    const two = await go(t, { prompts: ['{prompt}', '/build {file:.docs/*.md}'], turns: [{ edit: ['.docs/a.md', '.docs/b.md'] }] });
    assert.match(two.record.flowStopped, /names 2 files/);
});

test('a turn that ends in an error result stops the flow and the cell is an error', async (t) =>
{
    const { seen, out, record } = await go(t, { prompts: ['{prompt}', 'never sent'], turns: [{ error: 'error_max_turns' }] });
    assert.strictEqual(seen.inputs.length, 1);
    assert.strictEqual(out.outcome, 'error');
    assert.match(record.flowStopped, /prompt 1 ended in an error result \(error_max_turns\)/);
});

test('a CLI that exits non-zero is an error, as in a plain cell', async (t) =>
{
    const { out } = await go(t, { prompts: ['{prompt}'], arm: { ...ARM, env: { FAKE_EXIT: '3' } } });
    assert.deepStrictEqual([out.outcome, out.exitCode], ['error', 3]);
});

test('a flow past its time limit is stopped, its whole process group with it, and recorded as timeout', async (t) =>
{
    const { dir } = cellFor(t);
    const pidFile = path.join(dir, 'grandchild.pid');
    const { out, record } = await go(t, { prompts: ['{prompt}', 'never sent'], turns: [{ hang: true }], arm: { ...ARM, env: { FAKE_HANG: pidFile, FAKE_IGNORE_TERM: '1' } }, timeLimitMin: 0.005 });
    assert.strictEqual(out.outcome, 'timeout');
    assert.strictEqual(out.signal, 'SIGKILL', 'a CLI that ignores TERM is killed after the grace period');
    assert.ok(out.wallMs < 5000);
    assert.strictEqual(record.sent.length, 1);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    let alive = true;
    for (let i = 0; i < 50 && alive; i++)
    {
        try { process.kill(pid, 0); await new Promise((r) => setTimeout(r, 20)); }
        catch { alive = false; }
    }
    assert.strictEqual(alive, false, 'a build or test the session started dies with it');
});

test('a usage limit sets the flow cell aside, as a plain cell', async (t) =>
{
    const { out, cell } = await go(t, { prompts: ['{prompt}', 'never sent'], turns: [{ limit: true }] });
    assert.strictEqual(out.outcome, 'limited');
    assert.ok(!fs.existsSync(cell.session));
    assert.match(out.limitText, /usage limit reached/);
    assert.ok(fs.existsSync(path.join(out.setAside, 'stdout.jsonl')), 'what it did is kept for the record');
});

test('the auth value never survives in stdout or the approvals file', async (t) =>
{
    const leaky = { question: `Use ${AUTH_VALUE}?`, header: 'H', multiSelect: false, options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }] };
    const { cell } = await go(t, { prompts: ['{prompt}'], turns: [{ leak: true, asks: [[leaky]] }] });
    for (const file of [cell.stdout, path.join(cell.results, 'approvals.jsonl'), cell.transcript])
    {
        const text = fs.readFileSync(file, 'utf8');
        assert.ok(!text.includes(AUTH_VALUE), path.basename(file));
        assert.ok(text.includes('<redacted:ANTHROPIC_API_KEY>'), path.basename(file));
    }
});

test('the SDK must be the one built for the CLI the run drives', () =>
{
    assert.doesNotThrow(() => flow.assertSdkMatches({ version: '0.3.283', claudeCodeVersion: '2.1.283' }, '2.1.283 (Claude Code)'));
    assert.throws(() => flow.assertSdkMatches({ version: '0.3.283', claudeCodeVersion: '2.1.283' }, '2.1.284 (Claude Code)'), /Agent SDK 0\.3\.283 is built for Claude Code 2\.1\.283 - this CLI is 2\.1\.284 \(Claude Code\)/);
    assert.throws(() => flow.assertSdkMatches({ version: '0.3.283' }, '2.1.283 (Claude Code)'), /names no Claude Code version/);
});

test('the CLI a flow drives is the one on the PATH the plain cells use, resolved to a file', (t) =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-flow-bin-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const bin = path.join(dir, 'claude');
    fs.writeFileSync(bin, '#!/bin/sh\n');
    fs.chmodSync(bin, 0o755);
    assert.strictEqual(flow.cliPath(['claude'], `/nowhere${path.delimiter}${dir}`), bin);
    assert.throws(() => flow.cliPath(['claude'], '/nowhere'), /no claude on the PATH/);
    assert.strictEqual(flow.cliPath([process.execPath, CLI], ''), CLI, 'a node-run CLI is its script');
});

test('the Agent SDK the repo pins is the one built for the pinned Claude Code', async (t) =>
{
    const pinned = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).devDependencies[flow.SDK_PACKAGE];
    assert.strictEqual(pinned, '0.3.283', 'an exact pin: the SDK speaks one CLI\'s control protocol');
    let sdk;
    try { sdk = await flow.loadSdk(); }
    catch (err)
    {
        if (/not installed/.test(err.message)) { t.skip('the Agent SDK is not installed here - npm install'); return; }
        throw err;
    }
    assert.deepStrictEqual([sdk.version, sdk.claudeCodeVersion, typeof sdk.query], ['0.3.283', '2.1.283', 'function']);
});
