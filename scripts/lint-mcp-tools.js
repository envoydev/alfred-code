'use strict';
// THE MCP NAME CHECKS - 54, 59 and 67 of the parity lint (scripts/lint-skills.js runs and re-exports them).
// 54 and 59 read every text file under stack/, setup-plugin/, meta/ and scripts/, 67 the shipped bodies, line by line. A
// line that spells a name the stack does not ship ON PURPOSE (a test fixture, an old spelling a re-speller maps, a
// third-party plugin in a usage sample) carries the whole word `mcp-fixture` in a comment and is skipped by all three.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ROOTS = ['stack', 'setup-plugin', 'meta', 'scripts'];
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

// 67. No shipped skill, rule, seat or command body names an MCP tool or a server the stack retired with its servers
// (spec N8, the user's ruling of 2026-10-24: the stack depends on no MCP server). 54 and 59 catch a spelling of a name
// the stack once shipped; this one catches any CONCRETE spelling - `mcp__<name>` or `mcp__plugin_<name>` - since a body
// that calls a server the user may not have registered depends on it, and the stack's own server ids in prose. A
// placeholder (`<server>`, `*`, a pattern's `.`) names no server. The ids are read, never typed: the manifest's
// retired.mcps rows whose retired-plugins row carries the newest retirement - the release that took every server out.
// update-history.md is the release record and names what each release changed, so it is not read.
const BODY_FILE = /^(?:stack\/(?:skills|rules|agents)|setup-plugin\/(?:commands|references|skills))\/.*\.md$/;
const RELEASE_RECORD = 'setup-plugin/references/update-history.md';
const CONCRETE_SPELLING = /mcp__(?!plugin_[^A-Za-z0-9])(?=[A-Za-z0-9])[A-Za-z0-9][A-Za-z0-9._-]*/g;
function retiredServerIds()
{
    const { retired } = oldNames();
    const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'retired-plugins.json'), 'utf8')).plugins || [];
    const servers = rows.filter((r) => retired.includes(r.name) && r.retiredIn);
    const cmp = (a, b) => a.split('.').map(Number).reduce((d, n, i) => d || n - (Number(b.split('.')[i]) || 0), 0);
    const newest = servers.map((r) => r.retiredIn).sort(cmp).pop();
    return servers.filter((r) => r.retiredIn === newest).map((r) => r.name);
}
function lintServerFreeBodies({ files, names } = {})
{
    let ids = names;
    if (!ids)
    {
        try { ids = retiredServerIds(); }
        catch (err) { return [`the manifest or meta/retired-plugins.json could not be read, so the server-free body sweep did not run: ${err.message}`]; }
    }
    const id = ids.length ? new RegExp(`(?<![\\w./<>-])(${[...ids].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![\\w-]|\\.md)`) : null;
    const bodies = (files || shippedTextFiles(['stack', 'setup-plugin'])).filter((f) => BODY_FILE.test(f.file) && f.file !== RELEASE_RECORD);
    const out = [];
    each(bodies, (file, n, line) =>
    {
        const spelled = line.match(CONCRETE_SPELLING);
        if (spelled) out.push(`${file}:${n} names the MCP tool \`${spelled[0]}\` - the stack depends on no MCP server, so a body names the job and the session-start tool order's tools for it. A deliberate example carries \`mcp-fixture\` in a comment.`);
        const named = id && id.exec(line);
        if (named) out.push(`${file}:${n} names \`${named[1]}\`, a server the stack retired - it ships none, so a body names the job, not a server. A deliberate example carries \`mcp-fixture\` in a comment.`);
    });
    return out;
}

module.exports = { lintMcpToolNames, lintStaleMcpToolNames, lintServerFreeBodies, retiredServerIds, shippedTextFiles, MCP_FIXTURE_MARKER };
