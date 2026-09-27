'use strict';
// A commit is the session's own change. Pilot 3 (b4-pilot-3-flow): ~150 files the harness left untracked before the
// session began drove 19 commit-gate denials (13 were 'spec claims N file(s) but the tree has 148 uncommitted'), and
// one close swept them into a commit. docs-session.js records the paths untracked at session start under
// <docs-path>/flow/; guard-ungated-commit.js leaves them out of the receipt's count and the trivial-diff bar, and blocks
// a `git add` that would sweep one in unless the user named it (the UNTRACKED-ALLOW receipt).
const test = require('node:test');
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
    return { dir, git, write, start, bash, head, record, dropRecords, flow, rm: () => fs.rmSync(dir, { recursive: true, force: true }) };
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
        const r = p.bash('s7', 'git commit -am fix');
        assert.strictEqual(r.status, 0, r.stderr);
        p.dropRecords();
        const other = p.bash('s7', 'git commit -am fix');
        assert.strictEqual(other.status, 2, 'without the record the same tree counts 6 files');
        assert.match(other.stderr, /spec: claims 1 file\(s\) but the tree has 6 uncommitted/);
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
