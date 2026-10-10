'use strict';
// THE DOCS LAYER OF THE NODE SEED - Phase 7, T4.
//
// The versioning seed is the part worth the most care: it decides how every capture's documents
// follow a branch, it is silent when wrong, and it lives in four homes that one table pins
// together. The migration half is absent-only in both directions, which is what keeps an update
// from eating a project's documents.
const test = require('node:test');
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
    const root = project({ domains: { quality: null }, files: { '.claude/docs/quality/ASSESSMENT.md': '# q\n' } });
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

test('migration: a second run moves nothing and switches nothing on', () =>
{
    const root = project({ files: { '.claude/docs/PROJECT-CODE-STYLE.md': '# s\n' } });
    docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs' });
    const again = docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs' });
    assert.deepStrictEqual(again, { moved: [], switched: [], repointed: [] });
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
        { moved: [], switched: [], repointed: [] });
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
        '.claude/rules/alfred-project-related-context.md': RC_RULE('.alfred/docs/PROJECT-RELATED-CONTEXT.md'),
        '.claude/rules/my-notes.md': RC_RULE('.alfred/docs/PROJECT-RELATED-CONTEXT.md'),
        '.claude/AGENTS.md': 'See `.alfred/docs/PROJECT-RELATED-CONTEXT.md`.\n',
    } });
    const logs = [];
    const run = () => docs.migrateDocsDomains({ projectRoot: root, docsPath: '.alfred/docs', rules: rulesOf(root), instructions: instructionsOf(root), log: (m) => logs.push(m) });
    const out = run();
    const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
    assert.deepStrictEqual(out, { moved: ['related-projects/RELATED-PROJECTS.md'], switched: ['related-projects'], repointed: ['.claude/rules/alfred-project-related-context.md'] });
    assert.strictEqual(read('.alfred/docs/related-projects/RELATED-PROJECTS.md'), '# Related projects\n\n## sample-app\n');
    assert.ok(!fs.existsSync(path.join(root, '.alfred/docs/PROJECT-RELATED-CONTEXT.md')));
    assert.strictEqual(read('.alfred/docs/related-context/2026-09-27-handoff.md'), '# a sibling paper\n', 'a sibling paper stays');
    assert.strictEqual(read('.claude/rules/alfred-project-related-context.md'), RC_RULE('.alfred/docs/related-projects/RELATED-PROJECTS.md'));
    assert.strictEqual(read('.claude/rules/my-notes.md'), RC_RULE('.alfred/docs/PROJECT-RELATED-CONTEXT.md'), 'a rule of the project\'s own is never rewritten');
    assert.strictEqual(read('.claude/AGENTS.md'), 'See `.alfred/docs/PROJECT-RELATED-CONTEXT.md`.\n', 'the project\'s AGENTS.md is named, never rewritten');
    assert.ok(logs.includes('  !! .claude/AGENTS.md is yours and names .alfred/docs/PROJECT-RELATED-CONTEXT.md, which moved to .alfred/docs/related-projects/RELATED-PROJECTS.md - re-point it by hand'), logs.join(' | '));
    assert.ok(logs.includes('  docs migration: .claude/rules/alfred-project-related-context.md - 1 path(s) re-pointed to the moved doc'), logs.join(' | '));
    logs.length = 0;
    assert.deepStrictEqual(run(), { moved: [], switched: [], repointed: [] });
    assert.ok(logs.every((m) => m.startsWith('  !! .claude/AGENTS.md')), `a re-run said more than the AGENTS.md reminder: ${logs.join(' | ')}`);
});

test('migration: both homes present - the folder form wins, the loose one stays and the rule naming it is left', () =>
{
    const root = project({ files: {
        '.alfred/docs/PROJECT-RELATED-CONTEXT.md': '# loose\n',
        '.alfred/docs/related-context/PROJECT-RELATED-CONTEXT.md': '# folder\n',
        '.claude/rules/alfred-project-related-context.md': RC_RULE('.alfred/docs/PROJECT-RELATED-CONTEXT.md'),
    } });
    const logs = [];
    const out = docs.migrateDocsDomains({ projectRoot: root, docsPath: '.alfred/docs', rules: rulesOf(root), log: (m) => logs.push(m) });
    assert.deepStrictEqual(out.moved, ['related-projects/RELATED-PROJECTS.md']);
    assert.strictEqual(fs.readFileSync(path.join(root, '.alfred/docs/related-projects/RELATED-PROJECTS.md'), 'utf8'), '# folder\n');
    assert.strictEqual(fs.readFileSync(path.join(root, '.alfred/docs/PROJECT-RELATED-CONTEXT.md'), 'utf8'), '# loose\n');
    assert.ok(logs.some((m) => /PROJECT-RELATED-CONTEXT\.md left in place, nothing overwritten/.test(m)), logs.join(' | '));
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/rules/alfred-project-related-context.md'), 'utf8'), RC_RULE('.alfred/docs/PROJECT-RELATED-CONTEXT.md'), 'the loose file still exists, so its pointer is not dangling');
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
        '.claude/rules/alfred-project-architecture.md': 'Plans: `.alfred/docs/superpowers/plans/`.\n',
        '.claude/AGENTS.md': 'Plans live under `.alfred/docs/superpowers/plans/`\nand `.alfred/docs/superpowers/specs/`; superpowers plans/specs.\nNot ours: `x/.alfred/docs/superpowers/plans/`.\n',
    } });
    const logs = [];
    const run = () => docs.migratePlans({ projectRoot: root, docsPath: '.alfred/docs', rules: rulesOf(root), instructions: instructionsOf(root), log: (m) => logs.push(m) });
    assert.deepStrictEqual(run(), { plans: 'merged', specs: 'moved' });
    const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
    assert.strictEqual(read('.claude/rules/alfred-project-architecture.md'), 'Plans: `.alfred/docs/plans/`.\n');
    assert.match(read('.claude/AGENTS.md'), /superpowers\/plans/, 'the project\'s AGENTS.md is named, never rewritten');
    for (const entry of ['plans', 'specs'])
        assert.ok(logs.includes(`  !! .claude/AGENTS.md is yours and names .alfred/docs/superpowers/${entry}, which moved to .alfred/docs/${entry} - re-point it by hand`), logs.join(' | '));
    assert.ok(logs.includes('  docs migration (superpowers): .claude/rules/alfred-project-architecture.md - 1 path(s) re-pointed to the docs root'), logs.join(' | '));
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
