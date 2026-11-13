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
const { isDeepStrictEqual } = require('node:util');
const { parseJson, formatOf, stringifyLike } = require('./json-file.js');
const { stackSeat } = require('../derive-state.js');
const { BRAND } = require('./brand.js');
const { valueHash } = require('./stamp.js');
const shellGuards = require('../../stack/hooks/shell-guards.js');
const fileGuards = require('../../stack/hooks/file-guards.js');
const historySession = require('../../stack/hooks/history-session.js');
const { compactWindowSeeds } = require('../../stack/hooks/fresh-session.js');
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
// when a hook fails', Claude Code 2.1.295+). The two dispatchers carry it: the shell one (audit 2026-10-14 HK07, the user's
// ruling) for its rm, force-push and secret guards, and the file one (audit 2026-10-30 HK-21, the plan's ruling) for the
// secret guard on Read and Grep - each a protective guard a crashed or stalled dispatcher would silently pass. The price: a
// broken install blocks every shell and file-tool call until fixed; the rollback is dropping the row here (an update then
// takes the key off the copy route's entry) or `claude plugin disable` on the plugin route. An older Claude Code drops the
// key: its hook entry is a non-strict zod object (2.1.100 and 2.1.294 bundles read 2026-10-14), so nothing is rejected.
const BLOCK_ON_FAILURE = { [`${shellGuards.SELF}.js`]: ['PreToolUse'], [`${fileGuards.SELF}.js`]: ['PreToolUse'] };
const onFailureFor = (file, event) => ((BLOCK_ON_FAILURE[file] || []).includes(event) ? 'block' : undefined);
const hookEntry = (command, timeout, file, event) => ({ type: 'command', command, timeout, ...(asyncFor(file, event) ? { async: true } : {}),
    ...(onFailureFor(file, event) ? { onFailure: onFailureFor(file, event) } : {}) });
// The `attribution` keys the seed writes when absent (code.claude.com settings reference).
const ATTRIBUTION_OFF = [['commit', ''], ['pr', ''], ['sessionUrl', false]];

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
const MEMBER_PATH = /^(claudeMdExcludes|permissions\.additionalDirectories|permissions\.deny|disabledMcpjsonServers)\[([0-9a-f]{64})\]$/;
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
    let fileText;
    try { ({ data, existed, text: fileText } = readSettings(file)); }
    catch (err) { note(`${err.message} - its ${arrayPath} rows are kept as recorded`); return { rows: mine, changed: false, created: false, refused: true }; }
    const at = arrayAt(data, arrayPath, { make: true });
    if (!at.holder) { note(`${path.basename(file)}: ${arrayPath} is not under an object - left as it is`); return { rows: mine, changed: false, created: false, refused: true }; }
    // A value at the key that is not a list is the user's, never replaced by the stack's list (R070).
    if (!at.list && Object.hasOwn(at.holder, at.key)) { note(`${path.basename(file)}: ${arrayPath} is not a list - left as it is`); return { rows: mine, changed: false, created: false, refused: true }; }
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
    fs.writeFileSync(file, stringifyLike(data, formatOf(fileText)));
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
    if (!fs.existsSync(file)) return { data: {}, existed: false, text: null };
    // Re-verify 3 S9: a file that cannot be read is named by its read error, never as bad JSON.
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (err) { const e = new Error(`${path.basename(file)} could not be read (${err.code || err.message}) - left untouched; fix it and re-run`); e.leaveAlone = true; throw e; }
    // An empty file holds nothing to lose: no settings yet, as docs.js reads it too (release matrix 2026-10-20).
    if (!raw.trim()) return { data: {}, existed: true, text: raw };
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
    return { data: parsed, existed: true, text: raw };
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
    // The instrumentation hook was wired behind a shell test of ALFRED_CODE_INSTRUMENT until 3.0.0: the switch moved into
    // .variables (workspace roles and variables, D5), which no shell test reads, so the hook decides for itself as it does
    // on the plugin route, and an update migrates the gated text in place (`older`).
    if (file === 'instrument-tool-usage.js')
    {
        const gate = '[ "$ALFRED_CODE_INSTRUMENT" != "1" ] || ';
        return { command: quoted, legacy, older: [gate + quoted, gate + legacy] };
    }
    return { command: quoted, legacy, older: [] };
}

const fileOf = (command) => (command.includes(HOOKS_DIR_MARK) ? command.split(HOOKS_DIR_MARK).pop().split('"')[0] : '');

function wireHooks(data, specs, retiredHooks)
{
    let changed = false;
    const hooks = data.hooks || {};
    const every = () => Object.entries(hooks);

    // Migrate the unquoted command text earlier installs wired, on any event.
    for (const { command, legacy, older = [] } of specs)
        for (const [, entries] of every())
            for (const entry of entries)
                for (const h of entry.hooks || [])
                    if (h.command === legacy || older.includes(h.command)) { h.command = command; changed = true; }

    // Backfill the timeout onto entries an earlier install wrote bare - they carry the 600s default.
    const ours = new Set(specs.flatMap((s) => [s.command, s.legacy, ...(s.older || [])]));
    for (const [event, entries] of every())
        for (const entry of entries)
            for (const h of entry.hooks || [])
            {
                if (ours.has(h.command) && h.timeout !== timeoutFor(fileOf(h.command), event)) { h.timeout = timeoutFor(fileOf(h.command), event); changed = true; }
                // ...and the async flag onto a side-effect hook an earlier install wired blocking.
                if (ours.has(h.command) && asyncFor(fileOf(h.command), event) && h.async !== true) { h.async = true; changed = true; }
                // ...and the block-on-failure flag onto a dispatcher an earlier install wired without it - and off an entry of
                // ours the table no longer names, so dropping a row is a rollback on this route too (HK-21).
                if (ours.has(h.command) && onFailureFor(fileOf(h.command), event) && h.onFailure !== onFailureFor(fileOf(h.command), event)) { h.onFailure = onFailureFor(fileOf(h.command), event); changed = true; }
                else if (ours.has(h.command) && !onFailureFor(fileOf(h.command), event) && h.onFailure === 'block') { delete h.onFailure; changed = true; }
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

// Steps 2 and 3 of the env pass, in place, over the keys `only` admits. `stackWrote(label, key, value)` answers from the
// install ledger whether the stack wrote that value there; with none given (no ledger) the value match alone decides.
// `labelOf(key)` names the file a line is said of - the one the value lands in (a moved key's is .variables, applyEnv's
// seedAt); the ledger is still asked by `label`, the file the pass reads.
function retireAndReseed(env, migrations, log, label, only = () => true, stackWrote = null, labelOf = () => label)
{
    let changed = false;
    // 2. RETIREMENTS - unconditional, or only while the value is still the stack's own old seed.
    for (const [key, onlyWhen] of migrations.retired || [])
        if (only(key) && key in env && (onlyWhen === null || onlyWhen === undefined || env[key] === onlyWhen))
        {
            delete env[key];
            changed = true;
            log(`  ${labelOf(key)} env: ${key} removed (${onlyWhen == null ? 'retired - nothing reads it' : `the old stack seed ${onlyWhen} - the default applies`})`);
        }

    // 3. BAD SEEDS - corrected only while the key still holds the wrong default AND the stack wrote it there: a value the user
    // typed is theirs even when it equals an old seed (2026-10-16 matrix: a hand-set ALFRED_CODE_CONTEXT_WINDOW_FOR_200K of
    // 150000 was reset to 180000 on every update).
    for (const [key, badSeed, to] of migrations.reseed || [])
        if (only(key) && env[key] === badSeed && (!stackWrote || stackWrote(label, key, badSeed))) { env[key] = to; changed = true; log(`  ${labelOf(key)} env: ${key} reset to ${to} (the old stack seed ${badSeed === '' ? 'empty' : badSeed})`); }
    return changed;
}

// Step 2b, before the reseed sees an old seed: a key that follows others to off (`off_settings_env` - the DEFAULT, once the
// three window tiers are all `0`, item 12 of 2026-10-21) takes their off value while it is a stack seed the stack wrote, or
// absent where `absentOk` says nothing else holds it. A value the user typed stays.
function offWithTiers(env, migrations, log, label, { only = () => true, stackWrote = null, absentOk = () => false, labelOf = () => label } = {})
{
    let changed = false;
    for (const [key, withKeys, seeds, to] of migrations.offWith || [])
    {
        if (!only(key) || !withKeys.every((k) => env[k] === to) || env[key] === to) continue;
        const was = env[key];
        if (was === undefined ? !absentOk(key) : !(seeds.includes(was) && (!stackWrote || stackWrote(label, key, was)))) continue;
        env[key] = to;
        changed = true;
        log(`  ${labelOf(key)} env: ${key} set to ${to} (${was === undefined ? 'absent' : `the stack seed ${was}`}; the three tiers are ${to}, so the offers stay off)`);
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
// `seeds` (a joined child, workspace.js envPlan): the keys a seed may fill - the workspace hands a child the rest (D4 step
// 5), and a decision this run took (a flag, the hooks walk's answer) is written whatever it says. `seedLabel` names the
// file a seed is said to land in (writeSettings moves the stack's variables into .variables).
function applyEnv(env, { catalog, migrations, docsVersioning, docsPath, autoCompact = null, memory = null, hooksOff, hooksAnswered, renamedHooks = {},
    inherited, overlay, log, label = 'settings.json', overlayLabel = 'settings.local.json', stackWrote = null, seeds = null, seedLabel = null, chain = null })
{
    // Where a seed is said to land: a moved key goes to .variables (writeSettings' split), the rest to this file.
    const seedAt = (key) => (seedLabel ? seedLabel(key) : label);
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
    const heldHere = (key) => Boolean(held) && isStackKey(key) && key in held;
    const present = (key) => key in env || key in beneath;
    // Where a decision about `key` lands: the overlay when it holds the key, else this file.
    // A decision's line names the file the value lands in: a moved key's is .variables (seedLabel), as its seed line says.
    const at = (key) => (heldHere(key) ? { into: held, lab: overlayLabel, mine: false } : { into: env, lab: seedAt(key), mine: true });

    if (foldEnv(env, migrations, log, label, { alsoInto: held, alsoLabel: overlayLabel })) changed = true;
    // A line names the file the value lands in (seedAt): a moved key's is .variables, the settings file only reads it.
    if (offWithTiers(env, migrations, log, label, { stackWrote, absentOk: (key) => !present(key) && !(held && key in held), labelOf: seedAt })) changed = true;
    if (retireAndReseed(env, migrations, log, label, undefined, stackWrote, seedAt)) changed = true;

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

    // F10 (the 2026-10-28 workspace run): a linked child (`chain`, the members' values) given the value the workspace
    // already hands it writes nothing - an own copy would freeze it against a later change at the root. A key no member
    // sets is handed the catalog default, which the hooks read then; an `ignore env` key is the child's own (seeded below).
    const fromChain = (key, flag, value) =>
    {
        if (!chain || (chain.ignored || []).includes(key)) return false;
        const handed = Object.hasOwn(chain.values, key) ? chain.values[key] : String((catalog.find((r) => r.key === key) || {}).default ?? '');
        if (handed !== value) return false;
        const { into, lab, mine } = at(key);
        if (Object.hasOwn(into, key)) { delete into[key]; if (mine) changed = true; }
        log(`  ${lab} env: ${key} '${value}' comes from the workspace - nothing written (the --${flag} answer equals it)`);
        return true;
    };

    // 3d. COMPACT INSTEAD OF A FRESH SESSION (`--auto-compact on|off`, setup's screen-B answer), written over a value
    // already there; without the flag the absent-only seed below writes `0`. The window pass
    // in writeSettings reads the value this leaves.
    if (autoCompact && autoCompact.value && !fromChain('ALFRED_CODE_AUTO_COMPACT', 'auto-compact', autoCompact.value))
    {
        const { into, lab, mine } = at('ALFRED_CODE_AUTO_COMPACT');
        const old = into.ALFRED_CODE_AUTO_COMPACT;
        if (old !== autoCompact.value) { into.ALFRED_CODE_AUTO_COMPACT = autoCompact.value; if (mine) changed = true; }
        log(`  ${lab} env: ALFRED_CODE_AUTO_COMPACT ${old === undefined ? 'absent' : `'${old}'`} -> '${autoCompact.value}'`
            + ` (--auto-compact${old === autoCompact.value ? ', unchanged' : ''})`);
    }

    // 3e. WHICH MEMORY (`--memory default|docs|custom`, init's and configure's answer), written over a value already there like
    // 3d; without the flag the absent-only seed below writes `default`. writeSettings' memory pass reads the value this leaves.
    if (memory && memory.value && !fromChain('ALFRED_CODE_MEMORY', 'memory', memory.value))
    {
        const { into, lab, mine } = at('ALFRED_CODE_MEMORY');
        const old = into.ALFRED_CODE_MEMORY;
        if (old !== memory.value) { into.ALFRED_CODE_MEMORY = memory.value; if (mine) changed = true; }
        log(`  ${lab} env: ALFRED_CODE_MEMORY ${old === undefined ? 'absent' : `'${old}'`} -> '${memory.value}'`
            + ` (--memory${old === memory.value ? ', unchanged' : ''})`);
    }

    // 4. SEEDS - absent-only, from the catalog, which is the one list. `seeds` narrows them: a joined child seeds only what
    // it owns (workspace roles and variables, D5) - the chain hands it the rest.
    for (const row of catalog)
    {
        if (row.written) continue;                       // step 5 owns these
        if (row.seed === false) continue;                // never written: the launch env or a hand-set value only
        if (seeds && !seeds(row.key)) continue;
        if (row.key === 'ALFRED_CODE_AUTO_COMPACT' && autoCompact && autoCompact.value && !heldHere(row.key)) continue;   // decided above
        if (row.key === 'ALFRED_CODE_MEMORY' && memory && memory.value && !heldHere(row.key)) continue;                  // decided above
        if (row.key === 'ALFRED_CODE_DOCS_VERSIONING') continue;   // a decision, below
        if (row.key === 'ALFRED_CODE_HOOKS_OFF') continue;         // answered-wins, below
        if (present(row.key)) continue;
        env[row.key] = row.default;
        changed = true;
        log(`  ${seedAt(row.key)} env: ${row.key} seeded (${row.default === '' ? 'empty' : row.default})`);
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
        log(`  ${seedAt('ALFRED_CODE_DOCS_VERSIONING')} env: ALFRED_CODE_DOCS_VERSIONING seeded (${docsVersioning.seed})`);
    }

    // ALFRED_CODE_HOOKS_OFF: a walk that answered the hooks layer THIS run wins over the stored
    // value - the one exception to absent-only, because the user is looking at the question. The walk answers HOOKS, so a
    // stored `<hook>:<part>` entry (a part switched off, hook-prelude.js partOff) is no part of its answer and is kept.
    if (hooksAnswered)
    {
        const { into, lab, mine } = at('ALFRED_CODE_HOOKS_OFF');
        // The stored list is the one that applies: this file's, else the one beneath (a user's off-list an older release
        // left in settings.json stays there, changed since) - an answer equal to it writes no shadowing copy.
        const own = Object.hasOwn(into, 'ALFRED_CODE_HOOKS_OFF');
        const stored = own ? into.ALFRED_CODE_HOOKS_OFF : beneath.ALFRED_CODE_HOOKS_OFF;
        const parts = String(stored || '').split(',').map((x) => x.trim()).filter((x) => x.indexOf(':') > 0).map((x) => renamedHooks[csvEntryKey(x)] || x);
        const off = parts.reduce(addCsvEntry, (hooksOff || []).join(','));
        if (!own && typeof stored === 'string' && stored === off) { /* applies already from the file beneath */ }
        else if (into.ALFRED_CODE_HOOKS_OFF !== off)
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
            const now = was.split(',').map((h) => { const bare = csvEntryKey(h); return Object.hasOwn(renamedHooks, bare) ? renamedHooks[bare] : h; }).join(',');
            if (now !== was) { into.ALFRED_CODE_HOOKS_OFF = now; if (mine) changed = true; log(`  ${lab} env: ALFRED_CODE_HOOKS_OFF = ${now} (a renamed hook re-spelled)`); }
        }
        if (!present('ALFRED_CODE_HOOKS_OFF'))
        {
            env.ALFRED_CODE_HOOKS_OFF = '';
            changed = true;
            log(`  ${label} env: ALFRED_CODE_HOOKS_OFF seeded (empty - every hook runs)`);
        }
    }

    return changed;
}

// A skill a release RENAMED keeps the user's `skillOverrides` value under its new name - a value
// already set under the new name wins, and the old key goes either way.
// A MERGE (spec 5.2, 2026-10-29): several old skills became the parts of one, so first-wins would let one part's 'off'
// switch off all of them. The value crosses only when every part has a spelling present in `o` and every present
// spelling holds the same value; `olds` are the present spellings, removed either way. Only a spelling with a topic row
// is a part's old name: one with none is an older name of the merged skill itself and keeps the plain re-key.
const mergedNames = (renamed) => new Set(Object.keys((renamed && renamed.topics) || {}).map((old) => ((renamed && renamed.skills) || {})[old]).filter(Boolean));
// The parts an old name had, by topic row - and the merged skill's own list (`umbrellaParts`), which may name more.
const topicParts = (newName, renamed) => new Set(Object.entries((renamed && renamed.topics) || {}).filter(([old]) => ((renamed && renamed.skills) || {})[old] === newName).map(([, part]) => part));
const partsOf = (newName, renamed) => { const listed = renamed && renamed.parts && renamed.parts[newName]; return Array.isArray(listed) ? new Set(listed) : topicParts(newName, renamed); };
// A part no old name had: no set of old values can ever cover it, so nothing carries.
const noPartSwitch = (newName, renamed) => { const had = topicParts(newName, renamed); return [...partsOf(newName, renamed)].some((part) => !had.has(part)); };
function mergedOverride(o, newName, renamed)
{
    const skills = (renamed && renamed.skills) || {};
    const topics = (renamed && renamed.topics) || {};
    const olds = Object.keys(skills).filter((old) => skills[old] === newName && Object.hasOwn(topics, old) && Object.hasOwn(o, old));
    const parts = partsOf(newName, renamed);
    const present = new Set(olds.map((old) => topics[old]));
    const same = olds.every((old) => isDeepStrictEqual(o[old], o[olds[0]]));
    const carry = olds.length > 0 && same && [...parts].every((part) => present.has(part));
    return carry ? { carry, value: o[olds[0]], olds } : { carry, olds };
}
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const partsWord = (newName, renamed) =>
{
    const n = partsOf(newName, renamed).size;
    return NUMBER_WORDS[n] || String(n);
};
const quoted = (v) => (typeof v === 'string' ? `'${v}'` : JSON.stringify(v));
// An older plain spelling of `to` that `o` holds - the plain-spelling loop's own condition, so a merge line names the value
// that loop is about to set instead of 'unset' (the 3.5.0 review, M1).
const plainSpelling = (o, to, renamed) => Object.keys((renamed && renamed.skills) || {})
    .find((from) => renamed.skills[from] === to && !Object.hasOwn((renamed && renamed.topics) || {}, from) && Object.hasOwn(o, from));

function rekeyOverrides(data, renamed, log, label)
{
    const o = data && data.skillOverrides;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    let changed = false;
    const topics = (renamed && renamed.topics) || {};
    for (const to of mergedNames(renamed))
    {
        const m = mergedOverride(o, to, renamed);
        if (!m.olds.length) continue;
        const kept = Object.hasOwn(o, to);
        const never = noPartSwitch(to, renamed);
        if (!kept && m.carry) o[to] = m.value;
        const plain = kept ? undefined : plainSpelling(o, to, renamed);
        const takes = plain && `it takes ${quoted(o[plain])} from ${plain}`;
        for (const from of m.olds)
        {
            if (never) log(`  !! ${label}: skillOverrides ${from}: ${quoted(o[from])} has no key after the merge - ${to} has no per-part switch; ${kept ? `it stays ${quoted(o[to])}` : takes || 'it stays unset'}`);
            // R129 (burn-down 2026-11-04): a held new key keeps its value - the old one is dropped, never re-keyed
            else if (kept) log(`  ${label}: skillOverrides ${from} (${quoted(o[from])}) dropped - ${to} already holds ${quoted(o[to])}`);
            else if (m.carry) log(`  ${label}: skillOverrides ${from} re-keyed ${to} (the skill was renamed)`);
            else log(`  ${label}: skillOverrides ${from} (${quoted(o[from])}) not carried - ${to} holds ${partsWord(to, renamed)} captures; ${takes || `set ${to} yourself to switch them all`}`);
            delete o[from];
        }
        changed = true;
    }
    // the merge loop ran first: an older plain spelling of a merged skill carries now, unless a part's value got there
    for (const [from, to] of Object.entries((renamed && renamed.skills) || {}))
    {
        if (Object.hasOwn(topics, from) || !Object.hasOwn(o, from)) continue;
        const held = Object.hasOwn(o, to);
        if (held) log(`  ${label}: skillOverrides ${from} (${quoted(o[from])}) dropped - ${to} already holds ${quoted(o[to])}`);
        else { o[to] = o[from]; log(`  ${label}: skillOverrides ${from} re-keyed ${to} (the skill was renamed)`); }
        delete o[from];
        changed = true;
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
        agentDeny = [], agentAllow = [], agentHeld = [],
        mcpOff = [], dropEmptyApprovals = false, catalog = [], migrations = {},
        docsVersioning, docsPath = null, autoCompact = null, memory = null, hooksOff, hooksAnswered = false, inheritedEnv = null, renamed = null,
        inheritedOverrides = null, sharedFile = null, attribution = null, worktreeBase = null, compactWindows = null, ledger = {},
        variablesFile = null, childEnv = null, keepOwn = false, carried = {}, log = () => {}, note = () => {},
    } = opts;
    // R10: the last run's ledger (null - no stamp, or one from before it: the fallback) and the hook
    // wirings the RELEASE writes, whatever this run's selection wires.
    const prior = ledger.prior || null;
    // A seat a release RENAMED (meta/stack-manifest.json `renamed`) loads under its new name only.
    const seatNow = (seat) => ((renamed && renamed.agents) || {})[seat] || seat;

    // M6: every log line names the file this run writes - settings.local.json at local scope.
    const label = path.basename(file);
    let data;
    let fileText;
    try { ({ data, text: fileText } = readSettings(file)); }
    catch (err) { note(err.message); return { written: false, refused: true }; }
    // THE MOVE (workspace roles and variables, D5): `variablesFile` is the project's .variables where this run keeps the
    // stack's variables - null keeps them in this file, as before 3.0.0 (git ignores the data root, a local-scope run over
    // a tracked file, a caller that names none). The file's values join the env every pass below reads, the file winning
    // (D4 step 3 over 4), so the seeds, the migrations and the window and memory passes see one view; after them the
    // moved keys leave this file for .variables, each only once it reads back equal (the one-way gate).
    const vars = variablesFile ? require('./variables.js') : null;
    const { VARIABLE_KEYS, MEMBER_NEVER: NEVER_CHAINED } = require('../../stack/hooks/layout.js');
    const MOVED = new Set(VARIABLE_KEYS);
    const renameFrom = new Set((migrations.renames || []).filter(([, to]) => MOVED.has(to)).map(([from]) => from));
    const movable = (key) => MOVED.has(key) || renameFrom.has(key);
    // A key retired whatever its value is read from .variables too, so the retire pass drops it and the move writes the line
    // out (complexity stage 1 B9: ALFRED_CODE_FORGE_WATCH, seeded there since 3.0.0).
    const retiredAny = new Set((migrations.retired || []).filter(([, onlyWhen]) => onlyWhen == null).map(([key]) => key));
    const settingsEnvBefore = data.env === undefined ? null : JSON.stringify(data.env);
    const settingsHad = new Set(plain(data.env) ? Object.keys(data.env).filter(movable) : []);
    const reseeds = (key) => (migrations.reseed || []).filter(([k]) => k === key).flatMap(([, bad, to]) => [bad, to]);
    const seedsOf = (key) => [...catalog.filter((r) => r.key === key && !r.written && r.seed !== false)
        .flatMap((r) => [String(r.default), ...(r.former_defaults || []).map(String)]), ...reseeds(key),
    ...(key === 'ALFRED_CODE_DOCS_VERSIONING' && docsVersioning && docsVersioning.seed ? [docsVersioning.seed] : [])];
    // Ruling 12: at project and user scope a variable this file held is this machine's own override - set aside, it rides
    // the env pass as its overlay and goes back in place below, never ledgered and never moved. A seed still at the row the
    // stack ledgered here (a .variables the run could not use) is the stack's own and moves - final review finding 2. A key
    // the move carried is not: its row was settings.json's until this run, and the value this file holds is the user's.
    const hereRows = (prior && prior.env && prior.env[label]) || {};
    const stackSeed = (k) => !Object.hasOwn(carried || {}, k) && hereRows[k] === valueHash(data.env[k]) && seedsOf(k).includes(String(data.env[k]));
    const mine = [...settingsHad].filter((k) => !stackSeed(k));
    const own = keepOwn && vars && mine.length ? Object.fromEntries(mine.map((k) => [k, data.env[k]])) : null;
    for (const key of own ? mine : []) delete data.env[key];
    const fileValues = {};
    if (vars && (data.env === undefined || plain(data.env)))
    {
        for (const [key, value] of Object.entries(vars.read(variablesFile).values)) if (movable(key) || retiredAny.has(key)) fileValues[key] = value;
        // The loader's order (D4): settings.local.json over .variables - so a local-scope run's own file keeps a value
        // typed there, and the move carries the value every reader already saw.
        if (Object.keys(fileValues).length) data.env = { ...fileValues, ...(data.env || {}) };
    }
    // The env rows the move took out of settings.json (moveToLocal), under the file's own and .variables' values - but not a
    // row whose name, or the name a rename gives it, settings.json still holds: that value is the user's and applies.
    const renameTo = new Map((migrations.renames || []).map(([from, to]) => [from, to]));
    const renamedTo = (key) => { let k = key; for (let i = 0; i < 8 && renameTo.has(k); i++) k = renameTo.get(k); return k; };
    const typed = plain(inheritedEnv) ? inheritedEnv : {};
    const take = { ...carried };
    for (const key of Object.keys(take).filter((k) => Object.hasOwn(typed, renamedTo(k))))
    {
        log(`  ${label} env: ${key} not carried - settings.json holds ${renamedTo(key)}, which applies`);
        delete take[key];
    }
    if (Object.keys(take).length && (data.env === undefined || plain(data.env))) data.env = { ...take, ...(data.env || {}) };
    const envBefore = plain(data.env) ? { ...data.env } : {};
    // The members' values (D4 step 5) sit under every own layer when the passes below read the windows and the memory switch.
    const memberEnv = childEnv && plain(childEnv.memberEnv) ? childEnv.memberEnv : {};
    // A joined child (workspace.js envPlan): a copy a 2.12 child kept of an inherited value goes - the chain gives it the
    // same value (D4 step 5) - and so do the part entries of its HOOKS_OFF a member's settings hold, which D4 merges back.
    if (childEnv && plain(data.env))
    {
        for (const key of childEnv.copies || []) if (Object.hasOwn(data.env, key))
        { delete data.env[key]; log(`  ${label} env: ${key} removed - a copy of the value the workspace gives this project`); }
        for (const key of childEnv.seeds || []) if (Object.hasOwn(data.env, key))
        { delete data.env[key]; log(`  ${label} env: ${key} removed - a stack seed, so the workspace's value reaches this project`); }
        const drop = new Set(childEnv.hooksOffDrop || []);
        const off = data.env.ALFRED_CODE_HOOKS_OFF;
        if (drop.size && typeof off === 'string')
        {
            const now = off.split(',').map((e) => e.trim()).filter((e) => e && !drop.has(e)).join(',');
            if (now !== off) { data.env.ALFRED_CODE_HOOKS_OFF = now; log(`  ${label} env: ALFRED_CODE_HOOKS_OFF = ${now || '(empty)'} - ${[...drop].join(', ')} come from the workspace at load`); }
        }
    }
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

    // permissions.deny: union-merge the secret-file Read blocks, preserving any the project set. A `permissions` that is
    // not an object, or a `deny` that is not a list, is the user's (R070, final review I2 - it threw, or a null was
    // replaced): named, left as it is, and no deny pass below touches this file; its ledger rows stand as recorded.
    const permsNotObject = Object.hasOwn(data, 'permissions') && !plain(data.permissions);
    const denyRefused = permsNotObject || (plain(data.permissions) && Object.hasOwn(data.permissions, 'deny') && !Array.isArray(data.permissions.deny));
    if (denyRefused) note(`${label}: ${permsNotObject ? 'permissions is not an object' : 'permissions.deny is not a list'} - left as it is; no deny entry is written to it this run`);
    const deny = denyRefused ? null : ((data.permissions ??= {}).deny ??= []);
    if (deny) for (const rule of denySpecs) if (!deny.includes(rule)) { deny.push(rule); changed = true; }
    // Entries this stack once wrote and no longer does: drop exactly those strings, so an update
    // clears what an older install seeded. A project's own entry is never touched.
    if (deny) for (const rule of [...deny]) if (retiredDeny.includes(rule))
    { deny.splice(deny.indexOf(rule), 1); changed = true; log(`  ${label}: dropped retired deny entry ${rule}`); }
    // A renamed seat's core deny is re-spelled in place, so the user's switch-off holds under the new
    // name; the read-back already read it that way (selection.js renameDeny). The stale-row pass runs it over settings.json too.
    const respell = (list, lab) => [...list].filter((entry) =>
    {
        const m = /^Agent\(([a-z0-9-]+):([A-Za-z0-9_-]+)\)$/.exec(entry);
        if (!m || m[1] !== BRAND.core || seatNow(m[2]) === m[2]) return false;
        const now = `Agent(${BRAND.core}:${seatNow(m[2])})`;
        if (list.includes(now)) list.splice(list.indexOf(entry), 1);
        else list[list.indexOf(entry)] = now;
        log(`  ${lab}: ${entry} re-spelled ${now} (the seat was renamed)`);
        return true;
    }).length > 0;
    if (deny && respell(deny, label)) changed = true;
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
        if (deny) for (const entry of [...deny]) if (entry !== keep && seat && stackSeat(entry) === seat)
        { deny.splice(deny.indexOf(entry), 1); changed = true; log(entry === rule ? `  ${label}: agent allowed again ${entry}` : `  ${label}: agent entry dropped ${entry} (the seat's old spelling)`); }
    };
    for (const rule of agentDeny)
    {
        dropSeat(rule, rule);
        if (deny && !deny.includes(rule)) { deny.push(rule); changed = true; log(`  ${label}: agent denied ${rule}`); }
    }
    for (const rule of agentAllow) dropSeat(rule, null);
    // Workspace stage 3: a seat a member below picked - the stack's own deny row for it goes, a row it never wrote is the user's.
    for (const rule of deny ? deny.filter((e) => agentHeld.includes(stackSeat(e))) : [])
    {
        if (!((prior && prior.deny) || []).some((d) => d.file === label && d.entry === rule)) { log(`  seat ${stackSeat(rule)} stays off here: your own deny row`); continue; }
        deny.splice(deny.indexOf(rule), 1);
        changed = true;
        log(`  ${label}: agent allowed again ${rule} - a member below picked it`);
    }

    // enabledMcpjsonServers: an earlier release pre-approved the .mcp.json servers it registered. The stack registers
    // none since 2.10.1, so the names it wrote leave (`mcpOff` - a name the user's own .mcp.json row holds is not
    // passed): a leftover entry names a server that no longer exists - dead config that reads like a working knob.
    // A list this run empties goes; the user's own entries stay. disabledMcpjsonServers the same: an engine left off was
    // registered AND named there. The stale-row pass runs it over settings.json too.
    const approvals = (obj, lab) =>
    {
        let touched = false;
        for (const listKey of ['enabledMcpjsonServers', 'disabledMcpjsonServers'])
        {
            if (!Array.isArray(obj[listKey])) continue;
            const list = obj[listKey];
            let dropped = false;
            for (const name of mcpOff) if (list.includes(name))
            { list.splice(list.indexOf(name), 1); touched = dropped = true; log(`  ${lab}: dropped ${listKey} entry ${name} (no longer registered here)`); }
            if (dropped && !list.length) delete obj[listKey];
            // Every release before 2.10.1 created enabledMcpjsonServers on each write, an empty one on the plugin route, so on
            // the first update past the retirement an empty list is the stack's and goes, as uninstall takes it. An empty
            // disabledMcpjsonServers was never the stack's (R116), so it stays.
            else if (!dropped && !list.length && dropEmptyApprovals && listKey === 'enabledMcpjsonServers')
            { delete obj[listKey]; touched = true; log(`  ${lab}: dropped the empty enabledMcpjsonServers list an earlier release created`); }
        }
        return touched;
    };
    if (approvals(data, label)) changed = true;

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
    // Ruling 10: the override rides applyEnv's overlay, so a rename or a retire reaches it and a flag's decision lands in it.
    const overlay = own;
    // The ledger row of a key in a file - under the name it had before this run's renames, when it was renamed. A file the
    // ledger holds no env for (no stamp, or one from before the ledger) leaves the reseed to the value match, as it was.
    const stackWrote = (fileLabel, key, value) =>
    {
        const held = prior && prior.env ? prior.env : {};
        // A moved key's row sits under .variables; this run's own file reads both.
        const rows = held[fileLabel] || (vars && fileLabel === label && held['.variables'])
            ? { ...(held[fileLabel] || {}), ...(vars && fileLabel === label ? held['.variables'] || {} : {}) } : null;
        if (!rows) return true;
        const names = [key, ...(migrations.renames || []).filter(([, to]) => to === key).map(([from]) => from)];
        return names.some((n) => rows[n] === valueHash(value));
    };
    if (applyEnv((data.env ??= {}), { catalog, migrations, docsVersioning, docsPath, autoCompact, memory, hooksOff, hooksAnswered,
        renamedHooks: (renamed && renamed.hooks) || {}, inherited: inheritedEnv, overlay, log, label, overlayLabel: label, stackWrote,
        seeds: childEnv ? (key) => !MOVED.has(key) || NEVER_CHAINED.has(key) || (childEnv.ignored || []).includes(key) : null, seedLabel: vars ? (key) => (MOVED.has(key) || Object.hasOwn(fileValues, key) ? '.variables' : label) : null,
        chain: childEnv && childEnv.linked ? { values: memberEnv, ignored: childEnv.ignored || [] } : null }) && !vars) changed = true;
    // D5: a decision for a key settings.local.json holds lands there, where it takes effect over .variables - said so.
    const overrides = new Set();
    const overridden = (key) => { if (!overrides.has(key)) { overrides.add(key); log(`  variables: ${key} set in .claude/settings.local.json (it overrides .variables here)`); } };
    if (vars && overlay)
        for (const [key, flag] of [['ALFRED_CODE_AUTO_COMPACT', autoCompact], ['ALFRED_CODE_MEMORY', memory], ['ALFRED_CODE_DOCS_VERSIONING', docsVersioning]])
            if (flag && flag.value && Object.hasOwn(overlay, key)) overridden(key);
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
        const sibling = plain(compactWindows.inherited) ? compactWindows.inherited : {};
        const account = plain(compactWindows.account) ? compactWindows.account : {};
        const topLevel = (o) => plain(o) && o.autoCompactWindow !== undefined;
        const named = (o, id) => plain(o) && plain(o.modelSettings) && plain(o.modelSettings[id]) && o.modelSettings[id].autoCompactWindow !== undefined;
        const held = (id) =>
        {
            const entry = plain(data.modelSettings) ? data.modelSettings[id] : undefined;
            return plain(entry) && Object.hasOwn(entry, 'autoCompactWindow') && Boolean(acwPrior)
                && acwPrior[compactAt(id)] === valueHash(JSON.stringify(entry.autoCompactWindow));
        };
        const env = { ...memberEnv, ...(plain(inheritedEnv) ? inheritedEnv : {}), ...(plain(data.env) ? data.env : {}), ...(overlay || {}) };
        // Only where the project compacts instead of offering a fresh session (ALFRED_CODE_AUTO_COMPACT=1, seeded `0`): with
        // the offers on, a window at the trigger would compact the session before the offer could reach anyone.
        const compacts = String(env.ALFRED_CODE_AUTO_COMPACT || '').trim() === '1';
        const seeds = !compacts || topLevel(data) || topLevel(sibling) || topLevel(account) ? {} : compactWindowSeeds(compactWindows.models, env);
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
    // works against the mode. The env as this run leaves it, the way the window pass reads it, the override first (Ruling 13).
    let memOwned = false;
    {
        const memPrior = prior && prior.settings ? prior.settings[label] || {} : null;
        const env = { ...memberEnv, ...(plain(inheritedEnv) ? inheritedEnv : {}), ...(plain(data.env) ? data.env : {}), ...(overlay || {}) };
        const custom = env.ALFRED_CODE_MEMORY === 'custom';
        const has = Object.hasOwn(data, 'autoMemoryEnabled');
        const ours = has && Boolean(memPrior) && memPrior.autoMemoryEnabled === valueHash(JSON.stringify(data.autoMemoryEnabled));
        // A value of the user's own is named on the run that answers the question or drops the stack's row, not on every run.
        const say = Boolean(memory && memory.value) || Boolean(memPrior && Object.hasOwn(memPrior, 'autoMemoryEnabled'));
        if (custom && !has)
        {
            data.autoMemoryEnabled = false;
            memOwned = changed = true;
            log(`  ${label}: autoMemoryEnabled: false written - ALFRED_CODE_MEMORY is custom, so Claude's own memory is off and your ranked memory tool`
                + ' holds the lessons');
        }
        else if (custom && ours) memOwned = true;
        else if (custom && data.autoMemoryEnabled === true && say)
            log(`  ${label}: autoMemoryEnabled: true kept - yours; custom memory needs it off, so Claude's own memory stays on beside your memory tool`);
        else if (!custom && ours)
        {
            delete data.autoMemoryEnabled;
            changed = true;
            log(`  ${label}: autoMemoryEnabled: false removed - ALFRED_CODE_MEMORY is no longer custom, so Claude's own memory is back on`);
        }
        else if (!custom && data.autoMemoryEnabled === false && say)
            log(`  ${label}: autoMemoryEnabled: false kept - yours; native memory needs it on, so Claude's own memory stays off until you remove it`);
    }
    // R10: the ledger pass, over the env of each file this run writes, the deny lists and the wirings.
    const releaseEnv = new Set(catalog.map((r) => r.key));
    const writtenNow = {};
    const priorEnv = (name) => (prior && prior.env ? prior.env[name] || {} : null);
    const managedEnv = {};
    const kept = docsPath && docsPath.keep ? ['ALFRED_CODE_DOCS_PATH'] : [];
    // The moved keys' rows sit under .variables since the move: read with this file's, written back there below.
    const priorHere = vars && priorEnv(label) ? { ...priorEnv(label), ...priorEnv('.variables') } : priorEnv(label);
    const envShared = ledgerEnv({ name: label, env: data.env, before: envBefore, prior: priorHere, release: releaseEnv, seedsOf, written: writtenNow, kept, migrations, log });
    if (envShared.changed && !vars) changed = true;
    managedEnv[label] = envShared.managed;
    // R098: the keys this file held before the run, under the names the env pass renamed them to
    // What a failed .variables write keeps in this file: the stack's rows it held, and the rows the move carried out of
    // settings.json - those are in no other file now (final review finding 1).
    const heldKeys = new Set([...settingsHad].filter((k) => !own || !Object.hasOwn(own, k)).concat(Object.keys(take).filter(movable)).map(renamedTo));
    const moved = vars ? moveVariables({ vars, file: variablesFile, env: data.env, fileValues, MOVED, catalog, managedEnv, label, log,
        heldKeys, wait: keepOwn }) : [];
    // The override goes back as it was typed, in its place, with no ledger row; a key the env pass renamed goes last.
    const placed = own ? Object.keys(JSON.parse(settingsEnvBefore)).filter((k) => k in own || k in data.env) : [];
    if (own) data.env = { ...Object.fromEntries(placed.map((k) => [k])), ...data.env, ...own };
    if (vars)
    {
        if (settingsEnvBefore === null && plain(data.env) && !Object.keys(data.env).length) delete data.env;
        if ((data.env === undefined ? null : JSON.stringify(data.env)) !== settingsEnvBefore) changed = true;
    }
    const priorDeny = prior && prior.deny ? prior.deny : null;
    const ownDeny = (entry) => denySpecs.includes(entry) || Boolean(stackSeat(entry));
    // Only an entry some release shipped: the stamp is project text, never a deny rule of the user's.
    const shippedGone = (x) => x.file === label && !ownDeny(x.entry) && deny.includes(x.entry) && (ledger.shippedDeny || []).includes(x.entry);
    for (const d of deny && priorDeny ? priorDeny.filter(shippedGone) : [])
    {
        deny.splice(deny.indexOf(d.entry), 1);
        changed = true;
        log(`  ${label}: deny ${d.entry} removed - the stack wrote it and this release no longer does`);
    }
    // An entry already there is the stack's only when the ledger recorded it IN THIS FILE: the same string
    // recorded for the other file (a local-scope install's own, before a move) never claims the team's
    // copy (review finding 1). With no ledger a secret-file deny is never claimed - it may be the team's,
    // and a leftover after uninstall is harmless where a removed one is not (finding 6); a stack seat is.
    const managedDeny = deny ? deny.filter((entry) => !denyBefore.includes(entry)
        || (priorDeny ? priorDeny.some((d) => d.file === label && d.entry === entry) : Boolean(stackSeat(entry)))).map((entry) => ({ file: label, entry }))
        : (priorDeny || []).filter((d) => d.file === label);
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
    const managed = { file: label, env: managedEnv, deny: managedDeny, hooks: managedHooks,
        settings: Object.keys(managedAttr).length ? { [label]: managedAttr } : {} };

    // C3 (R133 b): at local scope settings.json is never written, so an old key there cannot be re-keyed;
    // its value is set under the new name in THIS file - the deny half's shape - and the entry is named.
    if (inheritedOverrides && typeof inheritedOverrides === 'object' && !Array.isArray(inheritedOverrides))
    {
        // A part's old name (spec 5.2: a topic row) takes the same both-hold test over the old keys settings.json holds,
        // all at once, before any older plain spelling of the merged skill - the order the project-scope pass keeps.
        const topics = (renamed && renamed.topics) || {};
        const entries = Object.entries((renamed && renamed.skills) || {});
        const said = new Set();
        for (const [from, to] of [...entries.filter(([old]) => Object.hasOwn(topics, old)), ...entries.filter(([old]) => !Object.hasOwn(topics, old))])
        {
            const part = Object.hasOwn(topics, from);
            if (!Object.hasOwn(inheritedOverrides, from) || Object.hasOwn(inheritedOverrides, to) || (part && said.has(to))) continue;
            const mine = (data.skillOverrides && typeof data.skillOverrides === 'object' && !Array.isArray(data.skillOverrides)) ? data.skillOverrides : null;
            if (mine && Object.hasOwn(mine, to)) continue;
            if (data.skillOverrides !== undefined && !mine) break;
            const m = part ? mergedOverride(inheritedOverrides, to, renamed) : { carry: true, value: inheritedOverrides[from], olds: [from] };
            if (part) said.add(to);
            if (!m.carry)
            {
                const never = noPartSwitch(to, renamed);
                // an older plain spelling settings.json holds is set below, in this file, by the same loop
                const plain = plainSpelling(inheritedOverrides, to, renamed);
                const takes = plain && `${to} takes ${quoted(inheritedOverrides[plain])} from ${plain} in ${label}`;
                for (const old of m.olds)
                    log(never
                        ? `  !! ${label}: settings.json still names skillOverrides ${old} (${quoted(inheritedOverrides[old])}) - it has no key after the merge, ${to} has no per-part switch; ${takes || `nothing set in ${label}`}`
                        : `  ${label}: settings.json still names skillOverrides ${old} (${quoted(inheritedOverrides[old])}) - not carried, ${to} holds ${partsWord(to, renamed)} captures; ${takes || `nothing set in ${label} - a project-scope update applies the rule there`}`);
                continue;
            }
            (data.skillOverrides ??= {})[to] = m.value;
            changed = true;
            for (const old of m.olds)
                log(`  ${label}: settings.json still names skillOverrides ${old} - set as ${to} in ${label}; a local-scope run never writes settings.json, a project-scope update re-keys it`);
        }
    }
    // The run writes settings.local.json, but the stack's OWN stale rows may sit in the shared settings.json an older install
    // wrote: its hook wiring (a hook file this route no longer copies, run on every call), its 1.x env keys and a renamed
    // skill's skillOverrides key (Ruling 14). Those go or are re-keyed - by file name and by key, never a hook or key the
    // user wrote. Nothing is added to the shared file; an unreadable one is left as it is.
    if (sharedFile && sharedFile !== file && fs.existsSync(sharedFile))
    {
        let shared = null;
        let sharedText = null;
        try { ({ data: shared, text: sharedText } = readSettings(sharedFile)); }
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
            if (!inheritedOverrides) rekeyOverrides(shared, renamed, log, sharedName);
            // At project and user scope the team file was the stack's until this stage: the docs step's removal, a retired
            // server's approval and a renamed seat's deny still reach what an older install left there.
            if (keepOwn && docsPath && docsPath.remove && plain(shared.env) && Object.hasOwn(shared.env, 'ALFRED_CODE_DOCS_PATH'))
            {
                log(`  ${sharedName} env: ALFRED_CODE_DOCS_PATH '${shared.env.ALFRED_CODE_DOCS_PATH}' removed (${docsPath.why})`);
                delete shared.env.ALFRED_CODE_DOCS_PATH;
            }
            if (keepOwn) approvals(shared, sharedName);
            if (keepOwn && plain(shared.permissions) && Array.isArray(shared.permissions.deny)) respell(shared.permissions.deny, sharedName);
            if (JSON.stringify(shared) !== before)
            {
                fs.writeFileSync(sharedFile, stringifyLike(shared, formatOf(sharedText)));
                log(`  ${sharedName}: the stack's stale rows removed (the stack writes ${label})`);
            }
        }
    }

    // The keys this file held before the run and no longer holds - each now in .variables (a renamed one under its new name).
    // What left a settings file for .variables: this file's own variables (at local scope) and the rows the move carried.
    const fromSettings = new Set([...[...settingsHad].filter((k) => !own || !Object.hasOwn(own, k)), ...Object.keys(take).filter(movable)]);
    const variablesMoved = moved.length ? [...fromSettings].filter((k) => !(plain(data.env) && Object.hasOwn(data.env, k))) : [];
    if (!changed) return { written: false, refused: false, managed, variablesMoved };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, stringifyLike(data, formatOf(fileText)));
    return { written: true, refused: false, managed, variablesMoved };
}

// The split (D5, the one-way gate): every moved key in `env` is written to .variables - a key the file held that the env
// pass renamed or retired leaves it - and read back; each key that reads back equal leaves `env`, its ledger row moving
// under .variables. A value .variables cannot hold (it spans lines) or that reads back otherwise stays in the settings
// file, out of .variables (where it would win, D4 step 3), and so does every key when the file cannot be written; one
// `!!` line names them. Returns the keys that left `env`.
function moveVariables({ vars, file, env, fileValues, MOVED, catalog, managedEnv, label, log, heldKeys = new Set(), wait = false })
{
    const layout = require('../../stack/hooks/layout.js');
    const want = {};
    for (const [key, value] of Object.entries(plain(env) ? env : {})) if (MOVED.has(key)) want[key] = String(value);
    const unfit = Object.keys(want).filter((key) => /[\r\n]/.test(want[key]));
    const updates = {};
    for (const key of Object.keys(fileValues)) if (!Object.hasOwn(want, key)) updates[key] = null;
    for (const key of unfit) if (Object.hasOwn(fileValues, key)) updates[key] = null;
    for (const [key, value] of Object.entries(want)) if (!unfit.includes(key) && fileValues[key] !== value) updates[key] = value;
    const order = catalog.map((r) => r.key);
    const done = Object.keys(updates).length ? vars.write(file, updates, { order }) : { changed: false };
    const rel = path.join(path.basename(path.dirname(file)), path.basename(file)).split(path.sep).join('/');
    // R098 (burn-down 2026-11-04): a lock another run holds passes; only the keys this file already held stay in it, and the
    // rest wait for the next run - keeping every key had seeded all of them into the settings file. A file that cannot be
    // written keeps every key here, its one home - unless the run `wait`s (the local file at project and user scope, Ruling 12).
    if (done.why === 'locked' || (wait && done.why))
    {
        const waiting = Object.keys(want).filter((key) => !heldKeys.has(key));
        for (const key of waiting) { delete env[key]; if (managedEnv[label]) delete managedEnv[label][key]; }
        const kept = Object.keys(want).filter((key) => heldKeys.has(key));
        log(`  !! variables: ${rel} is ${done.why === 'locked' ? 'locked by another run' : 'not writable'} - nothing moved; ${kept.length
            ? `${kept.join(', ')} stay in ${label}, ` : ''}${waiting.length} key(s) wait for the next update - run it again`);
        return [];
    }
    if (done.why)
    {
        log(`  !! variables: ${rel} is not writable - the keys are kept in ${label}; run the update again`);
        return [];
    }
    const back = (layout.readDotenv(file) || {}).values || {};
    const off = Object.keys(want).filter((key) => !unfit.includes(key) && back[key] !== want[key]);
    if (off.length) vars.write(file, Object.fromEntries(off.map((key) => [key, null])), { order });
    const keep = [...unfit, ...off];
    if (keep.length) log(`  !! variables: ${keep.join(', ')} kept in ${label} - ${rel} could not hold ${keep.length === 1 ? 'its value' : 'their values'} as written (one line, read back equal)`);
    const rows = managedEnv[label] || {};
    // Catalog order, so the ledger's rows read the same whichever order the settings file held the keys in.
    const moved = Object.keys(want).filter((key) => !keep.includes(key)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    managedEnv['.variables'] = {};
    for (const key of moved)
    {
        delete env[key];
        if (Object.hasOwn(rows, key)) { managedEnv['.variables'][key] = rows[key]; delete rows[key]; }
    }
    return moved;
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
    let fileText;
    try { ({ data, text: fileText } = readSettings(file)); }
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
    fs.writeFileSync(file, stringifyLike(data, formatOf(fileText)));
    return { added, lifted };
}

// T16/R47 (I1): the ONE place that decides which file THIS run's own settings writes go to - a
// `local`-scope install's stack settings (and, per R47, its `autoMemoryEnabled` switch-off) are
// machine-personal, so they go to settings.local.json; every other scope keeps the shared file. Every
// write site names this helper instead of its own ternary, so the three call sites (writeSettings'
// own target, the memory import gate/switch-off, the --installed-only read-back) cannot drift apart.
const settingsTarget = (claudeDir, scope) => path.join(claudeDir, scope === 'local' ? 'settings.local.json' : 'settings.json');

// '' when the stack may write the local settings file, else why not: a read error or a folder there, a parse or shape error,
// a file the repository owns, a file or nearest folder the run cannot write (Ruling 3).
function localUnusable(file)
{
    try { readSettings(file); } catch (e) { return /could not be read/.test(e.message) ? 'not writable' : 'not valid JSON'; }
    if (require('./variables.js').tracked(file)) return 'tracked by git - git rm --cached it';
    let at = file;
    while (!fs.existsSync(at) && path.dirname(at) !== at) at = path.dirname(at);
    try { fs.accessSync(at, fs.constants.W_OK); return ''; } catch { return 'not writable'; }
}

// The settings files here that exist but do not parse - readBackSettings reads each as {} without a word, so a plan-out
// built on it would look like a set with nothing in it.
function unreadableSettings(claudeDir)
{
    return ['settings.json', 'settings.local.json'].filter((name) =>
    {
        let text;
        try { text = fs.readFileSync(path.join(claudeDir, name), 'utf8'); } catch { return false; }
        try { parseJson(text); return false; } catch { return true; }
    });
}

// What the read-backs read, fail-soft (an unreadable file reads as empty). At project and user scope, settings.json
// alone - the inherited view the writer's N6 rule and R98's docs root read (the stack's own rows sit in
// settings.local.json at every scope since mode v2 stage 2, and the read-back that sees them passes 'local'). At local
// scope settings.local.json is laid over settings.json (N5) for the two keys the read-back uses: `env` key by key with
// local winning, and `permissions.deny` combined. Every other key is the local file's whole where it has one -
// `permissions.allow` / `ask` / `additionalDirectories`, `enabledPlugins`, `hooks` included - so this is NOT the view
// Claude Code resolves, which combines every list across files: a caller that reads more than `env` and `deny` needs
// its own merge.
function readBackSettings(claudeDir, scope)
{
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    const read = (name) => { try { return obj(parseJson(fs.readFileSync(path.join(claudeDir, name), 'utf8'))); } catch { return {}; } };
    if (scope !== 'local') return read('settings.json');
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

// R78 (Task 16 round 5), mode v2 stage 2: an install moved from `local` scope to project or user scope. The stack's rows
// stay in settings.local.json - its file at every scope since stage 2 - so nothing moves into settings.json. Only the
// stack's VARIABLES are judged: at project and user scope a variable this file holds is the machine's override (Ruling 12),
// so a seed the stack wrote here (the ledger exactly; with no ledger the seed match, any value it shipped - N2) goes and
// .variables carries it; any other value stays, named by its length only (N3). A variable a local run kept in `.variables`
// that is not the stack's seed is the user's and comes here, where it still reads over .variables (D4) - the team reads
// `.variables` from here on. `renames` reads an older release's spelling as its new name. A file that cannot be read moves
// nothing.
const ENV_PREFIX = 'ALFRED_CODE_';
function leaveLocalScope({ claudeDir, seeds = {}, renames = [], ledgerEnv: recorded = null, variablesFile = null, ledgerVariables = null,
    log = () => {}, note = () => {} })
{
    const localFile = path.join(claudeDir, 'settings.local.json');
    if (!fs.existsSync(localFile)) return { moved: false };
    let local;
    let localText;
    try { ({ data: local, text: localText } = readSettings(localFile)); }
    catch (err) { note(`scope move: ${err.message} - the stack's local entries stay where they are`); return { moved: false, refused: true }; }
    const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
    const say = (m) => log(`  settings.local.json: ${m}`);
    const renameTo = new Map(renames);
    const now = (key) => { let k = key; for (let i = 0; i < 8 && renameTo.has(k); i++) k = renameTo.get(k); return k; };
    const isVar = (key) => require('../../stack/hooks/layout.js').VARIABLE_KEYS.includes(now(key));
    const seeded = (key, v) => Object.hasOwn(seeds, now(key)) && [].concat(seeds[now(key)]).includes(v);
    let changed = false;
    const lifted = [];
    const vars = variablesFile ? require('./variables.js') : null;
    for (const [key, v] of Object.entries(vars && fs.existsSync(variablesFile) ? vars.read(variablesFile).values : {}))
    {
        if (!key.startsWith(ENV_PREFIX) || !isVar(key)) continue;
        if (seeded(key, v) && (!ledgerVariables || ledgerVariables[key] === valueHash(v))) continue;
        if (!isObj(local.env)) local.env = {};
        if (!Object.hasOwn(local.env, key)) local.env[key] = v;
        lifted.push(key);
        changed = true;
    }
    if (lifted.length) say(`${lifted.join(', ')} moved here from ${path.basename(path.dirname(variablesFile))}/.variables - git tracks that file from here on, and a value of yours stays this machine's own`);
    const env = isObj(local.env) ? local.env : null;
    // C18 (R98): the seeds leave as ONE line - a count and the keys - not a line per key.
    const seedsGone = [];
    for (const key of Object.keys(env || {}).filter((k) => k.startsWith(ENV_PREFIX) && isVar(k) && !lifted.includes(k)))
    {
        // R10: a stale seed is one the stack WROTE here (the ledger, exact - a seed value the user typed is theirs).
        if (seeded(key, env[key]) && (!recorded || recorded[key] === valueHash(env[key]))) { seedsGone.push(key); delete env[key]; changed = true; }
        else say(`${key} stays here (your value, ${String(env[key]).length} chars) - it applies over .variables, and later runs leave it here`);
    }
    if (env && !Object.keys(env).length) delete local.env;
    if (seedsGone.length)
        say(`${seedsGone.length} stack variable${seedsGone.length === 1 ? '' : 's'} removed - each held the stack's own seed, `
            + `so .variables' value or its seed applies from here on: ${seedsGone.join(', ')}`);
    if (!changed) return { moved: false };
    fs.writeFileSync(localFile, stringifyLike(local, formatOf(localText)));
    if (lifted.length)
    {
        const done = vars.write(variablesFile, Object.fromEntries(lifted.map((key) => [key, null])));
        if (done.why) say(`!! ${lifted.join(', ')} still in .variables too (${done.why}) - settings.local.json reads over it; run the update again`);
    }
    return { moved: true };
}

// The same for `<data root>/.variables`, where the stack's variables sit since 3.0.0 (workspace roles and variables, D5):
// each ledgered row at its recorded value goes, a changed one is the user's and stays; a file left empty goes. At local
// scope a file git tracks is the team's and is never written.
function removeManagedVariables({ file, rows, scope, log, note })
{
    if (!file || !Object.keys(rows).length || !fs.existsSync(file)) return;
    const vars = require('./variables.js');
    if (scope === 'local' && vars.tracked(file)) return;
    const held = vars.read(file).values;
    const drop = {};
    for (const [key, hash] of Object.entries(rows))
    {
        if (!Object.hasOwn(held, key)) continue;
        if (valueHash(held[key]) !== hash) { log(`  .variables env: ${key} kept - changed since the stack wrote it, so it is yours (${String(held[key]).length} chars)`); continue; }
        drop[key] = null;
    }
    if (!Object.keys(drop).length) return;
    const done = vars.write(file, drop);
    if (done.why) { note(`.variables could not be written (${done.why}) - the stack's keys stay in it`); return; }
    if (!fs.readFileSync(file, 'utf8').trim()) fs.rmSync(file);
}

// R10 UNINSTALL, the settings half: every env key, deny entry and hook wiring the ledger lists for a
// file, at the value it recorded - a value changed since is the user's and stays, said by its length
// only. The .mcp.json approvals of the servers uninstall removed go with them. A file the ledger names
// that is left holding nothing goes (an empty list the stack or the plugin CLI left there with it); one
// it names nothing in is never tidied or deleted (review finding 12), and one that cannot be read is
// left exactly as it is.
// `only` (mode v2 stage 2's move, moveToLocal): that one file, never deleted or tidied, no summary line; returns the rows removed.
function removeManagedSettings({ claudeDir, ledger = {}, shippedDeny = [], mcpRemoved = [], scope = 'project', variablesFile = null, only = null,
    log = () => {}, note = () => {} })
{
    // Review finding 8: at user scope the core's user-scope row is printed, never removed, so it stays
    // loaded here - a seat denied and the hooks named off keep what the user switched off off.
    const offState = (key) => scope === 'user' && (key === 'ALFRED_CODE_HOOKS_OFF' || Boolean(stackSeat(key)));
    const keptOff = []; let removed = 0;
    const stays = (name, at, len) => log(only ? `  ${name}: ${at} stays - changed since the stack wrote it`
        : `  ${name}${at.startsWith('env.') ? ` env: ${at.slice(4)}` : `: ${at}`} kept - changed since the stack wrote it, so it is yours${len ?? ''}`);
    for (const name of only ? [only] : ['settings.json', 'settings.local.json'])
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
        const named = !only && (Object.keys(keys).length > 0 || denies.length > 0 || ids.size > 0 || Object.keys(attr).length > 0);
        let data;
        let fileText;
        try { ({ data, text: fileText } = readSettings(file)); }
        catch (err) { note(`${err.message} - nothing of the stack's was removed from it`); continue; }
        let changed = false;
        if (plain(data.env))
        {
            for (const [key, hash] of Object.entries(keys))
            {
                if (!isStackKey(key) || !Object.hasOwn(data.env, key)) continue;
                if (valueHash(data.env[key]) !== hash) { stays(name, `env.${key}`, ` (${String(data.env[key]).length} chars)`); continue; }
                if (offState(key)) { keptOff.push(key); continue; }
                delete data.env[key];
                changed = true;
                removed += 1;
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
                removed += perms.deny.length - kept.length;
                if (kept.length) perms.deny = kept; else delete perms.deny;
                if (!Object.keys(perms).length) delete data.permissions;
            }
        }
        const unwired = unwireIds(data, ids).length; changed ||= unwired > 0; removed += unwired;
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
                removed += 1;
                continue;
            }
            const spot = settingAt(data, at);
            if (!spot || !Object.hasOwn(spot.holder, spot.key)) continue;
            // Docs memory's row names its folder by the place under the project (layout.js memoryRowHash), never the value.
            const same = at === 'autoMemoryDirectory' ? require('../../stack/hooks/layout.js').memoryRowMatches(spot.holder[spot.key], hash)
                : valueHash(JSON.stringify(spot.holder[spot.key])) === hash;
            if (!same) { stays(name, at); continue; }
            dropSetting(data, at);
            changed = true;
            removed += 1;
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
        else { fs.writeFileSync(file, stringifyLike(data, formatOf(fileText))); log(`  ${name}: the stack's env keys, deny entries, hook wirings and attribution / worktree / auto-compact / memory keys removed`); }
    }
    if (!only) removeManagedVariables({ file: variablesFile, rows: (ledger.env || {})['.variables'] || {}, scope, log, note });
    if (keptOff.length)
        log(`  kept at user scope: ${keptOff.join(', ')} - the user-scope core stays loaded for this account, so these keep what you switched off here off; remove them once it is uninstalled`);
    return removed;
}

// Mode v2 stage 2 (2.2): the rows the last run ledgered in settings.json leave it once, before the pass writes them to the
// local file. An env key still at its hash comes back for the pass; a changed row stays the user's; ALFRED_CODE_DOCS_PATH stays,
// its readers read the shared file (Ruling 7). The ledger loses every other settings.json row; a file that cannot be read keeps all.
function moveToLocal({ claudeDir, ledger, shippedDeny = [], log = () => {}, note = () => {} })
{
    const S = 'settings.json', DOCS = 'ALFRED_CODE_DOCS_PATH';
    const { [DOCS]: docsRow, ...env } = (ledger.env || {})[S] || {};
    const slice = { env: { [S]: env }, deny: (ledger.deny || []).filter((d) => d.file === S), hooks: (ledger.hooks || []).filter((h) => h.file === S),
        settings: { [S]: (ledger.settings || {})[S] || {} } };
    if (!Object.keys(env).length && !slice.deny.length && !slice.hooks.length && !Object.keys(slice.settings[S]).length) return {};
    let have;
    try { have = Object(readSettings(path.join(claudeDir, S)).data.env); } catch (err) { note(`${err.message} - its rows move once it is fixed`); return {}; }
    const carried = Object.fromEntries(Object.keys(env).filter((k) => Object.hasOwn(have, k) && valueHash(have[k]) === env[k]).map((k) => [k, have[k]]));
    const n = removeManagedSettings({ claudeDir, ledger: slice, shippedDeny, only: S, log: (m) => m.includes(': the stack\'s env keys') || log(m), note });
    ledger.env = { ...ledger.env, [S]: { [DOCS]: docsRow } }; if (!docsRow) delete ledger.env[S];
    ledger.env['settings.local.json'] = { ...Object.fromEntries(Object.keys(carried).map((k) => [k, env[k]])), ...ledger.env['settings.local.json'] };
    [ledger.deny, ledger.hooks] = [(ledger.deny || []).filter((d) => d.file !== S), (ledger.hooks || []).filter((h) => h.file !== S)];
    if (ledger.settings) delete ledger.settings[S];
    if (n) log(`  settings: ${n} rows moved from settings.json to settings.local.json - teammates and cloud sessions no longer get them`);
    return carried;
}

module.exports = { mergedOverride, settingAt, MEMBER_PATH, memberRow, syncMembers, carryMemberRows, removeManagedSettings, moveToLocal,
    isStackKey, writeSettings, wiringsOf, applyMcpDeny, applyEnv, wireHooks, hookCommand, readSettings, settingsTarget, localUnusable, readBackSettings,
    unreadableSettings, sharedOnlyDeny, leaveLocalScope, HOOK_TIMEOUT, HOOK_TIMEOUTS, timeoutFor, asyncFor, onFailureFor };
