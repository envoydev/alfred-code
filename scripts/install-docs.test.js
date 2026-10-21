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
// No awareness doc under the docs root: the awareness step moves nothing and writes no rule.
const NO_AWARENESS = { respelled: [], overlays: [], agents: 'none', rule: 'not written - no awareness doc yet' };
// Every project's first run seeds the git doc (the preferences layout, 2026-10-21); a later run finds it there.
const PREFS_RESULT = (git) => ({ respelled: [], overlays: [], watch: 'none', git, rule: 'none' });

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

// 2026-10-21: every install seeds preferences/GIT-PREFERENCES.md, so the next run found an untracked domain on a fresh
// project and read its docs as kept out of git - a local install moved to project scope then kept its 'git' seed as
// the user's value. The stack's own seed is no evidence; a preferences doc the project wrote beside it is.
test('versioning: a preferences domain holding only the seeded git doc casts no vote', () =>
{
    const root = project({ domains: { preferences: '{}' }, files: { '.claude/docs/preferences/GIT-PREFERENCES.md': '# g\n' } });
    assert.strictEqual(seed(root), 'git');
    fs.writeFileSync(path.join(root, '.claude', 'docs', 'preferences', 'PERSONAL-CODE-PREFERENCES.md'), '# c\n');
    assert.strictEqual(seed(root), 'local', 'a doc the project wrote, tracked by nothing');
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
    assert.deepStrictEqual(out.moved, ['code-style/CODE-STYLE.md', 'preferences/PROJECT-CODE-PREFERENCES.md'], 'two hops in one run');
    assert.deepStrictEqual(out.switched, ['preferences']);
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/docs/preferences/PROJECT-CODE-PREFERENCES.md'), 'utf8'), '# style\n\n## naming\n');
    assert.ok(!fs.existsSync(path.join(root, '.claude/docs/PROJECT-CODE-STYLE.md')));
    assert.ok(!fs.existsSync(path.join(root, '.claude/docs/code-style')), 'the passing folder is gone');
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/docs/preferences/watch.json'), 'utf8'), '{}\n');
    assert.ok(logs.some((m) => /PROJECT-CODE-PREFERENCES\.md predates section ids/.test(m)), `a doc with headings and no ids was not flagged: ${logs.join(' | ')}`);
});

test('migration: a file ALREADY at the new path is never overwritten, and the old one stays put', () =>
{
    const root = project({ files: {
        '.claude/docs/PROJECT-CODE-STYLE.md': '# old\n',
        '.claude/docs/preferences/PROJECT-CODE-PREFERENCES.md': '# new\n',
    } });
    const logs = [];
    docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs', log: (m) => logs.push(m) });
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/docs/preferences/PROJECT-CODE-PREFERENCES.md'), 'utf8'), '# new\n');
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/docs/PROJECT-CODE-STYLE.md'), 'utf8'), '# old\n');
    assert.ok(logs.some((m) => /already exists .* nothing overwritten/.test(m)), logs.join(' | '));
});

test('migration: an EXISTING watch.json is never overwritten, a dangling link included', () =>
{
    const root = project({ files: { '.claude/docs/preferences/PROJECT-CODE-PREFERENCES.md': '# s\n' } });
    fs.writeFileSync(path.join(root, '.claude/docs/preferences/watch.json'), '{"src":["app"]}');
    docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs' });
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/docs/preferences/watch.json'), 'utf8'), '{"src":["app"]}');

    const root2 = project({ files: { '.claude/docs/preferences/PROJECT-CODE-PREFERENCES.md': '# r\n' } });
    fs.symlinkSync(path.join(root2, 'nowhere.json'), path.join(root2, '.claude/docs/preferences/watch.json'));
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
    // The orientation doc moves on to awareness/, a docs domain from there; the drop box keeps every other paper it holds.
    assert.deepStrictEqual(out.switched, ['preferences'], 'only the seeded git doc\'s domain');
    assert.deepStrictEqual(out.moved, ['quality/ARCHITECTURE-ASSESSMENT.md', 'related-projects/RELATED-PROJECTS.md', 'awareness/RELATED-PROJECTS-AWARENESS.md']);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, '.claude/docs/awareness/watch.json'), 'utf8')), { notOwned: ['AGENTS-AWARENESS.md'] }, 'the doc sits in a domain the engine sections');
    assert.ok(!fs.existsSync(path.join(root, '.claude/docs/related-projects')), 'the passing folder is gone');
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
    assert.deepStrictEqual(again, { moved: [], switched: [], repointed: [], awareness: NO_AWARENESS, preferences: PREFS_RESULT('present') });
});

test('migration: a doc that already carries section ids is switched on WITHOUT the lint note', () =>
{
    const root = project({ files: { '.claude/docs/preferences/PROJECT-CODE-PREFERENCES.md': '## naming <!-- id: s1 -->\n' } });
    fs.mkdirSync(path.join(root, '.claude/docs/preferences/GIT-PREFERENCES.md'));
    const logs = [];
    docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs', log: (m) => logs.push(m) });
    assert.ok(logs.some((m) => /preferences\/ switched on/.test(m)), logs.join(' | '));
    assert.ok(!logs.some((m) => /predate section ids/.test(m)), logs.join(' | '));
});

test('migration: an absent docs root is nothing to do, never a crash', () =>
{
    assert.deepStrictEqual(docs.migrateDocsDomains({ projectRoot: path.join(TMP, 'nope'), docsPath: '.claude/docs' }),
        { moved: [], switched: [], repointed: [], awareness: NO_AWARENESS, preferences: PREFS_RESULT('none') });
});

// 2026-10-10: a 0.2.x project kept the orientation doc loose at the docs root - its pre-folder home - and the data
// move carried it to .alfred/docs/ that way; only its capture moved it, and a capture never re-runs by itself. Its
// always-on pointer rule and the project's AGENTS.md named the loose path, so a bare move would leave them dangling.
const RC_RULE = (p) => `---\ndescription: generated\n---\n\nEverything past awareness lives in the committed \`${p}\`; read it when a task touches a seam.\n`;
const rulesOf = (root) => require('./install/selection.js').generatedRules(root);
const instructionsOf = (root) => require('./install/selection.js').instructionFiles(root);

test('migration: the orientation doc loose at the docs root moves on to awareness/, its pointer rule follows, the project\'s AGENTS.md is named, and a re-run is quiet', () =>
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
    assert.deepStrictEqual({ ...out, awareness: { ...out.awareness, rule: out.awareness.rule.replace(/\d+ bytes/, 'N bytes') } }, {
        moved: ['related-projects/RELATED-PROJECTS.md', 'awareness/RELATED-PROJECTS-AWARENESS.md'], switched: ['preferences'], repointed: ['.claude/rules/alfred-related-context.md'],
        awareness: { respelled: [], overlays: [], agents: 'none', rule: 'created - .claude/rules/alfred-awareness.md, N bytes, imports 1' },
        preferences: PREFS_RESULT('seeded'),
    }, 'two hops in one run, and the one rule imports the doc');
    assert.strictEqual(read('.alfred/docs/awareness/RELATED-PROJECTS-AWARENESS.md'), '# Related projects\n\n## sample-app\n');
    assert.ok(!fs.existsSync(path.join(root, '.alfred/docs/PROJECT-RELATED-CONTEXT.md')));
    assert.strictEqual(read('.alfred/docs/related-context/2026-09-27-handoff.md'), '# a sibling paper\n', 'a sibling paper stays');
    assert.strictEqual(read('.claude/rules/alfred-related-context.md'), RC_RULE('.alfred/docs/awareness/RELATED-PROJECTS-AWARENESS.md'), 're-pointed to the last home; the rule is not the capture\'s own text, so it is kept');
    assert.strictEqual(read('.claude/rules/my-notes.md'), RC_RULE('.alfred/docs/PROJECT-RELATED-CONTEXT.md'), 'a rule of the project\'s own is never rewritten');
    assert.strictEqual(read('.claude/AGENTS.md'), 'See `.alfred/docs/PROJECT-RELATED-CONTEXT.md`.\n', 'the project\'s AGENTS.md is named, never rewritten');
    assert.ok(logs.includes('  !! .claude/AGENTS.md is yours and names .alfred/docs/PROJECT-RELATED-CONTEXT.md, which moved to .alfred/docs/awareness/RELATED-PROJECTS-AWARENESS.md - re-point it by hand'), logs.join(' | '));
    assert.ok(logs.some((m) => /^ {2}!! awareness: removed - kept \.claude\/rules\/alfred-related-context\.md - it is not the capture's own text/.test(m)), logs.join(' | '));
    assert.ok(logs.includes('  docs migration: .claude/rules/alfred-related-context.md - 1 path(s) re-pointed to the moved doc'), logs.join(' | '));
    logs.length = 0;
    const again = run();
    assert.deepStrictEqual([again.moved, again.repointed, again.awareness.respelled], [[], [], []]);
    assert.match(again.awareness.rule, /^unchanged, not rewritten - /);
    assert.ok(logs.every((m) => m.startsWith('  !! .claude/AGENTS.md') || m.startsWith('  !! awareness: removed - kept')), `a re-run said more than the two reminders: ${logs.join(' | ')}`);
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
    assert.deepStrictEqual(out.moved, ['related-projects/RELATED-PROJECTS.md', 'awareness/RELATED-PROJECTS-AWARENESS.md']);
    assert.strictEqual(fs.readFileSync(path.join(root, '.alfred/docs/awareness/RELATED-PROJECTS-AWARENESS.md'), 'utf8'), '# folder\n');
    assert.strictEqual(fs.readFileSync(path.join(root, '.alfred/docs/PROJECT-RELATED-CONTEXT.md'), 'utf8'), '# loose\n');
    assert.ok(logs.some((m) => /PROJECT-RELATED-CONTEXT\.md left in place, nothing overwritten/.test(m)), logs.join(' | '));
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/rules/alfred-related-context.md'), 'utf8'), RC_RULE('.alfred/docs/PROJECT-RELATED-CONTEXT.md'), 'the loose file still exists, so its pointer is not dangling');
    // A re-run leaves the loose copy where it is - its last home holds the folder form - never one hop on.
    const second = docs.migrateDocsDomains({ projectRoot: root, docsPath: '.alfred/docs', rules: rulesOf(root), log: () => {} });
    assert.deepStrictEqual(second.moved, []);
    assert.strictEqual(fs.readFileSync(path.join(root, '.alfred/docs/PROJECT-RELATED-CONTEXT.md'), 'utf8'), '# loose\n');
    assert.ok(!fs.existsSync(path.join(root, '.alfred/docs/related-projects')));
});

test('migration: a move an earlier run made without re-pointing heals - a generated rule follows to the last home; a path inside a longer one is no hit', () =>
{
    const map = (p) => `---\ndescription: generated\n---\n\nThe code style: \`${p}\`.\n`;
    const root = project({ files: {
        '.claude/docs/code-style/CODE-STYLE.md': '## naming <!-- id: s1 -->\n',
        '.claude/rules/alfred-architecture.md': map('.claude/docs/PROJECT-CODE-STYLE.md') + 'Old copy: `.claude/docs/PROJECT-CODE-STYLE.md.bak`, `x/.claude/docs/PROJECT-CODE-STYLE.md`.\n',
    } });
    const out = docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs/', rules: rulesOf(root) });
    assert.deepStrictEqual(out.repointed, ['.claude/rules/alfred-architecture.md']);
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/rules/alfred-architecture.md'), 'utf8'),
        map('.claude/docs/preferences/PROJECT-CODE-PREFERENCES.md') + 'Old copy: `.claude/docs/PROJECT-CODE-STYLE.md.bak`, `x/.claude/docs/PROJECT-CODE-STYLE.md`.\n');
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

// THE AWARENESS LAYOUT (the user's ruling of 2026-10-16): the inventory, the run book and the sibling doc share ONE
// domain, `awareness/`, and ONE generated rule imports them, so Claude Code loads all three at every session start.
// An update moves an older install in: the 2.5.0 homes (`project-capabilities/`, `related-projects/`, the inventory
// rule) and the develop-only 2026-10-15 one (`project-awareness/`, its import rule). Driven through migrateDocsDomains,
// the installer's own entry, then read back: the files, the rule, and the docs engine's own lint.
// The old rules named the capture that wrote them; those names are assembled so the rename sweep
// (install-renames.test.js) reads them as the shipped text they are, not a cite.
const oldCapture = (part) => `/${['capture', part].join('-')}`;
const OLD_POINTER = (root, shape = 'current') => (shape === 'first'
    ? `---\ndescription: Project run book pointer - generated by ${oldCapture('project-awareness')}; edit via a re-run.\n---\nRun book: \`${root}/project-capabilities/PROJECT-CAPABILITIES.md\` - read it before you build, start, log into or hand-check the app.\n`
    : `---\ndescription: Project run book pointer - generated by ${oldCapture('project-awareness')}; edit via a re-run.\n---\n\nRun book: \`${root}/project-capabilities/PROJECT-CAPABILITIES.md\` - read it before you build, start, log into or hand-check the app.\n`);
// The 2026-10-15 rule (develop only): it imported the run book from project-awareness/.
const IMPORT_RULE = (root) => `---\ndescription: Project run book import - generated by ${oldCapture('project-awareness')}; edit via a re-run.\n---\n\nRun book: \`${root}/project-awareness/PROJECT-AWARENESS.md\` - the project's workflow, imported below at every session start; follow it before you build, start, log into or hand-check the app, and if its text is not below, Read it first.\n\n@../../${root}/project-awareness/PROJECT-AWARENESS.md\n`;
const INVENTORY_BODY = '# This project\'s capabilities\n\nCaptured: 2026-10-01 from 2.5.0@abc1234\n\n## Usage policy (fixed - stamped verbatim, every run)\n<!-- policy-rev: 508df73f -->\n- Load a skill for the work at hand.\n\n## Subagent seats\nalfred-code:aspnet-verifier\n';
const INVENTORY_RULE = `---\ndescription: Project capabilities awareness - generated by ${oldCapture('agent-awareness')}; edit via a re-run, not by hand.\n---\n\n${INVENTORY_BODY}`;
const RELATED_RULE = (root) => `---\ndescription: Related projects awareness - generated by ${oldCapture('related-projects')}; edit via a re-run, not by hand.\n---\n\n- acme-api - ../acme-api, provides-to. Everything past awareness lives in \`${root}/related-projects/RELATED-PROJECTS.md\`.\n`;
const RUN_BOOK_DOC = 'Captured: main@abc1234, 2026-10-01\n\n# Run book\n\n## Build\n<!-- id: build -->\n<!-- covers: **package.json -->\n- `npm run build` (package.json)\n\n## Start\n<!-- id: start -->\n- `npm start` - see PROJECT-CAPABILITIES#build first\n- Credentials live in: `.alfred/docs/project-capabilities/credentials.local.env`\n';
const RUN_BOOK_WATCH = '{\n  "sourceRoots": ["src"],\n  "watch": [\n    { "kind": "build", "globs": ["**package.json"], "sections": ["PROJECT-CAPABILITIES#build", "project-capabilities/PROJECT-CAPABILITIES.md#start"] }\n  ]\n}\n';
const RELATED_DOC = 'Captured: main@abc1234, 2026-10-01\n\n# Related projects\n\n## acme-api\n<!-- id: acme-api -->\n\n```yaml\nlocation:   ../acme-api\nrelation:   provides-to\n```\n\nSee RELATED-PROJECTS#acme-api for the seam.\n';
const engineLint = (root, docsPath) => require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'stack', 'hooks', 'docs.js'), 'lint'],
    { cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_DOCS_PATH: docsPath, ALFRED_CODE_DOCS_VERSIONING: '' } });
const importsOf = (text) => text.split(/\r?\n/).filter((l) => l.startsWith('@')).map((l) => l.slice(1));
const awarenessRuleOf = (root) => fs.readFileSync(path.join(root, '.claude', 'rules', 'alfred-awareness.md'), 'utf8');
const N = (s) => String(s).replace(/\d+ bytes/g, 'N bytes');
const write = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };

test('awareness: an update over the 2.5.0 layout - the three docs land in awareness/, the ids follow, ONE rule imports them, the old rules go, a re-run is quiet', () =>
{
    const root = project({ files: {
        'package.json': '{}\n',
        '.alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md': RUN_BOOK_DOC,
        '.alfred/docs/project-capabilities/watch.json': RUN_BOOK_WATCH,
        '.alfred/docs/related-projects/RELATED-PROJECTS.md': RELATED_DOC,
        '.alfred/docs/related-projects/watch.json': '{}\n',
        '.claude/rules/alfred-agent-awareness.md': INVENTORY_RULE,
        '.claude/rules/alfred-project-awareness.md': OLD_POINTER('.alfred/docs'),
        '.claude/rules/alfred-related-context.md': RELATED_RULE('.alfred/docs'),
        '.claude/rules/alfred-git.md': '# shipped\n',
        '.claude/AGENTS.md': 'Run book: `.alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md`\n',
    } });
    const logs = [];
    const run = () => docs.migrateDocsDomains({ projectRoot: root, docsPath: '.alfred/docs', rules: rulesOf(root), instructions: instructionsOf(root), log: (m) => logs.push(m) });
    const out = run();
    const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
    const at = (rel) => path.join(root, '.alfred/docs', rel);
    assert.deepStrictEqual(out.moved, ['project-awareness/PROJECT-AWARENESS.md', 'project-awareness/watch.json', 'awareness/PROJECT-AWARENESS.md', 'awareness/watch.json', 'awareness/RELATED-PROJECTS-AWARENESS.md']);
    assert.deepStrictEqual(out.repointed.slice().sort(), ['.claude/rules/alfred-project-awareness.md', '.claude/rules/alfred-related-context.md']);
    assert.deepStrictEqual(out.awareness.respelled, ['.alfred/docs/awareness/watch.json', '.alfred/docs/awareness/PROJECT-AWARENESS.md', '.alfred/docs/awareness/RELATED-PROJECTS-AWARENESS.md']);
    assert.strictEqual(out.awareness.agents, 'moved');
    assert.strictEqual(N(out.awareness.rule), 'created - .claude/rules/alfred-awareness.md, N bytes, imports 3; superseded removed: alfred-agent-awareness.md, alfred-project-awareness.md, alfred-related-context.md');
    for (const old of ['project-capabilities', 'project-awareness', 'related-projects']) assert.ok(!fs.existsSync(at(old)), `the emptied ${old}/ goes`);
    // the docs: the ids follow the file keys, the inventory is the old rule's body without its frontmatter
    assert.strictEqual(read('.alfred/docs/awareness/PROJECT-AWARENESS.md'), RUN_BOOK_DOC.replace('see PROJECT-CAPABILITIES#build', 'see PROJECT-AWARENESS#build'), 'only the section ref changes - the credentials line is adoptCredentials\' to re-point');
    assert.strictEqual(read('.alfred/docs/awareness/RELATED-PROJECTS-AWARENESS.md'), RELATED_DOC.replace('See RELATED-PROJECTS#acme-api', 'See RELATED-PROJECTS-AWARENESS#acme-api'));
    assert.strictEqual(read('.alfred/docs/awareness/AGENTS-AWARENESS.md'), INVENTORY_BODY);
    assert.deepStrictEqual(JSON.parse(read('.alfred/docs/awareness/watch.json')), {
        sourceRoots: ['src'],
        watch: [{ kind: 'build', globs: ['**package.json'], sections: ['PROJECT-AWARENESS#build', 'awareness/PROJECT-AWARENESS.md#start'] }],
        notOwned: ['AGENTS-AWARENESS.md'],
    });
    // the rule: one import per doc, each resolving from .claude/rules/ to the moved file; the three old rules gone
    const rule = awarenessRuleOf(root);
    assert.deepStrictEqual(importsOf(rule), ['AGENTS-AWARENESS.md', 'PROJECT-AWARENESS.md', 'RELATED-PROJECTS-AWARENESS.md'].map((n) => `../../.alfred/docs/awareness/${n}`));
    for (const imp of importsOf(rule)) assert.ok(fs.existsSync(path.resolve(root, '.claude', 'rules', imp)), `${imp} resolves`);
    for (const gone of ['alfred-agent-awareness.md', 'alfred-project-awareness.md', 'alfred-related-context.md']) assert.ok(!fs.existsSync(path.join(root, '.claude/rules', gone)), `${gone} goes`);
    assert.strictEqual(read('.claude/rules/alfred-git.md'), '# shipped\n', 'a shipped rule is not the awareness step\'s');
    assert.ok(logs.includes('  !! .claude/AGENTS.md is yours and names .alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md, which moved to .alfred/docs/awareness/PROJECT-AWARENESS.md - re-point it by hand'), logs.join(' | '));
    assert.strictEqual(read('.claude/AGENTS.md'), 'Run book: `.alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md`\n', 'the project\'s AGENTS.md is never rewritten');
    // the docs engine reads the moved domain: every watch entry names a section that exists, the inventory not linted
    const lint = engineLint(root, '.alfred/docs');
    assert.doesNotMatch(lint.stdout, /PROBLEM/, lint.stdout);
    // a second run: nothing moves, the rule is current, and only the AGENTS.md reminder is said
    logs.length = 0;
    const again = run();
    assert.deepStrictEqual({ ...again, awareness: { ...again.awareness, rule: N(again.awareness.rule) } },
        { moved: [], switched: [], repointed: [], awareness: { respelled: [], overlays: [], agents: 'none', rule: 'unchanged, not rewritten - .claude/rules/alfred-awareness.md, N bytes' }, preferences: PREFS_RESULT('present') });
    assert.strictEqual(awarenessRuleOf(root), rule, 'idempotent');
    assert.ok(logs.every((m) => m.startsWith('  !! .claude/AGENTS.md')), `a re-run said more than the AGENTS.md reminder: ${logs.join(' | ')}`);
});

test('awareness: the 2026-10-15 layout moves the same way; a rule the user wrote is named and kept; an absolute docs root imports by its own path', () =>
{
    const first = project({ files: {
        'docs/ai/project-awareness/PROJECT-AWARENESS.md': '# Run book\n',
        'docs/ai/project-awareness/watch.json': '{\n  "watch": []\n}\n',
        '.claude/rules/alfred-project-awareness.md': IMPORT_RULE('docs/ai').replace(/\n/g, '\r\n'),
    } });
    const r1 = docs.migrateDocsDomains({ projectRoot: first, docsPath: 'docs/ai', rules: rulesOf(first) });
    assert.deepStrictEqual(r1.moved, ['awareness/PROJECT-AWARENESS.md', 'awareness/watch.json']);
    assert.match(r1.awareness.rule, /^created - .*imports 1; superseded removed: alfred-project-awareness\.md$/, 'a CRLF copy of the capture\'s own rule is still its own');
    assert.deepStrictEqual(importsOf(awarenessRuleOf(first)), ['../../docs/ai/awareness/PROJECT-AWARENESS.md']);
    assert.ok(!fs.existsSync(path.join(first, 'docs/ai/project-awareness')));

    // the user's own run-book rule (no capture stamp) still loads: named on every run, never removed; an inventory rule
    // with no policy stamp is not the capture's either, so it stays a rule and no doc is made from it
    const own = '# Our run book notes\n\nThe staging login is in 1Password.\n';
    const yours = project({ files: {
        '.alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md': '# Run book\n',
        '.claude/rules/alfred-project-awareness.md': own,
        '.claude/rules/alfred-agent-awareness.md': '# My capabilities notes\n',
    } });
    const logs = [];
    const r2 = docs.migrateDocsDomains({ projectRoot: yours, docsPath: '.alfred/docs', rules: rulesOf(yours), log: (m) => logs.push(m) });
    assert.strictEqual(r2.awareness.agents, 'yours');
    assert.match(r2.awareness.rule, /^created - .*imports 1$/);
    assert.strictEqual(fs.readFileSync(path.join(yours, '.claude/rules/alfred-project-awareness.md'), 'utf8'), own);
    assert.ok(fs.existsSync(path.join(yours, '.claude/rules/alfred-agent-awareness.md')), 'its doc is not imported, so it stays');
    assert.ok(!fs.existsSync(path.join(yours, '.alfred/docs/awareness/AGENTS-AWARENESS.md')));
    assert.ok(logs.includes('  !! .claude/rules/alfred-agent-awareness.md carries no policy stamp, so it is not the capture\'s own text and was not moved - re-run /capture-awareness'), logs.join(' | '));
    assert.ok(logs.some((m) => m.startsWith('  !! awareness: removed - kept .claude/rules/alfred-project-awareness.md - it is not the capture\'s own text')), logs.join(' | '));

    const abs = path.join(TMP, `abs-docs-${seq++}`);
    const outside = project({ files: { '.claude/rules/alfred-project-awareness.md': OLD_POINTER(abs.split(path.sep).join('/')) } });
    fs.mkdirSync(path.join(abs, 'project-awareness'), { recursive: true });
    fs.writeFileSync(path.join(abs, 'project-awareness', 'PROJECT-AWARENESS.md'), '# Run book\n');
    docs.migrateDocsDomains({ projectRoot: outside, docsPath: abs, rules: rulesOf(outside) });
    assert.deepStrictEqual(importsOf(awarenessRuleOf(outside)), [`${abs.split(path.sep).join('/')}/awareness/PROJECT-AWARENESS.md`]);
    assert.ok(!fs.existsSync(path.join(outside, '.claude/rules/alfred-project-awareness.md')));
});

test('awareness: a copy at the new home wins and stops the move; branch versions move with the doc; a credentials file keeps the old folder', () =>
{
    const both = project({ files: {
        '.alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md': '# old\n',
        '.alfred/docs/awareness/PROJECT-AWARENESS.md': '# new\n',
    } });
    const logs = [];
    const r = docs.migrateDocsDomains({ projectRoot: both, docsPath: '.alfred/docs', rules: rulesOf(both), log: (m) => logs.push(m) });
    assert.deepStrictEqual(r.moved, [], 'the old copy stays where it is - never one hop on');
    assert.deepStrictEqual(r.awareness.respelled, [], 'nothing is re-spelled while an old copy is left');
    assert.strictEqual(fs.readFileSync(path.join(both, '.alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md'), 'utf8'), '# old\n');
    assert.strictEqual(fs.readFileSync(path.join(both, '.alfred/docs/awareness/PROJECT-AWARENESS.md'), 'utf8'), '# new\n');
    assert.ok(logs.some((m) => /docs migration \(project awareness\): .*awareness[\\/]PROJECT-AWARENESS\.md already exists - .* left in place, nothing overwritten/.test(m)), logs.join(' | '));

    const branched = project({ files: {
        '.alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md': RUN_BOOK_DOC,
        '.alfred/docs/project-capabilities/watch.json': RUN_BOOK_WATCH,
        '.alfred/docs/project-capabilities/credentials.local.env': 'ADMIN_PASSWORD=x\n',
        '.alfred/docs/.branches/feat-a/project-capabilities/PROJECT-CAPABILITIES/build.md': '## Build\n- branch text\n',
        '.alfred/docs/.branches/feat-a/.base/project-capabilities/PROJECT-CAPABILITIES/build.md': '## Build\n- base text\n',
        '.alfred/docs/.branches/feat-b/project-capabilities/PROJECT-CAPABILITIES/start.md': '## Start\n- older\n',
        '.alfred/docs/.branches/feat-b/project-awareness/PROJECT-AWARENESS/start.md': '## Start\n',
        '.alfred/docs/.branches/feat-c/related-projects/RELATED-PROJECTS/acme.md': '## acme\n',
    } });
    write(branched, '.alfred/docs/related-projects/RELATED-PROJECTS.md', RELATED_DOC);
    const blogs = [];
    const out = docs.migrateDocsDomains({ projectRoot: branched, docsPath: '.alfred/docs', rules: rulesOf(branched), log: (m) => blogs.push(m) });
    const at = (rel) => path.join(branched, '.alfred/docs', rel);
    assert.deepStrictEqual(out.awareness.overlays, ['.branches/feat-a/awareness/PROJECT-AWARENESS', '.branches/feat-a/.base/awareness/PROJECT-AWARENESS',
        '.branches/feat-b/awareness/PROJECT-AWARENESS', '.branches/feat-c/awareness/RELATED-PROJECTS-AWARENESS']);
    assert.strictEqual(fs.readFileSync(at('.branches/feat-a/awareness/PROJECT-AWARENESS/build.md'), 'utf8'), '## Build\n- branch text\n');
    assert.strictEqual(fs.readFileSync(at('.branches/feat-a/.base/awareness/PROJECT-AWARENESS/build.md'), 'utf8'), '## Build\n- base text\n');
    assert.ok(!fs.existsSync(at('.branches/feat-a/project-capabilities')), 'the emptied branch folder goes');
    assert.strictEqual(fs.readFileSync(at('.branches/feat-b/awareness/PROJECT-AWARENESS/start.md'), 'utf8'), '## Start\n- older\n', 'the older home moves first');
    assert.ok(fs.existsSync(at('.branches/feat-b/project-awareness/PROJECT-AWARENESS/start.md')), 'a second version for the same key is left, never merged');
    assert.ok(blogs.some((m) => /!! docs migration \(awareness\): \.branches\/feat-b\/awareness\/PROJECT-AWARENESS\/ already exists/.test(m)), blogs.join(' | '));
    assert.ok(fs.existsSync(at('project-capabilities/credentials.local.env')), 'the credentials file stays where adoptCredentials and the ignore line expect it');
    assert.match(out.awareness.rule, /^created - .*imports 2$/, 'the run book and the sibling doc, no inventory rule to move');
});

test('awareness: a malformed watch.json moves as it is, is said and left; the rule is still written', () =>
{
    const root = project({ files: {
        '.alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md': '# Run book\n',
        '.alfred/docs/project-capabilities/watch.json': '{ not json',
    } });
    const logs = [];
    const out = docs.migrateDocsDomains({ projectRoot: root, docsPath: '.alfred/docs', rules: rulesOf(root), log: (m) => logs.push(m) });
    assert.strictEqual(fs.readFileSync(path.join(root, '.alfred/docs/awareness/watch.json'), 'utf8'), '{ not json', 'the user\'s file is never overwritten');
    assert.ok(logs.some((m) => /^ {2}!! awareness: watch - .*watch\.json is not valid JSON .* left as it is/.test(m)), logs.join(' | '));
    assert.match(out.awareness.rule, /^created - /);
});

// The 2026-10-16 matrix: a 0-byte watch.json is not the stack's `{}`, so it kept its old folder - silently, which read
// as a live domain. What the move leaves is named every run until the user acts; the files later steps take are not.
test('awareness: an old folder kept by a file the move does not take is named, every run', () =>
{
    const root = project({ files: {
        '.alfred/docs/related-projects/RELATED-PROJECTS.md': RELATED_DOC,
        '.alfred/docs/related-projects/watch.json': '',
        '.alfred/docs/related-projects/references/notes.md': '# mine\n',
        '.alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md': '# Run book\n',
        '.alfred/docs/project-capabilities/credentials.local.env': 'ADMIN_PASSWORD=x\n',
    } });
    const said = () =>
    {
        const logs = [];
        docs.migrateDocsDomains({ projectRoot: root, docsPath: '.alfred/docs', rules: rulesOf(root), log: (m) => logs.push(m) });
        return logs.filter((m) => /kept - it still holds/.test(m));
    };
    const want = ['  !! docs migration (awareness): related-projects/ kept - it still holds references, watch.json, which the move does not take; compare with awareness/ and remove it by hand'];
    assert.deepStrictEqual(said(), want, 'the credentials file is adoptCredentials\' to move, so project-capabilities/ is not named');
    assert.ok(fs.existsSync(path.join(root, '.alfred/docs/awareness/RELATED-PROJECTS-AWARENESS.md')), 'the doc itself moved');
    assert.strictEqual(fs.readFileSync(path.join(root, '.alfred/docs/related-projects/references/notes.md'), 'utf8'), '# mine\n');
    assert.deepStrictEqual(said(), want, 'and again on the next run');
});

// 2026-10-21: the preferences rule ships fixed - the copy step renders `__DOCS_ROOT__` into it (ROOTED_RULES) on every
// run, a docs-root move included, so the generated-rule re-stamp never touches it.
test('preferences: the shipped rule is the copy step\'s to render, so a docs-root move leaves it alone', () =>
{
    const { respellDocsRoot } = require('./install/selection.js');
    const root = project({});
    const rulePath = path.join(root, '.claude/rules/alfred-preferences.md');
    write(root, '.claude/rules/alfred-preferences.md', 'The docs in `.claude/docs/preferences/` bind every session.\n');
    assert.strictEqual(respellDocsRoot({ projectRoot: root, from: '.claude/docs', to: '.alfred/docs' }), 0);
    assert.strictEqual(fs.readFileSync(rulePath, 'utf8'), 'The docs in `.claude/docs/preferences/` bind every session.\n');
    assert.ok(fs.readFileSync(path.join(__dirname, '..', 'stack/rules/alfred-preferences.md'), 'utf8').includes('`__DOCS_ROOT__/preferences/`'), 'the source carries the placeholder');
    assert.match(fs.readFileSync(path.join(__dirname, 'install/alfred-code.js'), 'utf8'), /const ROOTED_RULES = \[DOCS_ROOT_RULE, 'alfred-preferences'\];/, 'the copy step renders it');
});

test('awareness: a docs-root move re-stamps the rule\'s import lines and the inventory doc, relative or absolute', () =>
{
    const { respellDocsRoot } = require('./install/selection.js');
    const { composeAwarenessRule } = require('../stack/skills/capture-awareness/scripts/capabilities-inventory.js');
    const root = project({ files: {
        '.claude/docs/awareness/AGENTS-AWARENESS.md': '# x\n',
        '.claude/docs/awareness/PROJECT-AWARENESS.md': '# x\n',
    } });
    const composed = (docsRoot) => composeAwarenessRule({ projectRoot: root, docs: docsRoot }).text;
    write(root, '.claude/rules/alfred-awareness.md', composed('.claude/docs'));
    fs.cpSync(path.join(root, '.claude/docs'), path.join(root, '.alfred/docs'), { recursive: true });
    write(root, '.alfred/docs/awareness/AGENTS-AWARENESS.md', '- `chrome-control` - screenshots under `.claude/docs/flow/` stay out of git\n');
    assert.strictEqual(respellDocsRoot({ projectRoot: root, from: '.claude/docs', to: '.alfred/docs' }), 2, 'the rule and the inventory doc at the new root');
    assert.strictEqual(awarenessRuleOf(root), composed('.alfred/docs'), 'the same bytes the capture writes for the new root');
    assert.match(fs.readFileSync(path.join(root, '.alfred/docs/awareness/AGENTS-AWARENESS.md'), 'utf8'), /under `\.alfred\/docs\/flow\/`/);
    assert.strictEqual(respellDocsRoot({ projectRoot: root, from: '.alfred/docs', to: '/srv/docs' }), 1);
    const text = awarenessRuleOf(root);
    assert.deepStrictEqual(importsOf(text), ['/srv/docs/awareness/AGENTS-AWARENESS.md', '/srv/docs/awareness/PROJECT-AWARENESS.md']);
    assert.match(text, /from `\/srv\/docs\/awareness\/`/);
});

// --- the preferences layout (the user's ruling of 2026-10-21) ----------------------------------------------------
// Every doc under preferences/ binds: the project's code style joins them as PROJECT-CODE-PREFERENCES.md, the user's
// code preferences become PERSONAL-CODE-PREFERENCES.md, and GIT-PREFERENCES.md is seeded with the house git lines -
// the consent, scope, checkpoint and safety entries locked - so the git safety lines exist in every project.

const PREFS = '.alfred/docs/preferences';
const TODAY = () => new Date().toISOString().slice(0, 10);
const lockedKeys = (text) => [...String(text).matchAll(/<!--\s*locked:\s*([a-z-]+)\s*-->/g)].map((m) => m[1]);
const prefsRun = (root, log = () => {}) => docs.migrateDocsDomains({ projectRoot: root, docsPath: '.alfred/docs', rules: rulesOf(root), instructions: instructionsOf(root), log });

test('preferences: a fresh project gets GIT-PREFERENCES.md from the seed, dated today, its locked entries marked, and the domain switched on', () =>
{
    const root = project();
    const out = prefsRun(root);
    const git = fs.readFileSync(path.join(root, PREFS, 'GIT-PREFERENCES.md'), 'utf8');
    assert.match(git, new RegExp(`^Updated: ${TODAY()}$`, 'm'));
    assert.doesNotMatch(git, /__TODAY__/);
    assert.deepStrictEqual(lockedKeys(git), ['consent', 'scope', 'checkpoint', 'safety']);
    assert.match(git, /'Show the diff first' takes the mark/, 'the consent line is carried word for word');
    assert.strictEqual(out.preferences.git, 'seeded');
    assert.deepStrictEqual(out.switched, ['preferences']);
    assert.strictEqual(fs.readFileSync(path.join(root, PREFS, 'watch.json'), 'utf8'), '{}\n');
    const again = prefsRun(root);
    assert.strictEqual(again.preferences.git, 'present');
    assert.deepStrictEqual(again.switched, []);
    assert.strictEqual(fs.readFileSync(path.join(root, PREFS, 'GIT-PREFERENCES.md'), 'utf8'), git, 'a re-run leaves the doc byte for byte');
});

test('preferences: an existing GIT-PREFERENCES.md keeps its entries and gains each locked one it lacks, numbered past every id it used', () =>
{
    // Its locked checkpoint entry carries the seed's fields under its own id and title (an edited one is restored - Q-4).
    const checkpoint = /<!-- locked: checkpoint -->\n((?:- [^\n]*\n)+)/.exec(fs.readFileSync(path.join(__dirname, '..', 'stack', 'skills', 'capture-preferences', 'references', 'git-seed.md'), 'utf8'))[1].trimEnd();
    const own = [
        '# Git preferences', '', 'Updated: 2026-10-20', 'Retired: G2', '',
        '## G1 - Branches are feature/<ticket>', '<!-- id: g1 -->', '- Rule: name a branch `feature/<ticket>`.', '',
        '## G3 - Keep the checkpoint', '<!-- id: g3 -->', '<!-- locked: checkpoint -->', checkpoint, '',
    ].join('\n');
    const root = project({ files: { [`${PREFS}/GIT-PREFERENCES.md`]: own, [`${PREFS}/watch.json`]: '{}\n' } });
    const logs = [];
    const out = prefsRun(root, (m) => logs.push(m));
    const git = fs.readFileSync(path.join(root, PREFS, 'GIT-PREFERENCES.md'), 'utf8');
    assert.ok(git.startsWith(own), 'the user\'s own entries stay first, unchanged');
    assert.deepStrictEqual(lockedKeys(git), ['checkpoint', 'consent', 'scope', 'safety'], 'the checkpoint it held is not added twice');
    assert.deepStrictEqual([...git.matchAll(/^## (G\d+) - /gm)].map((m) => m[1]), ['G1', 'G3', 'G4', 'G5', 'G6'], 'new ids skip the retired G2 and every used one');
    assert.deepStrictEqual([...git.matchAll(/<!-- id: (g\d+) -->/g)].map((m) => m[1]), ['g1', 'g3', 'g4', 'g5', 'g6']);
    assert.strictEqual(out.preferences.git, 'merged consent, scope, safety');
    assert.ok(logs.some((m) => /GIT-PREFERENCES\.md - added the locked entries it lacked: consent, scope, safety/.test(m)), logs.join(' | '));
    assert.strictEqual(prefsRun(root).preferences.git, 'present', 'a re-run adds nothing');
});

test('preferences: a GIT-PREFERENCES.md that cannot be read is named, never replaced', () =>
{
    const root = project();
    fs.mkdirSync(path.join(root, PREFS, 'GIT-PREFERENCES.md'), { recursive: true });
    const logs = [];
    const out = prefsRun(root, (m) => logs.push(m));
    assert.strictEqual(out.preferences.git, 'failed');
    assert.ok(fs.statSync(path.join(root, PREFS, 'GIT-PREFERENCES.md')).isDirectory());
    assert.ok(logs.some((m) => /!! .*GIT-PREFERENCES\.md could not be read/.test(m)), logs.join(' | '));
});

// Audit 2026-10-21 (preferences.md PF-20, PF-21, Q-4, edge 110).
const SEED_TEXT = () => fs.readFileSync(path.join(__dirname, '..', 'stack', 'skills', 'capture-preferences', 'references', 'git-seed.md'), 'utf8').replace(/__TODAY__/g, TODAY());
const lintOf = (root) => require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'stack', 'skills', 'capture-preferences', 'scripts', 'preferences.js'), 'lint'], { cwd: root, encoding: 'utf8' });

test('PF-20: an empty or blank GIT-PREFERENCES.md is seeded whole - title, date and the four locked entries - and lint passes', () =>
{
    for (const blank of ['', '  \n\n'])
    {
        const root = project({ files: { [`${PREFS}/GIT-PREFERENCES.md`]: blank } });
        assert.strictEqual(prefsRun(root).preferences.git, 'seeded');
        assert.strictEqual(fs.readFileSync(path.join(root, PREFS, 'GIT-PREFERENCES.md'), 'utf8'), SEED_TEXT());
        assert.strictEqual(lintOf(root).stdout.trim(), 'lint: 0 problems');
    }
});

test('Q-4: an edited locked entry is restored from the seed on update, its id and title kept and the replaced text named', () =>
{
    const seed = SEED_TEXT();
    const edited = seed.replace(/^(## G\d+) - [^\n]*\n(<!-- id: g\d+ -->\n<!-- locked: consent -->\n)- Rule: [^\n]*/m, '$1 - Ask me first\n$2- Rule: commit whenever the tests pass.\n- Except: release branches');
    assert.notStrictEqual(edited, seed, 'the fixture edits the consent entry');
    const root = project({ files: { [`${PREFS}/GIT-PREFERENCES.md`]: edited } });
    const logs = [];
    const out = prefsRun(root, (m) => logs.push(m));
    const git = fs.readFileSync(path.join(root, PREFS, 'GIT-PREFERENCES.md'), 'utf8');
    assert.strictEqual(out.preferences.git, 'restored consent');
    assert.match(git, /^## G\d+ - Ask me first$/m, 'its title is the user\'s to keep');
    assert.doesNotMatch(git, /commit whenever the tests pass|release branches/);
    assert.strictEqual(git.replace(/^(## G\d+) - Ask me first$/m, (m, h) => seed.match(new RegExp(`^${h} - [^\\n]*$`, 'm'))[0]), seed, 'every other line is the seed\'s');
    assert.ok(logs.some((m) => /GIT-PREFERENCES\.md - restored the locked 'consent' entry \(G\d+\) from the seed; it read: .*commit whenever the tests pass/.test(m)), logs.join(' | '));
    assert.strictEqual(lintOf(root).stdout.trim(), 'lint: 0 problems');
    assert.strictEqual(prefsRun(root).preferences.git, 'present', 'a re-run changes nothing');
});

test('edge 110: an entry that dropped its lock and weakened the rule gets the house entry back beside it, and is named', () =>
{
    const seed = SEED_TEXT();
    const weakened = seed.replace(/<!-- locked: consent -->\n- Rule: [^\n]*/, '- Rule: commit when you are done.');
    assert.match(weakened, /^## G1 - Ask before any commit or push\n<!-- id: g1 -->\n- Rule: commit when you are done\./m, 'the fixture drops the lock and weakens the rule');
    const root = project({ files: { [`${PREFS}/GIT-PREFERENCES.md`]: weakened } });
    const logs = [];
    assert.strictEqual(prefsRun(root, (m) => logs.push(m)).preferences.git, 'merged consent');
    assert.ok(logs.some((m) => new RegExp(`!! preferences: .*GIT-PREFERENCES\\.md G\\d+ repeats the locked 'consent' entry's title without its lock - remove it`).test(m)), logs.join(' | '));
    assert.match(lintOf(root).stdout, /G1 repeats the locked 'consent' entry's title without its lock/);
});

test('PF-21: an old CODE-PREFERENCES.md equal to PERSONAL-CODE-PREFERENCES.md is removed; a different one stays for a hand merge', () =>
{
    const text = '# Code preferences\n\nUpdated: 2026-10-20\n\n## C1 - No statics\n<!-- id: c1 -->\n- Rule: no static classes.\n';
    const same = project({ files: { [`${PREFS}/CODE-PREFERENCES.md`]: text.replace(/\n/g, '\r\n'), [`${PREFS}/PERSONAL-CODE-PREFERENCES.md`]: text } });
    const logs = [];
    prefsRun(same, (m) => logs.push(m));
    assert.ok(!fs.existsSync(path.join(same, PREFS, 'CODE-PREFERENCES.md')), 'the exact copy goes');
    assert.strictEqual(fs.readFileSync(path.join(same, PREFS, 'PERSONAL-CODE-PREFERENCES.md'), 'utf8'), text);
    assert.ok(logs.some((m) => /CODE-PREFERENCES\.md removed - an exact copy of .*PERSONAL-CODE-PREFERENCES\.md/.test(m)), logs.join(' | '));
    const differ = project({ files: { [`${PREFS}/CODE-PREFERENCES.md`]: text.replace('no static', 'no singleton'), [`${PREFS}/PERSONAL-CODE-PREFERENCES.md`]: text } });
    prefsRun(differ);
    assert.ok(fs.existsSync(path.join(differ, PREFS, 'CODE-PREFERENCES.md')), 'two texts are the user\'s to merge');
    assert.match(lintOf(differ).stdout, /both hold entries - merge the old one into the new by hand/);
});

test('preferences: CODE-STYLE.md moves to preferences/PROJECT-CODE-PREFERENCES.md - its ids, watch entries and branch versions re-keyed, code-style/ removed', () =>
{
    const watch = { sourceRoots: ['src'], watch: [{ kind: 'c#', globs: ['src/**.cs'], sections: ['CODE-STYLE#c-sharp', 'code-style/CODE-STYLE#cross'] }] };
    const style = '# Code style\n\nCaptured: main@abc1234, 2026-10-01\n\n## C#\n<!-- id: c-sharp -->\n<!-- covers: src/**.cs -->\nSee CODE-STYLE.md#cross.\n';
    const root = project({ files: {
        '.alfred/docs/code-style/CODE-STYLE.md': style,
        '.alfred/docs/code-style/watch.json': JSON.stringify(watch),
        '.alfred/docs/.branches/feat/code-style/CODE-STYLE/c-sharp.md': 'branch\n',
        '.alfred/docs/.branches/feat/.base/code-style/CODE-STYLE/c-sharp.md': 'base\n',
        '.claude/rules/project-code-style.md': '---\npaths:\n  - "**/*.cs"\n---\n# Project code style (generated - the code-style capture owns this rule)\n\nUse tabs.\n',
    } });
    const logs = [];
    const out = prefsRun(root, (m) => logs.push(m));
    const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
    assert.ok(out.moved.includes('preferences/PROJECT-CODE-PREFERENCES.md'), JSON.stringify(out.moved));
    assert.match(read(`${PREFS}/PROJECT-CODE-PREFERENCES.md`), /See PROJECT-CODE-PREFERENCES\.md#cross\./);
    assert.deepStrictEqual(JSON.parse(read(`${PREFS}/watch.json`)),
        { sourceRoots: ['src'], watch: [{ kind: 'c#', globs: ['src/**.cs'], sections: ['PROJECT-CODE-PREFERENCES#c-sharp', 'preferences/PROJECT-CODE-PREFERENCES#cross'] }] });
    assert.strictEqual(read('.alfred/docs/.branches/feat/preferences/PROJECT-CODE-PREFERENCES/c-sharp.md'), 'branch\n');
    assert.strictEqual(read('.alfred/docs/.branches/feat/.base/preferences/PROJECT-CODE-PREFERENCES/c-sharp.md'), 'base\n');
    assert.ok(!fs.existsSync(path.join(root, '.alfred/docs/code-style')), 'the old domain is gone');
    assert.ok(!fs.existsSync(path.join(root, '.alfred/docs/.branches/feat/code-style')), 'the old overlay folder is gone');
    assert.ok(!fs.existsSync(path.join(root, '.claude/rules/project-code-style.md')), 'the generated rule goes - the doc is read on trigger now');
    assert.strictEqual(out.preferences.rule, 'removed');
    assert.strictEqual(out.preferences.watch, 'moved');
    const again = prefsRun(root);
    assert.deepStrictEqual(again.moved, []);
    assert.deepStrictEqual(again.preferences, { respelled: [], overlays: [], watch: 'none', git: 'present', rule: 'none' }, 'a re-run is quiet');
});

test('preferences: the loose PROJECT-CODE-STYLE.md of 0.2.x chains straight to preferences/', () =>
{
    const root = project({ files: { '.alfred/docs/PROJECT-CODE-STYLE.md': '# style\n' } });
    const out = prefsRun(root);
    assert.strictEqual(fs.readFileSync(path.join(root, PREFS, 'PROJECT-CODE-PREFERENCES.md'), 'utf8'), '# style\n');
    assert.ok(out.moved.includes('preferences/PROJECT-CODE-PREFERENCES.md'), JSON.stringify(out.moved));
    assert.ok(!fs.existsSync(path.join(root, '.alfred/docs/code-style')));
});

test('preferences: CODE-PREFERENCES.md becomes PERSONAL-CODE-PREFERENCES.md, its refs follow and a PROJECT-CODE-PREFERENCES ref is untouched', () =>
{
    const root = project({ files: {
        [`${PREFS}/CODE-PREFERENCES.md`]: '# Code preferences\n\nUpdated: 2026-10-20\n\n## C1 - No statics\n<!-- id: c1 -->\n- Rule: see CODE-PREFERENCES#c1 and PROJECT-CODE-PREFERENCES#naming.\n',
        [`${PREFS}/watch.json`]: '{"notOwned":["preferences/CODE-PREFERENCES.md"]}',
    } });
    const out = prefsRun(root);
    const doc = fs.readFileSync(path.join(root, PREFS, 'PERSONAL-CODE-PREFERENCES.md'), 'utf8');
    assert.match(doc, /see PERSONAL-CODE-PREFERENCES#c1 and PROJECT-CODE-PREFERENCES#naming\./);
    assert.ok(!fs.existsSync(path.join(root, PREFS, 'CODE-PREFERENCES.md')));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, PREFS, 'watch.json'), 'utf8')), { notOwned: ['preferences/PERSONAL-CODE-PREFERENCES.md'] });
    assert.ok(out.moved.includes('preferences/PERSONAL-CODE-PREFERENCES.md'));
});

test('preferences: a preferences/watch.json of its own is merged, never overwritten; an invalid one keeps code-style/watch.json, named', () =>
{
    const root = project({ files: {
        '.alfred/docs/code-style/CODE-STYLE.md': '# s\n',
        '.alfred/docs/code-style/watch.json': '{"sourceRoots":["src","app"],"watch":[{"globs":["app/**.ts"],"sections":["CODE-STYLE#ts"]}]}',
        [`${PREFS}/watch.json`]: '{"sourceRoots":["src"],"watch":[{"globs":["x/**"],"sections":["GIT-PREFERENCES#g1"]}]}',
    } });
    const out = prefsRun(root);
    assert.strictEqual(out.preferences.watch, 'merged');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, PREFS, 'watch.json'), 'utf8')), {
        sourceRoots: ['src', 'app'],
        watch: [{ globs: ['x/**'], sections: ['GIT-PREFERENCES#g1'] }, { globs: ['app/**.ts'], sections: ['PROJECT-CODE-PREFERENCES#ts'] }],
    });

    const bad = project({ files: {
        '.alfred/docs/code-style/CODE-STYLE.md': '# s\n',
        '.alfred/docs/code-style/watch.json': '{"sourceRoots":["src"]}',
        [`${PREFS}/watch.json`]: '{ not json',
    } });
    const logs = [];
    assert.strictEqual(prefsRun(bad, (m) => logs.push(m)).preferences.watch, 'kept');
    assert.strictEqual(fs.readFileSync(path.join(bad, '.alfred/docs/code-style/watch.json'), 'utf8'), '{"sourceRoots":["src"]}');
    assert.strictEqual(fs.readFileSync(path.join(bad, PREFS, 'watch.json'), 'utf8'), '{ not json');
    assert.ok(logs.some((m) => /!! .*code-style\/watch\.json .*merge it by hand/.test(m)), logs.join(' | '));
});

test('preferences: a PROJECT-CODE-PREFERENCES.md already there wins - CODE-STYLE.md, its watch.json and the rule stay, named', () =>
{
    const root = project({ files: {
        '.alfred/docs/code-style/CODE-STYLE.md': '# old\n',
        '.alfred/docs/code-style/watch.json': '{"sourceRoots":["src"]}',
        [`${PREFS}/PROJECT-CODE-PREFERENCES.md`]: '# new\n',
        '.claude/rules/project-code-style.md': '# Project code style (generated - the code-style capture owns this rule)\n',
    } });
    const logs = [];
    const out = prefsRun(root, (m) => logs.push(m));
    assert.strictEqual(fs.readFileSync(path.join(root, '.alfred/docs/code-style/CODE-STYLE.md'), 'utf8'), '# old\n');
    assert.strictEqual(fs.readFileSync(path.join(root, PREFS, 'PROJECT-CODE-PREFERENCES.md'), 'utf8'), '# new\n');
    assert.ok(fs.existsSync(path.join(root, '.alfred/docs/code-style/watch.json')), 'an unfinished move takes nothing from the old domain');
    assert.strictEqual(out.preferences.watch, 'none');
    assert.ok(fs.existsSync(path.join(root, '.claude/rules/project-code-style.md')), 'the rule stays while the old doc does');
    assert.ok(logs.some((m) => /already exists .* left in place, nothing overwritten/.test(m)), logs.join(' | '));
});

test('preferences: a project-code-style.md the capture did not write is kept and named', () =>
{
    const root = project({ files: {
        [`${PREFS}/PROJECT-CODE-PREFERENCES.md`]: '# s\n',
        '.claude/rules/project-code-style.md': '# Our own style rule\n',
    } });
    const logs = [];
    const out = prefsRun(root, (m) => logs.push(m));
    assert.strictEqual(out.preferences.rule, 'kept');
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/rules/project-code-style.md'), 'utf8'), '# Our own style rule\n');
    assert.ok(logs.some((m) => /!! \.claude\/rules\/project-code-style\.md .*not the capture's text/.test(m)), logs.join(' | '));
});
