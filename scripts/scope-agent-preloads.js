#!/usr/bin/env node
'use strict';
// Rewrites every agent's `skills:` frontmatter to the spelling its placement needs: a CORE skill
// scoped to the core plugin (`alfred-code:<name>`), a LIBRARY skill bare - it is the project copy
// the installer wrote beside the agent.
//
//   node scripts/scope-agent-preloads.js --write    rewrite stack/agents/*.md in place
//   node scripts/scope-agent-preloads.js --check    exit 1 when any line disagrees (the lint path)
//
// Why it is generated and not hand-written. Spike S6 measured that a BARE `skills:` line preloads a
// stale `.claude/skills/` copy when one is present, silently, with no error and no sign in the
// transcript - and every project being migrated has exactly that shape for at least one session.
// Spike S11 then measured that a scoped name resolves even when the skill lives in a DIFFERENT
// plugin. So a core skill is always cited scoped. A library skill has no plugin to scope to: since
// 1.3.0 its copy in `.claude/skills` IS the intended one, so the bare name is the right cite, and
// the graph closes an agent's preloads into its selection, so the copy is there whenever the agent is.
//
// A cite that already carries a colon is FOREIGN (another plugin's `<plugin>:<skill>`) and is left
// exactly as it is - this script owns house skills only.
const fs = require('node:fs');
const path = require('node:path');
const { placement, CORE, LIBRARY } = require('./plugin-placement.js');

const REPO = path.resolve(__dirname, '..');
const AGENTS_DIR = path.join(REPO, 'stack/agents');

// The frontmatter block plus the `skills:` list inside it. A YAML list only - every agent in this
// repo writes it that way, and a flow-style `skills: [a, b]` would be a different shape to parse,
// so it is reported rather than guessed at.
function parse(text, file)
{
    const m = text.match(/^---\n([\s\S]*?)\n---\n/);
    if (!m) throw new Error(`${file}: no frontmatter block`);
    const fm = m[1];
    const list = fm.match(/^skills:[ \t]*\n((?:[ \t]*-[ \t]*\S.*\n?)+)/m);
    if (!list)
    {
        if (/^skills:[ \t]*\S/m.test(fm)) throw new Error(`${file}: skills: is not a YAML list - rewrite it as one before running this`);
        return null;
    }
    const names = list[1].split('\n').map(l => l.replace(/^[ \t]*-[ \t]*/, '').trim()).filter(Boolean);
    return { fmStart: m.index + 4, block: list[0], names, at: m.index + 4 + list.index };
}

function homes(place)
{
    const skillHome = new Map();
    const agentHome = new Map();
    for (const [plugin, items] of Object.entries(place.plugins))
    {
        for (const s of items.skills) skillHome.set(s, plugin);
        for (const a of items.agents) agentHome.set(a, plugin);
    }
    return { skillHome, agentHome };
}

function scopedFor(options = {})
{
    const place = options.placement || placement(options);
    const { skillHome, agentHome } = homes(place);
    const library = new Set(place.library.skills);
    const agentsDir = options.agentsDir || AGENTS_DIR;
    const out = [];
    for (const file of fs.readdirSync(agentsDir).filter(f => f.endsWith('.md')).sort())
    {
        const full = path.join(agentsDir, file);
        const text = fs.readFileSync(full, 'utf8');
        const parsed = parse(text, file);
        if (!parsed) continue;
        const agent = file.replace(/\.md$/, '');
        const own = agentHome.get(agent) || LIBRARY;
        const problems = [];
        const wanted = parsed.names.map((name) =>
        {
            if (name.includes(':') && !name.startsWith('alfred-code')) return name;   // foreign, not ours to scope
            const bare = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
            const home = skillHome.get(bare);
            if (home) return `${home}:${bare}`;
            if (!library.has(bare)) { problems.push(`${bare} is neither a core nor a library skill`); return name; }
            // A core seat is in every project; a library skill is only where it was picked.
            if (own === CORE) problems.push(`${bare} is library, and ${agent} is a core seat that every project carries`);
            return bare;
        });
        const block = `skills:\n${wanted.map(n => `  - ${n}\n`).join('')}`;
        out.push({ file, agent, plugin: own, text, at: parsed.at, block: parsed.block, wanted: block, problem: problems.join('; ') || null });
    }
    return out;
}

function main(argv)
{
    const rows = scopedFor();
    const broken = rows.filter(r => r.problem);
    const stale = rows.filter(r => !r.problem && r.block !== r.wanted);
    if (argv.includes('--check'))
    {
        for (const r of broken) console.error(`agent preload: ${r.file} - ${r.problem}`);
        for (const r of stale) console.error(`agent preload: ${r.file} is not scoped to the placement - run \`npm run scope-preloads\``);
        if (broken.length || stale.length) return 1;
        console.log(`agent preloads current: ${rows.length} agent(s) with a skills: list`);
        return 0;
    }
    if (argv.includes('--write'))
    {
        for (const r of broken) console.error(`agent preload: ${r.file} - ${r.problem}`);
        if (broken.length) return 1;
        let changed = 0;
        for (const r of stale)
        {
            fs.writeFileSync(path.join(AGENTS_DIR, r.file), r.text.slice(0, r.at) + r.wanted + r.text.slice(r.at + r.block.length));
            changed++;
        }
        console.log(`agent preloads written: ${changed} of ${rows.length} agent(s) rescoped`);
        return 0;
    }
    console.error('usage: scope-agent-preloads.js --write | --check');
    return 1;
}

if (require.main === module)
{
    try { process.exit(main(process.argv.slice(2))); }
    catch (err) { console.error(String(err.message || err)); process.exit(1); }
}

module.exports = { scopedFor, parse };
