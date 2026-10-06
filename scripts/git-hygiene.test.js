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

const { dataRootOffer, applyIgnore } = require('./git-hygiene.js');

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
    assert.ok(ignored(sub, '.alfred/browser/chrome/x'));
    assert.ok(!ignored(top, '.alfred/x'), 'the anchor keeps another folder of the same name untouched');
});

test('apply: a root with committed docs is never written', () =>
{
    const root = repo({ env: { ALFRED_CODE_DOCS_VERSIONING: 'git' } });
    assert.strictEqual(applyIgnore({ projectRoot: root, home: 'gitignore' }).state, 'none');
    assert.ok(!fs.existsSync(path.join(root, '.gitignore')));
});

test('cli: one line, a usage error on an unknown home', () =>
{
    const root = repo({ env: { ALFRED_CODE_DOCS_VERSIONING: 'local' } });
    const out = execFileSync(process.execPath, [path.join(__dirname, 'git-hygiene.js'), '--root', root], { encoding: 'utf8' });
    assert.match(out, /^git-hygiene: offer \.alfred\/\t/);
    assert.throws(() => execFileSync(process.execPath, [path.join(__dirname, 'git-hygiene.js'), '--root', root, '--apply', 'nowhere'], { stdio: 'ignore' }));
});
