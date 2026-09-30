#!/usr/bin/env node
'use strict';

// plugin-settings.js - the guided walks' plugin-settings substep, made deterministic.
//
// A plugin the stack installs ships its own defaults; meta/plugin-settings.json holds only the
// keys THIS stack has a reason to change, each with a why. This tool reports the delta against
// what is on disk (`--check`) and applies it (`--apply`) - never more than the catalog names.
//
// Two rules the flow depends on:
//   1. ADD-ONLY by default. A key the user already set to something else is reported as a
//      difference and kept; `--replace` is the explicit opt-in that overwrites it. Same
//      discipline as the env step: a pinned choice is never silently overridden.
//   2. A target carrying `requires_path` is skipped when that path is absent - the statusLine
//      block belongs to the plugin's own setup, so a refresh interval never invents one.
//   3. A key named in the target's `chosen_by` counts as the user's when that other path is set,
//      and a target file that is not a JSON object is skipped, never written over.
//   4. The account settings.json is copied to `settings.json.bak.<YYYYMMDD-HHMMSS>` before its first
//      write of a run (claude-hud 0.8.0 setup.md:487-505) - never when nothing is written to it. A copy
//      that fails writes nothing at all, exit 1.
//
// /alfred-code:init applies the claude-hud row through hud-statusline.js, after writing the
// statusLine block it gates.
//
// Paths resolve against the ACCOUNT config dir (~/.claude, or ~/.claude-<space> under a
// profile), which is where a plugin's config lives whichever scope the plugin was installed at.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseJson } = require('./install/json-file.js');

// Strict, like hud-statusline.js: an argument this script does not know, a value flag with no value
// or a flag given twice throws - never read as absent, which would apply to ~/.claude or to every
// catalog row (C16).
const VALUE_FLAGS = ['--catalog', '--config-dir', '--plugin', '--installed'];
const SWITCHES = ['--apply', '--replace', '--check'];
function parseArgs(argv)
{
    const args = {};
    for (let i = 0; i < argv.length; i += 1)
    {
        const a = argv[i];
        if (Object.hasOwn(args, a)) throw new Error(`${a} is given twice`);
        if (SWITCHES.includes(a)) { args[a] = true; continue; }
        if (!VALUE_FLAGS.includes(a)) throw new Error(`unknown argument '${a}'`);
        const v = argv[i + 1];
        if (v === undefined || v === '' || v.startsWith('--')) throw new Error(`${a} needs a value`);
        args[a] = v;
        i += 1;
    }
    return args;
}

function readJson(file)
{
    try { return parseJson(fs.readFileSync(file, 'utf8')); }
    catch { return null; }
}

// A target file as on disk: absent, an object, or BAD - there but not a JSON object. A bad file is
// never written over: add-only means the user's broken file stays theirs to fix. Blank reads as {}.
function readDoc(file)
{
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch { return { exists: false, doc: null }; }
    if (!text.trim()) return { exists: true, doc: {} };
    try
    {
        const doc = parseJson(text);
        return doc && typeof doc === 'object' && !Array.isArray(doc) ? { exists: true, doc } : { exists: true, bad: true };
    }
    catch { return { exists: true, bad: true }; }
}

function atPath(obj, dotted)
{
    let cur = obj;
    for (const seg of dotted.split('.'))
    {
        if (!cur || typeof cur !== 'object' || !(seg in cur)) return undefined;
        cur = cur[seg];
    }

    return cur;
}

// Flatten the catalog's nested settings object into dotted leaf keys, so a report line names
// exactly what changes ('display.showCost') instead of a whole block.
function leaves(obj, prefix = '')
{
    const out = [];
    for (const [k, v] of Object.entries(obj || {}))
    {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...leaves(v, key));
        else out.push([key, v]);
    }

    return out;
}

function setLeaf(obj, dotted, value)
{
    const segs = dotted.split('.');
    let cur = obj;
    for (const seg of segs.slice(0, -1))
    {
        if (!cur[seg] || typeof cur[seg] !== 'object' || Array.isArray(cur[seg])) cur[seg] = {};
        cur = cur[seg];
    }

    cur[segs[segs.length - 1]] = value;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The delta for one plugin: every catalog leaf classified against what is on disk - or, for a file
// named in `overlay`, against the doc a caller is about to write there.
function planFor(entry, configDir, overlay = {})
{
    const targets = [];
    for (const t of entry.targets || [])
    {
        const file = path.join(configDir, t.file);
        const { exists, doc: current, bad } = Object.hasOwn(overlay, t.file) ? { exists: true, doc: overlay[t.file] } : readDoc(file);
        const rows = [];
        let skipped = null;
        if (bad) skipped = `${t.file} is not valid JSON - left as it is`;
        else if (t.requires_path && (!current || atPath(current, t.requires_path) === undefined))
        {
            skipped = `no \`${t.requires_path}\` in ${t.file} - the plugin's own setup owns that block`;
        }
        else
        {
            for (const [key, want] of leaves(t.settings))
            {
                const have = current ? atPath(current, key) : undefined;
                // `chosen_by`: another path whose presence means the user already chose this key
                // (claude-hud's legacy `layout`), so the key is reported as theirs, never added.
                const via = t.chosen_by && t.chosen_by[key];
                const viaHave = have === undefined && via && current ? atPath(current, via) : undefined;
                if (viaHave !== undefined) rows.push({ key, want, have: viaHave, via, status: 'differs' });
                else rows.push({ key, want, have, status: have === undefined ? 'missing' : same(have, want) ? 'match' : 'differs' });
            }
        }

        targets.push({ file: t.file, absolute: file, exists, why: t.why || {}, rows, skipped });
    }

    return targets;
}

const two = (n) => String(n).padStart(2, '0');

// Rule 4. `run` is one run's state: `done` once the copy is decided, `now` and `copy` for tests. The
// copy is decided ONCE, before the first write - a settings.json this run created is never copied. A
// name already taken (a second run in the same second) gets -1, -2: an earlier copy is never replaced.
function backupOnce(file, run = {})
{
    if (run.done) return null;
    run.done = true;
    if (!fs.existsSync(file)) return null;
    const d = run.now || new Date();
    const base = `${file}.bak.${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
    const copy = run.copy || fs.copyFileSync;
    for (let n = 0; ; n++)
    {
        const bak = n ? `${base}-${n}` : base;
        try { copy(file, bak, fs.constants.COPYFILE_EXCL); return bak; }
        catch (e)
        {
            if (e.code === 'EEXIST' && n < 99) continue;
            throw Object.assign(new Error(`could not back up ${file} (${e.code || e.message})`), { backup: true });
        }
    }
}

function applyTargets(targets, replace, run = {})
{
    let written = 0;
    let changed = 0;
    const writes = [];
    for (const t of targets)
    {
        if (t.skipped) continue;
        const toWrite = t.rows.filter(r => r.status === 'missing' || (replace && r.status === 'differs'));
        if (toWrite.length) writes.push([t, toWrite]);
    }

    // Before ANY write, so a copy that fails leaves every target as it was.
    const account = writes.find(([t]) => t.file === 'settings.json');
    const backup = account ? backupOnce(account[0].absolute, run) : null;
    for (const [t, toWrite] of writes)
    {
        const { doc: found, bad } = readDoc(t.absolute);
        if (bad) continue;
        const doc = found || {};
        for (const r of toWrite) setLeaf(doc, r.key, r.want);
        fs.mkdirSync(path.dirname(t.absolute), { recursive: true });
        fs.writeFileSync(t.absolute, JSON.stringify(doc, null, 2) + '\n');
        written++;
        changed += toWrite.length;
    }

    return { written, changed, backup };
}

function report(plugins, plan, opts)
{
    const lines = [];
    let missing = 0;
    let differs = 0;
    let match = 0;
    for (const name of plugins)
    {
        lines.push(`# ${name}`);
        for (const t of plan[name])
        {
            if (t.skipped) { lines.push(`  ${t.file}: skipped - ${t.skipped}`); continue; }
            lines.push(`  ${t.file}${t.exists ? '' : ' (will be created)'}`);
            for (const r of t.rows)
            {
                if (r.status === 'missing') missing++;
                else if (r.status === 'differs') differs++;
                else match++;
                const now = r.status === 'missing' ? 'not set' : `${r.via ? `${r.via} ` : ''}${JSON.stringify(r.have)}`;
                lines.push(`    ${r.status.padEnd(8)} ${r.key} -> ${JSON.stringify(r.want)}${r.status === 'match' ? '' : ` (now: ${now})`}`);
            }
        }
    }

    lines.push('');
    lines.push(`plugin-settings: ${missing} to add, ${differs} already set differently (kept unless you choose replace), ${match} already match`);
    if (opts.applied) lines.push(`applied: ${opts.applied.changed} key(s) across ${opts.applied.written} file(s)`);
    if (opts.applied && opts.applied.backup) lines.push(`backup: ${opts.applied.backup}`);

    return { text: lines.join('\n'), missing, differs, match };
}

// The account a write lands in is never guessed: `--config-dir` with no value, an empty one, a flag
// in its place or the `--config-dir=<dir>` form would read as absent and fall back to ~/.claude.
function badConfigDir(argv)
{
    const i = argv.indexOf('--config-dir');
    const v = i >= 0 ? argv[i + 1] : 'unset';
    return argv.some(a => a.startsWith('--config-dir=')) || !v || v.startsWith('--');
}

function main(argv)
{
    if (badConfigDir(argv)) { console.error('plugin-settings: --config-dir needs a directory, as --config-dir <dir> - nothing written'); return 2; }
    let args;
    try { args = parseArgs(argv); }
    catch (e) { console.error(`plugin-settings: ${e.message} - nothing written`); return 2; }
    const root = path.join(__dirname, '..');
    const catalogPath = args['--catalog'] || path.join(root, 'meta', 'plugin-settings.json');
    const configDir = args['--config-dir'] || path.join(os.homedir(), '.claude');
    const only = args['--plugin'] || null;
    const installed = (args['--installed'] || '').split(',').map(s => s.trim()).filter(Boolean);
    const doApply = args['--apply'] === true;
    const replace = args['--replace'] === true;

    const catalog = readJson(catalogPath);
    if (!catalog || !catalog.plugins) { console.error(`plugin-settings: unreadable catalog ${catalogPath}`); return 2; }

    let names = Object.keys(catalog.plugins).sort();
    if (only) names = names.filter(n => n === only);
    // --installed narrows the offer to the plugins this run actually put in place: a catalog row
    // for a plugin the user did not install is not an invitation to install it.
    if (installed.length) names = names.filter(n => installed.includes(n));
    if (!names.length) { console.log('plugin-settings: nothing to offer (no catalog row for the installed plugins)'); return 0; }

    const plan = {};
    for (const n of names) plan[n] = planFor(catalog.plugins[n], configDir);

    let applied = null;
    if (doApply)
    {
        // One apply over every plugin's targets: one backup decision, taken before the first write.
        try { applied = applyTargets(names.flatMap(n => plan[n]), replace); }
        catch (e)
        {
            if (!e.backup) throw e;
            console.error(`plugin-settings: ${e.message} - nothing written`);
            return 1;
        }
    }

    const out = report(names, doApply ? Object.fromEntries(names.map(n => [n, planFor(catalog.plugins[n], configDir)])) : plan, { applied });
    console.log(out.text);

    return 0;
}

module.exports = { planFor, applyTargets, backupOnce, report, leaves, atPath, setLeaf, readDoc, readJson, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));
