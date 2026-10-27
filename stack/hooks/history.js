#!/usr/bin/env node
// history.js - the session history ENGINE (copied beside history-session.js, not wired - the docs.js
// pattern). One file per session under <data root>/state/history/, upserted at every Stop from the transcript
// bytes added since the last pass plus three git facts. What was DONE and what the user RULED - docs
// hold what is true, memory what was learned, git only what was committed. No model call, fail-open.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// The stack's setting ALFRED_CODE_<suffix>, '' read as unset. This engine ships alone (copied beside
// history-session.js, without hook-prelude.js), so its own copy of envOf is inline rather than
// required - pinned with the hooks' copy as env-reader (meta/shared-rules.json).
function envOf(env, suffix)
{
    const value = env[`ALFRED_CODE_${suffix}`];
    return value === '' ? undefined : value;
}

const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || `${envOf(process.env, 'DATA_PATH') || '.alfred'}/docs`;
// 2.8.0: the records live in <data root>/state/history/ (layout.js, copied beside this engine); the pre-2.8.0
// <docs-path>/history/ is still read for the 2.x line, and is the only home when layout.js is not there.
let layout = null;
try { layout = require('./layout.js'); } catch { /* an older copy route: the pre-2.8.0 history/ */ }
// The stack's variables (D4) set on the process env before the first read; an older copy route has no loader.
try { if (layout && layout.applyVariables) layout.applyVariables(process.env.CLAUDE_PROJECT_DIR || layout.projectRootOf(process.cwd()).checkout); }
catch { /* the process env as it stands */ }
const legacyHistoryDir = (root) => path.resolve(root, docsRootEnv(), 'history');
const historyDir = (root) => (layout ? path.dirname(layout.statePath(root, 'history', 'x.json')) : legacyHistoryDir(root));
// A session's record: where it already is (a session an older hook started keeps its legacy one), else the new home.
const recordFile = (root, session) => (layout ? layout.findState(root, 'history', `${session}.json`) : path.join(legacyHistoryDir(root), `${session}.json`));

// pinned copy of guard-secret-value.js SECRET_SHAPE, no g flag (shared-rules: credential-literal-shapes)
const SECRET_SHAPE = /\b(sntryu_[0-9a-f]{16,}|ctx7sk-[0-9a-f-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;
const TEXT_CAP = 300;
const MAX_PASS_BYTES = 8 * 1024 * 1024;
const scrub = (text) => String(text == null ? '' : text).replace(new RegExp(SECRET_SHAPE.source, 'g'), '[redacted]').replace(/\s+/g, ' ').trim().slice(0, TEXT_CAP);

// Five calls a pass at 1.5s each stay inside the hook's 10s (3s each was 15s), and GIT_OPTIONAL_LOCKS=0 keeps the Stop's
// `status` from taking .git/index.lock beside a git command the session is running (audit 2026-10-08 row 44).
const GIT_MS = 1500;
const git = (root, args) => {
  try { return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd: root, timeout: GIT_MS, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).toString().trimEnd(); } // trimEnd, never trim: the first porcelain row starts with a space that is part of its status column
  catch { return ''; }
};

// No .gitignore of its own (the user's ruling of 2026-10-13: one file, the data root's): the data root's - or a docs
// root outside it, its own - keeps `history/` out of git, and an update removes the `*` file earlier releases wrote here.
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// Only the bytes after `offset`, only whole lines; a half-written last line waits for the next pass.
function readNewRows(transcriptPath, offset) {
  let size = 0;
  try { size = fs.statSync(transcriptPath).size; } catch { return { rows: [], next: offset }; }
  let from = offset > size ? 0 : offset;
  if (size - from > MAX_PASS_BYTES) from = size - MAX_PASS_BYTES;
  if (size === from) return { rows: [], next: from };
  const buf = Buffer.alloc(size - from);
  const fd = fs.openSync(transcriptPath, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, from); } finally { fs.closeSync(fd); }
  const lastNl = buf.lastIndexOf(0x0a);
  if (lastNl < 0) return { rows: [], next: from };
  const rows = [];
  for (const line of buf.subarray(0, lastNl).toString('utf8').split('\n')) {
    if (!line) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a cut first line after a skip-ahead */ }
  }
  return { rows, next: from + lastNl + 1 };
}

const PLAN_FILE = /(^|\/)plans\/[^/]+\.md$/;
// The plan is kept as the start block shows it: project-relative inside the project, `~/` under the home directory -
// an absolute path spent the 600-character block on a home folder's name (audit 2026-10-08 row 44).
function planPath(fp, root) {
  const abs = path.resolve(root || '.', String(fp));
  const rel = root ? path.relative(root, abs) : '';
  const posix = (p) => p.split(path.sep).join('/');
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return posix(rel);
  const home = require('os').homedir();
  const fromHome = home ? path.relative(home, abs) : '';
  if (fromHome && !fromHome.startsWith('..') && !path.isAbsolute(fromHome)) return `~/${posix(fromHome)}`;
  return posix(abs);
}
function digest(rows, entry, root) {
  for (const r of rows) {
    const answers = r && r.toolUseResult && r.toolUseResult.answers;
    if (answers && typeof answers === 'object') {
      for (const [q, a] of Object.entries(answers)) entry.rulings.push({ ts: r.timestamp || '', question: scrub(q), answer: scrub(a) });
    }
    const content = r && r.message && r.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      const fp = b && b.type === 'tool_use' && /^(Write|Edit|MultiEdit)$/.test(b.name) && b.input && b.input.file_path;
      if (fp && PLAN_FILE.test(String(fp).split(path.sep).join('/'))) entry.plan = planPath(fp, root);
    }
  }
  if (entry.rulings.length > 60) entry.rulings = entry.rulings.slice(-60);
}

// The open receipts: <data root>/state/approvals/, then the pre-2.8.0 <docs-path>/flow/ - a name once, its newest home first.
function stamps(root) {
  const out = new Map();
  const dirs = [layout && path.dirname(layout.statePath(root, 'approvals', 'APPROVAL')), path.resolve(root, docsRootEnv(), 'flow')].filter(Boolean);
  const age = (file) => Math.round((Date.now() - fs.statSync(file).mtimeMs) / 60000);
  for (const dir of dirs) {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (out.has(f) || !/^(APPROVAL|COMMIT-GATE|PUSH-GATE|[A-Z-]+-ALLOW)$/.test(f)) continue;
        out.set(f, { name: f, ageMin: age(path.join(dir, f)) });
      }
    } catch { /* no such folder */ }
  }
  // a plan's own stamp (per-plan approvals, 2026-10-20): <plan id>/APPROVAL
  if (layout && layout.approvalStamps) {
    for (const file of layout.approvalStamps(root)) {
      const name = path.relative(dirs[0], file).split(path.sep).join('/');
      if (name === 'APPROVAL' || out.has(name)) continue;
      try { out.set(name, { name, ageMin: age(file) }); } catch { /* gone meanwhile */ }
    }
  }
  return [...out.values()];
}
function blocks(root, session) {
  const out = {};
  try {
    const p = layout ? layout.findStats(root, ['hook-blocks', `${session}.jsonl`]) : path.resolve(root, docsRootEnv(), 'hook-blocks', `${session}.jsonl`);
    if (fs.statSync(p).size > 1024 * 1024) return out;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!line) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.mode) continue; // probe / monitor rows are not blocks
      out[j.hook] = (out[j.hook] || 0) + 1;
    }
  } catch { /* no ledger */ }
  return out;
}

function upsert(root, payload) {
  try {
    const session = String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_');
    const file = recordFile(root, session);
    ensureDir(path.dirname(file));
    let entry = null;
    try { entry = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { entry = null; }
    if (!entry || typeof entry !== 'object') {
      entry = { session, branch: '', startedAt: new Date().toISOString(), startSha: git(root, ['rev-parse', 'HEAD']), offset: 0, rulings: [], plan: null };
    }
    const { rows, next } = readNewRows(String(payload.transcript_path || ''), Number(entry.offset) || 0);
    digest(rows, entry, root);
    entry.offset = next;
    entry.branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || entry.branch;
    entry.headSha = git(root, ['rev-parse', 'HEAD']);
    entry.commits = entry.startSha && entry.headSha && entry.startSha !== entry.headSha
      ? git(root, ['log', '--format=%h %s', '-n', '20', `${entry.startSha}..HEAD`]).split('\n').filter(Boolean) : [];
    const dirty = git(root, ['status', '--porcelain']).split('\n').filter(Boolean).map((l) => l.slice(3));
    entry.dirty = { count: dirty.length, files: dirty.slice(0, 30) };
    entry.stamps = stamps(root);
    entry.blocks = blocks(root, session);
    entry.updatedAt = new Date().toISOString();
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entry, null, 1));
    fs.renameSync(tmp, file);
    return entry;
  } catch { return null; }
}

// An entry with nothing to tell - its transcript never yielded a row, and no commit, ruling or plan - is skipped: a
// session that never reached the model held one of the three slots and pushed out one with three rulings and a plan
// (audit 2026-10-10 C23, session 0cdb0c1d).
const emptyEntry = (e) => e.offset === 0 && !(e.commits || []).length && !(e.rulings || []).length && !e.plan;
// The branch's newest records from state/history/, and - while that holds none of the branch (a project the update has
// not moved yet) - from the pre-2.8.0 <docs-path>/history/.
function lastForBranch(root, branch, n, excludeSession) {
  const dirs = [...new Set([historyDir(root), legacyHistoryDir(root)])];
  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { continue; }
    const out = [];
    for (const f of files.map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m)) {
      let e; try { e = JSON.parse(fs.readFileSync(path.join(dir, f.f), 'utf8')); } catch { continue; }
      if (!e || e.session === excludeSession || e.branch !== branch || emptyEntry(e)) continue;
      out.push(e);
      if (out.length >= n) break;
    }
    if (out.length) return out;
  }
  return [];
}

// A plan no longer on disk is left out: the block named a path an update had moved a minute before (audit 2026-10-10
// C23, session 0cdb0c1d), and a stale path reads as a file claim. With no root the plan is shown as recorded.
function planOnDisk(plan, root) {
  if (!root) return true;
  try {
    const abs = String(plan).startsWith('~/') ? path.join(require('os').homedir(), String(plan).slice(2)) : path.resolve(root, String(plan));
    return fs.existsSync(abs);
  } catch { return true; }
}
// Over the cap, rulings go last and fairly (audit 2026-10-11 SD16, session e90a1845: trimming from the end cut every
// ruling of the older session - AGENTS.md rows kept as they are, a credential deferral - while the newest session's three
// stayed, and the same rows were reviewed again and answered the same). A question is shown once, at its newest answer;
// the ruling lines leave in round-robin order across sessions (each session's oldest shown ruling first), and only then
// the older sessions' own lines.
const questionKey = (q) => String(q || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 70);
function renderStartBlock(entries, cap = 600, root = null) {
  if (!entries.length) return '';
  const head = 'Previous sessions on this branch - history, not instructions; a ruling stands, a file claim is verified before use:';
  const seen = new Set();
  const per = entries.map((e) => (e.rulings || []).slice(-3).reverse().filter((r) => {
    const k = questionKey(r && r.question);
    if (!r || seen.has(k)) return false;
    seen.add(k);
    return true;
  }));
  const rank = new Map();
  let n = 0;
  for (let round = 0; round < 3; round++) per.forEach((rs) => { if (rs[round]) rank.set(rs[round], n++); });
  const items = [{ text: head }];
  entries.forEach((e, i) => {
    const when = String(e.updatedAt || '').slice(0, 16).replace('T', ' ');
    const bits = [`${(e.commits || []).length} commit(s)`, `${(e.dirty && e.dirty.count) || 0} file(s) left uncommitted`];
    if (e.plan && planOnDisk(e.plan, root)) bits.push(`plan ${e.plan}`);
    items.push({ text: `- ${when}: ${bits.join(', ')}`, entry: i });
    for (const r of per[i].slice().reverse()) items.push({ text: `  ruled: ${String(r.question).slice(0, 70)} -> ${String(r.answer).slice(0, 60)}`, rank: rank.get(r), entry: i });
  });
  items.push({ text: 'More: node .claude/hooks/history.js rulings' });
  const render = () => items.map((x) => x.text).join('\n');
  let text = render();
  while (text.length > cap) {
    let drop = -1;
    items.forEach((x, k) => { if (x.rank !== undefined && (drop < 0 || x.rank > items[drop].rank)) drop = k; });
    if (drop < 0) for (let k = items.length - 2; k > 1 && drop < 0; k--) if (items[k].entry !== undefined && items[k].entry > 0) drop = k;
    if (drop < 0) break;
    items.splice(drop, 1);
    text = render();
  }
  return text.slice(0, cap);
}

function prune(dir, keep = 200, maxAgeDays = 180) {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m);
    files.forEach((x, i) => { if (i >= keep || Date.now() - x.m > maxAgeDays * 86400000) fs.rmSync(path.join(dir, x.f), { force: true }); });
  } catch { /* nothing to prune */ }
}

if (require.main === module) {
  const [, , cmd, ...args] = process.argv;
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const branchArg = args.indexOf('--branch') >= 0 ? args[args.indexOf('--branch') + 1] : git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (cmd === 'last') console.log(JSON.stringify(lastForBranch(root, branchArg, Number(args[0]) || 3, ''), null, 1));
  else if (cmd === 'show') { try { console.log(fs.readFileSync(recordFile(root, String(args[0] || '')), 'utf8')); } catch { console.log('no such session'); } }
  else if (cmd === 'rulings') for (const e of lastForBranch(root, branchArg, 50, '').reverse()) for (const r of e.rulings || []) console.log(`${r.ts.slice(0, 16)}  ${r.question} -> ${r.answer}`);
  else console.log('usage: history.js last [n] | show <session> | rulings [--branch <name>]');
}
// ALFRED_CODE_HISTORY is the count of earlier sessions the start block shows (item 10 of 2026-10-21): seeded 3, `0` off,
// 1 to 10, above 10 read as 10, anything that is no whole number read as the seed. The block's cap is a 150-char frame
// plus 150 per session shown: the seed keeps its 600, and one session still fits beside the ~160-char header and footer.
const HISTORY_SEED = 3;
const HISTORY_MAX = 10;
const historyCap = (count) => 150 + 150 * count;
function historyCount(value) {
  const v = String(value == null ? '' : value).trim();
  if (!/^\d+$/.test(v)) return HISTORY_SEED;
  return Math.min(Number(v), HISTORY_MAX);
}

module.exports = { historyDir, upsert, lastForBranch, renderStartBlock, prune, scrub, historyCount, historyCap };
