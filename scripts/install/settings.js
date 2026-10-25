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
//   5. WRITTEN keys - the one that tracks a choice THIS run just made (the memory db path). A level
//      change has to land, or the plugin launcher keeps reading the old one.
//
// Two keys are not catalog-simple. ALFRED_CODE_DOCS_VERSIONING is a DECISION with a four-home
// seeding rule, so the caller resolves it and hands the answer in. ALFRED_CODE_HOOKS_OFF is the
// one exception to absent-only: when a walk answered the hooks layer THIS run, that answer wins,
// because the user is looking at the question as it is asked.
const fs = require('node:fs');
const path = require('node:path');
const { parseJson } = require('./json-file.js');
const { stackSeat } = require('../derive-state.js');
const { BRAND } = require('./brand.js');
const { valueHash } = require('./stamp.js');
const shellGuards = require('../../stack/hooks/shell-guards.js');
const fileGuards = require('../../stack/hooks/file-guards.js');
const historySession = require('../../stack/hooks/history-session.js');
const { tierKeyOf } = require('../../stack/hooks/fresh-session.js');
// Both dispatchers fold their guards' rows into one row each (R11 for the shell tools, 2.1.5 M3 for the file tools).
// The turn check's Stop row rides history-session's Stop process too (the user's ruling of 2026-10-16).
const foldDispatchers = (rows, opts) => historySession.wiringRows(fileGuards.wiringRows(shellGuards.wiringRows(rows, opts), opts));

// A hook's run is mostly its node spawn (audit 2026-10-14, cold p50 of 10 runs: a bare `node -e 0` 23.8ms, a single hook
// 26-52ms, the stop contract's Stop 181.8ms on a 19MB transcript, the shell dispatcher 58.7-209.9ms with a commit's git
// reads), but a `command` hook with no timeout takes Claude Code's 600s default - so one stalled subprocess
// freezes the session for ten minutes. 10s is ~50x the slowest single hook measured and still fails fast.
const HOOK_TIMEOUT = 10;
// The ONE declared exception: check-turn-build.js runs a scoped tsc / dotnet build at Stop, which is
// seconds of real work, not a 25ms spawn - and it keeps its checks inside 50s of this. Keyed by EVENT:
// the same file's PostToolUse half only appends a path, and a stall there must die at 10s like any
// other hook. The plugin entry's generator reads the same table (build-marketplace.js).
// The shell-guard dispatcher runs every shell guard in one process, so its budget is theirs summed:
// each guard keeps the 10s it had as its own hook.
// history-session's Stop carries the turn check (history-session.js wiringRows), so it takes the check's 60s.
const HOOK_TIMEOUTS = { 'check-turn-build.js': { Stop: 60 }, 'history-session.js': { Stop: 60 }, [`${shellGuards.SELF}.js`]: { PreToolUse: HOOK_TIMEOUT * shellGuards.GUARDS.length },
    [`${fileGuards.SELF}.js`]: { PreToolUse: HOOK_TIMEOUT * fileGuards.GUARDS.length } };
const timeoutFor = (file, event) => (HOOK_TIMEOUTS[file] || {})[event] || HOOK_TIMEOUT;
// A hook whose only work is a side effect runs with `async: true`: the call never waits on its node spawn, and an async
// hook can neither block nor decide ('Async hooks can't block or control Claude's behavior', code.claude.com/docs/en/hooks,
// 'Run hooks in the background'). Keyed by file and EVENT, `*` for every event: the tool-usage log (23.9ms on every tool
// call, audit 2026-10-08 row 28). The stop contract's PostToolUse / PostToolUseFailure probe rode here until the deep
// hooks review 2026-10-16 dropped it (27,380 runs for 250 rows nobody read). The plugin entry's generator reads the same
// table.
const ASYNC_HOOKS = { 'instrument-tool-usage.js': '*' };
const asyncFor = (file, event) => { const on = ASYNC_HOOKS[file]; return on === '*' || (Array.isArray(on) && on.includes(event)); };
// A hook that FAILS - cannot start, times out, exits other than 0 / 2, prints invalid output - lets the call through by
// default; `onFailure: "block"` blocks it instead, as an exit 2 would (code.claude.com/docs/en/hooks, 'Block the action
// when a hook fails', Claude Code 2.1.295+). Only the shell-guard dispatcher carries it (audit 2026-10-14 HK07, the user's
// ruling): its rm, force-push and secret guards are the ones a crashed or stalled dispatcher would silently pass, and the
// price - a broken install blocks every shell call until fixed - is paid on the shell route only. An older Claude Code drops the
// key: its hook entry is a non-strict zod object (2.1.100 and 2.1.294 bundles read 2026-10-14), so nothing is rejected.
const BLOCK_ON_FAILURE = { [`${shellGuards.SELF}.js`]: ['PreToolUse'] };
const onFailureFor = (file, event) => ((BLOCK_ON_FAILURE[file] || []).includes(event) ? 'block' : undefined);
const hookEntry = (command, timeout, file, event) => ({ type: 'command', command, timeout, ...(asyncFor(file, event) ? { async: true } : {}),
    ...(onFailureFor(file, event) ? { onFailure: onFailureFor(file, event) } : {}) });
// The `attribution` keys the seed writes when absent (code.claude.com settings reference).
const ATTRIBUTION_OFF = [['commit', ''], ['pr', ''], ['sessionUrl', false]];
// Every settings path the stack seeds, with its seed value - the ledger records them and a scope move takes them along.
const SEEDED_SETTINGS = [...ATTRIBUTION_OFF.map(([k, v]) => [`attribution.${k}`, v]), ['worktree.baseRef', 'head']];

// THE AUTO-COMPACT WINDOW PER MODEL (the user's rulings, 2026-10-14): where the project compacts instead of offering a
// fresh session (ALFRED_CODE_AUTO_COMPACT=1), each model `hooks/model-windows.json` lists compacts where the fresh-session
// gate would have offered a resume - its window tier's ALFRED_CODE_CONTEXT_WINDOW_FOR_* value (fresh-session.js tierKeyOf:
// 1M and up -> _1M, 300K and up -> _300K, 200K and up -> _200K, under 200K none), read from the env this file applies - instead of at the window Claude Code tunes for the model
// (settings reference: unset by default; measured near 390k on a 1M window, fresh-session.js). A tier switched off (`0`) seeds nothing;
// a trigger at or past its window is held at 90% of it (fresh-session.js ctxThreshold's clamp), and the value stays inside
// the 100,000-1,000,000 Claude Code accepts (settings-reference `modelSettings`). Returns { <model id>: <tokens> }.
function compactWindowSeeds(models, env = {}, catalog = [])
{
    // Only where the project compacts instead of offering a fresh session (ALFRED_CODE_AUTO_COMPACT, seeded `0`): with the
    // offers on, a window at the trigger would compact the session before the offer could reach anyone.
    const mode = env && Object.hasOwn(env, 'ALFRED_CODE_AUTO_COMPACT') ? env.ALFRED_CODE_AUTO_COMPACT : (catalog.find((r) => r.key === 'ALFRED_CODE_AUTO_COMPACT') || {}).default;
    if (String(mode || '').trim() !== '1') return {};
    const seedOf = (key) => parseInt((catalog.find((r) => r.key === key) || {}).default, 10);
    const tier = (key) =>
    {
        const n = parseInt(env && Object.hasOwn(env, key) ? env[key] : NaN, 10);
        return Number.isNaN(n) || n < 0 ? seedOf(key) : n;   // garbage reads as the seed, as fresh-session.js freshAt does
    };
    const out = {};
    for (const [id, n] of Object.entries(plain(models) ? models : {}))
    {
        const window = Number(n);
        // only an id the stamp's ledger reads back (stamp.js SETTINGS_PATH), or its window could never be taken back
        if (!(window >= 100000) || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(id)) continue;
        // the model's own capacity picks its tier; one under 200K has none and keeps Claude Code's own window - the
        // fresh-session fallback ALFRED_CODE_CONTEXT_WINDOW_DEFAULT is never an auto-compact window (the user's ruling, 2026-10-21)
        const key = tierKeyOf(window);
        if (!key) continue;
        let at = tier(key);
        if (!(at > 0)) continue;
        if (at >= window) at = Math.floor(window * 0.9);
        out[id] = Math.max(100000, Math.min(1000000, at));
    }
    return out;
}
const compactAt = (id) => `modelSettings.${id}.autoCompactWindow`;
// A seeded setting's dotted path (`attribution.commit`, `modelSettings.<id>.autoCompactWindow`): the object holding its last
// key, or null when a step on the way is missing or not an object.
function settingAt(data, at)
{
    const parts = at.split('.');
    let holder = data;
    for (const part of parts.slice(0, -1)) holder = holder && typeof holder === 'object' && !Array.isArray(holder)
        && holder[part] && typeof holder[part] === 'object' && !Array.isArray(holder[part]) ? holder[part] : null;
    return holder ? { holder, key: parts[parts.length - 1] } : null;
}
// Drops a seeded setting, then every object it leaves empty on the way up.
function dropSetting(data, at)
{
    const parts = at.split('.');
    const chain = [data];
    for (const part of parts.slice(0, -1)) chain.push(chain[chain.length - 1][part]);
    delete chain[chain.length - 1][parts[parts.length - 1]];
    for (let i = parts.length - 2; i >= 0 && !Object.keys(chain[i + 1]).length; i--) delete chain[i][parts[i]];
}

// Workspace layering (spec 2.3): the stack's rows in a settings ARRAY - `claudeMdExcludes`, and in later releases
// `permissions.additionalDirectories` and `disabledMcpjsonServers` - one ledger row per MEMBER, keyed by the member's
// own hash, so each is taken back alone and a member the user put there (no row) is never claimed or removed.
const MEMBER_PATH = /^(claudeMdExcludes|permissions\.additionalDirectories|disabledMcpjsonServers)\[([0-9a-f]{64})\]$/;
const memberRow = (arrayPath, value) => `${arrayPath}[${valueHash(value)}]`;
const isPlainObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// The array at a dotted path, the object holding it, and its last key; the holder is null when a step on the way
// is not an object.
function arrayAt(data, arrayPath, { make = false } = {})
{
    const parts = arrayPath.split('.');
    let holder = data;
    for (const part of parts.slice(0, -1))
    {
        if (!isPlainObj(holder[part])) { if (!make || Object.hasOwn(holder, part)) return { holder: null }; holder[part] = {}; }
        holder = holder[part];
    }
    const key = parts[parts.length - 1];
    return { holder, key, list: Array.isArray(holder[key]) ? holder[key] : null };
}

function dropEmptyArray(data, arrayPath)
{
    const parts = arrayPath.split('.');
    const at = arrayAt(data, arrayPath);
    if (!at.holder || !at.list || at.list.length) return;
    delete at.holder[at.key];
    if (parts.length === 2 && isPlainObj(data[parts[0]]) && !Object.keys(data[parts[0]]).length) delete data[parts[0]];
}

// Brings the stack's members of one array to `want`: a member it wants and does not see is added and ledgered; a prior
// row it no longer wants takes its member out (by hash); a row whose member is gone just leaves. The file is written
// only when something changed, in the shape every settings write here uses.
function syncMembers({ file, arrayPath, want, prior = {}, log = () => {}, note = () => {} })
{
    const mine = Object.fromEntries(Object.entries(prior || {}).filter(([row]) => { const m = MEMBER_PATH.exec(row); return m && m[1] === arrayPath; }));
    let data;
    let existed;
    try { ({ data, existed } = readSettings(file)); }
    catch (err) { note(`${err.message} - its ${arrayPath} rows are kept as recorded`); return { rows: mine, changed: false, created: false, refused: true }; }
    const at = arrayAt(data, arrayPath, { make: true });
    if (!at.holder) { note(`${path.basename(file)}: ${arrayPath} is not under an object - left as it is`); return { rows: mine, changed: false, created: false, refused: true }; }
    const list = at.list ? [...at.list] : [];
    const wantHash = new Map(want.map((v) => [valueHash(v), v]));
    const rows = {};
    let changed = false;
    for (const [row, hash] of Object.entries(mine))
    {
        if (wantHash.has(hash)) continue;
        const i = list.findIndex((m) => typeof m === 'string' && valueHash(m) === hash);
        if (i >= 0) { list.splice(i, 1); changed = true; }
    }
    for (const [hash, value] of wantHash)
    {
        const row = `${arrayPath}[${hash}]`;
        if (list.includes(value))
        {
            if (Object.hasOwn(mine, row)) rows[row] = hash;      // ours from an earlier run; a member with no row is the user's
            continue;
        }
        list.push(value);
        rows[row] = hash;
        changed = true;
    }
    if (!changed) return { rows, changed: false, created: false };
    at.holder[at.key] = list;
    dropEmptyArray(data, arrayPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    log(`  ${path.basename(file)}: ${arrayPath} - ${Object.keys(rows).length} of the stack's members`);
    return { rows, changed: true, created: !existed };
}

// The member rows a run's ledger keeps: the workspace step's own rows for settings.local.json when it ran, and
// otherwise each prior row whose member is still in its file - every one, in a file that cannot be read.
function carryMemberRows({ claudeDir, priorSettings = {}, workspaceRows })
{
    const out = {};
    for (const [name, keys] of Object.entries(priorSettings || {}))
    {
        if (name === 'settings.local.json' && workspaceRows) continue;
        const members = Object.entries(keys || {}).filter(([row]) => MEMBER_PATH.test(row));
        if (!members.length) continue;
        let data;
        try { ({ data } = readSettings(path.join(claudeDir, name))); }
        catch { out[name] = Object.fromEntries(members); continue; }
        const kept = members.filter(([row, hash]) =>
        {
            const at = arrayAt(data, MEMBER_PATH.exec(row)[1]);
            return Boolean(at.list) && at.list.some((m) => typeof m === 'string' && valueHash(m) === hash);
        });
        if (kept.length) out[name] = Object.fromEntries(kept);
    }
    if (workspaceRows && Object.keys(workspaceRows).length) out['settings.local.json'] = { ...workspaceRows };
    return out;
}

const HOOKS_DIR_MARK = '/.claude/hooks/';

function readSettings(file)
{
    if (!fs.existsSync(file)) return { data: {}, existed: false };
    // Re-verify 3 S9: a file that cannot be read is named by its read error, never as bad JSON.
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (err) { const e = new Error(`${path.basename(file)} could not be read (${err.code || err.message}) - left untouched; fix it and re-run`); e.leaveAlone = true; throw e; }
    // An empty file holds nothing to lose: no settings yet, as memory.js writeSwitchOff reads it (release matrix 2026-10-20).
    if (!raw.trim()) return { data: {}, existed: true };
    let parsed;
    try { parsed = parseJson(raw); }
    catch (err) { const e = new Error(`${path.basename(file)} is not valid JSON (${err.message}) - left untouched; fix it and re-run`); e.leaveAlone = true; throw e; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    { const e = new Error(`${path.basename(file)} top level is not an object - left untouched`); e.leaveAlone = true; throw e; }
    // A hooks block Claude Code cannot read is the user's to fix, like bad JSON: the writer would throw half-way through it
    // (a null entry, an event that is no list - the 2026-10-16 matrix), or wire nothing beside a list and say nothing.
    const where = hooksShapeError(parsed.hooks);
    if (where)
    { const e = new Error(`${path.basename(file)} hooks block is not the shape Claude Code reads (${where}) - left untouched; fix it and re-run`); e.leaveAlone = true; throw e; }
    return { data: parsed, existed: true };
}

// Where a settings file's `hooks` value leaves the event -> [{ matcher?, hooks: [{ ... }] }] shape, or '' when it keeps it.
// An absent or null block is no block; a group without its `hooks` key is read as an empty one.
function hooksShapeError(hooks)
{
    if (hooks === undefined || hooks === null) return '';
    const plainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
    if (!plainObject(hooks)) return 'hooks is not an object';
    for (const [event, groups] of Object.entries(hooks))
    {
        if (!Array.isArray(groups)) return `hooks.${event} is not a list`;
        for (const [i, group] of groups.entries())
        {
            if (!plainObject(group)) return `hooks.${event}[${i}] is not an object`;
            if (group.hooks === undefined) continue;
            if (!Array.isArray(group.hooks)) return `hooks.${event}[${i}].hooks is not a list`;
            const j = group.hooks.findIndex((h) => !plainObject(h));
            if (j >= 0) return `hooks.${event}[${i}].hooks[${j}] is not an object`;
        }
    }
    return '';
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
    for (const [event, entries] of every())
        for (const entry of entries)
            for (const h of entry.hooks || [])
            {
                if (ours.has(h.command) && h.timeout !== timeoutFor(fileOf(h.command), event)) { h.timeout = timeoutFor(fileOf(h.command), event); changed = true; }
                // ...and the async flag onto a side-effect hook an earlier install wired blocking.
                if (ours.has(h.command) && asyncFor(fileOf(h.command), event) && h.async !== true) { h.async = true; changed = true; }
                // ...and the block-on-failure flag onto the shell-guard dispatcher an earlier install wired without it.
                if (ours.has(h.command) && onFailureFor(fileOf(h.command), event) && h.onFailure !== onFailureFor(fileOf(h.command), event)) { h.onFailure = onFailureFor(fileOf(h.command), event); changed = true; }
            }

    // Prune OUR hook file from a PreToolUse matcher this version no longer wires. Keyed on the
    // SELECTED specs, so a hook the user de-selected keeps its entries - that is configure's job.
    const ourFiles = new Set(specs.map((s) => fileOf(s.command)).filter(Boolean));
    // A guard a dispatcher runs is ours too: its own shell- or file-tool row, which an older install wired,
    // goes now that the dispatcher judges for it.
    for (const s of specs)
        for (const [self, all] of [[shellGuards.SELF, shellGuards.GUARDS], [fileGuards.SELF, fileGuards.NAMES]])
            if (fileOf(s.command) === `${self}.js`)
            {
                const named = s.command.split('"').pop().trim().split(/\s+/).filter(Boolean);
                for (const g of named.length ? named : all) ourFiles.add(`${g}.js`);
            }
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
            const entry = { hooks: [hookEntry(command, timeoutFor(fileOf(command), event), fileOf(command), event)] };
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
        list.push({ matcher, hooks: [hookEntry(command, timeoutFor(fileOf(command), 'PreToolUse'), fileOf(command), 'PreToolUse')] });
        changed = true;
    }

    if (Object.keys(hooks).length && !data.hooks) data.hooks = hooks;
    return changed;
}

// Steps 1 and 1b of the env pass, in place: the value moves to the new key, then the old key goes.
function renameEnv(env, migrations, log, label = 'settings.json')
{
    let changed = false;
    // The log names what happened to the old key: its value moved, or it went because the new key
    // already holds one (which wins) or it held nothing to move.
    const move = (oldKey, newKey) =>
    {
        let what = `renamed to ${newKey}`;
        if (newKey in env) what = `dropped - ${newKey} is already set and wins`;
        else if (env[oldKey] === '') what = 'dropped - it was empty';
        else env[newKey] = env[oldKey];
        delete env[oldKey];
        changed = true;
        log(`  ${label} env: ${oldKey} ${what}`);
    };
    // 1. RENAMES - value first, then drop the old key.
    for (const [oldKey, newKey] of migrations.renames || []) if (oldKey in env) move(oldKey, newKey);
    return changed;
}

// The env keys the stack owns - what R99 reads from and writes to settings.local.json.
const isStackKey = (key) => key.startsWith('ALFRED_CODE_');

// C8 (R100, R101): keys that hold a value of THIS machine - the retired memory server's database path, which no run
// writes since 2.10.1 (an update's env pass drops the one an earlier release wrote, meta/migrations.json's
// memory-db-retired). At every scope they live in settings.local.json, never in the committed settings.json, so a scope
// move leaves one where it is.
const PERSONAL_KEYS = ['ALFRED_CODE_MEMORY_DB'];

// Steps 2 and 3 of the env pass, in place, over the keys `only` admits. `stackWrote(label, key, value)` answers from the
// install ledger whether the stack wrote that value there; with none given (no ledger) the value match alone decides.
function retireAndReseed(env, migrations, log, label, only = () => true, stackWrote = null)
{
    let changed = false;
    // 2. RETIREMENTS - unconditional, or only while the value is still the stack's own old seed.
    for (const [key, onlyWhen] of migrations.retired || [])
        if (only(key) && key in env && (onlyWhen === null || onlyWhen === undefined || env[key] === onlyWhen))
        {
            delete env[key];
            changed = true;
            log(`  ${label} env: ${key} removed (${onlyWhen == null ? 'retired - nothing reads it' : `the old stack seed ${onlyWhen} - the default applies`})`);
        }

    // 3. BAD SEEDS - corrected only while the key still holds the wrong default AND the stack wrote it there: a value the user
    // typed is theirs even when it equals an old seed (2026-10-16 matrix: a hand-set ALFRED_CODE_CONTEXT_WINDOW_FOR_200K of
    // 150000 was reset to 180000 on every update).
    for (const [key, badSeed, to] of migrations.reseed || [])
        if (only(key) && env[key] === badSeed && (!stackWrote || stackWrote(label, key, badSeed))) { env[key] = to; changed = true; log(`  ${label} env: ${key} reset to ${to} (the old stack seed ${badSeed})`); }
    return changed;
}

// Step 2b, before the reseed sees an old seed: a key that follows others to off (`off_settings_env` - the DEFAULT, once the
// three window tiers are all `0`, item 12 of 2026-10-21) takes their off value while it is a stack seed the stack wrote, or
// absent where `absentOk` says nothing else holds it. A value the user typed stays.
function offWithTiers(env, migrations, log, label, { only = () => true, stackWrote = null, absentOk = () => false } = {})
{
    let changed = false;
    for (const [key, withKeys, seeds, to] of migrations.offWith || [])
    {
        if (!only(key) || !withKeys.every((k) => env[k] === to) || env[key] === to) continue;
        const was = env[key];
        if (was === undefined ? !absentOk(key) : !(seeds.includes(was) && (!stackWrote || stackWrote(label, key, was)))) continue;
        env[key] = to;
        changed = true;
        log(`  ${label} env: ${key} set to ${to} (${was === undefined ? 'absent' : `the stack seed ${was}`}; the three tiers are ${to}, so the offers stay off)`);
    }
    return changed;
}

// Step 1b, after the renames: a retired on/off key folds into a csv (`fold_settings_env` - the env audit of 2026-10-21 moved
// seven switches into ALFRED_CODE_HOOKS_OFF as `<hook>:<part>` or a hook name). At its off value it becomes the entry, at
// any other it was the seed's 'on' and just goes. The csv is made where it is missing, from `baseCsv` (the value beneath an
// overlay) when given; `alsoInto` is an overlay csv that shadows this file's, which must carry the entry too.
const csvEntryKey = (entry) => { const at = entry.indexOf(':'); const hook = (at > 0 ? entry.slice(0, at) : entry).trim().toLowerCase().replace(/\.js$/, ''); return at > 0 ? `${hook}:${entry.slice(at + 1).trim().toLowerCase()}` : hook; };
function addCsvEntry(csv, entry)
{
    const items = String(csv || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (items.some((x) => csvEntryKey(x) === csvEntryKey(entry))) return csv;
    return [...items, entry].join(',');
}
function foldEnv(env, migrations, log, label, { baseCsv = null, alsoInto = null, alsoLabel = '' } = {})
{
    let changed = false;
    for (const [key, into, entry, offValue] of migrations.folds || [])
    {
        if (!Object.hasOwn(env, key)) continue;
        const was = String(env[key]).trim();
        delete env[key];
        changed = true;
        if (was !== offValue)
        {
            log(`  ${label} env: ${key} removed (on - ${entry.includes(':') ? 'the part' : 'the hook'} runs unless ${into} names ${entry})`);
            continue;
        }
        const now = addCsvEntry(Object.hasOwn(env, into) ? env[into] : (baseCsv || ''), entry);
        if (now !== env[into]) env[into] = now;
        log(`  ${label} env: ${key} folded into ${into} as ${entry}`);
        if (alsoInto && Object.hasOwn(alsoInto, into))
        {
            const there = addCsvEntry(alsoInto[into], entry);
            if (there !== alsoInto[into]) { alsoInto[into] = there; log(`  ${alsoLabel} env: ${into} carries ${entry} too (it shadows ${label}'s)`); }
        }
    }
    return changed;
}

// `inherited` (N6): the env of a file Claude Code lays THIS file over - settings.json beneath a
// local-scope run's settings.local.json. A key it holds, under any spelling the renames carry, counts as
// present for every absent-only seed below: a default here would hide the user's value there. Renames,
// retirements and decisions still act on this file alone.
// `overlay` (R99, Task 18b fix round 2): the env of the file Claude Code lays OVER this one - a project
// or user run's settings.local.json. A stack key it holds is the value that applies, so the migrations
// run over its stack keys too, a key it holds counts as present for every seed (a copy here would be
// shadowed), and every decision below lands in it, where it takes effect - never in this file, where
// it would look applied and change nothing. The caller writes the overlay back to its own file.
// C6 (R101 N7): the absent-only SEEDS are the exception - they fill THIS file against itself (and the
// file beneath), because it is what every teammate reads; the runner's own value still wins over it.
// C8: a PERSONAL_KEYS value always goes to the overlay when there is one, and leaves this file.
// `sharedKeys` (C5): a decision that shapes committed state lands in THIS file even when the overlay
// holds the key - the hooks copy route's HOOKS_OFF complement, which is the committed wiring's mirror.
// `workspaceEnv` (a joined child, workspace.js childEnv): `seeds` replaces a catalog default with the workspace root's
// value, and a `force` key THIS file holds at another value is rewritten to it - a key only the file beneath holds is
// never in either, and a decision this run took (a flag, the hooks walk's answer) wins over both.
function applyEnv(env, { catalog, migrations, docsVersioning, docsPath, dataPath, autoCompact = null, memory = null, hooksOff, hooksAnswered, renamedHooks = {}, inherited, overlay, overlayUnreadable = false, sharedKeys = [], log, label = 'settings.json', overlayLabel = 'settings.local.json', stackWrote = null, workspaceEnv = null })
{
    let changed = renameEnv(env, migrations, log, label);
    const beneath = inherited && typeof inherited === 'object' && !Array.isArray(inherited) ? { ...inherited } : {};
    renameEnv(beneath, migrations, () => {});
    const held = overlay && typeof overlay === 'object' && !Array.isArray(overlay) ? overlay : null;
    if (held)
    {
        renameEnv(held, migrations, log, overlayLabel);
        foldEnv(held, migrations, log, overlayLabel, { baseCsv: env.ALFRED_CODE_HOOKS_OFF ?? beneath.ALFRED_CODE_HOOKS_OFF ?? '' });
        offWithTiers(held, migrations, log, overlayLabel, { only: isStackKey, stackWrote });
        retireAndReseed(held, migrations, log, overlayLabel, isStackKey, stackWrote);
    }
    const wsSeeds = workspaceEnv && workspaceEnv.seeds && typeof workspaceEnv.seeds === 'object' ? workspaceEnv.seeds : {};
    const wsForce = new Set(workspaceEnv && Array.isArray(workspaceEnv.force) ? workspaceEnv.force : []);
    const fromRoot = (key) => Object.hasOwn(wsSeeds, key);
    // A forced key this file holds at another value takes the workspace root's.
    const follow = (key) =>
    {
        if (!wsForce.has(key) || !fromRoot(key) || !Object.hasOwn(env, key) || env[key] === wsSeeds[key]) return false;
        log(`  ${label} env: ${key} '${env[key]}' -> '${wsSeeds[key]}' (the workspace root's value)`);
        env[key] = wsSeeds[key];
        return true;
    };
    const heldHere = (key) => Boolean(held) && isStackKey(key) && key in held && !sharedKeys.includes(key);
    const present = (key) => key in env || key in beneath;
    // Where a decision about `key` lands: the overlay when it holds the key, else this file.
    const at = (key) => (heldHere(key) ? { into: held, lab: overlayLabel, mine: false } : { into: env, lab: label, mine: true });

    if (foldEnv(env, migrations, log, label, { alsoInto: held, alsoLabel: overlayLabel })) changed = true;
    if (offWithTiers(env, migrations, log, label, { stackWrote, absentOk: (key) => !present(key) && !(held && key in held) })) changed = true;
    if (retireAndReseed(env, migrations, log, label, undefined, stackWrote)) changed = true;

    // 3b. THE DOCS ROOT (alfred-code.js docsRootStep): ALFRED_CODE_DOCS_PATH is retired in 2.8.0 - the docs root is
    // <data root>/docs. A key the docs step cleared (the docs moved, or nothing was left to move) goes from this file and
    // the overlay; a clash keeps it (`keep`, which the ledger pass honours too).
    if (docsPath && docsPath.remove)
        for (const [into, lab, mine] of [[env, label, true], ...(held ? [[held, overlayLabel, false]] : [])])
        {
            if (!Object.hasOwn(into, 'ALFRED_CODE_DOCS_PATH')) continue;
            log(`  ${lab} env: ALFRED_CODE_DOCS_PATH '${into.ALFRED_CODE_DOCS_PATH}' removed (${docsPath.why})`);
            delete into.ALFRED_CODE_DOCS_PATH;
            if (mine) changed = true;
        }

    // 3c. THE DATA ROOT DECISION (alfred-code.js dataRootStep) - a root this run moved the data to, or a
    // fresh install's chosen one; the absent-only seed below writes the default otherwise.
    if (dataPath && dataPath.value)
    {
        const { into, lab, mine } = at('ALFRED_CODE_DATA_PATH');
        const old = into.ALFRED_CODE_DATA_PATH;
        if (old !== dataPath.value)
        {
            into.ALFRED_CODE_DATA_PATH = dataPath.value;
            if (mine) changed = true;
            log(`  ${lab} env: ALFRED_CODE_DATA_PATH ${old === undefined ? 'absent' : `'${old}'`} -> '${dataPath.value}' (${dataPath.why})`);
        }
    }

    // 3d. COMPACT INSTEAD OF A FRESH SESSION (`--auto-compact on|off`, setup's screen-B answer), written over a value
    // already there like the two roots above; without the flag the absent-only seed below writes `0`. The window pass
    // in writeSettings reads the value this leaves.
    if (autoCompact && autoCompact.value)
    {
        const { into, lab, mine } = at('ALFRED_CODE_AUTO_COMPACT');
        const old = into.ALFRED_CODE_AUTO_COMPACT;
        if (old !== autoCompact.value) { into.ALFRED_CODE_AUTO_COMPACT = autoCompact.value; if (mine) changed = true; }
        log(`  ${lab} env: ALFRED_CODE_AUTO_COMPACT ${old === undefined ? 'absent' : `'${old}'`} -> '${autoCompact.value}'`
            + ` (--auto-compact${old === autoCompact.value ? ', unchanged' : ''})`);
    }

    // 3e. WHICH MEMORY (`--memory default|custom`, init's and configure's answer), written over a value already there like
    // 3d; without the flag the absent-only seed below writes `default`. writeSettings' memory pass reads the value this leaves.
    if (memory && memory.value)
    {
        const { into, lab, mine } = at('ALFRED_CODE_MEMORY');
        const old = into.ALFRED_CODE_MEMORY;
        if (old !== memory.value) { into.ALFRED_CODE_MEMORY = memory.value; if (mine) changed = true; }
        log(`  ${lab} env: ALFRED_CODE_MEMORY ${old === undefined ? 'absent' : `'${old}'`} -> '${memory.value}'`
            + ` (--memory${old === memory.value ? ', unchanged' : ''})`);
    }

    // 4. SEEDS - absent-only, from the catalog, which is the one list.
    for (const row of catalog)
    {
        if (row.written) continue;                       // step 5 owns these
        if (row.seed === false) continue;                // never written: the launch env or a hand-set value only
        if (row.key === 'ALFRED_CODE_AUTO_COMPACT' && autoCompact && autoCompact.value && !heldHere(row.key)) continue;   // decided above
        if (row.key === 'ALFRED_CODE_MEMORY' && memory && memory.value && !heldHere(row.key)) continue;                  // decided above
        if (row.key === 'ALFRED_CODE_DOCS_VERSIONING') continue;   // a decision, below
        if (row.key === 'ALFRED_CODE_HOOKS_OFF') continue;         // answered-wins, below
        if (present(row.key)) { if (follow(row.key)) changed = true; continue; }
        const seed = fromRoot(row.key) ? wsSeeds[row.key] : row.default;
        env[row.key] = seed;
        changed = true;
        log(`  ${label} env: ${row.key} seeded ${fromRoot(row.key) ? 'from the workspace root ' : ''}(${seed === '' ? 'empty' : seed})`);
    }

    // The docs versioning DECISION. `--docs-versioning` writes over a value already there; without
    // it the caller's seed rule answers, and only when the key is absent.
    if (docsVersioning && docsVersioning.value)
    {
        const { into, lab, mine } = at('ALFRED_CODE_DOCS_VERSIONING');
        const old = into.ALFRED_CODE_DOCS_VERSIONING;
        if (old !== docsVersioning.value) { into.ALFRED_CODE_DOCS_VERSIONING = docsVersioning.value; if (mine) changed = true; }
        log(`  ${lab} env: ALFRED_CODE_DOCS_VERSIONING ${old === undefined ? 'absent' : `'${old}'`} -> '${docsVersioning.value}'`
            + ` (${docsVersioning.why || '--docs-versioning'}${old === docsVersioning.value ? ', unchanged' : ''})`);
    }
    else if (!present('ALFRED_CODE_DOCS_VERSIONING') && docsVersioning && docsVersioning.seed)
    {
        env.ALFRED_CODE_DOCS_VERSIONING = docsVersioning.seed;
        changed = true;
        log(`  ${label} env: ALFRED_CODE_DOCS_VERSIONING seeded (${docsVersioning.seed})`);
    }

    // ALFRED_CODE_HOOKS_OFF: a walk that answered the hooks layer THIS run wins over the stored
    // value - the one exception to absent-only, because the user is looking at the question. The walk answers HOOKS, so a
    // stored `<hook>:<part>` entry (a part switched off, hook-prelude.js partOff) is no part of its answer and is kept.
    if (hooksAnswered)
    {
        const { into, lab, mine } = at('ALFRED_CODE_HOOKS_OFF');
        const parts = String(into.ALFRED_CODE_HOOKS_OFF || '').split(',').map((x) => x.trim()).filter((x) => x.indexOf(':') > 0);
        const off = parts.reduce(addCsvEntry, (hooksOff || []).join(','));
        if (into.ALFRED_CODE_HOOKS_OFF !== off)
        { into.ALFRED_CODE_HOOKS_OFF = off; if (mine) changed = true; log(`  ${lab} env: ALFRED_CODE_HOOKS_OFF = ${off || '(empty - every hook runs)'}`); }
    }
    else
    {
        // A hook a release renamed (manifest `renamed.hooks`) stays off under its new name: the stored list is re-spelled
        // in each file that holds it, or the prelude no longer matches it and the hook the user switched off runs again.
        for (const [into, lab, mine] of [[env, label, true], ...(held ? [[held, overlayLabel, false]] : [])])
        {
            const was = into.ALFRED_CODE_HOOKS_OFF;
            if (typeof was !== 'string' || !was.trim()) continue;
            const now = was.split(',').map((h) => { const bare = h.trim().replace(/\.js$/i, '').toLowerCase(); return Object.hasOwn(renamedHooks, bare) ? renamedHooks[bare] : h; }).join(',');
            if (now !== was) { into.ALFRED_CODE_HOOKS_OFF = now; if (mine) changed = true; log(`  ${lab} env: ALFRED_CODE_HOOKS_OFF = ${now} (a renamed hook re-spelled)`); }
        }
        if (follow('ALFRED_CODE_HOOKS_OFF')) changed = true;
        else if (!present('ALFRED_CODE_HOOKS_OFF'))
        {
            const off = fromRoot('ALFRED_CODE_HOOKS_OFF') ? wsSeeds.ALFRED_CODE_HOOKS_OFF : '';
            env.ALFRED_CODE_HOOKS_OFF = off;
            changed = true;
            log(`  ${label} env: ALFRED_CODE_HOOKS_OFF seeded ${fromRoot('ALFRED_CODE_HOOKS_OFF') ? 'from the workspace root ' : ''}(${off || 'empty - every hook runs'})`);
        }
    }

    return changed;
}

// A skill a release RENAMED keeps the user's `skillOverrides` value under its new name - a value
// already set under the new name wins, and the old key goes either way.
function rekeyOverrides(data, renamed, log, label)
{
    const o = data && data.skillOverrides;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    let changed = false;
    for (const [from, to] of Object.entries((renamed && renamed.skills) || {}))
    {
        if (!Object.hasOwn(o, from)) continue;
        if (!Object.hasOwn(o, to)) o[to] = o[from];
        delete o[from];
        changed = true;
        log(`  ${label}: skillOverrides ${from} re-keyed ${to} (the skill was renamed)`);
    }
    return changed;
}

// --- R10 THE LEDGER ------------------------------------------------------------------------------
// What this run MANAGES in the settings files, recorded in the stamp (`managed-env`, `managed-deny`,
// `managed-hooks`): a key, entry or wiring the run wrote now, or one the last run recorded and nobody
// changed since. What the last run recorded and this release no longer writes goes; a value changed
// since it was written is the user's - kept, said once, and out of the ledger from then on. With no
// ledger to read (a stamp from before R10) the stack's own shipped values are the evidence: a stack
// key at a value the stack shipped, a secret or seat deny, a wiring exactly as the release writes it.
const plain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const wiringId = (event, matcher, command) => valueHash(`${event}\u0000${matcher}\u0000${command}`);

// Every command wiring in a hooks block, with its identity: event, matcher and command, never the timeout.
function wiringsOf(hooks)
{
    const out = [];
    for (const [event, entries] of Object.entries(plain(hooks) ? hooks : {}))
        for (const entry of Array.isArray(entries) ? entries : [])
            for (const h of entry && Array.isArray(entry.hooks) ? entry.hooks : [])
                if (h && typeof h.command === 'string')
                    out.push({ event, hook: fileOf(h.command), id: wiringId(event, (entry && entry.matcher) || '', h.command) });
    return out;
}

// The wirings a RELEASE writes, from its catalog specs (`file::matcher::args`) - the identity set an
// earlier run's wiring is checked against.
function releaseWirings(specs)
{
    return new Set((specs || []).map((row) =>
    {
        const [file, matcher = '', args = ''] = String(row.file ?? row).split('::');
        const m = row.matcher ?? matcher;
        const { command } = hookCommand(row.file ?? file, row.args ?? args);
        if (!m.startsWith('@')) return wiringId('PreToolUse', m, command);
        const [event, eventMatcher = ''] = m.slice(1).split(':');
        return wiringId(event, eventMatcher, command);
    }));
}

// Remove the wirings whose identity is in `ids`, emptied entries and events with them.
function unwireIds(data, ids)
{
    const gone = [];
    if (!ids.size || !plain(data.hooks)) return gone;
    for (const [event, entries] of Object.entries(data.hooks))
    {
        if (!Array.isArray(entries)) continue;
        const had = gone.length;
        for (const entry of [...entries])
        {
            const list = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
            const was = list.length;
            for (const h of [...list])
                if (h && typeof h.command === 'string' && fileOf(h.command) && ids.has(wiringId(event, entry.matcher || '', h.command)))   // a copied hook only
                { list.splice(list.indexOf(h), 1); gone.push({ event, hook: fileOf(h.command) || h.command }); }
            if (was && !list.length) entries.splice(entries.indexOf(entry), 1);
        }
        if (gone.length > had && !entries.length) delete data.hooks[event];
    }
    if (gone.length && !Object.keys(data.hooks).length) delete data.hooks;
    return gone;
}

// The key a rename carried THIS key's value from this run, or null - ownership travels with the value.
function renamedFrom(key, value, before, migrations)
{
    if (key in before) return null;
    const olds = (migrations.renames || []).filter(([, n]) => n === key).map(([o]) => o);
    return olds.find((old) => old in before && before[old] === value) || null;
}

// The env half, for one file: the drop, then the managed map. `release` is every key the catalog ships;
// `seedsOf(key)` what the stack ever seeded it with (the fallback's evidence); `written` the keys this
// run overwrites by contract, with the value it wrote.
function ledgerEnv({ name, env, before, prior, release, seedsOf, written, kept = [], migrations, log })
{
    let changed = false;
    if (prior)
        for (const [key, hash] of Object.entries(prior))
        {
            // a stack key only: the stamp is project text; `kept` - a retired key this run decided to leave (a docs clash)
            if (!isStackKey(key) || !Object.hasOwn(env, key) || release.has(key) || kept.includes(key)) continue;
            if (valueHash(env[key]) === hash)
            { delete env[key]; changed = true; log(`  ${name} env: ${key} removed - the stack wrote it and this release no longer does`); }
            else log(`  ${name} env: ${key} kept - changed since the stack wrote it, so it is yours (${String(env[key]).length} chars)`);
        }
    const managed = {};
    for (const key of Object.keys(env).filter(isStackKey))
    {
        // A retired key the docs step kept (a clash, a hand-set root) carries its ledger row as recorded: no claim, no
        // ownership line - the docs step said why it stays, and the row still tells the next run whether the stack wrote it.
        if (kept.includes(key)) { if (prior && Object.hasOwn(prior, key)) managed[key] = prior[key]; continue; }
        const v = env[key];
        const hash = valueHash(v);
        const from = renamedFrom(key, v, before, migrations);
        if (Object.hasOwn(written, key) && written[key] === v) { managed[key] = hash; continue; }
        if (!from && (!Object.hasOwn(before, key) || before[key] !== v)) { managed[key] = hash; continue; }
        const was = from || key;
        if (!prior) { if (seedsOf(key).includes(String(v))) managed[key] = hash; continue; }
        if (prior[was] === hash) managed[key] = hash;
        else if (Object.hasOwn(prior, was)) log(`  ${name} env: ${key} changed since the stack wrote it - yours from here on, kept (${String(v).length} chars)`);
    }
    return { managed, changed };
}

function writeSettings(opts)
{
    const {
        file, hookSpecs = [], retiredHooks = [], denySpecs = [], retiredDeny = [],
        agentDeny = [], agentAllow = [],
        mcpOff = [], dropEmptyApprovals = false, catalog = [], migrations = {},
        docsVersioning, docsPath = null, dataPath = null, autoCompact = null, memory = null, hooksOff, hooksAnswered = false, inheritedEnv = null, localFile = null, renamed = null,
        inheritedOverrides = null, sharedFile = null, sharedKeys = [], attribution = null, worktreeBase = null, compactWindows = null, ledger = {}, workspaceEnv = null,
        log = () => {}, note = () => {},
    } = opts;
    // R10: the last run's ledger (null - no stamp, or one from before it: the fallback) and the hook
    // wirings the RELEASE writes, whatever this run's selection wires.
    const prior = ledger.prior || null;
    // A seat a release RENAMED (meta/stack-manifest.json `renamed`) loads under its new name only.
    const seatNow = (seat) => ((renamed && renamed.agents) || {})[seat] || seat;

    // M6: every log line names the file this run writes - settings.local.json at local scope.
    const label = path.basename(file);
    let data;
    try { ({ data } = readSettings(file)); }
    catch (err) { note(err.message); return { written: false, refused: true }; }
    const envBefore = plain(data.env) ? { ...data.env } : {};
    const denyBefore = plain(data.permissions) && Array.isArray(data.permissions.deny) ? [...data.permissions.deny] : [];
    const wiredBefore = new Set(wiringsOf(data.hooks).map((w) => w.id));

    // The shell and file guards' rows fold into one dispatcher row each, naming a strict subset in its args.
    const wired = foldDispatchers(hookSpecs, { listGuards: true });
    const specs = wired.map((row) =>
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
    { deny.splice(deny.indexOf(rule), 1); changed = true; log(`  ${label}: dropped retired deny entry ${rule}`); }
    // I1 (fix round 1): the pass below also runs over settings.local.json's deny list - a seat the
    // user switched off for themselves is re-spelled THERE, never moved into the shared file.
    const respellSeats = (list, lab) =>
    {
        let touched = false;
        // A renamed seat's core deny is re-spelled in place, so the user's switch-off holds under the new
        // name; the read-back already read it that way (selection.js renameDeny).
        for (const entry of [...list])
        {
            const m = /^Agent\(([a-z0-9-]+):([A-Za-z0-9_-]+)\)$/.exec(entry);
            if (!m || m[1] !== BRAND.core || seatNow(m[2]) === m[2]) continue;
            const now = `Agent(${BRAND.core}:${seatNow(m[2])})`;
            if (list.includes(now)) list.splice(list.indexOf(entry), 1);
            else list[list.indexOf(entry)] = now;
            touched = true;
            log(`  ${lab}: ${entry} re-spelled ${now} (the seat was renamed)`);
        }
        return touched;
    };
    if (respellSeats(deny, label)) changed = true;
    // R99: `localFile` is settings.local.json on a project or user run - its stack keys apply over this
    // file, so the env pass writes a key it holds back into it (`applyEnv` `overlay`). A malformed one
    // is no overlay: Claude Code cannot read it either, so it is named and left as it is.
    let local = null;
    let localUnreadable = false;
    if (localFile && fs.existsSync(localFile))
    {
        try { ({ data: local } = readSettings(localFile)); }
        catch (err) { note(`${err.message} - its stack keys are not read or written this run`); local = null; localUnreadable = true; }
    }
    const localEnvBefore = local && plain(local.env) ? { ...local.env } : {};
    const localDeny = local && local.permissions && Array.isArray(local.permissions.deny) ? local.permissions.deny : null;
    const localDenyBefore = localDeny ? [...localDeny] : [];
    const localRespelled = Boolean(localDeny) && respellSeats(localDeny, path.basename(localFile));
    if (rekeyOverrides(data, renamed, log, label)) changed = true;

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
        { deny.splice(deny.indexOf(entry), 1); changed = true; log(entry === rule ? `  ${label}: agent allowed again ${entry}` : `  ${label}: agent entry dropped ${entry} (the seat's old spelling)`); }
    };
    for (const rule of agentDeny)
    {
        dropSeat(rule, rule);
        if (!deny.includes(rule) && !(localDeny && localDeny.includes(rule))) { deny.push(rule); changed = true; log(`  ${label}: agent denied ${rule}`); }
    }
    for (const rule of agentAllow) dropSeat(rule, null);
    // C4 (R133 N1): a seat denied only in settings.local.json stays off whatever settings.json says, so
    // the allow drops it there too - the one entry of that file this run removes.
    let localAllowed = false;
    if (localDeny)
    {
        for (const rule of agentAllow)
            for (const entry of [...localDeny]) if (stackSeat(entry) && stackSeat(entry) === stackSeat(rule))
            { localDeny.splice(localDeny.indexOf(entry), 1); localAllowed = true; log(`  ${path.basename(localFile)}: agent allowed again ${entry}`); }
        if (localAllowed && !localDeny.length) delete local.permissions.deny;
        if (localAllowed && !Object.keys(local.permissions).length) delete local.permissions;
    }

    // enabledMcpjsonServers: an earlier release pre-approved the .mcp.json servers it registered. The stack registers
    // none since 2.10.1, so the names it wrote leave (`mcpOff` - a name the user's own .mcp.json row holds is not
    // passed): a leftover entry names a server that no longer exists - dead config that reads like a working knob.
    // A list this run empties goes; the user's own entries stay. disabledMcpjsonServers the same: an engine left off was
    // registered AND named there.
    for (const listKey of ['enabledMcpjsonServers', 'disabledMcpjsonServers'])
    {
        if (!Array.isArray(data[listKey])) continue;
        const list = data[listKey];
        let dropped = false;
        for (const name of mcpOff) if (list.includes(name))
        { list.splice(list.indexOf(name), 1); changed = true; dropped = true; log(`  ${label}: dropped ${listKey} entry ${name} (no longer registered here)`); }
        if (dropped && !list.length) delete data[listKey];
        // Every release before 2.10.1 created enabledMcpjsonServers on each write, an empty one on the plugin route, so on
        // the first update past the retirement an empty list is the stack's and goes, as uninstall takes it. An empty
        // disabledMcpjsonServers was never the stack's (R116), so it stays.
        else if (!dropped && !list.length && dropEmptyApprovals && listKey === 'enabledMcpjsonServers')
        { delete data[listKey]; changed = true; log(`  ${label}: dropped the empty enabledMcpjsonServers list an earlier release created`); }
    }

    // The git preferences forbid AI attribution; the `attribution` setting enforces it. Key by key and add-only:
    // a value the project set stays, and at local scope a settings.json value is never hidden by a seed.
    const attrBefore = plain(data.attribution) ? Object.keys(data.attribution) : [];
    if (attribution && (data.attribution === undefined || (data.attribution && typeof data.attribution === 'object' && !Array.isArray(data.attribution))))
    {
        const inherited = attribution.inherited && typeof attribution.inherited === 'object' ? attribution.inherited : {};
        const seeded = [];
        for (const [key, value] of ATTRIBUTION_OFF)
        {
            if ((data.attribution && Object.hasOwn(data.attribution, key)) || Object.hasOwn(inherited, key)) continue;
            (data.attribution ??= {})[key] = value;
            seeded.push(key);
        }
        if (seeded.length) { changed = true; log(`  ${label}: attribution off (${seeded.join(', ')}) - no AI attribution in commits or PRs`); }
    }
    // A seat dispatched with isolation 'worktree' branches from the REMOTE default branch unless
    // `worktree.baseRef` is "head" (code.claude.com/docs/en/worktrees), so it would build without the run's
    // own commits. Add-only, the attribution shape: a value the project set stays, other `worktree` keys
    // are kept, and at local scope a settings.json value is never hidden by a seed.
    const baseRefBefore = plain(data.worktree) && Object.hasOwn(data.worktree, 'baseRef');
    if (worktreeBase && (data.worktree === undefined || plain(data.worktree)))
    {
        const inherited = plain(worktreeBase.inherited) ? worktreeBase.inherited : {};
        if (!(data.worktree && Object.hasOwn(data.worktree, 'baseRef')) && !Object.hasOwn(inherited, 'baseRef'))
        {
            (data.worktree ??= {}).baseRef = 'head';
            changed = true;
            log(`  ${label}: worktree.baseRef head - an isolated seat's worktree branches from this HEAD, not the remote default branch`);
        }
    }
    const overlay = local && local.env && typeof local.env === 'object' && !Array.isArray(local.env) ? local.env : null;
    const overlayBefore = overlay ? JSON.stringify(overlay) : null;
    // The ledger row of a key in a file - under the name it had before this run's renames, when it was renamed. A file the
    // ledger holds no env for (no stamp, or one from before the ledger) leaves the reseed to the value match, as it was.
    const stackWrote = (fileLabel, key, value) =>
    {
        const rows = prior && prior.env ? prior.env[fileLabel] : null;
        if (!rows) return true;
        const names = [key, ...(migrations.renames || []).filter(([, to]) => to === key).map(([from]) => from)];
        return names.some((n) => rows[n] === valueHash(value));
    };
    if (applyEnv((data.env ??= {}), { catalog, migrations, docsVersioning, docsPath, dataPath, autoCompact, memory, hooksOff, hooksAnswered, renamedHooks: (renamed && renamed.hooks) || {}, inherited: inheritedEnv, overlay, overlayUnreadable: localUnreadable, sharedKeys, log, label,
        overlayLabel: localFile ? path.basename(localFile) : undefined, stackWrote, workspaceEnv })) changed = true;
    // The auto-compact window per model (compactWindowSeeds). Claude Code reads it at session START only - measured
    // 2026-10-14: written mid-session it changed nothing in print or interactive mode, set before the start it compacted
    // at 76k of a 100k window - so it is this project's standing setting, never a per-run one, written in the project's
    // own file at every scope and never in the account's (every project's). Per model under
    // `modelSettings`, add-only, each entry the stack's only while it holds the value the ledger recorded: an update
    // re-derives it, a value the user set stays. Left out: a model the sibling project file or the account file names,
    // since this file would outrank theirs, and every model when one of the three sets the top-level window for all.
    const acwOwned = new Set();
    const acwPrior = prior && prior.settings ? prior.settings[label] || {} : null;
    if (compactWindows && (data.modelSettings === undefined || plain(data.modelSettings)))
    {
        const sibling = plain(compactWindows.inherited) ? compactWindows.inherited : (plain(local) ? local : {});
        const account = plain(compactWindows.account) ? compactWindows.account : {};
        const topLevel = (o) => plain(o) && o.autoCompactWindow !== undefined;
        const named = (o, id) => plain(o) && plain(o.modelSettings) && plain(o.modelSettings[id]) && o.modelSettings[id].autoCompactWindow !== undefined;
        const held = (id) =>
        {
            const entry = plain(data.modelSettings) ? data.modelSettings[id] : undefined;
            return plain(entry) && Object.hasOwn(entry, 'autoCompactWindow') && Boolean(acwPrior)
                && acwPrior[compactAt(id)] === valueHash(JSON.stringify(entry.autoCompactWindow));
        };
        const env = { ...(plain(inheritedEnv) ? inheritedEnv : {}), ...(plain(data.env) ? data.env : {}), ...(overlay || {}) };
        const seeds = topLevel(data) || topLevel(sibling) || topLevel(account) ? {} : compactWindowSeeds(compactWindows.models, env, catalog);
        const seeded = [];
        const moved = [];
        for (const [id, value] of Object.entries(seeds))
        {
            if (named(sibling, id) || named(account, id)) continue;
            const entry = plain(data.modelSettings) ? data.modelSettings[id] : undefined;
            if (entry !== undefined && !plain(entry)) continue;
            if (!entry || !Object.hasOwn(entry, 'autoCompactWindow'))
            {
                ((data.modelSettings ??= {})[id] ??= {}).autoCompactWindow = value;
                seeded.push(id);
                acwOwned.add(id);
            }
            else if (held(id))
            {
                if (entry.autoCompactWindow !== value) { entry.autoCompactWindow = value; moved.push(id); }
                acwOwned.add(id);
            }
        }
        // An entry the stack wrote for a model it no longer seeds here - a row the table dropped, a tier switched off, a
        // window the user set in another file since - leaves; one the user changed is theirs and stays.
        const gone = plain(data.modelSettings) ? Object.keys(data.modelSettings).filter((id) => !acwOwned.has(id) && held(id)) : [];
        for (const id of gone)
        {
            delete data.modelSettings[id].autoCompactWindow;
            if (!Object.keys(data.modelSettings[id]).length) delete data.modelSettings[id];
        }
        if (plain(data.modelSettings) && !Object.keys(data.modelSettings).length) delete data.modelSettings;
        if (seeded.length || moved.length)
        {
            const byValue = new Map();
            for (const id of [...seeded, ...moved]) byValue.set(data.modelSettings[id].autoCompactWindow, (byValue.get(data.modelSettings[id].autoCompactWindow) || 0) + 1);
            const spread = [...byValue].sort((a, b) => a[0] - b[0]).map(([v, n]) => `${v} on ${n} model${n === 1 ? '' : 's'}`).join(', ');
            log(`  ${label}: autoCompactWindow per model - ${spread}: ALFRED_CODE_AUTO_COMPACT=1, so each model compacts at its window's fresh-session trigger instead of offering a fresh session (read at session start)`);
        }
        if (gone.length) log(`  ${label}: autoCompactWindow removed for ${gone.join(', ')} - the stack wrote it and no longer seeds it here`);
        if (seeded.length || moved.length || gone.length) changed = true;
    }
    // CUSTOM MEMORY (ALFRED_CODE_MEMORY=custom, applyEnv 3e): Claude Code's own memory off in this project's own file at every
    // scope, ledgered, so a switch back or an uninstall takes it back. A value the user set is theirs - kept, and named where it
    // works against the mode. The env as this run leaves it, the way the window pass reads it. The switch-off sits beside the
    // choice (final review I1): in settings.local.json when its env holds ALFRED_CODE_MEMORY - a personal choice never switches
    // the team's memory off in the committed settings.json - else in this run's own file; the other file keeps none of the stack's.
    const localName = localFile ? path.basename(localFile) : null;
    let memOwned = false;
    let memLocal = false;
    let localMem = false;
    {
        const memPrior = (name) => (prior && prior.settings ? prior.settings[name] || {} : null);
        const oursIn = (obj, name) => Object.hasOwn(obj, 'autoMemoryEnabled') && Boolean(memPrior(name)) && memPrior(name).autoMemoryEnabled === valueHash(JSON.stringify(obj.autoMemoryEnabled));
        const env = { ...(plain(inheritedEnv) ? inheritedEnv : {}), ...(plain(data.env) ? data.env : {}), ...(overlay || {}) };
        const custom = env.ALFRED_CODE_MEMORY === 'custom';
        const inLocal = Boolean(overlay) && Object.hasOwn(overlay, 'ALFRED_CODE_MEMORY');
        const [at, name, other, otherName] = inLocal ? [local, localName, data, label] : [data, label, local, localName];
        const touch = () => { if (at === data) changed = true; else localMem = true; };
        const own = () => { if (at === data) memOwned = true; else memLocal = true; };
        const has = Object.hasOwn(at, 'autoMemoryEnabled');
        const ours = oursIn(at, name);
        // A value of the user's own is named on the run that answers the question or drops the stack's row, not on every run.
        const say = Boolean(memory && memory.value) || Boolean(memPrior(name) && Object.hasOwn(memPrior(name), 'autoMemoryEnabled'));
        if (custom && !has)
        {
            at.autoMemoryEnabled = false;
            own();
            touch();
            log(`  ${name}: autoMemoryEnabled: false written - ALFRED_CODE_MEMORY is custom, so Claude's own memory is off and your ranked memory tool holds the lessons`);
        }
        else if (custom && ours) own();
        else if (custom && at.autoMemoryEnabled === true && say) log(`  ${name}: autoMemoryEnabled: true kept - yours; custom memory needs it off, so Claude's own memory stays on beside your memory tool`);
        else if (!custom && ours)
        {
            delete at.autoMemoryEnabled;
            touch();
            log(`  ${name}: autoMemoryEnabled: false removed - ALFRED_CODE_MEMORY is no longer custom, so Claude's own memory is back on`);
        }
        else if (!custom && at.autoMemoryEnabled === false && say) log(`  ${name}: autoMemoryEnabled: false kept - yours; native memory needs it on, so Claude's own memory stays off until you remove it`);
        // The shared file keeps its switch-off while its own env is custom (fix-pass review I1): one developer's
        // settings.local.json answer is theirs alone and never strips the team's row.
        const sharedCustom = other === data && ({ ...(plain(inheritedEnv) ? inheritedEnv : {}), ...(plain(data.env) ? data.env : {}) }).ALFRED_CODE_MEMORY === 'custom';
        if (other && oursIn(other, otherName) && sharedCustom)
        {
            memOwned = true;
            if (!custom && say) log(`  ${otherName}: autoMemoryEnabled: false kept - ALFRED_CODE_MEMORY is custom there for the team; ${name}'s default leaves Claude's own memory off for you until ${name} sets autoMemoryEnabled: true`);
        }
        else if (other && oursIn(other, otherName))
        {
            delete other.autoMemoryEnabled;
            if (other === data) changed = true; else localMem = true;
            log(custom ? `  ${otherName}: autoMemoryEnabled: false removed - ${name} holds the custom choice, so the switch-off sits there beside it`
                : `  ${otherName}: autoMemoryEnabled: false removed - ALFRED_CODE_MEMORY is no longer custom, so Claude's own memory is back on`);
        }
    }
    // R10: the ledger pass, over the env of each file this run writes, the deny lists and the wirings.
    const reseeds = (key) => (migrations.reseed || []).filter(([k]) => k === key).flatMap(([, bad, to]) => [bad, to]);
    const seedsOf = (key) => [...catalog.filter((r) => r.key === key && !r.written && r.seed !== false).flatMap((r) => [String(r.default), ...(r.former_defaults || []).map(String)]), ...reseeds(key),
        ...(key === 'ALFRED_CODE_DOCS_VERSIONING' && docsVersioning && docsVersioning.seed ? [docsVersioning.seed] : [])];
    const releaseEnv = new Set(catalog.map((r) => r.key));
    const writtenNow = {};
    const priorEnv = (name) => (prior && prior.env ? prior.env[name] || {} : null);
    const managedEnv = {};
    const kept = docsPath && docsPath.keep ? ['ALFRED_CODE_DOCS_PATH'] : [];
    const envShared = ledgerEnv({ name: label, env: data.env, before: envBefore, prior: priorEnv(label), release: releaseEnv, seedsOf, written: writtenNow, kept, migrations, log });
    if (envShared.changed) changed = true;
    managedEnv[label] = envShared.managed;
    if (overlay)
    {
        const envLocal = ledgerEnv({ name: localName, env: overlay, before: localEnvBefore, prior: priorEnv(localName), release: releaseEnv, seedsOf, written: writtenNow, kept, migrations, log });
        managedEnv[localName] = envLocal.managed;
    }
    const priorDeny = prior && prior.deny ? prior.deny : null;
    const ownDeny = (entry) => denySpecs.includes(entry) || Boolean(stackSeat(entry));
    for (const [list, name] of [[deny, label], [localDeny, localName]])
    {
        if (!list || !priorDeny) continue;
        // Only an entry some release shipped: the stamp is project text, never a deny rule of the user's.
        for (const d of priorDeny.filter((x) => x.file === name && !ownDeny(x.entry) && list.includes(x.entry) && (ledger.shippedDeny || []).includes(x.entry)))
        {
            list.splice(list.indexOf(d.entry), 1);
            if (list === deny) changed = true; else localAllowed = true;
            log(`  ${name}: deny ${d.entry} removed - the stack wrote it and this release no longer does`);
        }
    }
    // An entry already there is the stack's only when the ledger recorded it IN THIS FILE: the same string
    // recorded for the other file (a local-scope install's own, before a move) never claims the team's
    // copy (review finding 1). With no ledger a secret-file deny is never claimed - it may be the team's,
    // and a leftover after uninstall is harmless where a removed one is not (finding 6); a stack seat is.
    const managedDeny = deny.filter((entry) => !denyBefore.includes(entry)
        || (priorDeny ? priorDeny.some((d) => d.file === label && d.entry === entry) : Boolean(stackSeat(entry)))).map((entry) => ({ file: label, entry }));
    if (localDeny)
        for (const entry of localDeny)
            if (!localDenyBefore.includes(entry) || (priorDeny ? priorDeny.some((d) => d.file === localName && d.entry === entry) : Boolean(stackSeat(entry))))
                managedDeny.push({ file: localName, entry });
    // Review finding 5: a local file this run could not read was not written - its rows stand as recorded.
    if (localUnreadable && priorDeny) managedDeny.push(...priorDeny.filter((d) => d.file === localName));
    // The release's wirings with the shell guards folded, plus the dispatcher row this run wrote (its
    // args name this selection's guards, which the release's own full row does not).
    const release = new Set([...releaseWirings(foldDispatchers(ledger.releaseHooks || hookSpecs)), ...releaseWirings(wired)]);
    const priorHooks = prior && prior.hooks ? prior.hooks : null;
    if (priorHooks)
    {
        const gone = unwireIds(data, new Set(priorHooks.filter((h) => h.file === label && !release.has(h.id)).map((h) => h.id)));
        for (const g of gone) log(`  ${label}: hook wiring ${g.hook} (${g.event}) removed - the stack wired it and this release no longer does`);
        if (gone.length) changed = true;
    }
    const managedHooks = wiringsOf(data.hooks).filter((w) => w.hook && (!wiredBefore.has(w.id)
        || (priorHooks ? priorHooks.some((h) => h.id === w.id) : release.has(w.id)))).map((w) => ({ file: label, hook: w.hook, id: w.id }));
    // The attribution keys: seeded this run, or listed at the value written (no ledger: at the seed value).
    const priorSettings = prior && prior.settings ? prior.settings[label] || {} : null;
    const managedAttr = {};
    for (const [key, value] of plain(data.attribution) ? ATTRIBUTION_OFF : [])
    {
        if (!Object.hasOwn(data.attribution, key)) continue;
        const at = `attribution.${key}`;
        const json = JSON.stringify(data.attribution[key]);
        if (!attrBefore.includes(key) || (priorSettings ? priorSettings[at] === valueHash(json) : json === JSON.stringify(value))) managedAttr[at] = valueHash(json);
    }
    // worktree.baseRef: seeded this run, or listed at the value written. No release before this one seeded
    // it, so a stamp with no ledger adopts nothing here.
    if (plain(data.worktree) && Object.hasOwn(data.worktree, 'baseRef'))
    {
        const json = JSON.stringify(data.worktree.baseRef);
        if (!baseRefBefore || (priorSettings && priorSettings['worktree.baseRef'] === valueHash(json))) managedAttr['worktree.baseRef'] = valueHash(json);
    }
    // The per-model windows this run seeded or still holds at the recorded value. No release before 2.5.0 seeded them,
    // so a stamp with no ledger adopts nothing here.
    for (const id of acwOwned) managedAttr[compactAt(id)] = valueHash(JSON.stringify(data.modelSettings[id].autoCompactWindow));
    if (memOwned) managedAttr.autoMemoryEnabled = valueHash(JSON.stringify(data.autoMemoryEnabled));
    const managed = { env: managedEnv, deny: managedDeny, hooks: managedHooks, settings: Object.keys(managedAttr).length ? { [label]: managedAttr } : {} };
    // The switch-off held in settings.local.json: its row there, beside the file's other rows still at their recorded value.
    if (memLocal)
    {
        const rows = Object.entries((prior && prior.settings && prior.settings[localName]) || {}).filter(([at, h]) =>
        {
            const spot = at !== 'autoMemoryEnabled' && settingAt(local, at);
            return Boolean(spot) && Object.hasOwn(spot.holder, spot.key) && valueHash(JSON.stringify(spot.holder[spot.key])) === h;
        });
        managed.settings[localName] = { ...Object.fromEntries(rows), autoMemoryEnabled: valueHash(JSON.stringify(local.autoMemoryEnabled)) };
    }

    // A personal skillOverrides switch-off follows a renamed skill the same way as a shared one.
    const localRekeyed = Boolean(local) && rekeyOverrides(local, renamed, log, path.basename(localFile));
    // C3 (R133 b): at local scope settings.json is never written, so an old key there cannot be re-keyed;
    // its value is set under the new name in THIS file - the deny half's shape - and the entry is named.
    if (inheritedOverrides && typeof inheritedOverrides === 'object' && !Array.isArray(inheritedOverrides))
        for (const [from, to] of Object.entries((renamed && renamed.skills) || {}))
        {
            if (!Object.hasOwn(inheritedOverrides, from) || Object.hasOwn(inheritedOverrides, to)) continue;
            const mine = (data.skillOverrides && typeof data.skillOverrides === 'object' && !Array.isArray(data.skillOverrides)) ? data.skillOverrides : null;
            if (mine && Object.hasOwn(mine, to)) continue;
            if (data.skillOverrides !== undefined && !mine) break;
            (data.skillOverrides ??= {})[to] = inheritedOverrides[from];
            changed = true;
            log(`  ${label}: settings.json still names skillOverrides ${from} - set as ${to} in ${label}; a local-scope run never writes settings.json, a project-scope update re-keys it`);
        }
    const localChanged = (Boolean(overlay) && JSON.stringify(overlay) !== overlayBefore) || localRekeyed || localRespelled || localAllowed || localMem;
    // An env this run emptied sets nothing, and a file left with nothing at all goes: 2.10.0 made settings.local.json
    // for the memory database path alone (the memory-db-retired migration).
    const localEmptied = Boolean(overlay) && overlayBefore !== '{}' && !Object.keys(overlay).length;
    if (localEmptied) delete local.env;
    if (localChanged && (localEmptied || localMem) && !Object.keys(local).length)
    {
        fs.rmSync(localFile, { force: true });
        log(`  ${localName} removed - it held nothing but the stack's entries`);
    }
    else if (localChanged)
    {
        fs.mkdirSync(path.dirname(localFile), { recursive: true });
        fs.writeFileSync(localFile, `${JSON.stringify(local, null, 2)}\n`);
    }

    // A local-scope run writes settings.local.json, but the stack's OWN stale rows may sit in the shared
    // settings.json a legacy copy-route install wrote: its hook wiring (a hook file this route no longer
    // copies, run on every call) and its 1.x env keys. Those go - by file name and by key, never a hook
    // or key the user wrote. Nothing is added to the shared file; an unreadable one is left as it is.
    if (sharedFile && sharedFile !== file && fs.existsSync(sharedFile))
    {
        let shared = null;
        try { ({ data: shared } = readSettings(sharedFile)); }
        catch (err) { note(`${err.message} - its stale stack rows are not removed this run`); }
        if (shared)
        {
            const sharedName = path.basename(sharedFile);
            const before = JSON.stringify(shared);
            wireHooks(shared, [], retiredHooks);
            const priorShared = prior && prior.hooks ? prior.hooks.filter((h) => h.file === sharedName) : [];
            const releaseIds = new Set([...releaseWirings(foldDispatchers(ledger.releaseHooks || hookSpecs)), ...releaseWirings(wired)]);
            for (const g of unwireIds(shared, new Set(priorShared.filter((h) => !releaseIds.has(h.id)).map((h) => h.id))))
                log(`  ${sharedName}: hook wiring ${g.hook} (${g.event}) removed - the stack wired it and this release no longer does`);
            if (plain(shared.env))
            {
                renameEnv(shared.env, migrations, log, sharedName);
                retireAndReseed(shared.env, migrations, log, sharedName);
            }
            if (JSON.stringify(shared) !== before)
            {
                fs.writeFileSync(sharedFile, `${JSON.stringify(shared, null, 2)}\n`);
                log(`  ${sharedName}: the stack's stale rows removed (a local-scope run writes ${label})`);
            }
        }
    }

    if (!changed) return { written: localChanged, refused: false, managed };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    return { written: true, refused: false, managed };
}

// Rule: a narrower scope switches off an MCP server registered at a BROADER one for itself alone. MCP has no
// per-scope disable command, so the entry is a `deniedMcpServers` `{ serverName }` row in this scope's own
// settings file (settings.local.json at local scope, settings.json at project scope) - the denylist merges from
// every settings scope and blocks the name here only (code.claude.com/docs/en/managed-mcp, 'How a server is
// evaluated'). `add` and `lift` are names; only an entry naming exactly `{ serverName: <name> }` is lifted, so a
// row of the user's own shape stays. `why` is the lift's reason in its line. Returns `{ added, lifted }` as written, or null
// when the file could not be read or its list is not a list (said once, nothing changed).
function applyMcpDeny({ file, add = [], lift = [], why = 'picked again', log = () => {}, note = () => {} })
{
    if (!add.length && !lift.length) return { added: [], lifted: [] };
    const label = path.basename(file);
    let data;
    try { ({ data } = readSettings(file)); }
    catch (err) { note(`${err.message} - no deniedMcpServers entry was written there`); return null; }
    const had = data.deniedMcpServers;
    if (had !== undefined && !Array.isArray(had)) { note(`${label}: deniedMcpServers is not a list - left as it is, and no MCP server is switched off through it`); return null; }
    const list = had || [];
    const ours = (row, name) => plain(row) && Object.keys(row).length === 1 && row.serverName === name;
    const added = [];
    const lifted = [];
    for (const name of lift)
    {
        const at = list.findIndex((row) => ours(row, name));
        if (at < 0) continue;
        list.splice(at, 1);
        lifted.push(name);
        log(`  ${label}: deniedMcpServers - ${name} (${why})`);
    }
    let grew = false;
    for (const name of add)
    {
        if (!list.some((row) => ours(row, name))) { list.push({ serverName: name }); grew = true; log(`  ${label}: deniedMcpServers + ${name} (dropped here - its broader-scope registration stays for everyone else)`); }
        added.push(name);
    }
    // A re-run that finds every entry in place writes nothing.
    if (!grew && !lifted.length) return { added, lifted };
    if (list.length) data.deniedMcpServers = list;
    else delete data.deniedMcpServers;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    return { added, lifted };
}

// T16/R47 (I1): the ONE place that decides which file THIS run's own settings writes go to - a
// `local`-scope install's stack settings (and, per R47, its `autoMemoryEnabled` switch-off) are
// machine-personal, so they go to settings.local.json; every other scope keeps the shared file. Every
// write site names this helper instead of its own ternary, so the three call sites (writeSettings'
// own target, the memory import gate/switch-off, the --installed-only read-back) cannot drift apart.
const settingsTarget = (claudeDir, scope) => path.join(claudeDir, scope === 'local' ? 'settings.local.json' : 'settings.json');

// What the --installed-only read-back reads, fail-soft (an unreadable file reads as empty). At project
// and user scope, the file this run writes with the STACK env keys settings.local.json holds laid over
// it, key by key (R99): Claude Code applies those, so a read-back blind to them showed a hook the user
// switched off as on, and a seat denied there as on. Nothing else of the local file is read there
// (I2: a merge could carry a personal entry into the shared file), and the writer puts a change to
// such a key back into the local file
// (`writeSettings` `localFile`), never the shared one. `sharedOnly` is settings.json alone - the N6
// inherited view and R98's docs root read that. At local scope the write lands in the personal file,
// so settings.local.json is laid over settings.json (N5) for the two keys the read-back uses: `env` key
// by key with local winning, and `permissions.deny` combined. Every other key is the local file's whole
// where it has one - `permissions.allow` / `ask` / `additionalDirectories`, `enabledPlugins`, `hooks`
// included - so this is NOT the view Claude Code resolves, which combines every list across files: a
// caller that reads more than `env` and `deny` needs its own merge.
function readBackSettings(claudeDir, scope, { sharedOnly = false } = {})
{
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    const read = (name) => { try { return obj(parseJson(fs.readFileSync(path.join(claudeDir, name), 'utf8'))); } catch { return {}; } };
    if (scope !== 'local')
    {
        const own = read('settings.json');
        if (sharedOnly) return own;
        const personal = read('settings.local.json');
        const held = Object.entries(obj(personal.env)).filter(([key]) => isStackKey(key));
        const view = held.length ? { ...own, env: { ...obj(own.env), ...Object.fromEntries(held) } } : own;
        // I1 (fix round 1): a stack seat deny kept there is an off-state Claude Code applies, so the
        // read-back sees it (left_out, status); the writer re-spells it there and never copies it here.
        const list = (x) => (Array.isArray(obj(obj(x).permissions).deny) ? obj(x.permissions).deny : []);
        const seats = list(personal).filter((d) => stackSeat(d));
        return seats.length ? { ...view, permissions: { ...obj(view.permissions), deny: [...new Set([...list(view), ...seats])] } } : view;
    }
    const shared = read('settings.json');
    const local = read('settings.local.json');
    const deny = (s) => (Array.isArray(obj(s.permissions).deny) ? obj(s.permissions).deny : []);
    return {
        ...shared, ...local,
        env: { ...obj(shared.env), ...obj(local.env) },
        permissions: { ...obj(shared.permissions), ...obj(local.permissions), deny: [...new Set([...deny(shared), ...deny(local)])] },
    };
}

// M1 (Task 22 fix round 1): the deny entries only settings.json holds - at local scope, what the read
// sees that this run never writes.
function sharedOnlyDeny(claudeDir)
{
    const deny = (name) => { try { const d = parseJson(fs.readFileSync(path.join(claudeDir, name), 'utf8')); return Array.isArray(d.permissions.deny) ? d.permissions.deny : []; } catch { return []; } };
    const personal = new Set(deny('settings.local.json'));
    return deny('settings.json').filter((d) => !personal.has(d));
}

// R78 (Task 16 round 5): an install moved from `local` scope back to project or user scope. Claude
// Code lays settings.local.json over settings.json, so every stack entry the local install wrote there
// would keep overriding the file the install now lives in - and no later run clears them, since only a
// local-scope read-back reads the local file. A stack seat deny and a secret-file deny join
// settings.json's list. The stack's copied-hook wiring (`hookFiles`) is dropped from the local file - this run
// writes it to settings.json on the route that uses it - and so are the `.mcp.json` approvals an earlier release
// wrote (`mcpNames`), since no release registers a server now.
// R96 (Task 18b fix round 1): an `ALFRED_CODE_*` env key NEVER moves - settings.json is the
// committed file, and a value set locally is personal (a hooks-off list, a second writable tree). A
// local key still holding the stack's own seed (`seeds`, what this run would seed) or one the stack
// writes every run (`written`) is the stack's stale copy and goes; any other value stays in
// settings.local.json untouched, still overriding settings.json (R99: later runs read and write it
// there), and each key is logged once. Fix round 2: a seed may be a LIST - every value the stack has
// shipped for the key, a reseed migration's old one included (N2) - and a kept value is logged by its
// length only, whatever the key's name (N3): it is the user's, and it can carry a credential under a
// key that does not look like one. The removed seeds are one line naming each key, never a value
// (C18). A PERSONAL_KEYS value stays (C8). Everything else in the local
// file - the user's own keys, allow list, hooks, `autoMemoryEnabled` - stays as it was. A file that
// cannot be read or written moves nothing: half a move would strand entries in neither file.
const ENV_PREFIX = 'ALFRED_CODE_';
function leaveLocalScope({ claudeDir, hookFiles = [], mcpNames = [], denySpecs = [], seeds = {}, written = [], ledgerEnv: recorded = null, ledgerSettings = null, ledgerDeny = null, log = () => {}, note = () => {} })
{
    const localFile = path.join(claudeDir, 'settings.local.json');
    const sharedFile = path.join(claudeDir, 'settings.json');
    if (!fs.existsSync(localFile)) return { moved: false };
    let local;
    let shared;
    try { ({ data: local } = readSettings(localFile)); ({ data: shared } = readSettings(sharedFile)); }
    catch (err) { note(`scope move: ${err.message} - the stack's local entries stay where they are`); return { moved: false, refused: true }; }
    const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
    const say = (m) => log(`  settings.local.json: ${m}`);
    let localChanged = false;
    let sharedChanged = false;

    const env = isObj(local.env) ? local.env : null;
    const seeded = (key, v) => Object.hasOwn(seeds, key) && [].concat(seeds[key]).includes(v);
    // C18 (R98): the seeds leave as ONE line - a count and the keys - not a line per key.
    const seedsGone = [];
    for (const key of Object.keys(env || {}).filter((k) => k.startsWith(ENV_PREFIX)))
    {
        const v = env[key];
        // C8: a machine's own value lives in this file at every scope - nothing to move.
        if (PERSONAL_KEYS.includes(key)) continue;
        if (written.includes(key)) say(`${key} removed - the stack writes it every run, to settings.json from here on`);
        // R10: a stale seed is one the stack WROTE here (the ledger, exact - a seed value the user typed
        // is theirs) and that is a seed rather than a decision (a walk's hooks-off answer is written by
        // the stack but is the user's choice). With no ledger (an older stamp) the seed match alone.
        else if (seeded(key, v) && (!recorded || recorded[key] === valueHash(v))) seedsGone.push(key);
        else
        {
            say(`${key} stays here (your value, ${String(v).length} chars) - it applies over settings.json, and later runs read and write it here`);
            continue;
        }
        delete env[key];
        localChanged = true;
    }
    if (env && !Object.keys(env).length) delete local.env;

    // The settings seeds (attribution, worktree.baseRef) leave too: left here they would override a value the
    // team later sets in settings.json. The ledger's entries exactly; with no ledger, the seed value.
    const settingsGone = [];
    // The per-model auto-compact windows and custom memory's switch-off go by the ledger alone: their value is derived, so
    // there is no seed to compare.
    // A custom choice that stays here keeps its switch-off beside it (final review I1): the writer holds it in this file.
    const customStays = isObj(local.env) && local.env.ALFRED_CODE_MEMORY === 'custom';
    if (customStays && ledgerSettings && Object.hasOwn(local, 'autoMemoryEnabled') && ledgerSettings.autoMemoryEnabled === valueHash(JSON.stringify(local.autoMemoryEnabled))) say('autoMemoryEnabled stays here - ALFRED_CODE_MEMORY=custom stays in this file, and the switch-off sits beside it');
    const seededPaths = [...SEEDED_SETTINGS, ...Object.keys(ledgerSettings || {}).filter((at) => at.startsWith('modelSettings.') || (at === 'autoMemoryEnabled' && !customStays)).map((at) => [at, undefined])];
    for (const [at, seed] of seededPaths)
    {
        const spot = settingAt(local, at);
        if (!spot || !Object.hasOwn(spot.holder, spot.key)) continue;
        const json = JSON.stringify(spot.holder[spot.key]);
        if (ledgerSettings ? ledgerSettings[at] !== valueHash(json) : (seed === undefined || json !== JSON.stringify(seed)))
        {
            say(`${at} stays here (your value) - it applies over settings.json`);
            continue;
        }
        dropSetting(local, at);
        settingsGone.push(at);
        localChanged = true;
    }
    // C18: every seed that left is ONE line - the per-model windows as one count.
    const windowsGone = settingsGone.filter((at) => at.startsWith('modelSettings.')).length;
    const settingsShown = settingsGone.filter((at) => !at.startsWith('modelSettings.'))
        .concat(windowsGone ? [`autoCompactWindow for ${windowsGone} model${windowsGone === 1 ? '' : 's'}`] : []);
    const alsoSettings = settingsGone.length ? `; and the settings seeds ${settingsShown.join(', ')}` : '';
    if (seedsGone.length)
        say(`${seedsGone.length} stack env key${seedsGone.length === 1 ? '' : 's'} removed - each held the stack's own seed, so settings.json's value or its seed applies from here on: ${seedsGone.join(', ')}${alsoSettings}`);
    else if (settingsGone.length) say(`the stack's settings seeds removed - settings.json's value or its seed applies from here on: ${settingsShown.join(', ')}`);

    const perms = isObj(local.permissions) ? local.permissions : null;
    const deny = perms && Array.isArray(perms.deny) ? perms.deny : [];
    const carried = deny.filter((d) => stackSeat(d) || denySpecs.includes(d));
    // What settings.json did not hold before the move: the only entries a ledger row can follow there.
    const landed = [];
    if (carried.length)
    {
        if (!isObj(shared.permissions)) shared.permissions = {};
        if (!Array.isArray(shared.permissions.deny)) shared.permissions.deny = [];
        for (const d of carried)
        {
            if (!shared.permissions.deny.includes(d)) { shared.permissions.deny.push(d); landed.push(d); sharedChanged = true; }
            deny.splice(deny.indexOf(d), 1);
            say(`deny ${d} moved to settings.json`);
        }
        localChanged = true;
        if (!deny.length) delete perms.deny;
        if (!Object.keys(perms).length) delete local.permissions;
    }

    if (Array.isArray(local.enabledMcpjsonServers))
    {
        for (const name of local.enabledMcpjsonServers.filter((n) => mcpNames.includes(n)))
        {
            local.enabledMcpjsonServers.splice(local.enabledMcpjsonServers.indexOf(name), 1);
            localChanged = true;
            say(`enabledMcpjsonServers entry ${name} dropped - the stack registers no MCP server since 2.10.1`);
        }
        if (!local.enabledMcpjsonServers.length) delete local.enabledMcpjsonServers;
    }

    if (isObj(local.hooks) && wireHooks(local, [], hookFiles))
    {
        localChanged = true;
        say('the stack\'s copied-hook wiring dropped - wired in settings.json from here on');
        if (!Object.keys(local.hooks).length) delete local.hooks;
    }

    if (!localChanged) return { moved: false };
    // The receiving file first: a crash between the two writes then leaves a key in both files,
    // which the next run reads the same way, never in neither.
    if (sharedChanged) fs.writeFileSync(sharedFile, `${JSON.stringify(shared, null, 2)}\n`);
    fs.writeFileSync(localFile, `${JSON.stringify(local, null, 2)}\n`);
    return { moved: true, ledgerDeny: refileDeny(ledgerDeny, carried, landed) };
}

// Review finding 1: the ledger's settings.local.json deny rows for what the move carried. One that
// landed in settings.json (the file did not hold it before) follows it there; one settings.json already
// held was the team's there, so the stack's row goes with the local copy. Every other row stays.
function refileDeny(ledgerDeny, carried, landed)
{
    if (!Array.isArray(ledgerDeny)) return null;
    const out = ledgerDeny.filter((d) => !(d.file === 'settings.local.json' && carried.includes(d.entry)));
    for (const d of ledgerDeny)
        if (d.file === 'settings.local.json' && landed.includes(d.entry) && !out.some((x) => x.file === 'settings.json' && x.entry === d.entry))
            out.push({ file: 'settings.json', entry: d.entry });
    return out;
}

// R10 UNINSTALL, the settings half: every env key, deny entry and hook wiring the ledger lists for a
// file, at the value it recorded - a value changed since is the user's and stays, said by its length
// only. The .mcp.json approvals of the servers uninstall removed go with them. A file the ledger names
// that is left holding nothing goes (an empty list the stack or the plugin CLI left there with it); one
// it names nothing in is never tidied or deleted (review finding 12), and one that cannot be read is
// left exactly as it is.
function removeManagedSettings({ claudeDir, ledger = {}, shippedDeny = [], mcpRemoved = [], scope = 'project', log = () => {}, note = () => {} })
{
    // Review finding 8: at user scope the core's user-scope row is printed, never removed, so it stays
    // loaded here - a seat denied and the hooks named off keep what the user switched off off.
    const offState = (key) => scope === 'user' && (key === 'ALFRED_CODE_HOOKS_OFF' || Boolean(stackSeat(key)));
    const keptOff = [];
    for (const name of ['settings.json', 'settings.local.json'])
    {
        const file = path.join(claudeDir, name);
        if (!fs.existsSync(file)) continue;
        const keys = ((ledger.env || {})[name]) || {};
        // A deny entry goes only when a release shipped it (a stack seat, or a spec in shippedDeny): the
        // stamp is project text, so its ledger never names a deny rule of the user's for removal.
        const denies = (ledger.deny || []).filter((d) => d.file === name && (shippedDeny.includes(d.entry) || Boolean(stackSeat(d.entry)))).map((d) => d.entry);
        const ids = new Set((ledger.hooks || []).filter((h) => h.file === name).map((h) => h.id));
        const attr = ((ledger.settings || {})[name]) || {};
        // Review finding 12: a file the ledger names nothing in was never the stack's to tidy or delete.
        const named = Object.keys(keys).length > 0 || denies.length > 0 || ids.size > 0 || Object.keys(attr).length > 0;
        let data;
        try { ({ data } = readSettings(file)); }
        catch (err) { note(`${err.message} - nothing of the stack's was removed from it`); continue; }
        let changed = false;
        if (plain(data.env))
        {
            for (const [key, hash] of Object.entries(keys))
            {
                if (!isStackKey(key) || !Object.hasOwn(data.env, key)) continue;
                if (valueHash(data.env[key]) !== hash) { log(`  ${name} env: ${key} kept - changed since the stack wrote it, so it is yours (${String(data.env[key]).length} chars)`); continue; }
                if (offState(key)) { keptOff.push(key); continue; }
                delete data.env[key];
                changed = true;
            }
            if (changed && !Object.keys(data.env).length) delete data.env;
        }
        const perms = plain(data.permissions) ? data.permissions : null;
        if (perms && Array.isArray(perms.deny))
        {
            keptOff.push(...perms.deny.filter((d) => denies.includes(d) && offState(d)));
            const kept = perms.deny.filter((d) => !denies.includes(d) || offState(d));
            if (kept.length !== perms.deny.length)
            {
                changed = true;
                if (kept.length) perms.deny = kept; else delete perms.deny;
                if (!Object.keys(perms).length) delete data.permissions;
            }
        }
        if (unwireIds(data, ids).length) changed = true;
        for (const [at, hash] of Object.entries(attr))
        {
            const member = MEMBER_PATH.exec(at);
            if (member)
            {
                const arr = arrayAt(data, member[1]);
                const i = arr.list ? arr.list.findIndex((m) => typeof m === 'string' && valueHash(m) === hash) : -1;
                if (i < 0) continue;
                arr.list.splice(i, 1);
                dropEmptyArray(data, member[1]);
                changed = true;
                continue;
            }
            const spot = settingAt(data, at);
            if (!spot || !Object.hasOwn(spot.holder, spot.key)) continue;
            if (valueHash(JSON.stringify(spot.holder[spot.key])) !== hash) { log(`  ${name}: ${at} kept - changed since the stack wrote it, so it is yours`); continue; }
            dropSetting(data, at);
            changed = true;
        }
        for (const listKey of ['enabledMcpjsonServers', 'disabledMcpjsonServers'])
        {
            const list = data[listKey];
            if (!Array.isArray(list) || !list.some((n) => mcpRemoved.includes(n))) continue;
            const kept = list.filter((n) => !mcpRemoved.includes(n));
            if (kept.length) data[listKey] = kept; else delete data[listKey];
            changed = true;
        }
        // An empty list or map sets nothing: the stack creates enabledMcpjsonServers on every write, and
        // the plugin CLI leaves enabledPlugins as {} once the stack's rows are uninstalled.
        for (const [key, empty] of named ? [['enabledMcpjsonServers', (v) => Array.isArray(v) && !v.length], ['enabledPlugins', (v) => plain(v) && !Object.keys(v).length]] : [])
            if (Object.hasOwn(data, key) && empty(data[key])) { delete data[key]; changed = true; }
        if (!changed) continue;
        if (named && !Object.keys(data).length) { fs.rmSync(file, { force: true }); log(`  ${name} removed - it held nothing but the stack's entries`); }
        else { fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`); log(`  ${name}: the stack's env keys, deny entries, hook wirings and attribution / worktree / auto-compact / memory keys removed`); }
    }
    if (keptOff.length)
        log(`  kept at user scope: ${keptOff.join(', ')} - the user-scope core stays loaded for this account, so these keep what you switched off here off; remove them once it is uninstalled`);
}

module.exports = { compactWindowSeeds, settingAt, MEMBER_PATH, memberRow, syncMembers, carryMemberRows, removeManagedSettings, isStackKey, writeSettings, applyMcpDeny, applyEnv, wireHooks, hookCommand, readSettings, settingsTarget, readBackSettings, sharedOnlyDeny, leaveLocalScope, HOOK_TIMEOUT, HOOK_TIMEOUTS, timeoutFor, asyncFor, onFailureFor };
