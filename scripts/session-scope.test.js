'use strict';
// A commit is the session's own change. Pilot 3 (b4-pilot-3-flow): ~150 files the harness left untracked before the
// session began drove 19 commit-gate denials (13 were 'spec claims N file(s) but the tree has 148 uncommitted'), and
// one close swept them into a commit. docs-session.js records the paths untracked at session start under
// <docs-path>/flow/; guard-ungated-commit.js leaves them out of the receipt's count and the trivial-diff bar, and blocks
// a `git add` that would sweep one in unless the user named it (the UNTRACKED-ALLOW receipt).
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
delete process.env.CLAUDE_CODE_ENTRYPOINT; // the runner's own entrypoint never decides a hook case
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
for (const k of Object.keys(process.env)) if (k.startsWith('CLAUDE_STACK_') || k.startsWith('ALFRED_CODE_') || k === 'CLAUDE_DOCS_PATH') delete process.env[k]; // legacy-name

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const DOCS = '.alfred/docs';
const forty = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');

function project() {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'session-scope-')));
    const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'test');
    git('config', 'commit.gpgsign', 'false');
    const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
    write('.gitignore', `${DOCS}/\n`);
    write('src/a.cs', 'seed\n');
    git('add', '-A'); git('commit', '-qm', 'seed');
    const env = { ...process.env, CLAUDE_PROJECT_DIR: dir, ALFRED_CODE_DOCS_PATH: DOCS };
    const run = (hook, payload) => spawnSync(process.execPath, [path.join(HOOKS, hook)], { cwd: dir, input: JSON.stringify(payload), encoding: 'utf8', env });
    const start = (s, source = 'startup') => run('docs-session.js', { hook_event_name: 'SessionStart', session_id: s, source, cwd: dir });
    const bash = (s, command) => run('guard-ungated-commit.js', { hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: s, cwd: dir, tool_input: { command } });
    const head = () => git('rev-parse', 'HEAD').stdout.trim();
    const record = () => path.join(dir, DOCS, 'flow', `untracked-at-start-${head()}`);
    const dropRecords = () => { for (const f of fs.existsSync(path.join(dir, DOCS, 'flow')) ? fs.readdirSync(path.join(dir, DOCS, 'flow')) : []) if (f.startsWith('untracked-at-start-')) fs.rmSync(path.join(dir, DOCS, 'flow', f)); };
    const flow = (name, body) => write(path.join(DOCS, 'flow', name), body);
    // the history hook pins the session's start sha at its first SessionStart - the cumulative trivial bar reads it
    const hist = (s, source = 'startup') => run('history-session.js', { hook_event_name: 'SessionStart', session_id: s, source, cwd: dir });
    return { dir, git, write, start, hist, bash, head, record, dropRecords, flow, rm: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('SessionStart records the paths untracked before the session, and names them in one context line', () => {
    const p = project();
    try {
        p.write('harness/one.txt', 'h\n'); p.write('harness/two.txt', 'h\n'); p.write('notes.txt', 'n\n');
        const out = p.start('s1');
        assert.strictEqual(out.status, 0, out.stderr);
        assert.deepStrictEqual(fs.readFileSync(p.record(), 'utf8').split('\n').filter(Boolean).sort(), ['harness/one.txt', 'harness/two.txt', 'notes.txt']);
        const ctx = JSON.parse(out.stdout).hookSpecificOutput.additionalContext;
        assert.match(ctx, /3 paths were untracked when this change started/);
        assert.match(ctx, new RegExp(`\\.alfred/docs/flow/untracked-at-start-${p.head()}`));
    } finally { p.rm(); }
});

test('the record is written once per HEAD: a resume or compact start never adds the session\'s own files', () => {
    const p = project();
    try {
        p.start('s2');
        assert.strictEqual(fs.readFileSync(p.record(), 'utf8'), '', 'a clean start still writes the (empty) record');
        p.write('src/mine.cs', 'mine\n');
        const again = p.start('s2', 'compact');
        assert.strictEqual(fs.readFileSync(p.record(), 'utf8'), '', 'the session\'s own new file is not pre-existing');
        assert.doesNotMatch(again.stdout, /untracked when this change started/, 'nothing pre-existing, no line');
    } finally { p.rm(); }
});

test('outside a git repo SessionStart records nothing and stays quiet', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-scope-nogit-'));
    try {
        const r = spawnSync(process.execPath, [path.join(HOOKS, 'docs-session.js')], { cwd: dir, input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's3' }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ALFRED_CODE_DOCS_PATH: DOCS } });
        assert.strictEqual(r.status, 0, r.stderr);
        assert.strictEqual(r.stdout, '');
        assert.strictEqual(fs.existsSync(path.join(dir, DOCS, 'flow')), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a git add that would sweep in a pre-existing untracked path is blocked, naming it and the ALLOW route', () => {
    const p = project();
    try {
        p.write('harness/one.txt', 'h\n'); p.write('harness/two.txt', 'h\n');
        p.start('s4');
        p.write('src/new.cs', forty);
        for (const cmd of ['git add -A', 'git add .', 'git add --all', 'git add harness/', 'git add -A && git commit -m x', 'cd src && git add :/']) {
            const r = p.bash('s4', cmd);
            assert.strictEqual(r.status, 2, `${cmd}: ${r.stderr}`);
            assert.match(r.stderr, /untracked before this change started/, cmd);
            assert.match(r.stderr, /harness\/one\.txt/, cmd);
            assert.match(r.stderr, /UNTRACKED-ALLOW/, cmd);
        }
    } finally { p.rm(); }
});

test('the session\'s own paths, a named path, a survey and a dry run all pass', () => {
    const p = project();
    try {
        p.write('harness/one.txt', 'h\n');
        p.start('s5');
        p.write('src/new.cs', forty);
        for (const cmd of ['git add src/new.cs', 'git add src/', 'git add harness/one.txt', 'git add -n -A', 'git add -N . && git diff HEAD --stat; git reset -q', 'git add -u']) {
            const r = p.bash('s5', cmd);
            assert.strictEqual(r.status, 0, `${cmd}: ${r.stderr}`);
        }
        p.dropRecords();
        const none = p.bash('s5', 'git add -A');
        assert.strictEqual(none.status, 0, 'no record at all: nothing is judged pre-existing');
    } finally { p.rm(); }
});

// macOS: os.tmpdir() is /var/..., a symlink to /private/var/... - git answers in the real spelling, the session may not.
test('a named pre-existing path passes when the project dir is spelled through a symlink', { skip: process.platform === 'win32' && 'no symlinked tmpdir' }, () => {
    const p = project();
    const link = `${p.dir}-link`;
    try {
        fs.symlinkSync(p.dir, link);
        p.write('harness/one.txt', 'h\n');
        const env = { ...process.env, CLAUDE_PROJECT_DIR: link, ALFRED_CODE_DOCS_PATH: DOCS };
        const hook = (file, payload) => spawnSync(process.execPath, [path.join(HOOKS, file)], { cwd: link, input: JSON.stringify(payload), encoding: 'utf8', env });
        hook('docs-session.js', { hook_event_name: 'SessionStart', session_id: 's8', cwd: link });
        const named = hook('guard-ungated-commit.js', { hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: 's8', cwd: link, tool_input: { command: 'git add harness/one.txt' } });
        assert.strictEqual(named.status, 0, named.stderr);
        const sweep = hook('guard-ungated-commit.js', { hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: 's8', cwd: link, tool_input: { command: 'git add -A' } });
        assert.strictEqual(sweep.status, 2, 'the sweep is still judged through the link');
    } finally { try { fs.unlinkSync(link); } catch { /* never linked */ } p.rm(); }
});

test('UNTRACKED-ALLOW opens the sweep for the paths the user named, and only those', () => {
    const p = project();
    try {
        p.write('harness/one.txt', 'h\n'); p.write('harness/two.txt', 'h\n');
        p.start('s6');
        p.flow('UNTRACKED-ALLOW', 'harness/one.txt\n');
        const partial = p.bash('s6', 'git add -A');
        assert.strictEqual(partial.status, 2);
        assert.match(partial.stderr, /harness\/two\.txt/);
        assert.doesNotMatch(partial.stderr, /  harness\/one\.txt/, 'the named path is no longer listed');
        p.flow('UNTRACKED-ALLOW', 'harness/\n');
        assert.strictEqual(p.bash('s6', 'git add -A').status, 0, 'a directory line covers what is under it');
        p.flow('UNTRACKED-ALLOW', '*\n');
        assert.strictEqual(p.bash('s6', 'git add .').status, 0);
    } finally { p.rm(); }
});

test('the receipt\'s spec count and the trivial-diff bar leave the pre-existing untracked paths out', () => {
    const p = project();
    try {
        for (let i = 0; i < 5; i++) p.write(`harness/h${i}.txt`, 'h\n');
        p.start('s7');
        p.write('src/a.cs', forty);
        const head = p.git('rev-parse', 'HEAD').stdout.trim();
        p.flow('COMMIT-GATE', ['VERIFIED the rounding fix', 'authorized: "commit it"', `head: ${head}`, 'spec: 1 file - src/a.cs', 'live-probe: NOT RUN - test'].join('\n') + '\n');
        // 2.1.6 H2: the count is what the commit takes in, so the sweep that takes the harness files in is the case -
        // the user allowed it, and they still are not the change
        p.flow('UNTRACKED-ALLOW', '*\n');
        const r = p.bash('s7', 'git add -A && git commit -m fix');
        assert.strictEqual(r.status, 0, r.stderr);
        p.dropRecords();
        const other = p.bash('s7', 'git add -A && git commit -m fix');
        assert.strictEqual(other.status, 2, 'without the record the same sweep counts 6 files');
        assert.match(other.stderr, /spec: claims 1 file\(s\) but this commit takes in 6/);
        fs.rmSync(path.join(p.dir, DOCS, 'flow', 'UNTRACKED-ALLOW'));
        p.start('s7');
        fs.rmSync(path.join(p.dir, DOCS, 'flow', 'COMMIT-GATE'));
        p.git('checkout', '--', 'src/a.cs');
        p.write('src/a.cs', 'seed\nfixed\n');
        assert.strictEqual(p.bash('s7', 'git commit -am typo').status, 0, 'a one-line fix is trivial beside the harness files');
    } finally { p.rm(); }
});

// Review I3: keyed by session, a fresh-session hand-off or /clear read the earlier session's new files as
// pre-existing. Keyed by HEAD, every session before the next commit shares the first one's snapshot.
test('I3: two sessions on one HEAD - the first session\'s new file is the second\'s change, not pre-existing', () => {
    const p = project();
    try {
        p.write('harness/one.txt', 'h\n');
        p.start('first');
        p.write('src/mine.cs', forty);
        const hand = p.start('second');
        assert.match(hand.stdout, /1 path was untracked/, 'the second session reuses the first snapshot');
        assert.strictEqual(p.bash('second', 'git add src/').status, 0, 'the earlier session\'s file is committable without naming it');
        const sweep = p.bash('second', 'git add -A');
        assert.strictEqual(sweep.status, 2);
        assert.match(sweep.stderr, /  harness\/one\.txt/);
        assert.doesNotMatch(sweep.stderr, /src\/mine\.cs/);
        const before = p.head();
        p.git('add', 'src/mine.cs'); p.git('commit', '-qm', 'mine');
        assert.strictEqual(p.bash('second', 'git add -A').status, 2, 'a commit mid-session keeps the last snapshot in force');
        p.write('scratch.txt', 's\n');
        p.start('third');
        assert.notStrictEqual(p.head(), before);
        assert.deepStrictEqual(fs.readFileSync(p.record(), 'utf8').split('\n').filter(Boolean).sort(), ['harness/one.txt', 'scratch.txt'], 'a moved HEAD takes a fresh snapshot');
    } finally { p.rm(); }
});

// Review I4: the cap and the sweep, at their boundaries.
test('I4: the record holds at most 20000 paths - one under, at and one over', () => {
    const p = project();
    try {
        const bulk = path.join(p.dir, 'bulk');
        fs.mkdirSync(bulk);
        for (let i = 0; i < 19999; i++) fs.writeFileSync(path.join(bulk, `f${i}`), '');
        for (const [n, want] of [[19999, 19999], [20000, 20000], [20001, 20000]]) {
            if (n > 19999) fs.writeFileSync(path.join(bulk, `g${n}`), '');
            p.dropRecords();
            p.start(`cap${n}`);
            assert.strictEqual(fs.readFileSync(p.record(), 'utf8').split('\n').filter(Boolean).length, want, `${n} untracked`);
        }
    } finally { p.rm(); }
});

test('I4: a new record sweeps records past 7 days, keeps younger ones and every other flow file', () => {
    const p = project();
    try {
        const day = 24 * 3600;
        const now = Date.now() / 1000;
        const aged = (name, secs) => { p.flow(name, 'x\n'); const f = path.join(p.dir, DOCS, 'flow', name); fs.utimesSync(f, now - secs, now - secs); return f; };
        const over = aged('untracked-at-start-over', 7 * day + 60);
        const under = aged('untracked-at-start-under', 7 * day - 60);
        const other = aged('COMMIT-GATE', 30 * day);
        p.start('sweep');
        assert.strictEqual(fs.existsSync(over), false, 'one over 7 days goes');
        assert.strictEqual(fs.existsSync(under), true, 'one under 7 days stays');
        assert.strictEqual(fs.existsSync(other), true, 'a file of another kind is never swept');
        assert.strictEqual(fs.existsSync(p.record()), true);
    } finally { p.rm(); }
});

test('the checkpoint skill scopes the commit to the session\'s own change', () => {
    const text = fs.readFileSync(path.join(__dirname, '..', 'stack', 'skills', 'alfred-habits-commit-checkpoint', 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');
    assert.match(text, /untracked-at-start-/);
    assert.match(text, /stage the session's own paths by name/i);
    assert.match(text, /outside the change/i);
    assert.match(text, /UNTRACKED-ALLOW/);
});

// 2.1.6 review M2 / T18: the trivial bar is cumulative per SESSION - this commit's own set plus what the commits since the
// session's start took in (history-session.js pins that sha in <docs-path>/history/<session>.json at the first
// SessionStart and keeps it across a resume or compaction of the same session). One small commit stays exempt; a
// series of them cannot walk under the bar. A new session is a new change: its start sha is its own HEAD.
const ten = (tag) => Array.from({ length: 10 }, (_, i) => `${tag} ${i}`).join('\n') + '\n';
test('T18: a staged one-liner beside unrelated dirty work is trivial - the bar reads the session, not the tree', () => {
    const p = project();
    try {
        p.hist('t18');
        p.write('src/a.cs', 'seed\nfix\n'); p.git('add', 'src/a.cs');
        p.write('src/other.cs', forty); // unrelated work, not in this commit
        assert.strictEqual(p.bash('t18', 'git commit -m typo').status, 0, 'one file, one line this session');
        assert.strictEqual(p.bash('', 'git commit -m typo').status, 2, 'no session at all: the bar is the whole tree, as before');
    } finally { p.rm(); }
});
test('M2: a change split into small commits blocks from the commit that crosses the bar', () => {
    const p = project();
    try {
        p.hist('split');
        for (let n = 1; n <= 6; n++) p.write(`src/feat${n}.cs`, ten(`f${n}`));
        assert.strictEqual(p.bash('split', 'git add src/feat1.cs && git commit -m "feat: part 1"').status, 0, 'the first 10-line slice is trivial');
        p.git('add', 'src/feat1.cs'); p.git('commit', '-qm', 'feat: part 1');
        const second = p.bash('split', 'git add src/feat2.cs && git commit -m "feat: part 2"');
        assert.strictEqual(second.status, 2, 'the second slice crosses the bar: 2 files, 20 lines since the session began');
        assert.match(second.stderr, /pre-commit gate receipt/);
        p.hist('split', 'compact');
        assert.strictEqual(p.bash('split', 'git add src/feat2.cs && git commit -m "feat: part 2"').status, 2, 'a compaction keeps the session start');
        p.hist('split', 'resume');
        assert.strictEqual(p.bash('split', 'git add src/feat2.cs && git commit -m "feat: part 2"').status, 2, 'and so does a resume');
        // across sessions: a NEW session pins its own start at today's HEAD, so its first small commit is exempt again
        p.hist('next');
        assert.strictEqual(p.bash('next', 'git add src/feat2.cs && git commit -m "feat: part 2"').status, 0, 'a new session begins a new change');
    } finally { p.rm(); }
});
test('the cumulative bar ignores a start the branch no longer holds, and a commit that takes nothing in', () => {
    const p = project();
    try {
        p.hist('moved');
        const start = p.head();
        p.write('src/feat1.cs', ten('f1')); p.git('add', 'src/feat1.cs'); p.git('commit', '-qm', 'one');
        p.git('reset', '-q', '--hard', start); p.git('commit', '-q', '--allow-empty', '-m', 'unrelated');
        p.git('checkout', '-q', '--orphan', 'other'); p.git('commit', '-q', '--allow-empty', '-m', 'orphan');
        p.write('src/a.cs', 'seed\nfix\n'); p.git('add', 'src/a.cs'); p.write('src/big.cs', forty);
        assert.strictEqual(p.bash('moved', 'git commit -m typo').status, 2, 'the start is not an ancestor of HEAD: the whole tree, as before');
    } finally { p.rm(); }
    const q = project();
    try {
        q.hist('empty');
        q.write('src/big.cs', forty);
        assert.strictEqual(q.bash('empty', 'git commit -m x').status, 0, 'nothing staged: nothing to commit, let git say so');
    } finally { q.rm(); }
});

// 2.1.6 review re-verify N1: the per-session bar summed every commit since the session's start - one a receipt had
// already reviewed, and ones a pull brought in - so a typo after a reviewed feature, or a one-liner after a pull,
// needed a full receipt. The bar now sums only the commits the guard itself let through as trivial this session (its
// ledger, <docs-path>/flow/trivial-<session>), plus this commit.
const receiptFor = (p, files) => p.flow('COMMIT-GATE', ['VERIFIED the feature', 'authorized: "commit it"', `head: ${p.head()}`, `spec: ${files} files`, 'live-probe: NOT RUN - fixture'].join('\n') + '\n');
test('N1: a typo after a reviewed feature is trivial - a receipt-covered commit adds nothing to the bar', () => {
    const p = project();
    try {
        p.hist('rv');
        p.write('src/feat.cs', forty); p.write('src/feat2.cs', forty);
        receiptFor(p, 2);
        assert.strictEqual(p.bash('rv', 'git add src/feat.cs src/feat2.cs && git commit -m "feat: x"').status, 0, 'the feature, through its receipt');
        p.git('add', 'src/feat.cs', 'src/feat2.cs'); p.git('commit', '-qm', 'feat: x');
        fs.rmSync(path.join(p.dir, DOCS, 'flow', 'COMMIT-GATE'));
        p.write('src/a.cs', 'seed\nfix\n'); p.git('add', 'src/a.cs');
        assert.strictEqual(p.bash('rv', 'git commit -m typo').status, 0, 'the typo after it passes ungated');
    } finally { p.rm(); }
});
test('N1: a one-liner after a pull is trivial - commits from elsewhere add nothing to the bar', () => {
    const p = project();
    try {
        p.hist('pl');
        for (let n = 1; n <= 3; n++) { p.write(`src/up${n}.cs`, forty.split('\n').slice(0, 20).join('\n')); p.git('add', '-A'); p.git('commit', '-qm', `upstream ${n}`); }
        p.write('src/a.cs', 'seed\nfix\n'); p.git('add', 'src/a.cs');
        assert.strictEqual(p.bash('pl', 'git commit -m typo').status, 0, 'three 20-line commits that arrived by a pull do not count');
    } finally { p.rm(); }
});
test('N1: a trivial commit the guard let through but git never made is not counted twice', () => {
    const p = project();
    try {
        p.hist('retry');
        p.write('src/feat1.cs', ten('f1'));
        assert.strictEqual(p.bash('retry', 'git add src/feat1.cs && git commit -m one').status, 0);
        assert.strictEqual(p.bash('retry', 'git add src/feat1.cs && git commit -m one').status, 0, 'a retry of the same commit on the same HEAD');
        assert.match(fs.readFileSync(path.join(p.dir, DOCS, 'flow', 'trivial-retry'), 'utf8'), /src\/feat1\.cs/, 'the ledger names what walked under the bar');
    } finally { p.rm(); }
});

// 2.1.6 re-verify 2 R2-M4: the ledger kept a row while the HEAD it was made on stayed an ancestor, so rewritten history
// left the bar - an amend loop built a 43-line commit 14 lines at a time, a rebase dropped every row after the first -
// and it wrote a row per trivial PASS, so failed attempts counted twice and a receipt-covered commit counted at all.
const lines = (n, tag) => Array.from({ length: n }, (_, i) => `${tag} ${i}`).join('\n') + '\n';
const branchOf = (p) => p.git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
test('R2-M4: an amend is judged as the whole commit it leaves, so an amend loop crosses the bar', () => {
    const p = project();
    try {
        p.hist('am');
        let body = 'seed\nfix\n';
        p.write('src/a.cs', body); p.git('add', 'src/a.cs');
        assert.strictEqual(p.bash('am', 'git commit -m one').status, 0, 'a 1-line commit');
        p.git('commit', '-qm', 'one');
        body += lines(14, 'a1'); p.write('src/a.cs', body); p.git('add', 'src/a.cs');
        assert.strictEqual(p.bash('am', 'git commit --amend --no-edit').status, 0, 'the first amend leaves a 15-line commit');
        p.git('commit', '-q', '--amend', '--no-edit');
        body += lines(14, 'a2'); p.write('src/a.cs', body); p.git('add', 'src/a.cs');
        assert.strictEqual(p.bash('am', 'git commit --amend --no-edit').status, 2, 'the second amend leaves a 29-line commit');
    } finally { p.rm(); }
});
test('R2-M4: a rebase keeps the rows of the commits it rewrote', () => {
    const p = project();
    try {
        p.hist('rb');
        const start = p.head();
        const main = branchOf(p);
        p.write('src/f1.cs', lines(8, 'f1'));
        assert.strictEqual(p.bash('rb', 'git add src/f1.cs && git commit -m one').status, 0);
        p.git('add', 'src/f1.cs'); p.git('commit', '-qm', 'one');
        p.write('src/f2.cs', lines(6, 'f2'));
        assert.strictEqual(p.bash('rb', 'git add src/f2.cs && git commit -m two').status, 0, '14 lines in two files');
        p.git('add', 'src/f2.cs'); p.git('commit', '-qm', 'two');
        p.git('checkout', '-q', '-b', 'up', start); p.write('src/u.cs', 'u\n'); p.git('add', 'src/u.cs'); p.git('commit', '-qm', 'upstream');
        p.git('checkout', '-q', main); p.git('rebase', '-q', 'up');
        p.write('src/f1.cs', lines(8, 'f1') + lines(3, 'more')); p.git('add', 'src/f1.cs');
        assert.strictEqual(p.bash('rb', 'git commit -m three').status, 2, 'the rebased 14 lines plus 3 cross the bar');
    } finally { p.rm(); }
});
test('R2-M4: failed attempts are one row, and a receipt-covered commit writes none', () => {
    const p = project();
    try {
        p.hist('fa');
        p.write('src/h.cs', lines(8, 'h'));
        assert.strictEqual(p.bash('fa', 'false && git add src/h.cs && git commit -m h').status, 0, 'attempt one (never ran)');
        assert.strictEqual(p.bash('fa', 'false && git add src/h.cs && git commit -m h').status, 0, 'attempt two (never ran)');
        assert.strictEqual(p.bash('fa', 'git add src/h.cs && git commit -m h').status, 0, 'the commit that lands');
        p.git('add', 'src/h.cs'); p.git('commit', '-qm', 'h');
        p.write('src/a.cs', 'seed\nfix\n'); p.git('add', 'src/a.cs');
        assert.strictEqual(p.bash('fa', 'git commit -m typo').status, 0, '8 lines once, plus the typo');
    } finally { p.rm(); }
    const q = project();
    try {
        q.hist('rc');
        q.write('src/f.cs', lines(5, 'f'));
        receiptFor(q, 1);
        assert.strictEqual(q.bash('rc', 'git add src/f.cs && git commit -m f').status, 0, 'a small commit under a live receipt');
        q.git('add', 'src/f.cs'); q.git('commit', '-qm', 'f');
        fs.rmSync(path.join(q.dir, DOCS, 'flow', 'COMMIT-GATE'));
        assert.strictEqual(fs.existsSync(path.join(q.dir, DOCS, 'flow', 'trivial-rc')), false, 'the covered commit wrote no row');
        q.write('src/g.cs', lines(11, 'g')); q.git('add', 'src/g.cs');
        assert.strictEqual(q.bash('rc', 'git commit -m g').status, 0, 'the next 11 lines are the only ungated ones');
    } finally { q.rm(); }
});
test('R2-M4: a branch switch drops what it took away, and one-line commits add up to the bar', () => {
    const p = project();
    try {
        p.hist('sb');
        const main = branchOf(p);
        p.write('src/m.cs', lines(14, 'm'));
        assert.strictEqual(p.bash('sb', 'git add src/m.cs && git commit -m m').status, 0);
        p.git('add', 'src/m.cs'); p.git('commit', '-qm', 'm');
        p.git('checkout', '-q', '-b', 'side');
        p.write('src/s.cs', lines(2, 's'));
        assert.strictEqual(p.bash('sb', 'git add src/s.cs && git commit -m s').status, 2, 'side: 14 + 2 lines');
        p.git('add', 'src/s.cs'); p.git('commit', '-qm', 's');
        p.git('checkout', '-q', main);
        p.write('src/n.cs', lines(2, 'n')); p.git('add', 'src/n.cs');
        assert.strictEqual(p.bash('sb', 'git commit -m n').status, 2, 'back on main: 14 + 2 lines');
    } finally { p.rm(); }
    const q = project();
    try {
        q.hist('one');
        let body = 'seed\n';
        const got = [];
        for (let n = 1; n <= 16; n++) {
            body += `line ${n}\n`; q.write('src/a.cs', body); q.git('add', 'src/a.cs');
            got.push(q.bash('one', `git commit -m c${n}`).status);
            q.git('commit', '-qm', `c${n}`);
        }
        assert.deepStrictEqual(got, [...Array(15).fill(0), 2], '15 one-line commits pass, the 16th crosses the bar');
    } finally { q.rm(); }
});
test('R2-M4: a start the session rewrote - amended, or rebased - is read from where it meets HEAD', () => {
    const p = project();
    try {
        let body = lines(40, 'reviewed');
        p.write('src/big.cs', body); p.git('add', 'src/big.cs'); p.git('commit', '-qm', 'an earlier, reviewed commit');
        p.hist('ps'); // the session starts on it
        body += lines(14, 'a1'); p.write('src/big.cs', body); p.git('add', 'src/big.cs');
        assert.strictEqual(p.bash('ps', 'git commit --amend --no-edit').status, 0, 'the earlier 40 lines are not this session\'s: 14 lines');
        p.git('commit', '-q', '--amend', '--no-edit');
        body += lines(14, 'a2'); p.write('src/big.cs', body); p.git('add', 'src/big.cs');
        assert.strictEqual(p.bash('ps', 'git commit --amend --no-edit').status, 2, 'the start left the branch with the first amend: 14 + 14');
    } finally { p.rm(); }
    const q = project();
    try {
        const main = branchOf(q);
        q.git('checkout', '-q', '-b', 'feat');
        q.write('src/pre.cs', lines(5, 'pre')); q.git('add', 'src/pre.cs'); q.git('commit', '-qm', 'before the session');
        q.hist('rs');
        q.write('src/f1.cs', lines(8, 'f1'));
        assert.strictEqual(q.bash('rs', 'git add src/f1.cs && git commit -m one').status, 0);
        q.git('add', 'src/f1.cs'); q.git('commit', '-qm', 'one');
        q.write('src/f2.cs', lines(6, 'f2'));
        assert.strictEqual(q.bash('rs', 'git add src/f2.cs && git commit -m two').status, 0);
        q.git('add', 'src/f2.cs'); q.git('commit', '-qm', 'two');
        q.git('checkout', '-q', main); q.write('src/u.cs', 'u\n'); q.git('add', 'src/u.cs'); q.git('commit', '-qm', 'upstream');
        q.git('checkout', '-q', 'feat'); q.git('rebase', '-q', main);
        q.write('src/f1.cs', lines(8, 'f1') + lines(3, 'more')); q.git('add', 'src/f1.cs');
        assert.strictEqual(q.bash('rs', 'git commit -m three').status, 2, 'the rebase rewrote the start too: 8 + 6 + 3');
    } finally { q.rm(); }
});

// 2.1.6 re-verify 3 R3-m8: a squash done in two calls - `git reset --soft <start>` as its own call, then one commit of
// the same lines - left the two small commits' rows beside the squash's own, so each line counted twice and a 1-line
// typo after a 12-line change blocked. A file counts at most its net change since the session's start.
test('R3-m8: a squash done in two calls counts each file once - the net change since the start caps its rows', () => {
    const p = project();
    try {
        p.hist('sq');
        const start = p.head();
        p.write('src/a1.cs', lines(6, 'a'));
        assert.strictEqual(p.bash('sq', 'git add src/a1.cs && git commit -m one').status, 0);
        p.git('add', 'src/a1.cs'); p.git('commit', '-qm', 'one');
        p.write('src/b1.cs', lines(6, 'b'));
        assert.strictEqual(p.bash('sq', 'git add src/b1.cs && git commit -m two').status, 0);
        p.git('add', 'src/b1.cs'); p.git('commit', '-qm', 'two');
        p.git('reset', '-q', '--soft', start);
        assert.strictEqual(p.bash('sq', 'git commit -m both').status, 0, 'the same 12 lines recommitted as one');
        p.git('commit', '-qm', 'both');
        p.write('src/a1.cs', lines(5, 'a') + 'fixed\n'); p.git('add', 'src/a1.cs');
        assert.strictEqual(p.bash('sq', 'git commit -m typo').status, 0, 'L12: 12 lines plus a 1-line typo is 14, under the bar');
    } finally { p.rm(); }
});
// R3-m9: with no history record (the history hook off) the bar fell back to the whole tree - a staged one-liner beside
// unrelated work blocked, and a change split into slices walked under the bar. The ledger pins its own start then:
// HEAD at the session's first judged commit, written to the ledger file.
test('R3-m9: with no history record the ledger pins its own start', () => {
    const p = project();
    try {
        p.write('src/a.cs', 'seed\nfix\n'); p.git('add', 'src/a.cs');
        p.write('src/other.cs', forty);
        assert.strictEqual(p.bash('nohist', 'git commit -m typo').status, 0, 'L13a: a staged one-liner beside unrelated work');
        p.git('commit', '-qm', 'typo');
        p.write('src/s1.cs', ten('s1')); p.write('src/s2.cs', ten('s2'));
        assert.strictEqual(p.bash('nohist', 'git add src/s1.cs && git commit -m s1').status, 0, 'the first 10-line slice');
        p.git('add', 'src/s1.cs'); p.git('commit', '-qm', 's1');
        assert.strictEqual(p.bash('nohist', 'git add src/s2.cs && git commit -m s2').status, 2, 'L13c: the second slice crosses the bar');
        assert.strictEqual(p.bash('', 'git add src/s2.cs && git commit -m s2').status, 2, 'a payload with no session: the whole tree, as before');
    } finally { p.rm(); }
});
