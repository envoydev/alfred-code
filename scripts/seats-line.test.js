'use strict';
// D8 (spec docs/superpowers/specs/2026-11-03-d8-heavy-session-seats-design.md): the engine half - a model's family,
// tier and price multiple against the seats' own pins - and the hook half (appended by the next task).
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
const eng = require(path.join(ROOT, 'stack', 'hooks', 'fresh-session.js'));

test('modelFamily reads the family out of every Claude id form', () => {
    for (const [id, fam] of [['claude-opus-5-5', 'opus'], ['claude-sonnet-5-5-20261001', 'sonnet'], ['us.anthropic.claude-fable-5-1-v1:0', 'fable'],
        ['claude-opus-5-5[1m]', 'opus'], ['claude-haiku-5-5', 'haiku'], ['claude-mythos-5-1', 'mythos'], ['claude-3-5-haiku', 'haiku']])
        assert.equal(eng.modelFamily(id), fam, id);
    for (const id of [null, '', 'opus', 'claude-foo-9', 'gpt-5']) assert.equal(eng.modelFamily(id), null, String(id));
});
test('priceMultiple gives one ratio or a range, null for an unknown row', () => {
    assert.equal(eng.priceMultiple('claude-opus-5-5', 'claude-sonnet-5-5'), '2x');
    assert.equal(eng.priceMultiple('claude-fable-5-1', 'claude-sonnet-5-5'), '2.5x-5x');
    assert.equal(eng.priceMultiple('claude-fable-5-1', 'claude-opus-5-5'), '1.25x-2.5x');
    assert.equal(eng.priceMultiple('claude-opus-9', 'claude-sonnet-5-5'), null);
});
test('seatsFacts: designers only above opus', () => {
    assert.deepEqual(eng.seatsFacts('claude-opus-5-5'), { id: 'claude-opus-5-5', family: 'opus', tier: 3, multiple: '2x', designers: null });
    assert.equal(eng.seatsFacts('claude-fable-5-1').designers, '1.25x-2.5x');
    assert.equal(eng.seatsFacts('claude-foo-9'), null);
});
test('the tier table and the seat ids are frozen and ordered', () => {
    assert.ok(Object.isFrozen(eng.MODEL_TIER) && Object.isFrozen(eng.SEAT_IDS) && Object.isFrozen(eng.SEAT_PRICE));
    assert.deepEqual({ ...eng.MODEL_TIER }, { haiku: 1, sonnet: 2, opus: 3, fable: 4, mythos: 4 });
    assert.deepEqual({ ...eng.SEAT_IDS }, { sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' });
});
test('every seat pin matches the tier table', () => {
    const dir = path.join(ROOT, 'stack', 'agents');
    const seen = { implementer: 0, verifier: 0, resolver: 0 };
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md'))) {
        const name = f.replace(/\.md$/, '');
        const fm = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
        const model = fm && /^model:\s*(\S+)/m.exec(fm[1]);
        assert.ok(model, `${name} has a model pin`);
        if (/-(implementer|verifier|resolver|analyzer)$|^evidence-gatherer$/.test(name)) assert.equal(model[1], 'sonnet', name);
        if (/-solution-designer$|^security-auditor$/.test(name)) assert.equal(model[1], 'opus', name);
        for (const k of Object.keys(seen)) if (name.endsWith('-' + k)) seen[k]++;
    }
    assert.ok(seen.implementer >= 10 && seen.verifier >= 10 && seen.resolver >= 4, JSON.stringify(seen));
});

// ---------------------------------------------------------------------------------------------
// the hook half: the Seats fact line on both routes into a flow
// ---------------------------------------------------------------------------------------------
const HOOKS = path.join(ROOT, 'stack', 'hooks');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seats-line-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
const OPUS = 'claude-opus-5-5';
const HEAD = '**Seats:** this session runs claude-opus-5-5, 2x the price of';

let n = 0;
function project() {
    const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
    fs.mkdirSync(path.join(root, '.alfred', 'state', 'approvals'), { recursive: true });
    return { root, blocks: path.join(root, '.alfred', 'statistics', 'hook-blocks'), models: path.join(root, '.alfred', 'state', 'sessions', 'models.json') };
}
function transcript(rows = [], model = OPUS, ctx = 30000) {
    const p = path.join(TMP, `t-${++n}.jsonl`);
    const at = new Date(Date.now() - 60000).toISOString();
    const base = [{ type: 'user', entrypoint: 'cli', timestamp: at, message: { role: 'user', content: [{ type: 'text', text: 'go' }] } }];
    if (model) {
        base.push({ type: 'assistant', entrypoint: 'cli', timestamp: at, message: { id: `m${++n}`, model, role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { cache_creation_input_tokens: 20000 } } });
        base.push({ type: 'assistant', entrypoint: 'cli', timestamp: at, message: { id: `m${++n}`, model, role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { cache_read_input_tokens: ctx } } });
    }
    fs.writeFileSync(p, [...base, ...rows].map((r) => JSON.stringify(r)).join('\n') + '\n');
    return p;
}
const WINDOW_SEEDS = { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '400000', ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: '280000',
    ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '180000', ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '180000' };
const run = (payload, env = {}, hooks = HOOKS) => spawnSync(process.execPath, [path.join(hooks, 'guard-fresh-session-start.js')],
    { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ...WINDOW_SEEDS, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'log-')), ...env } });
const context = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { return ''; } };
const typed = (p, sid, skill, t, env = {}, extra = {}, hooks) => run({ hook_event_name: 'UserPromptExpansion', session_id: sid, cwd: p.root, transcript_path: t,
    expansion_type: 'slash_command', command_name: skill, command_args: 'x', prompt: `/${skill} x`, ...extra }, { CLAUDE_PROJECT_DIR: p.root, ...env }, hooks);
const viaSkill = (p, sid, skill, t, env = {}, extra = {}, args = '') => run({ hook_event_name: 'PreToolUse', tool_name: 'Skill', session_id: sid, cwd: p.root,
    transcript_path: t, tool_input: { skill, args }, ...extra }, { CLAUDE_PROJECT_DIR: p.root, ...env });
const rows = (p, sid) => { try { return fs.readFileSync(path.join(p.blocks, `${sid}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; } };
const seatRows = (p, sid) => rows(p, sid).filter((r) => r.kind === 'seats-line');

test('typed /task-solve on opus-5-5 prints the line after the banner', () => {
    const p = project();
    const r = typed(p, 's1', 'task-solve', transcript());
    assert.strictEqual(r.status, 0, r.stderr);
    const c = context(r);
    assert.ok(c.includes(HEAD), c);
    assert.ok(c.indexOf('**Auto-run:') >= 0 && c.indexOf('**Auto-run:') < c.indexOf('**Seats:**'), 'after the banner');
    assert.match(c, /the designers run claude-opus-5-5 - `habits-execution-strategy` 'Model' says which steps move\./);
});
test('typed /review-code on opus-5-5 prints the line, with no banner', () => {
    const p = project();
    const c = context(typed(p, 's2', 'review-code', transcript()));
    assert.ok(c.includes(HEAD), c);
    assert.ok(!c.includes('**Auto-run:'), 'review-code gets no banner');
});
test('Skill calls to task-design and habits-execution-strategy print the line', () => {
    const p = project();
    for (const skill of ['task-design', 'habits-execution-strategy']) {
        const r = viaSkill(p, `s3-${skill}`, skill, transcript());
        assert.strictEqual(r.status, 0, r.stderr);
        assert.ok(context(r).includes(HEAD), `${skill}: ${r.stdout}`);
    }
});
test('a Skill call to a disable-model-invocation flow is denied and prints no line', () => {
    const p = project();
    const dir = path.join(p.root, '.claude', 'skills', 'task-solve');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: task-solve\ndescription: x\ndisable-model-invocation: true\n---\nbody\n');
    const r = viaSkill(p, 's4', 'task-solve', transcript());
    assert.strictEqual(r.status, 2);
    assert.ok(!r.stdout.includes('**Seats:**'));
    assert.strictEqual(seatRows(p, 's4').length, 0);
});
test('fable-5-1 names the designers lighter', () => {
    const p = project();
    const c = context(typed(p, 's5', 'task-solve', transcript([], 'claude-fable-5-1')));
    assert.ok(c.includes('**Seats:** this session runs claude-fable-5-1, 2.5x-5x the price of'), c);
    assert.ok(c.includes('the designers run claude-opus-5-5, 1.25x-2.5x lighter'), c);
});
test('no line on sonnet-5-5, haiku-5-5, claude-foo-9 or an empty transcript', () => {
    const p = project();
    for (const m of ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-foo-9', null]) {
        const r = typed(p, `s6-${m}`, 'task-solve', transcript([], m));
        assert.strictEqual(r.status, 0, r.stderr);
        assert.ok(!context(r).includes('**Seats:**'), String(m));
        const q = viaSkill(p, `s6q-${m}`, 'task-design', transcript([], m));
        assert.strictEqual(q.status, 0);
        assert.ok(!context(q).includes('**Seats:**'), `skill route ${m}`);
    }
});
test('print mode and ALFRED_CODE_UNATTENDED=1 skip the banner but print the line', () => {
    const p = project();
    for (const env of [{ CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }, { ALFRED_CODE_UNATTENDED: '1' }]) {
        const c = context(typed(p, `s7-${Object.keys(env)[0]}`, 'task-solve', transcript([], OPUS), env));
        assert.ok(c.includes(HEAD), c);
        assert.ok(!c.includes('**Auto-run:'), 'no banner');
    }
});
test("a subagent's Skill call prints nothing", () => {
    const p = project();
    const r = viaSkill(p, 's8', 'task-design', transcript(), {}, { agent_id: 'a1' });
    assert.strictEqual(r.status, 0);
    assert.ok(!r.stdout.includes('**Seats:**'));
    assert.strictEqual(seatRows(p, 's8').length, 0);
});
test('a Skill call outside the set prints nothing', () => {
    const p = project();
    const r = viaSkill(p, 's9', 'markdown-style', transcript());
    assert.ok(!r.stdout.includes('**Seats:**'));
});
test('the auto-run contract and the compact note carry the line', () => {
    const p = project();
    const on = { type: 'user', entrypoint: 'cli', timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'text', text: '/task-design --mode-auto-run-on' }] } };
    const a = context(viaSkill(p, 's10', 'task-design', transcript([on]), {}, {}, '--mode-auto-run-on'));
    assert.match(a, /auto-run is ON/);
    assert.ok(a.includes(HEAD), 'the contract run carries the line');
    const b = context(viaSkill(p, 's10b', 'task-design', transcript(), { ALFRED_CODE_AUTO_COMPACT: '1' }));
    assert.ok(b.includes('auto-compact') || b.includes('compacts'), b);
    assert.ok(b.includes(HEAD), 'the compact note carries the line');
    const again = context(viaSkill(p, 's10b', 'task-design', transcript(), { ALFRED_CODE_AUTO_COMPACT: '1' }));
    assert.ok(again.includes(HEAD) && !again.includes('auto-compact is on'), 'the note once, the line each call');
});
test('a switch down prints the down line, a switch up the full one', () => {
    const p = project();
    assert.ok(context(viaSkill(p, 's11', 'task-design', transcript())).includes(HEAD));
    const down = context(viaSkill(p, 's11', 'task-design', transcript([], 'claude-sonnet-5-5')));
    assert.ok(down.includes("**Seats:** this session now runs claude-sonnet-5-5, the seats' own tier - no step moves for the model."), down);
    assert.ok(context(viaSkill(p, 's11', 'task-design', transcript())).includes(HEAD), 'back up: the full line');
    assert.ok(!context(viaSkill(p, 's11-new', 'task-design', transcript([], 'claude-sonnet-5-5'))).includes('**Seats:**'), 'a new sonnet session says nothing');
});
test("a garbage models.json follows the transcript's model", () => {
    const p = project();
    fs.mkdirSync(path.dirname(p.models), { recursive: true });
    fs.writeFileSync(p.models, '{not json');
    const a = typed(p, 's12', 'task-solve', transcript());
    assert.strictEqual(a.status, 0, a.stderr);
    assert.ok(context(a).includes(HEAD));
    const b = typed(p, 's12b', 'task-solve', transcript([], null));
    assert.strictEqual(b.status, 0, b.stderr);
    assert.ok(!context(b).includes('**Seats:**'));
});
test('each print writes one probe row, a blocked call none', () => {
    const p = project();
    typed(p, 's13', 'task-solve', transcript());
    viaSkill(p, 's13', 'task-design', transcript());
    const got = seatRows(p, 's13');
    assert.deepStrictEqual(got.map((r) => r.detail.route).sort(), ['skill', 'typed']);
    assert.ok(got.every((r) => r.mode === 'probe' && r.detail.model === OPUS && r.detail.multiple === '2x' && r.detail.down === false), JSON.stringify(got));
    // the size-offer block (exit 2): a transcript past the window's trigger
    const big = viaSkill(p, 's13b', 'task-solve-cross', transcript([], OPUS, 600000));
    assert.strictEqual(big.status, 2, `${big.status} ${big.stdout} ${big.stderr}`);
    assert.strictEqual(seatRows(p, 's13b').length, 0, 'a blocked call writes no row');
});
test('a hook without fresh-session.js still runs', () => {
    const dir = fs.mkdtempSync(path.join(TMP, 'hooks-'));
    for (const f of fs.readdirSync(HOOKS)) if (f !== 'fresh-session.js') { try { fs.copyFileSync(path.join(HOOKS, f), path.join(dir, f)); } catch { /* a folder */ } }
    const p = project();
    const r = typed(p, 's14', 'task-solve', transcript(), {}, {}, dir);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(context(r).includes('**Auto-run:'), 'the banner prints');
    assert.ok(!context(r).includes('**Seats:**'), 'no line without the engine');
});
