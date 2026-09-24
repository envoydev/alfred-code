'use strict';
// THE SETTINGS.JSON WRITER - the env block, the hook wirings, the secret deny-list and the MCP
// pre-approval list, all of it idempotent because it runs on install AND update.
//
// The rule that governs everything here: A SETTINGS.JSON THAT DOES NOT PARSE IS LEFT UNTOUCHED.
// Falling back to `{}` would REPLACE the project's whole file - their permissions, their statusLine,
// their env - with just the stack's entries. A run that cannot read the file changes nothing and
// says so.
//
// The env pass has a fixed ORDER, and the order is load-bearing:
//   1. RENAMES first - carry the user's VALUE to the new key, then drop the old one. Seeding first
//      would write a default over a value the user had set under the old name.
//   2. RETIREMENTS - a key nothing reads any more is DROPPED, never carried, because a dead key in
//      the env block reads like a knob that still works. One that still means something outside
//      this stack goes only when its value is still exactly the seed it was given.
//   3. BAD SEEDS - a key whose shipped default turned out wrong is corrected only while it still
//      holds that default. A value the user set by hand is theirs.
//   4. SEEDS - absent-only, from meta/environment.json, so the catalog is the one list.
//   5. WRITTEN keys - the two that track a choice THIS run just made (the memory db path, the
//      sentry auth mode). A level change or an auth switch has to land, or the plugin launcher and
//      the headers helper keep reading the old one.
//
// Two keys are not catalog-simple. ALFRED_CODE_DOCS_VERSIONING is a DECISION with a four-home
// seeding rule, so the caller resolves it and hands the answer in. ALFRED_CODE_HOOKS_OFF is the
// one exception to absent-only: when a walk answered the hooks layer THIS run, that answer wins,
// because the user is looking at the question as it is asked.
const fs = require('node:fs');
const path = require('node:path');
const { stackSeat } = require('../derive-state.js');

// Every hook does under 30ms of work (measured: 22-25ms, almost all of it the node spawn), but a
// `command` hook with no timeout takes Claude Code's 600s default - so one stalled subprocess
// freezes the session for ten minutes. 10s is ~400x the measured cost and still fails fast.
const HOOK_TIMEOUT = 10;
// The ONE declared exception: check-turn-build.js runs a scoped tsc / dotnet build at Stop, which is
// seconds of real work, not a 25ms spawn - and it keeps its checks inside 50s of this. The plugin
// entry's generator reads the same table (build-marketplace.js). The frozen twins write 10 for it:
// on that route a longer check is killed and fails open.
const HOOK_TIMEOUTS = { 'check-turn-build.js': 60 };
const timeoutFor = (file) => HOOK_TIMEOUTS[file] || HOOK_TIMEOUT;

const HOOKS_DIR_MARK = '/.claude/hooks/';

function readSettings(file)
{
    if (!fs.existsSync(file)) return { data: {}, existed: false };
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (err) { const e = new Error(`settings.json is not valid JSON (${err.message}) - left untouched; fix it and re-run`); e.leaveAlone = true; throw e; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    { const e = new Error('settings.json top level is not an object - left untouched'); e.leaveAlone = true; throw e; }
    return { data: parsed, existed: true };
}

// A hook spec is `file::matcher::args`. A matcher starting with '@' wires a non-PreToolUse
// lifecycle event (`@Stop`), optionally with its own matcher key (`@SessionStart:compact`) - some
// events key on one, and without it the entry fires on every session start.
function hookCommand(file, args)
{
    const tail = args ? ` ${args}` : '';
    // The placeholder is QUOTED so a project path with a space survives the shell. `legacy` is the
    // unquoted text earlier installs wired, migrated in place so an update never leaves two entries.
    const quoted = `"$CLAUDE_PROJECT_DIR/.claude/hooks/${file}"${tail}`;
    const legacy = `$CLAUDE_PROJECT_DIR/.claude/hooks/${file}${tail}`;
    if (file === 'instrument-tool-usage.js')
    {
        // env-gated: the shell test costs nothing when off; node spawns only under the flag.
        const gate = '[ "$ALFRED_CODE_INSTRUMENT" != "1" ] || ';
        return { command: gate + quoted, legacy: gate + legacy };
    }
    return { command: quoted, legacy };
}

const fileOf = (command) => (command.includes(HOOKS_DIR_MARK) ? command.split(HOOKS_DIR_MARK).pop().split('"')[0] : '');

function wireHooks(data, specs, retiredHooks)
{
    let changed = false;
    const hooks = data.hooks || {};
    const every = () => Object.entries(hooks);

    // Migrate the unquoted command text earlier installs wired, on any event.
    for (const { command, legacy } of specs)
        for (const [, entries] of every())
            for (const entry of entries)
                for (const h of entry.hooks || [])
                    if (h.command === legacy) { h.command = command; changed = true; }

    // Backfill the timeout onto entries an earlier install wrote bare - they carry the 600s default.
    const ours = new Set(specs.flatMap((s) => [s.command, s.legacy]));
    for (const [, entries] of every())
        for (const entry of entries)
            for (const h of entry.hooks || [])
                if (ours.has(h.command) && h.timeout !== timeoutFor(fileOf(h.command))) { h.timeout = timeoutFor(fileOf(h.command)); changed = true; }

    // Prune OUR hook file from a PreToolUse matcher this version no longer wires. Keyed on the
    // SELECTED specs, so a hook the user de-selected keeps its entries - that is configure's job.
    const ourFiles = new Set(specs.map((s) => fileOf(s.command)).filter(Boolean));
    const pairs = new Set(specs.filter((s) => !s.matcher.startsWith('@')).map((s) => `${s.matcher}\u0000${s.command}`));
    const pre = hooks.PreToolUse || [];
    for (const entry of [...pre])
    {
        for (const h of [...(entry.hooks || [])])
        {
            const file = fileOf(h.command || '');
            if (file && ourFiles.has(file) && !pairs.has(`${entry.matcher || ''}\u0000${h.command}`))
            { entry.hooks.splice(entry.hooks.indexOf(h), 1); changed = true; }
        }
        if (!(entry.hooks || []).length) { pre.splice(pre.indexOf(entry), 1); changed = true; }
    }

    // Unwire a hook file this stack RETIRED, across EVERY event - a retired hook may have been wired
    // outside PreToolUse. Left wired, the entry keeps spawning a command whose file is gone.
    const retired = new Set(retiredHooks);
    for (const [event, entries] of every())
    {
        for (const entry of [...entries])
        {
            for (const h of [...(entry.hooks || [])])
            {
                const file = fileOf(h.command || '');
                if (file && retired.has(file)) { entry.hooks.splice(entry.hooks.indexOf(h), 1); changed = true; }
            }
            if (!(entry.hooks || []).length) { entries.splice(entries.indexOf(entry), 1); changed = true; }
        }
        if (!entries.length) { delete hooks[event]; changed = true; }
    }

    for (const { matcher, command } of specs)
    {
        if (matcher.startsWith('@'))
        {
            const [event, eventMatcher = ''] = matcher.slice(1).split(':');
            const list = (data.hooks ??= {})[event] ??= [];
            const already = list.some((e) => (e.matcher || '') === eventMatcher
                && (e.hooks || []).some((h) => h.command === command));
            if (already) continue;
            const entry = { hooks: [{ type: 'command', command, timeout: timeoutFor(fileOf(command)) }] };
            if (eventMatcher) entry.matcher = eventMatcher;
            list.push(entry);
            changed = true;
            continue;
        }
        const list = (data.hooks ??= {}).PreToolUse ??= [];
        // Keyed on (matcher, command): one hook file wired on two tools is TWO entries, and keying
        // on the command alone dropped the second (measured - no install carried the Bash matcher).
        const have = new Set(list.flatMap((e) => (e.hooks || []).map((h) => `${e.matcher || ''}\u0000${h.command}`)));
        if (have.has(`${matcher}\u0000${command}`)) continue;
        list.push({ matcher, hooks: [{ type: 'command', command, timeout: timeoutFor(fileOf(command)) }] });
        changed = true;
    }

    if (Object.keys(hooks).length && !data.hooks) data.hooks = hooks;
    return changed;
}

function applyEnv(env, { catalog, migrations, docsVersioning, memoryDb, sentryAuth, hooksOff, hooksAnswered, log })
{
    let changed = false;

    // 1. RENAMES - value first, then drop the old key.
    for (const [oldKey, newKey] of migrations.renames || [])
        if (oldKey in env)
        {
            if (!(newKey in env) && env[oldKey] !== '') env[newKey] = env[oldKey];
            delete env[oldKey];
            changed = true;
            log(`  settings.json env: ${oldKey} renamed to ${newKey}`);
        }

    // 2. RETIREMENTS - unconditional, or only while the value is still the stack's own old seed.
    for (const [key, onlyWhen] of migrations.retired || [])
        if (key in env && (onlyWhen === null || onlyWhen === undefined || env[key] === onlyWhen))
        {
            delete env[key];
            changed = true;
            log(`  settings.json env: ${key} removed (${onlyWhen == null ? 'retired - nothing reads it' : `the old stack seed ${onlyWhen} - the default applies`})`);
        }

    // 3. BAD SEEDS - corrected only while the key still holds the wrong default.
    for (const [key, badSeed, to] of migrations.reseed || [])
        if (env[key] === badSeed) { env[key] = to; changed = true; log(`  settings.json env: ${key} reset to ${to} (auto-detect)`); }

    // 4. SEEDS - absent-only, from the catalog, which is the one list.
    for (const row of catalog)
    {
        if (row.written) continue;                       // step 5 owns these
        if (row.key === 'ALFRED_CODE_DOCS_VERSIONING') continue;   // a decision, below
        if (row.key === 'ALFRED_CODE_HOOKS_OFF') continue;         // answered-wins, below
        if (row.key in env) continue;
        env[row.key] = row.default;
        changed = true;
        log(`  settings.json env: ${row.key} seeded (${row.default === '' ? 'empty' : row.default})`);
    }

    // The docs versioning DECISION. `--docs-versioning` writes over a value already there; without
    // it the caller's seed rule answers, and only when the key is absent.
    if (docsVersioning && docsVersioning.value)
    {
        const old = env.ALFRED_CODE_DOCS_VERSIONING;
        if (old !== docsVersioning.value) { env.ALFRED_CODE_DOCS_VERSIONING = docsVersioning.value; changed = true; }
        log(`  settings.json env: ALFRED_CODE_DOCS_VERSIONING ${old === undefined ? 'absent' : `'${old}'`} -> '${docsVersioning.value}'`
            + ` (--docs-versioning${old === docsVersioning.value ? ', unchanged' : ''})`);
    }
    else if (!('ALFRED_CODE_DOCS_VERSIONING' in env) && docsVersioning && docsVersioning.seed)
    {
        env.ALFRED_CODE_DOCS_VERSIONING = docsVersioning.seed;
        changed = true;
        log(`  settings.json env: ALFRED_CODE_DOCS_VERSIONING seeded (${docsVersioning.seed})`);
    }

    // 5. WRITTEN keys - they track a choice this run just made, so they overwrite.
    for (const [key, value, label] of [
        ['ALFRED_CODE_MEMORY_DB', memoryDb, memoryDb],
        ['ALFRED_CODE_SENTRY_AUTH', sentryAuth, sentryAuth]])
        if (value && env[key] !== value) { env[key] = value; changed = true; log(`  settings.json env: ${key} -> ${label}`); }

    // ALFRED_CODE_HOOKS_OFF: a walk that answered the hooks layer THIS run wins over the stored
    // value - the one exception to absent-only, because the user is looking at the question.
    const off = (hooksOff || []).join(',');
    if (hooksAnswered)
    {
        if (env.ALFRED_CODE_HOOKS_OFF !== off)
        { env.ALFRED_CODE_HOOKS_OFF = off; changed = true; log(`  settings.json env: ALFRED_CODE_HOOKS_OFF = ${off || '(empty - every hook runs)'}`); }
    }
    else if (!('ALFRED_CODE_HOOKS_OFF' in env))
    { env.ALFRED_CODE_HOOKS_OFF = ''; changed = true; log('  settings.json env: ALFRED_CODE_HOOKS_OFF seeded (empty - every hook runs)'); }

    return changed;
}

function writeSettings(opts)
{
    const {
        file, hookSpecs = [], retiredHooks = [], denySpecs = [], retiredDeny = [], retiredEntries = [], liveEntries = null,
        agentDeny = [], agentAllow = [],
        mcpNames = [], mcpOff = [], catalog = [], migrations = {},
        docsVersioning, memoryDb, sentryAuth, hooksOff, hooksAnswered = false,
        log = () => {}, note = () => {},
    } = opts;

    let data;
    try { ({ data } = readSettings(file)); }
    catch (err) { note(err.message); return { written: false, refused: true }; }

    const specs = hookSpecs.map((row) =>
    {
        const [fileName, matcher, args = ''] = String(row.file ?? row).split('::').concat(['', '']);
        return { matcher: row.matcher ?? matcher, ...hookCommand(row.file ?? fileName, row.args ?? args) };
    }).filter((s) => s.matcher);

    let changed = wireHooks(data, specs, retiredHooks);

    // permissions.deny: union-merge the secret-file Read blocks, preserving any the project set.
    const deny = ((data.permissions ??= {}).deny ??= []);
    for (const rule of denySpecs) if (!deny.includes(rule)) { deny.push(rule); changed = true; }
    // Entries this stack once wrote and no longer does: drop exactly those strings, so an update
    // clears what an older install seeded. A project's own entry is never touched.
    for (const rule of [...deny]) if (retiredDeny.includes(rule))
    { deny.splice(deny.indexOf(rule), 1); changed = true; log(`  settings.json: dropped retired deny entry ${rule}`); }
    // A seat denied through a per-stack entry retired in 1.3.0 is the user's off-state - a picked
    // rule's closure would copy the seat back without it - so it gains the core spelling, which every
    // later run reads as off; picking the seat again clears both (derive-state's allow list). The old
    // spelling goes only once that entry is uninstalled: Claude Code matches the exact home name, so
    // while the entry still loads (another scope, a refused uninstall, a listing this run could not
    // read) it is the spelling that keeps the seat off. `liveEntries` absent = cannot say = kept.
    const live = liveEntries || retiredEntries;
    for (const entry of [...deny])
    {
        const m = /^Agent\(([a-z0-9-]+):([A-Za-z0-9_-]+)\)$/.exec(entry);
        if (!m || !retiredEntries.includes(m[1])) continue;
        const core = `Agent(alfred-code:${m[2]})`;
        if (!deny.includes(core)) { deny.push(core); changed = true; log(`  settings.json: ${entry} also denied as ${core} (its entry retired)`); }
        if (live.includes(m[1])) continue;
        deny.splice(deny.indexOf(entry), 1);
        changed = true;
        log(`  settings.json: ${entry} dropped - its entry is uninstalled, ${core} keeps the seat off`);
    }

    // The agent off-list (Phase 8). Same array, two directions, and the ALLOW side runs last on
    // purpose: a seat named by both lists is a seat this run installed, and resolving toward the
    // seat WORKING is the safe direction - the other way silently disables what was just asked for.
    // Both lists are empty on a run that holds no selection, which leaves the deny array exactly as
    // it was; an --installed-only refresh passes the lists it READ BACK from this array, so it
    // writes the same seat state it found. A seat's OTHER stack spellings go either way: a release
    // that moved the seat to another entry left an entry addressing nothing.
    const dropSeat = (rule, keep) =>
    {
        const seat = stackSeat(rule);
        for (const entry of [...deny]) if (entry !== keep && seat && stackSeat(entry) === seat)
        { deny.splice(deny.indexOf(entry), 1); changed = true; log(entry === rule ? `  settings.json: agent allowed again ${entry}` : `  settings.json: agent entry dropped ${entry} (the seat's old spelling)`); }
    };
    for (const rule of agentDeny)
    {
        dropSeat(rule, rule);
        if (!deny.includes(rule)) { deny.push(rule); changed = true; log(`  settings.json: agent denied ${rule}`); }
    }
    for (const rule of agentAllow) dropSeat(rule, null);

    // enabledMcpjsonServers: pre-approve exactly the .mcp.json servers we register, so there is no
    // per-launch trust prompt - never blanket enableAllProjectMcpServers.
    const enabled = (data.enabledMcpjsonServers ??= []);
    for (const name of mcpNames) if (!enabled.includes(name)) { enabled.push(name); changed = true; }
    // ... and DROP the names this run unregistered. A server carried by a plugin is trusted through
    // the plugin, so a leftover entry names a `.mcp.json` server that no longer exists - dead config
    // that reads like a working knob.
    for (const name of mcpOff) if (enabled.includes(name))
    { enabled.splice(enabled.indexOf(name), 1); changed = true; log(`  settings.json: dropped enabledMcpjsonServers entry ${name} (no longer registered here)`); }

    if (applyEnv((data.env ??= {}), { catalog, migrations, docsVersioning, memoryDb, sentryAuth, hooksOff, hooksAnswered, log })) changed = true;

    if (!changed) return { written: false, refused: false };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    return { written: true, refused: false };
}

module.exports = { writeSettings, applyEnv, wireHooks, hookCommand, readSettings, HOOK_TIMEOUT, HOOK_TIMEOUTS, timeoutFor };
