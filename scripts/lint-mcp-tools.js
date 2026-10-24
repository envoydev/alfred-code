'use strict';
// THE MCP TOOL-NAME CHECKS - 54, 59 and 62 of the parity lint (scripts/lint-skills.js runs and re-exports them).
// Each reads every text file under stack/, setup-plugin/, meta/ and scripts/, line by line. A line that spells a
// name the stack does not ship ON PURPOSE (a test fixture, an old spelling a re-speller maps, a third-party plugin
// in a usage sample) carries the whole word `mcp-fixture` in a comment and is skipped by all three.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ROOTS = ['stack', 'setup-plugin', 'meta', 'scripts'];
const TOOLS_FILE = path.join(ROOT, 'meta', 'mcp-tools.json');
const MCP_FIXTURE_MARKER = /(?:\/\/|#|<!--)[^\n]*?(?<![\w-])mcp-fixture(?![\w-])/;
// A tool (`mcp__plugin_<p>_<s>__<tool>`), a wildcard (`__*`, no tool group) or a whole-server grant ending the word
// (`mcp__plugin_<p>_<s>`, the seats' generated lines - scripts/seat-tools.js); a sentence's period is not the server's.
const PLUGIN_TOOL_SPELLING = /mcp__plugin_([A-Za-z0-9][A-Za-z0-9.-]*)_([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?:__([A-Za-z0-9][A-Za-z0-9_-]*)?|(?![A-Za-z0-9_-]))/g;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The text files under the given roots, the way the three checks read them.
function shippedTextFiles(roots = ROOTS, root = ROOT)
{
    const files = [];
    const skip = /(^|\/)(node_modules|\.git)(\/|$)/;
    const walk = (dir) =>
    {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const d of entries)
        {
            const full = path.join(dir, d.name);
            const rel = path.relative(root, full).split(path.sep).join('/');
            if (skip.test(rel)) continue;
            if (d.isDirectory()) { walk(full); continue; }
            if (!/\.(md|mdc|js|json|sh|ps1|html|txt)$/.test(d.name)) continue;
            try { files.push({ file: rel, text: fs.readFileSync(full, 'utf8') }); } catch { /* unreadable: nothing to sweep */ }
        }
    };
    for (const r of roots) walk(path.join(root, r));
    return files;
}

const each = (files, fn) =>
{
    for (const { file, text } of files || shippedTextFiles())
        text.split('\n').forEach((line, i) => { if (!MCP_FIXTURE_MARKER.test(line)) fn(file, i + 1, line); });
};

// The renamed and retired server names (meta/stack-manifest.json) - each old browser spelling per engine is its own
// row there, plus the 1.x single `playwright` - and each alias's successor.
function oldNames(manifest)
{
    const m = manifest || JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'stack-manifest.json'), 'utf8'));
    const successor = { ...((m.renamed && m.renamed.mcps) || {}) };
    return { successor, retired: [...((m.retired && m.retired.mcps) || [])] };
}

// 54. No server name the stack ever shipped is spelled bare, `mcp__<server>__<tool>`: since 2026-10-24 the stack ships
// no server at all, and a body naming one of its old names names a tool that resolves to nothing (a `tools:`
// allowlist silently drops it, a `ToolSearch select:` line silently finds none). The names are read from the
// manifest, never typed here - every name the stack renamed or retired (M31), today's included.
function lintMcpToolNames({ files, names } = {})
{
    let bareNames = names;
    if (!bareNames)
    {
        try
        {
            const { successor, retired } = oldNames();
            bareNames = [...Object.keys(successor), ...retired];
        }
        catch (err) { return [`the manifest could not be read, so the tool-name sweep did not run: ${err.message}`]; }
    }
    // a tool or wildcard (`mcp__<s>__...`), or a whole-server grant ending the word (`mcp__<s>`)
    const bare = new RegExp(`mcp__(${[...new Set(bareNames)].sort((a, b) => b.length - a.length).map(escape).join('|')})(?:__|(?![A-Za-z0-9_-]))`, 'g');
    const out = [];
    each(files, (file, n, line) =>
    {
        const found = line.match(bare);
        if (found) out.push(`${file}:${n} names an MCP tool by its bare server spelling (\`${found[0]}\`) - a plugin server's tools are \`mcp__plugin_<plugin>_<server>__<tool>\`, so the bare form resolves to nothing. A deliberate fixture line carries \`mcp-fixture\` in a comment.`);
    });
    return out;
}

// 59. Every PLUGIN tool spelling names a server the marketplace ships - none since 2026-10-24, so every plugin
// spelling outside a fixture is stale. Check 54 bans the bare form; this one
// catches the plugin form outliving its plugin - a renamed server (serena -> navigation) leaves
// `mcp__plugin_<old>_<old>__` in every allowlist and ToolSearch line, and each resolves to nothing, silently.
// Through 2.2.0 one window was deliberate (M35): the renamed ids were LISTED as aliases and the seats granted their
// old spellings on a `tools:` / `disallowedTools:` line. 2.2.1 unlisted the aliases, so no old spelling passes.
const SEAT_GRANT_LINE = (file, line) => /^stack\/agents\/[^/]+\.md$/.test(file) && /^(tools|disallowedTools):/.test(line);
function lintStaleMcpToolNames({ files, entries, aliases } = {})
{
    let shipped = entries;
    let listed = aliases;
    try
    {
        // The marketplace's own server entries: none since the stack stopped shipping servers (lint 53 holds it).
        if (!shipped) shipped = (JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8')).plugins || []).filter((p) => p && p.mcpServers);
        // No RETIRED alias is listed since 2.2.1, so an old spelling is stale everywhere.
        if (!listed) listed = [];
    }
    catch (err) { return [`the marketplace could not be read, so the stale tool-name sweep did not run: ${err.message}`]; }
    const servers = new Map(shipped.map((e) => [e.name, new Set(Object.keys(e.mcpServers || {}))]));
    const aliased = new Map(listed.map((e) => [e.name, new Set(Object.keys(e.mcpServers || {}))]));
    const out = [];
    each(files, (file, n, line) =>
    {
        for (const [, plugin, server] of line.matchAll(PLUGIN_TOOL_SPELLING))
        {
            const spelled = `mcp__plugin_${plugin}_${server}__`;
            if (!servers.has(plugin) && aliased.has(plugin) && aliased.get(plugin).has(server) && SEAT_GRANT_LINE(file, line)) continue;
            if (!servers.has(plugin))
                out.push(`${file}:${n} names \`${spelled}\`, but no marketplace entry named '${plugin}' carries a server - the tool resolves to nothing. Re-spell it to the shipped server; a deliberate fixture line carries \`mcp-fixture\` in a comment.`);
            else if (!servers.get(plugin).has(server))
                out.push(`${file}:${n} names \`${spelled}\`, but the plugin '${plugin}' carries no server '${server}' - one plugin, one server, same name (check 53).`);
        }
    });
    return out;
}

// 62. Every plugin tool spelling names a TOOL its pinned server has (M31). Check 59 reads only the plugin and
// server part, so a pin bump that renames or drops a tool shipped a silent drop. meta/mcp-tools.json holds each
// pinned server's tool names, written by `refresh-mcp-pins.js --write` beside the pins; a browser engine is judged
// by the one browser list, a renamed alias (still listed for installs not yet updated) by its successor's, and a
// wildcard names no tool. A plugin the file does not list is check 59's business, not this one's.
function lintMcpToolsAtPin({ files, tools } = {})
{
    let table = tools;
    if (!table)
    {
        try { table = JSON.parse(fs.readFileSync(TOOLS_FILE, 'utf8')); }
        catch (err) { return [`meta/mcp-tools.json is unreadable (${err.message}), so no spelled tool was checked against its pin - run node scripts/refresh-mcp-pins.js --write`]; }
    }
    const listed = (table && table.servers) || {};
    let successor = {};
    try { ({ successor } = oldNames()); } catch { /* no manifest: judge only today's names */ }
    const roleOf = (plugin) =>
    {
        const now = successor[plugin] || plugin;
        return /^(?:chrome|msedge|firefox|webkit)-control$/.test(now) ? 'browser' : now;
    };
    const out = [];
    each(files, (file, n, line) =>
    {
        for (const [, plugin, , tool] of line.matchAll(PLUGIN_TOOL_SPELLING))
        {
            const role = roleOf(plugin);
            if (!tool || !listed[role] || !Array.isArray(listed[role].tools)) continue;
            if (!listed[role].tools.includes(tool))
                out.push(`${file}:${n} names the tool \`${tool}\` on the ${role} server, which ${listed[role].version ? `${role} ${listed[role].version}` : 'the pinned server'} does not have (meta/mcp-tools.json) - re-spell it, or refresh the list with node scripts/refresh-mcp-pins.js --write.`);
        }
    });
    return out;
}

module.exports = { lintMcpToolNames, lintStaleMcpToolNames, lintMcpToolsAtPin, shippedTextFiles, MCP_FIXTURE_MARKER, TOOLS_FILE };
