'use strict';
// capture-awareness' state mode (spec 2026-10-29 1.3 step 1): `awareness-state.js --state` prints one line per part in
// the router table's order - project, related-projects, project-code-style, architecture, agents - for the chain ask.
// A part's docs are its Writes column; a doc is absent, unstamped, current or stale, and stale is the docs engine's
// own drift signal (`docs.js stale`), never a commit alone. The worst of a part's docs is its state.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'stack', 'skills', 'capture-awareness', 'scripts', 'awareness-state.js');
const HOOKS = path.join(ROOT, 'stack', 'hooks');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'awareness-state-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^ALFRED_CODE_|^CLAUDE_PROJECT_DIR$|^GIT_/.test(k)));
ENV.CLAUDE_CONFIG_DIR = path.join(TMP, 'account');
ENV.GIT_CEILING_DIRECTORIES = TMP;

const AW = '.alfred/docs/awareness';
const PARTS = ['project', 'related-projects', 'project-code-style', 'architecture', 'agents'];

let seq = 0;
const git = (root, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: root, env: ENV, encoding: 'utf8' }).trim();
const put = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
function repo({ engine = true } = {})
{
    const root = path.join(TMP, `r-${seq++}`);
    fs.mkdirSync(root, { recursive: true });
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.email', 'x@example.invalid');
    git(root, 'config', 'user.name', 'x');
    put(root, '.gitignore', '.alfred/\n.claude/\n');
    put(root, 'src/a.js', 'a\n');
    put(root, 'README.md', '# x\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'code');
    if (engine) for (const f of ['docs.js', 'layout.js']) put(root, `.claude/hooks/${f}`, fs.readFileSync(path.join(HOOKS, f), 'utf8'));
    put(root, `${AW}/watch.json`, '{}');
    return root;
}
const head = (root) => git(root, 'rev-parse', '--short', 'HEAD');
// A doc in the capture's shape: the top stamp, then one section covering `covers` with the engine's own section stamp.
const doc = (root, title, covers = 'src/**') => `Captured: main@${head(root)}, 2026-10-30\n\n# ${title}\n\n## part\n<!-- id: part -->\n<!-- covers: ${covers} -->\n<!-- captured: ${head(root)} -->\nText.\n`;
const state = (root) => execFileSync(process.execPath, [SCRIPT, '--state'], { cwd: root, env: ENV, encoding: 'utf8' });
const lines = (root) => Object.fromEntries(state(root).trimEnd().split('\n').map((l) => { const i = l.indexOf(': '); return [l.slice(0, i), l.slice(i + 2)]; }));
const allProject = (root) =>
{
    for (const name of ['PROJECT-INFO-AWARENESS', 'RUN-AND-DEBUG-AWARENESS', 'RESOURCES-AWARENESS']) put(root, `${AW}/${name}.md`, doc(root, name));
};

test('five lines in the router table\'s order, agents last and always run, exit 0', () =>
{
    const root = repo();
    const out = state(root).trimEnd().split('\n');
    assert.deepStrictEqual(out.map((l) => l.split(': ')[0]), PARTS);
    assert.strictEqual(out[4], 'agents: run');
});

test('every part absent with no docs, the doc named', () =>
{
    const s = lines(repo());
    assert.strictEqual(s.project, 'absent (no PROJECT-INFO-AWARENESS.md)');
    assert.strictEqual(s['related-projects'], 'absent (no RELATED-PROJECTS-AWARENESS.md)');
    assert.strictEqual(s['project-code-style'], 'absent (no PROJECT-CODE-PREFERENCES.md)');
    assert.strictEqual(s.architecture, 'absent (no ARCHITECTURE-AWARENESS.md)');
});

test('a doc with no Captured: line, and an unreadable one, are unstamped', () =>
{
    const root = repo();
    put(root, `${AW}/RELATED-PROJECTS-AWARENESS.md`, '# Related\n\nno stamp\n');
    fs.mkdirSync(path.join(root, AW, 'ARCHITECTURE-AWARENESS.md'), { recursive: true });
    const s = lines(root);
    // the engine itself fails on a folder in a doc's place: the stamps are still read, only the stale signal is lost
    assert.strictEqual(s['related-projects'], 'unstamped (RELATED-PROJECTS-AWARENESS.md) (docs engine failed)');
    assert.strictEqual(s.architecture, 'unstamped (ARCHITECTURE-AWARENESS.md) (docs engine failed)');
    fs.rmSync(path.join(root, AW, 'ARCHITECTURE-AWARENESS.md'), { recursive: true });
    assert.strictEqual(lines(root)['related-projects'], 'unstamped (RELATED-PROJECTS-AWARENESS.md)');
});

test('stamped docs the engine names no section of are current, after a commit that touches no covered file too', () =>
{
    const root = repo();
    allProject(root);
    put(root, `${AW}/RELATED-PROJECTS-AWARENESS.md`, doc(root, 'Related'));
    put(root, '.alfred/docs/preferences/watch.json', '{}');
    put(root, '.alfred/docs/preferences/PROJECT-CODE-PREFERENCES.md', doc(root, 'Style'));
    put(root, `${AW}/ARCHITECTURE-AWARENESS.md`, doc(root, 'Architecture'));
    const at = `main@${head(root)}`;
    put(root, 'docs/notes.txt', 'n\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'no covered file');
    const s = lines(root);
    for (const part of PARTS.slice(0, 4)) assert.strictEqual(s[part], `current ${at}`, part);
});

test('one stale section makes its part stale, the why counting the sections', () =>
{
    const root = repo();
    allProject(root);
    put(root, `${AW}/RELATED-PROJECTS-AWARENESS.md`, doc(root, 'Related', 'README.md'));
    put(root, '.alfred/docs/preferences/watch.json', '{}');
    put(root, '.alfred/docs/preferences/PROJECT-CODE-PREFERENCES.md', doc(root, 'Style', 'README.md'));
    put(root, `${AW}/ARCHITECTURE-AWARENESS.md`, doc(root, 'Architecture', 'README.md'));
    const at = `main@${head(root)}`;
    put(root, 'src/a.js', 'b\n');
    git(root, 'commit', '-qam', 'covered change');
    const s = lines(root);
    assert.strictEqual(s.project, `stale ${at} (3 sections stale in PROJECT-INFO-AWARENESS.md, RUN-AND-DEBUG-AWARENESS.md, RESOURCES-AWARENESS.md)`);
    for (const part of ['related-projects', 'project-code-style', 'architecture']) assert.strictEqual(s[part], `current ${at}`, part);
    put(root, 'README.md', '# y\n');
    git(root, 'commit', '-qam', 'readme');
    const t = lines(root);
    for (const part of ['related-projects', 'project-code-style', 'architecture']) assert.strictEqual(t[part], `stale ${at} (1 sections stale)`, part);
});

test('a reference under the map home is the architecture part\'s section', () =>
{
    const root = repo();
    put(root, `${AW}/ARCHITECTURE-AWARENESS.md`, doc(root, 'Architecture', 'README.md'));
    put(root, `${AW}/references/api.md`, doc(root, 'Api'));
    const at = `main@${head(root)}`;
    put(root, 'src/a.js', 'b\n');
    git(root, 'commit', '-qam', 'covered change');
    assert.strictEqual(lines(root).architecture, `stale ${at} (1 sections stale)`);
});

test('the project part is the worst of its three docs, naming the doc', () =>
{
    const root = repo();
    put(root, `${AW}/RUN-AND-DEBUG-AWARENESS.md`, doc(root, 'Run book'));
    assert.strictEqual(lines(root).project, 'absent (no PROJECT-INFO-AWARENESS.md)');
    put(root, `${AW}/PROJECT-INFO-AWARENESS.md`, doc(root, 'Info'));
    put(root, `${AW}/RESOURCES-AWARENESS.md`, '# Resources\n');
    assert.strictEqual(lines(root).project, 'unstamped (RESOURCES-AWARENESS.md)');
});

test('the run book is found under either name', () =>
{
    const root = repo();
    put(root, `${AW}/PROJECT-INFO-AWARENESS.md`, doc(root, 'Info'));
    put(root, `${AW}/RESOURCES-AWARENESS.md`, doc(root, 'Resources'));
    assert.strictEqual(lines(root).project, 'absent (no RUN-AND-DEBUG-AWARENESS.md)', 'neither: the new name is the one missing');
    put(root, `${AW}/PROJECT-AWARENESS.md`, doc(root, 'Run book'));
    assert.strictEqual(lines(root).project, `current main@${head(root)}`, 'the 3.3.0 name alone is the run book');
    put(root, `${AW}/RUN-AND-DEBUG-AWARENESS.md`, '# no stamp\n');
    assert.strictEqual(lines(root).project, 'unstamped (RUN-AND-DEBUG-AWARENESS.md)', 'both: the new name wins');
});

test('the map is read at its home: the old one before the move, and a provisional ORIENTATION alone is absent', () =>
{
    const root = repo();
    put(root, '.alfred/docs/architecture/ORIENTATION.md', '> provisional - replaced by the architecture capture\n');
    assert.strictEqual(lines(root).architecture, 'absent (no ARCHITECTURE.md)');
    put(root, '.alfred/docs/architecture/ARCHITECTURE.md', doc(root, 'Architecture'));
    assert.strictEqual(lines(root).architecture, `current main@${head(root)}`);
    put(root, `${AW}/ARCHITECTURE-ORIENTATION-AWARENESS.md`, 'block\n');
    assert.strictEqual(lines(root).architecture, 'absent (no ARCHITECTURE-AWARENESS.md)', 'the new home holds the block: the map is read there');
});

test('no docs engine: presence alone, each part line ending (no docs engine)', () =>
{
    const root = repo({ engine: false });
    put(root, `${AW}/RELATED-PROJECTS-AWARENESS.md`, doc(root, 'Related'));
    put(root, `${AW}/ARCHITECTURE-AWARENESS.md`, '# no stamp\n');
    put(root, 'src/a.js', 'b\n');
    git(root, 'commit', '-qam', 'covered change');
    const s = lines(root);
    for (const part of PARTS.slice(0, 4)) assert.match(s[part], /\(no docs engine\)$/, part);
    assert.match(s['related-projects'], /^current main@[0-9a-f]+ \(no docs engine\)$/);
    assert.strictEqual(s.architecture, 'current (no docs engine)');
    assert.strictEqual(s.project, 'absent (no docs engine)');
    assert.strictEqual(s.agents, 'run');
});

test('RUN_BOOK_NAMES and runBookOf: the first that exists, else the first', () =>
{
    const { RUN_BOOK_NAMES, runBookOf } = require(SCRIPT);
    assert.deepStrictEqual(RUN_BOOK_NAMES, ['RUN-AND-DEBUG-AWARENESS.md', 'PROJECT-AWARENESS.md']);
    const root = repo();
    const docs = path.join(root, '.alfred/docs');
    assert.strictEqual(runBookOf(docs), 'RUN-AND-DEBUG-AWARENESS.md');
    put(root, `${AW}/PROJECT-AWARENESS.md`, 'x');
    assert.strictEqual(runBookOf(docs), 'PROJECT-AWARENESS.md');
    put(root, `${AW}/RUN-AND-DEBUG-AWARENESS.md`, 'x');
    assert.strictEqual(runBookOf(docs), 'RUN-AND-DEBUG-AWARENESS.md');
});

// Spec 2026-10-29 section 3: the skill script keeps its own two-name list (a skill copy cannot count on the hooks folder),
// held here to layout.runBookKey over runBookKey's own five states.
test('the two-name list is runBookKey\'s', () =>
{
    const { runBookOf } = require(SCRIPT);
    const layout = require(path.join(HOOKS, 'layout.js'));
    const states = [['RUN-AND-DEBUG-AWARENESS'], ['PROJECT-AWARENESS'], ['RUN-AND-DEBUG-AWARENESS', 'PROJECT-AWARENESS'], [], ['PROJECT-INFO-AWARENESS']];
    for (const files of states)
    {
        const dir = path.join(TMP, `runbook-${seq++}`);
        for (const f of files) put(dir, `awareness/${f}.md`, 'x');
        assert.strictEqual(runBookOf(dir), `${layout.runBookKey(dir)}.md`, `with ${files.join(' + ') || 'neither'}`);
    }
});
