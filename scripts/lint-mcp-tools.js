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
const PLUGIN_TOOL_SPELLING = /mcp__plugin_([A-Za-z0-9][A-Za-z0-9.-]*)_([A-Za-z0-9][A-Za-z0-9.-]*)__([A-Za-z0-9][A-Za-z0-9_-]*)?/g;
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

// The renamed and retired server names (meta/stack-manifest.json), each old browser spelling per engine plus the
// 1.x single `playwright`, and each alias's successor.
function oldNames(manifest)
{
    const m = manifest || JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'stack-manifest.json'), 'utf8'));
    const { PW_ENGINES } = require('./build-marketplace.js');
    const renamed = (m.renamed && m.renamed.mcps) || {};
    const successor = {};
    for (const [from, to] of Object.entries(renamed))
    {
        successor[from] = to;
        if (to === 'browser') for (const e of PW_ENGINES) successor[`${from}-${e}`] = `${to}-${e}`;
    }
    return { successor, retired: [...((m.retired && m.retired.mcps) || [])] };
}

// 54. Every MCP server the stack ships arrives through a PLUGIN, so its tools are addressed
// `mcp__plugin_<plugin>_<server>__<tool>`. The bare `mcp__<server>__<tool>` spelling belonged to the registration
// route and resolves to nothing now: a `tools:` allowlist written that way silently drops the tool, and a
// `ToolSearch select:` line written that way silently finds none. The names are read from the generated entries
// and the manifest, never typed here - today's servers, and (M31) every name the stack renamed or retired, whose
// bare spelling resolves to nothing as surely.
function lintMcpToolNames({ files, names } = {})
{
    let bareNames = names;
    if (!bareNames)
    {
        try
        {
            const { successor, retired } = oldNames();
            bareNames = [...require('./build-marketplace.js').mcpPlugins().map((e) => e.name), ...Object.keys(successor), ...retired];
        }
        catch (err) { return [`the MCP entries could not be generated, so the tool-name sweep did not run: ${err.message}`]; }
    }
    const bare = new RegExp(`mcp__(${[...new Set(bareNames)].sort((a, b) => b.length - a.length).map(escape).join('|')})__`, 'g');
    const out = [];
    each(files, (file, n, line) =>
    {
        const found = line.match(bare);
        if (found) out.push(`${file}:${n} names an MCP tool by its bare server spelling (\`${found[0]}\`) - a plugin server's tools are \`mcp__plugin_<plugin>_<server>__<tool>\`, so the bare form resolves to nothing. A deliberate fixture line carries \`mcp-fixture\` in a comment.`);
    });
    return out;
}

// 59. Every PLUGIN tool spelling names a server the marketplace ships. Check 54 bans the bare form; this one
// catches the plugin form outliving its plugin - a renamed server (serena -> navigation) leaves
// `mcp__plugin_<old>_<old>__` in every allowlist and ToolSearch line, and each resolves to nothing, silently.
// One window is deliberate (M35): the renamed ids stay LISTED as aliases for installs not yet updated, and the seats
// the 1.x core alias carries grant their old spellings - so an alias spelling passes on a seat's `tools:` /
// `disallowedTools:` line, and nowhere else.
const SEAT_GRANT_LINE = (file, line) => /^stack\/agents\/[^/]+\.md$/.test(file) && /^(tools|disallowedTools):/.test(line);
function lintStaleMcpToolNames({ files, entries, aliases } = {})
{
    let shipped = entries;
    let listed = aliases;
    try
    {
        if (!shipped) shipped = require('./build-marketplace.js').mcpPlugins();
        if (!listed) listed = entries ? [] : require('./build-marketplace.js').mcpAliasEntries();
    }
    catch (err) { return [`the MCP entries could not be generated, so the stale tool-name sweep did not run: ${err.message}`]; }
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
        return /^browser-/.test(now) ? 'browser' : now;
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
