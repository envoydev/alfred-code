'use strict';
// Where a cell lives and how far it got. A cell is one (run, arm, task, rep): its WORK directory
// holds the copied template - an account dir, a home and the fixture clone - and is disposable; its
// RESULTS directory holds what the session left and is kept. A resume reads each cell's state from
// disk alone: `done` is a complete session.json, `live` is a cell lock another worker still holds,
// and anything else is wiped and run again - so a killed driver never leaves a half cell counted.
const fs = require('node:fs');
const path = require('node:path');
const lock = require('./lock.js');
const { removeTree } = require('./remove-tree.js');

const BENCH_DIR = path.join(__dirname, '..');
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function safe(value, what)
{
    if (typeof value !== 'string' || !SAFE.test(value) || value.includes('..')) throw new Error(`${what} '${value}' is not a plain name`);
    return value;
}

function runPaths({ benchDir = BENCH_DIR, run })
{
    const dir = path.join(benchDir, 'results', safe(run, 'run'));
    return { dir, runJson: path.join(dir, 'run.json'), prices: path.join(dir, 'prices.json') };
}

function cellPaths({ benchDir = BENCH_DIR, run, arm, task, rep })
{
    if (!Number.isInteger(rep) || rep < 1) throw new Error(`rep '${rep}' is not a count from 1`);
    const rel = [safe(run, 'run'), safe(arm, 'arm'), safe(task, 'task'), `r${rep}`];
    const work = path.join(benchDir, 'work', ...rel);
    const results = path.join(benchDir, 'results', ...rel);
    return {
        run, arm, task, rep, work, results,
        config: path.join(work, 'config'), home: path.join(work, 'home'), repo: path.join(work, 'repo'),
        transcript: path.join(results, 'transcript.jsonl'), subagents: path.join(results, 'subagents'),
        stdout: path.join(results, 'stdout.jsonl'), stderr: path.join(results, 'stderr.log'),
        diff: path.join(results, 'diff.patch'), session: path.join(results, 'session.json'),
    };
}

// One template per arm and pin hash, shared by every run: its setup is paid once.
function templatePaths({ benchDir = BENCH_DIR, arm, hash })
{
    if (!/^[0-9a-f]{8,}$/.test(hash || '')) throw new Error(`hash '${hash}' is not a hex digest`);
    const dir = path.join(benchDir, 'work', 'templates', `${safe(arm, 'arm')}-${hash.slice(0, 8)}`);
    return { dir, config: path.join(dir, 'config'), home: path.join(dir, 'home'), repo: path.join(dir, 'repo'), src: path.join(dir, 'src') };
}

// session.json is written last and whole, so a file that parses is a finished cell and one that
// does not is a cell the driver died inside.
function state(cell)
{
    try
    {
        JSON.parse(fs.readFileSync(cell.session, 'utf8'));
        return 'done';
    }
    catch { /* not finished */ }
    return lock.held(cell.results) ? 'live' : 'todo';
}

function reset(cell)
{
    const now = state(cell);
    if (now !== 'todo') throw new Error(`${cell.arm}/${cell.task}/r${cell.rep} is ${now} - never wiped`);
    removeTree(cell.work);
    removeTree(cell.results);
}

function partition(cells)
{
    const out = { done: [], live: [], todo: [] };
    for (const c of cells) out[state(c)].push(c);
    return out;
}

module.exports = { cellPaths, runPaths, templatePaths, state, reset, partition, BENCH_DIR };
