'use strict';
// conformance.js - the stack's claims graded over a real session (item 7, 2026-10-25). The transcript is parsed once
// (skill-comply's parseTranscript) and cut into the windows a skill or a turn opens; each window is graded by
// skill-comply's own graders (gradeRun), so no second grading language exists. analyze-usage.js prints the result as
// its machine-written Conformance section.
const fs = require('node:fs');
const path = require('node:path');
const sc = require('./skill-comply.js');

const ROOT = path.join(__dirname, '..');
const CLAIMS_FILE = path.join(ROOT, 'meta', 'conformance.json');
const FIXTURES = path.join(__dirname, 'fixtures', 'conformance');
const AREAS = ['navigation', 'scoring', 'preferences', 'awareness', 'questions', 'answers', 'flow', 'decisions'];
// Where each state source is read, data-root-relative: the claims' evidence and a not-visible row's missing path.
const STATE_SOURCES = { history: 'state/history/<sid>.json', scorer: 'state/sessions/scorer/<sid>/', ledger: 'statistics/hook-blocks/<sid>.jsonl' };
const CLOSES = { session: ['end'], turn: ['prompt'], skill: ['stop', 'prompt', 'end'], event: ['event', 'prompt', 'end'] };
const LOCATORS = 5;
const TEXT = '@text';
const TYPED = new Set(['prompt', 'command']);
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A Skill call names the skill bare or as `<plugin>:<skill>`; a typed command row spells it the same way after a `/`.
const callsSkill = (e, skill) => { const n = String((e.input && e.input.skill) || '').replace(/^\//, ''); return n === skill || n.endsWith(`:${skill}`); };
const commandRow = (skill) => new RegExp(`^\\s*<command-name>/?(?:[\\w-]+:)?${esc(skill)}</command-name>`);

// The windows a skill opens, each { from, to, mark, end, partial }: at its Skill call (`from` the call's index - a mark
// at that index was read BEFORE the call, the prompt that asked for it) or at its typed command row (`from` the mark's
// `at`), to the skill's FIRST STOP - after the first AskUserQuestion at or past `from`, or at the next typed prompt or
// command, whichever comes first (`to` exclusive). `mark` / `end` bound the marks inside; a window opening inside an
// earlier one is part of it; `partial` when a compaction summary falls inside. A claim may close it at the next typed
// turn instead (`prompt`) or at the run's end (`end`).
function windowsOf(run, skill, closes = 'stop') {
  const opens = [];
  run.events.forEach((e, i) => { if (e.tool === 'Skill' && callsSkill(e, skill)) opens.push({ from: i, mark: -1 }); });
  const named = commandRow(skill);
  run.marks.forEach((m, k) => { if (m.kind === 'command' && named.test(m.text)) opens.push({ from: m.at, mark: k }); });
  opens.sort((a, b) => a.from - b.from);
  const out = [];
  for (const o of opens) {
    if (out.length && o.from < out[out.length - 1].to) continue;
    const after = o.mark >= 0 ? o.mark + 1 : run.marks.findIndex((m) => m.at > o.from);
    const k = closes === 'end' || after < 0 ? -1 : run.marks.findIndex((m, j) => j >= after && TYPED.has(m.kind));
    let to = k >= 0 ? run.marks[k].at : run.events.length;
    const ask = closes === 'stop' ? run.events.findIndex((e, i) => i >= o.from && i < to && e.tool === 'AskUserQuestion') : -1;
    if (ask >= 0) to = ask + 1;
    out.push(finish(run, { from: o.from, to, mark: o.mark, end: k >= 0 ? k : run.marks.length }));
  }
  return out;
}

// The tool calls a lookback counts: `n` of them before the event (text blocks not counted), or the whole run before it.
function lookbackFrom(run, at, lookback) {
  if (lookback === 'session') return 0;
  let from = at;
  for (let i = at - 1, n = 0; i >= 0 && n < (lookback || 0); i--) if (run.events[i].tool !== TEXT) { n++; from = i; }
  return from;
}

// One window per event the claim opens on (or the first): from its lookback, or from the latest `from` anchor before it,
// to the event itself (`event`), the next typed turn (`prompt`) or the run's end (`end`). Event windows may overlap - each
// event is graded on its own span.
function eventWindows(run, o, closes, refs) {
  const hit = (m) => run.events.map((e, i) => (sc.matches(e, m, refs) ? i : -1)).filter((i) => i >= 0);
  const events = hit(o.event);
  let spans;
  if (o.from !== undefined) {
    const byEvent = new Map();
    for (const a of hit(o.from)) { const e = events.find((i) => i > a); if (e !== undefined) byEvent.set(e, a); }
    spans = [...byEvent].sort((x, y) => x[0] - y[0]).map(([at, from]) => ({ at, from }));
  } else spans = events.map((at) => ({ at, from: lookbackFrom(run, at, o.lookback) }));
  if (o.first) spans = spans.slice(0, 1);
  return spans.map(({ at, from }) => {
    const k = closes === 'prompt' ? run.marks.findIndex((m) => m.at > at && TYPED.has(m.kind)) : -1;
    const to = closes === 'event' ? at + 1 : k >= 0 ? run.marks[k].at : run.events.length;
    return finish(run, { from, to, at, end: k >= 0 ? k : run.marks.length });
  });
}

// A window's own text, for a claim's `when` / `unless`: its typed turns (`typed`) or the harness text it was given
// (`context`), each a regex over the marks inside, case-blind.
const markText = (run, w, kind) => marksIn(run, w).filter((m) => (kind === 'typed' ? TYPED.has(m.kind) : m.kind === 'attachment')).map((m) => m.text).join('\n');
const condHolds = (run, w, cond, k) => new RegExp(cond[k], 'im').test(markText(run, w, k));

// The windows a claim's `window` opens in one run: the whole run, each turn, a skill's run, or each event it names -
// kept where every `when` matches and no `unless` does. `seat` picks the runs (gradeClaims); here it is the run's own.
function windowsFor(run, window, refs = {}) {
  const o = window.opens;
  const form = formOf(o);
  const out = form === 'session' ? [finish(run, { from: 0, to: run.events.length, mark: -1, end: run.marks.length })]
    : form === 'turn' ? turnWindows(run)
      : form === 'skill' ? windowsOf(run, o.skill, window.closes || 'stop')
        : eventWindows(run, o, window.closes || 'event', refs);
  const when = (o && o.when) || {};
  const unless = (o && o.unless) || {};
  return out.filter((w) => Object.keys(when).every((k) => condHolds(run, w, when, k)) && !Object.keys(unless).some((k) => condHolds(run, w, unless, k)));
}
// `opens` is 'session' / 'turn', or an object: { session: true } / { turn: true } to carry a when / unless, a skill, an
// event, or a seat alone (that seat's whole run).
const formOf = (o) => (o === 'session' || o === 'turn' ? o : !o ? 'session'
  : o.skill !== undefined ? 'skill' : o.event !== undefined ? 'event' : o.turn === true ? 'turn' : 'session');

// One window per typed prompt, to the next typed prompt or command: the per-turn claims (answer-budget, background-wait).
function turnWindows(run) {
  const out = [];
  run.marks.forEach((m, k) => {
    if (m.kind !== 'prompt') return;
    const n = run.marks.findIndex((x, j) => j > k && TYPED.has(x.kind));
    out.push(finish(run, { from: m.at, to: n >= 0 ? run.marks[n].at : run.events.length, mark: k, end: n >= 0 ? n : run.marks.length }));
  });
  return out;
}

const marksIn = (run, w) => {
  const first = Number.isInteger(w.mark) && w.mark >= 0 ? w.mark : run.marks.findIndex((m) => m.at >= w.from);
  const end = Number.isInteger(w.end) ? w.end : run.marks.length;
  // a mark read after the last event belongs to a window that runs to the end
  return first < 0 ? [] : run.marks.slice(first, end).filter((m) => m.at >= w.from && (m.at < w.to || (m.at === w.to && w.to === run.events.length)));
};
const finish = (run, w) => ({ ...w, partial: marksIn(run, w).some((m) => m.compact) });

// The run inside one window: its events, its marks rebased to it, the typed marks' text as its users, its last text.
function sliceRun(run, w) {
  const events = run.events.slice(w.from, w.to);
  const marks = marksIn(run, w).map((m) => ({ ...m, at: m.at - w.from }));
  const texts = events.filter((e) => e.tool === TEXT);
  return {
    events, marks, bad: run.bad,
    users: marks.filter((m) => TYPED.has(m.kind)).map((m) => m.text),
    lastMessage: texts.length ? texts[texts.length - 1].input.text : '',
  };
}

// Every window the expectation opens, graded: [{ window, result }], a `session: false` step listed SKIP, never graded.
function gradeSession(run, expect) {
  const windows = expect.window === 'turn' ? turnWindows(run) : windowsOf(run, expect.skill);
  const off = new Set(expect.steps.filter((s) => s.session === false).map((s) => s.id));
  const live = { ...expect, steps: expect.steps.filter((s) => !off.has(s.id)) };
  return windows.map((window) => {
    const result = sc.gradeRun(live, sliceRun(run, window));
    if (off.size) {
      const graded = new Map(result.steps.map((s) => [s.id, s]));
      result.steps = expect.steps.map((s) => graded.get(s.id) || { id: s.id, verdict: 'SKIP', results: [{ name: 'session', type: 'session', skipped: true, explanation: 'SKIPPED - session: false' }] });
      result.skipped += off.size;
    }
    return { window, result };
  });
}

// --- the session bundle: the transcript, its seats and the state the claims read ------------------------------------

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const toMs = (v) => { const n = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(n) ? n : null; };

// One session as a run leaves it: `<sid>.jsonl`, its seats under `<sid>/subagents/`, and the data root's state - each
// source null (with the path it was looked for at in `missing`) when absent or unreadable, else its rows.
function loadBundle(transcript, { dataRoot, hookBlocks } = {}) {
  const file = path.resolve(transcript);
  const dir = path.dirname(file);
  const sid = path.basename(file).replace(/\.jsonl$/, '');
  const main = sc.parseTranscript(fs.readFileSync(file, 'utf8'));
  const seatDir = path.join(dir, sid, 'subagents');
  const seats = (isDir(seatDir) ? fs.readdirSync(seatDir) : []).filter((n) => /^agent-.+\.jsonl$/.test(n)).sort().map((n) => {
    let agentType = null;
    try { agentType = JSON.parse(fs.readFileSync(path.join(seatDir, n.replace(/\.jsonl$/, '.meta.json')), 'utf8')).agentType || null; } catch { /* no meta: an unnamed seat */ }
    return { agentType, run: sc.parseTranscript(fs.readFileSync(path.join(seatDir, n), 'utf8'), { sidechain: true }) };
  });
  const root = dataRoot !== undefined ? (dataRoot ? path.resolve(dataRoot) : null) : (isDir(path.join(dir, 'data')) ? path.join(dir, 'data') : null);
  const rel = (src) => STATE_SOURCES[src].replace('<sid>', sid);
  const at = (src) => (root ? path.join(root, ...rel(src).split('/').filter(Boolean)) : null);
  const missing = {};
  const absent = (src, why = '') => { missing[src] = `${src === 'ledger' && hookBlocks ? path.resolve(hookBlocks) : rel(src)}${why}`; return null; };

  const history = (() => {
    const p = at('history');
    if (!p || !isFile(p)) return absent('history');
    let rec;
    try { rec = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return absent('history', ' (unreadable)'); }
    if (!rec || !Array.isArray(rec.rulings)) return absent('history');   // an older writer kept no rulings
    return rec.rulings.filter((r) => r && typeof r === 'object').map((r) => ({ ts: toMs(r.ts), question: r.question, answer: r.answer }));
  })();
  const scorer = (() => {
    const p = at('scorer');
    if (!p || !isDir(p)) return absent('scorer');
    const rows = [];
    for (const slug of fs.readdirSync(p).sort()) {
      const log = path.join(p, slug, 'rounds.log');
      if (!isFile(log)) continue;
      const ts = fs.statSync(log).mtimeMs;
      for (const line of fs.readFileSync(log, 'utf8').split('\n')) if (line.trim()) rows.push({ slug, line: line.trim(), ts });
    }
    return rows;
  })();
  const ledger = (() => {
    // A --hook-blocks folder names the ledger as the analyzer's readBlockLedger does: a bundle keeps it beside the
    // transcript as hook-blocks-<sid>.jsonl, the docs root as <sid>.jsonl - which in a bundle is the transcript itself.
    const p = hookBlocks
      ? (isDir(hookBlocks) ? [`hook-blocks-${sid}.jsonl`, `${sid}.jsonl`].map((n) => path.resolve(hookBlocks, n)).find((f) => isFile(f) && f !== file) : path.resolve(hookBlocks))
      : at('ledger');
    if (!p || !isFile(p)) return absent('ledger');
    const rows = [];
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); if (r && typeof r === 'object') rows.push({ ...r, ts: toMs(r.ts) }); } catch { /* a cut line */ }
    }
    return rows;
  })();
  return { sid, dataRoot: root, session: { main, seats }, state: { history, scorer, ledger, missing } };
}

// --- the claims ------------------------------------------------------------------------------------------------------

const compilesOr = (src, flags, bad, where) => { try { new RegExp(src, flags); } catch (err) { bad(`${where}: /${src}/ does not compile - ${err.message}`); } };

function checkWindow(w, bad) {
  if (!w || typeof w !== 'object') bad('window must be { opens, closes? }');
  const o = w.opens;
  if (o !== 'session' && o !== 'turn' && (!o || typeof o !== 'object')) bad("window.opens is 'session', 'turn' or { session | turn | skill | event | seat, ... }");
  if (o && typeof o === 'object') {
    const forms = ['session', 'turn', 'skill', 'event'].filter((k) => o[k] !== undefined);
    if (forms.length > 1) bad(`window.opens takes one of session, turn, skill or event, not ${forms.join(' and ')}`);
    if (!forms.length && o.seat === undefined) bad('window.opens names a session, a turn, a skill, an event or a seat');
    for (const k of ['session', 'turn']) if (o[k] !== undefined && o[k] !== true) bad(`window.opens.${k} takes only true`);
    if (o.seat !== undefined) compilesOr(o.seat, '', bad, 'window.opens.seat');
    for (const k of ['from', 'lookback', 'first']) if (o[k] !== undefined && o.event === undefined) bad(`window.opens.${k} needs an event`);
    if (o.lookback !== undefined && o.lookback !== 'session' && !(Number.isInteger(o.lookback) && o.lookback >= 0)) bad("window.opens.lookback is a count of tool calls or 'session'");
    if (o.from !== undefined && o.lookback !== undefined) bad('window.opens takes a from anchor or a lookback, not both');
    for (const c of ['when', 'unless']) {
      if (o[c] === undefined) continue;
      if (!o[c] || typeof o[c] !== 'object' || !Object.keys(o[c]).length) bad(`window.opens.${c} is { typed?, context? }`);
      for (const [k, re] of Object.entries(o[c])) {
        if (k !== 'typed' && k !== 'context') bad(`window.opens.${c} reads 'typed' or 'context', not '${k}'`);
        compilesOr(re, 'im', bad, `window.opens.${c}.${k}`);
      }
    }
  }
  if (w.closes !== undefined && !CLOSES[formOf(o)].includes(w.closes)) bad(`window.closes '${w.closes}' does not fit this window (${CLOSES[formOf(o)].join(' | ')})`);
}

// A claim step is one skill-comply grader with an id, a step of an expectation file by reference (`from_expect`, so its
// graders keep one home), or an `x_state` step; each becomes { id, graders } or stays x_state.
function normalizeStep(s, matchers, bad) {
  if (!s || typeof s !== 'object' || !s.id) bad('every step needs an id');
  if (s.from_expect !== undefined) {
    let exp;
    try { exp = sc.loadExpectation(s.from_expect).data; } catch (err) { bad(`step ${s.id}: ${err.message}`); }
    const want = s.step || s.id;
    const st = (exp.steps || []).find((x) => x.id === want);
    if (!st) bad(`step ${s.id}: '${want}' is not a step of ${s.from_expect}'s expect.json`);
    for (const [k, m] of Object.entries(exp.matchers || {})) {
      if (matchers[k] !== undefined && JSON.stringify(matchers[k]) !== JSON.stringify(m)) bad(`step ${s.id}: matcher '${k}' of ${s.from_expect} clashes with another of the same name`);
      matchers[k] = m;
    }
    return { id: s.id, graders: st.graders, ...(st.session === false ? { session: false } : {}) };
  }
  if (s.type === 'x_state') {
    if (!Object.hasOwn(STATE_SOURCES, s.source)) bad(`step ${s.id}: unknown x_state source '${s.source}' (${Object.keys(STATE_SOURCES).join(' | ')})`);
    if (!s.match || typeof s.match !== 'object' || !Object.keys(s.match).length) bad(`step ${s.id}: x_state needs a match`);
    for (const [f, re] of Object.entries(s.match)) compilesOr(re, '', bad, `step ${s.id} match.${f}`);
    if (s.before !== undefined && s.perEvent !== undefined) bad(`step ${s.id}: x_state takes before or perEvent, not both`);
    return s;
  }
  if (!sc.EVAL_TYPES.has(s.type) && !sc.X_TYPES.has(s.type) && !sc.SKIP_TYPES[s.type]) bad(`step ${s.id}: unknown step type '${s.type}'`);
  const { id, ...grader } = s;
  return { id, graders: [grader] };
}

// meta/conformance.json's claims, each checked and its steps resolved; throws naming the claim on the first fault.
function loadClaims(file = CLAIMS_FILE) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const shared = (doc && doc.matchers) || {};
  const ids = new Set();
  return ((doc && doc.claims) || []).map((c, i) => {
    const bad = (why) => { throw new Error(`${path.relative(ROOT, file)} claim ${(c && c.id) || `#${i + 1}`}: ${why}`); };
    if (!c || typeof c !== 'object') bad('a claim is an object');
    for (const k of ['id', 'area', 'claim', 'source', 'window', 'steps']) if (c[k] === undefined || c[k] === '') bad(`'${k}' is missing`);
    if (ids.has(c.id)) bad('the id is taken');
    ids.add(c.id);
    if (!AREAS.includes(c.area)) bad(`unknown area '${c.area}' (${AREAS.join(', ')})`);
    if (!c.source || typeof c.source.file !== 'string' || typeof c.source.marker !== 'string' || !c.source.marker) bad('source is { file, marker }');
    checkWindow(c.window, bad);
    if (!Array.isArray(c.steps) || !c.steps.length) bad('steps must be a non-empty list');
    const matchers = { ...shared };
    const steps = c.steps.map((s) => normalizeStep(s, matchers, bad));
    return { ...c, matchers, steps };
  });
}

// What a claim's verdict stands on: the trace alone, or the data-root paths its state steps read.
function evidenceOf(claim) {
  const sources = [...new Set(claim.steps.filter((s) => s.type === 'x_state').map((s) => s.source))];
  return sources.length ? sources.map((s) => STATE_SOURCES[s]) : 'trace';
}

// An x_state step in one window, in this order: N/A when it names an event the window lacks; NOT VISIBLE when the source
// is absent, no row qualifies, or a `before` has no time to order by; then the order or the count; else PASS.
function gradeState(step, slice, state, refs, need) {
  const anchor = step.before !== undefined ? step.before : step.perEvent;
  const events = anchor !== undefined ? slice.events.filter((e) => sc.matches(e, anchor, refs)) : null;
  if (events && !events.length) return 'N/A';
  const rows = state[step.source];
  if (!Array.isArray(rows)) { need.add(step.source); return 'NOT VISIBLE'; }
  const q = rows.filter((r) => Object.entries(step.match).every(([f, re]) => new RegExp(re).test(String(r[f] ?? ''))));
  if (!q.length) return 'NOT VISIBLE';
  if (step.before !== undefined) {
    const timed = q.filter((r) => Number.isFinite(r.ts));
    if (!timed.length || !Number.isFinite(events[0].ts)) return 'NOT VISIBLE';
    return Math.min(...timed.map((r) => r.ts)) < events[0].ts ? 'PASS' : 'FAIL';
  }
  if (step.perEvent !== undefined) return q.length >= events.length ? 'PASS' : 'FAIL';
  return 'PASS';
}

// Each claim over a session bundle: per window its verdicts; a window counts (applied) when a step decided something,
// and reads violated on any FAIL, else not visible on any NOT VISIBLE, else held. A seat claim grades each seat's run.
function gradeClaims(bundle, claims) {
  const { main, seats = [] } = bundle.session;
  const state = bundle.state || { history: null, scorer: null, ledger: null, missing: {} };
  return claims.map((c) => {
    const seat = c.window.opens && typeof c.window.opens === 'object' ? c.window.opens.seat : undefined;
    const runs = seat !== undefined
      ? seats.filter((s) => new RegExp(seat).test(String(s.agentType || ''))).map((s) => ({ label: `seat ${s.agentType}`, run: s.run }))
      : [{ label: 'main', run: main }];
    // a claim built by hand (not through loadClaims) may carry its graders as bare steps
    const plain = c.steps.filter((s) => s.type !== 'x_state').map((s) => (Array.isArray(s.graders) ? s : (({ id, ...g }) => ({ id, graders: [g] }))(s)));
    const live = plain.filter((s) => s.session !== false);
    const out = { id: c.id, area: c.area, applied: 0, held: 0, violated: 0, notVisible: 0, partial: 0, missing: '', locators: [] };
    const need = new Set();
    for (const { label, run } of runs) for (const w of windowsFor(run, c.window, c.matchers)) {
      const slice = sliceRun(run, w);
      const verdicts = live.length ? sc.gradeRun({ skill: c.id, matchers: c.matchers, steps: live }, slice).steps.map((s) => s.verdict) : [];
      const wanted = new Set();
      for (const s of c.steps) if (s.type === 'x_state') verdicts.push(gradeState(s, slice, state, c.matchers, wanted));
      if (!verdicts.some((v) => v === 'PASS' || v === 'FAIL' || v === 'NOT VISIBLE')) continue;
      out.applied++;
      if (w.partial) out.partial++;
      for (const s of wanted) need.add(s);
      if (verdicts.includes('FAIL')) {
        out.violated++;
        if (out.locators.length < LOCATORS) {
          const ts = (slice.events.find((e) => Number.isFinite(e.ts)) || {}).ts;
          out.locators.push(`${label} events ${w.from}-${Math.max(w.from, w.to - 1)}${Number.isFinite(ts) ? ` (${new Date(ts).toISOString()})` : ''}`);
        }
      } else if (verdicts.includes('NOT VISIBLE')) out.notVisible++;
      else out.held++;
    }
    out.missing = [...need].map((s) => {
      const p = (state.missing && state.missing[s]) || STATE_SOURCES[s].replace('<sid>', bundle.sid || '<sid>');
      return path.isAbsolute(p) ? p : `<data root>/${p}`;
    }).join('; ');
    return out;
  });
}

// A claim's fixture bundles, scripts/fixtures/conformance/<id>/<case>/s.jsonl: held, violated, and unseen for a state claim.
function claimFixtures(id) {
  const out = {};
  for (const k of ['held', 'violated', 'unseen']) {
    const f = path.join(FIXTURES, id, k, 's.jsonl');
    if (isFile(f)) out[k] = loadBundle(f);
  }
  return out;
}

// Lint check 68: a claim cites the line that states its behaviour, so that line leaving its file sends the claim to review.
function lintConformance(claims) {
  return claims.flatMap((c) => {
    let text;
    try { text = fs.readFileSync(path.join(ROOT, c.source.file), 'utf8'); }
    catch { return [`meta/conformance.json claim ${c.id}: its source ${c.source.file} does not exist (check 68)`]; }
    return text.includes(c.source.marker) ? [] : [`meta/conformance.json claim ${c.id}: its marker is no longer in ${c.source.file} - the behaviour it cites changed, so review the claim (check 68)`];
  });
}

module.exports = { windowsOf, turnWindows, windowsFor, sliceRun, gradeSession, loadBundle, loadClaims, evidenceOf, gradeClaims, claimFixtures, lintConformance, AREAS, STATE_SOURCES };
