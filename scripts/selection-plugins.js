#!/usr/bin/env node
'use strict';
// Turns a SELECTION file into the plugin set that carries it, for the installers.
//
//   node scripts/selection-plugins.js --selection <file>   one `<plugin>@<marketplace>` per line
//   node scripts/selection-plugins.js --selection <file> --copy   the items no plugin carries
//   node scripts/selection-plugins.js --items <plugin>[,<plugin>]  the skills and agents those carry
//
// The core plugin carries the always closure; every other skill and agent is LIBRARY, listed by no
// entry (plugin-placement.js says why). So an install is: enable the core, copy the library items
// the selection picked, copy nothing else. `copy` is that library list.
const fs = require('node:fs');
const path = require('node:path');
const { placement, CORE, readRetiredEntries } = require('./plugin-placement.js');

const REPO = path.resolve(__dirname, '..');

function readSelection(file)
{
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (err) { throw new Error(`selection-plugins: cannot read ${file} - ${err.message}`); }
    return parseSelectionText(raw);
}

// The same parse over text already in hand - the installer holds the selection as lines, not as a
// file, on the `--installed-only` route where nothing was ever written to disk.
function parseSelectionText(raw)
{
    const picked = { skills: new Set(), agents: new Set(), mcps: new Set() };
    for (const line of String(raw).split('\n'))
    {
        const m = line.trim().match(/^(skill|agent|mcp)\s+(\S+)$/);
        if (!m) continue;
        if (m[1] === 'mcp') { picked.mcps.add(mcpPlugin(m[2])); continue; }
        picked[m[1] === 'skill' ? 'skills' : 'agents'].add(m[2].replace(/\.md$/, ''));
    }
    return picked;
}

// From Phase 6 every catalog server is carried by a plugin holding exactly ONE server, named
// exactly like the plugin - which is what makes each tool `mcp__plugin_<n>_<n>__<tool>` for a
// single `<n>`, and what keeps a project from loading a server it did not pick (all of a plugin's
// servers load together). So the mapping is the IDENTITY, and the one expanded family is expanded
// BEFORE it reaches here: the caller passes `browser-chrome`, not `browser`.
function mcpPlugin(server)
{
    return String(server);
}

function pluginsFor(picked, options = {})
{
    const place = options.placement || placement(options);
    const homes = new Map();
    for (const [plugin, items] of Object.entries(place.plugins))
    {
        for (const s of items.skills) homes.set(`skill:${s}`, plugin);
        for (const a of items.agents) homes.set(`agent:${a}`, plugin);
    }
    // The core is always enabled: it carries the guided-walk commands and the baseline skills, and
    // every other entry depends on it.
    const wanted = new Set([CORE]);
    const copy = { skills: [], agents: [] };
    const add = (name) =>
    {
        if (!place.plugins[name] || wanted.has(name)) return;
        wanted.add(name);
        for (const dep of place.plugins[name].dependencies) add(dep);
    };
    for (const kind of ['skills', 'agents'])
    {
        for (const item of [...picked[kind]].sort())
        {
            const home = homes.get(`${kind === 'skills' ? 'skill' : 'agent'}:${item}`);
            if (home) add(home); else copy[kind].push(item);
        }
    }
    // The MCP plugins are not part of the skill/agent placement - each is its own entry generated
    // from the installer's catalog - so they join the set directly, the three locked servers
    // included: the core declares no dependencies, so the set is what installs them.
    for (const plugin of [...(picked.mcps || [])].sort()) wanted.add(plugin);
    return { plugins: [...wanted].sort(), copy };
}

// The inverse direction, for a reader that has the ENABLED PLUGINS and needs the set they carry -
// the `--installed-only` derivation, which on this route finds the library copies on disk.
function itemsOf(names, options = {})
{
    const place = options.placement || placement(options);
    // A retired per-stack entry still installed here carries what 1.2.0 put in it, frozen.
    const retired = new Map((options.retired || readRetiredEntries()).map((e) => [e.name, e]));
    const out = { skills: [], agents: [] };
    for (const name of names)
    {
        const bare = String(name).split('@')[0];
        const plug = place.plugins[bare] || retired.get(bare);
        if (!plug) continue;
        out.skills.push(...plug.skills);
        out.agents.push(...plug.agents);
    }
    out.skills = [...new Set(out.skills)].sort();
    out.agents = [...new Set(out.agents)].sort();
    return out;
}

function main(argv)
{
    const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
    const items = arg('--items');
    if (items)
    {
        const got = itemsOf(items.split(',').map(s => s.trim()).filter(Boolean));
        for (const s of got.skills) console.log(`skill ${s}`);
        for (const a of got.agents) console.log(`agent ${a}`);
        return 0;
    }
    const file = arg('--selection');
    if (!file) { console.error('usage: selection-plugins.js --selection <file> [--copy] [--marketplace <name>] | --items <plugin>[,<plugin>]'); return 1; }
    const marketplace = arg('--marketplace') || 'envoydev';
    const { plugins, copy } = pluginsFor(readSelection(path.resolve(file)));
    if (argv.includes('--copy'))
    {
        for (const s of copy.skills) console.log(`skill ${s}`);
        for (const a of copy.agents) console.log(`agent ${a}`);
        return 0;
    }
    for (const p of plugins) console.log(`${p}@${marketplace}`);
    return 0;
}

if (require.main === module)
{
    try { process.exit(main(process.argv.slice(2))); }
    catch (err) { console.error(String(err.message || err)); process.exit(1); }
}

module.exports = { mcpPlugin, readSelection, parseSelectionText, pluginsFor, itemsOf, REPO };
