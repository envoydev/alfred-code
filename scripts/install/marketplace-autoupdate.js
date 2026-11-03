#!/usr/bin/env node
'use strict';
// CLAUDE CODE'S AUTO-UPDATE FOR THE STACK'S MARKETPLACE - offered once by /alfred-code:init (references/init-bootstrap.md
// step 4; U01 of the 2026-11-03 usage audit), written only on the user's answer.
//
//   node scripts/install/marketplace-autoupdate.js [--check] --root <project>
//   node scripts/install/marketplace-autoupdate.js --apply | --decline --root <project>
//
// Where the flag lives (https://code.claude.com/docs/en/plugins/loading.md, 'When auto-update runs'): the first that is
// set of (1) `autoUpdate` on the marketplace's `extraKnownMarketplaces` entry in a settings file, (2) `autoUpdate` on its
// known_marketplaces.json entry, which the /plugin Marketplaces toggle writes, (3) off for a third-party marketplace.
// The highest-precedence file that declares the marketplace supplies its entry WHOLE (settings-reference,
// extraKnownMarketplaces), so a managed, local or project entry decides here and none is ever written. DISABLE_UPDATES,
// DISABLE_AUTOUPDATER or CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC turn the whole pass off unless FORCE_AUTOUPDATE_PLUGINS=1.
//
// A yes writes `autoUpdate: true`, a no `autoUpdate: false` (the default's own value, so nothing changes but the record,
// and no later init asks again) on the stack's entry in the ACCOUNT settings.json - the file `claude plugin marketplace
// add` already writes it to; the entry is added with the source known_marketplaces.json records when the file has none.
// No other marketplace's entry and no other key changes, the file keeps its indent, line ending and BOM, and a file that
// does not parse is left as it is. known_marketplaces.json is the CLI's own record: read, never written.
//
// Lines: `auto-update: ask <key>` | `auto-update: on|off for <key> (<where>)` | `auto-update: not asked - <why>`, and
// for --apply / --decline one `auto-update: ...` line saying what was written. Exit 0, 2 on a usage error.
const fs = require('node:fs');
const path = require('node:path');

const brand = require('./brand.js');
const { parseJson } = require('./json-file.js');

const OFF_ENV = ['DISABLE_UPDATES', 'DISABLE_AUTOUPDATER', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'];
const FORCE_ENV = 'FORCE_AUTOUPDATE_PLUGINS';
// The canonical key and its alias (Claude Code 2.1.232+); a file holding both is read by the canonical one alone
// (settings-reference, 'Marketplace key aliases').
const CANONICAL = 'extraKnownMarketplaces';
const ALIAS = 'additionalMarketplaces';

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isSet = (v) => v !== undefined && v !== null && !['', '0', 'false'].includes(String(v).trim().toLowerCase());

// { state: 'absent' } | { state: 'ok', data, text } | { state: 'unreadable' } - an empty file is unreadable, never `{}`.
function readFile(file)
{
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (e) { return e.code === 'ENOENT' ? { state: 'absent' } : { state: 'unreadable' }; }
    try { const data = parseJson(text); return isObj(data) ? { state: 'ok', data, text } : { state: 'unreadable' }; }
    catch { return { state: 'unreadable' }; }
}

// The marketplaces map a settings file declares and the spelling it sits under, or null.
function mapOf(data)
{
    if (!isObj(data)) return null;
    if (data[CANONICAL] !== undefined) return isObj(data[CANONICAL]) ? { spelling: CANONICAL, map: data[CANONICAL] } : { spelling: CANONICAL, map: null, bad: true };
    if (data[ALIAS] !== undefined) return isObj(data[ALIAS]) ? { spelling: ALIAS, map: data[ALIAS] } : { spelling: ALIAS, map: null, bad: true };
    return null;
}

function managedFiles(managedFile)
{
    const dir = path.join(path.dirname(managedFile), 'managed-settings.d');
    let drops = [];
    try { drops = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort().map((n) => path.join(dir, n)); }
    catch { /* no drop-in folder */ }
    return [managedFile, ...drops];
}

function defaultManagedFile(env)
{
    return require('./workspace.js').managedSettingsFile(process.platform, env);
}

// Every settings layer, highest precedence first: managed, this project's local and shared files, the account's.
function layersOf({ projectRoot, env, managedFile })
{
    const configDir = env.CLAUDE_CONFIG_DIR || path.join(require('node:os').homedir(), '.claude');
    const userFile = path.join(configDir, 'settings.json');
    const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
    const layers = managedFiles(managedFile || defaultManagedFile(env)).map((file) => ({ kind: 'managed', label: 'managed settings', file }));
    for (const rel of ['settings.local.json', 'settings.json'])
    {
        const file = path.join(projectRoot, '.claude', rel);
        if (real(file) !== real(userFile)) layers.push({ kind: 'project', label: `.claude/${rel}`, file });
    }
    layers.push({ kind: 'user', label: userFile, file: userFile });
    for (const l of layers) l.read = readFile(l.file);
    return { layers, userFile, knownFile: path.join(configDir, 'plugins', 'known_marketplaces.json') };
}

// What the account and this project say about the stack's marketplace: its key, the entry that decides, the verdict.
function autoUpdateState({ projectRoot = process.cwd(), env = process.env, managedFile } = {})
{
    const notAsked = (why) => ({ state: 'not-asked', why });
    const { layers, userFile, knownFile } = layersOf({ projectRoot, env, managedFile });
    const user = layers.find((l) => l.kind === 'user');
    const off = (source) => OFF_ENV.find((k) => isSet(source[k]));
    // Claude Code's own switches, never a stack key: the launch env, then each settings file's `env` block.
    const blocks = [env, ...layers.map((l) => (l.read.state === 'ok' && isObj(l.read.data.env) ? l.read.data.env : {}))];
    const forced = blocks.some((b) => isSet(b.FORCE_AUTOUPDATE_PLUGINS));
    const offKey = blocks.map(off).find(Boolean);
    if (offKey && !forced) return notAsked(`${offKey} is set, so Claude Code runs no plugin auto-update (${FORCE_ENV}=1 lifts it)`);
    if (user.read.state === 'unreadable') return notAsked(`${userFile} is not valid JSON - left as it is`);
    const known = readFile(knownFile);
    if (known.state === 'unreadable') return notAsked(`${knownFile} is not valid JSON`);

    const regs = [];
    if (known.state === 'ok') for (const [name, v] of Object.entries(known.data)) regs.push({ ...(isObj(v) ? v : {}), name });
    for (const l of layers)
    {
        const m = l.read.state === 'ok' ? mapOf(l.read.data) : null;
        if (m && m.map) for (const [name, v] of Object.entries(m.map)) regs.push({ ...(isObj(v) ? v : {}), name });
    }
    const found = brand.marketOf({ marketplaces: regs, env });
    if (!found.known) return notAsked("the stack's marketplace is not registered on this account - nothing to update");
    const key = found.key;
    const knownEntry = known.state === 'ok' && isObj(known.data[key]) ? known.data[key] : null;
    const base = { key, userFile, knownSource: knownEntry && isObj(knownEntry.source) ? knownEntry.source : null };
    const fromKnown = () => (knownEntry && typeof knownEntry.autoUpdate === 'boolean'
        ? { ...base, state: knownEntry.autoUpdate ? 'on' : 'off', where: `${knownFile}, the /plugin Marketplaces toggle` }
        : null);

    for (const l of layers)
    {
        const m = l.read.state === 'ok' ? mapOf(l.read.data) : null;
        if (!m || !m.map || !Object.hasOwn(m.map, key)) continue;
        const entry = m.map[key];
        if (isObj(entry) && typeof entry.autoUpdate === 'boolean') return { ...base, state: entry.autoUpdate ? 'on' : 'off', where: l.label, writable: l.kind === 'user' };
        if (l.kind === 'user') break;
        // A higher file's entry replaces the account's whole: only it, or the toggle's record, decides here.
        const held = fromKnown();
        if (held) return held;
        return notAsked(l.kind === 'managed'
            ? `managed settings declare ${key} - your organization's entry decides`
            : `${l.label} declares ${key}, and its entry wins in this project - set "autoUpdate" there by hand, or use /plugin > Marketplaces`);
    }
    // A shape the answer could not be written into is said now, so init never asks a question it cannot carry out.
    const own = user.read.state === 'ok' ? mapOf(user.read.data) : null;
    if (own && own.bad) return notAsked(`${userFile}: ${own.spelling} is not an object - left as it is`);
    if (own && Object.hasOwn(own.map, key) && !isObj(own.map[key])) return notAsked(`${userFile}: ${own.spelling}.${key} is not an object - left as it is`);
    if (!(own && Object.hasOwn(own.map, key)) && !base.knownSource) return notAsked(`known_marketplaces.json records no source for ${key} to copy into ${userFile}`);
    const held = fromKnown();
    if (held) return { ...held, writable: true };
    return { ...base, state: 'ask', writable: true };
}

function stateLine(s)
{
    if (s.state === 'ask') return `auto-update: ask ${s.key}`;
    if (s.state === 'on' || s.state === 'off') return `auto-update: ${s.state} for ${s.key} (${s.where})`;
    return `auto-update: not asked - ${s.why}`;
}

// The file written back in its own shape (indent, line ending, BOM) through a temp file and a rename - D5's writer.
function writeLike(file, text, data)
{
    fs.mkdirSync(path.dirname(file), { recursive: true });
    require('./workspace.js').writeLike(file, text, data);
}

// The answer: `autoUpdate` = value on the stack's entry in the account settings.json, and nothing else.
function applyAutoUpdate({ value, ...opts } = {})
{
    const not = (why) => ({ written: false, line: `auto-update: not written - ${why}` });
    const s = autoUpdateState(opts);
    if (s.state === 'not-asked') return not(s.why);
    if (!s.writable) return not(`${s.where} decides it here - left as it is`);
    const word = value ? 'on' : 'off';
    const read = readFile(s.userFile);
    if (read.state === 'unreadable') return not(`${s.userFile} is not valid JSON - left as it is`);
    const data = read.state === 'ok' ? read.data : {};
    const m = mapOf(data);
    if (m && m.bad) return not(`${s.userFile}: ${m.spelling} is not an object - left as it is`);
    const spelling = m ? m.spelling : CANONICAL;
    const map = m ? m.map : (data[CANONICAL] = {});
    if (Object.hasOwn(map, s.key) && !isObj(map[s.key])) return not(`${s.userFile}: ${spelling}.${s.key} is not an object - left as it is`);
    if (isObj(map[s.key]) && map[s.key].autoUpdate === value) return { written: false, line: `auto-update: already ${word} for ${s.key} (${s.userFile}) - nothing written` };
    if (!Object.hasOwn(map, s.key))
    {
        if (!s.knownSource) return not(`no source for ${s.key} in known_marketplaces.json to copy into ${s.userFile}`);
        map[s.key] = { source: JSON.parse(JSON.stringify(s.knownSource)) };
    }
    map[s.key].autoUpdate = value;
    try { writeLike(s.userFile, read.state === 'ok' ? read.text : '{}', data); }
    catch (e) { return not(`${s.userFile} could not be written (${e.code || e.message})`); }
    return {
        written: true,
        line: value
            ? `auto-update: on for ${s.key} - autoUpdate true written to ${s.userFile}; Claude Code reads it from the next session, and /plugin > Marketplaces turns it off`
            : `auto-update: off for ${s.key} - autoUpdate false written to ${s.userFile}; no project of this account asks again`,
    };
}

module.exports = { autoUpdateState, stateLine, applyAutoUpdate, OFF_ENV, FORCE_ENV };

if (require.main === module)
{
    require('../../stack/hooks/hook-prelude.js').blockingStdio();
    const argv = process.argv.slice(2);
    const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
    const modes = ['--check', '--apply', '--decline'].filter((m) => argv.includes(m));
    if (modes.length > 1) { console.error('marketplace-autoupdate: takes one of --check, --apply or --decline'); process.exit(2); }
    const projectRoot = path.resolve(flag('--root') || process.cwd());
    const opts = { projectRoot, env: process.env, managedFile: flag('--managed-file') };
    if (!modes.length || modes[0] === '--check') console.log(stateLine(autoUpdateState(opts)));
    else console.log(applyAutoUpdate({ ...opts, value: modes[0] === '--apply' }).line);
}
