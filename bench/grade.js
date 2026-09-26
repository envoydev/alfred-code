#!/usr/bin/env node
'use strict';
// Grade a driven run, serially and never beside its sessions: it takes the run's own lock.
//
//   node bench/grade.js <run-id>
//
// Every finished cell without a grade gets one; a cell graded as infrastructure is graded again (the
// regrade queue); a final grade is never touched. results/<run>/regrade.json lists what is still
// infrastructure after this pass.
const fs = require('node:fs');
const path = require('node:path');
const armsLib = require('./lib/arms.js');
const cellsLib = require('./lib/cells.js');
const lock = require('./lib/lock.js');
const { gradeCell } = require('./lib/grade.js');
const { removeTree } = require('./lib/remove-tree.js');

const BENCH_DIR = __dirname;

function gradeRun({ benchDir = BENCH_DIR, run, armsDir = path.join(BENCH_DIR, 'arms'), tasksDir = path.join(BENCH_DIR, 'tasks'), base = process.env, log = (l) => console.log(l) })
{
    const runP = cellsLib.runPaths({ benchDir, run });
    if (!fs.existsSync(runP.runJson)) throw new Error(`${run} has no run.json`);
    const held = lock.acquire(runP.dir);
    if (!held.ok) throw new Error(`${run} is held by pid ${held.holder} - a driver or grader is still on it`);
    try
    {
        const record = JSON.parse(fs.readFileSync(runP.runJson, 'utf8'));
        const { session } = armsLib.load({ dir: armsDir, names: [] });
        const workRoot = cellsLib.workRootOf(record, benchDir);
        const templates = Object.fromEntries(record.arms.map((a) => [a.name, cellsLib.templatePaths({ benchDir, workRoot, arm: a.name, hash: a.hash })]));
        const counts = { graded: 0, infra: 0, skipped: 0, final: 0 };
        const queue = [];
        for (const a of record.arms) for (const t of record.tasks) for (let rep = 1; rep <= record.reps; rep++)
        {
            const cell = cellsLib.cellPaths({ benchDir, workRoot, run, arm: a.name, task: t.id, rep });
            const id = `${a.name}/${t.id}/r${rep}`;
            if (cellsLib.state(cell) !== 'done') { counts.skipped += 1; continue; }
            const gradeFile = path.join(cell.results, 'grade.json');
            let prior = null;
            try { prior = JSON.parse(fs.readFileSync(gradeFile, 'utf8')); }
            catch { /* ungraded */ }
            if (prior && !prior.infra) { counts.final += 1; continue; }
            const g = gradeCell({ cell, tasksDir, templatePaths: templates[a.name], session, base });
            counts.graded += 1;
            if (g.infra) { counts.infra += 1; queue.push(id); }
            log(`graded ${counts.graded} - infrastructure ${counts.infra}`);
        }
        removeTree(path.join(workRoot, run));
        fs.writeFileSync(path.join(runP.dir, 'regrade.json'), `${JSON.stringify({ cells: queue, updatedAt: new Date().toISOString() }, null, 2)}\n`);
        return { ...counts, queue };
    }
    finally { lock.release(runP.dir); }
}

if (require.main === module)
{
    const run = process.argv[2];
    if (!run) { console.error('usage: grade.js <run-id>'); process.exit(2); }
    try
    {
        const res = gradeRun({ run });
        console.log(`${run}: graded ${res.graded}, infrastructure ${res.infra} (queued for regrade), final before ${res.final}, not run ${res.skipped}`);
    }
    catch (err) { console.error(`grade: ${err.message}`); process.exitCode = 1; }
}

module.exports = { gradeRun };
