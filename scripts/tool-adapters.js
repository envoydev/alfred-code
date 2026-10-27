#!/usr/bin/env node
'use strict';
// THE ADAPTER TABLE IS BUILT (tool preferences, phase 1). meta/tool-adapters.json is the one hand-edited home of each
// known MCP server type: how a registration is recognised (the server name an earlier release shipped it under, a launch
// package, a URL host), which of its tools serve each job, and which edit files or act outward. meta/ is never installed,
// so the capture skill and the hooks read a built copy beside the skill's scripts, with each type's pinned version and
// full tool list folded in from meta/mcp-tools.json - a known type at its pin is then read from the table and never
// started. The stack ships no server since 2.10.1, so a type serves what the record's add-back launch serves: its whole
// pin, less a row's `off` list - the tools its upstream context turns off (serena's `claude-code`, whose sha256 the row's
// `upstream` field records for refresh-mcp-pins.js's gate). Lint check 66 fails a stale copy, and a job or edit tool the
// server lacks.
//   node scripts/tool-adapters.js            report drift (exit 1 on any)
//   node scripts/tool-adapters.js --write    rewrite the built copy
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const META = path.join(ROOT, 'meta', 'tool-adapters.json');
const TOOLS = path.join(ROOT, 'meta', 'mcp-tools.json');
const SHIPPED = path.join(ROOT, 'stack', 'skills', 'capture-preferences', 'scripts', 'tool-adapters.json');
const SHIPPED_REL = 'stack/skills/capture-preferences/scripts/tool-adapters.json';

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const listOf = (value) => (Array.isArray(value) ? value.map(String) : []);

// The table every reader takes: the jobs, built-ins and deferred built-ins as written, each type with its pin's version and tool list - the
// whole pin, less its row's `off` list. Throws on the first row that names a tool, a job or a pin the sources do not have.
function build({ meta = readJson(META), tools = readJson(TOOLS) } = {})
{
    const servers = (tools && tools.servers) || {};
    const builtins = listOf(meta.builtins);
    const deferred = listOf(meta.deferred);
    for (const name of deferred) if (!builtins.includes(name)) throw new Error(`deferred: '${name}' is not a built-in`);
    const jobs = {};
    for (const [job, row] of Object.entries(meta.jobs || {}))
        jobs[job] = { purpose: String(row.purpose || ''), ...(row.default ? { default: listOf(row.default) } : {}) };
    const types = {};
    for (const [type, row] of Object.entries(meta.types || {}))
    {
        const pinned = servers[row.pin];
        if (!pinned || !Array.isArray(pinned.tools)) throw new Error(`${type}: pin '${row.pin}' has no row in meta/mcp-tools.json`);
        const version = pinned.version === undefined ? null : pinned.version;
        const off = new Set(listOf(row.off));
        for (const tool of off) if (!pinned.tools.includes(tool)) throw new Error(`${type}: off tool ${tool} is not a tool of ${row.pin} at ${version}`);
        const served = pinned.tools.filter((t) => !off.has(t));
        const have = new Set(served);
        const where = off.size ? ' as its upstream context serves it' : '';
        const known = (tool) => { if (!have.has(tool)) throw new Error(`${type}: ${tool} is not a tool of ${row.pin} at ${version}${where}`); return tool; };
        const typeJobs = {};
        for (const [job, list] of Object.entries(row.jobs || {}))
        {
            if (!jobs[job]) throw new Error(`${type}: job '${job}' is not in jobs`);
            typeJobs[job] = listOf(list).map(known);
        }
        types[type] = {
            pin: row.pin, stack: listOf(row.stack), packages: listOf(row.packages), hosts: listOf(row.hosts),
            jobs: typeJobs, edit: listOf(row.edit).map(known), version, tools: served.sort(),
        };
    }
    for (const [job, row] of Object.entries(jobs))
        for (const rank of row.default || [])
            if (!types[rank] && !builtins.includes(rank)) throw new Error(`${job}: default '${rank}' is neither a type nor a built-in`);
    return { generatedBy: 'tool-adapters', builtins, deferred, jobs, types };
}

const render = (table) => `${JSON.stringify(table, null, 2)}\n`;

// The built copy against what the sources build now; a source that cannot be built is a finding too.
function drift({ file = SHIPPED } = {})
{
    let want;
    try { want = render(build()); }
    catch (err) { return [`meta/tool-adapters.json does not build: ${err.message}`]; }
    let have;
    try { have = fs.readFileSync(file, 'utf8'); }
    catch { return [`${SHIPPED_REL} is missing - run npm run tool-adapters`]; }
    return have === want ? [] : [`${SHIPPED_REL} is not what meta/tool-adapters.json builds - run npm run tool-adapters`];
}

module.exports = { build, drift, render, META, SHIPPED };

if (require.main === module)
{
    require('../stack/hooks/hook-prelude.js').blockingStdio();
    if (process.argv.includes('--write'))
    {
        try { fs.writeFileSync(SHIPPED, render(build())); }
        catch (err) { console.error(`tool-adapters: ${err.message}`); process.exit(1); }
        console.log(`tool-adapters: ${SHIPPED_REL} written`);
        process.exit(0);
    }
    const found = drift();
    for (const f of found) console.log(f);
    console.log(found.length ? `tool-adapters: ${found.length} finding(s)` : 'tool-adapters: the built copy matches meta/tool-adapters.json');
    process.exit(found.length ? 1 : 0);
}
