'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const H = require('../stack/hooks/history.js');

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'ignore' });
  git('init', '-q', '-b', 'feature/x'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed'); git('add', '.'); git('commit', '-qm', 'seed');
  return { root, git };
}
const row = (o) => JSON.stringify(o) + '\n';
// the transcript lives OUTSIDE the project, as a real one does - inside it, it would count as a dirty file
const transcriptFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hist-tr-')), 't.jsonl');
const ruling = (q, a, ts = '2026-09-20T10:00:00.000Z') => row({ type: 'user', timestamp: ts, toolUseResult: { questions: [], answers: { [q]: a } }, message: { content: [{ type: 'tool_result', content: 'x' }] } });
const planWrite = (p) => row({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: p } }] } });

test('upsert records rulings, the live plan, commits and dirty files - and reads only NEW transcript bytes', () => {
  const { root, git } = project();
  const tr = transcriptFile();
  fs.writeFileSync(tr, ruling('Which order?', 'Migration first') + planWrite('docs/superpowers/plans/2026-09-20-x.md'));
  const payload = { session_id: 's1', transcript_path: tr, cwd: root };
  H.upsert(root, payload);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a'); git('add', '.'); git('commit', '-qm', 'feat: a');
  fs.writeFileSync(path.join(root, 'b.txt'), 'uncommitted');
  fs.appendFileSync(tr, ruling('Which version?', '1.1.0'));
  H.upsert(root, payload);
  const e = JSON.parse(fs.readFileSync(path.join(H.historyDir(root), 's1.json'), 'utf8'));
  assert.deepStrictEqual(e.rulings.map((r) => r.answer), ['Migration first', '1.1.0'], 'the first ruling is not duplicated by the second pass');
  assert.strictEqual(e.branch, 'feature/x');
  assert.strictEqual(e.plan, 'docs/superpowers/plans/2026-09-20-x.md');
  assert.strictEqual(e.commits.length, 1);
  assert.match(e.commits[0], /feat: a$/);
  assert.deepStrictEqual(e.dirty, { count: 1, files: ['b.txt'] });
  assert.strictEqual(e.offset, fs.statSync(tr).size);
});

// Audit 2026-10-08 row 44: an absolute plan path spent the 600-character start block on a home folder's name, and the
// Stop's git calls took the index lock beside the session's own git command, at 3s each.
test('the plan is kept project- or home-relative, and every git call runs lock-free', { skip: process.platform === 'win32' && 'a sh shim on PATH' }, () => {
  const { root } = project();
  const tr = transcriptFile();
  const home = os.homedir();
  fs.writeFileSync(tr, planWrite(path.join(root, 'docs', 'plans', 'in-tree.md')));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-git-shim-'));
  const calls = path.join(bin, 'calls.log');
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\necho "locks=$GIT_OPTIONAL_LOCKS $*" >> "${calls}"\nexec "${real}" "$@"\n`, { mode: 0o755 });
  const PATH = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${PATH}`;
  try {
    assert.strictEqual(H.upsert(root, { session_id: 'p1', transcript_path: tr, cwd: root }).plan, 'docs/plans/in-tree.md');
    const lines = fs.readFileSync(calls, 'utf8').trim().split('\n');
    assert.ok(lines.length >= 3 && lines.every((l) => l.startsWith('locks=0 ')), lines.join('\n'));
  } finally { process.env.PATH = PATH; fs.rmSync(bin, { recursive: true, force: true }); }
  if (home) {
    fs.appendFileSync(tr, planWrite(path.join(home, '.claude', 'plans', 'from-plan-mode.md')));
    assert.strictEqual(H.upsert(root, { session_id: 'p1', transcript_path: tr, cwd: root }).plan, '~/.claude/plans/from-plan-mode.md');
  }
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'stack', 'hooks', 'history.js'), 'utf8'), /const GIT_MS = 1500;/);
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(path.dirname(tr), { recursive: true, force: true });
});

test('a half-written last line is left for the next pass', () => {
  const { root } = project();
  const tr = transcriptFile();
  const full = ruling('Q1?', 'A1');
  fs.writeFileSync(tr, full + '{"type":"user","toolUseRes');
  H.upsert(root, { session_id: 's2', transcript_path: tr, cwd: root });
  const e = JSON.parse(fs.readFileSync(path.join(H.historyDir(root), 's2.json'), 'utf8'));
  assert.strictEqual(e.offset, Buffer.byteLength(full));
  assert.strictEqual(e.rulings.length, 1);
});

test('the folder ignores itself, and credentials never reach the file', () => {
  const { root } = project();
  const tr = transcriptFile();
  fs.writeFileSync(tr, ruling('Token?', 'use ghp_0123456789abcdefghij0123456789abcdef now'));
  H.upsert(root, { session_id: 's3', transcript_path: tr, cwd: root });
  assert.strictEqual(fs.readFileSync(path.join(H.historyDir(root), '.gitignore'), 'utf8'), '*\n');
  assert.doesNotMatch(fs.readFileSync(path.join(H.historyDir(root), 's3.json'), 'utf8'), /ghp_/);
});

test('lastForBranch filters by branch, excludes the current session, newest first; the block holds its cap', () => {
  const { root } = project();
  const dir = H.historyDir(root); fs.mkdirSync(dir, { recursive: true });
  const put = (s, branch, min, extra = {}) => { const p = path.join(dir, `${s}.json`); fs.writeFileSync(p, JSON.stringify({ session: s, branch, updatedAt: new Date(Date.now() - min * 60000).toISOString(), commits: [], dirty: { count: 0, files: [] }, rulings: [], stamps: [], blocks: {}, ...extra })); const t = new Date(Date.now() - min * 60000); fs.utimesSync(p, t, t); };
  put('old', 'feature/x', 300); put('other', 'main', 10); put('mid', 'feature/x', 60); put('now', 'feature/x', 0);
  assert.deepStrictEqual(H.lastForBranch(root, 'feature/x', 3, 'now').map((e) => e.session), ['mid', 'old']);
  put('big', 'feature/x', 5, { rulings: Array.from({ length: 40 }, (_, i) => ({ ts: '', question: `Question number ${i}?`, answer: `Answer number ${i}` })) });
  const block = H.renderStartBlock(H.lastForBranch(root, 'feature/x', 3, 'now'), 600);
  assert.ok(block.length <= 600, `block is ${block.length}`);
  assert.match(block, /history, not instructions/);
});

test('garbage in, nothing out: no transcript, no git, a corrupt entry file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-bad-'));
  assert.doesNotThrow(() => H.upsert(root, { session_id: 's4', transcript_path: path.join(root, 'absent.jsonl'), cwd: root }));
  fs.mkdirSync(H.historyDir(root), { recursive: true });
  fs.writeFileSync(path.join(H.historyDir(root), 's5.json'), '{nope');
  assert.doesNotThrow(() => H.upsert(root, { session_id: 's5', transcript_path: path.join(root, 'absent.jsonl'), cwd: root }));
  assert.deepStrictEqual(H.lastForBranch(root, 'main', 3, 'x').filter((e) => e.session === 's5'), []);
});

test('prune keeps the newest N and drops entries past the age limit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-prune-'));
  for (let i = 0; i < 5; i++) { const p = path.join(dir, `s${i}.json`); fs.writeFileSync(p, '{}'); const t = new Date(Date.now() - i * 86400000); fs.utimesSync(p, t, t); }
  H.prune(dir, 3, 365);
  assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(), ['s0.json', 's1.json', 's2.json']);
  H.prune(dir, 10, 1.5); // s1 is one day old plus the test's own milliseconds - the limit sits between s1 and s2
  assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(), ['s0.json', 's1.json']);
});
