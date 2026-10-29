'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const H = require('../stack/hooks/history.js');

// Every folder a case makes is removed after the file: none was, and 1,410 were found in os.tmpdir() on 2026-10-28.
const made = [];
const tmpDir = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(dir); return dir; };
test.after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });
function project() {
  const root = tmpDir('hist-');
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'ignore' });
  git('init', '-q', '-b', 'feature/x'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed'); git('add', '.'); git('commit', '-qm', 'seed');
  return { root, git };
}
const row = (o) => JSON.stringify(o) + '\n';
// the transcript lives OUTSIDE the project, as a real one does - inside it, it would count as a dirty file
const transcriptFile = () => path.join(tmpDir('hist-tr-'), 't.jsonl');
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

test('the folder writes no .gitignore of its own (the data root\'s keeps it out), and credentials never reach the file', () => {
  const { root } = project();
  const tr = transcriptFile();
  fs.writeFileSync(tr, ruling('Token?', 'use ghp_0123456789abcdefghij0123456789abcdef now'));
  H.upsert(root, { session_id: 's3', transcript_path: tr, cwd: root });
  assert.ok(!fs.existsSync(path.join(H.historyDir(root), '.gitignore')), 'the user\'s ruling of 2026-10-13: one .gitignore, the data root\'s');
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

// Audit 2026-10-10 C23, session 0cdb0c1d: the start block named a plan an update had moved a minute earlier, and a
// session that never reached the model (offset 0, nothing recorded) held one of the three slots.
test('the start block skips an empty entry and leaves out a plan no longer on disk', () => {
  const { root } = project();
  const dir = H.historyDir(root); fs.mkdirSync(dir, { recursive: true });
  const put = (s, min, extra = {}) => { const p = path.join(dir, `${s}.json`); fs.writeFileSync(p, JSON.stringify({ session: s, branch: 'feature/x', updatedAt: new Date(Date.now() - min * 60000).toISOString(), offset: 900, commits: [], dirty: { count: 0, files: [] }, rulings: [], plan: null, ...extra })); const t = new Date(Date.now() - min * 60000); fs.utimesSync(p, t, t); };
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'plans', 'kept.md'), '# kept');
  put('rich', 30, { rulings: [{ ts: '', question: 'Order?', answer: 'Migration first' }], plan: 'docs/plans/gone.md' });
  put('kept', 20, { plan: 'docs/plans/kept.md' });
  put('empty', 1, { offset: 0, dirty: { count: 34, files: [] } });
  assert.deepStrictEqual(H.lastForBranch(root, 'feature/x', 3, 'now').map((e) => e.session), ['kept', 'rich'], 'the empty entry holds no slot');
  const block = H.renderStartBlock(H.lastForBranch(root, 'feature/x', 3, 'now'), 600, root);
  assert.match(block, /plan docs\/plans\/kept\.md/);
  assert.doesNotMatch(block, /gone\.md/, 'a moved plan is not named');
  assert.match(block, /ruled: Order\? -> Migration first/, 'the entry itself stays');
  assert.match(H.renderStartBlock(H.lastForBranch(root, 'feature/x', 3, 'now'), 600), /gone\.md/, 'with no root the plan is shown as recorded');
  put('commit-only', 0, { offset: 0, commits: ['abc feat: x'] });
  assert.ok(H.lastForBranch(root, 'feature/x', 3, 'now').some((e) => e.session === 'commit-only'), 'an entry with a commit is not empty');
});

test('garbage in, nothing out: no transcript, no git, a corrupt entry file', () => {
  const root = tmpDir('hist-bad-');
  assert.doesNotThrow(() => H.upsert(root, { session_id: 's4', transcript_path: path.join(root, 'absent.jsonl'), cwd: root }));
  fs.mkdirSync(H.historyDir(root), { recursive: true });
  fs.writeFileSync(path.join(H.historyDir(root), 's5.json'), '{nope');
  assert.doesNotThrow(() => H.upsert(root, { session_id: 's5', transcript_path: path.join(root, 'absent.jsonl'), cwd: root }));
  assert.deepStrictEqual(H.lastForBranch(root, 'main', 3, 'x').filter((e) => e.session === 's5'), []);
});

test('prune keeps the newest N and drops entries past the age limit', () => {
  const dir = tmpDir('hist-prune-');
  for (let i = 0; i < 5; i++) { const p = path.join(dir, `s${i}.json`); fs.writeFileSync(p, '{}'); const t = new Date(Date.now() - i * 86400000); fs.utimesSync(p, t, t); }
  H.prune(dir, 3, 365);
  assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(), ['s0.json', 's1.json', 's2.json']);
  H.prune(dir, 10, 1.5); // s1 is one day old plus the test's own milliseconds - the limit sits between s1 and s2
  assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(), ['s0.json', 's1.json']);
});

// Audit 2026-10-11 SD16, session e90a1845: trimming from the end cut every ruling of the older session (AGENTS.md rows
// kept, a credential deferral) while the newest session's three stayed; the same rows were reviewed and answered again.
test('the start block keeps each session\'s newest ruling before any older one, and shows a question once', () => {
  const at = (min) => new Date(Date.now() - min * 60000).toISOString();
  const r = (q, a) => ({ ts: '', question: q, answer: a });
  const entry = (min, rulings) => ({ session: `s${min}`, branch: 'develop', updatedAt: at(min), commits: [], dirty: { count: 1, files: [] }, rulings });
  const newest = entry(10, [r('Run the reconcile now, or leave the plugin list as it is today?', 'Run the reconcile (Recommended)'),
    r('Install the C# language server plugin at project scope for this repository?', 'Install at project scope'),
    r('The AGENTS.md check reports three drift rows. Review them with the adjust skill?', 'Leave them as they are')]);
  const older = entry(40, [r('Apply the line 31 rewording to AGENTS.md? It is the only change drafted.', 'Apply it'),
    r('The project settings hold two credential keys. How do you want to handle the exposure?', 'Acknowledge and defer (Recommended)')]);
  const block = H.renderStartBlock([newest, older], 600);
  assert.ok(block.length <= 600, `block is ${block.length}`);
  assert.match(block, /Acknowledge and defer/, 'the older session\'s newest ruling survives the trim');
  assert.match(block, /Leave them as they are/, 'and so does the newest session\'s newest');
  assert.match(block, /More: node \.claude\/hooks\/history\.js rulings/, 'the footer stays');
  // a question answered in both sessions is shown once, at its newest answer
  const repeat = entry(70, [r('The AGENTS.md check reports three drift rows. Review them with the adjust skill?', 'Review them')]);
  const both = H.renderStartBlock([newest, repeat], 2000);
  assert.strictEqual((both.match(/AGENTS\.md check reports/g) || []).length, 1);
  assert.match(both, /-> Leave them as they are/);
  assert.doesNotMatch(both, /-> Review them/);
  // under the cap nothing moves; garbage rulings never throw
  assert.match(H.renderStartBlock([entry(5, [r('Order?', 'Migration first')])], 600), /- .*: 0 commit\(s\), 1 file\(s\) left uncommitted\n  ruled: Order\? -> Migration first\nMore:/);
  assert.ok(H.renderStartBlock([entry(5, [null, { question: null, answer: 7 }])], 600).length > 0);
});

// The plan's state in the start block (the user's run order, 2026-10-28): read from the plan at render time - its
// habits-plan-writing cards and its Resume: line - so the next session knows the next task without opening the plan.
const card = (n, status) => `### Task ${n} - slice ${n}\n\n- status: ${status}\n- files: src/a${n}.ts (modify)\n`;
const planText = ({ cards = [], resume = null, completed = false, eol = '\n' } = {}) => ['# Feature - plan', '', 'Asked: "x"',
  resume === null ? null : `Resume: ${resume}`, '', '## Tasks', '', ...cards.map((st, i) => card(i + 1, st)), completed ? 'Completed: 2026-10-28' : null]
  .filter((l) => l !== null).join('\n').split('\n').join(eol);
function planBlock(text, opts = {}) {
  const { root } = project();
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  if (text !== null) fs.writeFileSync(path.join(root, 'docs', 'plans', 'x.md'), text);
  const e = { session: 's1', branch: 'feature/x', updatedAt: new Date().toISOString(), offset: 9, commits: [], dirty: { count: 0, files: [] }, rulings: [], plan: 'docs/plans/x.md' };
  return H.renderStartBlock([e], opts.cap || 600, opts.noRoot ? null : root);
}
const planLine = (block) => (block.split('\n').find((l) => l.startsWith('- ')) || '');
test('the start block shows a plan\'s cards done and its Resume: line', () => {
  const block = planBlock(planText({ cards: ['DONE (`npm test` - 12 pass)', 'DONE (`npm test` - 14 pass)', 'IN_PROGRESS', 'TODO', 'TODO'], resume: 'next task 3 - tests written, code next' }));
  assert.match(planLine(block), /, plan docs\/plans\/x\.md \(2\/5 done; Resume: next task 3 - tests written, code next\)$/, block);
});
test('a plan with its Completed: line reads (completed)', () => {
  const block = planBlock(planText({ cards: ['DONE (ok)', 'DONE (ok)'], resume: 'done', completed: true }));
  assert.match(planLine(block), /, plan docs\/plans\/x\.md \(completed\)$/, block);
});
test('a plan with neither cards nor a Resume: line, an unreadable one and one over 1 MB keep the path alone', () => {
  assert.match(planLine(planBlock('# Another format\n\n1. do a\n2. do b\n')), /, plan docs\/plans\/x\.md$/);
  const big = planText({ cards: ['DONE (ok)'], resume: 'next task 2' });
  assert.match(planLine(planBlock(big + ' '.repeat(1024 * 1024 + 1 - Buffer.byteLength(big)))), /, plan docs\/plans\/x\.md$/, 'one byte over 1 MB');
  assert.match(planLine(planBlock(big + ' '.repeat(1024 * 1024 - Buffer.byteLength(big)))), /\(1\/1 done; Resume: next task 2\)$/, 'at 1 MB it is read');
  assert.match(planLine(planBlock(planText({ cards: ['TODO'], resume: 'next task 1' }), { noRoot: true })), /, plan docs\/plans\/x\.md$/, 'no root: shown as recorded, never read');
  assert.strictEqual(planLine(planBlock(null)).includes('x.md'), false, 'a plan removed since the session is left out');
});
// A side agent's note (2026-10-28): a superpowers plan has '### Task N:' headings and checkbox steps, no status lines -
// counted as cards, a finished one read '(0/N done)'.
test('task headings with no status lines are not counted: a superpowers plan keeps the path alone', () => {
  const sp = ['# X Implementation Plan', '', '### Task 1: Hook', '', '- [x] **Step 1: Write the failing test**', '- [x] **Step 2: Run it**', '',
    '### Task 2: Docs', '', '- [x] **Step 1: Edit**', ''].join('\n');
  assert.match(planLine(planBlock(sp)), /, plan docs\/plans\/x\.md$/, 'no count from cards that carry no status');
  assert.match(planLine(planBlock(`${sp}\nResume: next task 3\n`)), /, plan docs\/plans\/x\.md \(Resume: next task 3\)$/, 'its Resume: line alone still shows');
});
test('the Resume: text is scrubbed, folded and cut at 80 characters', () => {
  assert.match(planBlock(planText({ cards: ['TODO'], resume: 'paste ghp_abcdefghijklmnopqrstuvwxyz0123 into   the\tconfig' })), /\(0\/1 done; Resume: paste \[redacted\] into the config\)$/m);
  const at80 = `Resume: ${'a'.repeat(72)}`;
  assert.ok(planLine(planBlock(planText({ cards: ['TODO'], resume: 'a'.repeat(72) }))).endsWith(`(0/1 done; ${at80})`), 'exactly 80 is kept whole');
  const cut = planLine(planBlock(planText({ cards: ['TODO'], resume: 'b'.repeat(73) })));
  assert.ok(cut.endsWith(`(0/1 done; Resume: ${'b'.repeat(69)}...)`), cut);
  assert.match(planBlock(planText({ resume: 'next task 1' })), /\(Resume: next task 1\)$/m, 'a Resume: line with no cards');
  assert.match(planBlock(planText({ cards: ['DONE (ok)', 'TODO'] })), /\(1\/2 done\)$/m, 'cards with no Resume: line');
});
test('a CRLF plan parses like an LF one', () => {
  const block = planBlock(planText({ cards: ['DONE (ok)', 'TODO'], resume: 'next task 2 - C:\\src\\app.ts open', eol: '\r\n' }));
  assert.match(planLine(block), /\(1\/2 done; Resume: next task 2 - C:\\src\\app\.ts open\)$/, JSON.stringify(block));
});
test('over the cap the older plan states go before their lines, and the newest session keeps its plan state longest', () => {
  const { root } = project();
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  const at = (min) => new Date(Date.now() - min * 60000).toISOString();
  const entries = [0, 1, 2].map((i) => {
    fs.writeFileSync(path.join(root, 'docs', 'plans', `p${i}.md`), planText({ cards: ['DONE (ok)', 'TODO', 'TODO'], resume: `session ${i} ${'r'.repeat(70)}` }));
    return { session: `s${i}`, branch: 'feature/x', updatedAt: at(i * 10), offset: 9, commits: [], dirty: { count: 0, files: [] }, rulings: [{ ts: '', question: `Q${i}?`, answer: `A${i}` }], plan: `docs/plans/p${i}.md` };
  });
  for (const cap of [300, 600, 1650]) {
    const block = H.renderStartBlock(entries, cap, root);
    assert.ok(block.length <= cap, `cap ${cap}: ${block.length}`);
    assert.match(block, /More: node \.claude\/hooks\/history\.js rulings$/, `cap ${cap}: the footer stays whole`);
  }
  const mid = H.renderStartBlock(entries, 600, root);
  assert.match(mid, /plan docs\/plans\/p0\.md \(1\/3 done; Resume: session 0 r+\.\.\.\)/, mid);
  assert.doesNotMatch(mid, /ruled:/, 'rulings leave first');
  assert.doesNotMatch(mid, /p2\.md \(/, 'the oldest plan state leaves before the newest');
  const tight = H.renderStartBlock(entries, 300, root);
  assert.match(tight, /plan docs\/plans\/p0\.md( \(1\/3 done\))?$/m, `the newest line stays, its Resume: text going before its count: ${tight}`);
  assert.match(H.renderStartBlock(entries, 1650, root), /p2\.md \(1\/3 done; Resume: /, 'under the cap every state is shown');
});

test('2.8.0: historyDir is <data root>/state/history, and a session an older hook recorded keeps its legacy record', () => {
  const { root } = project();
  const prior = process.env.ALFRED_CODE_DATA_PATH;
  delete process.env.ALFRED_CODE_DATA_PATH;
  try {
    assert.strictEqual(H.historyDir(root), path.join(root, '.alfred', 'state', 'history'));
    const legacy = path.join(root, '.alfred', 'docs', 'history', 'old.json');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, JSON.stringify({ session: 'old', branch: 'feature/x', startSha: 'abc1234', offset: 0, rulings: [], plan: null }));
    H.upsert(root, { session_id: 'old', transcript_path: '' });
    assert.strictEqual(JSON.parse(fs.readFileSync(legacy, 'utf8')).startSha, 'abc1234', 'the old session updates its own record in place');
    assert.ok(!fs.existsSync(path.join(H.historyDir(root), 'old.json')), 'no second record');
    H.upsert(root, { session_id: 'new', transcript_path: '' });
    assert.ok(fs.existsSync(path.join(H.historyDir(root), 'new.json')), 'a new session writes state/history/');
  } finally { if (prior !== undefined) process.env.ALFRED_CODE_DATA_PATH = prior; }
});

// Per-plan approvals (2026-10-20): a plan's stamp lives in its own folder under state/approvals/ and is listed by its
// place there, beside the root receipts; a folder holding no stamp is no receipt.
test('the open receipts list a plan\'s stamp as <plan id>/APPROVAL', () => {
  const { root } = project();
  const approvals = path.join(root, '.alfred', 'state', 'approvals');
  fs.mkdirSync(path.join(approvals, 'cart'), { recursive: true });
  fs.mkdirSync(path.join(approvals, 'empty'), { recursive: true });
  fs.writeFileSync(path.join(approvals, 'cart', 'APPROVAL'), 'APPROVED cart - "go"\n');
  fs.writeFileSync(path.join(approvals, 'COMMIT-GATE'), 'x\n');
  const tr = transcriptFile();
  fs.writeFileSync(tr, '');
  H.upsert(root, { session_id: 'sp', transcript_path: tr, cwd: root });
  const e = JSON.parse(fs.readFileSync(path.join(H.historyDir(root), 'sp.json'), 'utf8'));
  assert.deepStrictEqual(e.stamps.map((x) => x.name).sort(), ['COMMIT-GATE', 'cart/APPROVAL']);
});

// Item 10 of 2026-10-21: ALFRED_CODE_HISTORY is the count of earlier sessions the start block shows - seeded 3, `0` off,
// 1 to 10, anything above 10 read as 10, anything that is no whole number read as the seed. The cap is a 150-char frame
// plus 150 per session: the seed 3 keeps the 600 it had, and one session still fits beside the ~160-char frame.
test('historyCount reads the session count: 0 off, 1-10, above 10 is 10, garbage is the seed 3', () => {
  for (const [value, want] of [[undefined, 3], ['', 3], ['abc', 3], ['-2', 3], ['2.5', 3], ['0', 0], ['1', 1], [' 4 ', 4], ['3', 3], ['10', 10], ['11', 10], ['999', 10]])
    assert.strictEqual(H.historyCount(value), want, `ALFRED_CODE_HISTORY=${JSON.stringify(value)}`);
  assert.deepStrictEqual([1, 3, 10].map(H.historyCap), [300, 600, 1650]);
});
