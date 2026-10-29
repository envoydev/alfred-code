'use strict';
// The cache-aware fresh-session verdict (fresh-session.js `freshVerdict`): a fresh session is offered only when it pays
// back within P messages with the prompt cache warm - its floor priced as a full new write, this session's carry as a
// cached re-read. Spec docs/superpowers/specs/2026-10-28-fresh-session-cache-design.md, sections 1 and 3.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const eng = require(path.join(__dirname, '..', 'stack', 'hooks', 'fresh-session.js'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-verdict-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const MODEL = 'claude-opus-5-5';
const reply = (id, usage, { model = MODEL, top = {} } = {}) => ({
  type: 'assistant', version: '2.1.312', ...top, message: { id, model, role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage },
});
// The session's first reply: F tokens, `share` of them read from cache, the rest written under `ttl` ('1h', '5m' or none).
function firstRow({ floor = 79000, share = 0, ttl = '1h', model = MODEL } = {}) {
  const read = Math.round(floor * share);
  const usage = { cache_read_input_tokens: read, cache_creation_input_tokens: floor - read };
  if (ttl === '1h') usage.cache_creation = { ephemeral_1h_input_tokens: floor - read, ephemeral_5m_input_tokens: 0 };
  if (ttl === '5m') usage.cache_creation = { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: floor - read };
  return reply('r1', usage, { model });
}
let n = 0;
function session(rows, extra = {}) {
  const p = path.join(TMP, `s${++n}.jsonl`);
  fs.writeFileSync(p, rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n');
  eng.use({ transcript_path: p, cwd: TMP, session_id: `fv-${n}`, ...extra });
  return p;
}
const standard = (opts) => session([firstRow(opts), reply('r2', { cache_read_input_tokens: 150000 }, { model: (opts && opts.model) || MODEL })]);
function withEnv(values, fn) {
  const before = {};
  for (const [k, v] of Object.entries(values)) { before[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const noPayback = (fn) => withEnv({ ALFRED_CODE_FRESH_SESSION_PAYBACK: undefined }, fn);

test('freshVerdict: the measured points', () => noPayback(() => {
  standard();
  for (const [ctx, pays, breakEven] of [[100000, false, 449], [200000, false, 34], [250000, true, 23], [400000, true, 12]]) {
    const v = eng.freshVerdict(ctx);
    assert.equal(v.pays, pays, `pays at ${ctx}`);
    assert.equal(v.breakEven, breakEven, `breakEven at ${ctx}`);
  }
}));

test('freshVerdict: the boundary is exact', () => noPayback(() => {
  standard();
  assert.deepEqual([211599, 211600, 211601].map((c) => [eng.freshVerdict(c).pays, eng.freshVerdict(c).breakEven]),
    [[false, 31], [false, 30], [true, 30]]);
}));

test('freshVerdict: P', () => {
  standard();
  withEnv({ ALFRED_CODE_FRESH_SESSION_PAYBACK: '1' }, () => assert.equal(eng.freshVerdict(400000).pays, false));
  withEnv({ ALFRED_CODE_FRESH_SESSION_PAYBACK: '0' }, () => {
    assert.equal(eng.freshVerdict(400000).pays, false);
    assert.equal(eng.freshVerdict(900000).pays, false);
  });
  const of = (v) => eng.paybackOf({ ALFRED_CODE_FRESH_SESSION_PAYBACK: v });
  assert.equal(of('1000'), 1000);
  assert.equal(of('0'), 0);
  for (const v of ['-1', '1001', '2.5', '', 'abc']) assert.equal(of(v), 30, `'${v}' reads as 30`);
  assert.equal(eng.paybackOf({}), 30, 'unset reads as 30');
});

test('freshVerdict: no reading, no floor', () => noPayback(() => {
  standard();
  assert.deepEqual([eng.freshVerdict(0).pays, eng.freshVerdict(0).breakEven], [false, null], 'ctx 0');
  assert.deepEqual([eng.freshVerdict(90000).pays, eng.freshVerdict(90000).breakEven], [false, null], 'ctx under G');
  session([{ type: 'user', message: { role: 'user', content: 'hi' } }]);
  const v = eng.freshVerdict(400000);
  assert.equal(v.pays, false);
  assert.equal(v.unmeasured, true);
  // a first reply whose usage is all zeros (an error row) is no floor: the read goes on to the next reply
  session([reply('r0', { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), firstRow(), reply('r2', { cache_read_input_tokens: 250000 })]);
  assert.equal(eng.coldFloor(), 79000, 'the zero reply is skipped');
  assert.equal(eng.freshVerdict(250000).pays, true);
}));

test('freshVerdict: a window that compacts first changes nothing (A9)', () => noPayback(() => {
  standard();
  const plain = eng.freshVerdict(180000);
  const compacting = withEnv({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: '200000' }, () => { standard(); return eng.freshVerdict(180000); });
  assert.equal(plain.pays, false);
  assert.equal(compacting.pays, false, 'the same as without it');
  standard({ model: 'claude-sonnet-4-5' });
  const v = eng.freshVerdict(180000);
  assert.equal(v.pays, true);
  assert.equal(v.breakEven, 20);
}));

test('freshVerdict: the floor\'s cached share is reported, never priced', () => noPayback(() => {
  standard({ share: 0.9 });
  const cached = eng.freshVerdict(250000);
  standard({ share: 0 });
  const written = eng.freshVerdict(250000);
  assert.deepEqual([cached.pays, cached.breakEven], [written.pays, written.breakEven]);
  assert.equal(cached.readShare, 0.9);
  assert.equal(written.readShare, 0);
}));

test('freshVerdict: TTL and rates', () => noPayback(() => {
  standard({ ttl: '5m' });
  assert.equal(eng.freshVerdict(250000).writeRate, 1250);
  standard({ ttl: 'none' });
  const v = eng.freshVerdict(250000);
  assert.deepEqual([v.ttl, v.ttlFrom], ['5m', 'fallback']);
  standard({ model: 'claude-unknown-9' });
  assert.equal(eng.freshVerdict(250000).readRate, 100);
  session([firstRow(), { type: 'system', subtype: 'compact_boundary' }, reply('r2', { cache_read_input_tokens: 30000 })]);
  const after = eng.freshVerdict(250000);
  assert.deepEqual([after.ttl, after.ttlFrom, after.version], ['1h', 'split', '2.1.312']);
}));

test('cacheTtl: a cut first line widens the read', () => {
  // the only split row sits so the 64KB tail's first byte lands 100 bytes before its end; the row after it writes no cache
  const split = JSON.stringify(firstRow());
  const laterOf = (text) => JSON.stringify(reply('p1', { cache_read_input_tokens: 90000, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 } }, { top: {} }))
    .replace('"text":"ok"', `"text":"${text}"`);
  const size = 64 * 1024 - 100 - 2;
  const later = laterOf('y'.repeat(size - laterOf('').length));
  assert.equal(later.length, size);
  assert.ok(split.length > 100, 'the 64KB tail cuts the split row');
  session([{ type: 'user', message: { role: 'user', content: 'x'.repeat(70 * 1024) } }, split, later]);
  assert.deepEqual(eng.cacheTtl(), { ttl: '1h', ttlFrom: 'split', version: '2.1.312' });
  session(Array.from({ length: 50 }, () => '{not json'));
  const garbage = eng.cacheTtl();
  assert.deepEqual([garbage.ttl, garbage.ttlFrom], ['5m', 'fallback']);
});

test('prices: the rates equal meta/model-prices.json', () => {
  const { models } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'model-prices.json'), 'utf8'));
  let checked = 0;
  for (const row of models) {
    for (const price of [row, ...Object.values(row).filter((v) => v && typeof v === 'object' && 'input' in v && 'cache_read' in v)]) {
      assert.ok(Math.abs(1000 * price.cache_read / price.input - eng.readRateOf(row.id)) < 1e-6, `${row.id} read rate`);
      assert.ok(Math.abs(1000 * price.cache_write_1h / price.input - eng.WRITE_RATES['1h']) < 1e-6, `${row.id} 1h write`);
      assert.ok(Math.abs(1000 * price.cache_write_5m / price.input - eng.WRITE_RATES['5m']) < 1e-6, `${row.id} 5m write`);
      checked++;
    }
  }
  assert.ok(checked > models.length, 'the nested long-prompt price is checked too');
  assert.equal(eng.RESUME_READ, 13000);
  assert.ok(Object.isFrozen(eng.CACHE_READ_RATES));
});

test('modelKey: the windows table\'s key rule', () => {
  const keys = ['claude-opus-5', 'claude-opus-5-5'];
  assert.equal(eng.modelKey('claude-opus-5-5', keys), 'claude-opus-5-5');
  assert.equal(eng.modelKey('claude-opus-5-5-20261001', keys), 'claude-opus-5-5');
  assert.equal(eng.modelKey('us.anthropic.claude-opus-5-5-v1:0', keys), 'claude-opus-5-5');
  assert.equal(eng.modelKey('claude-opus-5-5[1m]', keys), 'claude-opus-5-5');
  assert.equal(eng.modelKey('claude-opus-5', keys), 'claude-opus-5');
  assert.equal(eng.modelKey('claude-opus-5-7', keys), null, 'a point release is no snapshot');
  assert.equal(eng.readRateOf('claude-fable-5-1'), 25);
  assert.equal(eng.readRateOf(null), 100);
  assert.deepEqual([50, 25, 100, 1250, 2000].map(eng.rateX), ['0.05x', '0.025x', '0.1x', '1.25x', '2x']);
});

test('texts: the paying and not-paying sentences', () => noPayback(() => {
  standard();
  assert.equal(eng.payText(250000, eng.freshVerdict(250000)),
    'This session carries ~250k tokens per message; with the cache warm (1h TTL) a turn re-reads it at 0.05x the input price. '
    + 'A fresh session restarts at ~79k, written new at 2x, and pays back in about 23 messages.');
  assert.equal(eng.notPayText(200000, eng.freshVerdict(200000)),
    'This session carries ~200k tokens per message; with the cache warm (1h TTL) a turn re-reads it at 0.05x. '
    + 'A fresh session restarts at ~79k, written new at 2x, and would pay back only after about 34 messages, past the 30-message window.');
  assert.equal(eng.notPayText(90000, eng.freshVerdict(90000)),
    'This session carries ~90k tokens per message, no more than a fresh session\'s ~79k floor plus the ~13k it re-reads, '
    + 'so a fresh session saves nothing.');
  assert.match(eng.notPayText(211600, eng.freshVerdict(211600)), /would pay back only after about 30 messages, no sooner than the 30-message window ends\.$/, 'at equality it is not past the window');
  withEnv({ ALFRED_CODE_FRESH_SESSION_PAYBACK: '0' }, () => assert.equal(eng.notPayText(250000, eng.freshVerdict(250000)),
    'This session carries ~250k tokens per message; fresh-session offers are off here (ALFRED_CODE_FRESH_SESSION_PAYBACK is 0).'));
}));

test('verdictProbe: once per session per route per pays', () => noPayback(() => {
  const logDir = fs.mkdtempSync(path.join(TMP, 'log-'));
  withEnv({ ALFRED_CODE_HOOK_LOG_DIR: logDir }, () => {
    standard();
    const first = eng.verdictProbe('stop', 250000, eng.freshVerdict(250000));
    assert.ok(first, 'the first paying verdict on the route writes a row');
    assert.equal(eng.verdictProbe('stop', 260000, eng.freshVerdict(260000)), null, 'a second one on the same route does not');
    const no = eng.verdictProbe('stop', 100000, eng.freshVerdict(100000));
    assert.ok(no, 'a not-paying verdict on the same route writes its own row');
    assert.deepEqual([first.mode, first.kind], ['probe', 'fresh-verdict']);
    assert.match(first.reason, /stop route - pays$/);
    assert.match(no.reason, /does not pay$/);
    assert.deepEqual(Object.keys(first.detail).sort(),
      ['breakEven', 'ctx', 'floor', 'payback', 'pays', 'readRate', 'readShare', 'resumeRead', 'route', 'share40', 'ttl', 'ttlFrom', 'unattended', 'version']);
    assert.equal(first.detail.unattended, false, 'somebody at the terminal');
    withEnv({ ALFRED_CODE_UNATTENDED: '1' }, () => assert.equal(eng.verdictProbe('size', 250000, eng.freshVerdict(250000)).detail.unattended, true, 'nobody at it'));
    assert.equal(first.detail.share40, true, '(250k - 79k) >= 40% of 250k');
    assert.equal(no.detail.share40, false, '(100k - 79k) is 21% of 100k - the old rule said no too');
  });
  withEnv({ ALFRED_CODE_HOOK_LOG_DIR: path.join(TMP, 'no-such-dir', 'x') }, () => {
    standard();
    assert.equal(eng.verdictProbe('stop', 250000, eng.freshVerdict(250000)), null, 'a marker that cannot be written writes no row');
  });
}));
