#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
//
// THE FILE-GUARD DISPATCHER (2.1.5 M3). The shell route runs as one process since R11 (shell-guards.js); the file
// tools still spawned one node process per guard - a Read paid the read guard, the secret guard and docs-session,
// an Edit or a Write the config guard, the cross-project guard and docs-session - each through a shell, and a bare
// node start alone costs ~30ms on macOS and ~90-130ms on a Windows guest (measured, R11 and the 2026-09-29 hooks
// audit). This hook is the ONE process for all of them, on shell-guards.js's in-process runtime: each guard runs
// as its own main module with its own gates, its own ledger row and its own fail-open, and the verdicts merge the
// way Claude Code merges the same guards wired as separate hooks (shell-guards.js `combine`, whose header states
// the rules). A PROTECTIVE guard (the secret guard, on a Read or a Grep) runs first and its exit 2 is answered at once.
//
// Each guard runs only for the tools its own manifest row named - the table below, which the manifest's rows are
// held to (scripts/shell-guards.test.js) - so a guard never judges a tool it was never wired on. instrument-tool-
// usage is not here: it is wired on every tool (`.*`).
//
// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them; each guard runs its own.
// The dispatcher's one is GATE 2 for itself: a project that wires the copied dispatcher (the hooks
// copy route) is judged by that copy, so the plugin's steps aside - yieldToCopiedTwin('file-guards').
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// [guard, the tools its own manifest row matches], in the manifest's order.
const GUARDS = [
    ['guard-read-whole-file', ['Read']],
    ['guard-secret-value', ['Read', 'Grep']],
    ['guard-config-protection', ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']],
    ['guard-cross-project-write', ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']],
    ['docs-session', ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep', 'Glob']],
];
const NAMES = GUARDS.map(([g]) => g);
const TOOLS = new Map(GUARDS);
const SELF = 'file-guards';
// Every file tool, in one order, so a matcher built from any set of guards reads the same way.
const TOOL_ORDER = ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep', 'Glob'];
const MATCHER = TOOL_ORDER.join('|');
const PROTECTIVE = new Set(['guard-secret-value']);
// The order the guards RUN in: the protective ones first, so a guard stalling past the budget can never drop their
// verdict (a timed-out hook lets the call through - the 2.1.5 hooks review), the rest in the manifest's order. The
// answer still lists every message in the manifest's order.
const RUN_ORDER = [...NAMES.filter((g) => PROTECTIVE.has(g)), ...NAMES.filter((g) => !PROTECTIVE.has(g))];
const matcherFor = (names) => TOOL_ORDER.filter((t) => names.some((g) => TOOLS.get(g).includes(t))).join('|');

// ---- the wiring ---------------------------------------------------------------------------------
// The manifest keeps each guard's own file-tool row - the catalog the walk selects from and the csv names.
// Both generators fold those rows into ONE dispatcher row at the place of the first, on the tools the folded
// guards match. A row folds only when every tool it names is one its guard's table entry names, with no args.
// The copy route passes `listGuards`: a strict subset is named in the wiring's args, so a guard the selection
// left out is not run even while an older install's copy of its file is still on disk.
function wiringRows(rows, { listGuards = false } = {})
{
    const out = [];
    const picked = new Set();
    let at = -1;
    for (const row of rows || [])
    {
        const [file = '', matcher = '', args = ''] = String(row.file ?? row).split('::');
        const m = row.matcher ?? matcher;
        const a = row.args ?? args;
        const name = String(row.file ?? file).replace(/\.js$/, '');
        const tools = String(m || '').split('|');
        if (TOOLS.has(name) && m && !m.startsWith('@') && !String(a || '').trim() && tools.every((t) => TOOLS.get(name).includes(t)))
        {
            if (at < 0) at = out.length;
            picked.add(name);
            continue;
        }
        out.push(typeof row === 'string' ? row : `${row.file}::${m}${a ? `::${a}` : ''}`);
    }
    if (at < 0) return out;
    const names = NAMES.filter((g) => picked.has(g));
    const list = listGuards && names.length < NAMES.length ? `::${names.join(' ')}` : '';
    out.splice(at, 0, `${SELF}.js::${matcherFor(names)}${list}`);
    return out;
}

// ---- the hook -----------------------------------------------------------------------------------
function main()
{
    try
    {
        if (require('./hook-prelude.js').yieldToCopiedTwin(SELF)) process.exit(0);
    }
    catch { /* an install without the prelude runs every guard */ }
    let stdin;
    try { stdin = fs.readFileSync(0); }
    catch { stdin = Buffer.alloc(0); }
    // Which tool this is decides which guards judge it; a payload with no readable tool is judged by none, the
    // answer each guard gave it alone (they all fail open on it).
    let tool = '';
    try { tool = String((JSON.parse(stdin.toString('utf8')) || {}).tool_name || ''); } catch { tool = ''; }
    const named = process.argv.slice(2).filter((a) => NAMES.includes(a));
    const guards = (named.length ? RUN_ORDER.filter((g) => named.includes(g)) : RUN_ORDER).filter((g) => TOOLS.get(g).includes(tool));
    let shell;
    try { shell = require(path.join(__dirname, 'shell-guards.js')); }
    catch { process.exit(0); /* no runtime beside it: fail open, as a crashed hook would */ }
    const results = [];
    for (const g of guards)
    {
        const r = shell.runGuard(path.join(__dirname, `${g}.js`), stdin);
        results.push(r);
        // A protective block is a correct answer alone, so it is answered now (shell-guards.js, 2.1.5 M2).
        if (r.code === 2 && PROTECTIVE.has(g)) break;
    }
    const verdict = shell.combine(results.sort((a, b) => NAMES.indexOf(a.guard.replace(/\.js$/, '')) - NAMES.indexOf(b.guard.replace(/\.js$/, ''))));
    // Exit only once both streams have flushed: a pipe write can still be pending on macOS.
    let pending = 0;
    const done = () => { if (--pending <= 0) process.exit(verdict.code); };
    for (const [stream, text] of [[process.stdout, verdict.stdout], [process.stderr, verdict.stderr]])
        if (text) { pending++; stream.write(text, done); }
    if (!pending) process.exit(verdict.code);
}

module.exports = { GUARDS, NAMES, TOOLS, SELF, MATCHER, PROTECTIVE, RUN_ORDER, matcherFor, wiringRows };
if (require.main === module) main();
