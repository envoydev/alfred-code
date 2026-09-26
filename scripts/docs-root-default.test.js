'use strict';
// THE DOCS ROOT DEFAULT - `.alfred/docs`, outside `.claude/`.
//
// Claude Code treats `.claude/` as a protected directory (only `.claude/worktrees` is exempt): a write
// there is prompted in default and acceptEdits mode, denied in dontAsk, and no permissions.allow rule
// pre-approves it (code.claude.com/docs/en/permission-modes, 'Protected paths'). Every plan, capture and
// commit receipt the model writes under the docs root paid that prompt, and a headless run could not
// write them at all - so the default moved (user decision, 2026-09-26). The value is stated in more than
// one home (the hooks and the engines ship without the installer beside them), so this file pins every
// home to one value and fails on a NEW home that spells the old one.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const copy = require('./install/copy.js');
const docs = require('./install/docs.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-root-default-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let seq = 0;
function repo()
{
    const root = path.join(TMP, `p-${seq++}`);
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: root });
    return root;
}

test('the default is .alfred/docs in the installer, the catalog and the resolver', () =>
{
    assert.strictEqual(copy.DOCS_ROOT_DEFAULT, '.alfred/docs');
    const row = JSON.parse(fs.readFileSync(path.join(REPO, 'meta', 'environment.json'), 'utf8')).env.find((r) => r.key === 'ALFRED_CODE_DOCS_PATH');
    assert.strictEqual(row.default, copy.DOCS_ROOT_DEFAULT, 'the env catalog seeds the same default the resolver falls back to');
    assert.strictEqual(copy.resolveDocsRoot(repo()), '.alfred/docs', 'no settings file - the default');
});

// Every code home of the fallback, found by its shape - so a hook added later that spells its own
// fallback is held to the same value without anyone remembering to pin it.
function codeFiles()
{
    const out = [];
    const walk = (dir) =>
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (/\.(js|mjs|cjs)$/.test(e.name) && !/\.test\.js$/.test(e.name) && e.name !== 'docs-fixture.js') out.push(p);
        }
    };
    for (const top of ['stack', 'scripts', 'setup-plugin']) walk(path.join(REPO, top));
    return out;
}

test('every docs-root fallback in code spells .alfred/docs, and the old root appears only as the legacy constant', () =>
{
    const fallbacks = [];
    const stray = [];
    for (const file of codeFiles())
    {
        const rel = path.relative(REPO, file).split(path.sep).join('/');
        fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) =>
        {
            for (const m of line.matchAll(/'DOCS_PATH'\)\s*\|\|\s*'([^']*)'/g)) fallbacks.push(`${rel}:${i + 1} ${m[1]}`);
            if (/['"`]\.claude\/docs\/?['"`]/.test(line) && !/LEGACY_DOCS_ROOT/.test(line)) stray.push(`${rel}:${i + 1}`);
        });
    }
    assert.ok(fallbacks.length >= 15, `the hooks' inline fallbacks are found (${fallbacks.length})`);
    assert.deepStrictEqual(fallbacks.filter((f) => !f.endsWith(' .alfred/docs')), [], 'a fallback that is not the default');
    assert.deepStrictEqual(stray, [], 'the old root spelled as a value outside the LEGACY_DOCS_ROOT constant');
});

test('a hook with no docs path set writes its ledger under .alfred/docs', () =>
{
    const root = repo();
    fs.writeFileSync(path.join(root, '.claude', 'alfred-code.stamp'), 'source: x\n');
    const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
    for (const k of Object.keys(env)) if (/DOCS_PATH$/.test(k)) delete env[k];
    const res = spawnSync(process.execPath, [path.join(REPO, 'stack', 'hooks', 'guard-catastrophic-rm.js')], {
        input: JSON.stringify({ session_id: 'dflt', tool_name: 'Bash', tool_input: { command: 'rm -rf ~' }, cwd: root }),
        env, cwd: root, encoding: 'utf8',
    });
    assert.strictEqual(res.status, 2, res.stderr);
    assert.ok(fs.existsSync(path.join(root, '.alfred', 'docs', 'hook-blocks', 'dflt.jsonl')), 'the block row lands under the new root');
    assert.ok(!fs.existsSync(path.join(root, '.claude', 'docs')), 'nothing is written under .claude/docs');
});

// --- the root's own .gitignore ------------------------------------------------------------------
// `.claude/*` in a project's .gitignore used to keep the default root machine-local for free. The new
// root is outside it, so the installer gives the root its own .gitignore, shaped by the versioning
// decision: `local` keeps the whole root out of git, `git` keeps only the hooks' machine state out.

const ignoreOf = (root, docsPath = '.alfred/docs') => path.join(root, ...docsPath.split('/'), '.gitignore');

test('local versioning: the root gets a .gitignore of *, and git then ignores every doc under it', () =>
{
    const root = repo();
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: '.alfred/docs', mode: 'local' }), 'written');
    assert.match(fs.readFileSync(ignoreOf(root), 'utf8'), /^\*$/m);
    fs.mkdirSync(path.join(root, '.alfred', 'docs', 'architecture'), { recursive: true });
    fs.writeFileSync(path.join(root, '.alfred', 'docs', 'architecture', 'ARCHITECTURE.md'), '# a\n');
    assert.strictEqual(execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }), '');
    assert.strictEqual(docs.docsVersioningSeed({ projectRoot: root, docsPath: '.alfred/docs' }), 'local', 'the four-home rule reads the root back as kept out');
});

test('git versioning: the docs stay visible to git, the hooks\' machine state does not', () =>
{
    const root = repo();
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: '.alfred/docs', mode: 'git' }), 'written');
    const base = path.join(root, '.alfred', 'docs');
    for (const rel of ['architecture/ARCHITECTURE.md', 'flow/COMMIT-GATE', 'hook-blocks/s.jsonl', 'tools-usage/s.jsonl', 'docs-log.jsonl', '.branches/b/x.md'])
    {
        fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
        fs.writeFileSync(path.join(base, rel), 'x\n');
    }
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
    assert.deepStrictEqual(status.trim().split('\n').sort(), ['?? .alfred/docs/.gitignore', '?? .alfred/docs/architecture/ARCHITECTURE.md']);
    execFileSync('git', ['add', '.alfred/docs/architecture/ARCHITECTURE.md'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=x@example.invalid', '-c', 'user.name=x', 'commit', '-qm', 'docs'], { cwd: root });
    assert.strictEqual(docs.docsVersioningSeed({ projectRoot: root, docsPath: '.alfred/docs' }), 'git', 'the rule still reads a committed root');
});

test('the root .gitignore is absent-only - a file the project wrote is never touched', () =>
{
    const root = repo();
    fs.mkdirSync(path.join(root, '.alfred', 'docs'), { recursive: true });
    fs.writeFileSync(ignoreOf(root), 'mine\n');
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: '.alfred/docs', mode: 'local' }), 'kept');
    assert.strictEqual(fs.readFileSync(ignoreOf(root), 'utf8'), 'mine\n');
});

test('a versioning switch replaces the stack\'s own file, and a re-run changes nothing', () =>
{
    const root = repo();
    docs.ensureDocsIgnore({ projectRoot: root, docsPath: '.alfred/docs', mode: 'local' });
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: '.alfred/docs', mode: 'local' }), 'current');
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: '.alfred/docs', mode: 'git' }), 'replaced');
    assert.doesNotMatch(fs.readFileSync(ignoreOf(root), 'utf8'), /^\*$/m);
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: '.alfred/docs', mode: 'git' }), 'current');
});

test('a docs root outside the project, under .claude/, or with an unknown mode is left alone', () =>
{
    const root = repo();
    const outside = path.join(TMP, `elsewhere-${seq++}`);
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: outside, mode: 'local' }), 'outside');
    assert.ok(!fs.existsSync(path.join(outside, '.gitignore')));
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: '../sibling/docs', mode: 'local' }), 'outside');
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: '.alfred/docs', mode: 'bogus' }), 'skipped');
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: '.claude/docs', mode: 'git' }), 'skipped', 'a root under .claude/ is the project\'s .claude/* line\'s');
    assert.ok(!fs.existsSync(path.join(root, '.claude', 'docs', '.gitignore')));
    assert.ok(!fs.existsSync(ignoreOf(root)));
});
