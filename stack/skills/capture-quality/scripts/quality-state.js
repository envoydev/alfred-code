#!/usr/bin/env node
// quality-state.js - the three quality docs' state for /capture-quality's chain ask, one line per part in table order:
//
//   architecture-quality: absent | unstamped | current <branch>@<sha> | stale <branch>@<sha> (<why>)
//   code-quality: ...
//   test-coverage-quality: ...
//
// Each doc's first stamp line (`As of:` for the two assessments, `Captured:` for the coverage doc) is held against git
// with the docs root and the data root out of the pathspec, so committing a captured doc, or leaving one uncommitted,
// never makes a part stale. The why is `<n> commits behind HEAD`, `not on this branch`, `uncommitted changes` or `no git`.
// Run from the project root; it reads the docs and the settings that place them, nothing else, and always exits 0.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PARTS = [
    ['architecture-quality', 'ARCHITECTURE-ASSESSMENT.md', 'As of'],
    ['code-quality', 'CODE-ASSESSMENT.md', 'As of'],
    ['test-coverage-quality', 'COVERAGE-QUALITY.md', 'Captured'],
];
const DATA_ROOT_DEFAULT = '.alfred';

const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const settingsEnv = (file) => { try { return (JSON.parse(readText(file) || 'null') || {}).env || {}; } catch { return {}; } };

// The data root as capture-awareness' awareness-state.js reads it: the environment, then the project's settings
// files, then the account's; a value that is not a plain relative folder is the default.
function dataRoot(projectRoot, env = process.env)
{
    let raw = String(env.ALFRED_CODE_DATA_PATH || '').trim();
    const account = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    for (const file of [path.join(projectRoot, '.claude', 'settings.local.json'), path.join(projectRoot, '.claude', 'settings.json'), path.join(account, 'settings.json')])
    {
        if (raw) break;
        raw = String(settingsEnv(file).ALFRED_CODE_DATA_PATH || '').trim();
    }
    const value = raw.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
    const parts = value.split('/');
    const refused = !value || value.startsWith('/') || /^[A-Za-z]:/.test(value) || /\s/.test(value) || /[$%`"'*?<>|:]/.test(value)
        || parts.some((p) => p === '.' || p === '..') || parts[0] === '.claude' || parts[0] === '.git';
    return refused ? DATA_ROOT_DEFAULT : value;
}

// The docs root: a leftover ALFRED_CODE_DOCS_PATH first (the 2.x line), settings.local.json over settings.json, else
// <data root>/docs - awareness-state.js docsRoot.
function docsRoot(projectRoot, env = process.env)
{
    if (env.ALFRED_CODE_DOCS_PATH) return env.ALFRED_CODE_DOCS_PATH;
    for (const file of ['settings.local.json', 'settings.json'])
    {
        const value = settingsEnv(path.join(projectRoot, '.claude', file)).ALFRED_CODE_DOCS_PATH;
        if (value) return value;
    }
    return `${dataRoot(projectRoot, env)}/docs`;
}

function gitOf(projectRoot)
{
    const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
    return (args) =>
    {
        const r = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd: projectRoot, env, encoding: 'utf8', timeout: 10000 });
        return { status: r.error ? -1 : r.status, out: String(r.stdout || '').trim() };
    };
}

// The stamp's branch, sha and +dirty from its first line under the label, markup around it allowed.
function stampOf(text, label)
{
    const re = new RegExp(`^[ \\t>*_\`]*${label}:[ \\t*_\`]*([^\\s@\`*,]+)@([0-9a-f]{4,40})(\\+dirty)?[^\\n]*`, 'm');
    const m = re.exec(String(text).replace(/\r\n/g, '\n'));
    return m ? { branch: m[1], sha: m[2], dirty: Boolean(m[3]) || m[0].includes('+dirty') } : null;
}

function main()
{
    const root = process.cwd();
    const docs = path.resolve(root, docsRoot(root));
    // Out of the pathspec: the docs root and the data root, each only where it sits inside the project.
    const inside = (p) => { const rel = path.relative(root, p).split(path.sep).join('/'); return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : null; };
    const spec = ['--', '.', ...[inside(docs), inside(path.resolve(root, dataRoot(root)))].filter(Boolean).map((rel) => `:(exclude)${rel}`)];
    const git = gitOf(root);
    const head = git(['rev-parse', '--verify', '-q', 'HEAD']);
    const hasGit = head.status === 0 && Boolean(head.out);
    let dirtyTree;
    for (const [part, file, label] of PARTS)
    {
        const doc = path.join(docs, 'quality', file);
        if (!fs.existsSync(doc)) { console.log(`${part}: absent`); continue; }
        const stamp = stampOf(readText(doc) ?? '', label);
        if (!stamp) { console.log(`${part}: unstamped`); continue; }
        const at = `${stamp.branch}@${stamp.sha.slice(0, 7)}`;
        if (!hasGit) { console.log(`${part}: stale ${at} (no git)`); continue; }
        if (git(['merge-base', '--is-ancestor', stamp.sha, 'HEAD']).status !== 0) { console.log(`${part}: stale ${at} (not on this branch)`); continue; }
        const behind = Number(git(['rev-list', '--count', `${stamp.sha}..HEAD`, ...spec]).out) || 0;
        if (behind) { console.log(`${part}: stale ${at} (${behind} commits behind HEAD)`); continue; }
        dirtyTree ??= Boolean(git(['status', '--porcelain', ...spec]).out);
        console.log(stamp.dirty || dirtyTree ? `${part}: stale ${at} (uncommitted changes)` : `${part}: current ${at}`);
    }
}

try { main(); }
catch (err) { console.log(`quality-state: failed (${err.message})`); }
process.exitCode = 0;
