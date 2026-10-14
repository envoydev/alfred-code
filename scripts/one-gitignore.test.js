'use strict';
// ONE .gitignore - the data root's (the user's ruling of 2026-10-13: 'Have only one gitignore in root folder, remove
// rest of git ignores'). The data root's file carries the docs rules for its versioning; the docs root's own file, the
// session history's, the run book's credentials one and the project memory folder's go when they hold exactly the
// stack's text and a stack file covers them. A docs root outside the data root keeps its own; serena's folder file is
// serena's (it writes one whenever none is there). Each case is read back through git itself, never the text alone.
// The project's sensitive data exists from the first install on, written only where git keeps it out.

const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const docs = require('./install/docs.js');
const dataRoot = require('../stack/mcp/data-root.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'one-gitignore-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let seq = 0;
function repo()
{
    const root = path.join(TMP, `p-${seq++}`);
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: root });
    return root;
}
const put = (root, rel, text = 'x\n') => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const status = (root) => execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();
// Every .gitignore on disk, ignored or not (`git ls-files --others` cannot list one inside a folder the root ignores).
function ignores(root)
{
    const out = [];
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name === '.git') continue; const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.name === '.gitignore') out.push(path.relative(root, p).split(path.sep).join('/')); } };
    walk(root);
    return out.sort();
}
const MACHINE = ['flow/COMMIT-GATE', 'hook-blocks/s.jsonl', 'history/s.json', 'tools-usage/s.jsonl', 'docs-log.jsonl', '.branches/b/x.md',
    'usage-report/s1/raw.jsonl', 'project-capabilities/credentials.local.env'];

test('git versioning: the data root file alone keeps the machine state out and the docs in', () =>
{
    const root = repo();
    assert.strictEqual(docs.ensureDataIgnore({ projectRoot: root, root: '.alfred', docsPath: '.alfred/docs', mode: 'git' }), 'written');
    for (const rel of [...MACHINE, 'architecture/ARCHITECTURE.md', 'usage-report/s1/REPORT.md']) put(root, `.alfred/docs/${rel}`);
    for (const rel of ['serena/cache/x', '.alfred-memory/memory.db', 'chrome-control/Cookies', '.sensitive-data']) put(root, `.alfred/${rel}`);
    assert.deepStrictEqual(status(root), ['?? .alfred/.gitignore', '?? .alfred/docs/architecture/ARCHITECTURE.md', '?? .alfred/docs/usage-report/s1/REPORT.md']);
    assert.deepStrictEqual(ignores(root), ['.alfred/.gitignore'], 'one .gitignore in the whole tree');
    execFileSync('git', ['add', '.alfred/docs/architecture/ARCHITECTURE.md'], { cwd: root });
    assert.strictEqual(docs.docsVersioningSeed({ projectRoot: root, docsPath: '.alfred/docs' }), 'git', 'the seed still reads a committed root');
});

test('local versioning: the data root file keeps the docs out too, and the seed reads it back as local', () =>
{
    const root = repo();
    assert.strictEqual(docs.ensureDataIgnore({ projectRoot: root, root: '.alfred', docsPath: '.alfred/docs', mode: 'local' }), 'written');
    put(root, '.alfred/docs/architecture/ARCHITECTURE.md');
    put(root, '.alfred/.sensitive-data');
    assert.deepStrictEqual(status(root), ['?? .alfred/.gitignore']);
    assert.strictEqual(docs.docsVersioningSeed({ projectRoot: root, docsPath: '.alfred/docs' }), 'local');
});

test('a local root over docs git already tracks keeps them visible, the machine state still out, and says so', () =>
{
    const root = repo();
    put(root, '.alfred/docs/architecture/ARCHITECTURE.md');
    execFileSync('git', ['add', '.'], { cwd: root });
    const logs = [];
    docs.ensureDataIgnore({ projectRoot: root, root: '.alfred', docsPath: '.alfred/docs', mode: 'local', log: (m) => logs.push(m) });
    put(root, '.alfred/docs/architecture/NEW.md');
    put(root, '.alfred/docs/flow/APPROVAL');
    assert.ok(status(root).includes('?? .alfred/docs/architecture/NEW.md'), 'a new doc is not hidden');
    assert.ok(!status(root).some((l) => l.includes('flow/')));
    assert.ok(logs.some((m) => /git tracks docs under \.alfred\/docs - they stay visible to git/.test(m)), logs.join(' | '));
});

test('the launcher half writes the shape the settings name, absent-only', () =>
{
    const root = repo();
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_DOCS_VERSIONING: 'local' } }));
    assert.strictEqual(dataRoot.ensureRootIgnore({ projectDir: root, root: '.alfred', env: {} }), 'written');
    assert.strictEqual(fs.readFileSync(path.join(root, '.alfred', '.gitignore'), 'utf8'), dataRoot.dataIgnoreText({ root: '.alfred', docsPath: '.alfred/docs', mode: 'local' }));
    assert.strictEqual(dataRoot.ensureRootIgnore({ projectDir: root, root: '.alfred', env: {} }), 'present');
    const bare = repo();
    dataRoot.ensureRootIgnore({ projectDir: bare, root: '.alfred', env: {} });
    assert.match(fs.readFileSync(path.join(bare, '.alfred', '.gitignore'), 'utf8'), /^!\/docs\/$/m, 'no versioning set: the committed shape');
});

test('an update over a 2.4.0 layout removes every nested stack .gitignore once the data root file covers it, and a re-run is quiet', () =>
{
    for (const mode of ['git', 'local'])
    {
        const root = repo();
        put(root, '.alfred/.gitignore', '# alfred-code: the data root (ALFRED_CODE_DATA_PATH) is machine-local; the docs under it follow ALFRED_CODE_DOCS_VERSIONING (their own .gitignore)\n/*\n!/.gitignore\n!/docs/\n');
        put(root, '.alfred/docs/.gitignore', docs.DOCS_IGNORE_FORMER[docs.DOCS_IGNORE_FORMER.length - 1]);
        put(root, '.alfred/docs/history/.gitignore', '*\n');
        put(root, '.alfred/docs/project-capabilities/.gitignore', 'credentials.local.env\n');
        put(root, '.alfred/.alfred-memory/.gitignore', '*\n');
        put(root, '.alfred/serena/.gitignore', '*\n');
        put(root, '.alfred/docs/history/s.json', '{}\n');
        put(root, '.alfred/docs/project-capabilities/credentials.local.env', 'K=v\n');
        const logs = [];
        const run = () =>
        {
            const data = docs.ensureDataIgnore({ projectRoot: root, root: '.alfred', docsPath: '.alfred/docs', mode, log: (m) => logs.push(m) });
            const own = docs.ensureDocsIgnore({ projectRoot: root, docsPath: '.alfred/docs', mode, covered: true, log: (m) => logs.push(m) });
            const gone = docs.pruneNestedIgnores({ projectRoot: root, root: '.alfred', docsPath: '.alfred/docs', docsCovered: true, dataCovered: true, log: (m) => logs.push(m) });
            return { data, own, gone };
        };
        const first = run();
        assert.strictEqual(first.data, 'replaced', mode);
        assert.strictEqual(first.own, 'removed', mode);
        assert.deepStrictEqual(first.gone.sort(), ['.alfred/.alfred-memory/.gitignore', '.alfred/docs/history/.gitignore', '.alfred/docs/project-capabilities/.gitignore'], mode);
        assert.deepStrictEqual(ignores(root), ['.alfred/.gitignore', '.alfred/serena/.gitignore'], `${mode}: the data root's file, and serena's own`);
        assert.ok(!status(root).some((l) => /history\/s\.json|credentials\.local\.env/.test(l)), `${mode}: what the nested files kept out stays out`);
        assert.deepStrictEqual(run(), { data: 'current', own: 'covered', gone: [] }, `${mode}: a re-run changes nothing`);
    }
});

test('a nested file holding the project\'s own text stays, and nothing goes while no stack file covers it', () =>
{
    const root = repo();
    put(root, '.alfred/docs/.gitignore', '# mine\n*.tmp\n');
    put(root, '.alfred/docs/history/.gitignore', '*\n!keep.json\n');
    put(root, '.alfred/.alfred-memory/.gitignore', '*\n');
    const logs = [];
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: '.alfred/docs', mode: 'git', covered: true, log: (m) => logs.push(m) }), 'kept');
    assert.ok(logs.some((m) => /is the project's own - left as it is \(the data root's \.gitignore carries the stack's rules\)/.test(m)), logs.join(' | '));
    assert.deepStrictEqual(docs.pruneNestedIgnores({ projectRoot: root, root: '.alfred', docsPath: '.alfred/docs', docsCovered: true, dataCovered: false }), []);
    assert.strictEqual(fs.readFileSync(path.join(root, '.alfred/docs/history/.gitignore'), 'utf8'), '*\n!keep.json\n');
    assert.ok(fs.existsSync(path.join(root, '.alfred/.alfred-memory/.gitignore')), 'the data root file is not the stack\'s: the memory folder keeps its own');
});

test('a docs root outside the data root keeps its own file, which covers the history and the credentials file', () =>
{
    const root = repo();
    assert.strictEqual(docs.ensureDataIgnore({ projectRoot: root, root: '.alfred', docsPath: 'docs/alfred', mode: 'git' }), 'written');
    assert.strictEqual(fs.readFileSync(path.join(root, '.alfred', '.gitignore'), 'utf8'), dataRoot.dataIgnoreText({ root: '.alfred', docsPath: 'docs/alfred' }));
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: 'docs/alfred', mode: 'git', covered: false }), 'written');
    put(root, 'docs/alfred/history/.gitignore', '*\n');
    assert.deepStrictEqual(docs.pruneNestedIgnores({ projectRoot: root, root: '.alfred', docsPath: 'docs/alfred', docsCovered: true, dataCovered: true }), ['docs/alfred/history/.gitignore']);
    for (const rel of MACHINE) put(root, `docs/alfred/${rel}`);
    put(root, 'docs/alfred/architecture/ARCHITECTURE.md');
    assert.deepStrictEqual(status(root), ['?? .alfred/.gitignore', '?? docs/alfred/.gitignore', '?? docs/alfred/architecture/ARCHITECTURE.md']);
});

test('the default sensitive data: written once with its one comment line, never over the user\'s, never where git would commit it', () =>
{
    const root = repo();
    docs.ensureDataIgnore({ projectRoot: root, root: '.alfred', docsPath: '.alfred/docs', mode: 'git' });
    const file = path.join(root, '.alfred', '.sensitive-data');
    assert.strictEqual(dataRoot.ensureSensitiveFile({ projectDir: root, root: '.alfred' }), 'written');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), dataRoot.SENSITIVE_DEFAULT);
    assert.match(dataRoot.SENSITIVE_DEFAULT, /^# [^\n]*\n$/, 'one comment line');
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600, 'owner-only');
    assert.deepStrictEqual(dataRoot.readSensitive({ projectDir: root, root: '.alfred' }), {}, 'no key: the guard\'s start line stays silent');
    assert.deepStrictEqual(status(root), ['?? .alfred/.gitignore']);
    fs.writeFileSync(file, 'API_KEY=secret\n');
    assert.strictEqual(dataRoot.ensureSensitiveFile({ projectDir: root, root: '.alfred' }), 'present');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'API_KEY=secret\n', 'the user\'s file is never rewritten');

    const exposed = repo();
    assert.strictEqual(dataRoot.ensureSensitiveFile({ projectDir: exposed, root: '.alfred' }), 'exposed', 'no .gitignore keeps it out: nothing written');
    assert.ok(!fs.existsSync(path.join(exposed, '.alfred', '.sensitive-data')));
    const dir = repo();
    fs.mkdirSync(path.join(dir, '.alfred', '.sensitive-data'), { recursive: true });
    assert.strictEqual(dataRoot.ensureSensitiveFile({ projectDir: dir, root: '.alfred', check: () => true }), 'blocked');
    const noGit = path.join(TMP, `nogit-${seq++}`);
    fs.mkdirSync(noGit, { recursive: true });
    assert.strictEqual(dataRoot.ensureSensitiveFile({ projectDir: noGit, root: '.alfred', check: () => null }), 'written', 'outside git there is nothing to commit it to');
});
