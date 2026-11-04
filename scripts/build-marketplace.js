#!/usr/bin/env node
'use strict';
// Generates the marketplace plugin ENTRIES from the computed placement. Nothing here creates a folder: every entry shares the repo root as its `source` and
// lists the skill folders and agent files it ships, which is the shape spike S9 proved
// (docs/plugin-migration-evidence.md). `stack/` stays the one home per piece.
//
//   node scripts/build-marketplace.js --write        regenerate meta/plugin-entries.json
//   node scripts/build-marketplace.js --check        exit 1 when that file is stale
//
// The live .claude-plugin/marketplace.json is NOT touched by --write, which only regenerates
// meta/plugin-entries.json; --write-marketplace is the Phase 3 transcription that applies those
// entries to the live file, leaving the marketplace metadata alone.
//
//   node scripts/build-marketplace.js --write-marketplace   apply the entries to the live file
//   node scripts/build-marketplace.js --hooks-entry         print the core's hooks block (lint 48)
//
// The CORE entry is generated too, from Phase 3 on. It used to ship from `./setup-plugin`, whose
// own .claude-plugin/plugin.json was its manifest; its seats live under stack/, outside that folder,
// and a `../` path out of a plugin root is undocumented (Phase 2 ruling R1 refused to build on it). At
// `source: './'` nothing under setup-plugin/ is auto-discovered, so the entry carries every path
// explicitly - the guided-walk commands, the router skill and every seat (2.1.0: no stack skill rides
// a plugin, each is a project copy) - plus the layer-table hook INLINE that plugin.json used to
// declare. Dropping it on the way across would be a silent behaviour change.
//
// From 2.0.0 the core also carries EVERY stack hook inline (user ruling 'Fold into core in 2.0.0'):
// there is no separate hooks entry, so a project that has the core has the guards.
const fs = require('node:fs');
const path = require('node:path');
const { placement, CORE } = require('./plugin-placement.js');
const { timeoutFor, asyncFor, onFailureFor } = require('./install/settings.js');
const { loadManifest } = require('./install/manifest.js');
const { HOOK_PROFILES } = require('../stack/hooks/hook-prelude.js');
const { wiringRows } = require('../stack/hooks/shell-guards.js');
const fileGuards = require('../stack/hooks/file-guards.js');
const historySession = require('../stack/hooks/history-session.js');

const REPO = path.resolve(__dirname, '..');
const ENTRIES_FILE = path.join(REPO, 'meta/plugin-entries.json');
const MARKETPLACE = path.join(REPO, '.claude-plugin/marketplace.json');

function readJson(file, what)
{
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (err) { throw new Error(`${what}: cannot read ${file} - ${err.message}`); }
    try { return JSON.parse(raw); }
    catch (err) { throw new Error(`${what}: ${file} is not valid JSON - ${err.message}`); }
}

function marketplaceVersion(options = {})
{
    const mkt = options.marketplace || readJson(MARKETPLACE, 'marketplace.json');
    return (mkt.metadata && mkt.metadata.version) || '0.0.0';
}

// Every plugin hook runs as `node "<plugin root>/<file>"`. Shell form, launched through node and
// QUOTED, is the docs' own spelling for a plugin script ('Exec form and shell form',
// code.claude.com/docs/en/hooks) and the one 0.2.x shipped. A bare script path needs the exec bit,
// which git carries into the plugin cache verbatim - five hooks were committed 100644 and died
// 'permission denied' before a line ran - and a shebang, which Windows never honours. Args stay in
// the string: an `args` array switches to exec form, whose `command` must be a real executable.
const launch = (file, args) => `node "\${CLAUDE_PLUGIN_ROOT}/${file}"${args && args.length ? ` ${args.join(' ')}` : ''}`;

// The guided-walk COMMANDS and the router SKILL, the two things no other entry has. Read from
// setup-plugin's own plugin.json so one list stays the source of the command set, and re-rooted at
// the repo root the entry now ships from.
const SETUP_MANIFEST = path.join(REPO, 'setup-plugin/.claude-plugin/plugin.json');

function coreEntry(options = {})
{
    const place = options.placement || placement(options);
    const plug = place.plugins[CORE];
    const setup = readJson(options.setupManifest || SETUP_MANIFEST, 'setup-plugin/plugin.json');
    const commands = (setup.commands || []).map(c => `./setup-plugin/${String(c).replace(/^\.\//, '')}`);
    if (!commands.length) throw new Error('build-marketplace: setup-plugin/plugin.json lists no commands - the core entry would ship no guided walk');
    const entry = {
        name: CORE,
        source: './',
        description: setup.description,
        version: options.version || marketplaceVersion(options),
        author: options.author || { name: 'envoydev', url: 'https://github.com/envoydev' },
        strict: false,
        category: 'development',
        tags: ['setup', 'installer', 'skills', 'agents', 'mcp', 'bootstrap'],
        // One /config row for the whole hook set, per user (pluginConfigs lives in the account settings
        // only). hook-prelude.js reads it as CLAUDE_PLUGIN_OPTION_HOOK_PROFILE; a project's
        // ALFRED_CODE_HOOKS_OFF still wins. A plain string, NOT an `options` picker: a plugin declaring
        // `options` on any field does not load at all on Claude Code before v2.1.271
        // (code.claude.com/docs/en/plugins-reference), and the core carries every guard. The prelude reads
        // any value it does not know as standard, so the description names the three it knows.
        userConfig: {
            hook_profile: {
                type: 'string',
                title: 'Hook profile',
                description: `Which Alfred Code hooks run - one of ${HOOK_PROFILES.join(', ')}: minimal keeps only the rm, secret, force-push and desktop exec guards; standard is the default set; strict adds the Stop build check. Any other value runs as standard. A project's ALFRED_CODE_HOOKS_OFF still switches a hook off.`,
                default: 'standard',
            },
        },
        commands,
        skills: ['./setup-plugin/skills/alfred-code'].concat(plug.skills.map(s => `./stack/skills/${s}`)),
        agents: plug.agents.map(a => `./stack/agents/${a}.md`),
        // The layer-table guard used to be auto-discovered from setup-plugin/hooks/hooks.json. At
        // the shared root it is not, so it is declared inline - the shape Phase 2 proved for the
        // stack hooks, which follow it in the same block.
        hooks: mergeHooks({
            PreToolUse: [{
                matcher: 'AskUserQuestion',
                hooks: [{ type: 'command', command: launch('setup-plugin/hooks/guard-layer-table.js'), timeout: 10 }],
            }, {
                // 2026-10-21: the walk's next step is judged too (a layer table with no answered ask after it). Every
                // walk step is a `node` call, so `if` keeps the spawn off every other shell command (code.claude.com/
                // docs/en/hooks, 'if': each subcommand is checked); the hook leaves at once on a non-walk node call.
                matcher: 'Bash',
                hooks: [{ type: 'command', if: 'Bash(node *)', command: launch('setup-plugin/hooks/guard-layer-table.js'), timeout: 10 }],
            }],
            // F4 (2026-10-28): the ask's own message is on disk only once the PreToolUse hooks finish, so the paste and
            // banner checks run here and void an unpasted answer through updatedToolOutput.
            PostToolUse: [{
                matcher: 'AskUserQuestion',
                hooks: [{ type: 'command', command: launch('setup-plugin/hooks/guard-layer-table.js'), timeout: 10 }],
            }],
            // Library copies move only on /alfred-code:update, so a session on a newer stack says
            // so at each fresh context - a startup, a /clear and a resume (loading audit 2026-10-21 G12: a cleared
            // or resumed session never carried it), a fork (its own session id - code.claude.com/docs/en/hooks lists `fork`
            // as a SessionStart source; audit 2026-10-30 HK-24) - and not at a compaction, which would show the user the line again.
            SessionStart: [{
                matcher: 'startup|clear|resume|fork',
                hooks: [{ type: 'command', command: launch('setup-plugin/hooks/library-stamp.js'), timeout: 10 }],
            }],
        }, hooksBlock(options.wirings || parseHookWirings(options.sourceDir))),
    };
    return entry;
}

// THE ONE MERGE of two hooks blocks: per event, `first`'s groups lead, and a matcher both carry is
// one group with `first`'s hooks ahead - the grouping hooksBlock keeps, so the entry stays readable.
// Neither input is mutated.
function mergeHooks(first, second)
{
    const out = {};
    for (const block of [first, second])
        for (const [event, groups] of Object.entries(block || {}))
        {
            const list = out[event] || (out[event] = []);
            for (const g of groups)
            {
                const same = list.find((h) => String(h.matcher) === String(g.matcher));
                if (same) same.hooks.push(...g.hooks);
                else list.push({ ...g, hooks: [...g.hooks] });
            }
        }
    return out;
}

function buildEntries(options = {})
{
    const place = options.placement || placement(options);
    const version = options.version || marketplaceVersion(options);
    const author = options.author || { name: 'envoydev', url: 'https://github.com/envoydev' };
    // One entry: the core. Every other skill and agent is LIBRARY - listed by no entry, copied into
    // a project per pick (plugin-placement.js says why).
    return [coreEntry({ ...options, placement: place, version, author })];
}

function serialize(entries)
{
    return JSON.stringify({
        generatedBy: 'build-marketplace',
        note: 'Generated by scripts/build-marketplace.js from meta/recommendations.json + meta/stack-graph.json. Do not edit by hand; run `npm run marketplace`.',
        entries,
    }, null, 2) + '\n';
}

// An entry this generator USED to write and no longer does: the hooks entry the 2.0.0 line
// generated before the hooks folded into the core. Never released, so it is no retirement the seed
// prunes - only a stale entry the live file must not keep installable.
const FOLDED_ENTRIES = ['alfred-code-hooks'];

// Applies the generated entries to the live marketplace, the CORE entry included from Phase 3 on.
// Anything the generator does not own - a hand-written extra - keeps its place, except a RETIRED or
// FOLDED name the entries no longer carry, and every MCP server entry: the stack ships no server since
// 2026-10-24 (the user's ruling - the record of what it shipped is stack/mcp/shipped-mcps.json), and a
// dead entry left listed stays installable.
const mcpEntry = (p) => Boolean(p && p.mcpServers && !p.skills && !p.agents && !p.commands && !p.hooks);
function applyToMarketplace(mkt, entries, { retired = [] } = {})
{
    const gone = new Set([...retired, ...FOLDED_ENTRIES]);
    const kept = (mkt.plugins || []).filter(p => !entries.some(e => e.name === p.name) && !gone.has(p.name) && !mcpEntry(p));
    mkt.plugins = kept.concat(entries);
    return mkt;
}

// ---------------------------------------------------------------------------------------------
// The stack hooks the core carries. The wiring table has ONE home - the `hooks` list in
// meta/stack-manifest.json (hand-edited since Phase 7b deleted the twins that used to generate it),
// where each row renders to `file::matcher::args` and a matcher starting with `@` names its own
// event (`@Stop`, `@SessionStart:compact`) instead of PreToolUse. Reading that list rather than
// retyping it is what keeps the plugin wiring and the settings.json wiring from drifting - both the
// seed (scripts/install/manifest.js) and this generator read the same file - and the lint fails
// when the generated entry goes stale.
//
// The hooks are declared INLINE in the core entry, not through a `hooks/hooks.json` at the shared
// root: spike S9 assert (c) measured that a shared root is auto-discovered by every entry over it,
// and the Phase 1 and Phase 2 spikes measured that an inline block gives each entry its own hooks,
// fired once, for all six event types the stack uses.

function parseHookWirings(sourceDir)
{
    const { catalogs } = loadManifest(sourceDir || REPO);
    if (!catalogs.hooks.length) throw new Error('build-marketplace: meta/stack-manifest.json hooks[] is empty - the wiring table moved');
    // The shell guards' rows fold into ONE shell-guards.js row: one process per shell call, not eight - and the
    // file guards' into ONE file-guards.js row (2.1.5 M3): one process per file-tool call, not three - and the turn
    // check's Stop row into history-session's (2026-10-16): one process per turn fewer.
    const rows = historySession.wiringRows(fileGuards.wiringRows(wiringRows(catalogs.hooks)));
    const out = [];
    for (const line of rows)
    {
        const [file_, rawMatcher, rawArgs] = line.split('::');
        const wiring = { file: file_ };
        if (rawMatcher && rawMatcher.startsWith('@'))
        {
            const [event, matcher] = rawMatcher.slice(1).split(':');
            wiring.event = event;
            if (matcher) wiring.matcher = matcher;
        }
        else
        {
            wiring.event = 'PreToolUse';
            if (rawMatcher) wiring.matcher = rawMatcher;
        }
        const args = String(rawArgs || '').trim();
        if (args) wiring.args = args.split(/\s+/);
        out.push(wiring);
    }
    if (!out.length) throw new Error('build-marketplace: the manifest hooks[] parsed to nothing');
    return out;
}

function hooksBlock(wirings)
{
    const block = {};
    for (const w of wirings || parseHookWirings())
    {
        const list = block[w.event] || (block[w.event] = []);
        let group = list.find(b => String(b.matcher) === String(w.matcher));
        if (!group)
        {
            group = w.matcher === undefined ? { hooks: [] } : { matcher: w.matcher, hooks: [] };
            list.push(group);
        }
        // A side-effect hook runs async, off the call's path (settings.js asyncFor). Its env gate stays inside the hook:
        // the copy route's `[ ... ] ||` shell test fails under PowerShell, the shell form's runner where Git Bash is
        // absent (code.claude.com/docs/en/hooks, 'Exec form and shell form'), and every other plugin hook runs there.
        // The shell-guard dispatcher blocks the call when it fails to judge it (settings.js onFailureFor, audit HK07).
        group.hooks.push({ type: 'command', command: launch(`stack/hooks/${w.file}`, w.args), timeout: timeoutFor(w.file, w.event), ...(asyncFor(w.file, w.event) ? { async: true } : {}),
            ...(onFailureFor(w.file, w.event) ? { onFailure: onFailureFor(w.file, w.event) } : {}) });
    }
    return block;
}

function main(argv)
{
    const arg = (flag, fallback) =>
    {
        const i = argv.indexOf(flag);
        return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
    };
    const entriesFile = path.resolve(arg('--entries', ENTRIES_FILE));
    const options = {};
    if (argv.includes('--graph')) options.graph = readJson(path.resolve(arg('--graph')), 'stack-graph');
    if (argv.includes('--recs')) options.recs = readJson(path.resolve(arg('--recs')), 'recommendations');

    const place = placement(options);
    const entries = buildEntries({ ...options, placement: place });

    // The core's whole hooks block - its own two plus every stack wiring - which is what lint check
    // 48 compares with the live core. Printed, never written: --write-marketplace writes the core.
    if (argv.includes('--hooks-entry'))
    {
        console.log(JSON.stringify(entries.find((e) => e.name === CORE).hooks, null, 2));
        return 0;
    }

    const wanted = serialize(entries);
    if (argv.includes('--check'))
    {
        let have = null;
        try { have = fs.readFileSync(entriesFile, 'utf8'); } catch { /* absent counts as stale */ }
        if (have === wanted) { console.log(`plugin entries current: ${entries.length} entries`); return 0; }
        console.error(`plugin entries are STALE: ${path.relative(REPO, entriesFile)} - run \`npm run marketplace\``);
        return 1;
    }
    if (argv.includes('--write-marketplace'))
    {
        const file = path.resolve(arg('--marketplace-file', MARKETPLACE));
        const mkt = readJson(file, 'marketplace.json');
        const before = JSON.stringify(mkt, null, 2) + '\n';
        const listed = entries;
        const applied = applyToMarketplace(mkt, listed, { retired: loadManifest(REPO).retired.plugins });
        // No renames map (S11/S16): a rename strands an install; update migrates it instead.
        delete applied.renames;
        const after = JSON.stringify(applied, null, 2) + '\n';
        if (before === after) { console.log(`marketplace current: ${listed.length} entries`); return 0; }
        fs.writeFileSync(file, after);
        console.log(`marketplace written: ${listed.length} entries -> ${path.relative(REPO, file)}`);
        return 0;
    }
    if (argv.includes('--write'))
    {
        fs.writeFileSync(entriesFile, wanted);
        console.log(`plugin entries written: ${entries.length} entries -> ${path.relative(REPO, entriesFile)}`);
        return 0;
    }
    console.error('usage: build-marketplace.js --write | --write-marketplace | --check | --hooks-entry');
    return 1;
}

if (require.main === module)
{
    require('../stack/hooks/hook-prelude.js').blockingStdio();
    try { process.exit(main(process.argv.slice(2))); }
    catch (err) { console.error(String(err.message || err)); process.exit(1); }
}

module.exports = { buildEntries, coreEntry, serialize, applyToMarketplace, mcpEntry, parseHookWirings, hooksBlock, mergeHooks, FOLDED_ENTRIES, ENTRIES_FILE };
