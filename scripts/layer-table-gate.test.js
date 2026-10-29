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
const { spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, '..', 'setup-plugin', 'hooks', 'guard-layer-table.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'layer-table-'));

const typed = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const call = (id, name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, content, is_error = false) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } });
const table = (layer) => call('t1', 'Bash', { command: `node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/raw.json" --table ${layer} --recs r.json` });
const ask = { questions: [{ question: 'Keep as shown?', header: 'Agents', multiSelect: false, options: [{ label: 'Recommended', description: 'x' }, { label: 'All', description: 'y' }] }] };

function run(rows, input = ask, env = {}) {
  const p = path.join(TMP, `${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'AskUserQuestion', tool_input: input, transcript_path: p }), encoding: 'utf8', ...inProject(env) });
  return { status: r.status, stderr: r.stderr };
}

// F4 (the 2026-10-28 workspace run): the ask's own message reaches the transcript only after the PreToolUse hooks finish
// (docs/workspace-layering-evidence.md, 'Fix run'), so the paste and banner checks run at PostToolUse, where it is on
// disk, and a failed check replaces the answers through `updatedToolOutput`: the stored result carries the marker every
// reader below already counts. runPost writes the ask's own call row, as Claude Code has by then.
const ANS = { questions: ask.questions, answers: { 'Keep as shown?': 'Recommended' }, annotations: {} };
function runPost(rows, toolResponse = ANS, env = {}, input = ask) {
  const p = path.join(TMP, `${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(p, [...rows, call('a9', 'AskUserQuestion', input)].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_input: input,
    tool_use_id: 'a9', tool_response: toolResponse, transcript_path: p }), encoding: 'utf8', ...inProject(env) });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}
const voided = (r) => r.status === 0 && !!r.out && r.out.decision === 'block';
const UNPASTED = () => [typed('/alfred-code:init'), say('[step 5/12 - agents] adjust the agent roster · next: skills'), table('agents'), result('t1', ' 1  x\ntotal: 43 agents - if fewer')];

test('PostToolUse voids an unpasted ask', () => {
  const r = runPost(UNPASTED());
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.out.decision, 'block');
  assert.match(r.out.reason, /agents table ran but its output is not in your message/);
  assert.strictEqual(r.out.hookSpecificOutput.hookEventName, 'PostToolUse');
  const out = r.out.hookSpecificOutput.updatedToolOutput;
  assert.ok(out.answers['Keep as shown?'].startsWith('alfred-code layer-table gate: '), out.answers['Keep as shown?']);
  assert.deepStrictEqual(out.annotations, {});
  assert.deepStrictEqual(out.questions, ask.questions);
  // An ask a hook answered carries no annotations key, and the replacement adds none.
  const bare = runPost(UNPASTED(), { questions: ask.questions, answers: { 'Keep as shown?': 'Recommended' } });
  assert.ok(!('annotations' in bare.out.hookSpecificOutput.updatedToolOutput));
});

// F27 (the 2026-10-28 fix run, live): Sonnet answered six voids with thinking and the ask, no text block - the table
// written in thinking, which is never on screen - whatever the void line said. So the gate prints the table itself: in
// the block reason, which the user sees in full, and the replaced answer says so. The re-ask then passes unpasted.
const printedOf = (reason) => reason.split('\n').slice(1, -1).join('\n');
const thought = () => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '```\n 1  x\ntotal: 43 agents - if fewer\n```', signature: 's' }] } });
test('a table written only in thinking is void, the reason prints the table and says the message held no text', () => {
  const r = runPost([...UNPASTED(), thought()]);
  assert.ok(voided(r));
  assert.match(r.out.reason, /agents table ran but its output is not in your message - your message held no text at all, only thinking/);
  assert.match(r.out.reason, /the gate printed the table for the user; send this same ask again, unchanged/);
  assert.strictEqual(printedOf(r.out.reason), ' 1  x\ntotal: 43 agents - if fewer', r.out.reason);
  const answer = r.out.hookSpecificOutput.updatedToolOutput.answers['Keep as shown?'];
  assert.match(answer, /the gate printed the table for the user/);
  assert.ok(!answer.includes('total: 43 agents'), 'the answer carries no second copy');
});

test('prose with no table gets the general void line, and the table printed', () => {
  const r = runPost([...UNPASTED(), say('The agents table is pasted below.')]);
  assert.ok(voided(r));
  assert.doesNotMatch(r.out.reason, /held no text at all/);
  assert.match(r.out.reason, /the user answered without it on screen - this answer is void; the gate printed the table for the user/);
  assert.strictEqual(printedOf(r.out.reason), ' 1  x\ntotal: 43 agents - if fewer', r.out.reason);
});

test('a re-ask after a void that printed the table passes unpasted', () => {
  const first = runPost([...UNPASTED(), thought()]);
  const line = first.out.hookSpecificOutput.updatedToolOutput.answers['Keep as shown?'];
  assert.strictEqual(runPost([...UNPASTED(), thought(), call('a1', 'AskUserQuestion', ask), result('a1', line, true), thought()]).stdout, '');
});

test('a table run with no output read back keeps the paste instruction and prints nothing', () => {
  const r = runPost([typed('/alfred-code:init'), table('agents'), result('t1', ''), thought()]);
  if (!r.out) return;   // nothing to prove against is no void either
  assert.doesNotMatch(r.out.reason, /the gate printed the table/);
});

test('PostToolUse passes a pasted ask', () => {
  assert.strictEqual(runPost([...UNPASTED(), say('```\n 1  x\ntotal: 43 agents - if fewer\n```')]).stdout, '');
});

test('a voided ask leaves the next --emit denied', () => {
  const voidText = 'User has answered your questions: "Agents: keep?"="alfred-code layer-table gate: the agents table ran but its output is not in your message - this answer is void"';
  const rows = [typed('/alfred-code:init'), ...walked('rules'), tbl('agents'), result('t-agents', 'total: 43 agents'),
    call('a1', 'AskUserQuestion', layerAsk('Agents: keep the marked rows?')), result('a1', voidText)];
  const r = runBash(rows, EMIT);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.match(r.stderr, /agents ask never happened/);
});

test('the valve passes the fourth void of one kind, and a banner gap still voids', () => {
  const rows = [typed('/alfred-code:configure'), b(1), b(2), table('agents'), result('t1', 'total: 43 agents'), ...denied(1, 'agents'), ...denied(2, 'agents'), ...denied(3, 'agents')];
  assert.strictEqual(runPost(rows).stdout, '');
  const gap = runPost([...rows, b(4)]);
  assert.ok(voided(gap), gap.stdout);
  assert.match(gap.out.reason, /step banner missing - step 3 of 13 printed none/);
});

test('PreToolUse never waits, and judges no paste', () => {
  const t0 = Date.now();
  const r = run(UNPASTED());
  assert.strictEqual(r.status, 0);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0}ms`);
  assert.ok(!fs.readFileSync(HOOK, 'utf8').includes('LAYER_GATE_WAIT_MS'));
});

test('no answers object, or an empty one, passes (Review Focus 1)', () => {
  assert.strictEqual(runPost(UNPASTED(), { questions: ask.questions }).stdout, '');
  assert.strictEqual(runPost(UNPASTED(), { questions: ask.questions, answers: {} }).stdout, '');
  assert.strictEqual(runPost(UNPASTED(), { questions: ask.questions, answers: ['A'] }).stdout, '');
});

// A void Claude Code did not apply (an output it judged off-schema) still leaves its `hook_blocking_error` row carrying
// the marker: the readers take that row as the void, and the next gate run writes one `void-not-applied` probe row.
const blocking = (id, top = false) => (top
  ? { type: 'attachment', toolUseID: id, attachment: { type: 'hook_blocking_error', blockingError: 'alfred-code layer-table gate: the agents table ran but its output is not in your message - void' } }
  : { type: 'attachment', attachment: { type: 'hook_blocking_error', toolUseID: id, blockingError: 'alfred-code layer-table gate: the agents table ran but its output is not in your message - void' } });
const rawAnswer = (id) => [call(id, 'AskUserQuestion', layerAsk('Agents: keep the marked rows?')), result(id, 'User has answered your questions: "Keep as shown?"="Recommended"')];

test('an unapplied void still holds the walk, and writes one probe row', () => {
  for (const top of [false, true]) {
    const proj = fs.mkdtempSync(path.join(TMP, 'probe-'));
    fs.mkdirSync(path.join(proj, '.claude'));
    fs.writeFileSync(path.join(proj, '.claude', 'alfred-code.stamp'), 'version: 3.2.1\n');
    const p = path.join(TMP, `${Math.random().toString(36).slice(2)}.jsonl`);
    fs.writeFileSync(p, [typed('/alfred-code:init'), ...walked('rules'), tbl('agents'), result('t-agents', 'total: 43 agents'), ...rawAnswer('a1'), blocking('a1', top)]
      .map((r) => JSON.stringify(r)).join('\n') + '\n');
    const go = () => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: 'pv', tool_name: 'Bash', tool_input: { command: EMIT }, transcript_path: p, tool_use_id: 'own' }),
      encoding: 'utf8', cwd: proj, env: { ...process.env, CLAUDE_PROJECT_DIR: proj } });
    const r = go();
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /agents ask never happened/);
    go();
    const rows = fs.readFileSync(path.join(proj, '.alfred', 'statistics', 'hook-blocks', 'pv.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const probes = rows.filter((x) => x.mode === 'probe' && x.kind === 'void-not-applied');
    assert.deepStrictEqual(probes.map((x) => x.detail.id), ['a1'], `top-level toolUseID ${top}: one probe row, a second run writes none`);
  }
});

test('four unapplied voids of one kind - the fourth passes', () => {
  const rows = [...UNPASTED(), ...rawAnswer('v1'), blocking('v1'), ...rawAnswer('v2'), blocking('v2'), ...rawAnswer('v3'), blocking('v3')];
  assert.strictEqual(runPost(rows).stdout, '');
  assert.ok(voided(runPost([...UNPASTED(), ...rawAnswer('v1'), blocking('v1'), ...rawAnswer('v2'), blocking('v2')])), 'the third still voids');
});

test('the void part switch', () => {
  const off = { ALFRED_CODE_HOOKS_OFF: 'guard-layer-table:void' };
  assert.strictEqual(runPost(UNPASTED(), ANS, off).stdout, '');
  const r = run([typed('/alfred-code:configure'), recompute, result('r1', '')], layerAsk('Agents: install the marked rows?'), off);
  assert.strictEqual(r.status, 2, 'the never-ran check is no part of the void');
});

test('a table before a compaction summary is not judged (Review Focus 2)', () => {
  const summary = { type: 'user', isCompactSummary: true, message: { role: 'user', content: 'summary' } };
  assert.strictEqual(runPost([table('agents'), result('t1', 'total: 43 agents'), summary]).stdout, '');
});

// 2.8.0: the block row goes to the data root's statistics/ (stack/hooks/layout.js's home, read here by its pinned
// data-root reader - setup-plugin/hooks/ ships apart from the stack's copy), ALFRED_CODE_DATA_PATH honoured.
test('2.8.0: the block row lands in <data root>/statistics/hook-blocks/', () => {
  for (const [data, env] of [['.alfred', {}], ['.data', { ALFRED_CODE_DATA_PATH: '.data' }]]) {
    const proj = fs.mkdtempSync(path.join(TMP, 'rows-'));
    fs.mkdirSync(path.join(proj, '.claude'));
    fs.writeFileSync(path.join(proj, '.claude', 'alfred-code.stamp'), 'version: 2.8.0\n');
    const p = path.join(TMP, `${Math.random().toString(36).slice(2)}.jsonl`);
    fs.writeFileSync(p, [typed('/alfred-code:init'), say('[step 5/12 - agents]'), table('agents'), result('t1', ' 1  x\ntotal: 43 agents - if fewer')].map((r) => JSON.stringify(r)).join('\n') + '\n');
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: 'lt', hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_input: ask, tool_use_id: 'a9', tool_response: ANS, transcript_path: p }),
      encoding: 'utf8', cwd: proj, env: { ...process.env, CLAUDE_PROJECT_DIR: proj, ...env } });
    assert.strictEqual(JSON.parse(r.stdout).decision, 'block', r.stderr);
    const rows = fs.readFileSync(path.join(proj, data, 'statistics', 'hook-blocks', 'lt.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepStrictEqual(rows.map((x) => [x.hook, x.event]), [['guard-layer-table.js', 'PostToolUse']], `${data}: one row`);
    assert.ok(!fs.existsSync(path.join(proj, '.alfred', 'docs', 'hook-blocks')), `${data}: none under the docs root`);
  }
});

test('allows the ask once the footer line is in the assistant text', () => {
  const r = runPost([typed('/alfred-code:init'), table('agents'), result('t1', 'total: 43 agents'), say('```\n 1  x\ntotal: 43 agents - if fewer rows are visible above\n```')]);
  assert.strictEqual(r.stdout, '');
});

test('a footer for a DIFFERENT layer does not satisfy the gate', () => {
  assert.ok(voided(runPost([say('```\ntotal: 18 rules\n```'), table('agents'), result('t1', 'total: 43 agents')])));
});

const denied = (n, layer = 'skills') => [call(`a${n}`, 'AskUserQuestion', ask), result(`a${n}`, `alfred-code layer-table gate: the ${layer} table ran but its output is not in your message`, true)];

test('keeps denying a retry that only CLAIMS the paste - the measured skills turn did it three times', () => {
  assert.ok(voided(runPost([table('skills'), result('t1', 'total: 78 skills'), ...denied(1), say('[step 6/12 - skills] full 78-row catalog, pasted below'), ...denied(2)])));
});

test('the table only in the ask preview panel does not count', () => {
  const withPreview = { questions: [{ ...ask.questions[0], options: [{ label: 'Recommended', description: 'x', preview: 'total: 78 skills' }, { label: 'All', description: 'y' }] }] };
  assert.ok(voided(runPost([table('skills'), result('t1', 'total: 78 skills')], ANS, {}, withPreview)));
});

test('lets the ask through after three denials for the same table call - never loops the walk', () => {
  assert.strictEqual(runPost([table('skills'), result('t1', 'total: 78 skills'), ...denied(1), ...denied(2), ...denied(3)]).stdout, '');
});

test('a new table call resets the denial count', () => {
  assert.ok(voided(runPost([table('agents'), ...denied(1, 'agents'), ...denied(2, 'agents'), ...denied(3, 'agents'), say('```\ntotal: 43 agents\n```'), table('skills'), result('t1', 'total: 78 skills')])));
});

const settings = (extra = '') => call('t1', 'Bash', { command: `node "$TMP/repo/scripts/plugin-settings.js" --catalog c.json --config-dir ~/.claude --installed claude-hud${extra}` });
const report = 'claude-hud  display.showTools  missing\nclaude-hud  missing: 2 · differs: 0 · match: 5';

test('the plugin-settings report counts as a decision table - its closing line must be pasted', () => {
  assert.ok(voided(runPost([settings(), result('t1', report)])));
  assert.strictEqual(runPost([settings(), result('t1', report), say('```\n' + report + '\n```')]).stdout, '');
});

test('the plugin-settings --apply run is not a decision table', () => {
  assert.strictEqual(runPost([settings(' --apply'), result('t1', 'applied: 2')]).stdout, '');
});

// Measured 2026-09-15: setup skips the report silently on `nothing to offer`, and every later ask
// (CLAUDE.md, gitignore, blockers) was denied three times over a table that never existed.
test('a plugin-settings run with nothing to offer is no table - later asks pass', () => {
  const none = 'plugin-settings: nothing to offer (no catalog row for the installed plugins)';
  assert.strictEqual(runPost([settings(), result('t1', none), say('Next: the CLAUDE.md step.')]).stdout, '');
  // F16: every row already matching is nothing to offer too.
  const matched = '# claude-hud\n  settings.json\n    match    statusLine.refreshInterval -> 5\n\nplugin-settings: nothing to offer - 1 already match';
  assert.strictEqual(runPost([settings(), result('t1', matched), say('Next: the CLAUDE.md step.')]).stdout, '');
});

// validate's post-check pastes the install audit before its one ask on a high row.
const installAudit = (extra = '') => call('t1', 'Bash', { command: `node "$TMP/repo/scripts/audit-install.js" .${extra}` });
const auditTable = '| Severity | Where | Finding | Fix |\n|---|---|---|---|\n| high | .mcp.json | mcp server a launches an unpinned package | pin it to a version, or re-run the stack update |';

test('the install audit counts as a decision table - its last row must be pasted', () => {
  assert.ok(voided(runPost([installAudit(), result('t1', auditTable)])));
  assert.strictEqual(runPost([installAudit(), result('t1', auditTable), say('```\n' + auditTable + '\n```')]).stdout, '');
});

test('an install audit with nothing to report, or its --json form, is no table', () => {
  assert.strictEqual(runPost([installAudit(), result('t1', 'install audit: nothing to report'), say('Clean.')]).stdout, '');
  assert.strictEqual(runPost([installAudit(' --json'), result('t1', '[]')]).stdout, '');
});

// A command continued over lines with a trailing backslash is the same table call.
test('a multi-line stack-select --table command is still a table call', () => {
  const multi = call('t1', 'Bash', { command: 'node "$TMP/repo/scripts/stack-select.js" \\\n  --selection "$TMP/raw.json" \\\n  --table skills --recs r.json' });
  assert.ok(voided(runPost([multi, result('t1', ' 1  x\ntotal: 78 skills')])));
  assert.strictEqual(runPost([multi, result('t1', 'total: 78 skills'), say('```\ntotal: 78 skills\n```')]).stdout, '');
});

test('a result given as content blocks is read the same way', () => {
  assert.ok(voided(runPost([settings(), result('t1', [{ type: 'text', text: report }])])));
});

// validate's own audit battery (--redundant/--missing/--evidence-gaps/--judgment) redirects to a
// file and prints no `total: N <layer>` footer, so its proof is the rendered table's own state
// word instead.
const audit = (flag) => call('t1', 'Bash', { command: `node "$TMP/repo/scripts/stack-select.js" --${flag} --installed i.json --recs r.json > "$TMP/${flag}.out"` });

test('validate audit flags gate their own ask too - denied with no state word pasted', () => {
  for (const flag of ['redundant', 'missing', 'evidence-gaps', 'judgment']) {
    const r = runPost([audit(flag), result('t1', '')]);
    assert.ok(voided(r), `--${flag} should void`);
    assert.match(r.out.reason, /audit ran/);
  }
});

test('validate audit flags pass once the layer table state word is pasted', () => {
  assert.strictEqual(runPost([audit('redundant'), result('t1', ''), say('```\n 1 | x | REDUNDANT | owned by wpf, not detected\n```')]).stdout, '');
});

test('the judgment audit passes on its own JUDGMENT-DROP/ADD words, not REDUNDANT/MISSING', () => {
  assert.strictEqual(runPost([audit('judgment'), result('t1', ''), say('```\n 1 | skill x | JUDGMENT-DROP | reason\n```')]).stdout, '');
});

test('an ask with no table call in the transcript is untouched', () => {
  assert.strictEqual(run([typed('which branch?'), say('Looking.')]).status, 0);
  assert.strictEqual(runPost([typed('which branch?'), say('Looking.')]).stdout, '');
});

test('fail-open on a missing transcript or garbage payload', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8', ...inProject() });
  assert.strictEqual(r.status, 0);
  const r2 = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'AskUserQuestion', transcript_path: path.join(TMP, 'nope.jsonl') }), encoding: 'utf8', ...inProject() });
  assert.strictEqual(r2.status, 0);
  const r3 = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_response: ANS, transcript_path: path.join(TMP, 'nope.jsonl') }), encoding: 'utf8', ...inProject() });
  assert.deepStrictEqual([r3.status, r3.stdout], [0, '']);
});

// The ask's own message (its text rows and the AskUserQuestion tool_use, one message.id) is on disk by PostToolUse, so a
// paste in it counts there.
const footer = '```\n 1  x\ntotal: 20 rules\n```';
const base = () => [typed('/alfred-code:init'), table('rules'), result('t1', ' 1  x\ntotal: 20 rules')];
const own = (text) => [{ type: 'assistant', message: { id: 'm9', role: 'assistant', content: [{ type: 'text', text }] } }];

test('own message on disk and no paste anywhere voids', () => {
  assert.ok(voided(runPost([...base(), ...own('Here is the roster.')])));
});

test('a paste in the ask own message passes', () => {
  assert.strictEqual(runPost([...base(), ...own(footer)]).stdout, '');
});

test('a CRLF paste passes (Windows)', () => {
  const crlf = footer.replace(/\n/g, '\r\n');
  const rows = [typed('/alfred-code:init'), table('rules'), result('t1', ' 1  x\r\ntotal: 20 rules\r\n'), ...own(crlf)];
  assert.strictEqual(runPost(rows).stdout, '');
});

test('a table re-run does not reset the valve', () => {
  const rows = [typed('/alfred-code:init'), table('rules'), ...denied(1, 'rules'), table('rules'), ...denied(2, 'rules'), table('rules'), ...denied(3, 'rules'), table('rules'), result('t1', 'total: 20 rules')];
  assert.strictEqual(runPost(rows).stdout, '');
});

test('an answered ask starts a new count', () => {
  const answered = [call('ok1', 'AskUserQuestion', ask), result('ok1', 'User has answered: Recommended')];
  const rows = [table('rules'), ...denied(1, 'rules'), ...denied(2, 'rules'), ...denied(3, 'rules'), ...answered, table('rules'), result('t1', 'total: 20 rules')];
  assert.ok(voided(runPost(rows)));
});

test('the denial tells the model not to re-run the table', () => {
  const r = runPost([table('rules'), result('t1', 'total: 20 rules')]);
  assert.ok(voided(r));
  assert.match(r.out.reason, /do not re-run/i);
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
  const r = run([typed('/alfred-code:init'), recompute, result('r1', ''), table('hooks'), result('t1', 'total: 17 hooks'), say('```\n 1 | x\ntotal: 17 hooks\n```')], layerAsk('Hooks: keep all 17 on?'));
  assert.strictEqual(r.status, 0);
});

test('a layer-shaped ask outside a walk (no stack-select call) is untouched', () => {
  assert.strictEqual(run([typed('which rules?'), say('a few')], layerAsk('Rules: keep them?')).status, 0);
});

test('the never-ran denial has its own valve of three', () => {
  const nr = (n) => [call(`n${n}`, 'AskUserQuestion', layerAsk('Rules: install?')), result(`n${n}`, 'alfred-code layer-table gate: the rules table never ran - x', true)];
  const rows = [typed('/alfred-code:init'), recompute, result('r1', ''), ...nr(1), ...nr(2)];
  assert.strictEqual(run(rows, layerAsk('Rules: install?')).status, 2);
  assert.strictEqual(run([...rows, ...nr(3)], layerAsk('Rules: install?')).status, 0);
});

// ------------------------------------------------------------------ audit 2026-10-11 SD06

// a9e06780: configure step 1 printed none of its three blocks and asked 'Installed set is shown above' over a collapsed
// read-back. Its closing ask needs the inventory table to have RUN, and then its `total:` line in the assistant text.
const step1Ask = layerAsk('Adjust the installed selection? 2.3.0 -> 2.4.0, 3 skills changed.');
const readBack = call('p1', 'Bash', { command: 'node "$TMP/repo/scripts/install/alfred-code.js" update --source "$TMP/repo" --scope project --installed-only --print-plan --plan-out "$TMP/installed.json" > "$TMP/plan.out" 2>&1' });
const inventory = call('i1', 'Bash', { command: 'node "$TMP/repo/scripts/update-preflight.js" --inventory "$TMP/installed.json"' });
const invOut = '| category | count | items |\n|---|---|---|\n| rules | 2 | a, b |\ntotal: 2 installed';

test('configure step 1: the closing ask is denied until the inventory ran, then until its total line is pasted', () => {
  const start = [typed('/alfred-code:configure'), readBack, result('p1', ''), say('[step 1/13 - install status] what is installed · next: areas')];
  const never = run(start, step1Ask);
  assert.strictEqual(never.status, 2);
  assert.match(never.stderr, /install inventory never ran/);
  assert.match(never.stderr, /update-preflight\.js" --inventory "\$TMP\/installed\.json"/);
  assert.strictEqual(run([...start, inventory, result('i1', invOut)], step1Ask).status, 0, 'PreToolUse judges no paste');
  const ran = runPost([...start, inventory, result('i1', invOut)], ANS, {}, step1Ask);
  assert.ok(voided(ran), ran.stdout);
  assert.match(ran.out.reason, /install inventory ran but its output is not in your message/);
  assert.strictEqual(runPost([...start, inventory, result('i1', invOut), say('```\n' + invOut + '\n```\n2.3.0 -> 2.4.0')], ANS, {}, step1Ask).stdout, '');
});

test('configure step 1: the never-ran denial has its own valve of three, and another ask is not step 1', () => {
  const nd = (n) => [call(`s${n}`, 'AskUserQuestion', step1Ask), result(`s${n}`, 'alfred-code layer-table gate: the install inventory never ran - x', true)];
  const rows = [typed('/alfred-code:configure'), readBack, result('p1', ''), ...nd(1), ...nd(2)];
  assert.strictEqual(run(rows, step1Ask).status, 2);
  assert.strictEqual(run([...rows, ...nd(3)], step1Ask).status, 0);
  assert.strictEqual(run([typed('/alfred-code:configure'), readBack, result('p1', '')], layerAsk('Which areas to adjust?')).status, 0);
});

// 5f9fec85 printed 6 of configure's 13 banners, 6288ad94 2 of validate's 12. Inside a guided run that has printed a
// banner, every step from the first banner seen to the highest must have printed one.
const b = (n, of = 13, name = 'x') => say(`[step ${n}/${of} - ${name}] something · next: y`);
const areas = layerAsk('Which areas to adjust?');

test('banners: a gap in a guided run is denied, naming the missing steps', () => {
  const r = runPost([typed('/alfred-code:configure'), b(1), b(2), b(5), b(9)], ANS, {}, areas);
  assert.ok(voided(r), r.stdout);
  assert.match(r.out.reason, /step banner missing - step 3, 4, 6, 7, 8 of 13 printed none/);
  assert.match(r.out.reason, /\[step 7\/12 - plugins\] skipped - area not selected/);
  assert.strictEqual(runPost([typed('/alfred-code:validate'), b(1, 12), b(2, 12), say('[step 3/12 - rules] nothing to reconcile'), b(4, 12)], ANS, {}, areas).stdout, '');
});

test('banners: no banner yet, another command, or a typed prompt mid-walk is not judged', () => {
  assert.strictEqual(runPost([typed('/alfred-code:configure'), readBack, result('p1', '')], ANS, {}, areas).stdout, '', 'no banner printed: nothing to judge');
  assert.strictEqual(runPost([typed('/alfred-code:update'), b(1), b(4)], ANS, {}, areas).stdout, '', 'update has no banner skeleton');
  assert.strictEqual(runPost([typed('/alfred-code:configure'), b(1), b(2), typed('wait, keep the hooks'), b(7), b(8)], ANS, {}, areas).stdout, '', 'the span since the typed prompt starts at its first banner');
});

test('banners: the gap denial has its own valve of three', () => {
  const gd = (n) => [call(`g${n}`, 'AskUserQuestion', areas), result(`g${n}`, 'alfred-code layer-table gate: step banner missing - step 3 of 13 printed none', true)];
  const rows = [typed('/alfred-code:configure'), b(1), b(2), b(4), ...gd(1), ...gd(2)];
  assert.ok(voided(runPost(rows, ANS, {}, areas)));
  assert.strictEqual(runPost([...rows, ...gd(3)], ANS, {}, areas).stdout, '');
});

test('banners: the ask\'s own message is on disk, so a gap it opens is seen and a banner it adds counts', () => {
  const rows = [typed('/alfred-code:configure'), b(1), b(2)];
  assert.strictEqual(runPost([...rows, ...own('[step 3/13 - rules] adjust the installed rules · next: agents')]).stdout, '');
  const gap = runPost([...rows, ...own('[step 6/13 - hooks] adjust the installed hooks · next: plugins')]);
  assert.ok(voided(gap), gap.stdout);
  assert.match(gap.out.reason, /step 3, 4, 5 of 13 printed none/);
});

// ------------------------------------------------------------------ 2026-10-21: a skipped layer question
// A real init run printed the hooks table, narrated 'all 17 hooks are currently set to recommended. Next I'll decide
// which to keep' and moved on; the plugins layer rendered its own table through `node -e` and went straight to the
// prerequisite check. No ask followed either table, so the ask-time gate above never fired. The same hook now also
// judges the walk's next Bash step: inside a typed init / configure walk, the latest layer table needs an answered ask
// before the walk moves on, and init (which walks all six layers) needs every earlier layer's table to have run.
function runBash(rows, command, id = 'own') {
  const p = path.join(TMP, `${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, transcript_path: p, tool_use_id: id }), encoding: 'utf8', ...inProject() });
  return { status: r.status, stderr: r.stderr, ms: Date.now() - t0 };
}
const tbl = (layer, id = `t-${layer}`) => call(id, 'Bash', { command: `node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/raw.json" --table ${layer} --recs r.json` });
const paste = (layer, n = 9) => say('```\n 1 | x\ntotal: ' + n + ' ' + layer + '\n```');
const answered = (layer, q) => [call(`q-${layer}`, 'AskUserQuestion', layerAsk(q || `${layer[0].toUpperCase()}${layer.slice(1)}: keep the marked rows?`)), result(`q-${layer}`, 'User has answered your questions: "x"="Keep the marked rows (Recommended)"')];
const walked = (layer) => [tbl(layer), result(`t-${layer}`, `total: 9 ${layer}`), paste(layer), ...answered(layer)];
const NEXT_RECOMPUTE = 'node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/raw.json" > "$TMP/select.out"';
const EMIT = 'node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/raw.json" --emit "$TMP/selection.txt" --hooks-answered --check --defer-init > "$TMP/select.out"';
const INSTALL = 'node "$TMP/repo/scripts/install/alfred-code.js" install --source "$TMP/repo" --scope project --selection "$TMP/selection.txt"';
const FIRST4 = ['rules', 'agents', 'skills'].flatMap(walked);

test('skipped ask: the next walk call after an unasked layer table is denied, naming the layer and the ask', () => {
  const rows = [typed('/alfred-code:init'), ...FIRST4, tbl('hooks'), result('t-hooks', 'total: 18 hooks'), say('All 18 hooks are set to recommended. Next I\'ll decide which to keep.')];
  for (const cmd of [NEXT_RECOMPUTE, `node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/raw.json" --table plugins --recs r.json`, EMIT, INSTALL]) {
    const r = runBash(rows, cmd);
    assert.strictEqual(r.status, 2, cmd);
    assert.match(r.stderr, /the hooks ask never happened/);
    assert.match(r.stderr, /fenced code block/);
  }
});

test('skipped ask: an answered ask after the table lets the walk move on; a denied one does not count', () => {
  const ok = [typed('/alfred-code:init'), ...FIRST4, ...walked('hooks')];
  assert.strictEqual(runBash(ok, NEXT_RECOMPUTE).status, 0);
  const deniedAsk = [typed('/alfred-code:init'), ...FIRST4, tbl('hooks'), result('t-hooks', 'total: 18 hooks'),
    call('d1', 'AskUserQuestion', layerAsk('Hooks: keep all 18 on?')), result('d1', 'alfred-code layer-table gate: the hooks table ran but its output is not in your message', true)];
  assert.strictEqual(runBash(deniedAsk, NEXT_RECOMPUTE).status, 2);
});

test('skipped ask: re-running the same layer table, or a command outside the walk, is not judged', () => {
  const rows = [typed('/alfred-code:init'), ...FIRST4, tbl('hooks'), result('t-hooks', 'total: 18 hooks')];
  assert.strictEqual(runBash(rows, `node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/raw.json" --table hooks --recs r.json`).status, 0);
  for (const cmd of ['git status', 'cat "$TMP/select.out"', 'node -e "console.log(1)"']) assert.strictEqual(runBash(rows, cmd).status, 0, cmd);
});

test('skipped ask: outside a typed init / configure run, or after a typed prompt mid-walk, nothing is judged', () => {
  const tail = [tbl('hooks'), result('t-hooks', 'total: 18 hooks')];
  assert.strictEqual(runBash([typed('/alfred-code:validate'), ...tail], NEXT_RECOMPUTE).status, 0);
  assert.strictEqual(runBash([typed('run the selector'), ...tail], NEXT_RECOMPUTE).status, 0);
  assert.strictEqual(runBash([typed('/alfred-code:init'), ...tail, typed('keep going')], NEXT_RECOMPUTE).status, 0);
});

test('skipped ask: configure is judged the same way', () => {
  const rows = [typed('/alfred-code:configure'), tbl('skills'), result('t-skills', 'total: 80 skills'), paste('skills', 80)];
  const r = runBash(rows, NEXT_RECOMPUTE);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /the skills ask never happened/);
  assert.strictEqual(runBash([...rows, ...answered('skills', 'Add to the installed skills? 40 rows are not installed.')], NEXT_RECOMPUTE).status, 0);
});

test('skipped ask: the pending-ask denial has its own valve of three', () => {
  const pd = (n) => [call(`p${n}`, 'Bash', { command: NEXT_RECOMPUTE }), result(`p${n}`, 'alfred-code layer-table gate: the hooks ask never happened - x', true)];
  const rows = [typed('/alfred-code:init'), ...FIRST4, tbl('hooks'), result('t-hooks', 'total: 18 hooks'), ...pd(1), ...pd(2)];
  assert.strictEqual(runBash(rows, NEXT_RECOMPUTE).status, 2);
  assert.strictEqual(runBash([...rows, ...pd(3)], NEXT_RECOMPUTE).status, 0);
});

test('skipped layer: init denies the prerequisite check and the installer while a layer table never ran', () => {
  // The plugins layer was rendered by a hand-written `node -e` script, never `--table plugins`.
  const rows = [typed('/alfred-code:init'), ...FIRST4, ...walked('hooks'),
    call('h1', 'Bash', { command: 'node -e \'const fs=require("fs");console.log(" # | plugin")\'' }), result('h1', ' # | plugin\n 1 | claude-hud')];
  for (const cmd of [EMIT, INSTALL]) {
    const r = runBash(rows, cmd);
    assert.strictEqual(r.status, 2, cmd);
    assert.match(r.stderr, /never walked/);
    assert.match(r.stderr, /plugins/);
    assert.match(r.stderr, /--table plugins/);
  }
  assert.strictEqual(runBash([...rows, ...walked('plugins')], EMIT).status, 0);
});

test('skipped layer: init denies a later layer table while an earlier layer never ran; configure skips areas freely', () => {
  const r = runBash([typed('/alfred-code:init'), ...FIRST4], `node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/raw.json" --table plugins --recs r.json`);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /hooks/);
  assert.strictEqual(runBash([typed('/alfred-code:configure'), ...walked('hooks')], EMIT).status, 0, 'configure walks only the picked areas');
});

test('skipped layer: the never-walked denial has its own valve of three', () => {
  const nw = (n) => [call(`w${n}`, 'Bash', { command: EMIT }), result(`w${n}`, 'alfred-code layer-table gate: layers never walked - plugins', true)];
  const rows = [typed('/alfred-code:init'), ...FIRST4, ...walked('hooks'), ...nw(1), ...nw(2)];
  assert.strictEqual(runBash(rows, EMIT).status, 2);
  assert.strictEqual(runBash([...rows, ...nw(3)], EMIT).status, 0);
});

test('skipped ask: the hook own Bash row on disk is not taken for the latest table call', () => {
  const rows = [typed('/alfred-code:init'), ...FIRST4, ...walked('hooks'), call('own', 'Bash', { command: `node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/raw.json" --table plugins --recs r.json` })];
  assert.strictEqual(runBash(rows, `node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/raw.json" --table plugins --recs r.json`, 'own').status, 0);
});

test('skipped ask: a non-walk Bash call exits before reading the transcript - fail-open on garbage too', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, transcript_path: path.join(TMP, 'nope.jsonl') }), encoding: 'utf8', ...inProject() });
  assert.strictEqual(r.status, 0);
  const r2 = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: EMIT }, transcript_path: path.join(TMP, 'nope.jsonl') }), encoding: 'utf8', ...inProject() });
  assert.strictEqual(r2.status, 0);
});

// ------------------------------------------------------------------ 2026-10-21, step 6.5: the walk outlives a typed reply
// The Bash gate found the walk only when the LAST typed prompt was the init / configure command, so one typed reply
// mid-walk ('sounds good, go on') switched it off for every later layer - the skipped question came back. The span now
// runs back to the newest typed init / configure command: a typed reply counts as the user's answer where it stands, a
// harness prompt (a task notice, a seat's hand-back, a command's output) is neither, another typed slash command ends the
// walk, an ask the idle timeout closed is no answer, and the Bash path reads a 2MB tail.
const TYPED_INIT = typed('<command-message>alfred-code:init</command-message>\n<command-name>/alfred-code:init</command-name>\n<command-args></command-args>');
const UNASKED_HOOKS = [tbl('hooks'), result('t-hooks', 'total: 18 hooks'), paste('hooks', 18)];

test('6.5: a typed reply mid-walk keeps the walk judged - a later unasked table still holds the next step', () => {
  for (const start of [typed('/alfred-code:init'), TYPED_INIT]) {
    const r = runBash([start, ...FIRST4, typed('sounds good, go on'), ...UNASKED_HOOKS], NEXT_RECOMPUTE);
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /the hooks ask never happened/);
  }
});

test('6.5: a typed reply after the table is the user\'s answer there', () => {
  assert.strictEqual(runBash([TYPED_INIT, ...FIRST4, ...UNASKED_HOOKS, typed('keep all of them')], NEXT_RECOMPUTE).status, 0);
});

test('6.5: init\'s never-walked check reaches past a typed reply', () => {
  const rows = [TYPED_INIT, ...FIRST4, typed('ok'), ...walked('hooks')];
  const r = runBash(rows, EMIT);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.match(r.stderr, /never walked/);
  assert.match(r.stderr, /plugins/);
  assert.strictEqual(runBash([...rows, ...walked('plugins')], EMIT).status, 0);
});

test('6.5: a harness prompt is neither an answer nor the end of the walk', () => {
  for (const notice of ['<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n</task-notification>',
    'Another Claude session sent a message:\n<agent-message from="a1">report</agent-message>',
    '<local-command-stdout>ok</local-command-stdout>', '<bash-input>ls</bash-input>']) {
    const r = runBash([TYPED_INIT, ...FIRST4, ...UNASKED_HOOKS, typed(notice)], NEXT_RECOMPUTE);
    assert.strictEqual(r.status, 2, notice);
    assert.match(r.stderr, /the hooks ask never happened/);
  }
});

test('6.5: another typed slash command ends the walk', () => {
  const other = typed('<command-message>alfred-code:status</command-message>\n<command-name>/alfred-code:status</command-name>');
  assert.strictEqual(runBash([TYPED_INIT, ...FIRST4, ...UNASKED_HOOKS, other], NEXT_RECOMPUTE).status, 0);
  assert.strictEqual(runBash([TYPED_INIT, ...FIRST4, ...UNASKED_HOOKS, typed('/model')], NEXT_RECOMPUTE).status, 0);
});

test('6.5: an ask the idle timeout closed is no answer', () => {
  const idle = [call('q-hooks', 'AskUserQuestion', layerAsk('Hooks: keep all 18 on?')),
    result('q-hooks', 'No response after 60s - the user may be away from keyboard. Continue with your best judgment.')];
  const r = runBash([TYPED_INIT, ...FIRST4, ...UNASKED_HOOKS, ...idle], NEXT_RECOMPUTE);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.match(r.stderr, /the hooks ask never happened/);
});

test('6.5: the Bash path finds the walk command 1.5MB back, and fails open past its 2MB tail', () => {
  const filler = (kb) => [call('f1', 'Bash', { command: 'cat big.log' }), result('f1', 'x'.repeat(kb * 1024))];
  const at = (kb) => runBash([TYPED_INIT, ...filler(kb), ...FIRST4, ...UNASKED_HOOKS], NEXT_RECOMPUTE);
  const near = at(1536);
  assert.strictEqual(near.status, 2, near.stderr);
  assert.match(near.stderr, /the hooks ask never happened/);
  assert.strictEqual(at(2560).status, 0, 'the command outside the tail: no walk seen, nothing judged');
});

// commands track T2-03: validate's per-layer consent ask ('Agents: accept all 1 rows?') was denied for a `--table` call
// validate never makes - the layer-ask check judged any span holding a stack-select call, not only a walk.
test('T2-03: validate\'s consent ask worded <Layer>: is no walk ask', () => {
  const rows = [typed('/alfred-code:validate'), audit('redundant'), result('t1', ''), say('```\n 1 | x | REDUNDANT | owned by wpf\n```')];
  assert.strictEqual(run(rows, layerAsk('Agents: accept all 1 rows?')).status, 0);
});

test('6.5: a layer ask after a typed reply mid-walk still needs its table', () => {
  const r = run([typed('/alfred-code:configure'), recompute, result('r1', ''), typed('let us do the agents')], layerAsk('Agents: install the marked rows?'));
  assert.strictEqual(r.status, 2, r.stderr);
  assert.match(r.stderr, /agents table never ran/);
});

// commands track T2-01: every artifact is "$TMP/<file>" (source-protocol.md) - a bare raw.json resolves against whatever
// cwd the shell drifted to, and the never-ran denial handed the bare form over.
test('T2-01: the never-ran denial names the selection file under $TMP', () => {
  const r = run([typed('/alfred-code:configure'), recompute, result('r1', '')], layerAsk('Agents: install the marked rows?'));
  assert.match(r.stderr, /--selection "\$TMP\/raw\.json" --table agents/);
});

test('6.5: a compaction summary restarts the walk only when it names it', () => {
  const summary = (text) => ({ type: 'user', isCompactSummary: true, message: { role: 'user', content: text } });
  const named = summary('This session is being continued from a previous conversation. The user ran /alfred-code:init; rules to skills are walked.');
  const r = runBash([TYPED_INIT, ...FIRST4, named, ...UNASKED_HOOKS], NEXT_RECOMPUTE);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.match(r.stderr, /the hooks ask never happened/);
  assert.strictEqual(runBash([TYPED_INIT, ...FIRST4, summary('This session is being continued. The user asked about tests.'), ...UNASKED_HOOKS], NEXT_RECOMPUTE).status, 0);
  // hooks track H1: past a summary init's order check stands down - the layers walked before it are never asked again,
  // and a configure summary that names init first is no init walk; the pending-ask check still judges the tables after it.
  assert.strictEqual(runBash([TYPED_INIT, ...FIRST4, named, ...walked('hooks')], `node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/raw.json" --table plugins --recs r.json`).status, 0);
  const configureNamingInit = summary('Continued. Earlier /alfred-code:init installed the stack; the user then ran /alfred-code:configure.');
  assert.strictEqual(runBash([typed('/alfred-code:configure'), configureNamingInit, ...walked('skills')], EMIT).status, 0);
});

// hooks track H2: an ask result with is_error - another hook's denial, a validation error, the user's rejection - is no
// answer; every real answer arrives with is_error false.
test('H2: an errored ask result is no answer', () => {
  for (const text of ['PreToolUse:AskUserQuestion hook error: [node guard-stop-contract.js]: denied',
    '<tool_use_error>InputValidationError: questions too long</tool_use_error>',
    "The user doesn't want to proceed with this tool use. The tool use was rejected."]) {
    const errored = [call('q-hooks', 'AskUserQuestion', layerAsk('Hooks: keep all 18 on?')), result('q-hooks', text, true)];
    const r = runBash([TYPED_INIT, ...FIRST4, ...UNASKED_HOOKS, ...errored], NEXT_RECOMPUTE);
    assert.strictEqual(r.status, 2, text);
    assert.match(r.stderr, /the hooks ask never happened/);
  }
  const deniedLayerAsk = [call('n1', 'AskUserQuestion', layerAsk('Agents: install?')), result('n1', 'PreToolUse:AskUserQuestion hook error: denied', true)];
  const nr = (n) => [call(`n${n + 1}`, 'AskUserQuestion', layerAsk('Agents: install?')), result(`n${n + 1}`, 'alfred-code layer-table gate: the agents table never ran - x', true)];
  // the never-ran valve is not reset by an errored ask between its denials
  assert.strictEqual(run([typed('/alfred-code:configure'), recompute, result('r1', ''), ...nr(1), ...deniedLayerAsk, ...nr(2), ...nr(3)], layerAsk('Agents: install?')).status, 0);
});

// F24 (the 2026-10-28 workspace run): the workspace plan prints its project table with a `total: <n> projects` line, and
// update's ask after it needs that line in the message, like any decision table.
const wsPlan = () => call('w1', 'Bash', { command: 'node "$TMP/repo/scripts/workspace.js" plan --root . > "$TMP/plan.txt"; grep -qE \'^workspace-plan: ([2-9]|[0-9]{2,}) \' "$TMP/plan.txt" && cat "$TMP/plan.txt"' });
const planOut = 'workspace-plan: 3 projects\nproject | scope\n. | project\napi | local\nweb | local\ntotal: 3 projects';

test('F24: the workspace plan table needs its total line pasted before update asks', () => {
  const start = [typed('/alfred-code:update'), say('Reading the workspace.')];
  assert.strictEqual(runPost([...start, wsPlan(), result('w1', 'workspace-plan: 1 projects\nproject: .')]).stdout, '', 'no table printed: nothing to prove');
  const r = runPost([...start, wsPlan(), result('w1', planOut)]);
  assert.ok(voided(r), r.stdout);
  assert.match(r.out.reason, /workspace plan table ran/);
  assert.strictEqual(runPost([...start, wsPlan(), result('w1', planOut), say('```\n' + planOut + '\n```')]).stdout, '');
});

// The user's note (2026-10-28): Claude Code shows the reason under 'hook returned blocking error', which reads as a
// break, so a printed void opens with a plain line for the user, then the table, and the line for the model comes last.
test('F27: a printed void opens with a plain line for the user, then the table, then the line for the model', () => {
  const r = runPost([...UNPASTED(), thought()]);
  const lines = r.out.reason.split('\n');
  assert.strictEqual(lines[0], "Alfred: the model's message left out the agents table, so it is printed below - your answer was not used, and the same question comes back next.");
  assert.strictEqual(printedOf(r.out.reason), ' 1  x\ntotal: 43 agents - if fewer');
  assert.match(lines[lines.length - 1], /^alfred-code layer-table gate: the agents table ran but its output is not in your message/);
});

// F27 live (the root update): update's plan call cats update-workspace.md after the plan, and the void printed all
// 8,132 chars of it. A void prints the table alone - from its header through its total line.
test('F27: a void prints the plan table alone, never the preflight lines or the reference doc after it', () => {
  const out = `version: 3.2.1 -> 3.2.1\nrelease notes: none owed\n${planOut}\n# /alfred-code:update - the workspace: the children's asks\n\nRead by step 2's call.`;
  const r = runPost([typed('/alfred-code:update'), wsPlan(), result('w1', out)]);
  assert.ok(voided(r), r.stdout);
  assert.strictEqual(printedOf(r.out.reason), 'project | scope\n. | project\napi | local\nweb | local\ntotal: 3 projects');
});

// Review (2026-10-28, Important): a table call the next-step gate denied printed no table, yet the walk back took it as
// the latest table, voided the pasted agents ask and printed the denial as 'the table'.
test('a denied or errored table call is no table: the pasted ask before it passes', () => {
  const denied = call('t2', 'Bash', { command: 'node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/raw.json" --table skills --recs r.json' });
  const rows = [typed('/alfred-code:init'), table('agents'), result('t1', ' 1  x\ntotal: 43 agents - if fewer'), denied,
    result('t2', 'alfred-code layer-table gate: the agents ask never happened - the agents table ran, but its ask never came', true),
    say('```\n 1  x\ntotal: 43 agents - if fewer\n```')];
  assert.strictEqual(runPost(rows).stdout, '', 'the agents table is pasted; the denied skills call is not the latest table');
  const errored = [typed('/alfred-code:init'), table('agents'), result('t1', ' 1  x\ntotal: 43 agents - if fewer'), denied, result('t2', 'node: crashed', true), thought()];
  const r = runPost(errored);
  assert.ok(voided(r), 'the agents table is still unpasted');
  assert.match(r.out.reason, /the agents table ran/);
  assert.strictEqual(printedOf(r.out.reason), ' 1  x\ntotal: 43 agents - if fewer', r.out.reason);
});

test('F27: a layer table void prints through its total line, and a table with no header rule keeps its first line', () => {
  const r = runPost([typed('/alfred-code:init'), say('[step 5/12 - agents] adjust'), table('agents'), result('t1', '[step 5/12 - agents] adjust\n # | agent\n 1 | x\ntotal: 43 agents - if fewer\nunknown: agent foo'), thought()]);
  assert.ok(voided(r), r.stdout);
  assert.strictEqual(printedOf(r.out.reason), '[step 5/12 - agents] adjust\n # | agent\n 1 | x\ntotal: 43 agents - if fewer', r.out.reason);
});
