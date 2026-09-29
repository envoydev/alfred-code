'use strict';
// The fixture every benchmark cell clones is pinned twice: by its tag and by the commit id the lock
// records. A clone that resolves elsewhere, or a history that ever carried a stack file, would hand
// one arm a head start - verify refuses both before any cell runs.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseLock, renderLock, stackPathsIn, verify } = require('./verify.js');

const made = [];
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.invalid' } }).trim();

function repo(files = [['app.txt', 'one']])
{
    const dir = tmp('bench-fixture-');
    git(dir, 'init', '-q', '-b', 'fixture');
    git(dir, 'config', 'commit.gpgsign', 'false');
    for (const [rel, text, del] of files)
    {
        const p = path.join(dir, rel);
        if (del) git(dir, 'rm', '-q', rel);
        else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); git(dir, 'add', rel); }
        git(dir, 'commit', '-q', '-m', `step ${rel}`);
    }
    git(dir, 'tag', 'bench-fixture-v1');
    return { dir, head: git(dir, 'rev-parse', 'HEAD') };
}

test('lock: renders and parses the tag and the commit, and refuses a malformed one', () =>
{
    const text = renderLock({ tag: 'bench-fixture-v1', commit: 'a'.repeat(40) });
    assert.deepStrictEqual(parseLock(text), { tag: 'bench-fixture-v1', commit: 'a'.repeat(40) });
    assert.throws(() => parseLock('tag: x\n'), /commit/);
    assert.throws(() => parseLock(`tag: x\ncommit: ${'z'.repeat(40)}\n`), /commit/);
    assert.throws(() => parseLock(''), /tag/);
});

test('stack paths: any depth, both spellings of the stack surfaces, and nothing else', () =>
{
    const hits = stackPathsIn([
        '.claude/settings.json', 'web/.claude/rules/x.md', 'CLAUDE.md', 'api/CLAUDE.md', '.mcp.json',
        '.serena/project.yml', 'AGENTS.md', '.cursor/rules/a.mdc', '.cursorrules',
        // Alfred Code's data root since 2.1: a capture there would make its init skip that capture.
        '.alfred/docs/architecture/ARCHITECTURE.md', 'web/.alfred/serena/project.yml',
        'src/claude.ts', 'docs/CLAUDE-notes.md', 'README.md', 'api/Program.cs', 'src/alfred/Program.cs',
    ]);
    assert.deepStrictEqual(hits, [
        '.claude/settings.json', 'web/.claude/rules/x.md', 'CLAUDE.md', 'api/CLAUDE.md', '.mcp.json',
        '.serena/project.yml', 'AGENTS.md', '.cursor/rules/a.mdc', '.cursorrules',
        '.alfred/docs/architecture/ARCHITECTURE.md', 'web/.alfred/serena/project.yml',
    ]);
});

test('verify: a clean tag whose commit matches the lock passes, and the clone is left for the caller', () =>
{
    const r = repo();
    const dest = path.join(tmp('bench-clone-'), 'c');
    const out = verify({ source: r.dir, lock: { tag: 'bench-fixture-v1', commit: r.head }, dest });
    assert.strictEqual(out.commit, r.head);
    assert.ok(fs.existsSync(path.join(dest, 'app.txt')));
});

test('verify: the clone carries the fixture\'s own history alone - no other branch, tag or object of the source', () =>
{
    // The source is this repository, whose other branches hold every task's hidden tests and the stacks' own
    // releases: a local clone copies the whole object store and its tags, so every cell could read them with git.
    const r = repo();
    git(r.dir, 'checkout', '-q', '-b', 'harness');
    fs.writeFileSync(path.join(r.dir, 'hidden.txt'), 'the acceptance test a session must never see\n');
    git(r.dir, 'add', 'hidden.txt');
    git(r.dir, 'commit', '-q', '-m', 'hidden');
    git(r.dir, 'tag', 'v9.9.9');
    const hidden = git(r.dir, 'rev-parse', 'HEAD:hidden.txt');
    git(r.dir, 'checkout', '-q', 'fixture');
    const dest = path.join(tmp('bench-clone-'), 'c');
    verify({ source: r.dir, lock: { tag: 'bench-fixture-v1', commit: r.head }, dest });
    assert.deepStrictEqual(git(dest, 'tag', '-l').split('\n'), ['bench-fixture-v1'], 'the fixture tag alone');
    assert.throws(() => git(dest, 'cat-file', '-e', hidden), /./, 'no object of another branch');
    assert.strictEqual(git(dest, 'cat-file', '--batch-all-objects', '--batch-check').split('\n').length, git(dest, 'rev-list', '--objects', 'bench-fixture-v1').split('\n').length, 'every object is reachable from the fixture tag');
});

test('verify: a tag that resolves to another commit is refused', () =>
{
    const r = repo();
    const dest = path.join(tmp('bench-clone-'), 'c');
    assert.throws(() => verify({ source: r.dir, lock: { tag: 'bench-fixture-v1', commit: 'b'.repeat(40) }, dest }), /resolves to/);
});

test('verify: a stack file anywhere in the history is refused, even one deleted since', () =>
{
    const r = repo([['app.txt', 'one'], ['.claude/settings.json', '{}'], ['.claude/settings.json', '', true]]);
    const dest = path.join(tmp('bench-clone-'), 'c');
    assert.throws(() => verify({ source: r.dir, lock: { tag: 'bench-fixture-v1', commit: r.head }, dest }), /\.claude\/settings\.json/);
});

test('verify: an existing non-empty destination is never overwritten', () =>
{
    const r = repo();
    const dest = tmp('bench-clone-');
    fs.writeFileSync(path.join(dest, 'keep.txt'), 'mine');
    assert.throws(() => verify({ source: r.dir, lock: { tag: 'bench-fixture-v1', commit: r.head }, dest }), /not empty/);
    assert.strictEqual(fs.readFileSync(path.join(dest, 'keep.txt'), 'utf8'), 'mine');
});
