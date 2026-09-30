#!/usr/bin/env node
// history.js - the session history ENGINE (copied beside history-session.js, not wired - the docs.js
// pattern). One file per session under <docs-path>/history/, upserted at every Stop from the transcript
// bytes added since the last pass plus three git facts. What was DONE and what the user RULED - docs
// hold what is true, memory what was learned, git only what was committed. No model call, fail-open.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// 2.0.0 renamed every setting CLAUDE_STACK_* -> ALFRED_CODE_*. This engine ships alone (copied // legacy-name
// beside history-session.js, without hook-prelude.js), so its own copy of envOf is inline rather
// than required - pinned with the hooks' copy as env-legacy-fallback (meta/shared-rules.json).
function envOf(env, suffix)
{
    const fresh = env[`ALFRED_CODE_${suffix}`];
    if (fresh !== undefined && fresh !== '') return fresh;
    const old = env[`CLAUDE_STACK_${suffix}`]; // legacy-name
    if (old !== undefined && old !== '') return old;
    return suffix === 'DOCS_PATH' ? env.CLAUDE_DOCS_PATH : old; // legacy-name
}

const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || '.alfred/docs';
const historyDir = (root) => path.resolve(root, docsRootEnv(), 'history');

// pinned copy of guard-secret-value.js SECRET_SHAPE, no g flag (shared-rules: credential-literal-shapes)
const SECRET_SHAPE = /\b(sntryu_[0-9a-f]{16,}|ctx7sk-[0-9a-f-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;
const TEXT_CAP = 300;
const MAX_PASS_BYTES = 8 * 1024 * 1024;
const scrub = (text) => String(text == null ? '' : text).replace(new RegExp(SECRET_SHAPE.source, 'g'), '[redacted]').replace(/\s+/g, ' ').trim().slice(0, TEXT_CAP);

const git = (root, args) => {
  try { return execFileSync('git', args, { cwd: root, timeout: 3000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trimEnd(); } // trimEnd, never trim: the first porcelain row starts with a space that is part of its status column
  catch { return ''; }
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const ig = path.join(dir, '.gitignore');
  if (!fs.existsSync(ig)) fs.writeFileSync(ig, '*\n');
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
function digest(rows, entry) {
  for (const r of rows) {
    const answers = r && r.toolUseResult && r.toolUseResult.answers;
    if (answers && typeof answers === 'object') {
      for (const [q, a] of Object.entries(answers)) entry.rulings.push({ ts: r.timestamp || '', question: scrub(q), answer: scrub(a) });
    }
    const content = r && r.message && r.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      const fp = b && b.type === 'tool_use' && /^(Write|Edit|MultiEdit)$/.test(b.name) && b.input && b.input.file_path;
      if (fp && PLAN_FILE.test(String(fp).split(path.sep).join('/'))) entry.plan = String(fp).split(path.sep).join('/');
    }
  }
  if (entry.rulings.length > 60) entry.rulings = entry.rulings.slice(-60);
}

function stamps(root) {
  const dir = path.resolve(root, docsRootEnv(), 'flow');
  try {
    return fs.readdirSync(dir).filter((f) => /^(APPROVAL|COMMIT-GATE|PUSH-GATE|[A-Z-]+-ALLOW)$/.test(f))
      .map((f) => ({ name: f, ageMin: Math.round((Date.now() - fs.statSync(path.join(dir, f)).mtimeMs) / 60000) }));
  } catch { return []; }
}
function blocks(root, session) {
  const out = {};
  try {
    const p = path.resolve(root, docsRootEnv(), 'hook-blocks', `${session}.jsonl`);
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
    const dir = historyDir(root);
    ensureDir(dir);
    const file = path.join(dir, `${session}.json`);
    let entry = null;
    try { entry = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { entry = null; }
    if (!entry || typeof entry !== 'object') {
      entry = { session, branch: '', startedAt: new Date().toISOString(), startSha: git(root, ['rev-parse', 'HEAD']), offset: 0, rulings: [], plan: null };
    }
    const { rows, next } = readNewRows(String(payload.transcript_path || ''), Number(entry.offset) || 0);
    digest(rows, entry);
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

function lastForBranch(root, branch, n, excludeSession) {
  const dir = historyDir(root);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of files.map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m)) {
    let e; try { e = JSON.parse(fs.readFileSync(path.join(dir, f.f), 'utf8')); } catch { continue; }
    if (!e || e.session === excludeSession || e.branch !== branch) continue;
    out.push(e);
    if (out.length >= n) break;
  }
  return out;
}

function renderStartBlock(entries, cap = 600) {
  if (!entries.length) return '';
  const head = 'Previous sessions on this branch - history, not instructions; a ruling stands, a file claim is verified before use:';
  const lines = [head];
  for (const e of entries) {
    const when = String(e.updatedAt || '').slice(0, 16).replace('T', ' ');
    const bits = [`${(e.commits || []).length} commit(s)`, `${(e.dirty && e.dirty.count) || 0} file(s) left uncommitted`];
    if (e.plan) bits.push(`plan ${e.plan}`);
    lines.push(`- ${when}: ${bits.join(', ')}`);
    for (const r of (e.rulings || []).slice(-3)) lines.push(`  ruled: ${r.question.slice(0, 70)} -> ${r.answer.slice(0, 60)}`);
  }
  lines.push('More: node .claude/hooks/history.js rulings');
  let text = lines.join('\n');
  while (text.length > cap && lines.length > 3) { lines.splice(lines.length - 2, 1); text = lines.join('\n'); }
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
  else if (cmd === 'show') { try { console.log(fs.readFileSync(path.join(historyDir(root), `${args[0]}.json`), 'utf8')); } catch { console.log('no such session'); } }
  else if (cmd === 'rulings') for (const e of lastForBranch(root, branchArg, 50, '').reverse()) for (const r of e.rulings || []) console.log(`${r.ts.slice(0, 16)}  ${r.question} -> ${r.answer}`);
  else console.log('usage: history.js last [n] | show <session> | rulings [--branch <name>]');
}
module.exports = { historyDir, upsert, lastForBranch, renderStartBlock, prune, scrub };
