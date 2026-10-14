#!/usr/bin/env node
'use strict';
// THE SEATS' TOOL LINES ARE GENERATED (2026-10-14, the user's ruling after the seat-listing probe). The dispatcher lists
// every enabled seat as `- <plugin>:<seat>: <description> (Tools: <tools>)` in every session's first call, the `tools:`
// value verbatim - and 92% of the 44 seats' 21.5K characters there were MCP tool names, each repeating a 41-55
// character `mcp__plugin_<n>_<n>__` prefix. A whole-server grant (`mcp__<server>`, code.claude.com/docs/en/sub-agents)
// is listed as written, never expanded, and `disallowedTools` is not listed at all (measured live on a plugin seat and
// a plugin server, 2026-10-14) - so each seat now grants one `mcp__plugin_<n>_<n>` per server and removes the tools of
// that server it must not hold, which leaves every seat's effective tool set exactly what it was.
//
// meta/seat-tools.json is the one home of what each seat holds, in short form, in the order it is listed:
//   `Read`              a built-in tool
//   `<server>:<tool>`   one tool of a stack MCP server (`alfred-memory:memory_store`)
//   `<server>:*`        every tool of that server, today's and a later pin's
//   `<server>:!<tool>`  ... except this one (only beside `<server>:*`)
// A server named tool by tool is granted whole and every other tool its pinned list holds (meta/mcp-tools.json) is
// removed - so a tool a pin bump adds reaches no such seat until the file names it. The seat file's `tools:` and
// `disallowedTools:` lines are this script's output: `--write` rewrites them, lint check 63 fails on a drift.
//   node scripts/seat-tools.js            report drift (exit 1 on any)
//   node scripts/seat-tools.js --write    rewrite the seats' two lines from meta/seat-tools.json
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const AGENTS_DIR = path.join(ROOT, 'stack', 'agents');
const INTENT_FILE = path.join(ROOT, 'meta', 'seat-tools.json');
const TOOLS_FILE = path.join(ROOT, 'meta', 'mcp-tools.json');

// A browser engine's plugin serves the one pinned browser server (lint-mcp-tools.js judges it the same way).
const roleOf = (server) => (/^(?:chrome|msedge|firefox|webkit)-control$/.test(server) ? 'browser' : server);
const grantOf = (server) => `mcp__plugin_${server}_${server}`;
const toolOf = (server, tool) => `${grantOf(server)}__${tool}`;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const loadPins = () => (readJson(TOOLS_FILE).servers || {});
const loadIntent = () => (readJson(INTENT_FILE).seats || {});

// One seat's intent, parsed: built-ins in order, and per server either the named tools or `*` with its exceptions.
function parseIntent(seat, tokens)
{
    const order = [];
    const servers = new Map();
    const errors = [];
    for (const raw of tokens)
    {
        const token = String(raw).trim();
        const at = token.indexOf(':');
        if (at < 0) { order.push({ builtin: token }); continue; }
        const server = token.slice(0, at);
        const tool = token.slice(at + 1);
        if (!servers.has(server)) { servers.set(server, { tools: [], all: false, except: [] }); order.push({ server }); }
        const s = servers.get(server);
        if (tool === '*') s.all = true;
        else if (tool.startsWith('!')) s.except.push(tool.slice(1));
        else s.tools.push(tool);
    }
    for (const [server, s] of servers)
    {
        if (s.all && s.tools.length) errors.push(`${seat}: ${server} is granted whole (*) and tool by tool - name one or the other`);
        if (!s.all && s.except.length) errors.push(`${seat}: ${server}:!${s.except[0]} needs ${server}:* beside it`);
    }
    return { order, servers, errors };
}

// The two frontmatter lines a seat's intent produces, plus what kept it from producing them.
function generate(seat, tokens, pins = loadPins())
{
    const { order, servers, errors } = parseIntent(seat, tokens);
    const tools = [];
    const disallowed = [];
    for (const item of order)
    {
        if (item.builtin) { tools.push(item.builtin); continue; }
        const server = item.server;
        const s = servers.get(server);
        const pinned = pins[roleOf(server)] && pins[roleOf(server)].tools;
        if (!Array.isArray(pinned)) { errors.push(`${seat}: ${server} has no pinned tool list in meta/mcp-tools.json, so its other tools cannot be removed - run node scripts/refresh-mcp-pins.js --write`); continue; }
        for (const tool of [...s.tools, ...s.except])
            if (!pinned.includes(tool)) errors.push(`${seat}: ${server} has no tool '${tool}' at its pin (meta/mcp-tools.json)`);
        tools.push(grantOf(server));
        const removed = s.all ? s.except : pinned.filter((t) => !s.tools.includes(t));
        for (const tool of removed) disallowed.push(toolOf(server, tool));
    }
    return { tools: tools.join(', '), disallowed: disallowed.join(', '), errors };
}

// What a seat file's two lines GRANT, resolved against the pinned lists: the proof that a rewrite kept every seat's
// tools. An exact name is itself; a whole-server grant (`mcp__x` or `mcp__x__*`) is every pinned tool of x; the
// removals are taken out after.
function effectiveTools(toolsLine, disallowedLine, pins = loadPins())
{
    const split = (line) => String(line || '').split(',').map((t) => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    const out = new Set();
    for (const t of split(toolsLine))
    {
        const m = /^mcp__plugin_([A-Za-z0-9.-]+)_([A-Za-z0-9.-]+)(?:__(\*))?$/.exec(t);
        const pinned = m && pins[roleOf(m[2])] && pins[roleOf(m[2])].tools;
        if (m && Array.isArray(pinned)) for (const tool of pinned) out.add(toolOf(m[2], tool));
        else out.add(t);
    }
    for (const t of split(disallowedLine)) out.delete(t);
    return out;
}

const lineRe = (key) => new RegExp(`^${key}:[ \\t]*(.*)$`, 'm');
function frontmatterOf(text)
{
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    return m ? m[1] : '';
}
function linesOf(text)
{
    const fm = frontmatterOf(text);
    return { tools: (lineRe('tools').exec(fm) || [])[1] || '', disallowed: (lineRe('disallowedTools').exec(fm) || [])[1] || '' };
}

// A seat file with its two lines replaced: `disallowedTools:` sits right after `tools:`, and goes when nothing is removed.
function rewrite(text, want)
{
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const end = lines.indexOf('---', 1);
    if (lines[0] !== '---' || end < 0) throw new Error('no frontmatter');
    const head = lines.slice(1, end).filter((l) => !/^disallowedTools:/.test(l));
    const at = head.findIndex((l) => /^tools:/.test(l));
    if (at < 0) throw new Error('no tools: line');
    head.splice(at, 1, `tools: ${want.tools}`, ...(want.disallowed ? [`disallowedTools: ${want.disallowed}`] : []));
    return ['---', ...head, ...lines.slice(end)].join(eol);
}

// Every seat whose file differs from its intent, every seat with no intent row, and every row with no seat.
function drift({ intent = loadIntent(), pins = loadPins(), dir = AGENTS_DIR } = {})
{
    const out = [];
    const seats = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
    for (const seat of seats)
    {
        if (!intent[seat]) { out.push(`stack/agents/${seat}.md has no row in meta/seat-tools.json - add what it holds there, then run node scripts/seat-tools.js --write`); continue; }
        const want = generate(seat, intent[seat], pins);
        for (const e of want.errors) out.push(`meta/seat-tools.json: ${e}`);
        if (want.errors.length) continue;
        const have = linesOf(fs.readFileSync(path.join(dir, `${seat}.md`), 'utf8'));
        if (have.tools !== want.tools || have.disallowed !== want.disallowed)
            out.push(`stack/agents/${seat}.md: its tools: / disallowedTools: lines differ from meta/seat-tools.json - the lines are generated: edit the json, then run node scripts/seat-tools.js --write`);
    }
    for (const seat of Object.keys(intent))
        if (!seats.includes(seat)) out.push(`meta/seat-tools.json names '${seat}', which has no stack/agents/${seat}.md`);
    return out;
}

function writeAll({ intent = loadIntent(), pins = loadPins(), dir = AGENTS_DIR } = {})
{
    let changed = 0;
    const errors = [];
    for (const [seat, tokens] of Object.entries(intent))
    {
        const file = path.join(dir, `${seat}.md`);
        if (!fs.existsSync(file)) { errors.push(`no stack/agents/${seat}.md`); continue; }
        const want = generate(seat, tokens, pins);
        if (want.errors.length) { errors.push(...want.errors); continue; }
        const text = fs.readFileSync(file, 'utf8');
        const next = rewrite(text, want);
        if (next !== text) { fs.writeFileSync(file, next); changed += 1; }
    }
    return { changed, errors };
}

module.exports = { generate, effectiveTools, drift, writeAll, rewrite, linesOf, parseIntent, roleOf, INTENT_FILE };

if (require.main === module)
{
    require('../stack/hooks/hook-prelude.js').blockingStdio();
    const run = (fn) =>
    {
        try { return fn(); }
        catch (err) { console.error(`seat-tools: meta/seat-tools.json or meta/mcp-tools.json could not be read (${err.message})`); process.exit(1); }
    };
    if (process.argv.includes('--write'))
    {
        const { changed, errors } = run(writeAll);
        for (const e of errors) console.error(`seat-tools: ${e}`);
        console.log(`seat-tools: ${changed} seat file(s) rewritten`);
        process.exit(errors.length ? 1 : 0);
    }
    const found = run(drift);
    for (const f of found) console.log(f);
    console.log(found.length ? `seat-tools: ${found.length} finding(s)` : 'seat-tools: every seat matches meta/seat-tools.json');
    process.exit(found.length ? 1 : 0);
}
