'use strict';
// THE DOCS LAYER OF THE NODE SEED - Phase 7, T4.
//
// The versioning seed is the part worth the most care: it decides how every capture's documents
// follow a branch, it is silent when wrong, and it lives in four homes that one table pins
// together. The migration half is absent-only in both directions, which is what keeps an update
// from eating a project's documents.
const test = require('node:test');
// the run-book tests spawn the docs engine (its lint), so the suite takes the hook containment (2.1.5 M5)
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const docs = require('./install/docs.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-docs-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
function project({ domains = {}, files = {}, ignore, commit = [] } = {})
{
    const root = path.join(TMP, `p-${seq++}`);
    fs.mkdirSync(root, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'x@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'x'], { cwd: root });
    for (const [dir, watch] of Object.entries(domains))
    {
        fs.mkdirSync(path.join(root, '.claude', 'docs', dir), { recursive: true });
        if (watch !== null) fs.writeFileSync(path.join(root, '.claude', 'docs', dir, 'watch.json'), watch);
    }
    for (const [rel, body] of Object.entries(files))
    {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), body);
    }
    if (ignore) fs.writeFileSync(path.join(root, '.gitignore'), ignore);
    if (commit.length)
    {
        execFileSync('git', ['add', '-f', ...commit], { cwd: root });
        execFileSync('git', ['commit', '-qm', 'docs'], { cwd: root });
    }
    return root;
}

const seed = (root) => docs.docsVersioningSeed({ projectRoot: root, docsPath: '.claude/docs' });
// No run book under the docs root: the run-book step reports nothing.
const NO_RUN_BOOK = { respelled: [], overlays: [], rule: 'none' };

// --- the versioning seed, the four-home rule ------------------------------

test('versioning: a FRESH project with no docs at all seeds git', () =>
{
    // Nothing to have committed and nothing ignored - the safe default, because seeding `local`
    // over docs that are about to be committed hides every section behind an overlay.
    assert.strictEqual(seed(project()), 'git');
});

test('versioning: a domain that is TRACKED seeds git, even beside an untracked one', () =>
{
    const root = project({
        domains: { architecture: null, 'code-style': '{}' },
        files: { '.claude/docs/architecture/ARCHITECTURE.md': '# a\n' },
        commit: ['.claude/docs/architecture/ARCHITECTURE.md'],
    });
    assert.strictEqual(seed(root), 'git');
});

test('versioning: domains that exist and are tracked by NOTHING seed local', () =>
{
    const root = project({ domains: { 'code-style': '{}' }, files: { '.claude/docs/code-style/CODE-STYLE.md': '# s\n' } });
    assert.strictEqual(seed(root), 'local');
});

test('versioning: no domain at all, but git IGNORES the docs root - local', () =>
{
    const root = project({ ignore: '.claude/docs/\n' });
    fs.mkdirSync(path.join(root, '.claude', 'docs'), { recursive: true });
    assert.strictEqual(seed(root), 'local');
});

test('versioning: a WATCH-LESS folder is no domain and casts no vote', () =>
{
    // quality/ is recomputed every run and carries no watch.json by design; a project holding only
    // that is an ordinary shape, not evidence the docs are kept out of git.
    const root = project({ domains: { quality: null }, files: { '.claude/docs/quality/ARCHITECTURE-ASSESSMENT.md': '# q\n' } });
    assert.deepStrictEqual(docs.domains(path.join(root, '.claude', 'docs')), []);
    assert.strictEqual(seed(root), 'git');
});

test('versioning: architecture/ is a domain WITHOUT a watch.json, references/ and history/ never are', () =>
{
    const root = project({ domains: { architecture: null, references: '{}', history: '{}', decisions: '{}' } });
    assert.deepStrictEqual(docs.domains(path.join(root, '.claude', 'docs')), ['architecture', 'decisions']);
});

test('versioning: the probe reads the docs path it is GIVEN, not a hardcoded one', () =>
{
    const root = project();
    fs.mkdirSync(path.join(root, 'documentation', 'code-style'), { recursive: true });
    fs.writeFileSync(path.join(root, 'documentation', 'code-style', 'watch.json'), '{}');
    assert.strictEqual(docs.docsVersioningSeed({ projectRoot: root, docsPath: 'documentation' }), 'local');
    assert.strictEqual(docs.docsVersioningSeed({ projectRoot: root, docsPath: '.claude/docs' }), 'git');
});

test('versioning: the git probes are asked with forward slashes on every platform', () =>
{
    // A backslash pathspec can fail to match, and a false negative seeds `local` over committed
    // docs - the exact silent switch this seed exists to prevent.
    const asked = [];
    docs.docsVersioningSeed({
        projectRoot: 'C:\\repo', docsPath: '.claude\\docs',
        git: { tracked: (d) => { asked.push(d); return false; }, ignored: (r) => { asked.push(r); return false; } },
    });
    for (const a of asked) assert.ok(!a.includes('\\'), `a backslash reached git: ${a}`);
    assert.deepStrictEqual(asked, ['.claude/docs']);
});

// --- the migration, absent-only both ways ---------------------------------

test('migration: a document at the old path MOVES, byte-identical, and its domain is switched on', () =>
{
    const root = project({ files: { '.claude/docs/PROJECT-CODE-STYLE.md': '# style\n\n## naming\n' } });
    const logs = [];
    const out = docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs', log: (m) => logs.push(m) });
    assert.deepStrictEqual(out.moved, ['code-style/CODE-STYLE.md']);
    assert.deepStrictEqual(out.switched, ['code-style']);
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/docs/code-style/CODE-STYLE.md'), 'utf8'), '# style\n\n## naming\n');
    assert.ok(!fs.existsSync(path.join(root, '.claude/docs/PROJECT-CODE-STYLE.md')));
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/docs/code-style/watch.json'), 'utf8'), '{}\n');
    assert.ok(logs.some((m) => /sections predate section ids/.test(m)), 'a doc with headings and no ids was not flagged');
});

test('migration: a file ALREADY at the new path is never overwritten, and the old one stays put', () =>
{
    const root = project({ files: {
        '.claude/docs/PROJECT-CODE-STYLE.md': '# old\n',
        '.claude/docs/code-style/CODE-STYLE.md': '# new\n',
    } });
    const logs = [];
    docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs', log: (m) => logs.push(m) });
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/docs/code-style/CODE-STYLE.md'), 'utf8'), '# new\n');
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/docs/PROJECT-CODE-STYLE.md'), 'utf8'), '# old\n');
    assert.ok(logs.some((m) => /already exists .* nothing overwritten/.test(m)), logs.join(' | '));
});

test('migration: an EXISTING watch.json is never overwritten, a dangling link included', () =>
{
    const root = project({ files: { '.claude/docs/code-style/CODE-STYLE.md': '# s\n' } });
    fs.writeFileSync(path.join(root, '.claude/docs/code-style/watch.json'), '{"src":["app"]}');
    docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs' });
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/docs/code-style/watch.json'), 'utf8'), '{"src":["app"]}');

    const root2 = project({ files: { '.claude/docs/related-projects/RELATED-PROJECTS.md': '# r\n' } });
    fs.symlinkSync(path.join(root2, 'nowhere.json'), path.join(root2, '.claude/docs/related-projects/watch.json'));
    const out = docs.migrateDocsDomains({ projectRoot: root2, docsPath: '.claude/docs' });
    assert.deepStrictEqual(out.switched, [], 'a dangling watch.json symlink was replaced - it is still theirs');
});

test('migration: quality/ and related-context/ are watch-less BY DESIGN and stay that way', () =>
{
    const root = project({ files: {
        '.claude/docs/architecture/ASSESSMENT.md': '# q\n',
        '.claude/docs/related-context/PROJECT-RELATED-CONTEXT.md': '# rc\n',
        '.claude/docs/related-context/sibling-notes.md': '# keep me\n',
    } });
    const out = docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs' });
    assert.ok(!fs.existsSync(path.join(root, '.claude/docs/quality/watch.json')), 'quality/ became a domain');
    assert.ok(!fs.existsSync(path.join(root, '.claude/docs/related-context/watch.json')), 'the drop box became a domain');
    // related-projects/ IS switched on, and the drop box keeps every other paper it holds.
    assert.deepStrictEqual(out.switched, ['related-projects']);
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/docs/related-context/sibling-notes.md'), 'utf8'), '# keep me\n');
});

test('migration: the architecture assessment takes its ARCHITECTURE-ASSESSMENT.md name from both former homes, the newer one winning', () =>
{
    const root = project({ files: {
        '.alfred/docs/quality/ASSESSMENT.md': '# newer\n',
        '.alfred/docs/architecture/ASSESSMENT.md': '# older\n',
        '.alfred/docs/quality/CODE-ASSESSMENT.md': '# code\n',
        '.claude/rules/alfred-architecture.md': RC_RULE('.alfred/docs/quality/ASSESSMENT.md'),
    } });
    const logs = [];
    const run = () => docs.migrateDocsDomains({ projectRoot: root, docsPath: '.alfred/docs', rules: rulesOf(root), log: (m) => logs.push(m) });
    const out = run();
    const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
    assert.deepStrictEqual(out.moved, ['quality/ARCHITECTURE-ASSESSMENT.md']);
    assert.strictEqual(read('.alfred/docs/quality/ARCHITECTURE-ASSESSMENT.md'), '# newer\n', 'the 2.0.0 home wins over the older one');
    assert.ok(!fs.existsSync(path.join(root, '.alfred/docs/quality/ASSESSMENT.md')));
    assert.strictEqual(read('.alfred/docs/architecture/ASSESSMENT.md'), '# older\n', 'the older copy is left, never overwritten');
    assert.strictEqual(read('.alfred/docs/quality/CODE-ASSESSMENT.md'), '# code\n', 'the code assessment is not this rename');
    assert.ok(logs.some((m) => /architecture[\\/]ASSESSMENT\.md left in place, nothing overwritten/.test(m)), logs.join(' | '));
    assert.match(read('.claude/rules/alfred-architecture.md'), /`\.alfred\/docs\/quality\/ARCHITECTURE-ASSESSMENT\.md`/, 'the pointer rule follows the move');
    assert.deepStrictEqual(run().moved, [], 'a re-run moves nothing');

    const old = project({ files: { '.alfred/docs/architecture/ASSESSMENT.md': '# older\n' } });
    assert.deepStrictEqual(docs.migrateDocsDomains({ projectRoot: old, docsPath: '.alfred/docs' }).moved, ['quality/ARCHITECTURE-ASSESSMENT.md'], 'the pre-2.0.0 home moves straight to the new name');
});

test('migration: a second run moves nothing and switches nothing on', () =>
{
    const root = project({ files: { '.claude/docs/PROJECT-CODE-STYLE.md': '# s\n' } });
    docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs' });
    const again = docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs' });
    assert.deepStrictEqual(again, { moved: [], switched: [], repointed: [], runBook: NO_RUN_BOOK });
});

test('migration: a doc that already carries section ids is switched on WITHOUT the lint note', () =>
{
    const root = project({ files: { '.claude/docs/code-style/CODE-STYLE.md': '## naming <!-- id: s1 -->\n' } });
    const logs = [];
    docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs', log: (m) => logs.push(m) });
    assert.ok(logs.some((m) => /code-style\/ switched on/.test(m)), logs.join(' | '));
    assert.ok(!logs.some((m) => /predate section ids/.test(m)), logs.join(' | '));
});

test('migration: an absent docs root is nothing to do, never a crash', () =>
{
    assert.deepStrictEqual(docs.migrateDocsDomains({ projectRoot: path.join(TMP, 'nope'), docsPath: '.claude/docs' }),
        { moved: [], switched: [], repointed: [], runBook: NO_RUN_BOOK });
});

// 2026-10-10: a 0.2.x project kept the orientation doc loose at the docs root - its pre-folder home - and the data
// move carried it to .alfred/docs/ that way; only its capture moved it, and a capture never re-runs by itself. Its
// always-on pointer rule and the project's AGENTS.md named the loose path, so a bare move would leave them dangling.
const RC_RULE = (p) => `---\ndescription: generated\n---\n\nEverything past awareness lives in the committed \`${p}\`; read it when a task touches a seam.\n`;
const rulesOf = (root) => require('./install/selection.js').generatedRules(root);
const instructionsOf = (root) => require('./install/selection.js').instructionFiles(root);

test('migration: the orientation doc loose at the docs root moves into related-projects/, its pointer rule follows, the project\'s AGENTS.md is named, and a re-run is quiet', () =>
{
    const root = project({ files: {
        '.alfred/docs/PROJECT-RELATED-CONTEXT.md': '# Related projects\n\n## sample-app\n',
        '.alfred/docs/related-context/2026-09-27-handoff.md': '# a sibling paper\n',
        '.claude/rules/alfred-related-context.md': RC_RULE('.alfred/docs/PROJECT-RELATED-CONTEXT.md'),
        '.claude/rules/my-notes.md': RC_RULE('.alfred/docs/PROJECT-RELATED-CONTEXT.md'),
        '.claude/AGENTS.md': 'See `.alfred/docs/PROJECT-RELATED-CONTEXT.md`.\n',
    } });
    const logs = [];
    const run = () => docs.migrateDocsDomains({ projectRoot: root, docsPath: '.alfred/docs', rules: rulesOf(root), instructions: instructionsOf(root), log: (m) => logs.push(m) });
    const out = run();
    const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
    assert.deepStrictEqual(out, { moved: ['related-projects/RELATED-PROJECTS.md'], switched: ['related-projects'], repointed: ['.claude/rules/alfred-related-context.md'], runBook: NO_RUN_BOOK });
    assert.strictEqual(read('.alfred/docs/related-projects/RELATED-PROJECTS.md'), '# Related projects\n\n## sample-app\n');
    assert.ok(!fs.existsSync(path.join(root, '.alfred/docs/PROJECT-RELATED-CONTEXT.md')));
    assert.strictEqual(read('.alfred/docs/related-context/2026-09-27-handoff.md'), '# a sibling paper\n', 'a sibling paper stays');
    assert.strictEqual(read('.claude/rules/alfred-related-context.md'), RC_RULE('.alfred/docs/related-projects/RELATED-PROJECTS.md'));
    assert.strictEqual(read('.claude/rules/my-notes.md'), RC_RULE('.alfred/docs/PROJECT-RELATED-CONTEXT.md'), 'a rule of the project\'s own is never rewritten');
    assert.strictEqual(read('.claude/AGENTS.md'), 'See `.alfred/docs/PROJECT-RELATED-CONTEXT.md`.\n', 'the project\'s AGENTS.md is named, never rewritten');
    assert.ok(logs.includes('  !! .claude/AGENTS.md is yours and names .alfred/docs/PROJECT-RELATED-CONTEXT.md, which moved to .alfred/docs/related-projects/RELATED-PROJECTS.md - re-point it by hand'), logs.join(' | '));
    assert.ok(logs.includes('  docs migration: .claude/rules/alfred-related-context.md - 1 path(s) re-pointed to the moved doc'), logs.join(' | '));
    logs.length = 0;
    assert.deepStrictEqual(run(), { moved: [], switched: [], repointed: [], runBook: NO_RUN_BOOK });
    assert.ok(logs.every((m) => m.startsWith('  !! .claude/AGENTS.md')), `a re-run said more than the AGENTS.md reminder: ${logs.join(' | ')}`);
});

test('migration: both homes present - the folder form wins, the loose one stays and the rule naming it is left', () =>
{
    const root = project({ files: {
        '.alfred/docs/PROJECT-RELATED-CONTEXT.md': '# loose\n',
        '.alfred/docs/related-context/PROJECT-RELATED-CONTEXT.md': '# folder\n',
        '.claude/rules/alfred-related-context.md': RC_RULE('.alfred/docs/PROJECT-RELATED-CONTEXT.md'),
    } });
    const logs = [];
    const out = docs.migrateDocsDomains({ projectRoot: root, docsPath: '.alfred/docs', rules: rulesOf(root), log: (m) => logs.push(m) });
    assert.deepStrictEqual(out.moved, ['related-projects/RELATED-PROJECTS.md']);
    assert.strictEqual(fs.readFileSync(path.join(root, '.alfred/docs/related-projects/RELATED-PROJECTS.md'), 'utf8'), '# folder\n');
    assert.strictEqual(fs.readFileSync(path.join(root, '.alfred/docs/PROJECT-RELATED-CONTEXT.md'), 'utf8'), '# loose\n');
    assert.ok(logs.some((m) => /PROJECT-RELATED-CONTEXT\.md left in place, nothing overwritten/.test(m)), logs.join(' | '));
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/rules/alfred-related-context.md'), 'utf8'), RC_RULE('.alfred/docs/PROJECT-RELATED-CONTEXT.md'), 'the loose file still exists, so its pointer is not dangling');
});

test('migration: a move an earlier run made without re-pointing heals - the code-style rule follows; a path inside a longer one is no hit', () =>
{
    const style = (p) => `---\npaths:\n  - "**/*.ts"\n---\n# Project code style (generated)\n\nFull capture: \`${p}\`.\n`;
    const root = project({ files: {
        '.claude/docs/code-style/CODE-STYLE.md': '## naming <!-- id: s1 -->\n',
        '.claude/rules/project-code-style.md': style('.claude/docs/PROJECT-CODE-STYLE.md') + 'Old copy: `.claude/docs/PROJECT-CODE-STYLE.md.bak`, `x/.claude/docs/PROJECT-CODE-STYLE.md`.\n',
    } });
    const out = docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs/', rules: rulesOf(root) });
    assert.deepStrictEqual(out.repointed, ['.claude/rules/project-code-style.md']);
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/rules/project-code-style.md'), 'utf8'),
        style('.claude/docs/code-style/CODE-STYLE.md') + 'Old copy: `.claude/docs/PROJECT-CODE-STYLE.md.bak`, `x/.claude/docs/PROJECT-CODE-STYLE.md`.\n');
});

// audit 2026-10-10 C23: the 2.2.2 superpowers/ move re-pointed no instruction file - a project's AGENTS.md still named
// `.alfred/docs/superpowers/plans/` and only the model's own grep found it.
test('migration: the superpowers/ move names the project\'s AGENTS.md lines, re-points a generated rule, heals an earlier move, and a re-run is quiet', () =>
{
    const root = project({ files: {
        '.alfred/docs/superpowers/plans/a.md': '# a\n',
        '.alfred/docs/superpowers/specs/s.md': '# s\n',
        '.alfred/docs/plans/old.md': '# kept\n',
        '.claude/rules/alfred-architecture.md': 'Plans: `.alfred/docs/superpowers/plans/`.\n',
        '.claude/AGENTS.md': 'Plans live under `.alfred/docs/superpowers/plans/`\nand `.alfred/docs/superpowers/specs/`; superpowers plans/specs.\nNot ours: `x/.alfred/docs/superpowers/plans/`.\n',
    } });
    const logs = [];
    const run = () => docs.migratePlans({ projectRoot: root, docsPath: '.alfred/docs', rules: rulesOf(root), instructions: instructionsOf(root), log: (m) => logs.push(m) });
    assert.deepStrictEqual(run(), { plans: 'merged', specs: 'moved' });
    const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
    assert.strictEqual(read('.claude/rules/alfred-architecture.md'), 'Plans: `.alfred/docs/plans/`.\n');
    assert.match(read('.claude/AGENTS.md'), /superpowers\/plans/, 'the project\'s AGENTS.md is named, never rewritten');
    for (const entry of ['plans', 'specs'])
        assert.ok(logs.includes(`  !! .claude/AGENTS.md is yours and names .alfred/docs/superpowers/${entry}, which moved to .alfred/docs/${entry} - re-point it by hand`), logs.join(' | '));
    assert.ok(logs.includes('  docs migration (superpowers): .claude/rules/alfred-architecture.md - 1 path(s) re-pointed to the docs root'), logs.join(' | '));
    logs.length = 0;
    assert.deepStrictEqual(run(), {}, 'a re-run moves nothing');
    assert.ok(logs.every((m) => m.startsWith('  !! .claude/AGENTS.md')) && logs.length === 2, `a re-run said more than the AGENTS.md reminder: ${logs.join(' | ')}`);
});

test('migration: a superpowers/ entry still there (a clash kept it) is no stale mention; no docs root is nothing', () =>
{
    const root = project({ files: {
        '.alfred/docs/superpowers/plans/a.md': '# old a\n',
        '.alfred/docs/plans/a.md': '# new a\n',
        '.claude/AGENTS.md': 'Plans: `.alfred/docs/superpowers/plans/`.\n',
    } });
    const logs = [];
    docs.migratePlans({ projectRoot: root, docsPath: '.alfred/docs', rules: rulesOf(root), instructions: instructionsOf(root), log: (m) => logs.push(m) });
    assert.ok(fs.existsSync(path.join(root, '.alfred/docs/superpowers/plans/a.md')), 'the clash stays');
    assert.ok(!logs.some((m) => /AGENTS\.md is yours/.test(m)), `a path that still exists was named stale: ${logs.join(' | ')}`);
    assert.deepStrictEqual(docs.migratePlans({ projectRoot: root, docsPath: '', instructions: instructionsOf(root) }), {});
});

// THE RUN BOOK'S RENAME (the user's ruling of 2026-10-15): `project-capabilities/PROJECT-CAPABILITIES.md` follows its
// capture's name to `project-awareness/PROJECT-AWARENESS.md`, and the generated rule IMPORTS it, so Claude Code loads
// the run book at every session start - read before the session starts, no matter what. Driven through
// migrateDocsDomains, the installer's own entry, then read back: the files, the rule, and the docs engine's own lint.
// 'first': the 2026-09-29 shape, no blank line after the frontmatter (its description named the capture's name of the
// day, which an update re-spells, so the fixture takes today's).
const OLD_POINTER = (root, shape = 'current') => (shape === 'first'
    ? `---\ndescription: Project run book pointer - generated by /capture-project-awareness; edit via a re-run.\n---\nRun book: \`${root}/project-capabilities/PROJECT-CAPABILITIES.md\` - read it before you build, start, log into or hand-check the app.\n`
    : `---\ndescription: Project run book pointer - generated by /capture-project-awareness; edit via a re-run.\n---\n\nRun book: \`${root}/project-capabilities/PROJECT-CAPABILITIES.md\` - read it before you build, start, log into or hand-check the app.\n`);
const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'stack', 'skills', 'capture-project-awareness', 'references', 'run-book-rule.template.md'), 'utf8');
const RUN_BOOK_DOC = 'Captured: main@abc1234, 2026-10-01\n\n# Run book\n\n## Build\n<!-- id: build -->\n<!-- covers: **package.json -->\n- `npm run build` (package.json)\n\n## Start\n<!-- id: start -->\n- `npm start` - see PROJECT-CAPABILITIES#build first\n- Credentials live in: `.alfred/docs/project-capabilities/credentials.local.env`\n';
const RUN_BOOK_WATCH = '{\n  "sourceRoots": ["src"],\n  "entries": [\n    { "kind": "build", "globs": ["**package.json"], "sections": ["PROJECT-CAPABILITIES#build", "project-capabilities/PROJECT-CAPABILITIES.md#start"] }\n  ]\n}\n';
const engineLint = (root, docsPath) => require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'stack', 'hooks', 'docs.js'), 'lint'],
    { cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_DOCS_PATH: docsPath, ALFRED_CODE_DOCS_VERSIONING: '' } });

test('run book: the doc and its watch.json move to project-awareness/, the section ids follow, the capture\'s pointer becomes the import, AGENTS.md is named, a re-run is quiet', () =>
{
    const root = project({ files: {
        'package.json': '{}\n',
        '.alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md': RUN_BOOK_DOC,
        '.alfred/docs/project-capabilities/watch.json': RUN_BOOK_WATCH,
        '.claude/rules/alfred-project-awareness.md': OLD_POINTER('.alfred/docs'),
        '.claude/AGENTS.md': 'Run book: `.alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md`\n',
    } });
    const logs = [];
    const run = () => docs.migrateDocsDomains({ projectRoot: root, docsPath: '.alfred/docs', rules: rulesOf(root), instructions: instructionsOf(root), log: (m) => logs.push(m) });
    const out = run();
    const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
    assert.deepStrictEqual(out.moved, ['project-awareness/PROJECT-AWARENESS.md', 'project-awareness/watch.json']);
    assert.deepStrictEqual(out.repointed, ['.claude/rules/alfred-project-awareness.md']);
    assert.deepStrictEqual(out.runBook, { respelled: ['.alfred/docs/project-awareness/watch.json', '.alfred/docs/project-awareness/PROJECT-AWARENESS.md'], overlays: [], rule: 'refreshed' });
    assert.ok(!fs.existsSync(path.join(root, '.alfred/docs/project-capabilities')), 'the emptied old folder goes');
    assert.strictEqual(read('.alfred/docs/project-awareness/watch.json'), RUN_BOOK_WATCH.replace('PROJECT-CAPABILITIES#build', 'PROJECT-AWARENESS#build').replace('project-capabilities/PROJECT-CAPABILITIES.md#start', 'project-awareness/PROJECT-AWARENESS.md#start'));
    const doc = read('.alfred/docs/project-awareness/PROJECT-AWARENESS.md');
    assert.strictEqual(doc, RUN_BOOK_DOC.replace('see PROJECT-CAPABILITIES#build', 'see PROJECT-AWARENESS#build'), 'only the section ref changes - the credentials line is adoptCredentials\' to re-point');
    // the rule: the template, stamped with the docs root - the import reaches the doc from .claude/rules/
    const rule = read('.claude/rules/alfred-project-awareness.md');
    assert.strictEqual(rule, TEMPLATE.split('__DOC_PATH__').join('.alfred/docs'));
    const imp = /^@(\S+)$/m.exec(rule)[1];
    assert.strictEqual(path.resolve(root, '.claude', 'rules', imp), path.join(root, '.alfred', 'docs', 'project-awareness', 'PROJECT-AWARENESS.md'), 'the import resolves to the moved doc');
    assert.ok(fs.existsSync(path.resolve(root, '.claude', 'rules', imp)));
    assert.ok(logs.includes('  !! .claude/AGENTS.md is yours and names .alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md, which moved to .alfred/docs/project-awareness/PROJECT-AWARENESS.md - re-point it by hand'), logs.join(' | '));
    assert.ok(logs.includes('  docs migration (project awareness): .claude/rules/alfred-project-awareness.md - imports .alfred/docs/project-awareness/PROJECT-AWARENESS.md now, so the run book loads at every session start'), logs.join(' | '));
    assert.strictEqual(read('.claude/AGENTS.md'), 'Run book: `.alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md`\n', 'the project\'s AGENTS.md is never rewritten');
    // the docs engine reads the moved domain: every watch entry names a section that exists
    const lint = engineLint(root, '.alfred/docs');
    assert.doesNotMatch(lint.stdout, /PROBLEM/, lint.stdout);
    // a second run: nothing moves, the rule is current, and only the AGENTS.md reminder is said
    logs.length = 0;
    assert.deepStrictEqual(run(), { moved: [], switched: [], repointed: [], runBook: { respelled: [], overlays: [], rule: 'current' } });
    assert.strictEqual(read('.claude/rules/alfred-project-awareness.md'), rule, 'idempotent');
    assert.ok(logs.every((m) => m.startsWith('  !! .claude/AGENTS.md')), `a re-run said more than the AGENTS.md reminder: ${logs.join(' | ')}`);
});

test('run book: the first pointer shape and a CRLF copy are upgraded; a rule the user changed is named and kept; an absolute docs root imports by its own path', () =>
{
    const first = project({ files: {
        'docs/ai/project-awareness/PROJECT-AWARENESS.md': '# Run book\n',
        '.claude/rules/alfred-project-awareness.md': OLD_POINTER('docs/ai', 'first').replace(/\n/g, '\r\n'),
    } });
    const r1 = docs.migrateDocsDomains({ projectRoot: first, docsPath: 'docs/ai', rules: rulesOf(first) });
    assert.strictEqual(r1.runBook.rule, 'refreshed', 'a doc an earlier run moved, a pointer still naming the old path - repointed, then upgraded');
    assert.strictEqual(fs.readFileSync(path.join(first, '.claude/rules/alfred-project-awareness.md'), 'utf8'), TEMPLATE.split('__DOC_PATH__').join('docs/ai').replace(/\n/g, '\r\n'), 'its line endings kept');

    const own = OLD_POINTER('.alfred/docs').replace('hand-check the app.', 'hand-check the app.\n\nAlso: the staging login is in 1Password.');
    const yours = project({ files: {
        '.alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md': '# Run book\n',
        '.claude/rules/alfred-project-awareness.md': own,
    } });
    const logs = [];
    const r2 = docs.migrateDocsDomains({ projectRoot: yours, docsPath: '.alfred/docs', rules: rulesOf(yours), log: (m) => logs.push(m) });
    assert.strictEqual(r2.runBook.rule, 'yours');
    assert.strictEqual(fs.readFileSync(path.join(yours, '.claude/rules/alfred-project-awareness.md'), 'utf8'), own.replace('project-capabilities/PROJECT-CAPABILITIES.md', 'project-awareness/PROJECT-AWARENESS.md'), 're-pointed like any generated rule, never rewritten');
    assert.ok(logs.some((m) => m === '  !! .claude/rules/alfred-project-awareness.md is not the capture\'s own text, so it was not rewritten - re-run /capture-project-awareness to have the run book load at every session start'), logs.join(' | '));

    const abs = path.join(TMP, `abs-docs-${seq++}`);
    const outside = project({ files: { '.claude/rules/alfred-project-awareness.md': OLD_POINTER(abs.split(path.sep).join('/')) } });
    fs.mkdirSync(path.join(abs, 'project-awareness'), { recursive: true });
    fs.writeFileSync(path.join(abs, 'project-awareness', 'PROJECT-AWARENESS.md'), '# Run book\n');
    docs.migrateDocsDomains({ projectRoot: outside, docsPath: abs, rules: rulesOf(outside) });
    const rule = fs.readFileSync(path.join(outside, '.claude/rules/alfred-project-awareness.md'), 'utf8');
    assert.ok(rule.includes(`\n@${abs.split(path.sep).join('/')}/project-awareness/PROJECT-AWARENESS.md\n`), rule);
});

test('run book: both homes present moves nothing; branch versions move with the doc; a credentials file keeps the old folder', () =>
{
    const both = project({ files: {
        '.alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md': '# old\n',
        '.alfred/docs/project-awareness/PROJECT-AWARENESS.md': '# new\n',
        '.claude/rules/alfred-project-awareness.md': OLD_POINTER('.alfred/docs'),
    } });
    const logs = [];
    const r = docs.migrateDocsDomains({ projectRoot: both, docsPath: '.alfred/docs', rules: rulesOf(both), log: (m) => logs.push(m) });
    assert.deepStrictEqual(r.runBook, NO_RUN_BOOK, 'nothing is judged until one home is left');
    assert.strictEqual(fs.readFileSync(path.join(both, '.alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md'), 'utf8'), '# old\n');
    assert.strictEqual(fs.readFileSync(path.join(both, '.claude/rules/alfred-project-awareness.md'), 'utf8'), OLD_POINTER('.alfred/docs'));
    assert.ok(logs.some((m) => /docs migration \(project awareness\): .*already exists - .* left in place, nothing overwritten/.test(m)), logs.join(' | '));

    const branched = project({ files: {
        '.alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md': RUN_BOOK_DOC,
        '.alfred/docs/project-capabilities/watch.json': RUN_BOOK_WATCH,
        '.alfred/docs/project-capabilities/credentials.local.env': 'ADMIN_PASSWORD=x\n',
        '.alfred/docs/.branches/feat-a/project-capabilities/PROJECT-CAPABILITIES/build.md': '## Build\n- branch text\n',
        '.alfred/docs/.branches/feat-a/.base/project-capabilities/PROJECT-CAPABILITIES/build.md': '## Build\n- base text\n',
        '.alfred/docs/.branches/feat-b/project-awareness/PROJECT-AWARENESS/start.md': '## Start\n',
        '.alfred/docs/.branches/feat-b/project-capabilities/PROJECT-CAPABILITIES/start.md': '## Start\n- older\n',
        '.alfred/docs/.branches/feat-b/project-awareness/PROJECT-AWARENESS/.keep': '',
    } });
    fs.rmSync(path.join(branched, '.alfred/docs/.branches/feat-b/project-awareness/PROJECT-AWARENESS/.keep'));
    const blogs = [];
    const out = docs.migrateDocsDomains({ projectRoot: branched, docsPath: '.alfred/docs', rules: rulesOf(branched), log: (m) => blogs.push(m) });
    const at = (rel) => path.join(branched, '.alfred/docs', rel);
    assert.deepStrictEqual(out.runBook.overlays, ['.branches/feat-a/project-awareness/PROJECT-AWARENESS', '.branches/feat-a/.base/project-awareness/PROJECT-AWARENESS']);
    assert.strictEqual(fs.readFileSync(at('.branches/feat-a/project-awareness/PROJECT-AWARENESS/build.md'), 'utf8'), '## Build\n- branch text\n');
    assert.strictEqual(fs.readFileSync(at('.branches/feat-a/.base/project-awareness/PROJECT-AWARENESS/build.md'), 'utf8'), '## Build\n- base text\n');
    assert.ok(!fs.existsSync(at('.branches/feat-a/project-capabilities')), 'the emptied branch folder goes');
    assert.ok(fs.existsSync(at('.branches/feat-b/project-capabilities/PROJECT-CAPABILITIES/start.md')), 'a branch already holding the new folder keeps the old one');
    assert.ok(blogs.some((m) => /!! docs migration \(project awareness\): \.branches\/feat-b\/project-awareness\/PROJECT-AWARENESS\/ already exists/.test(m)), blogs.join(' | '));
    assert.ok(fs.existsSync(at('project-capabilities/credentials.local.env')), 'the credentials file stays where adoptCredentials and the ignore line expect it');
    assert.deepStrictEqual(out.runBook.rule, 'none', 'no rule, nothing to upgrade');
});

test('run book: a docs-root move re-stamps the import line too, relative or absolute', () =>
{
    const { respellDocsRoot } = require('./install/selection.js');
    const root = project({ files: { '.claude/rules/alfred-project-awareness.md': TEMPLATE.split('__DOC_PATH__').join('.claude/docs') } });
    assert.strictEqual(respellDocsRoot({ projectRoot: root, from: '.claude/docs', to: '.alfred/docs' }), 1);
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/rules/alfred-project-awareness.md'), 'utf8'), TEMPLATE.split('__DOC_PATH__').join('.alfred/docs'));
    assert.strictEqual(respellDocsRoot({ projectRoot: root, from: '.alfred/docs', to: '/srv/docs' }), 1);
    const text = fs.readFileSync(path.join(root, '.claude/rules/alfred-project-awareness.md'), 'utf8');
    assert.match(text, /^@\/srv\/docs\/project-awareness\/PROJECT-AWARENESS\.md$/m);
    assert.match(text, /`\/srv\/docs\/project-awareness\/PROJECT-AWARENESS\.md`/);
});
