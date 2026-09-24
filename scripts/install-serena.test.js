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
    assert.match(text, /# Added by alfred-code: .serena holds/);
    assert.strictEqual((text.match(/^ignored_paths:/gm) || []).length, 1);
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
