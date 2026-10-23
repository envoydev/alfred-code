#!/usr/bin/env node
'use strict';
// THE ADAPTER TABLE IS BUILT (tool preferences, phase 1). meta/tool-adapters.json is the one hand-edited home of each
// known MCP server type: how a registration is recognised (a stack server name, a launch package, a URL host), which of
// its tools serve each job, and which edit files or act outward. meta/ is never installed, so the capture skill and the
// hooks read a built copy beside the skill's scripts, with each type's pinned version and full tool list folded in from
// meta/mcp-tools.json - a known type at its pin is then read from the table and never started. A type the stack starts
// with its own context (serena's navigation-context.yml) serves its pin less that context's excluded_tools, so the table
// lists what the stack's server serves; so does a server whose tools the install denies by name (the memory tools the
// stack never calls, Playwright's browser_run_code_unsafe), since no session can call those. Lint check 66 fails a stale
// copy, and a job or edit tool the server lacks.
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
// A context file's `excluded_tools:` list - the `  - <tool>` lines under the key, a comment line skipped.
function excludedTools(text)
{
    const out = [];
    let inList = false;
    for (const line of String(text).split(/\r?\n/))
    {
        if (/^excluded_tools:\s*$/.test(line)) { inList = true; continue; }
        if (!inList || /^\s*#/.test(line)) continue;
        const m = /^\s+-\s+([\w.-]+)\s*$/.exec(line);
        if (m) out.push(m[1]);
        else if (line.trim()) break;
    }
    return out;
}
const readContext = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// The tools the install removes from context for a pin: every alfred-memory tool but MEMORY_TOOLS_USED, and on the
// browser pin the ones BROWSER_TOOLS_OFF names.
function installDenied(pin, tools)
{
    const install = require('./install/alfred-code.js');
    if (pin === 'alfred-memory') return tools.filter((t) => !install.MEMORY_TOOLS_USED.includes(t));
    if (pin === 'browser') return tools.filter((t) => install.BROWSER_TOOLS_OFF.includes(t));
    return [];
}

// The table every reader takes: the jobs and built-ins as written, each type with its pin's version and tool list.
// Throws on the first row that names a tool, a job or a pin the sources do not have.
function build({ meta = readJson(META), tools = readJson(TOOLS), context = readContext, denied = installDenied } = {})
{
    const servers = (tools && tools.servers) || {};
    const builtins = listOf(meta.builtins);
    const jobs = {};
    for (const [job, row] of Object.entries(meta.jobs || {}))
        jobs[job] = { purpose: String(row.purpose || ''), ...(row.default ? { default: listOf(row.default) } : {}) };
    const types = {};
    for (const [type, row] of Object.entries(meta.types || {}))
    {
        const pinned = servers[row.pin];
        if (!pinned || !Array.isArray(pinned.tools)) throw new Error(`${type}: pin '${row.pin}' has no row in meta/mcp-tools.json`);
        let served = [...pinned.tools];
        if (row.context)
        {
            let text;
            try { text = context(String(row.context)); } catch { throw new Error(`${type}: context '${row.context}' cannot be read`); }
            const off = new Set(excludedTools(text));
            served = served.filter((t) => !off.has(t));
        }
        const off = new Set(denied(String(row.pin), served));
        served = served.filter((t) => !off.has(t));
        const have = new Set(served);
        const version = pinned.version === undefined ? null : pinned.version;
        const where = row.context ? ` as ${row.context} serves it` : off.size ? ' as the install serves it' : '';
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
    return { generatedBy: 'tool-adapters', builtins, jobs, types };
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

module.exports = { build, drift, render, excludedTools, META, SHIPPED };

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
