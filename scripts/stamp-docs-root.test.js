'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { hashItem } = require('./install/library.js');
const { renderStamp } = require('./install/stamp.js');

const SCRIPT = path.join(__dirname, 'stamp-docs-root.js');
const SOURCE_RULE = path.join(__dirname, '..', 'stack', 'rules', 'baseline-docs-root.md');

// A minimal install stamp naming ONE library rule hash, so a test can assert whether this script
// re-records it after it rewrites the rule the stamp is naming.
function writeStamp(claudeDir, rulesHash)
{
    fs.writeFileSync(path.join(claudeDir, 'alfred-code.stamp'), renderStamp({
        repoUrl: 'https://example.invalid/r', ref: 'main', sha: 'a'.repeat(40), version: '1.0.0', installed: '2026-09-24T00:00:00Z',
        action: 'install', scope: 'project', hooks: [], alwaysRules: [], alwaysMcps: [], picked: {},
        library: { skills: {}, agents: {}, rules: rulesHash },
    }));
}
const libraryRulesLine = (claudeDir) => (/^library-rules: (.*)$/m.exec(fs.readFileSync(path.join(claudeDir, 'alfred-code.stamp'), 'utf8')) || [])[1];

function makeProject(settings)
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
    fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
    fs.copyFileSync(SOURCE_RULE, path.join(root, '.claude', 'rules', 'baseline-docs-root.md'));
    if (settings !== null) fs.writeFileSync(path.join(root, '.claude', 'settings.json'), settings);
    return root;
}

const run = root => execFileSync('node', [SCRIPT, root], { encoding: 'utf8' });
const stampLine = root => fs.readFileSync(path.join(root, '.claude', 'rules', 'baseline-docs-root.md'), 'utf8')
    .split('\n').find(l => l.includes("This install's root"));

test('stamps the placeholder with the settings env value', () => {
    const root = makeProject('{"env":{"ALFRED_CODE_DOCS_PATH":"docs"}}');
    run(root);
    assert.match(stampLine(root), /This install's root: `docs`/);
});

test('missing settings, missing key, and broken JSON all stamp the default', () => {
    for (const settings of [null, '{"env":{}}', '{broken'])
    {
        const root = makeProject(settings);
        run(root);
        assert.match(stampLine(root), /This install's root: `\.alfred\/docs`/, `settings=${settings}`);
    }
});

test('re-stamps an already stamped value after an env change (the configure path)', () => {
    const root = makeProject('{"env":{"ALFRED_CODE_DOCS_PATH":"docs"}}');
    run(root);
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{"env":{"ALFRED_CODE_DOCS_PATH":"team/docs"}}');
    run(root);
    assert.match(stampLine(root), /This install's root: `team\/docs`/);
});

test('missing rule file is a fail-soft no-op with exit 0', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
    const out = run(root);
    assert.match(out, /nothing to stamp/);
});

// R29: the installer hashes baseline-docs-root.md AFTER it substitutes the placeholder - this
// script does the same substitution again, LATER (init's step 11, a re-stamp after the walk
// applied a different docs root than the install ran with), so it must re-record the hash too, or
// the very next library check reads the rule as drift for a rewrite the installer's own protocol
// asked for.
test('re-records the stamp\'s library-rules hash for baseline-docs-root when it re-stamps the rule', () => {
    const root = makeProject('{"env":{"ALFRED_CODE_DOCS_PATH":"docs"}}');
    const claudeDir = path.join(root, '.claude');
    const rulePath = path.join(claudeDir, 'rules', 'baseline-docs-root.md');
    try
    {
        run(root);
        writeStamp(claudeDir, { 'baseline-docs-root': hashItem(rulePath) });
        // The applied docs root differs from what the install ran with - init's own trigger.
        fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{"env":{"ALFRED_CODE_DOCS_PATH":"team/docs"}}');
        run(root);
        assert.match(stampLine(root), /This install's root: `team\/docs`/, 'the rule itself was re-stamped');
        assert.strictEqual(libraryRulesLine(claudeDir), `baseline-docs-root=${hashItem(rulePath)}`,
            'the stamp must carry the hash of the rule AS RE-STAMPED, not the value recorded before this run touched it');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a stamp naming no other rule, or none at all, is left alone beyond the one key it owns', () => {
    const root = makeProject('{"env":{"ALFRED_CODE_DOCS_PATH":"docs"}}');
    const claudeDir = path.join(root, '.claude');
    try
    {
        run(root);
        writeStamp(claudeDir, { 'baseline-docs-root': 'deadbeef', 'baseline-git': 'cafef00d' });
        fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{"env":{"ALFRED_CODE_DOCS_PATH":"team/docs"}}');
        run(root);
        assert.match(libraryRulesLine(claudeDir), /baseline-git=cafef00d/, 'a sibling rule\'s recorded hash is untouched');
        assert.doesNotMatch(libraryRulesLine(claudeDir), /baseline-docs-root=deadbeef/, 'the owned key was updated');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('no stamp, or a stamp with no library-rules line, is left alone - nothing to correct yet', () => {
    const root = makeProject('{"env":{"ALFRED_CODE_DOCS_PATH":"docs"}}');
    try
    {
        run(root); // no stamp on disk at all
        assert.ok(!fs.existsSync(path.join(root, '.claude', 'alfred-code.stamp')));
        fs.writeFileSync(path.join(root, '.claude', 'alfred-code.stamp'), 'sha: abc\nversion: 1.0.0\npicked-skills: demo\n');
        const before = fs.readFileSync(path.join(root, '.claude', 'alfred-code.stamp'), 'utf8');
        fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{"env":{"ALFRED_CODE_DOCS_PATH":"team/docs"}}');
        run(root);
        assert.strictEqual(fs.readFileSync(path.join(root, '.claude', 'alfred-code.stamp'), 'utf8'), before, 'a stamp with nothing to correct is byte-for-byte untouched');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// --reprobe-versioning: the docs-versioning seed is probed at the path the file held when the INSTALL ran, and on
// the setup route the user's chosen docs root is applied afterwards. The walk that moves the path re-probes at the
// new one - and only when its own run seeded the key, so a decision an earlier install wrote is never re-probed.
const gitIn = (root, ...args) => execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
// The flag carries the value the install SEEDED, and the script refuses when the file holds anything else: the
// condition that an existing install is never switched silently is then machine-checked, not advisory prose.
const reprobe = (root, seeded = 'local') => execFileSync('node', [SCRIPT, root, '--reprobe-versioning', seeded], { encoding: 'utf8' });
const envOf = root => JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8')).env;

// `domain` names the ONE folder the committed docs live in - 'architecture' carries no watch.json (it is
// grandfathered in), any other folder is a domain only because of the watch.json written beside its doc.
function projectWithCommittedDocs(docsPath, versioning, domain = 'architecture')
{
    const root = makeProject(JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: docsPath, ALFRED_CODE_DOCS_VERSIONING: versioning } }));
    gitIn(root, 'init', '-q', '-b', 'develop', '.');
    fs.mkdirSync(path.join(root, docsPath, domain), { recursive: true });
    fs.writeFileSync(path.join(root, docsPath, domain, 'ARCHITECTURE.md'), '# Map\n');
    if (domain !== 'architecture') fs.writeFileSync(path.join(root, docsPath, domain, 'watch.json'), '{}\n');
    gitIn(root, 'add', '-A');
    gitIn(root, 'commit', '-qm', 'docs');
    return root;
}

test('--reprobe-versioning re-reads the mode at the docs path that ended up in the file', () => {
    const root = projectWithCommittedDocs('docs', 'local');   // seeded against .alfred/docs, then the path moved
    try
    {
        assert.match(reprobe(root), /docs versioning re-probed at docs\/: 'git'/);
        assert.strictEqual(envOf(root).ALFRED_CODE_DOCS_VERSIONING, 'git');
        assert.match(reprobe(root, 'git'), /docs versioning already 'git' at docs\//, 'a second run says so and rewrites nothing');
        assert.match(reprobe(root), /holds 'git', not the 'local'/, 'and the same command twice stops at the guard');
        assert.strictEqual(envOf(root).ALFRED_CODE_DOCS_VERSIONING, 'git');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Task 14 / whole-branch review finding 2: the re-probe is the mechanism that CORRECTS a wrong seed, and it
// carried the same architecture-only blind spot - so a project documented in code-style/ alone kept the 'local'
// a fresh install always seeds, and wrote branch overlays into a docs root git versions. Any DOMAIN counts now
// (a watch.json is what makes one), and a committed folder that is no domain still counts for nothing.
test('--reprobe-versioning reads committed docs in any domain, and a watch-less folder is no domain', () => {
    const style = projectWithCommittedDocs('docs', 'local', 'code-style');
    const quality = projectWithCommittedDocs('docs', 'local', 'quality');
    try
    {
        assert.match(reprobe(style), /docs versioning re-probed at docs\/: 'git'/, 'code-style/ alone is committed docs');
        assert.strictEqual(envOf(style).ALFRED_CODE_DOCS_VERSIONING, 'git');
        fs.rmSync(path.join(quality, 'docs', 'quality', 'watch.json'));   // the findings folder never carries one
        fs.mkdirSync(path.join(quality, 'docs', 'architecture'));
        fs.writeFileSync(path.join(quality, 'docs', 'architecture', 'ARCHITECTURE.md'), '# Map\n');   // an UNTRACKED domain beside it
        assert.match(reprobe(quality), /docs versioning already 'local' at docs\//, 'a folder with no watch.json is no domain, so the untracked architecture/ decides');
        assert.strictEqual(envOf(quality).ALFRED_CODE_DOCS_VERSIONING, 'local');
    }
    finally { for (const d of [style, quality]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('--reprobe-versioning refuses when the file holds a value this run did not seed', () => {
    const root = projectWithCommittedDocs('docs', 'local');   // a decision already in the file
    try
    {
        const out = reprobe(root, 'git');                     // ... and an install that seeded something else
        assert.match(out, /holds 'local', not the 'git'/);
        assert.strictEqual(envOf(root).ALFRED_CODE_DOCS_VERSIONING, 'local', 'a decision is never re-probed away');
        assert.match(execFileSync('node', [SCRIPT, root, '--reprobe-versioning'], { encoding: 'utf8' }),
            /needs the value the install seeded/, 'and the flag without its value probes nothing');
        assert.strictEqual(envOf(root).ALFRED_CODE_DOCS_VERSIONING, 'local');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--reprobe-versioning is a no-op where there is no key, no repo or no project root', () => {
    const noKey = makeProject('{"env":{"ALFRED_CODE_DOCS_PATH":"docs"}}');
    const noRepo = makeProject('{"env":{"ALFRED_CODE_DOCS_PATH":"docs","ALFRED_CODE_DOCS_VERSIONING":"git"}}');
    const acct = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-acct-'));
    try
    {
        assert.match(reprobe(noKey), /no ALFRED_CODE_DOCS_VERSIONING/);
        assert.strictEqual(envOf(noKey).ALFRED_CODE_DOCS_VERSIONING, undefined, 'a key nobody set is never introduced here');
        assert.match(reprobe(noRepo, 'git'), /not a git repository/);
        assert.strictEqual(envOf(noRepo).ALFRED_CODE_DOCS_VERSIONING, 'git', 'and the value is left alone');
        fs.mkdirSync(path.join(acct, 'rules'), { recursive: true });
        fs.copyFileSync(SOURCE_RULE, path.join(acct, 'rules', 'baseline-docs-root.md'));
        fs.writeFileSync(path.join(acct, 'settings.json'), '{"env":{"ALFRED_CODE_DOCS_VERSIONING":"git"}}');
        const out = execFileSync('node', [SCRIPT, '--claude-dir', acct, '--reprobe-versioning'], { encoding: 'utf8' });
        assert.match(out, /needs a project root/, 'a global install has no repo to probe');
    }
    finally { for (const d of [noKey, noRepo, acct]) fs.rmSync(d, { recursive: true, force: true }); }
});

// --seed-versioning: the MISSING-row case validate.md (and any other reader) uses instead of the environment.json
// catalog constant - the value is DETECTED, not asked, so a reader offering the catalog default would write 'git'
// over a project whose docs are kept out of git, the exact switch the rule forbids.
const seed = (root) => execFileSync('node', [SCRIPT, root, '--seed-versioning'], { encoding: 'utf8' });

test('--seed-versioning writes the probed value when the key is absent', () => {
    const uncommitted = makeProject(JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs' } }));
    const fresh = makeProject(JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs' } }));
    const ignored = makeProject(JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs' } }));
    try
    {
        // absent + uncommitted docs (a domain exists, none tracked) -> local
        gitIn(uncommitted, 'init', '-q', '-b', 'develop', '.');
        fs.mkdirSync(path.join(uncommitted, 'docs', 'architecture'), { recursive: true });
        fs.writeFileSync(path.join(uncommitted, 'docs', 'architecture', 'ARCHITECTURE.md'), '# Map\n');
        assert.match(seed(uncommitted), /settings\.json env: ALFRED_CODE_DOCS_VERSIONING seeded 'local' at docs\/ - the docs are kept out of git/);
        assert.strictEqual(envOf(uncommitted).ALFRED_CODE_DOCS_VERSIONING, 'local');

        // absent + a fresh, non-ignored root -> git
        gitIn(fresh, 'init', '-q', '-b', 'develop', '.');
        fs.writeFileSync(path.join(fresh, 'README.md'), '# repo\n');
        gitIn(fresh, 'add', '-A');
        gitIn(fresh, 'commit', '-qm', 'seed');
        assert.match(seed(fresh), /ALFRED_CODE_DOCS_VERSIONING seeded 'git' at docs\/ - the docs are not kept out of git/);
        assert.strictEqual(envOf(fresh).ALFRED_CODE_DOCS_VERSIONING, 'git');

        // absent + a folder-only ignore pattern naming the root itself, root not created -> local (the trailing-slash probe)
        gitIn(ignored, 'init', '-q', '-b', 'develop', '.');
        fs.writeFileSync(path.join(ignored, '.gitignore'), 'docs/\n');
        fs.writeFileSync(path.join(ignored, 'README.md'), '# repo\n');
        gitIn(ignored, 'add', '-A');
        gitIn(ignored, 'commit', '-qm', 'seed');
        assert.match(seed(ignored), /ALFRED_CODE_DOCS_VERSIONING seeded 'local' at docs\/ - the docs are kept out of git/);
        assert.strictEqual(envOf(ignored).ALFRED_CODE_DOCS_VERSIONING, 'local');
        assert.ok(!fs.existsSync(path.join(ignored, 'docs')), 'the probe never creates the root it is checking');
    }
    finally { for (const d of [uncommitted, fresh, ignored]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('--seed-versioning leaves an existing value untouched, byte for byte', () => {
    const root = makeProject('{"env":{"ALFRED_CODE_DOCS_PATH":"docs","ALFRED_CODE_DOCS_VERSIONING":"local"}}');
    const before = fs.readFileSync(path.join(root, '.claude', 'settings.json'));
    try
    {
        assert.match(seed(root), /already 'local' - nothing seeded/);
        assert.deepStrictEqual(fs.readFileSync(path.join(root, '.claude', 'settings.json')), before, 'a decision is never rewritten, not even reformatted');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--seed-versioning is a fail-soft no-op on malformed settings.json, exit 0', () => {
    const root = makeProject('{broken');
    const before = fs.readFileSync(path.join(root, '.claude', 'settings.json'));
    try
    {
        const out = seed(root);   // execFileSync throws on a non-zero exit - reaching here proves exit 0
        assert.match(out, /cannot read.*nothing seeded/);
        assert.deepStrictEqual(fs.readFileSync(path.join(root, '.claude', 'settings.json')), before);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// JSON that PARSES but has the wrong shape. Each of these used to get past the object check: a top-level []
// and an `env: []` printed 'seeded' while the key was silently dropped on write, and a string env threw,
// exiting 1. A false 'seeded' is the worse half - validate reads that line as the outcome.
test('--seed-versioning refuses JSON of the wrong shape: no write, a message, exit 0', () => {
    for (const body of ['[]', '{"env":"x"}', '{"env":[]}', '{"env":null}', '"text"', '42'])
    {
        const root = makeProject(body);
        const before = fs.readFileSync(path.join(root, '.claude', 'settings.json'));
        try
        {
            const out = seed(root);   // execFileSync throws on a non-zero exit - reaching here proves exit 0
            assert.match(out, /not a JSON object - nothing seeded/, `${body}: ${out}`);
            assert.doesNotMatch(out, /seeded '/, `${body} must not report a seed it never wrote`);
            assert.deepStrictEqual(fs.readFileSync(path.join(root, '.claude', 'settings.json')), before, body);
        }
        finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
});

test('--seed-versioning preserves every other env key and merges only the one it owns', () => {
    const root = makeProject(JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs', ALFRED_CODE_INSTRUMENT: '1' } }));
    try
    {
        gitIn(root, 'init', '-q', '-b', 'develop', '.');
        fs.writeFileSync(path.join(root, 'README.md'), '# repo\n');
        gitIn(root, 'add', '-A');
        gitIn(root, 'commit', '-qm', 'seed');
        seed(root);
        const env = envOf(root);
        assert.strictEqual(env.ALFRED_CODE_DOCS_VERSIONING, 'git');
        assert.strictEqual(env.ALFRED_CODE_INSTRUMENT, '1', 'an unrelated key survives the merge');
        assert.strictEqual(env.ALFRED_CODE_DOCS_PATH, 'docs');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--seed-versioning skips a global install (no project repo to probe)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-acct-'));
    try
    {
        fs.mkdirSync(path.join(dir, 'rules'), { recursive: true });
        fs.copyFileSync(SOURCE_RULE, path.join(dir, 'rules', 'baseline-docs-root.md'));
        fs.writeFileSync(path.join(dir, 'settings.json'), '{"env":{}}');
        const out = execFileSync('node', [SCRIPT, '--claude-dir', dir, '--seed-versioning'], { encoding: 'utf8' });
        assert.match(out, /--seed-versioning needs a project root - skipped for a global install/);
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).env.ALFRED_CODE_DOCS_VERSIONING, undefined);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A global install keeps rules/ + settings.json in the account dir (no <root>/.claude between).
test('--claude-dir stamps a global install from the account dir itself', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-acct-'));
    try
    {
        fs.mkdirSync(path.join(dir, 'rules'), { recursive: true });
        fs.copyFileSync(SOURCE_RULE, path.join(dir, 'rules', 'baseline-docs-root.md'));
        fs.writeFileSync(path.join(dir, 'settings.json'), '{"env":{"ALFRED_CODE_DOCS_PATH":"global/docs"}}');
        execFileSync('node', [SCRIPT, '--claude-dir', dir], { encoding: 'utf8' });
        const line = fs.readFileSync(path.join(dir, 'rules', 'baseline-docs-root.md'), 'utf8').split('\n').find(l => l.includes("This install's root"));
        assert.match(line, /This install's root: `global\/docs`/);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A 1.x settings file spells both keys CLAUDE_STACK_* until the installer's env pass renames them. // legacy-name
// The root is read under that spelling, and a decision stored under it is a decision: seeding the
// new key beside it would make the rename keep the seed and drop the user's value.
test('a 1.x settings file: the root and a stored versioning decision are read under the old spelling', () => {
    const root = makeProject('{"env":{"CLAUDE_STACK_DOCS_PATH":"docs/legacy","CLAUDE_STACK_DOCS_VERSIONING":"local"}}'); // legacy-name
    const before = fs.readFileSync(path.join(root, '.claude', 'settings.json'));
    try
    {
        run(root);
        assert.match(stampLine(root), /This install's root: `docs\/legacy`/);
        assert.match(seed(root), /already 'local' - nothing seeded/);
        assert.deepStrictEqual(fs.readFileSync(path.join(root, '.claude', 'settings.json')), before, 'the 1.x decision is left for the rename');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// R87 / R89 (R83 b): the between-runs re-stamp and the versioning seed read the settings the way the
// installer does at the install's scope. A local-scope install (the stamp's `scope: local`) lays
// settings.local.json over settings.json, so a docs path set only in the personal file is the root, and
// a seeded decision goes to the file that scope writes. Any other scope never reads the personal file.
test('a local-scope install: the root and the versioning seed come from, and go to, settings.local.json (R87)', () => {
    const root = makeProject(JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs/shared' } }));
    const claudeDir = path.join(root, '.claude');
    const localFile = path.join(claudeDir, 'settings.local.json');
    const stampScope = (scope) => fs.writeFileSync(path.join(claudeDir, 'alfred-code.stamp'), renderStamp({
        repoUrl: 'https://example.invalid/r', ref: 'main', sha: 'a'.repeat(40), version: '2.0.0', installed: '2026-09-25T00:00:00Z',
        action: 'install', scope, hooks: [], alwaysRules: [], alwaysMcps: [], picked: {}, library: { skills: {}, agents: {}, rules: {} },
    }));
    try
    {
        fs.writeFileSync(localFile, JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs/mine' } }));
        stampScope('project');
        run(root);
        assert.match(stampLine(root), /This install's root: `docs\/shared`/, 'project scope never reads the personal file');

        stampScope('local');
        run(root);
        assert.match(stampLine(root), /This install's root: `docs\/mine`/);

        gitIn(root, 'init', '-q', '-b', 'develop', '.');
        fs.writeFileSync(path.join(root, 'README.md'), '# repo\n');
        gitIn(root, 'add', 'README.md');
        gitIn(root, 'commit', '-qm', 'seed');
        const shared = fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8');
        assert.match(seed(root), /settings\.local\.json env: ALFRED_CODE_DOCS_VERSIONING seeded 'git' at docs\/mine\//);
        assert.strictEqual(JSON.parse(fs.readFileSync(localFile, 'utf8')).env.ALFRED_CODE_DOCS_VERSIONING, 'git');
        assert.strictEqual(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'), shared, 'settings.json untouched');
        assert.match(seed(root), /already 'git' - nothing seeded/, 'the local value is the decision now');

        // A decision held in settings.json beneath is a decision at local scope too: nothing seeded over it.
        fs.writeFileSync(localFile, JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs/mine' } }));
        fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs/shared', ALFRED_CODE_DOCS_VERSIONING: 'local' } }));
        assert.match(seed(root), /already 'local' - nothing seeded/);

        // The re-probe reads the local view and writes the local file.
        fs.writeFileSync(localFile, JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs/mine', ALFRED_CODE_DOCS_VERSIONING: 'local' } }));
        assert.match(reprobe(root), /docs versioning re-probed at docs\/mine\/: 'git'/);
        assert.strictEqual(JSON.parse(fs.readFileSync(localFile, 'utf8')).env.ALFRED_CODE_DOCS_VERSIONING, 'git');
        assert.strictEqual(envOf(root).ALFRED_CODE_DOCS_VERSIONING, 'local', 'the shared value is left as it was');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// C7 (R101 N9): at project scope the stored decision is read from settings.json ALONE (the shared-only
// read in scopedSettings). A personal ALFRED_CODE_DOCS_VERSIONING in settings.local.json must not make
// --seed-versioning answer 'already decided': the committed file would never get the key, and every
// teammate would run on the fallback. The personal value is left as it is.
test('--seed-versioning at project scope seeds settings.json even when settings.local.json holds a value (C7)', () => {
    const root = makeProject(JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs' } }));
    const claudeDir = path.join(root, '.claude');
    const localFile = path.join(claudeDir, 'settings.local.json');
    try
    {
        writeStamp(claudeDir, {});
        fs.writeFileSync(localFile, JSON.stringify({ env: { ALFRED_CODE_DOCS_VERSIONING: 'local' } }));
        gitIn(root, 'init', '-q', '-b', 'develop', '.');
        fs.writeFileSync(path.join(root, 'README.md'), '# repo\n');
        gitIn(root, 'add', 'README.md');
        gitIn(root, 'commit', '-qm', 'seed');
        const out = seed(root);
        assert.doesNotMatch(out, /already 'local'/, 'the personal value answered for the committed file');
        assert.match(out, /settings\.json env: ALFRED_CODE_DOCS_VERSIONING seeded 'git' at docs\//);
        assert.strictEqual(envOf(root).ALFRED_CODE_DOCS_VERSIONING, 'git');
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(localFile, 'utf8')), { env: { ALFRED_CODE_DOCS_VERSIONING: 'local' } }, 'the personal file is untouched');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});
