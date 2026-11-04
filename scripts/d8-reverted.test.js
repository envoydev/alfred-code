'use strict';
// D8 left the stack (O3, docs/d8-seats-ab-evidence.md): the billed A/B measured no win for the heavy-session seats, so
// the Seats fact line, its engine facts and the skills' heavy-session text were reverted to arm A. These pins keep it out.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
for (const k of Object.keys(process.env)) if (k.startsWith('ALFRED_CODE_')) delete process.env[k];
delete process.env.CLAUDE_PLUGIN_ROOT;
delete process.env.CLAUDE_CODE_ENTRYPOINT;
delete process.env.CLAUDE_PROJECT_DIR;

const ROOT = path.join(__dirname, '..');
const HOOKS = path.join(ROOT, 'stack', 'hooks');
const D8_MARKER = /\*\*Seats:\*\*|serial seats|[Hh]eavy session|'Model' bullet|SEATS_SKILLS|seatsFacts|modelFamily|MODEL_TIER|SEAT_PRICE|SEAT_IDS|priceMultiple/;

const filesUnder = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test('no shipped file carries D8 text', () => {
    const marked = filesUnder(path.join(ROOT, 'stack'))
        .filter((f) => D8_MARKER.test(fs.readFileSync(f, 'utf8')))
        .map((f) => path.relative(ROOT, f));
    assert.deepStrictEqual(marked, []);
});

test('the engine exports no seat facts', () => {
    const eng = require(path.join(HOOKS, 'fresh-session.js'));
    for (const name of ['modelFamily', 'priceMultiple', 'seatsFacts', 'MODEL_TIER', 'SEAT_IDS', 'SEAT_PRICE'])
        assert.ok(!(name in eng), `fresh-session.js exports ${name}`);
});

// The hook harness, as seats-line.test.js ran it before the revert.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'd8-reverted-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));

let n = 0;
function project() {
    const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
    fs.mkdirSync(path.join(root, '.alfred', 'state', 'approvals'), { recursive: true });
    return { root, blocks: path.join(root, '.alfred', 'statistics', 'hook-blocks') };
}
function transcript(model) {
    const p = path.join(TMP, `t-${++n}.jsonl`);
    const at = new Date(Date.now() - 60000).toISOString();
    const rows = [{ type: 'user', entrypoint: 'cli', timestamp: at, message: { role: 'user', content: [{ type: 'text', text: 'go' }] } },
        { type: 'assistant', entrypoint: 'cli', timestamp: at, message: { id: `m${++n}`, model, role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { cache_creation_input_tokens: 20000 } } },
        { type: 'assistant', entrypoint: 'cli', timestamp: at, message: { id: `m${++n}`, model, role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { cache_read_input_tokens: 30000 } } }];
    fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return p;
}
const WINDOW_SEEDS = { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '400000', ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: '280000',
    ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '180000', ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '180000' };
const run = (payload, env) => spawnSync(process.execPath, [path.join(HOOKS, 'guard-fresh-session-start.js')],
    { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ...WINDOW_SEEDS, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'log-')), ...env } });
const context = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { return ''; } };
const typed = (p, sid, skill, t) => run({ hook_event_name: 'UserPromptExpansion', session_id: sid, cwd: p.root, transcript_path: t,
    expansion_type: 'slash_command', command_name: skill, command_args: 'x', prompt: `/${skill} x` }, { CLAUDE_PROJECT_DIR: p.root });
const viaSkill = (p, sid, skill, t) => run({ hook_event_name: 'PreToolUse', tool_name: 'Skill', session_id: sid, cwd: p.root,
    transcript_path: t, tool_input: { skill, args: '' } }, { CLAUDE_PROJECT_DIR: p.root });
const rows = (p, sid) => { try { return fs.readFileSync(path.join(p.blocks, `${sid}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; } };

test('typed /task-solve on opus prints the banner and no Seats line', () => {
    for (const model of ['claude-opus-5-5', 'claude-fable-5-1']) {
        const p = project();
        const r = typed(p, `t-${model}`, 'task-solve', transcript(model));
        assert.strictEqual(r.status, 0, r.stderr);
        const c = context(r);
        assert.ok(c.includes('**Auto-run:'), `${model}: no banner: ${r.stdout}`);
        assert.ok(!c.includes('**Seats:**'), `${model}: ${c}`);
    }
});

test('Skill calls to task-design and habits-execution-strategy on opus print no Seats line', () => {
    const p = project();
    for (const skill of ['task-design', 'habits-execution-strategy']) {
        const sid = `s-${skill}`;
        const r = viaSkill(p, sid, skill, transcript('claude-opus-5-5'));
        assert.strictEqual(r.status, 0, r.stderr);
        assert.ok(!r.stdout.includes('**Seats:**'), `${skill}: ${r.stdout}`);
        assert.deepStrictEqual(rows(p, sid).filter((row) => row.kind === 'seats-line'), [], skill);
    }
});
