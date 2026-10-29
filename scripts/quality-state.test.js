'use strict';
// capture-quality's state script (spec 1.4, 2026-10-29): three lines, one per part, each doc's stamp held against git
// with the docs root and the data root out of the pathspec - so committing a captured doc, or leaving one uncommitted,
// never makes a part stale. The chain ask picks its template from these lines.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'stack', 'skills', 'capture-quality', 'scripts', 'quality-state.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-state-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^ALFRED_CODE_|^CLAUDE_PROJECT_DIR$|^GIT_/.test(k)));
ENV.CLAUDE_CONFIG_DIR = path.join(TMP, 'account');
ENV.GIT_CEILING_DIRECTORIES = TMP;

const DOCS = '.alfred/docs/quality';
const ARCH = `${DOCS}/ARCHITECTURE-ASSESSMENT.md`;
const CODE = `${DOCS}/CODE-ASSESSMENT.md`;
const COVERAGE = `${DOCS}/COVERAGE-QUALITY.md`;

let seq = 0;
const git = (root, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: root, env: ENV, encoding: 'utf8' }).trim();
const put = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
function repo()
{
    const root = path.join(TMP, `r-${seq++}`);
    fs.mkdirSync(root, { recursive: true });
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.email', 'x@example.invalid');
    git(root, 'config', 'user.name', 'x');
    put(root, 'src/a.js', 'a\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'code');
    return root;
}
const commit = (root, rel, text, msg = 'change') => { put(root, rel, text); git(root, 'add', '-A'); git(root, 'commit', '-qm', msg); return git(root, 'rev-parse', 'HEAD'); };
const state = (root) => execFileSync(process.execPath, [SCRIPT], { cwd: root, env: ENV, encoding: 'utf8' });
const lines = (root) => state(root).trimEnd().split('\n');
const asOf = (sha, extra = '') => `# Assessment\n\nAs of: main@${sha.slice(0, 7)}${extra}, 2026-10-29\n\nbody\n`;

test('no docs: every part is absent, in table order', () =>
{
    assert.deepStrictEqual(lines(repo()), ['architecture-quality: absent', 'code-quality: absent', 'test-coverage-quality: absent']);
});

test('a doc with no stamp, and an unreadable one, are unstamped', () =>
{
    const root = repo();
    put(root, CODE, '# Code\n\nno stamp here\n');
    fs.mkdirSync(path.join(root, ARCH), { recursive: true });
    assert.deepStrictEqual(lines(root), ['architecture-quality: unstamped', 'code-quality: unstamped', 'test-coverage-quality: absent']);
});

test('a stamp at HEAD on a clean tree is current; a doc-only commit and an uncommitted doc leave it current', () =>
{
    const root = repo();
    const head = git(root, 'rev-parse', 'HEAD');
    put(root, CODE, asOf(head));
    put(root, COVERAGE, `# Coverage\n\nCaptured: main@${head.slice(0, 7)}, 2026-10-29\n`);
    assert.deepStrictEqual(lines(root).slice(1), [`code-quality: current main@${head.slice(0, 7)}`, `test-coverage-quality: current main@${head.slice(0, 7)}`]);
    commit(root, CODE, asOf(head), 'the doc');
    put(root, ARCH, asOf(head));
    assert.deepStrictEqual(lines(root), [`architecture-quality: current main@${head.slice(0, 7)}`, `code-quality: current main@${head.slice(0, 7)}`, `test-coverage-quality: current main@${head.slice(0, 7)}`]);
});

test('a code commit after the stamp is stale by the scoped count', () =>
{
    const root = repo();
    const head = git(root, 'rev-parse', 'HEAD');
    commit(root, 'src/b.js', 'b\n');
    commit(root, CODE, asOf(head), 'the doc');
    assert.strictEqual(lines(root)[1], `code-quality: stale main@${head.slice(0, 7)} (1 commits behind HEAD)`);
});

test('a stamp off the branch, and one a shallow clone lacks, are not on this branch', () =>
{
    const root = repo();
    git(root, 'checkout', '-q', '-b', 'side');
    const side = commit(root, 'src/side.js', 's\n');
    git(root, 'checkout', '-q', 'main');
    put(root, CODE, asOf(side));
    assert.strictEqual(lines(root)[1], `code-quality: stale main@${side.slice(0, 7)} (not on this branch)`);

    const first = git(root, 'rev-parse', 'HEAD');
    commit(root, 'src/c.js', 'c\n');
    const shallow = path.join(TMP, `shallow-${seq++}`);
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${root}`, shallow], { env: ENV });
    put(shallow, CODE, asOf(first));
    assert.strictEqual(lines(shallow)[1], `code-quality: stale main@${first.slice(0, 7)} (not on this branch)`);
});

test('a dirty code file, or +dirty in the stamp, is uncommitted changes', () =>
{
    const root = repo();
    const head = git(root, 'rev-parse', 'HEAD');
    put(root, CODE, asOf(head, '+dirty'));
    assert.strictEqual(lines(root)[1], `code-quality: stale main@${head.slice(0, 7)} (uncommitted changes)`);
    put(root, CODE, asOf(head));
    put(root, 'src/a.js', 'changed\n');
    assert.strictEqual(lines(root)[1], `code-quality: stale main@${head.slice(0, 7)} (uncommitted changes)`);
});

test('+dirty after the date on the stamp line is uncommitted changes, LF and CRLF', () =>
{
    const root = repo();
    const head = git(root, 'rev-parse', 'HEAD');
    const doc = `# Assessment\n\nAs of: main@${head.slice(0, 7)}, 2026-10-29 +dirty\n\nbody +dirty\n`;
    put(root, CODE, doc);
    assert.strictEqual(lines(root)[1], `code-quality: stale main@${head.slice(0, 7)} (uncommitted changes)`);
    put(root, CODE, doc.replace(/\n/g, '\r\n'));
    assert.strictEqual(lines(root)[1], `code-quality: stale main@${head.slice(0, 7)} (uncommitted changes)`);
    put(root, CODE, `# Assessment\n\nAs of: main@${head.slice(0, 7)}, 2026-10-29\n\nbody +dirty\n`);
    assert.strictEqual(lines(root)[1], `code-quality: current main@${head.slice(0, 7)}`);
});

test('a detached HEAD is computed against HEAD', () =>
{
    const root = repo();
    const first = git(root, 'rev-parse', 'HEAD');
    commit(root, 'src/b.js', 'b\n');
    git(root, 'checkout', '-q', '--detach', first);
    put(root, CODE, asOf(first));
    assert.strictEqual(lines(root)[1], `code-quality: current main@${first.slice(0, 7)}`);
});

test('a CRLF doc reads like LF', () =>
{
    const root = repo();
    const head = git(root, 'rev-parse', 'HEAD');
    put(root, ARCH, asOf(head).replace(/\n/g, '\r\n'));
    assert.strictEqual(lines(root)[0], `architecture-quality: current main@${head.slice(0, 7)}`);
});

test('no git: a stamped doc is stale (no git), an unstamped one stays unstamped', () =>
{
    const root = path.join(TMP, `plain-${seq++}`);
    put(root, CODE, '# Code\n\nAs of: main@abc1234, 2026-10-29\n');
    put(root, COVERAGE, '# Coverage\n');
    assert.deepStrictEqual(lines(root), ['architecture-quality: absent', 'code-quality: stale main@abc1234 (no git)', 'test-coverage-quality: unstamped']);
});

test('the docs root follows ALFRED_CODE_DATA_PATH in the project settings', () =>
{
    const root = repo();
    const head = commit(root, '.claude/settings.json', JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: 'data' } }), 'settings');
    put(root, 'data/docs/quality/CODE-ASSESSMENT.md', asOf(head));
    put(root, 'data/state/x.json', '{}');
    assert.strictEqual(lines(root)[1], `code-quality: current main@${head.slice(0, 7)}`, 'its doc found, and the data root out of the pathspec');
});
