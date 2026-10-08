// The guided walks' layer turn must carry the pasted table before its selection ask. The prose
// mandate failed in a real setup run: the agents ask named rows 3-5, 11-19, 32-34 and the user
// answered 'I do not see any table'. The plugin hook denies that ask - both directions pinned here.
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
// The hook writes its block row under CLAUDE_PROJECT_DIR || cwd: every spawn runs in the suite's own project, or the
// rows land in the checkout's real ledger (audit 2026-10-08: 494 nosession.jsonl rows were this suite's).
const { project } = require('./hook-test-env').isolateHookSuite();
const inProject = (env = {}) => ({ cwd: project, env: { ...process.env, CLAUDE_PROJECT_DIR: project, ...env } });
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, '..', 'setup-plugin', 'hooks', 'guard-layer-table.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'layer-table-'));

const typed = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const call = (id, name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, content, is_error = false) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } });
const table = (layer) => call('t1', 'Bash', { command: `node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/raw.json" --table ${layer} --recs r.json` });
const ask = { questions: [{ question: 'Keep as shown?', header: 'Agents', multiSelect: false, options: [{ label: 'Recommended', description: 'x' }, { label: 'All', description: 'y' }] }] };

function run(rows, input = ask) {
  const p = path.join(TMP, `${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'AskUserQuestion', tool_input: input, transcript_path: p }), encoding: 'utf8', ...inProject() });
  return { status: r.status, stderr: r.stderr };
}

test('denies the layer ask when the table ran but was never pasted', () => {
  const r = run([typed('/alfred-code:setup'), say('[step 5/12 - agents] adjust the agent roster · next: skills'), table('agents'), result('t1', ' 1  x\ntotal: 43 agents - if fewer')]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /agents table ran/);
});

test('allows the ask once the footer line is in the assistant text', () => {
  const r = run([typed('/alfred-code:setup'), table('agents'), result('t1', 'total: 43 agents'), say('```\n 1  x\ntotal: 43 agents - if fewer rows are visible above\n```')]);
  assert.strictEqual(r.status, 0);
});

test('a footer for a DIFFERENT layer does not satisfy the gate', () => {
  const r = run([say('```\ntotal: 18 rules\n```'), table('agents'), result('t1', 'total: 43 agents')]);
  assert.strictEqual(r.status, 2);
});

const denied = (n, layer = 'skills') => [call(`a${n}`, 'AskUserQuestion', ask), result(`a${n}`, `alfred-code layer-table gate: the ${layer} table ran but its output is not in your message`, true)];

test('keeps denying a retry that only CLAIMS the paste - the measured skills turn did it three times', () => {
  const r = run([table('skills'), result('t1', 'total: 78 skills'), ...denied(1), say('[step 6/12 - skills] full 78-row catalog, pasted below'), ...denied(2)]);
  assert.strictEqual(r.status, 2);
});

test('the table only in the ask preview panel does not count', () => {
  const withPreview = { questions: [{ ...ask.questions[0], options: [{ label: 'Recommended', description: 'x', preview: 'total: 78 skills' }, { label: 'All', description: 'y' }] }] };
  assert.strictEqual(run([table('skills'), result('t1', 'total: 78 skills')], withPreview).status, 2);
});

test('lets the ask through after three denials for the same table call - never loops the walk', () => {
  const r = run([table('skills'), result('t1', 'total: 78 skills'), ...denied(1), ...denied(2), ...denied(3)]);
  assert.strictEqual(r.status, 0);
});

test('a new table call resets the denial count', () => {
  const r = run([table('agents'), ...denied(1, 'agents'), ...denied(2, 'agents'), ...denied(3, 'agents'), say('```\ntotal: 43 agents\n```'), table('skills'), result('t1', 'total: 78 skills')]);
  assert.strictEqual(r.status, 2);
});

const settings = (extra = '') => call('t1', 'Bash', { command: `node "$TMP/repo/scripts/plugin-settings.js" --catalog c.json --config-dir ~/.claude --installed claude-hud${extra}` });
const report = 'claude-hud  display.showTools  missing\nclaude-hud  missing: 2 · differs: 0 · match: 5';

test('the plugin-settings report counts as a decision table - its closing line must be pasted', () => {
  assert.strictEqual(run([settings(), result('t1', report)]).status, 2);
  assert.strictEqual(run([settings(), result('t1', report), say('```\n' + report + '\n```')]).status, 0);
});

test('the plugin-settings --apply run is not a decision table', () => {
  assert.strictEqual(run([settings(' --apply'), result('t1', 'applied: 2')]).status, 0);
});

// Measured 2026-09-15: setup skips the report silently on `nothing to offer`, and every later ask
// (CLAUDE.md, gitignore, blockers) was denied three times over a table that never existed.
test('a plugin-settings run with nothing to offer is no table - later asks pass', () => {
  const none = 'plugin-settings: nothing to offer (no catalog row for the installed plugins)';
  assert.strictEqual(run([settings(), result('t1', none), say('Next: the CLAUDE.md step.')]).status, 0);
});

// validate's post-check pastes the install audit before its one ask on a high row.
const installAudit = (extra = '') => call('t1', 'Bash', { command: `node "$TMP/repo/scripts/audit-install.js" .${extra}` });
const auditTable = '| Severity | Where | Finding | Fix |\n|---|---|---|---|\n| high | .mcp.json | mcp server a launches an unpinned package | pin it to a version, or re-run the stack update |';

test('the install audit counts as a decision table - its last row must be pasted', () => {
  assert.strictEqual(run([installAudit(), result('t1', auditTable)]).status, 2);
  assert.strictEqual(run([installAudit(), result('t1', auditTable), say('```\n' + auditTable + '\n```')]).status, 0);
});

test('an install audit with nothing to report, or its --json form, is no table', () => {
  assert.strictEqual(run([installAudit(), result('t1', 'install audit: nothing to report'), say('Clean.')]).status, 0);
  assert.strictEqual(run([installAudit(' --json'), result('t1', '[]')]).status, 0);
});

// A command continued over lines with a trailing backslash is the same table call.
test('a multi-line stack-select --table command is still a table call', () => {
  const multi = call('t1', 'Bash', { command: 'node "$TMP/repo/scripts/stack-select.js" \\\n  --selection "$TMP/raw.json" \\\n  --table skills --recs r.json' });
  assert.strictEqual(run([multi, result('t1', ' 1  x\ntotal: 78 skills')]).status, 2);
  assert.strictEqual(run([multi, result('t1', 'total: 78 skills'), say('```\ntotal: 78 skills\n```')]).status, 0);
});

test('a result given as content blocks is read the same way', () => {
  assert.strictEqual(run([settings(), result('t1', [{ type: 'text', text: report }])]).status, 2);
});

// validate's own audit battery (--redundant/--missing/--evidence-gaps/--judgment) redirects to a
// file and prints no `total: N <layer>` footer, so its proof is the rendered table's own state
// word instead.
const audit = (flag) => call('t1', 'Bash', { command: `node "$TMP/repo/scripts/stack-select.js" --${flag} --installed i.json --recs r.json > "$TMP/${flag}.out"` });

test('validate audit flags gate their own ask too - denied with no state word pasted', () => {
  for (const flag of ['redundant', 'missing', 'evidence-gaps', 'judgment']) {
    const r = run([audit(flag), result('t1', '')]);
    assert.strictEqual(r.status, 2, `--${flag} should deny`);
    assert.match(r.stderr, /audit ran/);
  }
});

test('validate audit flags pass once the layer table state word is pasted', () => {
  const r = run([audit('redundant'), result('t1', ''), say('```\n 1 | x | REDUNDANT | owned by wpf, not detected\n```')]);
  assert.strictEqual(r.status, 0);
});

test('the judgment audit passes on its own JUDGMENT-DROP/ADD words, not REDUNDANT/MISSING', () => {
  const r = run([audit('judgment'), result('t1', ''), say('```\n 1 | skill x | JUDGMENT-DROP | reason\n```')]);
  assert.strictEqual(r.status, 0);
});

test('an ask with no table call in the transcript is untouched', () => {
  assert.strictEqual(run([typed('which branch?'), say('Looking.')]).status, 0);
});

test('fail-open on a missing transcript or garbage payload', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8', ...inProject() });
  assert.strictEqual(r.status, 0);
  const r2 = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'AskUserQuestion', transcript_path: path.join(TMP, 'nope.jsonl') }), encoding: 'utf8', ...inProject() });
  assert.strictEqual(r2.status, 0);
});

// The ask's own message (text rows + the AskUserQuestion tool_use, one message.id) is written to the
// transcript asynchronously, so at PreToolUse time it may not be on disk yet. The hook waits for the
// row carrying the payload's tool_use_id, and fails open when it never lands.
const OWN = 'own1';
const own = (text) => [
  { type: 'assistant', message: { id: 'm9', role: 'assistant', content: [{ type: 'text', text }] } },
  { type: 'assistant', message: { id: 'm9', role: 'assistant', content: [{ type: 'tool_use', id: OWN, name: 'AskUserQuestion', input: ask }] } },
];
const footer = '```\n 1  x\ntotal: 20 rules\n```';
const base = () => [typed('/alfred-code:setup'), table('rules'), result('t1', ' 1  x\ntotal: 20 rules')];
const write = (rows) => {
  const p = path.join(TMP, `${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return p;
};
const payloadFor = (p) => JSON.stringify({ tool_name: 'AskUserQuestion', tool_input: ask, transcript_path: p, tool_use_id: OWN });
const runWith = (rows, env = {}) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [HOOK], { input: payloadFor(write(rows)), encoding: 'utf8', ...inProject(env) });
  return { status: r.status, stderr: r.stderr, ms: Date.now() - t0 };
};

test('a paste in the ask own message that lands after the hook starts passes', async () => {
  const p = write(base());
  const child = spawn(process.execPath, [HOOK], inProject({ ALFRED_CODE_LAYER_GATE_WAIT_MS: '3000' }));
  child.stdin.end(payloadFor(p));
  setTimeout(() => fs.appendFileSync(p, own(footer).map((r) => JSON.stringify(r)).join('\n') + '\n'), 300);
  const status = await new Promise((res) => child.on('close', res));
  assert.strictEqual(status, 0);
});

test('the ask own row never landing within the wait fails open', () => {
  const r = runWith(base(), { ALFRED_CODE_LAYER_GATE_WAIT_MS: '150' });
  assert.strictEqual(r.status, 0);
  assert.ok(r.ms < 1500, `took ${r.ms}ms`);
});

// M15: the wait buys a view of the ask's own message, which matters only when a table call could need
// proving. An ask with no table call since the typed prompt returns at once - otherwise a CLI that wrote
// its row late would cost every ask in every session the whole budget.
test('M15 an ask with no table call in the tail never waits for its own row', () => {
  const r = runWith([typed('which branch?'), say('Looking.'), call('b1', 'Bash', { command: 'git branch' }), result('b1', 'main')], { ALFRED_CODE_LAYER_GATE_WAIT_MS: '3000' });
  assert.strictEqual(r.status, 0);
  assert.ok(r.ms < 1500, `took ${r.ms}ms - it waited for a row it had nothing to judge against`);
  // A table call answered by an earlier ask before the typed prompt is no table for this one either.
  const old = runWith([...base(), typed('next question'), say('Sure.')], { ALFRED_CODE_LAYER_GATE_WAIT_MS: '3000' });
  assert.strictEqual(old.status, 0);
  assert.ok(old.ms < 1500, `took ${old.ms}ms`);
  // Positive control: with a table call in the tail it still waits the budget for its own row.
  const waited = runWith(base(), { ALFRED_CODE_LAYER_GATE_WAIT_MS: '1600' });
  assert.strictEqual(waited.status, 0);
  assert.ok(waited.ms >= 1500, `took ${waited.ms}ms - the table case must still wait`);
});

test('own row on disk and no paste anywhere still denies, without waiting', () => {
  const r = runWith([...base(), ...own('Here is the roster.')], { ALFRED_CODE_LAYER_GATE_WAIT_MS: '5000' });
  assert.strictEqual(r.status, 2);
  assert.ok(r.ms < 2500, `took ${r.ms}ms`);
});

test('a paste split into a text row and a tool_use row sharing one message.id passes', () => {
  assert.strictEqual(runWith([...base(), ...own(footer)]).status, 0);
});

test('a CRLF paste passes (Windows)', () => {
  const crlf = footer.replace(/\n/g, '\r\n');
  const rows = [typed('/alfred-code:setup'), table('rules'), result('t1', ' 1  x\r\ntotal: 20 rules\r\n'), ...own(crlf)];
  assert.strictEqual(runWith(rows).status, 0);
});

test('a table re-run does not reset the valve', () => {
  const rows = [typed('/alfred-code:setup'), table('rules'), ...denied(1, 'rules'), table('rules'), ...denied(2, 'rules'), table('rules'), ...denied(3, 'rules'), table('rules'), result('t1', 'total: 20 rules')];
  assert.strictEqual(run(rows).status, 0);
});

test('an answered ask starts a new count', () => {
  const answered = [call('ok1', 'AskUserQuestion', ask), result('ok1', 'User has answered: Recommended')];
  const rows = [table('rules'), ...denied(1, 'rules'), ...denied(2, 'rules'), ...denied(3, 'rules'), ...answered, table('rules'), result('t1', 'total: 20 rules')];
  assert.strictEqual(run(rows).status, 2);
});

test('the denial tells the model not to re-run the table', () => {
  const r = run([table('rules'), result('t1', 'total: 20 rules')]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /do not re-run/i);
});

// 2026-10-06: 'No tables with hooks, skills, agents, rules are shown' - a walk that never RAN a layer's table
// asked that layer's selection with nothing on screen; the gate above judges only a table that ran.
const layerAsk = (q) => ({ questions: [{ question: q, header: 'Layer', multiSelect: false, options: [{ label: 'Keep the marked rows (Recommended)', description: 'x' }, { label: 'Pick', description: 'y' }] }] });
const recompute = call('r1', 'Bash', { command: 'node "$TMP/repo/scripts/stack-select.js" --selection raw.json > "$TMP/select.out"' });

test('a layer ask inside a walk whose table never ran is denied, naming the --table call', () => {
  const r = run([typed('/alfred-code:configure'), recompute, result('r1', ''), say('[step 4/13 - agents]')], layerAsk('Agents: install the marked rows? The unmarked ones are other stacks\' trios.'));
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /agents table never ran/);
  assert.match(r.stderr, /--table agents/);
});

test('the DELTA add / drop ask names its layer too', () => {
  const r = run([typed('/alfred-code:configure'), recompute, result('r1', '')], layerAsk('Add to the installed skills? 40 catalog rows are not installed.'));
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /skills table never ran/);
});

test('a layer ask passes once that layer table ran and was pasted', () => {
  const r = run([typed('/alfred-code:setup'), recompute, result('r1', ''), table('hooks'), result('t1', 'total: 18 hooks'), say('```\n 1 | x\ntotal: 18 hooks\n```')], layerAsk('Hooks: keep all 18 on?'));
  assert.strictEqual(r.status, 0);
});

test('a layer-shaped ask outside a walk (no stack-select call) is untouched', () => {
  assert.strictEqual(run([typed('which rules?'), say('a few')], layerAsk('Rules: keep them?')).status, 0);
});

test('the never-ran denial has its own valve of three', () => {
  const nr = (n) => [call(`n${n}`, 'AskUserQuestion', layerAsk('Rules: install?')), result(`n${n}`, 'alfred-code layer-table gate: the rules table never ran - x', true)];
  const rows = [typed('/alfred-code:setup'), recompute, result('r1', ''), ...nr(1), ...nr(2)];
  assert.strictEqual(run(rows, layerAsk('Rules: install?')).status, 2);
  assert.strictEqual(run([...rows, ...nr(3)], layerAsk('Rules: install?')).status, 0);
});
