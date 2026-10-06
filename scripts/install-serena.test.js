'use strict';
// THE SERENA SEED OF THE NODE SEED - Phase 7, T4.
//
// Two properties carry the whole layer: a key that carries entries is never rewritten, and a key is
// never appended twice (a duplicate YAML key is an error, not an override). Everything else is the
// language scan.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const serena = require('./install/serena.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-serena-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
function project(files = {})
{
    const root = path.join(TMP, `p-${seq++}`);
    for (const [rel, body] of Object.entries(files))
    {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), body);
    }
    fs.mkdirSync(root, { recursive: true });
    return root;
}
const cfgOf = (root) => fs.readFileSync(path.join(root, '.serena', 'project.yml'), 'utf8');

// --- the language scan ----------------------------------------------------

test('detect: a C# solution and a TypeScript app are both found, in a fixed order', () =>
{
    const root = project({ 'src/App.csproj': '', 'web/tsconfig.json': '{}' });
    assert.deepStrictEqual(serena.detectLanguages(root), ['csharp', 'typescript']);
});

test('detect: a package.json-only or .js-only repo takes the typescript server too', () =>
{
    // serena's typescript server handles plain JavaScript - without this a JS project detected
    // nothing and got no seed at all.
    assert.deepStrictEqual(serena.detectLanguages(project({ 'package.json': '{}' })), ['typescript']);
    assert.deepStrictEqual(serena.detectLanguages(project({ 'lib/util.mjs': '' })), ['typescript']);
});

test('detect: node_modules and .git are never scanned', () =>
{
    const root = project({ 'node_modules/pkg/index.js': '', '.git/hooks/x.js': '', 'README.md': '' });
    assert.deepStrictEqual(serena.detectLanguages(root), []);
});

test('detect: a repo with no source of either kind detects nothing', () =>
{
    assert.deepStrictEqual(serena.detectLanguages(project({ 'docs/readme.md': '', 'main.py': '' })), []);
});

// --- the key rules --------------------------------------------------------

test('has-entries: a populated inline list or block list counts, an empty one does not', () =>
{
    assert.strictEqual(serena.hasEntries('language_servers: ["csharp"]\n', ['language_servers']), true);
    assert.strictEqual(serena.hasEntries('language_servers:\n  - csharp\n', ['language_servers']), true);
    assert.strictEqual(serena.hasEntries('language_servers: []\n', ['language_servers']), false);
    assert.strictEqual(serena.hasEntries('language_servers:\nproject_name: "x"\n', ['language_servers']), false);
    assert.strictEqual(serena.hasEntries('languages: ["csharp"]\n', ['language_servers', 'languages']), true);
});

test('set-key: an EMPTY key is rewritten in place, never appended a second time', () =>
{
    // serena's own generated config ships `language_servers: []`, and a second key of the same name
    // is a duplicate-key YAML error, not an override.
    const root = project({ '.serena/project.yml': 'project_name: "x"\nlanguage_servers: []\nignored_paths: []\n' });
    serena.seedProject({ projectRoot: root, selected: true });
    const text = cfgOf(root);
    assert.strictEqual((text.match(/^ignored_paths:/gm) || []).length, 1, text);
    assert.match(text, /^ignored_paths: \[".serena", ".claude", ".playwright"\]$/m);
});

test('set-key: a key that carries entries is hand-tuned and LEFT ALONE', () =>
{
    const root = project({
        '.serena/project.yml': 'project_name: "x"\nlanguage_servers: ["python"]\nignored_paths:\n  - vendor\n',
        'src/App.csproj': '',
    });
    const logs = [];
    serena.seedProject({ projectRoot: root, selected: true, log: (m) => logs.push(m) });
    const text = cfgOf(root);
    assert.match(text, /language_servers: \["python"\]/);
    assert.match(text, /- vendor/);
    assert.ok(!/\.playwright/.test(text), 'a populated ignored_paths was rewritten');
    assert.ok(logs.some((m) => /already names its language servers/.test(m)), logs.join(' | '));
});

test('set-key: an ABSENT key is appended once, with its reason', () =>
{
    const root = project({ '.serena/project.yml': 'project_name: "x"\n' });
    serena.seedProject({ projectRoot: root, selected: true });
    const text = cfgOf(root);
    assert.match(text, /# Added by alfred-code: the data root holds/);
    assert.strictEqual((text.match(/^ignored_paths:/gm) || []).length, 1);
});

test('data root: the seed lands in the folder serena reads this run and ignores the root; the stack\'s old list follows the root, the user\'s stays', () =>
{
    const root = project({ 'web/package.json': '{}' });
    serena.seedProject({ projectRoot: root, selected: true, dir: '.alfred/serena', root: '.alfred' });
    const fresh = fs.readFileSync(path.join(root, '.alfred', 'serena', 'project.yml'), 'utf8');
    assert.match(fresh, /^ignored_paths: \["\.alfred", "\.claude", "\.serena", "\.playwright"\]$/m);
    assert.ok(!fs.existsSync(path.join(root, '.serena')), 'nothing at the 2.0.0 place');

    const old = project({ '.serena/project.yml': 'project_name: "x"\nlanguage_servers: ["typescript"]\nignored_paths: [".serena", ".claude", ".playwright"]\n' });
    serena.seedProject({ projectRoot: old, selected: true, dir: '.serena', root: '.data' });
    assert.match(cfgOf(old), /^ignored_paths: \["\.data", "\.claude", "\.serena", "\.playwright"\]$/m, 'the stack\'s 2.0.0 value is re-pointed at the root');
    serena.seedProject({ projectRoot: old, selected: true, dir: '.serena', root: '.alfred' });
    assert.match(cfgOf(old), /^ignored_paths: \["\.alfred", "\.claude", "\.serena", "\.playwright"\]$/m, 'and follows a later root');

    const mine = project({ '.serena/project.yml': 'project_name: "x"\nlanguage_servers: ["typescript"]\nignored_paths: ["build", ".claude"]\n' });
    serena.seedProject({ projectRoot: mine, selected: true, dir: '.serena', root: '.alfred' });
    assert.match(cfgOf(mine), /^ignored_paths: \["build", "\.claude"\]$/m, 'a list the user wrote is theirs');
});

// --- the fresh seed -------------------------------------------------------

test('seed: a fresh project gets project_name, the detected servers and the ignore list', () =>
{
    const root = project({ 'src/App.csproj': '', 'web/package.json': '{}' });
    const out = serena.seedProject({ projectRoot: root, selected: true });
    assert.strictEqual(out.written, true);
    const text = cfgOf(root);
    assert.match(text, new RegExp(`^project_name: "${path.basename(root)}"$`, 'm'));
    assert.match(text, /^language_servers: \["csharp", "typescript"\]$/m);
    assert.match(text, /^ignored_paths: \[".serena", ".claude", ".playwright"\]$/m);
});

test('seed: nothing detected means NO FILE - a project.yml without language_servers fails to load', () =>
{
    const root = project({ 'main.py': '' });
    const logs = [];
    const out = serena.seedProject({ projectRoot: root, selected: true, log: (m) => logs.push(m) });
    assert.strictEqual(out.written, false);
    assert.ok(!fs.existsSync(path.join(root, '.serena', 'project.yml')));
    assert.ok(logs.some((m) => /left project\.yml to serena's own detection/.test(m)), logs.join(' | '));
});

test('seed: serena not in this selection writes nothing at all', () =>
{
    const root = project({ 'src/App.csproj': '' });
    assert.strictEqual(serena.seedProject({ projectRoot: root, selected: false }).written, false);
    assert.ok(!fs.existsSync(path.join(root, '.serena')));
});

test('seed: a second run over a seeded project changes nothing', () =>
{
    const root = project({ 'src/App.csproj': '' });
    serena.seedProject({ projectRoot: root, selected: true });
    const before = fs.readFileSync(path.join(root, '.serena', 'project.yml'));
    serena.seedProject({ projectRoot: root, selected: true });
    assert.ok(fs.readFileSync(path.join(root, '.serena', 'project.yml')).equals(before), 'an idempotent run rewrote project.yml');
});

test('seed: an EXISTING config with an empty language list gets both keys filled, not a new file', () =>
{
    const root = project({ '.serena/project.yml': '# serena generated\nproject_name: "auto"\nlanguage_servers: []\n', 'web/tsconfig.json': '{}' });
    serena.seedProject({ projectRoot: root, selected: true });
    const text = cfgOf(root);
    assert.match(text, /^project_name: "auto"$/m, 'the existing project_name was replaced');
    assert.match(text, /^language_servers: \["typescript"\]$/m);
    assert.match(text, /^ignored_paths: \[".serena", ".claude", ".playwright"\]$/m);
});

// 2026-10-06 (Windows): serena rewrites project.yml with CRLF and block lists at column 1. The old line test read
// `language_servers:\r` as an empty key and wrote an inline value above the block items - 'expected <block end>, but
// found '-'' at line 42, and the navigation server stopped loading.
const CRLF_BLOCK = 'project_name: "Speech"\r\nlanguage_servers:\r\n- csharp\r\nignored_paths:\r\n- ".alfred"\r\n- ".claude"\r\n- ".serena"\r\n- ".playwright"\r\nread_only: false\r\n';

test('seed: a CRLF block list is a key with entries - left byte for byte', () =>
{
    const root = project({ '.serena/project.yml': CRLF_BLOCK, 'src/App.csproj': '' });
    serena.seedProject({ projectRoot: root, selected: true, root: '.alfred' });
    assert.strictEqual(cfgOf(root), CRLF_BLOCK);
    assert.ok(serena.hasEntries(CRLF_BLOCK, ['language_servers']) && serena.hasEntries(CRLF_BLOCK, ['ignored_paths']));
});

test('seed: a file an earlier release broke (an inline value above stray block items) is repaired, then idempotent', () =>
{
    const broken = 'project_name: "Speech"\r\nlanguage_servers: ["csharp"]\r\n- csharp\r\nignored_paths: [".serena", ".claude", ".playwright"]\r\n- ".serena"\r\n- ".claude"\r\nread_only: false\r\n';
    const root = project({ '.serena/project.yml': broken, 'src/App.csproj': '' });
    const logs = [];
    serena.seedProject({ projectRoot: root, selected: true, log: (m) => logs.push(m) });
    const text = cfgOf(root);
    assert.doesNotMatch(text, /^- /m, 'no column-1 item under a key that holds a value');
    assert.match(text, /^language_servers: \["csharp"\]\r$/m);
    assert.match(text, /^read_only: false\r$/m);
    assert.ok(!/[^\r]\n/.test(text), 'the file keeps its CRLF endings');
    assert.ok(logs.some((l) => /stray list line/.test(l)), logs.join(' | '));
    const once = fs.readFileSync(path.join(root, '.serena', 'project.yml'));
    serena.seedProject({ projectRoot: root, selected: true });
    assert.ok(fs.readFileSync(path.join(root, '.serena', 'project.yml')).equals(once), 'a second run changes nothing');
});

test('repair: block items under an EMPTY key are its value and stay; a nested list stays', () =>
{
    const ok = 'a:\n- x\nb:\n  - y\nc: 1\n';
    assert.deepStrictEqual(serena.repairStrayItems(ok), { text: ok, dropped: 0 });
    assert.strictEqual(serena.repairStrayItems('a: [1]\n- 1\n- 2\nb: 2\n').dropped, 2);
});

test('replace-key: the key and its block items go, the file\'s line ending stays', () =>
{
    const out = serena.replaceKey('a: 1\r\nignored_paths:\r\n- ".serena"\r\n- ".claude"\r\nb: 2\r\n', 'ignored_paths', '[".alfred"]');
    assert.strictEqual(out, 'a: 1\r\nignored_paths: [".alfred"]\r\nb: 2\r\n');
});

// The benchmark pilot (2026-09-26): `.serena/` reached a cell's diff - the Roslyn server's `.mef-composition`
// cache under SERENA_HOME (~100 KB). The whole folder is machine state (CLAUDE.md), so it gets its own
// `.gitignore` of `*`, the way `.playwright/` and a project memory database do. serena writes a narrower one
// when none is there (`/cache` and `/project.local.yml` - src/serena/project.py), which leaves SERENA_HOME out.
const SERENA_OWN = '/cache\n/project.local.yml\n';
const ignoreOf = (root) => path.join(root, '.serena', '.gitignore');

test('ignore: the navigation server gets .serena/.gitignore (*), written once, before serena runs', () =>
{
    const root = project({ 'main.py': '' });
    assert.strictEqual(serena.ensureSerenaIgnore({ projectRoot: root, selected: true }), 'written', 'even with nothing detected - serena still runs');
    assert.strictEqual(fs.readFileSync(ignoreOf(root), 'utf8'), '*\n');
    assert.strictEqual(serena.ensureSerenaIgnore({ projectRoot: root, selected: true }), 'current', 'a re-run changes nothing');
    const none = project();
    assert.strictEqual(serena.ensureSerenaIgnore({ projectRoot: none, selected: false }), 'skipped', 'no navigation server, nothing written');
    assert.ok(!fs.existsSync(path.join(none, '.serena')));
});

test('ignore: serena\'s own narrow file is widened, the project\'s own file is never touched', () =>
{
    const root = project({ '.serena/.gitignore': SERENA_OWN });
    assert.strictEqual(serena.ensureSerenaIgnore({ projectRoot: root, selected: true }), 'replaced');
    assert.strictEqual(fs.readFileSync(ignoreOf(root), 'utf8'), '*\n');
    const mine = project({ '.serena/.gitignore': '/cache\n!memories/\n' });
    const logs = [];
    assert.strictEqual(serena.ensureSerenaIgnore({ projectRoot: mine, selected: true, log: (m) => logs.push(m) }), 'kept');
    assert.strictEqual(fs.readFileSync(ignoreOf(mine), 'utf8'), '/cache\n!memories/\n');
    assert.ok(logs.some((m) => /\.serena\/\.gitignore is the project's own/.test(m)), logs.join(' | '));
});

test('ignore: git then ignores everything under .serena, the Roslyn cache included', () =>
{
    const root = project({ '.serena/project.yml': 'project_name: x\n', '.serena/home/roslyn/.mef-composition': 'x' });
    require('node:child_process').execFileSync('git', ['init', '-q'], { cwd: root });
    serena.ensureSerenaIgnore({ projectRoot: root, selected: true });
    assert.strictEqual(require('node:child_process').execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }), '');
});
