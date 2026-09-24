'use strict';
// ONE rule, FIVE homes. When ALFRED_CODE_DOCS_VERSIONING is absent, the docs are versioned 'local' only when they are
// kept OUT of git - no domain is tracked AND either (a) a domain exists or (b) git ignores the docs root - and 'git'
// otherwise, a fresh project whose docs root is not ignored included. The rule is written four times, in three
// languages: the engine's fallback (stack/hooks/docs.js keptOutOfGit), the re-probe (scripts/stamp-docs-root.js), the
// two installer seeds (python inside claude-stack.sh, PowerShell inside claude-stack.ps1), and - since Phase 7 - the
// Node seed's own (scripts/install/docs.js, composed with the settings writer that stores it). Nothing but this table
// makes them one rule: every scenario is built from scratch for every home, run through it end to end, and the value
// each home lands on is READ back - from the engine's own resolver, and from settings.json for the other three.
const test = require('node:test');
const assert = require('node:assert');
const { execFile, execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SH = path.join(ROOT, 'scripts', 'os', 'claude-stack.sh');
const PS1 = path.join(ROOT, 'scripts', 'os', 'claude-stack.ps1');
const DOCS_JS = path.join(ROOT, 'stack', 'hooks', 'docs.js');
const STAMP = path.join(ROOT, 'scripts', 'stamp-docs-root.js');
const installDocs = require('./install/docs.js');
const { applyEnv } = require('./install/settings.js');
const ENV_CATALOG = require('../meta/environment.json');
const MIGRATIONS = require('../meta/migrations.json');
const hasPwsh = spawnSync('pwsh', ['-v'], { encoding: 'utf8' }).status === 0;

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
const BIN = path.join(WORK, 'bin');
fs.mkdirSync(BIN);
fs.writeFileSync(path.join(BIN, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
fs.writeFileSync(path.join(BIN, 'claude.cmd'), '@echo off\r\nexit /b 0\r\n');
const SEL = path.join(WORK, 'sel.txt');
fs.writeFileSync(SEL, 'rule markdown-docs\nhook guard-secret-value\n');
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
// The frozen twins read and write their 1.x keys.
const readTwinValue = (repo) => JSON.parse(fs.readFileSync(settingsFile(repo), 'utf8')).env.CLAUDE_STACK_DOCS_VERSIONING; // legacy-name

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

// The installers: a full, hermetic install (stub claude on PATH, account dirs inside the sandbox, one rule and one
// hook selected), the settings.json holding the docs path and - when declared - the value, before it runs.
function viaInstaller(sc, twin)
{
    const { repo, docsPath } = build(sc, twin);
    writeEnv(repo, { CLAUDE_STACK_DOCS_PATH: docsPath, ...(sc.declared ? { CLAUDE_STACK_DOCS_VERSIONING: sc.declared } : {}) }); // legacy-name
    const home = path.join(WORK, `${path.basename(repo)}-home`);
    fs.mkdirSync(path.join(home, 'acct'), { recursive: true });
    const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: path.join(home, 'acct'), PATH: BIN + path.delimiter + process.env.PATH };
    for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY']) delete env[k];
    const [cmd, args] = twin === 'sh'
        ? ['bash', [SH, 'install', '--scope', 'project', '--selection', SEL, '--source', ROOT]]
        : ['pwsh', ['-NoProfile', '-File', PS1, 'install', '-Scope', 'project', '-Selection', SEL, '-Source', ROOT]];
    return new Promise((resolve) => execFile(cmd, args, { cwd: repo, env, encoding: 'utf8', maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
        if (err) return resolve(`error: ${stderr || err.message}`);
        try { resolve(readTwinValue(repo)); } catch (e) { resolve(`error: ${e.message}`); }
    }));
}

// Six installs at a time: each costs 2-4 s, and 34 of them in series would dominate the suite.
async function pool(jobs, width = 6)
{
    const out = new Array(jobs.length);
    let next = 0;
    await Promise.all(Array.from({ length: width }, async () => { while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); } }));
    return out;
}

test('the docs-versioning rule: one table, five homes, one answer', async (t) => {
    const homes = { engine: SCENARIOS.map(viaEngine), stamp: SCENARIOS.map(viaStamp), seed: SCENARIOS.map(viaSeed) };
    const twins = hasPwsh ? ['sh', 'ps1'] : ['sh'];
    const jobs = twins.flatMap((twin) => SCENARIOS.map((sc) => () => viaInstaller(sc, twin)));
    const results = await pool(jobs);
    twins.forEach((twin, k) => { homes[twin] = results.slice(k * SCENARIOS.length, (k + 1) * SCENARIOS.length); });
    const table = SCENARIOS.map((sc, i) => `${sc.want.padEnd(6)} | ${Object.keys(homes).map((h) => `${h}=${homes[h][i]}`).join(' ')} | ${sc.name}`).join('\n');
    for (const home of ['engine', 'stamp', 'seed', 'sh', 'ps1'])
    {
        await t.test(home, { skip: homes[home] ? false : 'pwsh not installed - the ps1 home is NOT RUN' }, () => {
            SCENARIOS.forEach((sc, i) => assert.strictEqual(homes[home][i], sc.want, `${home}: ${sc.name}\n${table}`));
        });
    }
});
