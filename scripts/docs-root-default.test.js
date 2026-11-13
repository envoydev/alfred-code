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
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
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

test('every reader defaults to <data root>/docs - the installer, the layout module and the engines', () =>
{
    const layout = require('../stack/hooks/layout.js');
    assert.strictEqual(copy.resolveDocsRoot(repo()), '.alfred/docs', 'no settings file - the default data root');
    const root = repo();
    // The fixed root (3.11.0): a key names a folder only to the installer side, and only while that folder still holds
    // the stack's data - the docs an update has not moved yet.
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: '.data' } }));
    assert.strictEqual(copy.resolveDocsRoot(root, 'project'), '.alfred/docs', 'a key naming a folder with nothing of the stack\'s in it');
    fs.mkdirSync(path.join(root, '.data', 'docs'), { recursive: true });
    assert.strictEqual(copy.resolveDocsRoot(root, 'project'), '.data/docs', 'an older install\'s folder, until an update moves it');
    assert.strictEqual(layout.docsRoot({}), '.alfred/docs');
    assert.strictEqual(layout.docsRoot({ ALFRED_CODE_DATA_PATH: '.data' }), '.alfred/docs', 'a hook reads no relative key');
    assert.strictEqual(layout.docsRoot({ ALFRED_CODE_DATA_PATH: '.data', ALFRED_CODE_DOCS_PATH: 'docs-ext' }), 'docs-ext', 'a leftover key is still read first for the 2.x line');
    const prefs = require('../stack/skills/capture-preferences/scripts/preferences.js');
    assert.strictEqual(prefs.docsRoot(root), '.alfred/docs');
    const rows = JSON.parse(fs.readFileSync(path.join(REPO, 'meta', 'environment.json'), 'utf8')).env;
    assert.strictEqual(rows.find((r) => r.key === 'ALFRED_CODE_DOCS_PATH'), undefined, 'the catalog retires the key');
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

test('every docs-root fallback in code is the data root\'s docs/, and the old root appears only as the legacy constant', () =>
{
    const fallbacks = [];
    const stray = [];
    for (const file of codeFiles())
    {
        const rel = path.relative(REPO, file).split(path.sep).join('/');
        fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) =>
        {
            for (const m of line.matchAll(/(?:'DOCS_PATH'\)|\.ALFRED_CODE_DOCS_PATH)\s*\|\|\s*(.*)$/g)) fallbacks.push([`${rel}:${i + 1}`, m[1]]);
            if (/['"`]\.claude\/docs\/?['"`]/.test(line) && !/LEGACY_DOCS_ROOT/.test(line)) stray.push(`${rel}:${i + 1}`);
        });
    }
    assert.ok(fallbacks.length >= 15, `the hooks' inline fallbacks are found (${fallbacks.length})`);
    // The one spelling: the data root's docs/ - a hook's own pinned dataRoot() (it ships with no module beside it), dataRoot(env) in layout.js.
    const DATA_DOCS = /^(?:'\.alfred\/docs'|`\$\{(?:dataRoot\((?:env|projectRoot(?:, env)?)?\)|dataRel|root|require\('[./]+\/stack\/mcp\/data-root\.js'\)\.dataRootOf\(\{ projectDir: [^}]+ \}\)\.root)\}\/docs`)/;
    assert.deepStrictEqual(fallbacks.filter(([, rest]) => !DATA_DOCS.test(rest)).map(([at, rest]) => `${at} ${rest.trim()}`), [], 'a fallback that is not the data root\'s docs/');
    assert.deepStrictEqual(stray, [], 'the old root spelled as a value outside the LEGACY_DOCS_ROOT constant');
});

test('a hook with no docs path set writes its ledger under .alfred/statistics', () =>
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
    assert.ok(fs.existsSync(path.join(root, '.alfred', 'statistics', 'hook-blocks', 'dflt.jsonl')), 'the block row lands under the data root\'s statistics/');
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

test('git versioning: the docs stay visible to git, the two machine-local files under them do not', () =>
{
    const root = repo();
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: '.alfred/docs', mode: 'git' }), 'written');
    const base = path.join(root, '.alfred', 'docs');
    for (const rel of ['architecture/ARCHITECTURE.md', 'project-capabilities/credentials.local.env', 'awareness/AGENTS-AWARENESS.md'])
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

test('the stack\'s own file checked out with CRLF line ends is still the stack\'s', () =>
{
    // Review minor: autocrlf on Windows turned the stack's git-shape file into 'the project's own'.
    const root = repo();
    docs.ensureDocsIgnore({ projectRoot: root, docsPath: '.alfred/docs', mode: 'git' });
    fs.writeFileSync(ignoreOf(root), fs.readFileSync(ignoreOf(root), 'utf8').replace(/\n/g, '\r\n'));
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: '.alfred/docs', mode: 'git' }), 'current');
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: '.alfred/docs', mode: 'local' }), 'replaced');
});

test('local versioning never hides a root that git already tracks docs in', () =>
{
    // Review minor: `*` over a committed root silently ignored every new team doc written there.
    const root = repo();
    fs.mkdirSync(path.join(root, 'docs', 'architecture'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'architecture', 'ARCHITECTURE.md'), '# a\n');
    execFileSync('git', ['add', 'docs'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=x@example.invalid', '-c', 'user.name=x', 'commit', '-qm', 'docs'], { cwd: root });
    const logs = [];
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: 'docs', mode: 'local', log: (m) => logs.push(m) }), 'tracked');
    assert.ok(!fs.existsSync(path.join(root, 'docs', '.gitignore')));
    assert.ok(logs.some((m) => /git tracks docs under docs/.test(m)), logs.join(' | '));
});

// final review I2: the git text 3.4.1 wrote (frozen here - the 2026-10-29 split added the USER-AWARENESS.md lines) is
// still the stack's own: an update replaces it, so the user's own notes are ignored, never kept out of the rewrite as
// the project's file.
test('the 3.4.1 git text is replaced as the stack\'s own', () =>
{
    const root = repo();
    fs.mkdirSync(path.join(root, '.alfred', 'docs'), { recursive: true });
    const v341 = '# alfred-code: the docs are committed (ALFRED_CODE_DOCS_VERSIONING=git) but for the lines below\n'
        + '# the hooks\' state before 2.8.0, which a session started before the update still writes\n'
        + '/flow/\n/hook-blocks/\n/history/*.json\n/tools-usage/\n/docs-log.jsonl\n/usage-report/**/*.jsonl\n'
        + '# the run book\'s credentials file before 2026-10-13, which an older capture still writes\n/project-capabilities/credentials.local.env\n'
        + '# the awareness capture\'s inventory names this machine\'s plugins\n/awareness/AGENTS-AWARENESS.md\n'
        + '# the user\'s own preferences - how they want the assistant to work, and their code taste\n'
        + '/preferences/PERSONAL-PREFERENCES.md\n/preferences/PERSONAL-CODE-PREFERENCES.md\n';
    fs.writeFileSync(ignoreOf(root), v341);
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: '.alfred/docs', mode: 'git' }), 'replaced');
    assert.match(fs.readFileSync(ignoreOf(root), 'utf8'), /^\/awareness\/USER-AWARENESS\.md$/m);
});

test('ab-HO5: DATA_PATH=\'./\' reads the same in docsRootEnv and layout.dataRoot', () =>
{
    const layout = require('../stack/hooks/layout.js');
    const { docsRootEnv } = require('../stack/hooks/docs-session.js');
    const root = repo();
    const saved = { data: process.env.ALFRED_CODE_DATA_PATH, docs: process.env.ALFRED_CODE_DOCS_PATH };
    delete process.env.ALFRED_CODE_DOCS_PATH;
    try
    {
        for (const spelling of ['./', '.', './.alfred/', '\'./\''])
        {
            process.env.ALFRED_CODE_DATA_PATH = spelling;
            assert.strictEqual(path.resolve(root, docsRootEnv()), path.resolve(root, layout.dataRoot(), 'docs'), `DATA_PATH=${spelling}`);
        }
    }
    finally
    {
        for (const [k, v] of [['ALFRED_CODE_DATA_PATH', saved.data], ['ALFRED_CODE_DOCS_PATH', saved.docs]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
});

// The fixed root (3.11.0): the env reader takes an absolute value alone - a harness's scratch (corpus-replay.js, the
// hook suites). Every relative value reads as .alfred, the ones the installer's checkDataPath kept included.
test('fixed root: the env reader keeps an absolute value and reads every relative one as .alfred', () =>
{
    const layout = require('../stack/hooks/layout.js');
    assert.strictEqual(layout.checkDataPath, undefined, 'layout.js holds no copy of the installer\'s check');
    for (const v of ['.', './', '..', '.claude/x', '.git', 'a b', '\'./\'', 'x/../y', '$HOME/x', 'x:y', 'C:x', 'var/data', './var/data/', '.alfred', 'var//data', '  tools/.alfred '])
        assert.strictEqual(layout.dataRoot({ ALFRED_CODE_DATA_PATH: v }), '.alfred', `the env reader ignores ${v}`);
    assert.strictEqual(layout.dataRoot({}), '.alfred', 'unset');
    for (const [v, want] of [['/abs/x', '/abs/x'], ['/abs/x/', '/abs/x'], ['C:/x', 'C:/x'], ['C:\\x\\y', 'C:/x/y'], ['/a b/c', '/a b/c'], ['/', '.alfred']])
        assert.strictEqual(layout.dataRoot({ ALFRED_CODE_DATA_PATH: v }), want, `the env reader keeps the absolute ${v}`);
});

test('a hook under DATA_PATH=\'.\' writes its ledger under .alfred/statistics, never the project root', () =>
{
    const root = repo();
    fs.writeFileSync(path.join(root, '.claude', 'alfred-code.stamp'), 'source: x\n');
    const env = { ...process.env, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_DATA_PATH: '.' };
    for (const k of Object.keys(env)) if (/DOCS_PATH$/.test(k)) delete env[k];
    const res = spawnSync(process.execPath, [path.join(REPO, 'stack', 'hooks', 'guard-catastrophic-rm.js')], {
        input: JSON.stringify({ session_id: 'dot', tool_name: 'Bash', tool_input: { command: 'rm -rf ~' }, cwd: root }),
        env, cwd: root, encoding: 'utf8',
    });
    assert.strictEqual(res.status, 2, res.stderr);
    assert.ok(!fs.existsSync(path.join(root, 'statistics')), 'nothing lands in <project>/statistics');
    assert.ok(fs.existsSync(path.join(root, '.alfred', 'statistics', 'hook-blocks', 'dot.jsonl')), 'the row lands where the installer put the data root');
});

// The fixed root (2026-11-11): a relative ALFRED_CODE_DATA_PATH names nothing - a hook reads .alfred whatever it holds.
test('fixed root: a hook ignores a relative ALFRED_CODE_DATA_PATH in its env', () =>
{
    const layout = require('../stack/hooks/layout.js');
    assert.strictEqual(layout.dataRoot({ ALFRED_CODE_DATA_PATH: 'var/data' }), '.alfred');
    const root = repo();
    fs.writeFileSync(path.join(root, '.claude', 'alfred-code.stamp'), 'source: x\n');
    const env = { ...process.env, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_DATA_PATH: 'var/data' };
    for (const k of Object.keys(env)) if (/DOCS_PATH$/.test(k)) delete env[k];
    const res = spawnSync(process.execPath, [path.join(REPO, 'stack', 'hooks', 'guard-catastrophic-rm.js')], {
        input: JSON.stringify({ session_id: 'rel', tool_name: 'Bash', tool_input: { command: 'rm -rf ~' }, cwd: root }),
        env, cwd: root, encoding: 'utf8',
    });
    assert.strictEqual(res.status, 2, res.stderr);
    assert.ok(fs.existsSync(path.join(root, '.alfred', 'statistics', 'hook-blocks', 'rel.jsonl')), 'the row lands under .alfred');
    assert.ok(!fs.existsSync(path.join(root, 'var')), 'nothing lands under the folder the key names');
});

// An absolute value is a harness's scratch (corpus-replay.js, the hook suites): the hooks' state and ledgers follow it,
// while everything joined under a project root - the workspace record, .variables - stays in .alfred.
test('fixed root: under an absolute key the state and ledgers follow it, the workspace record and .variables do not', () =>
{
    const layout = require('../stack/hooks/layout.js');
    const root = repo();
    const abs = path.join(TMP, 'scratch-abs');
    const env = { ALFRED_CODE_DATA_PATH: abs, CLAUDE_CONFIG_DIR: path.join(TMP, 'no-account') };
    assert.ok(layout.statePath(root, 'approvals', 'APPROVAL', env).startsWith(path.resolve(abs) + path.sep));
    assert.ok(layout.statsPath(root, ['hook-blocks', 'x.jsonl'], env).startsWith(path.resolve(abs) + path.sep));
    assert.strictEqual(layout.dataRootOf(root, { env }), '.alfred');
    fs.mkdirSync(path.join(root, '.alfred'), { recursive: true });
    fs.writeFileSync(path.join(root, '.alfred', '.variables'), 'ALFRED_CODE_HISTORY=9\n');
    assert.strictEqual(layout.variablesOf(root, { env }).values.ALFRED_CODE_HISTORY, '9');
});
