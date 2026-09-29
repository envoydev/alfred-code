#!/usr/bin/env node
'use strict';
// The fixture every benchmark cell clones, checked before any cell runs: the tag must resolve to the
// commit bench/fixture.lock records, and no commit in its history may ever have carried a stack file -
// a `.claude/` folder or a `CLAUDE.md` in the fixture would hand one arm a head start.
//
//   node bench/fixture/verify.js <dest> [--source <repo>]      clone the locked tag into <dest>, verified
//   node bench/fixture/verify.js --write-lock [--source <repo>] freeze: record the tag's commit in the lock
//
// <repo> defaults to this repository, whose `benchmarks/fixture` branch holds the fixture's own history.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const LOCK_FILE = path.join(__dirname, '..', 'fixture.lock');
const TAG = 'bench-fixture-v1';
// Every surface a coding agent reads by convention, at any depth.
// `.alfred/` is Alfred Code's data root from 2.1 (docs, navigation index, browser profiles, project memory).
const STACK_PATH = /(^|\/)(\.claude\/|CLAUDE\.md$|\.mcp\.json$|\.serena\/|\.alfred\/|AGENTS\.md$|\.cursor\/|\.cursorrules$)/;

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function parseLock(text)
{
    const field = (key) => (new RegExp(`^${key}: (\\S+)$`, 'm').exec(text) || [])[1];
    const tag = field('tag');
    const commit = field('commit');
    if (!tag) throw new Error('fixture.lock names no tag');
    if (!/^[0-9a-f]{40}$/.test(commit || '')) throw new Error('fixture.lock names no full commit id');
    return { tag, commit };
}

function renderLock({ tag, commit })
{
    return `# The fixture every benchmark cell clones. Written by 'verify.js --write-lock' at the freeze;\n`
        + `# a cell whose clone resolves to any other commit is refused.\ntag: ${tag}\ncommit: ${commit}\n`;
}

function stackPathsIn(paths)
{
    return paths.filter((p) => STACK_PATH.test(p));
}

// Every path any commit reachable from HEAD added, changed or deleted.
function historyPaths(dir)
{
    const out = git(dir, ['log', '--format=', '--name-only', '--no-renames', 'HEAD']);
    return [...new Set(out.split('\n').map((l) => l.trim()).filter(Boolean))];
}

function verify({ source, lock, dest })
{
    if (fs.existsSync(dest) && fs.readdirSync(dest).length) throw new Error(`destination is not empty: ${dest}`);
    // --no-local: a clone from a path copies the source's whole object store and its tags, and this source holds
    // every task's hidden tests and the stacks' own releases (pilot 3's clones carried 19,898 objects, 401 of them
    // the fixture's) - through the git transport only the fixture tag's history comes over.
    execFileSync('git', ['clone', '-q', '--no-local', '--branch', lock.tag, '--single-branch', source, dest], { stdio: ['ignore', 'pipe', 'pipe'] });
    const commit = git(dest, ['rev-parse', 'HEAD']);
    if (commit !== lock.commit) throw new Error(`${lock.tag} resolves to ${commit}, the lock records ${lock.commit}`);
    const hits = stackPathsIn(historyPaths(dest));
    if (hits.length) throw new Error(`the fixture history carries stack files: ${hits.join(', ')}`);
    return { commit };
}

function main(argv)
{
    const sourceAt = argv.indexOf('--source');
    const source = sourceAt >= 0 ? argv[sourceAt + 1] : path.join(__dirname, '..', '..');
    if (argv.includes('--write-lock'))
    {
        const commit = git(source, ['rev-parse', `${TAG}^{commit}`]);
        fs.writeFileSync(LOCK_FILE, renderLock({ tag: TAG, commit }));
        console.log(`fixture.lock: ${TAG} = ${commit}`);
        return 0;
    }
    const dest = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--source');
    if (!dest) { console.error('usage: verify.js <dest> [--source <repo>] | --write-lock [--source <repo>]'); return 2; }
    const { commit } = verify({ source, lock: parseLock(fs.readFileSync(LOCK_FILE, 'utf8')), dest: path.resolve(dest) });
    console.log(`fixture verified: ${commit} in ${dest}`);
    return 0;
}

if (require.main === module)
{
    try { process.exitCode = main(process.argv.slice(2)); }
    catch (err) { console.error(`fixture refused: ${err.message}`); process.exitCode = 1; }
}

module.exports = { parseLock, renderLock, stackPathsIn, historyPaths, verify, TAG, LOCK_FILE };
