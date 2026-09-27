#!/usr/bin/env node
'use strict';
// The report of a graded run: the pre-registered tables and the decision rule's verdict in its own
// words. It refuses to run when bench/PREREGISTRATION.md is absent, when the run recorded none, or
// when its hash differs from the one recorded at run start - a metric or rule edited after results
// exist is not the pre-registered one.
//
//   node bench/aggregate.js <run-id> [--reference <run-id>] [--flow <run-id>]
//
// The headline is the plain-prompt tasks with neither a `guard` nor a `home-advantage` tag; those two,
// the flow run and the reference run (bare on Opus) are each reported apart, never merged into it.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cellsLib = require('./lib/cells.js');
const { wilson } = require('./lib/stats.js');
const decide = require('./lib/decide.js');
const metricsLib = require('./lib/metrics.js');

const BENCH_DIR = __dirname;
const isGuard = (t) => t.group === 'guard' || (t.tags || []).includes('guard');
const isHome = (t) => (t.tags || []).includes('home-advantage');
const isHeadline = (t) => !isGuard(t) && !isHome(t);

function checkPrereg(record, run, preregFile)
{
    if (!record.prereg) throw new Error(`${run} recorded no pre-registration - it started before bench/PREREGISTRATION.md existed, so it cannot be reported against it`);
    if (!fs.existsSync(preregFile)) throw new Error('no bench/PREREGISTRATION.md - nothing to hold the report to');
    const now = crypto.createHash('sha256').update(fs.readFileSync(preregFile)).digest('hex');
    if (now !== record.prereg.sha256) throw new Error(`PREREGISTRATION.md changed since ${run} started - its metrics or rule are not the pre-registered ones`);
}

function defaultOnboarding(runDir)
{
    return (arm) =>
    {
        const dir = path.join(runDir, 'onboarding', arm);
        if (!fs.existsSync(dir)) return 0;
        return fs.readdirSync(dir).filter((f) => /^\d+\.jsonl$/.test(f))
            .reduce((sum, f) => sum + ((metricsLib.analyze(path.join(dir, f), path.join(runDir, 'prices.json')).cost || {}).usd || 0), 0);
    };
}

function loadRun({ benchDir, run, preregFile, metricsFn, onboardingFn })
{
    const runP = cellsLib.runPaths({ benchDir, run });
    if (!fs.existsSync(runP.runJson)) throw new Error(`${run} has no run.json`);
    const record = JSON.parse(fs.readFileSync(runP.runJson, 'utf8'));
    checkPrereg(record, run, preregFile);
    const measure = metricsFn || ((cell) => metricsLib.cellMetrics({ cell, prices: runP.prices }));
    const cells = [];
    const ungraded = [];
    const unfinished = [];
    for (const a of record.arms) for (const t of record.tasks) for (let rep = 1; rep <= record.reps; rep++)
    {
        // The clone the session ran in, under the run's own work root: its transcript names that path.
        const cell = cellsLib.cellPaths({ benchDir, workRoot: cellsLib.workRootOf(record, benchDir), run, arm: a.name, task: t.id, rep });
        if (cellsLib.state(cell) !== 'done') { unfinished.push(a.name); continue; }
        let grade;
        try { grade = JSON.parse(fs.readFileSync(path.join(cell.results, 'grade.json'), 'utf8')); }
        catch { ungraded.push(`${a.name}/${t.id}/r${rep}`); continue; }
        cells.push({ arm: a.name, task: t, rep, id: `${a.name}/${t.id}/r${rep}`, infra: grade.infra || null, pass: !grade.infra && grade.hiddenPass === true && grade.suiteGreen === true, m: measure(cell, record) });
    }
    if (ungraded.length) throw new Error(`${ungraded.length} finished ${ungraded.length === 1 ? 'cell is' : 'cells are'} not graded - run grade.js first`);
    const onboarding = Object.fromEntries(record.arms.map((a) => [a.name, (onboardingFn || defaultOnboarding(runP.dir))(a.name)]));
    // What a usage limit set aside (drive.js): each copy names its arm in session.limited.json.
    const setAside = [];
    const limitedDir = path.join(runP.dir, 'limited');
    for (const d of fs.existsSync(limitedDir) ? fs.readdirSync(limitedDir) : [])
    {
        try { setAside.push(JSON.parse(fs.readFileSync(path.join(limitedDir, d, 'session.limited.json'), 'utf8')).arm); }
        catch { setAside.push('unknown'); }
    }
    const total = record.arms.length * record.tasks.length * record.reps;
    return { record, cells, onboarding, runP, unfinished, setAside, total };
}

const perArm = (names, arms) => arms.map((a) => `${a} ${names.filter((n) => n === a).length}`).join(', ');

// A run the driver has not finished reports rates over fewer cells than it pre-registered: say so first.
function partialLine(o, arms)
{
    if (!o.unfinished.length) return null;
    return `**PARTIAL RUN: ${o.unfinished.length} of ${o.total} cells unfinished (${perArm(o.unfinished, arms)}) - the rates below cover finished cells only; finish it with --resume before reading a verdict.**`;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const nums = (xs) => xs.filter((x) => typeof x === 'number');

function summarize(cells, arm)
{
    const mine = cells.filter((c) => c.arm === arm);
    const counted = mine.filter((c) => !c.infra);
    const passing = counted.filter((c) => c.pass);
    return {
        arm, passes: passing.length, n: counted.length, infra: mine.length - counted.length,
        meanCost: mean(nums(counted.map((c) => c.m.costUsd))) || 0,
        wall: mean(nums(counted.map((c) => c.m.wallMs))), turns: mean(nums(counted.map((c) => c.m.turns))),
        tools: mean(nums(counted.map((c) => c.m.toolCalls))), peak: mean(nums(counted.map((c) => c.m.peakCtx))),
        netLines: mean(nums(passing.map((c) => c.m.netLines))), newDeps: passing.filter((c) => (c.m.newDeps || []).length).length,
        weakening: counted.filter((c) => (c.m.checkWeakening || []).length).length,
        credentials: counted.filter((c) => c.m.credentials && c.m.credentials.count).length,
        attempted: counted.reduce((n, c) => n + ((c.m.destructive && c.m.destructive.attempted) || 0), 0),
        blocked: counted.reduce((n, c) => n + ((c.m.destructive && c.m.destructive.blocked) || 0), 0),
        unchecked: counted.filter((c) => c.m.doneWithoutCheck === true).length,
    };
}

const pct = (k, n) => (n ? `${Math.round((k / n) * 100)}% (${k}/${n})` : 'no cells');
// Under a cent keeps four places: a real but small cost never reads as nothing.
const usd = (x) => (x === null || x === undefined ? '-' : `$${x > 0 && x < 0.01 ? x.toFixed(4) : x.toFixed(2)}`);
const num = (x, d = 0) => (x === null || x === undefined ? '-' : x.toFixed(d));

function table(cells, arms, { onboarding = null, taskCount = 0 } = {})
{
    const head = ['arm', 'all-pass', '90% interval', 'mean cost'];
    if (onboarding) head.push('onboarding', 'onboarding per task');
    head.push('mean wall s', 'turns', 'tool calls', 'peak context', 'net lines (passing)', 'new deps (passing)', 'check-weakening', 'credentials', 'destructive (blocked)', 'done, no check', 'infra');
    const rows = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
    for (const arm of arms)
    {
        const s = summarize(cells, arm);
        const w = wilson(s.passes, s.n);
        const row = [s.arm, pct(s.passes, s.n), s.n ? `${Math.round(w.lo * 100)}-${Math.round(w.hi * 100)}%` : '-', usd(s.meanCost)];
        if (onboarding) row.push(usd(onboarding[arm]), usd(taskCount ? onboarding[arm] / taskCount : null));
        row.push(num(s.wall === null ? null : s.wall / 1000), num(s.turns, 1), num(s.tools, 1), num(s.peak), num(s.netLines, 1), String(s.newDeps), String(s.weakening), String(s.credentials), `${s.attempted} (${s.blocked})`, String(s.unchecked), String(s.infra));
        rows.push(`| ${row.join(' | ')} |`);
    }
    return rows.join('\n');
}

function sentences(cells, arms, prefix)
{
    if (!arms.includes('ours') || !arms.includes('bare')) return [`${prefix}the decision rule needs ours and bare - not applied.`];
    const out = [`${prefix}${decide.compare(summarize(cells, 'ours'), summarize(cells, 'bare')).sentence}`];
    if (arms.includes('ecc')) out.push(`${prefix}${decide.compare(summarize(cells, 'ours'), summarize(cells, 'ecc')).sentence}`);
    return out;
}

function worst(cells, arms)
{
    return arms.map((arm) =>
    {
        const byTask = new Map();
        for (const c of cells.filter((x) => x.arm === arm && !x.infra))
        {
            const e = byTask.get(c.task.id) || { id: c.task.id, k: 0, n: 0 };
            e.k += c.pass ? 1 : 0;
            e.n += 1;
            byTask.set(c.task.id, e);
        }
        const three = [...byTask.values()].sort((a, b) => a.k / a.n - b.k / b.n || a.id.localeCompare(b.id)).slice(0, 3);
        return `- ${arm}: ${three.map((e) => `${e.id} (${e.k}/${e.n})`).join(', ')} - the reason for each is read from its transcripts (B6)`;
    }).join('\n');
}

function aggregate({ benchDir = BENCH_DIR, run, preregFile = path.join(BENCH_DIR, 'PREREGISTRATION.md'), reference, flow, metricsFn, onboardingFn })
{
    const main = loadRun({ benchDir, run, preregFile, metricsFn, onboardingFn });
    const { record, cells } = main;
    const arms = record.arms.map((a) => a.name);
    const headTasks = record.tasks.filter(isHeadline);
    const head = cells.filter((c) => isHeadline(c.task));
    const guard = cells.filter((c) => isGuard(c.task));
    const home = cells.filter((c) => isHome(c.task));
    const groups = [...new Set(headTasks.map((t) => t.group))].sort();
    const infra = cells.filter((c) => c.infra);

    const lines = [`# Benchmark report: ${run}`, ''];
    const partial = partialLine(main, arms);
    if (partial) lines.push(partial, '');
    lines.push(`Run ${run}: mode ${record.mode}, ${record.model} at effort ${record.effort}, Claude Code ${record.cliVersion}, fixture ${record.fixture.tag}@${record.fixture.commit.slice(0, 8)}, seed ${record.seed}, reps ${record.reps}. Pre-registration sha256 ${record.prereg.sha256.slice(0, 12)}, unchanged since the run started.`, '');
    lines.push('## Verdict', '');
    if (arms.includes('ours') && arms.includes('bare'))
    {
        const h = decide.headline({ ours: summarize(head, 'ours'), bare: summarize(head, 'bare'), ecc: arms.includes('ecc') ? summarize(head, 'ecc') : null });
        lines.push(h.lead, '');
        if (h.rest.length) lines.push(...h.rest, '');
    }
    else lines.push('The decision rule needs ours and bare - not applied.', '');
    for (const g of groups) lines.push(...sentences(head.filter((c) => c.task.group === g), arms, `${g}: `));
    if (guard.length) lines.push(...sentences(guard, arms, 'guard tasks: '));
    if (home.length) lines.push(...sentences(home, arms, 'home-advantage tasks: '));
    lines.push('', infra.length ? `infrastructure, excluded: ${infra.length} (${infra.map((c) => c.id).join(', ')})` : 'infrastructure, excluded: 0');
    lines.push(main.setAside.length ? `set aside by a usage limit and re-run: ${perArm(main.setAside, arms)}` : 'set aside by a usage limit and re-run: 0', '');

    lines.push('## Headline tasks', '', table(head, arms, { onboarding: main.onboarding, taskCount: headTasks.length }), '');
    for (const g of groups) lines.push(`## Group: ${g}`, '', table(head.filter((c) => c.task.group === g), arms), '');
    if (guard.length) lines.push('## guard tasks', '', table(guard, arms), '');
    if (home.length) lines.push('## home-advantage tasks', '', table(home, arms), '');
    lines.push('## Worst three tasks per arm', '', worst(cells, arms), '');

    for (const [label, other] of [['Reference', reference], ['Flow', flow]])
    {
        if (!other) continue;
        const o = loadRun({ benchDir, run: other, preregFile, metricsFn, onboardingFn });
        const oArms = o.record.arms.map((a) => a.name);
        lines.push(`## ${label}: ${other} (${o.record.model})`, '');
        const oPartial = partialLine(o, oArms);
        if (oPartial) lines.push(oPartial, '');
        lines.push(table(o.cells.filter((c) => isHeadline(c.task)), oArms), '');
    }

    const report = `${lines.join('\n')}\n`;
    fs.writeFileSync(path.join(main.runP.dir, 'report.md'), report);
    fs.writeFileSync(path.join(main.runP.dir, 'metrics.json'), `${JSON.stringify(cells.map((c) => ({ id: c.id, pass: c.pass, infra: c.infra, ...c.m })), null, 2)}\n`);
    return { report, onboarding: main.onboarding };
}

if (require.main === module)
{
    const argv = process.argv.slice(2);
    const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
    const run = argv[0];
    if (!run || run.startsWith('--')) { console.error('usage: aggregate.js <run-id> [--reference <run-id>] [--flow <run-id>]'); process.exit(2); }
    try
    {
        aggregate({ run, reference: flag('--reference'), flow: flag('--flow') });
        console.log(`${run}: report written to ${path.join('bench', 'results', run, 'report.md')}`);
    }
    catch (err) { console.error(`aggregate: ${err.message}`); process.exitCode = 1; }
}

module.exports = { aggregate, summarize };
