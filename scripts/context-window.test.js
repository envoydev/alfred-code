// The fresh-session offer end to end: which WINDOW a session runs in, which TRIGGER that window
// takes, how the CONTEXT figure is summed, and when a resume is worth offering. Every case runs
// against BOTH hooks that carry the arithmetic - guard-stop-contract.js (the turn-end offer) and
// guard-fresh-session-start.js (the orchestration-run gate) - because the two must never sit on
// different numbers in one session. Boundaries are pinned exactly: the offer fires when
// context > trigger, so trigger itself passes and trigger + 1 fires.
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
delete process.env.CLAUDE_CODE_ENTRYPOINT; // the runner's own entrypoint (sdk-cli under claude -p) never decides a case - hook-prelude.js unattended()
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
// cleared, then the four window keys get the seeds an install writes (absent-only, meta/environment.json),
// so each case states exactly the values it runs with. A case passes `undefined` to unset one.
const KNOBS = ['ALFRED_CODE_CONTEXT_WINDOW_FOR_1M', 'ALFRED_CODE_CONTEXT_WINDOW_FOR_300K', 'ALFRED_CODE_CONTEXT_WINDOW_FOR_200K',
  'ALFRED_CODE_CONTEXT_WINDOW_DEFAULT', 'ALFRED_CODE_AUTO_COMPACT', 'ALFRED_CODE_HOOK_LOG_DIR', 'CLAUDE_CONFIG_DIR', 'CLAUDE_PROJECT_DIR',
  'CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_CODE_AUTOCOMPACT_WINDOW'];
const SEEDS = { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '400000', ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: '280000',
  ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '180000', ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '180000' };
const baseEnv = () => {
  const env = { ...process.env };
  for (const k of KNOBS) delete env[k];
  Object.assign(env, SEEDS);
  env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));    // no account settings model
  env.CLAUDE_PROJECT_DIR = fs.mkdtempSync(path.join(TMP, 'root-'));   // no project settings, no ledger in the repo
  return env;
};
const unsetUndefined = (env) => { for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k]; return env; };

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
  'guard-fresh-session-start (run gate)': (tp, env) => ['guard-fresh-session-start.js', { tool_name: 'Skill', tool_input: { skill: 'task-verify-code' }, transcript_path: tp }, env],
};
function run([hook, payload, env]) {
  return spawnSync(process.execPath, [path.join(HOOKS, hook)], { input: JSON.stringify(payload), encoding: 'utf8', env }).status;
}
function offered(route, tp, extra = {}, logDir) {
  const env = unsetUndefined({ ...baseEnv(), ALFRED_CODE_HOOK_LOG_DIR: logDir || fs.mkdtempSync(path.join(TMP, 'state-')), ...extra });
  const status = run(HOOK_ROUTES[route](tp, env));
  assert.ok(status === 0 || status === 2, `${route}: exit ${status} is neither pass nor offer`);
  return status === 2;
}
// The trigger a window takes with the seeded defaults: the largest tier it reaches (fresh-session.js tierKeyOf).
const triggerFor = (window) => (window >= 1000000 ? 400000 : window >= 300000 ? 280000 : 180000);

// Every id the models pages list (platform.claude.com models overview and each legacy model's page, fetched
// 2026-09-29), spelled as each platform spells it, against the page's context window. The fallback trigger is
// 1,000,000, so a model the table misses never offers at its own tier's trigger + 1 and shows here (2.1.5 M6:
// Opus 4.5 and Sonnet 4.5 took 1M), and a
// point release that matched its sibling through the old `-` suffix rule (claude-opus-5-5 read as a snapshot
// of claude-opus-5) no longer can.
const PAGE_IDS = [
  ...['claude-fable-5-1', 'claude-mythos-5-1', 'claude-fable-5', 'claude-mythos-5', 'claude-opus-5-5', 'claude-opus-5',
    'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-sonnet-4-6',
    'anthropic.claude-opus-5-5', 'anthropic.claude-sonnet-5-5', 'claude-opus-5-5[1m]'].map((id) => [id, 1000000]),
  ...['claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-haiku-4-5@20251001', 'anthropic.claude-haiku-4-5',
    'claude-opus-4-5', 'claude-opus-4-5-20251101', 'anthropic.claude-opus-4-5-20251101-v1:0', 'claude-opus-4-5@20251101',
    'claude-sonnet-4-5', 'claude-sonnet-4-5-20250929', 'anthropic.claude-sonnet-4-5-20250929-v1:0', 'claude-sonnet-4-5@20250929',
    'us.anthropic.claude-sonnet-4-5-20250929-v1:0'].map((id) => [id, 200000]),
];
test('every model id on the models pages takes its own window, not a sibling\'s or the fallback (2.1.5 M6)', () => {
  const route = Object.keys(HOOK_ROUTES)[0];
  for (const [id, window] of PAGE_IDS) {
    const at = triggerFor(window);
    const extra = { ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '1000000' };
    assert.equal(offered(route, session(id, carry(at)), extra), false, `${id} (${window}): ${at} is AT its trigger`);
    assert.equal(offered(route, session(id, carry(at + 1)), extra), true, `${id} (${window}): ${at + 1} is past it`);
  }
  for (const key of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-4-5', 'claude-sonnet-4-5'])
    assert.ok(Object.hasOwn(TABLE, key), `${key} has its own row`);
});

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

  test(`${route}: a model the table lacks has no known window, so ALFRED_CODE_CONTEXT_WINDOW_DEFAULT is the trigger itself`, () => {
    const cases = [
      ['180000', 180000, 'the seed is the trigger'],
      ['350000', 350000, 'a declared default is the trigger, not a window to tier'],
      ['1000000', 1000000, 'a default no window clamps'],
      [undefined, 180000, 'unset reads as 180,000'],
      ['lots', 180000, 'garbage reads as 180,000'],
      ['-5', 180000, 'a negative number is garbage'],
    ];
    for (const [fallback, at, why] of cases) {
      const extra = { ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: fallback };
      assert.equal(offered(route, session('claude-nova-9', carry(at)), extra), false, `${why}: ${at} passes`);
      assert.equal(offered(route, session('claude-nova-9', carry(at + 1)), extra), true, `${why}: ${at + 1} offers`);
    }
    assert.equal(offered(route, session('claude-nova-9', carry(900000)), { ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '0' }), false, '0 switches the fallback off');
    assert.equal(offered(route, session('claude-opus-5', carry(400001)), { ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '0' }), true, '... and never a listed model\'s tier');
  });

  test(`${route}: a tier value that is unset or garbage falls to ALFRED_CODE_CONTEXT_WINDOW_DEFAULT, never to a built-in number`, () => {
    for (const bad of [undefined, 'lots', '-1', '']) {
      const extra = { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: bad, ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '250000' };
      assert.equal(offered(route, session('claude-opus-5', carry(250000)), extra), false, `_FOR_1M=${bad}: 250,000 is AT the default trigger`);
      assert.equal(offered(route, session('claude-opus-5', carry(250001)), extra), true, `_FOR_1M=${bad}: 250,001 is past it`);
    }
    const unset = { ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: undefined, ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: undefined };
    assert.equal(offered(route, session('claude-haiku-4-5', carry(180001)), unset), true, 'both unset: the 180,000 the default reads as');
    assert.equal(offered(route, session('claude-haiku-4-5', carry(180000)), unset), false, '... exact at it');
  });

  test(`${route}: the tier variables move the trigger, and 0 switches that tier off`, () => {
    assert.equal(offered(route, session('claude-sonnet-5', carry(250001)), { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '250000' }), true, '_FOR_1M=250000: 250,001 offers');
    assert.equal(offered(route, session('claude-sonnet-5', carry(250000)), { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '250000' }), false, '... 250,000 does not');
    assert.equal(offered(route, session('claude-haiku-4-5', carry(120001)), { ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '120000' }), true, '_FOR_200K=120000: 120,001 offers');
    assert.equal(offered(route, session('claude-nova-9', carry(180001)), { ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: '500000' }), true,
      '_FOR_300K never reaches an unlisted model: its window is unknown, so the default\'s 180,000 is the trigger');
    assert.equal(offered(route, session('claude-opus-5', carry(900000)), { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '0' }), false, '_FOR_1M=0: no offer at any size');
    assert.equal(offered(route, session('claude-nova-9', carry(290000)), { ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: '0' }), true, '_FOR_300K=0 does not switch off an unlisted model');
    assert.equal(offered(route, session('claude-opus-5', carry(900000)), { ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '0', ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: '0' }), true,
      'the other tiers\' off switches do not reach a 1M row');
    assert.equal(offered(route, session('claude-opus-5', carry(900000)), { ALFRED_CODE_FRESH_SESSION_1M: '0', ALFRED_CODE_FRESH_SESSION_DEFAULT: '0', ALFRED_CODE_DEFAULT_CONTEXT_WINDOW: '200000' }), true,
      'the retired names are read by nothing');
    assert.equal(offered(route, session('claude-opus-5', carry(900000)), { ALFRED_CODE_AUTO_COMPACT: '1' }), false, 'AUTO_COMPACT=1: no offer at any size');
    assert.equal(offered(route, session('claude-haiku-4-5', carry(190000)), { ALFRED_CODE_AUTO_COMPACT: '1' }), false, '... on any tier');
    assert.equal(offered(route, session('claude-opus-5', carry(900000)), { ALFRED_CODE_AUTO_COMPACT: '0' }), true, 'AUTO_COMPACT=0 keeps the offer');
  });

  test(`${route}: the account file's top-level autoCompactWindow lowers an Opus 5.5 window (audit HK03)`, () => {
    // settings-reference `autoCompactWindow`: 'Scope: Any file', no model limit (re-read 2026-10-14). A 390k window under
    // the 1M tier's 400k trigger holds it at 90% of the window: 351,000.
    const account = fs.mkdtempSync(path.join(TMP, 'acct-window-'));
    fs.writeFileSync(path.join(account, 'settings.json'), JSON.stringify({ autoCompactWindow: 390000 }));
    const env = { CLAUDE_CONFIG_DIR: account };
    assert.equal(offered(route, session('claude-opus-5-5', carry(351000)), env), false, 'clamped trigger 351,000 - at it');
    assert.equal(offered(route, session('claude-opus-5-5', carry(351001)), env), true, '351,001 is past it');
  });

  test(`${route}: a trigger at or above its window is clamped to 90% of the window`, () => {
    // _FOR_200K=250000 can never be reached on a 200k window, so it becomes floor(200,000 x 0.9) = 180,000.
    const env = { ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '250000' };
    assert.equal(offered(route, session('claude-haiku-4-5', carry(180000)), env), false, 'clamped trigger 180,000 - at it');
    assert.equal(offered(route, session('claude-haiku-4-5', carry(180001)), env), true, '180,001 is past it');
  });

  test(`${route}: the offer needs a fresh session to pay back with the cache warm`, () => {
    // claude-opus-5 is no rates row (read 0.1x) and the fixture has no cache split (5m, written 1.25x); carry 410,000,
    // payback 30. G = F + 13,000: G 296,385 costs 340,842,750 < 30 x 113,615 x 100 = 340,845,000; G 296,386 costs
    // 340,843,900 > 340,842,000.
    assert.equal(offered(route, session('claude-opus-5', carry(410000), { floor: 283385 })), true, 'floor 283,385 pays back inside 30 messages');
    assert.equal(offered(route, session('claude-opus-5', carry(410000), { floor: 283386 })), false, 'floor 283,386 does not');
    assert.equal(offered(route, session('claude-opus-5', carry(410000), { floor: 20000 })), true, 'a small floor pays back at once');
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

test('a window takes the largest tier it reaches - 1M, 300K, 200K - and under 200K or unknown takes none', () => {
  const { tierKeyOf } = require(path.join(HOOKS, 'fresh-session.js'));
  const cases = [[2000000, '1M'], [1000000, '1M'], [999999, '300K'], [300000, '300K'], [299999, '200K'], [200000, '200K'],
    [199999, null], [100000, null], [0, null], [null, null], [undefined, null]];
  for (const [window, tier] of cases)
    assert.equal(tierKeyOf(window), tier && `ALFRED_CODE_CONTEXT_WINDOW_FOR_${tier}`, `${window}`);
});

// The DEFAULT is a trigger too, so the whole off switch is all four keys at 0, and the walk's one fresh-session question -
// whose 'do not use the feature' answer writes `group_off` to the owner and every row riding with it - carries it.
test('the DEFAULT rides the fresh-session group, so turning the feature off reaches a session with no tier', () => {
  const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'environment.json'), 'utf8')).env;
  const owner = rows.find((r) => r.group_off !== undefined && r.key === 'ALFRED_CODE_CONTEXT_WINDOW_FOR_1M');
  assert.ok(owner, 'the 1M row owns the group');
  const group = rows.filter((r) => r.asked_with === owner.key).map((r) => r.key).sort();
  assert.deepStrictEqual(group, ['ALFRED_CODE_AUTO_COMPACT', 'ALFRED_CODE_CONTEXT_WINDOW_DEFAULT', 'ALFRED_CODE_CONTEXT_WINDOW_FOR_200K', 'ALFRED_CODE_CONTEXT_WINDOW_FOR_300K']);
});

// THE SESSION'S MODEL (the user's ruling, 2026-10-21): the window is the model's own capacity, read off its FULL id. The
// settings `model` key is an alias (`sonnet`) and names no capacity, so it is never read; SessionStart's `model` and
// PostModelSwitch's `to_model` are saved per session, and the newer of that record and the transcript's last model row wins.
test('the model SessionStart or PostModelSwitch recorded decides the window until a newer transcript row names one', () => {
  const env = unsetUndefined({ ...baseEnv(), ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'state-')) });
  const root = env.CLAUDE_PROJECT_DIR;
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ model: 'sonnet' }));
  const start = (sid, extra) => run(['guard-fresh-session-start.js', { hook_event_name: 'SessionStart', source: 'startup', session_id: sid, cwd: root, ...extra }, env]);
  const stop = (sid, tp) => run(['guard-stop-contract.js', { hook_event_name: 'Stop', session_id: sid, cwd: root, transcript_path: tp }, env]) === 2;
  const stamped = (model, usage, at) => {
    const tp = session(model, usage);
    const rows = fs.readFileSync(tp, 'utf8').trim().split('\n').map((l) => ({ ...JSON.parse(l), timestamp: at }));
    fs.writeFileSync(tp, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return tp;
  };
  const past = new Date(Date.now() - 3600000).toISOString();
  const future = new Date(Date.now() + 3600000).toISOString();

  assert.equal(start('m1', { model: 'claude-haiku-4-5' }), 0, 'SessionStart passes');
  const file = path.join(root, '.alfred', 'state', 'sessions', 'models.json');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).m1.model, 'claude-haiku-4-5', 'saved under the session');
  assert.equal(stop('m1', stamped('claude-opus-5', carry(190000), past)), true, 'the recorded 200K model is newer than the 1M rows: 190,000 is past 180,000');
  start('m1b', { model: 'claude-haiku-4-5' });
  assert.equal(stop('m1b', stamped('claude-opus-5', carry(190000), future)), false, 'a transcript row newer than the record wins: 1M, 400,000');
  assert.equal(stop('m1c', stamped('claude-opus-5', carry(190000), past)), false, 'another session\'s record is never read');

  assert.equal(start('m2', { model: 'claude-opus-5' }), 0);
  assert.equal(run(['guard-fresh-session-start.js', { hook_event_name: 'PostModelSwitch', session_id: 'm2', cwd: root, from_model: 'claude-opus-5', to_model: 'claude-haiku-4-5' }, env]), 0, 'PostModelSwitch passes');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).m2.model, 'claude-haiku-4-5', 'the switch replaces the record');
  assert.equal(stop('m2', stamped('claude-opus-5', carry(190000), past)), true, 'the switched-to 200K model decides');

  assert.equal(start('m3', { source: 'clear' }), 0, 'a SessionStart with no model (after /clear) records nothing');
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(file, 'utf8')), 'm3'), false);
  assert.equal(stop('m3', session('claude-opus-5', carry(390000))), false, 'no record: the transcript\'s 1M model');
});

test('the saved models keep the newest 40 sessions', () => {
  const env = unsetUndefined({ ...baseEnv(), ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'state-')) });
  for (let i = 1; i <= 42; i++)
    run(['guard-fresh-session-start.js', { hook_event_name: 'SessionStart', source: 'startup', session_id: `k${i}`, cwd: env.CLAUDE_PROJECT_DIR, model: 'claude-opus-5' }, env]);
  const saved = Object.keys(JSON.parse(fs.readFileSync(path.join(env.CLAUDE_PROJECT_DIR, '.alfred', 'state', 'sessions', 'models.json'), 'utf8')));
  assert.equal(saved.length, 40);
  assert.ok(!saved.includes('k1') && !saved.includes('k2') && saved.includes('k42'), 'the two oldest dropped');
});

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
