// The fresh-session offer end to end: which WINDOW a session runs in, which TRIGGER that window
// takes, how the CONTEXT figure is summed, and when a resume is worth offering. Every case runs
// against BOTH hooks that carry the arithmetic - guard-stop-contract.js (the turn-end offer) and
// guard-fresh-session-start.js (the orchestration-run gate) - because the two must never sit on
// different numbers in one session. Boundaries are pinned exactly: the offer fires when
// context > trigger, so trigger itself passes and trigger + 1 fires.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const TABLE = JSON.parse(fs.readFileSync(path.join(HOOKS, 'model-windows.json'), 'utf8')).models;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-window-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// A Claude Code session hands its settings env to this process; every knob the arithmetic reads is
// cleared so each case states exactly the values it runs with.
const KNOBS = ['ALFRED_CODE_FRESH_SESSION_1M', 'ALFRED_CODE_FRESH_SESSION_200K', 'ALFRED_CODE_FRESH_SESSION_DEFAULT',
  'ALFRED_CODE_DEFAULT_CONTEXT_WINDOW', 'ALFRED_CODE_HOOK_LOG_DIR', 'CLAUDE_CONFIG_DIR', 'CLAUDE_PROJECT_DIR'];
const baseEnv = () => {
  const env = { ...process.env };
  for (const k of KNOBS) delete env[k];
  // envOf (hook-prelude.js, 2.0.0) now answers a bare CLAUDE_STACK_* the same way it answers // legacy-name
  // ALFRED_CODE_* - so the same session-env leakage the KNOBS list guards against reaches every
  // 1.x-spelled knob too (measured here: a real CLAUDE_STACK_DEFAULT_CONTEXT_WINDOW=1000000 turned // legacy-name
  // the 'no fallback set' case's DEFAULT trigger into the 1M one). Strip the whole prefix.
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_STACK_')) delete env[k]; // legacy-name
  env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));    // no account settings model
  env.CLAUDE_PROJECT_DIR = fs.mkdtempSync(path.join(TMP, 'root-'));   // no project settings, no ledger in the repo
  return env;
};

// A session transcript: the FIRST assistant message is the cold floor a resume re-pays, the LAST one
// carries the context being judged. `usage` may split the figure across the three input fields.
let seq = 0;
function session(model, usage, { floor = 20000 } = {}) {
  const name = `s${++seq}`;
  const p = path.join(TMP, `${name}.jsonl`);
  const rows = [
    { type: 'assistant', message: { id: `${name}-1`, model, content: [{ type: 'text', text: 'first turn' }], usage: { cache_creation_input_tokens: floor } } },
    { type: 'assistant', message: { id: `${name}-2`, model, content: [{ type: 'text', text: 'Applied the change; tests pass.' }], usage } },
  ];
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return p;
}
const carry = (ctx) => ({ cache_read_input_tokens: ctx });

// Both routes, each on its own fresh state dir so an earlier offer never answers a later case.
const HOOK_ROUTES = {
  'guard-stop-contract (turn end)': (tp, env) => ['guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp }, env],
  'guard-fresh-session-start (run gate)': (tp, env) => ['guard-fresh-session-start.js', { tool_name: 'Skill', tool_input: { skill: 'project-verify-code' }, transcript_path: tp }, env],
};
function run([hook, payload, env]) {
  return spawnSync(process.execPath, [path.join(HOOKS, hook)], { input: JSON.stringify(payload), encoding: 'utf8', env }).status;
}
function offered(route, tp, extra = {}, logDir) {
  const env = { ...baseEnv(), ALFRED_CODE_HOOK_LOG_DIR: logDir || fs.mkdtempSync(path.join(TMP, 'state-')), ...extra };
  const status = run(HOOK_ROUTES[route](tp, env));
  assert.ok(status === 0 || status === 2, `${route}: exit ${status} is neither pass nor offer`);
  return status === 2;
}
// The trigger a window takes with the seeded defaults.
const triggerFor = (window) => (window === 1000000 ? 400000 : window === 200000 ? 150000 : 180000);

for (const route of Object.keys(HOOK_ROUTES)) {
  test(`${route}: every model-windows.json row maps to its window's trigger, exact at the boundary`, () => {
    for (const [model, window] of Object.entries(TABLE)) {
      const at = triggerFor(window);
      assert.equal(offered(route, session(model, carry(at))), false, `${model} (${window}): ${at} is AT the trigger - no offer`);
      assert.equal(offered(route, session(model, carry(at + 1))), true, `${model} (${window}): ${at + 1} is past it - offer`);
    }
  });

  test(`${route}: context is input + cache read + cache creation of the LAST message`, () => {
    // 400,001 on a 1M model only when all three fields are added; any two of them stay under 400,000.
    const split = { input_tokens: 1, cache_read_input_tokens: 250000, cache_creation_input_tokens: 150000 };
    assert.equal(offered(route, session('claude-opus-5', split)), true, '1 + 250,000 + 150,000 = 400,001 - past the 400,000 trigger');
    assert.equal(offered(route, session('claude-opus-5', { ...split, input_tokens: 0 })), false, '0 + 250,000 + 150,000 = 400,000 - at it');
    assert.equal(offered(route, session('claude-opus-5', { cache_read_input_tokens: 399999, output_tokens: 90000 })), false,
      'output tokens are not context - 399,999 read plus 90,000 output stays under');
  });

  test(`${route}: a model the table lacks takes ALFRED_CODE_DEFAULT_CONTEXT_WINDOW, else the DEFAULT trigger`, () => {
    const cases = [
      ['1000000', 400000, 'the 1M fallback takes the 1M trigger'],
      ['200000', 150000, 'a 200k fallback takes the 200k trigger'],
      ['500000', 180000, 'a window that is neither named size takes the DEFAULT trigger'],
      [undefined, 180000, 'no fallback set: the DEFAULT trigger'],
      ['lots', 180000, 'a garbage fallback is no fallback'],
    ];
    for (const [fallback, at, why] of cases) {
      const extra = fallback === undefined ? {} : { ALFRED_CODE_DEFAULT_CONTEXT_WINDOW: fallback };
      assert.equal(offered(route, session('claude-nova-9', carry(at)), extra), false, `${why}: ${at} passes`);
      assert.equal(offered(route, session('claude-nova-9', carry(at + 1)), extra), true, `${why}: ${at + 1} offers`);
    }
  });

  test(`${route}: the tier variables move the trigger, and 0 switches that tier off`, () => {
    assert.equal(offered(route, session('claude-sonnet-5', carry(250001)), { ALFRED_CODE_FRESH_SESSION_1M: '250000' }), true, '_1M=250000: 250,001 offers');
    assert.equal(offered(route, session('claude-sonnet-5', carry(250000)), { ALFRED_CODE_FRESH_SESSION_1M: '250000' }), false, '... 250,000 does not');
    assert.equal(offered(route, session('claude-haiku-4-5', carry(120001)), { ALFRED_CODE_FRESH_SESSION_200K: '120000' }), true, '_200K=120000: 120,001 offers');
    assert.equal(offered(route, session('claude-opus-5', carry(900000)), { ALFRED_CODE_FRESH_SESSION_1M: '0' }), false, '_1M=0: no offer at any size');
    assert.equal(offered(route, session('claude-opus-5', carry(900000)), { ALFRED_CODE_FRESH_SESSION_200K: '0', ALFRED_CODE_FRESH_SESSION_DEFAULT: '0' }), true,
      'the other tiers\' off switches do not reach a 1M row');
  });

  test(`${route}: a trigger at or above its window is clamped to 90% of the window`, () => {
    // _200K=250000 can never be reached on a 200k window, so it becomes floor(200,000 x 0.9) = 180,000.
    const env = { ALFRED_CODE_FRESH_SESSION_200K: '250000' };
    assert.equal(offered(route, session('claude-haiku-4-5', carry(180000)), env), false, 'clamped trigger 180,000 - at it');
    assert.equal(offered(route, session('claude-haiku-4-5', carry(180001)), env), true, '180,001 is past it');
  });

  test(`${route}: the offer needs carry minus the FIRST message's floor to be at least 40% of the carry`, () => {
    // 1M model, carry 410,000: 40% is 164,000, so the floor may be at most 246,000.
    assert.equal(offered(route, session('claude-opus-5', carry(410000), { floor: 246000 })), true, '410,000 - 246,000 = 164,000 = 40% - worth a resume');
    assert.equal(offered(route, session('claude-opus-5', carry(410000), { floor: 246001 })), false, '163,999 recoverable is under 40% - no offer');
    assert.equal(offered(route, session('claude-opus-5', carry(410000), { floor: 20000 })), true, 'a small floor recovers nearly all of it');
  });
  test(`${route}: a zero-usage <synthetic> row last is not the context - the last REAL call is`, () => {
    // An interrupt or API error writes a `<synthetic>` assistant row with zeroed usage; read as the
    // context it made a hot session look empty.
    const tp = session('claude-opus-5', carry(450000));
    fs.appendFileSync(tp, JSON.stringify({ type: 'assistant', message: { id: 'syn', model: '<synthetic>',
      content: [{ type: 'text', text: 'Done.' }], usage: { input_tokens: 0, output_tokens: 0 } } }) + '\n');
    assert.equal(offered(route, tp), true, '450,000 from the real call before the synthetic row - offer');
  });

  test(`${route}: a last row bigger than the 512KB tail window still yields its usage`, () => {
    // One huge Write input is one jsonl row; a 512KB tail read starts mid-row and parsed nothing.
    const tp = session('claude-opus-5', carry(10));
    const rows = fs.readFileSync(tp, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    rows[1].message.content = [{ type: 'text', text: 'x'.repeat(600 * 1024) }];
    rows[1].message.usage = carry(450000);
    fs.writeFileSync(tp, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    assert.equal(offered(route, tp), true, '450,000 on a 600KB last row - offer');
  });
}

test('guard-stop-contract (turn end): once offered, the offer re-arms only after 1.5x growth', () => {
  // ONE transcript and ONE state dir, as a real session has: the offer at 450,000 is remembered, and
  // the next one needs 450,000 x 1.5 = 675,000.
  const logDir = fs.mkdtempSync(path.join(TMP, 'rearm-'));
  const tp = session('claude-opus-5', carry(450000));
  const grow = (ctx) => {
    const rows = fs.readFileSync(tp, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    rows[1].message.usage = carry(ctx);
    fs.writeFileSync(tp, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  };
  const route = 'guard-stop-contract (turn end)';
  assert.equal(offered(route, tp, {}, logDir), true, '450,000: the first offer');
  grow(674999);
  assert.equal(offered(route, tp, {}, logDir), false, '674,999 is under 1.5x of the offered 450,000');
  grow(675000);
  assert.equal(offered(route, tp, {}, logDir), true, '675,000 is 1.5x - asked again');
});
