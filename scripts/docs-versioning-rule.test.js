'use strict';
// ONE rule, THREE homes (Phase 7b, R33, dropped the two frozen twin homes - scripts/os/claude-stack.{sh,ps1} are // legacy-name
// deleted). When ALFRED_CODE_DOCS_VERSIONING is absent, the docs are versioned 'local' only when they are kept OUT
// of git - no domain is tracked AND either (a) a domain exists or (b) git ignores the docs root - and 'git'
// otherwise, a fresh project whose docs root is not ignored included. The rule is written in three languages: the
// engine's fallback (stack/hooks/docs.js keptOutOfGit), the re-probe (scripts/stamp-docs-root.js), and the Node
// seed's own (scripts/install/docs.js, composed with the settings writer that stores it). Nothing but this table
// makes them one rule: every scenario is built from scratch for every home, run through it end to end, and the value
// each home lands on is READ back - from the engine's own resolver, and from settings.json for the other two.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DOCS_JS = path.join(ROOT, 'stack', 'hooks', 'docs.js');
const STAMP = path.join(ROOT, 'scripts', 'stamp-docs-root.js');
const installDocs = require('./install/docs.js');
const { applyEnv } = require('./install/settings.js');
const ENV_CATALOG = require('../meta/environment.json');
const MIGRATIONS = require('../meta/migrations.json');

const ARCH = { 'architecture/ARCHITECTURE.md': '# Map\n' };
const STYLE = { 'code-style/CODE-STYLE.md': '# Style\n', 'code-style/watch.json': '{}\n' };
const QUALITY = { 'quality/ASSESSMENT.md': '# Findings\n' };   // no watch.json: no domain, no vote

// committed / untracked are paths UNDER the docs root. `declared` is a value already in settings.json.
const SCENARIOS = [
    { name: 'fresh project, docs root not ignored', want: 'git' },
    { name: 'fresh project, docs root ignored by its parent (.claude/)', ignore: '.claude/\n', want: 'local' },
    { name: 'fresh project, docs root ignored by a directory-only pattern', ignore: '.claude/docs/\n', want: 'local' },
    { name: 'fresh project, contents ignored (.claude/docs/*)', ignore: '.claude/docs/*\n', want: 'local' },
    { name: 'fresh project, only a subfolder ignored', ignore: '.claude/docs/.branches/\n', want: 'git' },
    { name: 'fresh project, a committed custom root', docsPath: 'docs/generated', want: 'git' },
    { name: 'fresh project, an ignored custom root', docsPath: 'docs/generated', ignore: 'docs/\n', want: 'local' },
    // the folder-only pattern naming the root ITSELF, before the root exists: git cannot tell a missing path is a folder,
    // so only the trailing-slash probe matches it - without it this row reads 'git', the silent switch the rule forbids
    { name: 'fresh project, a folder-only pattern on the root itself, root not created', docsPath: 'docs', ignore: 'docs/\n', want: 'local' },
    { name: 'committed docs in architecture/', committed: ARCH, want: 'git' },
    { name: 'committed docs in code-style/ alone', committed: STYLE, want: 'git' },
    { name: 'a domain exists, none tracked, root not ignored', untracked: ARCH, want: 'local' },
    { name: 'a domain exists, none tracked, root ignored', ignore: '.claude/\n', untracked: STYLE, want: 'local' },
    { name: 'one tracked domain beside an untracked one', committed: ARCH, untracked: STYLE, want: 'git' },
    { name: 'a committed watch-less folder only (quality/)', committed: QUALITY, want: 'git' },
    { name: 'a committed watch-less folder beside an untracked domain', committed: QUALITY, untracked: ARCH, want: 'local' },
    { name: 'a tracked domain force-added under an ignored root', ignore: '.claude/\n', committed: ARCH, want: 'git' },
    { name: 'declared local over committed docs', committed: ARCH, declared: 'local', want: 'local' },
    { name: 'declared git over an ignored root', ignore: '.claude/\n', untracked: ARCH, declared: 'git', want: 'git' },
];

const WORK = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'versioning-rule-')));
test.after(() => fs.rmSync(WORK, { recursive: true, force: true }));

const git = (repo, ...args) => execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });

// A fresh repo per (scenario, home): every home writes, so no two may share one.
function build(sc, home)
{
    const repo = path.join(WORK, `${SCENARIOS.indexOf(sc)}-${home}`);
    const docsPath = sc.docsPath || '.claude/docs';
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q', '-b', 'develop', '.');
    fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
    if (sc.ignore) fs.writeFileSync(path.join(repo, '.gitignore'), sc.ignore);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'seed');
    const put = (files) => Object.entries(files || {}).forEach(([rel, text]) => {
        const p = path.join(repo, docsPath, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, text);
    });
    put(sc.committed);
    if (sc.committed) { git(repo, 'add', '-f', '--', docsPath); git(repo, 'commit', '-qm', 'docs'); }
    put(sc.untracked);
    return { repo, docsPath };
}
const settingsFile = (repo) => path.join(repo, '.claude', 'settings.json');
const writeEnv = (repo, env) => { fs.mkdirSync(path.join(repo, '.claude'), { recursive: true }); fs.writeFileSync(settingsFile(repo), `${JSON.stringify({ env }, null, 2)}\n`); };
const readValue = (repo) => JSON.parse(fs.readFileSync(settingsFile(repo), 'utf8')).env.ALFRED_CODE_DOCS_VERSIONING;

// The engine: its own resolver, the declared value (if any) handed in the environment exactly as the hook gets it.
function viaEngine(sc)
{
    const { repo, docsPath } = build(sc, 'engine');
    const env = { ...process.env, CLAUDE_PROJECT_DIR: repo, ALFRED_CODE_DOCS_PATH: docsPath, CLAUDE_DOCS_PATH: '', ALFRED_CODE_DOCS_VERSIONING: sc.declared || '' };
    const r = spawnSync(process.execPath, ['-e', `process.stdout.write(require(${JSON.stringify(DOCS_JS)}).docsMode())`], { cwd: repo, env, encoding: 'utf8' });
    return r.status === 0 ? r.stdout : `error: ${r.stderr}`;
}

// The re-probe: it only ever re-reads a value its own run SEEDED. Undeclared, the file holds that seed ('git' here,
// either answer would do) and the re-probe replaces it with the rule's answer; declared, the file holds the decision and
// the run claims to have seeded the other value - which the script must refuse, leaving the decision in place.
function viaStamp(sc)
{
    const { repo, docsPath } = build(sc, 'stamp');
    const held = sc.declared || 'git';
    writeEnv(repo, { ALFRED_CODE_DOCS_PATH: docsPath, ALFRED_CODE_DOCS_VERSIONING: held });
    const seeded = sc.declared ? (sc.declared === 'git' ? 'local' : 'git') : held;
    execFileSync(process.execPath, [STAMP, repo, '--reprobe-versioning', seeded], { encoding: 'utf8' });
    return readValue(repo);
}

// The NODE SEED: its own probe, composed with the settings writer that stores the answer - which is
// the only way the seed value ever reaches a project, and the place a declared value wins over it.
function viaSeed(sc)
{
    const { repo, docsPath } = build(sc, 'seed');
    const env = { ALFRED_CODE_DOCS_PATH: docsPath, ...(sc.declared ? { ALFRED_CODE_DOCS_VERSIONING: sc.declared } : {}) };
    applyEnv(env, {
        catalog: ENV_CATALOG.env, migrations: MIGRATIONS.env || {},
        docsVersioning: { value: '', seed: installDocs.docsVersioningSeed({ projectRoot: repo, docsPath }) },
        hooksOff: [], hooksAnswered: false, log: () => {},
    });
    return env.ALFRED_CODE_DOCS_VERSIONING;
}

test('the docs-versioning rule: one table, three homes, one answer', async (t) => {
    const homes = { engine: SCENARIOS.map(viaEngine), stamp: SCENARIOS.map(viaStamp), seed: SCENARIOS.map(viaSeed) };
    const table = SCENARIOS.map((sc, i) => `${sc.want.padEnd(6)} | ${Object.keys(homes).map((h) => `${h}=${homes[h][i]}`).join(' ')} | ${sc.name}`).join('\n');
    for (const home of ['engine', 'stamp', 'seed'])
    {
        await t.test(home, () => {
            SCENARIOS.forEach((sc, i) => assert.strictEqual(homes[home][i], sc.want, `${home}: ${sc.name}\n${table}`));
        });
    }
});
