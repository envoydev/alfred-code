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
const { BRAND, LEGACY } = require('./brand.js');
const { valueHash } = require('./stamp.js');
const shellGuards = require('../../stack/hooks/shell-guards.js');
const fileGuards = require('../../stack/hooks/file-guards.js');
// Both dispatchers fold their guards' rows into one row each (R11 for the shell tools, 2.1.5 M3 for the file tools).
const foldDispatchers = (rows, opts) => fileGuards.wiringRows(shellGuards.wiringRows(rows, opts), opts);

// Every hook does under 30ms of work (measured: 22-25ms, almost all of it the node spawn), but a
// `command` hook with no timeout takes Claude Code's 600s default - so one stalled subprocess
// freezes the session for ten minutes. 10s is ~400x the measured cost and still fails fast.
const HOOK_TIMEOUT = 10;
// The ONE declared exception: check-turn-build.js runs a scoped tsc / dotnet build at Stop, which is
// seconds of real work, not a 25ms spawn - and it keeps its checks inside 50s of this. Keyed by EVENT:
// the same file's PostToolUse half only appends a path, and a stall there must die at 10s like any
// other hook. The plugin entry's generator reads the same table (build-marketplace.js).
// The shell-guard dispatcher runs every shell guard in one process, so its budget is theirs summed:
// each guard keeps the 10s it had as its own hook.
const HOOK_TIMEOUTS = { 'check-turn-build.js': { Stop: 60 }, [`${shellGuards.SELF}.js`]: { PreToolUse: HOOK_TIMEOUT * shellGuards.GUARDS.length },
    [`${fileGuards.SELF}.js`]: { PreToolUse: HOOK_TIMEOUT * fileGuards.GUARDS.length } };
const timeoutFor = (file, event) => (HOOK_TIMEOUTS[file] || {})[event] || HOOK_TIMEOUT;
// The `attribution` keys the seed writes when absent (code.claude.com settings reference).
const ATTRIBUTION_OFF = [['commit', ''], ['pr', ''], ['sessionUrl', false]];
// Every settings path the stack seeds, with its seed value - the ledger records them and a scope move takes them along.
const SEEDED_SETTINGS = [...ATTRIBUTION_OFF.map(([k, v]) => [`attribution.${k}`, v]), ['worktree.baseRef', 'head']];

const HOOKS_DIR_MARK = '/.claude/hooks/';

function readSettings(file)
{
    if (!fs.existsSync(file)) return { data: {}, existed: false };
    // Re-verify 3 S9: a file that cannot be read is named by its read error, never as bad JSON.
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (err) { const e = new Error(`${path.basename(file)} could not be read (${err.code || err.message}) - left untouched; fix it and re-run`); e.leaveAlone = true; throw e; }
    let parsed;
    try { parsed = parseJson(raw); }
    catch (err) { const e = new Error(`${path.basename(file)} is not valid JSON (${err.message}) - left untouched; fix it and re-run`); e.leaveAlone = true; throw e; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    { const e = new Error(`${path.basename(file)} top level is not an object - left untouched`); e.leaveAlone = true; throw e; }
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
    for (const [event, entries] of every())
        for (const entry of entries)
            for (const h of entry.hooks || [])
                if (ours.has(h.command) && h.timeout !== timeoutFor(fileOf(h.command), event)) { h.timeout = timeoutFor(fileOf(h.command), event); changed = true; }

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
            const entry = { hooks: [{ type: 'command', command, timeout: timeoutFor(fileOf(command), event) }] };
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
        list.push({ matcher, hooks: [{ type: 'command', command, timeout: timeoutFor(fileOf(command), 'PreToolUse') }] });
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
    // 1b. PREFIX RENAMES - after the exact ones, so a chain of renames finishes in one run.
    for (const [from, to] of migrations.prefixRenames || [])
        for (const oldKey of Object.keys(env).filter((k) => k.startsWith(from))) move(oldKey, to + oldKey.slice(from.length));
    return changed;
}

// The env keys the stack owns, under either name - what R99 reads from and writes to settings.local.json.
const isStackKey = (key) => /^(ALFRED_CODE_|CLAUDE_STACK_)/.test(key) || key === 'CLAUDE_DOCS_PATH'; // legacy-name

// C8 (R100, R101): keys that hold a value of THIS machine - the memory database's absolute path. At
// every scope they live in settings.local.json, never in the committed settings.json.
const PERSONAL_KEYS = ['ALFRED_CODE_MEMORY_DB'];

// Steps 2 and 3 of the env pass, in place, over the keys `only` admits.
function retireAndReseed(env, migrations, log, label, only = () => true)
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

    // 3. BAD SEEDS - corrected only while the key still holds the wrong default.
    for (const [key, badSeed, to] of migrations.reseed || [])
        if (only(key) && env[key] === badSeed) { env[key] = to; changed = true; log(`  ${label} env: ${key} reset to ${to} (auto-detect)`); }
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
function applyEnv(env, { catalog, migrations, docsVersioning, docsPath, dataPath, memoryDb, hooksOff, hooksAnswered, inherited, overlay, overlayUnreadable = false, sharedKeys = [], log, label = 'settings.json', overlayLabel = 'settings.local.json' })
{
    let changed = renameEnv(env, migrations, log, label);
    const beneath = inherited && typeof inherited === 'object' && !Array.isArray(inherited) ? { ...inherited } : {};
    renameEnv(beneath, migrations, () => {});
    const held = overlay && typeof overlay === 'object' && !Array.isArray(overlay) ? overlay : null;
    if (held)
    {
        renameEnv(held, migrations, log, overlayLabel);
        retireAndReseed(held, migrations, log, overlayLabel, isStackKey);
    }
    const heldHere = (key) => Boolean(held) && isStackKey(key) && key in held && !sharedKeys.includes(key);
    const present = (key) => key in env || key in beneath;
    // Where a decision about `key` lands: the overlay when it holds the key, else this file.
    const at = (key) => (heldHere(key) ? { into: held, lab: overlayLabel, mine: false } : { into: env, lab: label, mine: true });

    if (retireAndReseed(env, migrations, log, label)) changed = true;

    // 3b. THE DOCS ROOT DECISION (docs.docsMovePlan) - before the seeds, so the absent-only default never
    // lands first: a moved or re-pointed root, a kept old one, or the old root held while its move is offered.
    if (docsPath && docsPath.value)
    {
        const { into, lab, mine } = at('ALFRED_CODE_DOCS_PATH');
        const old = into.ALFRED_CODE_DOCS_PATH;
        if (old !== docsPath.value)
        {
            into.ALFRED_CODE_DOCS_PATH = docsPath.value;
            if (mine) changed = true;
            log(`  ${lab} env: ALFRED_CODE_DOCS_PATH ${old === undefined ? 'absent' : `'${old}'`} -> '${docsPath.value}' (${docsPath.why})`);
        }
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

    // 4. SEEDS - absent-only, from the catalog, which is the one list.
    for (const row of catalog)
    {
        if (row.written) continue;                       // step 5 owns these
        if (row.key === 'ALFRED_CODE_DOCS_VERSIONING') continue;   // a decision, below
        if (row.key === 'ALFRED_CODE_HOOKS_OFF') continue;         // answered-wins, below
        if (present(row.key)) continue;
        env[row.key] = row.default;
        changed = true;
        log(`  ${label} env: ${row.key} seeded (${row.default === '' ? 'empty' : row.default})`);
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

    // 5. WRITTEN keys - they track a choice this run just made, so they overwrite.
    for (const [key, value, shown] of [['ALFRED_CODE_MEMORY_DB', memoryDb, memoryDb]])
    {
        // N7: an overlay that could not be read is no home for it, and this file never is - the value is
        // left unwritten and said once, the way `memory.js init` refuses; what this file held stays.
        if (!held && overlayUnreadable && PERSONAL_KEYS.includes(key))
        {
            if (value) log(`  !! ${overlayLabel} could not be read - the memory level was not written (${key} stays out of ${label}); fix it and re-run`);
            continue;
        }
        const personal = Boolean(held) && PERSONAL_KEYS.includes(key);
        const { into, lab, mine } = personal ? { into: held, lab: overlayLabel, mine: false } : at(key);
        if (value && into[key] !== value) { into[key] = value; if (mine) changed = true; log(`  ${lab} env: ${key} -> ${shown}`); }
        if (personal && value && key in env)
        { delete env[key]; changed = true; log(`  ${label} env: ${key} removed - this machine's database path, kept in ${overlayLabel} from here on`); }
    }

    // ALFRED_CODE_HOOKS_OFF: a walk that answered the hooks layer THIS run wins over the stored
    // value - the one exception to absent-only, because the user is looking at the question.
    const off = (hooksOff || []).join(',');
    if (hooksAnswered)
    {
        const { into, lab, mine } = at('ALFRED_CODE_HOOKS_OFF');
        if (into.ALFRED_CODE_HOOKS_OFF !== off)
        { into.ALFRED_CODE_HOOKS_OFF = off; if (mine) changed = true; log(`  ${lab} env: ALFRED_CODE_HOOKS_OFF = ${off || '(empty - every hook runs)'}`); }
    }
    else if (!present('ALFRED_CODE_HOOKS_OFF'))
    { env.ALFRED_CODE_HOOKS_OFF = ''; changed = true; log(`  ${label} env: ALFRED_CODE_HOOKS_OFF seeded (empty - every hook runs)`); }

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
    const olds = (migrations.renames || []).filter(([, n]) => n === key).map(([o]) => o)
        .concat((migrations.prefixRenames || []).filter(([, to]) => key.startsWith(to)).map(([from, to]) => from + key.slice(to.length)));
    return olds.find((old) => old in before && before[old] === value) || null;
}

// The env half, for one file: the drop, then the managed map. `release` is every key the catalog ships;
// `seedsOf(key)` what the stack ever seeded it with (the fallback's evidence); `written` the keys this
// run overwrites by contract, with the value it wrote.
function ledgerEnv({ name, env, before, prior, release, seedsOf, written, userOwned = [], migrations, log })
{
    let changed = false;
    if (prior)
        for (const [key, hash] of Object.entries(prior))
        {
            if (!isStackKey(key) || !Object.hasOwn(env, key) || release.has(key)) continue;   // a stack key only: the stamp is project text
            if (valueHash(env[key]) === hash)
            { delete env[key]; changed = true; log(`  ${name} env: ${key} removed - the stack wrote it and this release no longer does`); }
            else log(`  ${name} env: ${key} kept - changed since the stack wrote it, so it is yours (${String(env[key]).length} chars)`);
        }
    const managed = {};
    for (const key of Object.keys(env).filter(isStackKey))
    {
        if (userOwned.includes(key)) continue;   // an answer this run made the value the user's
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
        file, hookSpecs = [], retiredHooks = [], denySpecs = [], retiredDeny = [], retiredEntries = [], liveEntries = null,
        agentDeny = [], agentAllow = [],
        mcpNames = [], mcpOff = [], mcpjsonDisable = [], mcpjsonEnable = [], catalog = [], migrations = {},
        docsVersioning, docsPath = null, dataPath = null, memoryDb, hooksOff, hooksAnswered = false, inheritedEnv = null, localFile = null, renamed = null,
        inheritedOverrides = null, sharedFile = null, sharedKeys = [], attribution = null, worktreeBase = null, ledger = {},
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
    // A seat denied through a per-stack entry retired in 1.3.0 is the user's off-state - a picked
    // rule's closure would copy the seat back without it - so it gains the core spelling, which every
    // later run reads as off; picking the seat again clears both (derive-state's allow list). The old
    // spelling goes only once that entry is uninstalled: Claude Code matches the exact home name, so
    // while the entry still loads (another scope, a refused uninstall, a listing this run could not
    // read) it is the spelling that keeps the seat off. `liveEntries` absent = cannot say = kept.
    //
    // The 1.x CORE is one more row: 2.0.0 renamed it, so `Agent(claude-stack:<seat>)` is re-spelled // legacy-name
    // too, keeping the settings in one spelling. Its old spelling stays only while the listing still
    // shows the old core (a rename no session has taken yet); a listing that cannot say does not
    // keep it, because every session from 2.0.0 on runs the renamed core, and the new spelling is the
    // one that blocks it (docs/rebrand-evidence.md S6).
    const live = (home) => (liveEntries || (home === LEGACY.core ? [] : retiredEntries)).includes(home);
    const homes = [...retiredEntries, LEGACY.core];
    // I1 (fix round 1): both passes below also run over settings.local.json's deny list - a seat the
    // user switched off for themselves is re-spelled THERE, never moved into the shared file.
    const respellSeats = (list, lab) =>
    {
        let touched = false;
        for (const entry of [...list])
        {
            const m = /^Agent\(([a-z0-9-]+):([A-Za-z0-9_-]+)\)$/.exec(entry);
            if (!m || !homes.includes(m[1])) continue;
            const core = `Agent(${BRAND.core}:${seatNow(m[2])})`;
            const why = m[1] === LEGACY.core ? 'the core was renamed' : 'its entry retired';
            if (!list.includes(core)) { list.push(core); touched = true; log(`  ${lab}: ${entry} also denied as ${core} (${why})`); }
            if (live(m[1])) continue;
            list.splice(list.indexOf(entry), 1);
            touched = true;
            log(`  ${lab}: ${entry} dropped - ${m[1] === LEGACY.core ? 'the old core name loads nowhere now' : 'its entry is uninstalled'}, ${core} keeps the seat off`);
        }

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
    let createdLocal = false;
    let localUnreadable = false;
    if (localFile && fs.existsSync(localFile))
    {
        try { ({ data: local } = readSettings(localFile)); }
        catch (err) { note(`${err.message} - its stack keys are not read or written this run`); local = null; localUnreadable = true; }
    }
    // C8: the memory database path has no other home, so a local file that is not there yet is made.
    else if (localFile && memoryDb) { local = {}; createdLocal = true; }
    const localEnvBefore = local && plain(local.env) ? { ...local.env } : {};
    if (local && memoryDb && !(local.env && typeof local.env === 'object' && !Array.isArray(local.env))) local.env = {};
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
    // A deny leaves the spelling of a retired entry (or the 1.x core) that still loads here: Claude Code
    // matches the exact home name, so that spelling is what keeps the seat off while the entry loads
    // (the respell pass above); an allow clears every spelling.
    const liveSpelling = (entry) => { const m = /^Agent\(([a-z0-9-]+):/.exec(entry); return Boolean(m && homes.includes(m[1]) && live(m[1])); };
    const dropSeat = (rule, keep) =>
    {
        const seat = stackSeat(rule);
        for (const entry of [...deny]) if (entry !== keep && seat && stackSeat(entry) === seat && !(keep && liveSpelling(entry)))
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

    // enabledMcpjsonServers: pre-approve exactly the .mcp.json servers we register, so there is no
    // per-launch trust prompt - never blanket enableAllProjectMcpServers.
    const enabled = (data.enabledMcpjsonServers ??= []);
    for (const name of mcpNames) if (!enabled.includes(name)) { enabled.push(name); changed = true; }
    // ... and DROP the names this run unregistered. A server carried by a plugin is trusted through
    // the plugin, so a leftover entry names a `.mcp.json` server that no longer exists - dead config
    // that reads like a working knob.
    for (const name of mcpOff) if (enabled.includes(name))
    { enabled.splice(enabled.indexOf(name), 1); changed = true; log(`  ${label}: dropped enabledMcpjsonServers entry ${name} (no longer registered here)`); }

    // R116 (j): disabledMcpjsonServers - a playwright engine left off is registered AND named here, which
    // rejects a .mcp.json server in every permission mode. The caller passes only what the user's enable
    // choice moved (and what no longer has a registration), so an entry the user took out by hand stays
    // out. A list this run empties goes; one the user left empty stays.
    if (mcpjsonDisable.length || mcpjsonEnable.length)
    {
        const had = data.disabledMcpjsonServers;
        if (had !== undefined && !Array.isArray(had)) note(`${label}: disabledMcpjsonServers is not a list - left as it is, and no browser engine is switched off through it`);
        else
        {
            const off = had || [];
            let dropped = false;
            for (const name of mcpjsonDisable) if (!off.includes(name))
            { off.push(name); changed = true; log(`  ${label}: disabledMcpjsonServers + ${name} (left off - registered, not loaded)`); }
            for (const name of mcpjsonEnable) if (off.includes(name))
            { off.splice(off.indexOf(name), 1); changed = true; dropped = true; log(`  ${label}: disabledMcpjsonServers - ${name}`); }
            if (!had && off.length) data.disabledMcpjsonServers = off;
            if (had && dropped && !off.length) delete data.disabledMcpjsonServers;
        }
    }

    // baseline-git forbids AI attribution; the `attribution` setting enforces it. Key by key and add-only:
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
    const overlayBefore = overlay && !createdLocal ? JSON.stringify(overlay) : null;
    if (applyEnv((data.env ??= {}), { catalog, migrations, docsVersioning, docsPath, dataPath, memoryDb, hooksOff, hooksAnswered, inherited: inheritedEnv, overlay, overlayUnreadable: localUnreadable, sharedKeys, log, label,
        overlayLabel: localFile ? path.basename(localFile) : undefined })) changed = true;
    // R10: the ledger pass, over the env of each file this run writes, the deny lists and the wirings.
    const localName = localFile ? path.basename(localFile) : null;
    const reseeds = (key) => (migrations.reseed || []).filter(([k]) => k === key).flatMap(([, bad, to]) => [bad, to]);
    const seedsOf = (key) => [...catalog.filter((r) => r.key === key && !r.written).flatMap((r) => [String(r.default), ...(r.former_defaults || []).map(String)]), ...reseeds(key),
        ...(key === 'ALFRED_CODE_DOCS_VERSIONING' && docsVersioning && docsVersioning.seed ? [docsVersioning.seed] : [])];
    const releaseEnv = new Set(catalog.map((r) => r.key));
    const writtenNow = memoryDb ? { ALFRED_CODE_MEMORY_DB: memoryDb } : {};
    const priorEnv = (name) => (prior && prior.env ? prior.env[name] || {} : null);
    const managedEnv = {};
    const userOwned = docsPath && docsPath.own === 'user' ? ['ALFRED_CODE_DOCS_PATH'] : [];
    const envShared = ledgerEnv({ name: label, env: data.env, before: envBefore, prior: priorEnv(label), release: releaseEnv, seedsOf, written: writtenNow, userOwned, migrations, log });
    if (envShared.changed) changed = true;
    managedEnv[label] = envShared.managed;
    if (overlay)
    {
        const envLocal = ledgerEnv({ name: localName, env: overlay, before: localEnvBefore, prior: priorEnv(localName), release: releaseEnv, seedsOf, written: writtenNow, userOwned, migrations, log });
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
    const managed = { env: managedEnv, deny: managedDeny, hooks: managedHooks, settings: Object.keys(managedAttr).length ? { [label]: managedAttr } : {} };

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
    // M1 (R132): an entry in ANY settings file rejects a .mcp.json server, and Claude Code's approval
    // dialog writes its rejection to settings.local.json - so an engine this run enables leaves that
    // list too. Only the names the answer moved: another entry, or a key of the user's own, stays.
    let localListChanged = false;
    if (local && mcpjsonEnable.length && Array.isArray(local.disabledMcpjsonServers))
    {
        const moved = local.disabledMcpjsonServers.filter((n) => mcpjsonEnable.includes(n));
        for (const name of moved) log(`  ${path.basename(localFile)}: disabledMcpjsonServers - ${name}`);
        const kept = local.disabledMcpjsonServers.filter((n) => !mcpjsonEnable.includes(n));
        if (moved.length && kept.length) local.disabledMcpjsonServers = kept;
        else if (moved.length) delete local.disabledMcpjsonServers;
        localListChanged = moved.length > 0;
    }
    const localChanged = (Boolean(overlay) && JSON.stringify(overlay) !== overlayBefore) || localRekeyed || localRespelled || localListChanged || localAllowed;
    if (localChanged)
    {
        fs.mkdirSync(path.dirname(localFile), { recursive: true });
        fs.writeFileSync(localFile, `${JSON.stringify(local, null, 2)}\n`);
    }
    const createdLocalFile = createdLocal && localChanged;

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

    if (!changed) return { written: localChanged, refused: false, createdLocal: createdLocalFile, managed };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    return { written: true, refused: false, createdLocal: createdLocalFile, managed };
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
// settings.json's list. The stack's copied-hook wiring (`hookFiles`) and its `.mcp.json` approvals
// (`mcpNames`) are dropped from the local file - this run writes them to settings.json on the routes
// that use them.
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
    for (const [at, seed] of SEEDED_SETTINGS)
    {
        const [obj, key] = at.split('.');
        const holder = isObj(local[obj]) ? local[obj] : null;
        if (!holder || !Object.hasOwn(holder, key)) continue;
        const json = JSON.stringify(holder[key]);
        if (ledgerSettings ? ledgerSettings[at] !== valueHash(json) : json !== JSON.stringify(seed))
        {
            say(`${at} stays here (your value) - it applies over settings.json`);
            continue;
        }
        delete holder[key];
        if (!Object.keys(holder).length) delete local[obj];
        settingsGone.push(at);
        localChanged = true;
    }
    // C18: every seed that left is ONE line.
    const alsoSettings = settingsGone.length ? `; and the settings seeds ${settingsGone.join(', ')}` : '';
    if (seedsGone.length)
        say(`${seedsGone.length} stack env key${seedsGone.length === 1 ? '' : 's'} removed - each held the stack's own seed, so settings.json's value or its seed applies from here on: ${seedsGone.join(', ')}${alsoSettings}`);
    else if (settingsGone.length) say(`the stack's settings seeds removed - settings.json's value or its seed applies from here on: ${settingsGone.join(', ')}`);

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
            say(`enabledMcpjsonServers entry ${name} dropped - approved in settings.json from here on`);
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
            const [obj, key] = at.split('.');
            const holder = plain(data[obj]) ? data[obj] : null;
            if (!holder || !Object.hasOwn(holder, key)) continue;
            if (valueHash(JSON.stringify(holder[key])) !== hash) { log(`  ${name}: ${at} kept - changed since the stack wrote it, so it is yours`); continue; }
            delete holder[key];
            changed = true;
            if (!Object.keys(holder).length) delete data[obj];
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
        else { fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`); log(`  ${name}: the stack's env keys, deny entries, hook wirings and attribution / worktree keys removed`); }
    }
    if (keptOff.length)
        log(`  kept at user scope: ${keptOff.join(', ')} - the user-scope core stays loaded for this account, so these keep what you switched off here off; remove them once it is uninstalled`);
}

module.exports = { removeManagedSettings, isStackKey, writeSettings, applyEnv, wireHooks, hookCommand, readSettings, settingsTarget, readBackSettings, sharedOnlyDeny, leaveLocalScope, HOOK_TIMEOUT, HOOK_TIMEOUTS, timeoutFor };
