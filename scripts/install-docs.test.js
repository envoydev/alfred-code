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
const PREFS_RESULT = (git) => ({ respelled: [], overlays: [], watch: 'none', git, rule: 'none', scopes: [], reach: [], tools: [] });

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

test('migration: the installer writes no watch.json into quality/ or related-context/ - only the assessment\'s capture knows its entries', () =>
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

// D6 (every project-derived doc is watched, 2026-10-27): an assessment written before quality/ had a watch stays outside
// the engine until its capture runs again, so every run names it - and writes nothing for it: only the capture knows
// the entries.
const D6_LINE = '!! quality/ARCHITECTURE-ASSESSMENT.md predates its watch - run /capture-quality architecture-quality to put it under the session-close docs check';
const d6Lines = (logs) => logs.filter((l) => l.includes('predates its watch')).map((l) => l.trim());

test('D6: an assessment with no quality/watch.json is named once per run, and nothing is written under quality/', () =>
{
    const root = project({ files: { '.claude/docs/quality/ARCHITECTURE-ASSESSMENT.md': '# a\n' } });
    for (const run of [1, 2])
    {
        const logs = [];
        docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs', log: (m) => logs.push(m) });
        assert.deepStrictEqual(d6Lines(logs), [D6_LINE], `run ${run}`);
    }
    assert.deepStrictEqual(fs.readdirSync(path.join(root, '.claude/docs/quality')), ['ARCHITECTURE-ASSESSMENT.md']);
    assert.strictEqual(docs.assessmentWatchLine({ projectRoot: root, docsPath: '.claude/docs', log: () => {} }), true);
});

// The way back (the docs-watch design, Rollout; AC19): a code revert alone would leave a recomputed quality/watch.json
// for an engine that reads it as an ordinary domain, so the migration deletes it - but only beside an engine with no
// refRecomputed, which makes it dormant in the release that ships it.
const ENGINE_TEXT = fs.readFileSync(path.join(__dirname, '..', 'stack', 'hooks', 'docs.js'), 'utf8');
const OLD_ENGINE = "'use strict';\n// an engine from before recomputed domains\nfunction watchOfUncached() { return {}; }\n";
const RECOMPUTED = '{\n  "recomputed": true,\n  "notOwned": ["CODE-ASSESSMENT.md", "references/**"],\n  "watch": []\n}\n';
const qualityOf = (root) => path.join(root, '.claude/docs/quality');
const qualityFiles = (root) => Object.fromEntries(fs.readdirSync(qualityOf(root)).sort().map((f) => [f, fs.readFileSync(path.join(qualityOf(root), f), 'utf8')]));

test('migration dormant beside this engine: a recomputed quality/watch.json is byte-identical after', () =>
{
    const root = project({ files: { '.claude/docs/quality/watch.json': RECOMPUTED, '.claude/docs/quality/ARCHITECTURE-ASSESSMENT.md': '# a\n' } });
    docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs', engineText: ENGINE_TEXT });
    assert.strictEqual(fs.readFileSync(path.join(qualityOf(root), 'watch.json'), 'utf8'), RECOMPUTED);
    assert.strictEqual(docs.revertRecomputed({ projectRoot: root, docsPath: '.claude/docs', engineText: ENGINE_TEXT }), false);
});

test('the way back: beside an engine with no refRecomputed only a recomputed quality/watch.json goes, nothing else changes', () =>
{
    const root = project({ files: {
        '.claude/docs/quality/watch.json': RECOMPUTED,
        '.claude/docs/quality/ARCHITECTURE-ASSESSMENT.md': '# a\n',
        '.claude/docs/quality/CODE-ASSESSMENT.md': '# c\n',
    } });
    const before = qualityFiles(root);
    const logs = [];
    docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs', engineText: OLD_ENGINE, log: (m) => logs.push(m) });
    const after = qualityFiles(root);
    delete before['watch.json'];
    assert.deepStrictEqual(after, before, 'only watch.json left quality/');
    assert.ok(logs.some((l) => /quality\/watch\.json removed/.test(l)), 'the removal is said');
    // A second run has nothing left to remove.
    assert.strictEqual(docs.revertRecomputed({ projectRoot: root, docsPath: '.claude/docs', engineText: OLD_ENGINE }), false);
});

test('the way back: a watch.json without the key, an unparseable one, no engine text and no quality/ are left alone', () =>
{
    const plain = project({ files: { '.claude/docs/quality/watch.json': '{\n  "watch": []\n}\n' } });
    const falsy = project({ files: { '.claude/docs/quality/watch.json': '{"recomputed":"yes"}\n' } });
    const garbage = project({ files: { '.claude/docs/quality/watch.json': '{not json' } });
    const unread = project({ files: { '.claude/docs/quality/watch.json': RECOMPUTED } });
    for (const [root, text] of [[plain, OLD_ENGINE], [falsy, OLD_ENGINE], [garbage, OLD_ENGINE], [unread, null]])
    {
        const before = qualityFiles(root);
        assert.strictEqual(docs.revertRecomputed({ projectRoot: root, docsPath: '.claude/docs', engineText: text }), false, root);
        assert.deepStrictEqual(qualityFiles(root), before, root);
    }
    for (const root of [project(), path.join(TMP, 'no-docs-root-2')])
        assert.strictEqual(docs.revertRecomputed({ projectRoot: root, docsPath: '.claude/docs', engineText: OLD_ENGINE }), false);
});

// 2026-10-29 (capture-quality): the coverage doc moves into quality/, a recomputed domain, so its watch.json must
// list COVERAGE-QUALITY.md as not owned - else the engine sections it as an architecture-assessment document.
const notOwnedOf = (root) => docs.ensureQualityNotOwned({ projectRoot: root, docsPath: '.claude/docs', log: () => {} });
const watchText = (root) => fs.readFileSync(path.join(qualityOf(root), 'watch.json'), 'utf8');

test('quality notOwned: COVERAGE-QUALITY.md is added once, every other key and the file\'s shape kept', () =>
{
    const compact = project({ files: { '.claude/docs/quality/watch.json': '{"recomputed":true,"notOwned":["CODE-ASSESSMENT.md","references/**"],"x":1}\n' } });
    assert.strictEqual(notOwnedOf(compact), 'added');
    assert.strictEqual(watchText(compact), '{"recomputed":true,"notOwned":["CODE-ASSESSMENT.md","references/**","COVERAGE-QUALITY.md"],"x":1}\n');
    const after = watchText(compact);
    assert.strictEqual(notOwnedOf(compact), 'present', 'a second call');
    assert.strictEqual(watchText(compact), after, 'bytes unchanged on the second call');

    const indented = project({ files: { '.claude/docs/quality/watch.json': RECOMPUTED } });
    assert.strictEqual(notOwnedOf(indented), 'added');
    assert.strictEqual(watchText(indented), '{\n  "recomputed": true,\n  "notOwned": [\n    "CODE-ASSESSMENT.md",\n    "references/**",\n    "COVERAGE-QUALITY.md"\n  ],\n  "watch": []\n}\n');
});

test('quality notOwned: a glob that already covers it is present, a missing key is created', () =>
{
    const glob = project({ files: { '.claude/docs/quality/watch.json': '{"recomputed":true,"notOwned":["**.md"]}\n' } });
    const before = watchText(glob);
    assert.strictEqual(notOwnedOf(glob), 'present', 'the docs engine\'s own matches');
    assert.strictEqual(watchText(glob), before);

    const keyless = project({ files: { '.claude/docs/quality/watch.json': '{"recomputed":true}\n' } });
    assert.strictEqual(notOwnedOf(keyless), 'added');
    assert.deepStrictEqual(JSON.parse(watchText(keyless)), { recomputed: true, notOwned: ['COVERAGE-QUALITY.md'] });
});

test('quality notOwned: no watch.json creates nothing, an unreadable one is left byte-identical and named once', () =>
{
    for (const root of [project({ files: { '.claude/docs/quality/CODE-ASSESSMENT.md': '# c\n' } }), project(), path.join(TMP, 'no-docs-root-3')])
    {
        assert.strictEqual(notOwnedOf(root), 'absent', root);
        assert.ok(!fs.existsSync(path.join(qualityOf(root), 'watch.json')), root);
    }
    for (const text of ['garbage', '[]'])
    {
        const root = project({ files: { '.claude/docs/quality/watch.json': text } });
        const logs = [];
        assert.strictEqual(docs.ensureQualityNotOwned({ projectRoot: root, docsPath: '.claude/docs', log: (m) => logs.push(m) }), 'unreadable', text);
        assert.strictEqual(watchText(root), text, text);
        assert.strictEqual(logs.length, 1, text);
        assert.ok(logs[0].includes(path.join(qualityOf(root), 'watch.json')), logs[0]);
    }
});

test('D6: nothing named and nothing thrown with the watch present, with no quality/ and with no docs root', () =>
{
    const watched = project({ files: { '.claude/docs/quality/ARCHITECTURE-ASSESSMENT.md': '# a\n', '.claude/docs/quality/watch.json': '{"recomputed":true}\n' } });
    const noQuality = project({ files: { '.claude/docs/architecture/ARCHITECTURE.md': '# m\n' } });
    for (const root of [watched, noQuality, path.join(TMP, 'no-docs-root')])
    {
        const logs = [];
        docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs', log: (m) => logs.push(m) });
        assert.deepStrictEqual(d6Lines(logs), [], root);
        assert.strictEqual(docs.assessmentWatchLine({ projectRoot: root, docsPath: '.claude/docs', log: () => {} }), false, root);
    }
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
    assert.deepStrictEqual(out.moved, ['project-awareness/PROJECT-AWARENESS.md', 'project-awareness/watch.json', 'awareness/PROJECT-AWARENESS.md', 'awareness/watch.json', 'awareness/RELATED-PROJECTS-AWARENESS.md', 'awareness/RUN-AND-DEBUG-AWARENESS.md']);
    assert.deepStrictEqual(out.repointed.slice().sort(), ['.claude/rules/alfred-project-awareness.md', '.claude/rules/alfred-related-context.md']);
    assert.deepStrictEqual(out.awareness.respelled, ['.alfred/docs/awareness/watch.json', '.alfred/docs/awareness/RELATED-PROJECTS-AWARENESS.md', '.alfred/docs/awareness/RUN-AND-DEBUG-AWARENESS.md']);
    assert.strictEqual(out.awareness.agents, 'moved');
    assert.strictEqual(N(out.awareness.rule), 'created - .claude/rules/alfred-awareness.md, N bytes, imports 3; superseded removed: alfred-agent-awareness.md, alfred-project-awareness.md, alfred-related-context.md');
    for (const old of ['project-capabilities', 'project-awareness', 'related-projects']) assert.ok(!fs.existsSync(at(old)), `the emptied ${old}/ goes`);
    // the docs: the ids follow the file keys, the inventory is the old rule's body without its frontmatter
    assert.strictEqual(read('.alfred/docs/awareness/RUN-AND-DEBUG-AWARENESS.md'), RUN_BOOK_DOC.replace('see PROJECT-CAPABILITIES#build', 'see RUN-AND-DEBUG-AWARENESS#build'), 'only the section ref changes - the credentials line is adoptCredentials\' to re-point');
    assert.strictEqual(read('.alfred/docs/awareness/RELATED-PROJECTS-AWARENESS.md'), RELATED_DOC.replace('See RELATED-PROJECTS#acme-api', 'See RELATED-PROJECTS-AWARENESS#acme-api'));
    assert.strictEqual(read('.alfred/docs/awareness/AGENTS-AWARENESS.md'), INVENTORY_BODY);
    assert.deepStrictEqual(JSON.parse(read('.alfred/docs/awareness/watch.json')), {
        sourceRoots: ['src'],
        watch: [{ kind: 'build', globs: ['**package.json'], sections: ['RUN-AND-DEBUG-AWARENESS#build', 'awareness/RUN-AND-DEBUG-AWARENESS.md#start'] }],
        notOwned: ['AGENTS-AWARENESS.md'],
    });
    // the rule: one import per doc, each resolving from .claude/rules/ to the moved file; the three old rules gone
    const rule = awarenessRuleOf(root);
    assert.deepStrictEqual(importsOf(rule), ['AGENTS-AWARENESS.md', 'RUN-AND-DEBUG-AWARENESS.md', 'RELATED-PROJECTS-AWARENESS.md'].map((n) => `../../.alfred/docs/awareness/${n}`));
    for (const imp of importsOf(rule)) assert.ok(fs.existsSync(path.resolve(root, '.claude', 'rules', imp)), `${imp} resolves`);
    for (const gone of ['alfred-agent-awareness.md', 'alfred-project-awareness.md', 'alfred-related-context.md']) assert.ok(!fs.existsSync(path.join(root, '.claude/rules', gone)), `${gone} goes`);
    assert.strictEqual(read('.claude/rules/alfred-git.md'), '# shipped\n', 'a shipped rule is not the awareness step\'s');
    assert.ok(logs.includes('  !! .claude/AGENTS.md is yours and names .alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md, which moved to .alfred/docs/awareness/RUN-AND-DEBUG-AWARENESS.md - re-point it by hand'), logs.join(' | '));
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
    assert.deepStrictEqual(r1.moved, ['awareness/PROJECT-AWARENESS.md', 'awareness/watch.json', 'awareness/RUN-AND-DEBUG-AWARENESS.md']);
    assert.match(r1.awareness.rule, /^created - .*imports 1; superseded removed: alfred-project-awareness\.md$/, 'a CRLF copy of the capture\'s own rule is still its own');
    assert.deepStrictEqual(importsOf(awarenessRuleOf(first)), ['../../docs/ai/awareness/RUN-AND-DEBUG-AWARENESS.md']);
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
    assert.deepStrictEqual(importsOf(awarenessRuleOf(outside)), [`${abs.split(path.sep).join('/')}/awareness/RUN-AND-DEBUG-AWARENESS.md`]);
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
    assert.deepStrictEqual(r.moved, ['awareness/RUN-AND-DEBUG-AWARENESS.md'], 'the newer copy takes the run book\'s name; the old one stays where it is - never one hop on');
    assert.deepStrictEqual(r.awareness.respelled, [], 'nothing is re-spelled while an old copy is left');
    assert.strictEqual(fs.readFileSync(path.join(both, '.alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md'), 'utf8'), '# old\n');
    assert.strictEqual(fs.readFileSync(path.join(both, '.alfred/docs/awareness/RUN-AND-DEBUG-AWARENESS.md'), 'utf8'), '# new\n');
    assert.ok(!fs.existsSync(path.join(both, '.alfred/docs/project-awareness')), 'never one hop on');
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
    assert.deepStrictEqual(out.awareness.overlays, ['.branches/feat-a/awareness/RUN-AND-DEBUG-AWARENESS', '.branches/feat-a/.base/awareness/RUN-AND-DEBUG-AWARENESS',
        '.branches/feat-b/awareness/RUN-AND-DEBUG-AWARENESS', '.branches/feat-c/awareness/RELATED-PROJECTS-AWARENESS']);
    assert.strictEqual(fs.readFileSync(at('.branches/feat-a/awareness/RUN-AND-DEBUG-AWARENESS/build.md'), 'utf8'), '## Build\n- branch text\n');
    assert.strictEqual(fs.readFileSync(at('.branches/feat-a/.base/awareness/RUN-AND-DEBUG-AWARENESS/build.md'), 'utf8'), '## Build\n- base text\n');
    assert.ok(!fs.existsSync(at('.branches/feat-a/project-capabilities')), 'the emptied branch folder goes');
    assert.strictEqual(fs.readFileSync(at('.branches/feat-b/awareness/RUN-AND-DEBUG-AWARENESS/start.md'), 'utf8'), '## Start\n- older\n', 'the older home moves first');
    assert.ok(fs.existsSync(at('.branches/feat-b/project-awareness/PROJECT-AWARENESS/start.md')), 'a second version for the same key is left, never merged');
    assert.ok(blogs.some((m) => /!! docs migration \(awareness\): \.branches\/feat-b\/awareness\/RUN-AND-DEBUG-AWARENESS\/ already exists/.test(m)), blogs.join(' | '));
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
    const { composeAwarenessRule } = require('../stack/skills/capture-awareness/scripts/awareness-state.js');
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
// code preferences become PERSONAL-CODE-PREFERENCES.md, and GIT-PREFERENCES.md is seeded with the crucial house git lines,
// every one locked - so the git safety lines exist in every project.

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
    assert.deepStrictEqual(lockedKeys(git), ['consent', 'checkpoint', 'safety', 'attribution', 'checks']);
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
    assert.deepStrictEqual(lockedKeys(git), ['checkpoint', 'consent', 'safety', 'attribution', 'checks'], 'the checkpoint it held is not added twice');
    assert.deepStrictEqual([...git.matchAll(/^## (G\d+) - /gm)].map((m) => m[1]), ['G1', 'G3', 'G4', 'G5', 'G6', 'G7'], 'new ids skip the retired G2 and every used one');
    assert.deepStrictEqual([...git.matchAll(/<!-- id: (g\d+) -->/g)].map((m) => m[1]), ['g1', 'g3', 'g4', 'g5', 'g6', 'g7']);
    assert.strictEqual(out.preferences.git, 'merged consent, safety, attribution, checks');
    assert.ok(logs.some((m) => /GIT-PREFERENCES\.md - added the locked entries it lacked: consent, safety, attribution, checks/.test(m)), logs.join(' | '));
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

test('PF-20: an empty or blank GIT-PREFERENCES.md is seeded whole - title, date and the five locked entries - and lint passes', () =>
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

test('an update names each code or architecture Scope: glob that reaches no file - the hook would hand that entry over for no edit', () =>
{
    const entry = (id, scope) => `## ${id} - Rule ${id}\n<!-- id: ${id.toLowerCase()} -->\n- Rule: rule ${id}.\n- Scope: ${scope}\n`;
    const root = project({ files: {
        'src/app.ts': 'x\n',
        [`${PREFS}/PERSONAL-CODE-PREFERENCES.md`]: `# Code preferences\n\nUpdated: 2026-10-22\n\n${entry('C1', 'src/**/*.ts')}\n${entry('C2', 'apii/**/*.cs')}\n${entry('C3', 'every language')}`,
        [`${PREFS}/ARCHITECTURE-PREFERENCES.md`]: `# Architecture preferences\n\nUpdated: 2026-10-22\n\n${entry('A1', 'web/')}`,
    } });
    const logs = [];
    const out = prefsRun(root, (m) => logs.push(m));
    assert.deepStrictEqual(out.preferences.scopes, ['PERSONAL-CODE-PREFERENCES.md C2 apii/**/*.cs', 'ARCHITECTURE-PREFERENCES.md A1 web/']);
    assert.ok(logs.some((m) => /!! preferences: \S*PERSONAL-CODE-PREFERENCES\.md C2 Scope: `apii\/\*\*\/\*\.cs` reaches no file - the first-edit hold hands C2 over for no edit; fix the pattern through \/capture-preferences/.test(m)), logs.join(' | '));
    assert.ok(!logs.some((m) => / C[13] Scope:/.test(m)), 'a live glob and a plain area are never named');
    fs.mkdirSync(path.join(root, 'web'), { recursive: true });
    fs.writeFileSync(path.join(root, 'web', 'index.html'), 'x\n');
    assert.deepStrictEqual(prefsRun(root).preferences.scopes, ['PERSONAL-CODE-PREFERENCES.md C2 apii/**/*.cs'], 'a folder that now holds a file reaches it');
});

// A Scope: aimed at the wrong existing folder reaches files, so no dead-glob line names it; a Check: that measures files
// the Scope: never reaches is the one sign a script can see, and the update names it as lint does.
test('an update names each entry whose Check: measures files its Scope: does not reach', () =>
{
    const entry = (id, scope, check) => `## ${id} - Rule ${id}\n<!-- id: ${id.toLowerCase()} -->\n- Rule: rule ${id}.\n- Scope: ${scope}\n${check ? `- Check: ${check}\n` : ''}`;
    const root = project({ files: {
        'src/app.ts': 'x\n', 'src/lib.ts': 'x\n', 'tools/run.ts': 'x\n',
        [`${PREFS}/PERSONAL-CODE-PREFERENCES.md`]: `# Code preferences\n\nUpdated: 2026-10-22\n\n${entry('C1', 'tools/**/*.ts', 'regex `any` in `src/**/*.ts`')}\n${entry('C2', 'src/**/*.ts', 'regex `any` in `src/**/*.ts`')}\n${entry('C3', 'every language', 'regex `any` in `**/*.ts`')}`,
    } });
    const logs = [];
    const out = prefsRun(root, (m) => logs.push(m));
    assert.deepStrictEqual(out.preferences.reach, ['PERSONAL-CODE-PREFERENCES.md C1 2']);
    assert.ok(logs.some((m) => /!! preferences: \S*PERSONAL-CODE-PREFERENCES\.md C1 Check: reaches 2 files its Scope: does not \(src\/app\.ts, src\/lib\.ts\) - the first-edit hold hands C1 over only where its Scope: reaches; widen the Scope: or narrow the Check: through \/capture-preferences/.test(m)), logs.join(' | '));
    assert.ok(!logs.some((m) => / C[23] Check:/.test(m)), 'a Check: inside its Scope: and a plain area are never named');
    assert.deepStrictEqual(prefsRun(root).preferences.reach, ['PERSONAL-CODE-PREFERENCES.md C1 2'], 'named on every run until fixed');
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

// The user's ruling of 2026-10-21: the seed keeps only the crucial git lines, every one locked. A 2.9.0 doc's entries the
// seed dropped go while still as seeded, the attribution line takes its lock, and anything the user changed stays.
const SEED_290 = () => fs.readFileSync(path.join(__dirname, 'install', 'git-seed-2.9.0.md'), 'utf8').replace(/__TODAY__/g, '2026-10-21');
const headsOf = (text) => [...text.matchAll(/^## (G\d+) - /gm)].map((m) => m[1]);

test('crucial seed: a 2.9.0 doc left as seeded keeps G1, G3, G4 and G6 under their ids, retires the rest and gains the new lock', () =>
{
    const root = project({ files: { [`${PREFS}/GIT-PREFERENCES.md`]: SEED_290() } });
    const logs = [];
    const out = prefsRun(root, (m) => logs.push(m));
    const git = fs.readFileSync(path.join(root, PREFS, 'GIT-PREFERENCES.md'), 'utf8');
    assert.strictEqual(out.preferences.git, 'retired G2, G5, G7, G8; locked attribution; updated checkpoint, safety; merged checks');
    assert.deepStrictEqual(headsOf(git), ['G1', 'G3', 'G4', 'G6', 'G9'], 'the kept ids stay, the new entry takes the next one');
    assert.deepStrictEqual(lockedKeys(git), ['consent', 'checkpoint', 'safety', 'attribution', 'checks']);
    assert.match(git, /^Updated: 2026-10-21\nRetired: G2, G5, G7, G8\n/m);
    assert.doesNotMatch(git, /Commit message shape|Critical:|Branch names|under 400 LOC|derived FRESH/);
    assert.match(git, /^## G4 - Keep history recoverable\n<!-- id: g4 -->\n<!-- locked: safety -->\n- Rule: ask before any git command that discards or rewrites work/m, 'the safety entry takes this release\'s text under its own heading');
    assert.match(git, /^## G6 - No AI attribution\n<!-- id: g6 -->\n<!-- locked: attribution -->\n- Rule: never mention yourself/m);
    assert.ok(git.endsWith('ships what the check exists to stop.\n'), JSON.stringify(git.slice(-80)));
    assert.ok(logs.some((m) => /GIT-PREFERENCES\.md - updated the locked 'safety' entry \(G4\) to this release's text/.test(m)), logs.join(' | '));
    assert.ok(logs.some((m) => /GIT-PREFERENCES\.md - removed G8, a git line the seed no longer carries/.test(m)), logs.join(' | '));
    assert.ok(!logs.some((m) => /restored the locked|!!/.test(m)), logs.join(' | '));
    assert.strictEqual(lintOf(root).stdout.trim(), 'lint: 0 problems');
    assert.strictEqual(prefsRun(root).preferences.git, 'present', 'a re-run changes nothing');
    assert.strictEqual(fs.readFileSync(path.join(root, PREFS, 'GIT-PREFERENCES.md'), 'utf8'), git);
});

// Review 2026-10-23: a doc with no Updated: line had its new Retired: line written as line 1, above the title, where the
// capture's head reader finds it but the doc no longer opens on its title.
test('crucial seed: a 2.9.0 doc with no Updated: line gets its Retired: line under the title, never above it', () =>
{
    const root = project({ files: { [`${PREFS}/GIT-PREFERENCES.md`]: SEED_290().replace('Updated: 2026-10-21\n', '') } });
    prefsRun(root);
    const git = fs.readFileSync(path.join(root, PREFS, 'GIT-PREFERENCES.md'), 'utf8');
    assert.ok(git.startsWith('# Git preferences\n'), JSON.stringify(git.slice(0, 80)));
    assert.match(git, /^# Git preferences\n\n(?:\n)?Retired: G2, G5, G7, G8\n/, JSON.stringify(git.slice(0, 120)));
    assert.strictEqual(lintOf(root).stdout.trim().split('\n').filter((l) => /^PROBLEM/.test(l)).map((l) => l.replace(/^PROBLEM \S+: /, '')).join(' | '), 'no `Updated: <date>` line', 'the doc\'s own missing stamp is its one problem');
    assert.strictEqual(prefsRun(root).preferences.git, 'present', 'a re-run changes nothing');
});

test('crucial seed: what the user changed in a 2.9.0 doc stays - an edited entry kept, an edited scope lock dropped, their ids and Retired: line respected', () =>
{
    const edited = SEED_290()
        .replace('Updated: 2026-10-21\n', 'Updated: 2026-10-21\nRetired: G10\n')
        .replace(/(<!-- locked: scope -->\n- Rule: )the scope at a commit ask/, '$1for us, the scope at a commit ask')
        .replace("- Rule: name a branch `<type>/<short-description>` or `<type>/<ticket-id>`.", '- Rule: name a branch `feature/<ticket>`.')
        .replace(/(## G8 - Commit message shape\n<!-- id: g8 -->\n- Rule: )[^\n]*/, '$1one line, the ticket id first.')
        + '\n## G9 - Sign every tag\n<!-- id: g9 -->\n- Rule: sign every release tag.\n';
    const root = project({ files: { [`${PREFS}/GIT-PREFERENCES.md`]: edited } });
    const logs = [];
    const out = prefsRun(root, (m) => logs.push(m));
    const git = fs.readFileSync(path.join(root, PREFS, 'GIT-PREFERENCES.md'), 'utf8');
    assert.strictEqual(out.preferences.git, 'retired G7; locked attribution; unlocked G2; updated checkpoint, safety; merged checks');
    assert.deepStrictEqual(headsOf(git), ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G8', 'G9', 'G11']);
    assert.match(git, /^Retired: G7, G10$/m);
    assert.match(git, /^## G2 - Derive the commit scope fresh\n<!-- id: g2 -->\n- Rule: for us, the scope/m, 'the changed entry stays, its lock dropped');
    assert.match(git, /feature\/<ticket>/);
    assert.match(git, /- Rule: one line, the ticket id first\./);
    assert.match(git, /Critical: the probe path/, 'an edited entry keeps its example too');
    assert.match(git, /sign every release tag/);
    assert.ok(logs.some((m) => /!! preferences: .*GIT-PREFERENCES\.md G2 was locked as 'scope', a key the seed no longer has - its lock is dropped/.test(m)), logs.join(' | '));
    assert.strictEqual(lintOf(root).stdout.trim(), 'lint: 0 problems');
    assert.strictEqual(prefsRun(root).preferences.git, 'present', 'a re-run changes nothing');
});

test('crucial seed: an attribution entry the user changed is not locked over - the house line is merged and the copy named', () =>
{
    const edited = SEED_290().replace(/(## G6 - No AI attribution\n<!-- id: g6 -->\n- Rule: [^\n]*\n- Scope: )[^\n]*/, '$1commit messages only');
    const root = project({ files: { [`${PREFS}/GIT-PREFERENCES.md`]: edited } });
    const logs = [];
    const out = prefsRun(root, (m) => logs.push(m));
    const git = fs.readFileSync(path.join(root, PREFS, 'GIT-PREFERENCES.md'), 'utf8');
    assert.strictEqual(out.preferences.git, 'retired G2, G5, G7, G8; updated checkpoint, safety; merged attribution, checks');
    assert.deepStrictEqual(headsOf(git), ['G1', 'G3', 'G4', 'G6', 'G9', 'G10']);
    assert.match(git, /^## G6 - No AI attribution\n<!-- id: g6 -->\n- Rule: never mention yourself[^\n]*\n- Scope: commit messages only/m, 'the user\'s copy stays unlocked');
    assert.match(git, /^## G9 - No AI attribution\n<!-- id: g9 -->\n<!-- locked: attribution -->/m);
    assert.ok(logs.some((m) => /!! preferences: .*G6 repeats the locked 'attribution' entry's title without its lock/.test(m)), logs.join(' | '));
    assert.match(lintOf(root).stdout, /G6 repeats the locked 'attribution' entry's title without its lock/);
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
    assert.deepStrictEqual(again.preferences, PREFS_RESULT('present'), 'a re-run is quiet');
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

// --- the tools inventory's refresh (tool preferences, phase 1) ------------

// A stack plugin's server recorded from the table at the pin it ships now: a refresh finds nothing to do.
const TABLE_ONLY = () =>
{
    const t = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'stack', 'skills', 'capture-preferences', 'scripts', 'tool-adapters.json'), 'utf8')).types.serena;
    const prefix = 'mcp__plugin_alfred-navigation_alfred-navigation__'; // mcp-fixture
    const tools = Object.fromEntries(t.tools.map((n) => [n, { readOnly: null, destructive: t.edit.includes(n) ? true : null, target: null }]));
    return `${JSON.stringify({ version: 1, captured: '2026-10-24', servers: { [prefix]: { name: 'alfred-navigation', prefix, scope: 'plugin', plugin: 'alfred-navigation', type: 'serena', version: t.version, registration: 'x', listed: 'table', tools } } }, null, 2)}\n`;
};
const INVENTORY = '.alfred/state/tools-inventory.json';

test('preferences: a table-only inventory is refreshed to nothing and left byte for byte', () =>
{
    const body = TABLE_ONLY();
    const root = project({ files: { [INVENTORY]: body } });
    const out = docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs' });
    assert.deepStrictEqual(out.preferences.tools, []);
    assert.strictEqual(fs.readFileSync(path.join(root, INVENTORY), 'utf8'), body);
});

test('preferences: the refresh runs the snapshot\'s tools.js only where an inventory was taken, and logs what it says', () =>
{
    const calls = [];
    const answer = (result) => (cmd, args, opts) => { calls.push({ cmd, args, opts }); return result; };
    const bare = project();
    assert.deepStrictEqual(docs.migrateDocsDomains({ projectRoot: bare, docsPath: '.claude/docs', spawn: answer({ status: 0, stdout: '' }) }).preferences.tools, []);
    assert.strictEqual(calls.filter((c) => c.args[1] === 'refresh').length, 0, 'no inventory: no refresh spawned');
    calls.length = 0;
    const root = project({ files: { [INVENTORY]: TABLE_ONLY() } });
    const logs = [];
    const out = docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs', log: (m) => logs.push(m), spawn: answer({ status: 0, stdout: 'tools: mcp__x__ re-listed - 3 tools\n' }) });
    assert.deepStrictEqual(out.preferences.tools, ['tools: mcp__x__ re-listed - 3 tools']);
    assert.strictEqual(calls.find((x) => x.args[1] === 'refresh').cmd, process.execPath);
    assert.ok(calls.find((x) => x.args[1] === 'refresh').args[0].endsWith(path.join('capture-preferences', 'scripts', 'tools.js')), calls.find((x) => x.args[1] === 'refresh').args[0]);
    assert.deepStrictEqual(calls.find((x) => x.args[1] === 'refresh').args.slice(1), ['refresh', '--project', root]);
    assert.strictEqual(calls.find((x) => x.args[1] === 'refresh').opts.timeout, 60000);
    assert.ok(logs.includes('  tools: mcp__x__ re-listed - 3 tools'), logs.join('\n'));
    const late = docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs', log: () => {}, spawn: answer({ status: null, error: Object.assign(new Error('t'), { code: 'ETIMEDOUT' }), stdout: '' }) });
    assert.deepStrictEqual(late.preferences.tools, ['!! tools: the inventory refresh did not finish in 60s - its recorded tools stand; /capture-preferences tools takes it again']);
    // what it said before the cap is kept, the late line after it (the final review, I5)
    const partial = docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs', log: () => {}, spawn: answer({ status: null, error: Object.assign(new Error('t'), { code: 'ETIMEDOUT' }), stdout: 'tools: mcp__x__ re-listed - 3 tools\n' }) });
    assert.deepStrictEqual(partial.preferences.tools, ['tools: mcp__x__ re-listed - 3 tools', '!! tools: the inventory refresh did not finish in 60s - its recorded tools stand; /capture-preferences tools takes it again']);
});

test('the language-server check runs the snapshot\'s tools.js lsp on every run, an inventory or not', () =>
{
    const calls = [];
    const answer = (result) => (cmd, args, opts) => { calls.push({ cmd, args, opts }); return result; };
    const bare = project();
    const logs = [];
    const lines = docs.lspCoverageLines(bare, (m) => logs.push(m), { spawn: answer({ status: 0, stdout: "lsp: none covers this project's files - navigation starts at the grep\n" }) });
    const call = calls.find((x) => x.args[1] === 'lsp');
    assert.ok(call, 'spawned with no inventory');
    assert.strictEqual(call.cmd, process.execPath);
    assert.ok(call.args[0].endsWith(path.join('capture-preferences', 'scripts', 'tools.js')), call.args[0]);
    assert.deepStrictEqual(call.args.slice(1), ['lsp', '--changed-only', '--project', bare]);
    assert.strictEqual(call.opts.timeout, 30000);
    assert.deepStrictEqual(lines, ["lsp: none covers this project's files - navigation starts at the grep"]);
    assert.ok(logs.includes("  lsp: none covers this project's files - navigation starts at the grep"), logs.join('\n'));
    const late = docs.lspCoverageLines(bare, () => {}, { spawn: answer({ status: null, error: Object.assign(new Error('t'), { code: 'ETIMEDOUT' }), stdout: '' }) });
    assert.deepStrictEqual(late, ['!! lsp: the language-server check did not finish in 30s - the last result stands; the next run checks again']);
    const stopped = docs.lspCoverageLines(bare, () => {}, { spawn: answer({ status: 1, stdout: '' }) });
    assert.deepStrictEqual(stopped, ['!! lsp: the language-server check stopped (exit 1) - the last result stands; the next run checks again']);
});

// Fix-pass review m1: an ALFRED_CODE_DATA_PATH the session exported outranks the settings files in the child, and during a
// --data-path move it names the old root - both children get the root this run resolved.
test('the tools.js children read the data root this run resolved, over an exported one', () =>
{
    const calls = [];
    const answer = (cmd, args, opts) => { calls.push({ args, opts }); return { status: 0, stdout: '' }; };
    const was = process.env.ALFRED_CODE_DATA_PATH;
    process.env.ALFRED_CODE_DATA_PATH = '.old-root';
    try
    {
        const root = project({ files: { '.new-root/state/tools-inventory.json': TABLE_ONLY() } });
        docs.lspCoverageLines(root, () => {}, { spawn: answer, dataPath: '.new-root' });
        docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs', dataPath: '.new-root', log: () => {}, spawn: answer });
        for (const job of ['lsp', 'refresh'])
        {
            const call = calls.find((x) => x.args[1] === job);
            assert.ok(call, `${job} spawned`);
            assert.strictEqual(call.opts.env.ALFRED_CODE_DATA_PATH, '.new-root', job);
        }
        calls.length = 0;
        docs.lspCoverageLines(root, () => {}, { spawn: answer });
        assert.strictEqual(calls[0].opts.env.ALFRED_CODE_DATA_PATH, '.old-root', 'no root handed over: the inherited env as before');
    }
    finally
    {
        if (was === undefined) delete process.env.ALFRED_CODE_DATA_PATH;
        else process.env.ALFRED_CODE_DATA_PATH = was;
    }
});

test('tickets/ is a stack docs folder (item 5)', () => { assert.ok(docs.STACK_DOCS.has('tickets')); });

test('explanations/ and the old tutorial/ are stack docs folders (item 6)', () => {
  for (const n of ['explanations', 'tutorial']) assert.ok(docs.STACK_DOCS.has(n), n);
});

// F3 / F15 (the 2026-10-28 workspace run): the walk recommended the docs-versioning answer from its own reading - `git`
// for a folder with no repository, and for a local-scope child whose data root git never sees. A script states it.
test('docsVersioningAdvice: no repository, a local-scope child, kept-out docs, a project-scope child, a fresh repo', () =>
{
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-'));
    try
    {
        const none = docs.docsVersioningAdvice({ projectRoot: bare, docsPath: '.alfred/docs' });
        assert.strictEqual(none.value, 'local');
        assert.match(none.reason, /no git repository/);
    }
    finally { fs.rmSync(bare, { recursive: true, force: true }); }
    const repo = project();
    const child = docs.docsVersioningAdvice({ projectRoot: repo, docsPath: '.claude/docs', scope: 'local', child: true });
    assert.deepStrictEqual(child, { value: 'local', reason: 'a local-scope child keeps its data root out of git' });
    assert.strictEqual(docs.docsVersioningAdvice({ projectRoot: repo, docsPath: '.claude/docs', scope: 'project', child: true }).value, 'git');
    const kept = project({ ignore: '.claude/docs/\n' });
    fs.mkdirSync(path.join(kept, '.claude', 'docs'), { recursive: true });
    assert.deepStrictEqual(docs.docsVersioningAdvice({ projectRoot: kept, docsPath: '.claude/docs' }), { value: 'local', reason: 'the docs are kept out of git here' });
    assert.deepStrictEqual(docs.docsVersioningAdvice({ projectRoot: project(), docsPath: '.claude/docs' }), { value: 'git', reason: 'a git repository - the docs are committed and versioned per branch' });
});

test('docsVersioningAdvice: a fake git with only tracked / ignored keeps today\'s answers', () =>
{
    const fake = { tracked: () => false, ignored: () => true };
    assert.strictEqual(docs.docsVersioningAdvice({ projectRoot: project(), docsPath: '.claude/docs', git: fake }).value, 'local');
    assert.strictEqual(docs.docsVersioningAdvice({ projectRoot: project(), docsPath: '.claude/docs', git: { tracked: () => false, ignored: () => false } }).value, 'git');
});

// THE ARCHITECTURE MOVE AND THE RUN BOOK'S NEW NAME (spec 2026-10-29 2.1 and section 5): the map leaves architecture/ for
// awareness/ (migrateArchitecture, after the general migrateLayout), the run book takes RUN-AND-DEBUG-AWARENESS.md
// (DOCS_MIGRATIONS), and every ref the stack wrote follows; a file the stack does not own is named, never rewritten.
const ARCH = '.alfred/docs/architecture';
const AW = '.alfred/docs/awareness';
const PENDING = '.alfred/state/migrations/architecture-move.pending';
const MAP_TEXT = 'Captured: main@abc1234, 2026-10-01\n\n# Architecture\n\n## Modules\n<!-- id: modules -->\n- src/ holds the modules; setup in ORIENTATION#setup\n';
const ORIENT_TEXT = '# Orientation\n\n## Setup\n<!-- id: setup -->\n- read ARCHITECTURE#modules first\n';
const API_REF = '# API\n\n## Routes\n<!-- id: routes -->\n- the routes, see architecture/ARCHITECTURE#modules\n';
const HISTORY_DOC = '# 2026-01\n\n- the old layout\n';
// The retired marker rule as 3.3.0 wrote it (uninstall.js keeps the same literal).
const ARCH_MARKER_RULE = `---\ndescription: Project architecture capture marker - generated by ${oldCapture('architecture')}; edit via a re-run.\n---\n\nThe architecture docs are captured for this project - read them before a structural change.\n`;
const migrateArch = (root, logs = []) => docs.migrateArchitecture({ projectRoot: root, docsPath: '.alfred/docs', dataPath: '.alfred', rules: rulesOf(root), log: (m) => logs.push(m) });
const readAt = (root, rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
const hasAt = (root, rel) => fs.existsSync(path.join(root, ...rel.split('/')));
// Every file and folder under the project but .git, each file's bytes as text.
function treeOf(root)
{
    const out = {};
    const walk = (dir) =>
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            if (e.name === '.git') continue;
            const p = path.join(dir, e.name);
            const rel = path.relative(root, p).split(path.sep).join('/');
            if (e.isDirectory()) { out[`${rel}/`] = ''; walk(p); }
            else out[rel] = fs.readFileSync(p, 'latin1');
        }
    };
    walk(root);
    return out;
}

test('the run book renames from both older homes in one run', () =>
{
    const book = 'Captured: main@abc1234, 2026-10-01\n\n# Run book\n\n## Build\n<!-- id: build -->\n- `npm run build`; see PROJECT-AWARENESS#build\n';
    const user = '# My notes\n\nsee PROJECT-AWARENESS#build\nand docs/ARCHITECTURE.md#layers\n';
    const plan = '# Plan\n\nfollow PROJECT-AWARENESS#build\n';
    const shared = {
        '.alfred/docs/quality/watch.json': '{\n  "recomputed": true\n}\n',
        '.alfred/docs/quality/ARCHITECTURE-ASSESSMENT.md': '# Assessment\n\n- the build: PROJECT-AWARENESS#build\n',
        [`${AW}/RELATED-PROJECTS-AWARENESS.md`]: '# Related projects\n\nbuild first: PROJECT-AWARENESS#build\n',
        [`${AW}/USER-AWARENESS.md`]: user,
        '.alfred/docs/plans/p.md': plan,
        '.claude/rules/alfred-related-context.md': '# notes\n\nthe run book build: PROJECT-AWARENESS#build\n',
    };
    const watch = '{\n  "watch": [\n    { "kind": "run book: build", "globs": ["package.json"], "sections": ["PROJECT-AWARENESS#build"] }\n  ]\n}\n';
    for (const [shape, home, branch] of [['2.5.0', 'project-awareness', '.alfred/docs/.branches/b/project-awareness/PROJECT-AWARENESS/build.md'],
        ['3.3.0', 'awareness', '.alfred/docs/.branches/b/awareness/PROJECT-AWARENESS/build.md']])
    {
        const root = project({ files: { ...shared, [`.alfred/docs/${home}/PROJECT-AWARENESS.md`]: book, [`.alfred/docs/${home}/watch.json`]: watch, [branch]: '## Build\n- PROJECT-AWARENESS#build again\n' } });
        const logs = [];
        const out = docs.migrateDocsDomains({ projectRoot: root, docsPath: '.alfred/docs', rules: rulesOf(root), instructions: instructionsOf(root), log: (m) => logs.push(m) });
        assert.ok(out.moved.includes('awareness/RUN-AND-DEBUG-AWARENESS.md'), `${shape}: ${out.moved}`);
        assert.ok(!hasAt(root, `${AW}/PROJECT-AWARENESS.md`) && !hasAt(root, '.alfred/docs/project-awareness'), shape);
        assert.strictEqual(readAt(root, `${AW}/RUN-AND-DEBUG-AWARENESS.md`), book.replace('see PROJECT-AWARENESS#build', 'see RUN-AND-DEBUG-AWARENESS#build'), shape);
        assert.strictEqual(readAt(root, '.alfred/docs/quality/ARCHITECTURE-ASSESSMENT.md'), '# Assessment\n\n- the build: RUN-AND-DEBUG-AWARENESS#build\n', `${shape}: a quality doc`);
        assert.strictEqual(readAt(root, `${AW}/RELATED-PROJECTS-AWARENESS.md`), '# Related projects\n\nbuild first: RUN-AND-DEBUG-AWARENESS#build\n', `${shape}: an awareness doc`);
        assert.deepStrictEqual(JSON.parse(readAt(root, `${AW}/watch.json`)).watch[0].sections, ['RUN-AND-DEBUG-AWARENESS#build'], `${shape}: awareness/watch.json`);
        assert.strictEqual(readAt(root, '.claude/rules/alfred-related-context.md'), '# notes\n\nthe run book build: RUN-AND-DEBUG-AWARENESS#build\n', `${shape}: a generated rule`);
        assert.strictEqual(readAt(root, '.alfred/docs/.branches/b/awareness/RUN-AND-DEBUG-AWARENESS/build.md'), '## Build\n- RUN-AND-DEBUG-AWARENESS#build again\n', `${shape}: the branch version moved and respelled`);
        assert.ok(!hasAt(root, branch), shape);
        // a file the stack does not own: byte for byte, named once with !!
        assert.strictEqual(readAt(root, '.alfred/docs/plans/p.md'), plan, shape);
        assert.strictEqual(readAt(root, `${AW}/USER-AWARENESS.md`), user, `${shape}: the user's own notes are never rewritten (D10)`);
        const named = (file) => logs.filter((m) => m.startsWith('  !! ') && m.includes(file));
        assert.deepStrictEqual(named('plans/p.md'), ['  !! docs migration (awareness): .alfred/docs/plans/p.md:3 names PROJECT-AWARENESS#build - plan it with update-preflight.js --respell'], `${shape}: ${logs.join(' | ')}`);
        assert.deepStrictEqual(named('USER-AWARENESS.md'), ['  !! docs migration (awareness): .alfred/docs/awareness/USER-AWARENESS.md:3 names PROJECT-AWARENESS#build - plan it with update-preflight.js --respell'], `${shape}: the project's own ARCHITECTURE.md ref is not named: ${logs.join(' | ')}`);
        assert.ok(logs.includes('  docs migration (awareness): the run book is RUN-AND-DEBUG-AWARENESS.md - run /capture-awareness project to write the project info and the resources docs'), `${shape}: ${logs.join(' | ')}`);
        assert.deepStrictEqual(importsOf(awarenessRuleOf(root)).map((i) => path.basename(i)), ['RUN-AND-DEBUG-AWARENESS.md', 'USER-AWARENESS.md'], `${shape}: the sibling doc holds no entry yet, so it is not imported`);
    }

    // both names present: left alone and named, nothing respelled
    const both = project({ files: { [`${AW}/PROJECT-AWARENESS.md`]: '# old\n', [`${AW}/RUN-AND-DEBUG-AWARENESS.md`]: '# new\n', '.alfred/docs/quality/watch.json': '{}\n', '.alfred/docs/quality/Q.md': 'PROJECT-AWARENESS#build\n' } });
    const logs = [];
    const out = docs.migrateDocsDomains({ projectRoot: both, docsPath: '.alfred/docs', rules: rulesOf(both), log: (m) => logs.push(m) });
    assert.deepStrictEqual(out.moved, []);
    assert.deepStrictEqual([readAt(both, `${AW}/PROJECT-AWARENESS.md`), readAt(both, `${AW}/RUN-AND-DEBUG-AWARENESS.md`), readAt(both, '.alfred/docs/quality/Q.md')], ['# old\n', '# new\n', 'PROJECT-AWARENESS#build\n']);
    assert.ok(logs.some((m) => /docs migration \(awareness\): .*RUN-AND-DEBUG-AWARENESS\.md already exists - .*PROJECT-AWARENESS\.md left in place, nothing overwritten/.test(m)), logs.join(' | '));
    assert.ok(!logs.some((m) => /the run book is RUN-AND-DEBUG-AWARENESS\.md/.test(m)), 'nothing was renamed this run');
});

test('the respell keeps a sibling\'s first_read (D10)', () =>
{
    const related = 'Captured: main@abc1234, 2026-10-01\n\n# Related projects\n\n## acme-api\n<!-- id: acme-api -->\n\n```yaml\nlocation:   ../acme-api\nrelation:   provides-to\nfirst_read: [.alfred/docs/architecture/ARCHITECTURE.md]\n```\n\nThe seam: ARCHITECTURE#modules names the client.\n';
    const root = project({ files: { [`${ARCH}/ARCHITECTURE.md`]: MAP_TEXT, [`${AW}/RELATED-PROJECTS-AWARENESS.md`]: related, [`${AW}/watch.json`]: '{}\n' } });
    const logs = [];
    migrateArch(root, logs);
    assert.strictEqual(readAt(root, `${AW}/RELATED-PROJECTS-AWARENESS.md`), related.replace('The seam: ARCHITECTURE#modules', 'The seam: ARCHITECTURE-AWARENESS#modules'), 'the seam line respelled, the first_read line byte for byte');
    const named = logs.filter((m) => m.startsWith('  !! ') && m.includes('first_read'));
    assert.deepStrictEqual(named, ['  !! docs migration (awareness): .alfred/docs/awareness/RELATED-PROJECTS-AWARENESS.md:11 first_read: is a path in acme-api - left as it is; re-run /capture-awareness related-projects once acme-api updates'], logs.join(' | '));
    const before = treeOf(root);
    const again = [];
    migrateArch(root, again);
    assert.deepStrictEqual(again.filter((m) => m.includes('first_read')), [], 'a second run names it no more');
    assert.deepStrictEqual(treeOf(root), before, 'and changes nothing');
});

test('migrateArchitecture moves the map: the files, the watch merge, the overlays, the refs, the old domain and the rule', () =>
{
    const archWatch = { sourceRoots: ['src'], newModule: { globs: ['src/*/'] },
        watch: [{ kind: 'module map', globs: ['src/**'], sections: ['ARCHITECTURE#modules', 'references/api#routes'] }, { kind: 'architecture: seams', globs: ['api/**'], sections: ['references/api#routes'] }],
        notOwned: ['ORIENTATION.md', 'NOTES.md'] };
    const awWatch = { sourceRoots: ['app'], watch: [{ kind: 'run book: build', globs: ['package.json'], sections: ['RUN-AND-DEBUG-AWARENESS#build'] }], notOwned: ['AGENTS-AWARENESS.md', 'NOTES.md'] };
    const book = 'Captured: main@abc1234, 2026-10-01\n\n# Run and debug\n\n## Build\n<!-- id: build -->\n- modules: ARCHITECTURE#modules, ARCHITECTURE.md#modules, architecture/ARCHITECTURE#modules\n- setup: ORIENTATION#setup\n- kept: ARCHITECTURE-PREFERENCES#x, ARCHITECTURE-ASSESSMENT#x, ARCHITECTURE-AWARENESS#modules\n';
    const root = project({ files: {
        [`${ARCH}/ARCHITECTURE.md`]: MAP_TEXT, [`${ARCH}/ORIENTATION.md`]: ORIENT_TEXT, [`${ARCH}/references/api.md`]: API_REF,
        [`${ARCH}/history/2026-01.md`]: HISTORY_DOC, [`${ARCH}/watch.json`]: `${JSON.stringify(archWatch, null, 2)}\n`,
        [`${AW}/watch.json`]: `${JSON.stringify(awWatch, null, 2)}\n`, [`${AW}/RUN-AND-DEBUG-AWARENESS.md`]: book,
        '.alfred/docs/quality/watch.json': '{\n  "recomputed": true\n}\n',
        '.alfred/docs/quality/ARCHITECTURE-ASSESSMENT.md': '# Assessment\n\n- the map: ARCHITECTURE#modules; quality/ARCHITECTURE-ASSESSMENT#x stays\n',
        '.claude/rules/alfred-related-context.md': '# notes\n\nthe modules: ARCHITECTURE#modules\n',
        '.claude/rules/alfred-architecture.md': ARCH_MARKER_RULE,
        '.alfred/docs/.branches/b/architecture/ARCHITECTURE/modules.md': '## Modules\n- branch: ARCHITECTURE#modules\n',
        '.alfred/docs/.branches/b/.base/architecture/ARCHITECTURE/modules.md': '## Modules\n- base: ARCHITECTURE#modules\n',
        '.alfred/docs/.branches/b/.conflict/architecture/ARCHITECTURE/modules.md': 'conflict\n',
        '.alfred/docs/.branches/b/architecture/references/api/routes.md': '## Routes\n- branch\n',
        '.alfred/docs/.branches/b/architecture/history/2026-01/x.md': 'x\n',
    } });
    const out = migrateArch(root);
    // step 1: the files at their new names, architecture/ gone with its history/
    assert.strictEqual(readAt(root, `${AW}/ARCHITECTURE-AWARENESS.md`), MAP_TEXT.replace('ORIENTATION#setup', 'ARCHITECTURE-ORIENTATION-AWARENESS#setup'));
    assert.strictEqual(readAt(root, `${AW}/ARCHITECTURE-ORIENTATION-AWARENESS.md`), ORIENT_TEXT.replace('ARCHITECTURE#modules', 'ARCHITECTURE-AWARENESS#modules'));
    assert.strictEqual(readAt(root, `${AW}/references/api.md`), API_REF.replace('architecture/ARCHITECTURE#modules', 'awareness/ARCHITECTURE-AWARENESS#modules'));
    assert.strictEqual(readAt(root, `${AW}/history/2026-01.md`), HISTORY_DOC);
    assert.ok(!hasAt(root, ARCH), 'the emptied architecture/ goes, history/ included');
    assert.deepStrictEqual(out.moved, ['.alfred/docs/architecture -> .alfred/docs/awareness']);
    assert.deepStrictEqual(out.kept, []);
    // step 2: the merge - awareness's own keys win, the notOwned lists join, each kind prefixed once
    assert.strictEqual(out.merged, 'merged');
    assert.deepStrictEqual(JSON.parse(readAt(root, `${AW}/watch.json`)), {
        sourceRoots: ['app'], newModule: { globs: ['src/*/'] },
        watch: [awWatch.watch[0], { kind: 'architecture: module map', globs: ['src/**'], sections: ['ARCHITECTURE-AWARENESS#modules', 'references/api#routes'] },
            { kind: 'architecture: seams', globs: ['api/**'], sections: ['references/api#routes'] }],
        notOwned: ['AGENTS-AWARENESS.md', 'NOTES.md', 'ORIENTATION.md'],
    });
    // step 3: every lane's overlay under its new key, each emptied architecture/ folder gone
    const B = '.alfred/docs/.branches/b';
    assert.strictEqual(readAt(root, `${B}/awareness/ARCHITECTURE-AWARENESS/modules.md`), '## Modules\n- branch: ARCHITECTURE-AWARENESS#modules\n');
    assert.strictEqual(readAt(root, `${B}/.base/awareness/ARCHITECTURE-AWARENESS/modules.md`), '## Modules\n- base: ARCHITECTURE-AWARENESS#modules\n');
    assert.strictEqual(readAt(root, `${B}/.conflict/awareness/ARCHITECTURE-AWARENESS/modules.md`), 'conflict\n');
    assert.strictEqual(readAt(root, `${B}/awareness/references/api/routes.md`), '## Routes\n- branch\n');
    assert.strictEqual(readAt(root, `${B}/awareness/history/2026-01/x.md`), 'x\n');
    for (const lane of ['', '/.base', '/.conflict']) assert.ok(!hasAt(root, `${B}${lane}/architecture`), `${lane || 'the branch'}: architecture/ goes`);
    // step 4: the refs - bare, .md and domain-qualified; a longer name and a ref already respelled left alone
    assert.strictEqual(readAt(root, `${AW}/RUN-AND-DEBUG-AWARENESS.md`), book
        .replace('ARCHITECTURE#modules, ARCHITECTURE.md#modules, architecture/ARCHITECTURE#modules', 'ARCHITECTURE-AWARENESS#modules, ARCHITECTURE-AWARENESS.md#modules, awareness/ARCHITECTURE-AWARENESS#modules')
        .replace('setup: ORIENTATION#setup', 'setup: ARCHITECTURE-ORIENTATION-AWARENESS#setup'));
    assert.strictEqual(readAt(root, '.alfred/docs/quality/ARCHITECTURE-ASSESSMENT.md'), '# Assessment\n\n- the map: ARCHITECTURE-AWARENESS#modules; quality/ARCHITECTURE-ASSESSMENT#x stays\n');
    assert.strictEqual(readAt(root, '.claude/rules/alfred-related-context.md'), '# notes\n\nthe modules: ARCHITECTURE-AWARENESS#modules\n');
    assert.ok(out.respelled.includes('.alfred/docs/awareness/RUN-AND-DEBUG-AWARENESS.md') && out.respelled.includes('.claude/rules/alfred-related-context.md'), out.respelled.join(', '));
    assert.strictEqual(out.removed, true);
    // step 6: the rule ends on the map's line, and the 3.3.0 marker is gone
    const rule = awarenessRuleOf(root).trimEnd().split('\n');
    assert.match(rule[rule.length - 1], /^Architecture map: `[^`]*awareness\/ARCHITECTURE-AWARENESS\.md` - read it by section before a structural change\.$/, rule.join('\n'));
    assert.ok(!rule.some((l) => l.startsWith('@') && l.includes('ARCHITECTURE-AWARENESS')), 'the map is pointed at, never imported');
    assert.ok(!hasAt(root, '.claude/rules/alfred-architecture.md'), 'the superseded marker goes');
    assert.ok(!hasAt(root, PENDING), 'the pending marker goes last');
});

test('migrateArchitecture: a failed move is undone whole - no watch merge, overlay move or respell after it', () =>
{
    const root = project({ files: {
        [`${ARCH}/ARCHITECTURE.md`]: MAP_TEXT, [`${ARCH}/ORIENTATION.md`]: ORIENT_TEXT, [`${ARCH}/references/api.md`]: API_REF,
        [`${ARCH}/watch.json`]: '{\n  "watch": [{ "kind": "m", "globs": ["src/**"], "sections": ["ARCHITECTURE#modules"] }]\n}\n',
        [`${AW}/watch.json`]: '{}\n', [`${AW}/RUN-AND-DEBUG-AWARENESS.md`]: '- ARCHITECTURE#modules\n',
        '.alfred/docs/.branches/b/architecture/ARCHITECTURE/modules.md': '## Modules\n',
    } });
    const before = treeOf(root);
    const real = fs.renameSync;
    let calls = 0;
    fs.renameSync = (...args) => { calls += 1; if (calls === 2) throw new Error('EACCES: the second file'); return real(...args); };
    let caught = null;
    try { migrateArch(root); }
    catch (err) { caught = err; }
    finally { fs.renameSync = real; }
    assert.ok(caught && caught.step === 1 && /EACCES: the second file/.test(caught.message), String(caught));
    assert.deepStrictEqual(treeOf(root), before, 'every file back where it was, no marker, nothing merged, moved or respelled');
});

test('migrateArchitecture: the absent-only watch.json (D8)', () =>
{
    // a pre-domains architecture/ with no watch.json and no awareness doc: `{}` is written, and the engine reads the map
    const bare = project({ files: { [`${ARCH}/ARCHITECTURE.md`]: MAP_TEXT } });
    migrateArch(bare);
    // step 2 writes `{}`; step 6's rule then adds the inventory's notOwned entry, as every capture run does
    const ownedOnly = '{\n  "notOwned": [\n    "AGENTS-AWARENESS.md"\n  ]\n}\n';
    assert.strictEqual(readAt(bare, `${AW}/watch.json`), ownedOnly);
    const env = { ...process.env, CLAUDE_PROJECT_DIR: bare, ALFRED_CODE_DOCS_PATH: '.alfred/docs', ALFRED_CODE_DOCS_VERSIONING: '' };
    const shown = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'stack', 'hooks', 'docs.js'), 'show', 'ARCHITECTURE-AWARENESS#modules'], { cwd: bare, encoding: 'utf8', env });
    assert.match(shown.stdout, /src\/ holds the modules/, shown.stdout + shown.stderr);

    // an awareness watch.json of its own, and no architecture one: never rewritten
    const own = '{\r\n\t"watch": []\r\n}';
    const kept = project({ files: { [`${ARCH}/ARCHITECTURE.md`]: MAP_TEXT, [`${AW}/watch.json`]: own } });
    const out = migrateArch(kept);
    assert.strictEqual(out.merged, 'none');
    // nothing merged; the rule's notOwned entry joins it in the file's own tab indent and CRLF, still with no final newline
    assert.strictEqual(readAt(kept, `${AW}/watch.json`), '{\r\n\t"watch": [],\r\n\t"notOwned": [\r\n\t\t"AGENTS-AWARENESS.md"\r\n\t]\r\n}');

    // an architecture watch.json that is not JSON: kept in place and named, nothing merged
    const broken = project({ files: { [`${ARCH}/ARCHITECTURE.md`]: MAP_TEXT, [`${ARCH}/watch.json`]: '{ not json' } });
    const logs = [];
    const r = migrateArch(broken, logs);
    assert.strictEqual(r.merged, 'kept');
    assert.strictEqual(readAt(broken, `${ARCH}/watch.json`), '{ not json');
    assert.strictEqual(readAt(broken, `${AW}/watch.json`), ownedOnly, 'the moved map still sits in a domain the engine reads');
    assert.ok(logs.some((m) => /^ {2}!! docs migration \(awareness\): architecture\/watch\.json is left in place - it is not valid JSON/.test(m)), logs.join(' | '));
    assert.ok(logs.some((m) => /^ {2}!! docs migration \(awareness\): architecture\/ kept - it still holds watch\.json/.test(m)), logs.join(' | '));
});

test('migrateArchitecture: both homes - every file kept and each clash named', () =>
{
    const root = project({ files: {
        [`${ARCH}/ARCHITECTURE.md`]: `${MAP_TEXT}- an edit of mine\n`, [`${ARCH}/references/api.md`]: 'old api\n',
        [`${AW}/ARCHITECTURE-AWARENESS.md`]: MAP_TEXT, [`${AW}/references/api.md`]: API_REF, [`${AW}/watch.json`]: '{}\n',
    } });
    const logs = [];
    const out = migrateArch(root, logs);
    assert.strictEqual(readAt(root, `${ARCH}/ARCHITECTURE.md`), `${MAP_TEXT}- an edit of mine\n`);
    assert.strictEqual(readAt(root, `${AW}/ARCHITECTURE-AWARENESS.md`), MAP_TEXT);
    assert.strictEqual(readAt(root, `${ARCH}/references/api.md`), 'old api\n');
    assert.strictEqual(readAt(root, `${AW}/references/api.md`), API_REF, 'nothing respelled while the old map stays');
    assert.deepStrictEqual(out.kept.slice().sort(), [`${ARCH}/ARCHITECTURE.md`, `${ARCH}/references/api.md`]);
    for (const [from, to] of [['ARCHITECTURE.md', 'ARCHITECTURE-AWARENESS.md'], ['references/api.md', 'references/api.md']])
        assert.ok(logs.includes(`  layout: kept ${ARCH}/${from} - ${AW}/${to} already holds it`), logs.join(' | '));
    assert.ok(logs.some((m) => /^ {2}!! docs migration \(awareness\): architecture\/ kept - it still holds ARCHITECTURE\.md, references/.test(m)), logs.join(' | '));
});

test('migrateArchitecture: a branch version and its base move and respell', () =>
{
    const B = '.alfred/docs/.branches/b';
    const root = project({ files: {
        [`${ARCH}/ARCHITECTURE.md`]: MAP_TEXT,
        [`${B}/architecture/ARCHITECTURE/modules.md`]: '## Modules\n- branch: see ARCHITECTURE#modules\n',
        [`${B}/.base/architecture/ARCHITECTURE/modules.md`]: '## Modules\n- base: see ARCHITECTURE#modules\n',
    } });
    migrateArch(root);
    assert.strictEqual(readAt(root, `${B}/awareness/ARCHITECTURE-AWARENESS/modules.md`), '## Modules\n- branch: see ARCHITECTURE-AWARENESS#modules\n');
    assert.strictEqual(readAt(root, `${B}/.base/awareness/ARCHITECTURE-AWARENESS/modules.md`), '## Modules\n- base: see ARCHITECTURE-AWARENESS#modules\n');
    assert.ok(!hasAt(root, `${B}/architecture`) && !hasAt(root, `${B}/.base/architecture`));
});

test('migrateArchitecture: the watch merge keeps the file\'s EOL, indent and BOM', () =>
{
    const arch = '\uFEFF{\r\n\t"watch": [\r\n\t\t{ "kind": "map", "globs": ["src/**"], "sections": ["ARCHITECTURE#modules"] }\r\n\t]\r\n}\r\n';
    const aw = '{\r\n  "watch": []\r\n}\r\n';
    const root = project({ files: { [`${ARCH}/ARCHITECTURE.md`]: MAP_TEXT, [`${ARCH}/watch.json`]: arch, [`${AW}/watch.json`]: aw } });
    migrateArch(root);
    const text = readAt(root, `${AW}/watch.json`);
    assert.ok(!text.startsWith('\uFEFF'), 'no BOM, as awareness\'s had none');
    assert.ok(text.endsWith('}\r\n') && !/[^\r]\n/.test(text), JSON.stringify(text));
    assert.match(text, /^\{\r\n {2}"watch": \[\r\n {4}\{/, JSON.stringify(text));
    assert.deepStrictEqual(JSON.parse(text).watch, [{ kind: 'architecture: map', globs: ['src/**'], sections: ['ARCHITECTURE-AWARENESS#modules'] }]);

    const bom = project({ files: { [`${ARCH}/ARCHITECTURE.md`]: MAP_TEXT, [`${ARCH}/watch.json`]: '{ "watch": [] , "notOwned": ["X.md"] }\n', [`${AW}/watch.json`]: '\uFEFF{\n    "watch": []\n}\n' } });
    migrateArch(bom);
    const kept = readAt(bom, `${AW}/watch.json`);
    assert.ok(kept.startsWith('\uFEFF{\n    "watch": []'), JSON.stringify(kept));
});

test('migrateArchitecture: a second run changes nothing', () =>
{
    const root = project({ files: {
        [`${ARCH}/ARCHITECTURE.md`]: MAP_TEXT, [`${ARCH}/ORIENTATION.md`]: ORIENT_TEXT, [`${ARCH}/references/api.md`]: API_REF,
        [`${ARCH}/watch.json`]: '{\n  "watch": [{ "kind": "m", "globs": ["src/**"], "sections": ["ARCHITECTURE#modules"] }]\n}\n',
        [`${AW}/RUN-AND-DEBUG-AWARENESS.md`]: '- ARCHITECTURE#modules\n', '.claude/rules/alfred-architecture.md': ARCH_MARKER_RULE,
        '.alfred/docs/.branches/b/architecture/ARCHITECTURE/modules.md': '## Modules\n',
    } });
    migrateArch(root);
    const before = treeOf(root);
    const logs = [];
    migrateArch(root, logs);
    assert.deepStrictEqual(treeOf(root), before);
    assert.deepStrictEqual(logs, []);
});

test('migrateArchitecture: a throw after the move, then a re-run, finishes it (D9)', () =>
{
    const root = project({ files: {
        [`${ARCH}/ARCHITECTURE.md`]: MAP_TEXT, [`${AW}/RUN-AND-DEBUG-AWARENESS.md`]: '- see ARCHITECTURE#modules\n',
        '.alfred/docs/.branches/b/architecture/ARCHITECTURE/modules.md': '## Modules\n',
        '.alfred/docs/.branches/b/awareness': 'a file where the overlay folder goes\n',
    } });
    let caught = null;
    try { migrateArch(root); } catch (err) { caught = err; }
    assert.ok(caught, 'step 3 throws');
    assert.strictEqual(caught.step, 3);
    assert.match(caught.message, /step 3/);
    assert.match(caught.message, /moved/);
    assert.strictEqual(readAt(root, `${AW}/ARCHITECTURE-AWARENESS.md`), MAP_TEXT, 'the map is at its new home');
    assert.ok(hasAt(root, PENDING), 'the pending marker stays for the re-run');
    fs.rmSync(path.join(root, '.alfred/docs/.branches/b/awareness'));
    migrateArch(root);
    assert.strictEqual(readAt(root, '.alfred/docs/.branches/b/awareness/ARCHITECTURE-AWARENESS/modules.md'), '## Modules\n');
    assert.strictEqual(readAt(root, `${AW}/RUN-AND-DEBUG-AWARENESS.md`), '- see ARCHITECTURE-AWARENESS#modules\n');
    assert.ok(!hasAt(root, PENDING), 'the re-run finished and removed it');
});

test('migrateArchitecture: a project\'s own ARCHITECTURE.md citation survives updates (D9)', () =>
{
    const book = '# Run and debug\n\n- deploy: docs/ARCHITECTURE.md#deploy\n- setup: ORIENTATION.md#setup\n';
    const root = project({ files: { [`${AW}/ARCHITECTURE-AWARENESS.md`]: MAP_TEXT, [`${AW}/RUN-AND-DEBUG-AWARENESS.md`]: book, [`${AW}/watch.json`]: '{}\n' } });
    const before = treeOf(root);
    const logs = [];
    migrateArch(root, logs);
    migrateArch(root, logs);
    assert.deepStrictEqual(treeOf(root), before);
    assert.deepStrictEqual(logs, []);
    assert.ok(!hasAt(root, PENDING));
});

test('migrateArchitecture: the map move\'s log names only the moves', () =>
{
    const root = project({ files: {
        [`${ARCH}/ARCHITECTURE.md`]: MAP_TEXT, [`${ARCH}/watch.json`]: '{}\n',
        '.alfred/docs/.branches/b/preferences/PROJECT-CODE-PREFERENCES/naming.md': '## Naming\n',
    } });
    const logs = [];
    migrateArch(root, logs);
    assert.ok(!logs.some((m) => /layout: kept .*watch\.json/.test(m)), logs.join(' | '));
    assert.ok(!logs.some((m) => /layout: current/.test(m)), logs.join(' | '));
    assert.ok(!logs.some((m) => /layout: (?:kept|removed empty) \.branches/.test(m)), logs.join(' | '));
    assert.ok(logs.includes(`  layout: ${ARCH} -> ${AW} (1 file)`), logs.join(' | '));
    const none = project({ files: { [`${AW}/RUN-AND-DEBUG-AWARENESS.md`]: '# Run and debug\n' } });
    const quiet = [];
    migrateArch(none, quiet);
    assert.deepStrictEqual(quiet, [], 'no architecture/, no line at all');
});

// final review C1: the update's `!!` line reads a ref the way --respell plans it - a ref whose spelled name is a file beside
// the citer or at the project root (a team's own ARCHITECTURE.md) is that file's, never named as the moved map.
test('nameForeignRefs leaves a ref to the project\'s own ARCHITECTURE.md unnamed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'name-own-'));
    try {
        const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
        put('.alfred/docs/awareness/ARCHITECTURE-AWARENESS.md', '# Architecture\n');
        put('ARCHITECTURE.md', '# Team architecture\n');
        put('AGENTS.md', '# Agents\n\n- see ARCHITECTURE.md#overview\n- the map: ARCHITECTURE#modules\n');
        const logs = [];
        const named = docs.nameForeignRefs({ projectRoot: dir, base: path.join(dir, '.alfred', 'docs'), keys: docs.completedKeys(path.join(dir, '.alfred', 'docs'), 'awareness', docs.KEY_RENAMES), log: (m) => logs.push(m) });
        assert.deepStrictEqual(named, [], logs.join('\n'));
        fs.rmSync(path.join(dir, 'ARCHITECTURE.md'));
        assert.deepStrictEqual(docs.nameForeignRefs({ projectRoot: dir, base: path.join(dir, '.alfred', 'docs'), keys: docs.completedKeys(path.join(dir, '.alfred', 'docs'), 'awareness', docs.KEY_RENAMES) }), ['AGENTS.md:3', 'AGENTS.md:4'], 'with no such file both refs are the old map');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// final review I1: a domain-qualified ref into the moved references/ or history/ (the spelling the engine's own error
// asks for when two domains hold references/api) follows the move like the map's own keys - spec 2.1 step 4, 'with the
// same pairs' as the overlays; a bare `references/api#routes` already resolves and stays as it is.
test('migrateArchitecture: domain-qualified references/ and history/ refs follow the move', () =>
{
    const quality = '# Assessment\n\n- the routes: architecture/references/api#routes, references/api#routes\n- the past: architecture/history/2026-01#x\n- kept: quality/references/api#routes\n';
    const root = project({ files: {
        [`${ARCH}/ARCHITECTURE.md`]: MAP_TEXT, [`${ARCH}/references/api.md`]: API_REF, [`${ARCH}/history/2026-01.md`]: HISTORY_DOC,
        '.alfred/docs/quality/watch.json': '{\n  "recomputed": true\n}\n',
        '.alfred/docs/quality/ARCHITECTURE-ASSESSMENT.md': quality,
    } });
    migrateArch(root);
    assert.strictEqual(readAt(root, '.alfred/docs/quality/ARCHITECTURE-ASSESSMENT.md'),
        quality.replace('architecture/references/api#routes', 'awareness/references/api#routes').replace('architecture/history/2026-01#x', 'awareness/history/2026-01#x'));
});

// The 3.5.0 review, M5: in a docs root git tracks, the moved docs are staged renames, so the watch.json the move takes
// away leaves through git as well - a staged rename or delete, never a delete left unstaged beside them.
const ARCH_WATCH = '{\n  "watch": [{ "kind": "map", "globs": ["src/**"], "sections": ["ARCHITECTURE#modules"] }]\n}\n';
const porcelain = (root) => execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const unstagedDeletes = (root) => porcelain(root).filter((l) => l.startsWith(' D'));

test('migrateArchitecture: a tracked architecture/watch.json moves as a staged rename', () =>
{
    const root = project({ files: { [`${ARCH}/ARCHITECTURE.md`]: MAP_TEXT, [`${ARCH}/watch.json`]: ARCH_WATCH }, commit: ['.alfred'] });
    assert.strictEqual(migrateArch(root).merged, 'moved');
    assert.ok(porcelain(root).some((l) => /^R. \.alfred\/docs\/architecture\/watch\.json -> \.alfred\/docs\/awareness\/watch\.json$/.test(l)), porcelain(root).join('\n'));
    assert.deepStrictEqual(unstagedDeletes(root), []);
    assert.deepStrictEqual(JSON.parse(readAt(root, `${AW}/watch.json`)).watch[0].kind, 'architecture: map');
});

test('migrateArchitecture: a tracked architecture/watch.json merged into awareness/watch.json is a staged delete', () =>
{
    const root = project({ files: { [`${ARCH}/ARCHITECTURE.md`]: MAP_TEXT, [`${ARCH}/watch.json`]: ARCH_WATCH, [`${AW}/watch.json`]: '{\n  "watch": []\n}\n' }, commit: ['.alfred'] });
    assert.strictEqual(migrateArch(root).merged, 'merged');
    assert.ok(porcelain(root).includes('D  .alfred/docs/architecture/watch.json'), porcelain(root).join('\n'));
    assert.deepStrictEqual(unstagedDeletes(root), []);
});

test('migrateArchitecture: a tracked {} architecture/watch.json is a staged delete', () =>
{
    const root = project({ files: { [`${ARCH}/ARCHITECTURE.md`]: MAP_TEXT, [`${ARCH}/watch.json`]: '{}\n', [`${AW}/watch.json`]: '{}\n' }, commit: ['.alfred'] });
    migrateArch(root);
    assert.ok(porcelain(root).includes('D  .alfred/docs/architecture/watch.json'), porcelain(root).join('\n'));
    assert.deepStrictEqual(unstagedDeletes(root), []);
    assert.ok(!hasAt(root, ARCH));
});

test('migrateArchitecture: a locked index still finishes the move, by plain rename and remove', () =>
{
    const root = project({ files: { [`${ARCH}/ARCHITECTURE.md`]: MAP_TEXT, [`${ARCH}/watch.json`]: ARCH_WATCH }, commit: ['.alfred'] });
    const lock = path.join(root, '.git', 'index.lock');
    fs.writeFileSync(lock, '');
    try { migrateArch(root); }
    finally { fs.rmSync(lock, { force: true }); }
    assert.strictEqual(JSON.parse(readAt(root, `${AW}/watch.json`)).watch[0].kind, 'architecture: map');
    assert.ok(!hasAt(root, ARCH), 'no architecture/ left');
});

// The 3.5.0 review, M7: a teammate's branch cut before the move and merged after it brings the old keys back with no
// architecture/ left. A later update re-spells the engine's own ref spellings in the files the stack owns and names them
// in the others; a hit a file of that name answers - beside the citer, at the root, in a docs-root folder - stays.
const LATE_DOC = '# Assessment\n\n- a: architecture/ARCHITECTURE#layers\n- b: ARCHITECTURE#layers\n- c: ORIENTATION#start\n- d: architecture/references/patterns#orders\n- e: .alfred/docs/architecture/ARCHITECTURE.md\n';
const LATE_MAP = { [`${AW}/ARCHITECTURE-AWARENESS.md`]: MAP_TEXT.replace('ORIENTATION#', 'ARCHITECTURE-ORIENTATION-AWARENESS#'),
    [`${AW}/ARCHITECTURE-ORIENTATION-AWARENESS.md`]: ORIENT_TEXT.replace('ARCHITECTURE#', 'ARCHITECTURE-AWARENESS#'), [`${AW}/watch.json`]: '{}\n',
    [`${AW}/references/patterns.md`]: '# Patterns\n', '.alfred/docs/quality/watch.json': '{\n  "recomputed": true\n}\n' };

test('migrateArchitecture after the move: merged-in old-key refs are re-spelled', () =>
{
    const root = project({ files: { ...LATE_MAP, '.alfred/docs/quality/Q.md': LATE_DOC } });
    const logs = [];
    const out = migrateArch(root, logs);
    assert.strictEqual(readAt(root, '.alfred/docs/quality/Q.md'), '# Assessment\n\n- a: awareness/ARCHITECTURE-AWARENESS#layers\n- b: ARCHITECTURE-AWARENESS#layers\n'
        + '- c: ARCHITECTURE-ORIENTATION-AWARENESS#start\n- d: awareness/references/patterns#orders\n- e: .alfred/docs/architecture/ARCHITECTURE.md\n');
    assert.deepStrictEqual(out.respelled, ['.alfred/docs/quality/Q.md']);
    assert.ok(!hasAt(root, PENDING) && !hasAt(root, '.claude/rules/alfred-awareness.md'), 'no marker and no rule write');
    const before = treeOf(root);
    const again = [];
    migrateArch(root, again);
    assert.deepStrictEqual(treeOf(root), before, 'a second call writes nothing');
    assert.deepStrictEqual(again, []);
});

test('the late pass keeps a project\'s own ARCHITECTURE.md', () =>
{
    const doc = '# Q\n\n- ours: ARCHITECTURE#x\n';
    for (const own of ['.alfred/docs/quality/ARCHITECTURE.md', 'ARCHITECTURE.md', '.alfred/docs/ops/ARCHITECTURE.md'])
    {
        const root = project({ files: { ...LATE_MAP, '.alfred/docs/quality/Q.md': doc, [own]: '# Ours\n', '.alfred/docs/ops/watch.json': '{}\n' } });
        migrateArch(root);
        assert.strictEqual(readAt(root, '.alfred/docs/quality/Q.md'), doc, own);
    }
});

// The 3.5.1 review: a project folder of the old sub-folder's name, and a team file of the map's name anywhere outside the
// docs root (`docs/ARCHITECTURE.md`), answer the ref - kept as written; in the stack's own files the second is named.
test('the late pass keeps a ref a project\'s own architecture/references/ folder answers', () =>
{
    const doc = '# Q\n\n- ours: architecture/references/patterns.md#orders\n';
    const root = project({ files: { ...LATE_MAP, '.alfred/docs/quality/Q.md': doc, 'architecture/references/patterns.md': '# Ours\n' } });
    migrateArch(root);
    assert.strictEqual(readAt(root, '.alfred/docs/quality/Q.md'), doc);
});

test('the late pass names, never rewrites, a ref a team file elsewhere answers', () =>
{
    const doc = '# Q\n\n- deploy: ARCHITECTURE.md#deploy\n- map: architecture/ARCHITECTURE#layers\n';
    const root = project({ files: { ...LATE_MAP, '.alfred/docs/quality/Q.md': doc, 'docs/ARCHITECTURE.md': '# Ours\n', 'AGENTS.md': '- see ARCHITECTURE.md#deploy\n' } });
    const logs = [];
    migrateArch(root, logs);
    assert.strictEqual(readAt(root, '.alfred/docs/quality/Q.md'), '# Q\n\n- deploy: ARCHITECTURE.md#deploy\n- map: awareness/ARCHITECTURE-AWARENESS#layers\n');
    assert.deepStrictEqual(logs.filter((m) => m.includes('ARCHITECTURE.md#deploy') || m.includes('AGENTS.md')),
        ['  !! docs migration (awareness): .alfred/docs/quality/Q.md:3 names ARCHITECTURE.md#deploy - left as written: docs/ARCHITECTURE.md carries that name; re-spell it to the awareness key by hand if it means the map'],
        'the foreign AGENTS.md ref a team file answers is not named');
    const again = [];
    migrateArch(root, again);
    assert.strictEqual(readAt(root, '.alfred/docs/quality/Q.md'), '# Q\n\n- deploy: ARCHITECTURE.md#deploy\n- map: awareness/ARCHITECTURE-AWARENESS#layers\n');
    assert.strictEqual(again.filter((m) => m.includes('Q.md:3 names')).length, 1, 'named on every update while it stands');
});

test('the late pass names a foreign file\'s old-key ref, never rewrites it', () =>
{
    const agents = '# Agents\n- the map: architecture/ARCHITECTURE#layers\n- refs: architecture/references/patterns#orders\n';
    const root = project({ files: { ...LATE_MAP, 'AGENTS.md': agents } });
    const logs = [];
    migrateArch(root, logs);
    assert.strictEqual(readAt(root, 'AGENTS.md'), agents);
    assert.deepStrictEqual(logs.filter((m) => m.includes('AGENTS.md')), ['  !! docs migration (awareness): AGENTS.md:2 names architecture/ARCHITECTURE#layers - plan it with update-preflight.js --respell'], 'the references ref is not named (the I1 ruling)');
    const own = project({ files: { ...LATE_MAP, 'AGENTS.md': agents, 'architecture/ARCHITECTURE.md': '# Ours\n' } });
    const quiet = [];
    migrateArch(own, quiet);
    assert.strictEqual(readAt(own, 'AGENTS.md'), agents);
    assert.deepStrictEqual(quiet.filter((m) => m.includes('AGENTS.md')), [], 'a ref to the project\'s own architecture/ARCHITECTURE.md');
});

test('the late pass: no map file, no pass; ORIENTATION alone takes its one key', () =>
{
    const none = project({ files: { [`${AW}/RUN-AND-DEBUG-AWARENESS.md`]: '- ARCHITECTURE#layers\n', 'AGENTS.md': '- architecture/ARCHITECTURE#layers\n' } });
    const before = treeOf(none);
    const logs = [];
    migrateArch(none, logs);
    assert.deepStrictEqual(treeOf(none), before);
    assert.deepStrictEqual(logs, []);
    const orient = project({ files: { [`${AW}/ARCHITECTURE-ORIENTATION-AWARENESS.md`]: ORIENT_TEXT, [`${AW}/watch.json`]: '{}\n', [`${AW}/RUN-AND-DEBUG-AWARENESS.md`]: '- ARCHITECTURE#layers\n- ORIENTATION#start\n' } });
    migrateArch(orient);
    assert.strictEqual(readAt(orient, `${AW}/RUN-AND-DEBUG-AWARENESS.md`), '- ARCHITECTURE#layers\n- ARCHITECTURE-ORIENTATION-AWARENESS#start\n');
});
