'use strict';
// THE DATA ROOT'S GIT LINE (scripts/git-hygiene.js) - the user's report of 2026-10-06: '.alfred/ is not suggested to
// be added to git ignore or git exclude'. Offered only where nothing under the root is meant to be committed, written
// only on the user's answer, never twice, and never over a root that holds committed docs.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { dataRootOffer, toolIgnoreOffer, applyIgnore, rewriteOwnLine, OWN_COMMENT } = require('./git-hygiene.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'git-hygiene-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let n = 0;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
function repo({ env = {}, files = {}, init = true } = {})
{
    const root = path.join(TMP, `r-${n += 1}`);
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ env }));
    for (const [rel, body] of Object.entries(files))
    {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), body);
    }
    if (init) git(root, 'init', '-q');
    return root;
}
const ignored = (root, rel) => { try { git(root, 'check-ignore', '-q', '--', rel); return true; } catch { return false; } };

const DATA_IGNORE = '/*\n!/.gitignore\n!/docs/\n';

test('offer: local docs under the root, or the docs root elsewhere - nothing under it is committed', () =>
{
    // The root's own .gitignore (data-root.js dataIgnoreText) is present, as after every install.
    const local = repo({ env: { ALFRED_CODE_DOCS_VERSIONING: 'local' }, files: { '.alfred/docs/a.md': 'x', '.alfred/.gitignore': DATA_IGNORE } });
    const o = dataRootOffer({ projectRoot: local });
    assert.deepStrictEqual([o.state, o.root], ['offer', '.alfred']);
    assert.match(o.why, /machine-local/);
    const away = repo({ env: { ALFRED_CODE_DOCS_PATH: 'docs/alfred' }, files: { '.alfred/serena/project.yml': 'x' } });
    assert.match(dataRootOffer({ projectRoot: away }).why, /docs root is docs\/alfred, outside it/);
});

test('none: committed docs, tracked files, an ignored root or no repository', () =>
{
    assert.match(dataRootOffer({ projectRoot: repo({ env: { ALFRED_CODE_DOCS_VERSIONING: 'git' } }) }).why, /are committed/);
    const tracked = repo({ env: { ALFRED_CODE_DOCS_VERSIONING: 'local' }, files: { '.alfred/docs/a.md': 'x' } });
    git(tracked, 'add', '-f', '.alfred/docs/a.md');
    assert.match(dataRootOffer({ projectRoot: tracked }).why, /git tracks files under/);
    const already = repo({ env: { ALFRED_CODE_DOCS_VERSIONING: 'local' }, files: { '.gitignore': '.alfred\n', '.alfred/.gitignore': DATA_IGNORE } });
    assert.match(dataRootOffer({ projectRoot: already }).why, /already ignored/);
    assert.match(dataRootOffer({ projectRoot: repo({ init: false }) }).why, /not a git repository/);
});

test('apply: .gitignore gets one anchored line with its comment, kept EOL, and a re-run is current', () =>
{
    const root = repo({ env: { ALFRED_CODE_DOCS_VERSIONING: 'local' }, files: { '.gitignore': 'node_modules\r\n', '.alfred/.gitignore': DATA_IGNORE } });
    const r = applyIgnore({ projectRoot: root, home: 'gitignore' });
    assert.deepStrictEqual([r.state, r.line], ['applied', '/.alfred/']);
    assert.strictEqual(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'),
        'node_modules\r\n# alfred-code: the data root (ALFRED_CODE_DATA_PATH) is machine-local\r\n/.alfred/\r\n');
    assert.ok(ignored(root, '.alfred/serena/x'));
    assert.strictEqual(applyIgnore({ projectRoot: root, home: 'gitignore' }).state, 'none', 'now ignored: nothing offered');
});

// Workspace roles and variables, D6: at project and user scope git tracks `<root>/.variables`, so the root's line is the
// pair `/<root>/*` and `!/<root>/.variables`; an earlier line of this script's own becomes the pair, a user's line never.
test('apply at project scope writes /.alfred/* and !/.alfred/.variables, so the variables are tracked and the rest ignored', () =>
{
    const root = repo({ env: { ALFRED_CODE_DOCS_VERSIONING: 'local' }, files: { '.gitignore': 'node_modules\n', '.alfred/.gitignore': '/*\n!/.gitignore\n!/.variables\n!/docs/\n', '.claude/alfred-code.stamp': 'scope: project\n' } });
    const r = applyIgnore({ projectRoot: root, home: 'gitignore' });
    assert.deepStrictEqual([r.state, r.lines], ['applied', ['/.alfred/*', '!/.alfred/.variables']]);
    assert.strictEqual(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), `node_modules\n${OWN_COMMENT}\n/.alfred/*\n!/.alfred/.variables\n`);
    assert.ok(ignored(root, '.alfred/serena/x'));
    assert.ok(!ignored(root, '.alfred/.variables'));
});

test('rewriteOwnLine turns this script\'s own /.alfred/ line into the pair, keeps the EOL, and leaves a user\'s line alone', () =>
{
    const own = repo({ files: { '.gitignore': `a\r\n${OWN_COMMENT}\r\n/.alfred/\r\n` } });
    assert.deepStrictEqual(rewriteOwnLine({ projectRoot: own, root: '.alfred' }), [path.join(own, '.gitignore')]);
    assert.strictEqual(fs.readFileSync(path.join(own, '.gitignore'), 'utf8'), `a\r\n${OWN_COMMENT}\r\n/.alfred/*\r\n!/.alfred/.variables\r\n`);
    assert.deepStrictEqual(rewriteOwnLine({ projectRoot: own, root: '.alfred' }), [], 'a re-run rewrites nothing');
    const mine = repo({ files: { '.gitignore': 'a\n/.alfred/\n' } });
    assert.deepStrictEqual(rewriteOwnLine({ projectRoot: mine, root: '.alfred' }), []);
    assert.strictEqual(fs.readFileSync(path.join(mine, '.gitignore'), 'utf8'), 'a\n/.alfred/\n');
});

test('apply: the exclude file names the root from the top level, and no committed file is touched', () =>
{
    const top = repo({ init: true });
    const sub = path.join(top, 'apps', 'web');
    fs.mkdirSync(path.join(sub, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(sub, '.claude', 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_DOCS_VERSIONING: 'local' } }));
    const r = applyIgnore({ projectRoot: sub, home: 'exclude' });
    assert.deepStrictEqual([r.state, r.line], ['applied', '/apps/web/.alfred/']);
    assert.match(fs.readFileSync(path.join(top, '.git', 'info', 'exclude'), 'utf8'), /^\/apps\/web\/\.alfred\/$/m);
    assert.ok(!fs.existsSync(path.join(sub, '.gitignore')) && !fs.existsSync(path.join(top, '.gitignore')));
    assert.ok(ignored(sub, '.alfred/chrome-control/x'));
    assert.ok(!ignored(top, '.alfred/x'), 'the anchor keeps another folder of the same name untouched');
});

test('apply: a root with committed docs is never written', () =>
{
    const root = repo({ env: { ALFRED_CODE_DOCS_VERSIONING: 'git' } });
    assert.strictEqual(applyIgnore({ projectRoot: root, home: 'gitignore' }).state, 'none');
    assert.ok(!fs.existsSync(path.join(root, '.gitignore')));
});

// A workspace child installed at local scope: the stamp's scope, the data root's workspace file with its parent line.
const CHILD = { '.alfred/.gitignore': DATA_IGNORE, '.alfred/workspace': 'parent ..\n', '.claude/alfred-code.stamp': 'scope: local\ntool-ignores: .prettierignore=created\n', '.prettierignore': '# alfred-code\n/.claude/\n' };

test('--local-child in a local workspace child: the data root is offered with committed docs, and a .prettierignore the run created beside it (AC8)', () =>
{
    const root = repo({ env: { ALFRED_CODE_DOCS_VERSIONING: 'git' }, files: CHILD });
    assert.match(dataRootOffer({ projectRoot: root }).why, /are committed/, 'without the flag: as today');
    assert.strictEqual(toolIgnoreOffer({ projectRoot: root }).state, 'none', 'without the flag: as today');
    const o = dataRootOffer({ projectRoot: root, localChild: true });
    assert.deepStrictEqual([o.state, o.root], ['offer', '.alfred']);
    assert.match(o.why, /local install in a workspace/);
    const t = toolIgnoreOffer({ projectRoot: root, localChild: true });
    assert.deepStrictEqual([t.state, t.file], ['offer', '.prettierignore']);
    const out = execFileSync(process.execPath, [path.join(__dirname, 'git-hygiene.js'), '--root', root, '--local-child'], { encoding: 'utf8' });
    assert.match(out, /^git-hygiene: offer \.alfred\/\t.*\ngit-hygiene: offer \.prettierignore\t/);
    assert.strictEqual(applyIgnore({ projectRoot: root, home: 'exclude' }).state, 'none', 'without the flag nothing is written');
    const r = applyIgnore({ projectRoot: root, home: 'exclude', localChild: true });
    assert.deepStrictEqual([r.state, r.lines], ['applied', ['/.alfred/', '/.prettierignore']]);
    assert.ok(ignored(root, '.alfred/docs/a.md') && ignored(root, '.prettierignore'));
    assert.ok(!fs.existsSync(path.join(root, '.gitignore')), 'the exclude home touches no committed file');
    assert.strictEqual(applyIgnore({ projectRoot: root, home: 'exclude', localChild: true }).state, 'none', 'both now ignored: nothing offered');
});

test('--local-child at project scope, without a parent line, or with the .prettierignore tracked, offers as today', () =>
{
    const project = repo({ env: { ALFRED_CODE_DOCS_VERSIONING: 'git' }, files: { ...CHILD, '.claude/alfred-code.stamp': 'scope: project\ntool-ignores: .prettierignore=created\n' } });
    assert.match(dataRootOffer({ projectRoot: project, localChild: true }).why, /are committed/);
    assert.strictEqual(toolIgnoreOffer({ projectRoot: project, localChild: true }).state, 'none');
    const standalone = repo({ env: { ALFRED_CODE_DOCS_VERSIONING: 'git' }, files: { ...CHILD, '.alfred/workspace': 'parent none\n' } });
    assert.match(dataRootOffer({ projectRoot: standalone, localChild: true }).why, /are committed/);
    assert.strictEqual(toolIgnoreOffer({ projectRoot: standalone, localChild: true }).state, 'none');
    const tracked = repo({ env: { ALFRED_CODE_DOCS_VERSIONING: 'git' }, files: CHILD });
    git(tracked, 'add', '.prettierignore');
    assert.strictEqual(toolIgnoreOffer({ projectRoot: tracked, localChild: true }).state, 'none');
    assert.strictEqual(dataRootOffer({ projectRoot: tracked, localChild: true }).state, 'offer');
    const appended = repo({ env: { ALFRED_CODE_DOCS_VERSIONING: 'git' }, files: { ...CHILD, '.claude/alfred-code.stamp': 'scope: local\ntool-ignores: .prettierignore=appended\n' } });
    assert.strictEqual(toolIgnoreOffer({ projectRoot: appended, localChild: true }).state, 'none', 'a file the project had is the project\'s');
});

test('cli: one line, a usage error on an unknown home', () =>
{
    const root = repo({ env: { ALFRED_CODE_DOCS_VERSIONING: 'local' } });
    const out = execFileSync(process.execPath, [path.join(__dirname, 'git-hygiene.js'), '--root', root], { encoding: 'utf8' });
    assert.match(out, /^git-hygiene: offer \.alfred\/\t/);
    assert.throws(() => execFileSync(process.execPath, [path.join(__dirname, 'git-hygiene.js'), '--root', root, '--apply', 'nowhere'], { stdio: 'ignore' }));
});
