'use strict';
// THE MCP LAYER - which servers this run registers, and reading back what actually landed.
//
// After Phase 6 the default answer is NONE: every catalog server ships as its own plugin, so the
// seed registers nothing and instead PRUNES what a 0.2.x install wrote. Leaving those entries would
// run each server twice - once from `.mcp.json`, once from the plugin - and pay both sets of tool
// schemas in every session.
//
// Four rules earned the hard way, each one a bug that shipped:
//
//   - R7, THE LOCKED THREE. navigation, documentation and memory are plugins the installer puts beside the
//     core whenever the core is enabled at all - which is whenever ANY plugin route is on (not
//     dependencies: a missing one would disable the core at load). Registering them as well
//     double-loads them. They come back to `.mcp.json` only on the FULL copy route, where the core
//     is never enabled.
//   - `claude mcp add` OVER AN EXISTING NAME prints 'already exists' and EXITS 0. A `remove` that
//     did not take is therefore indistinguishable from a successful rewrite, and the stale entry
//     survives forever. The CLI stays the happy path; `verifyProject` / `verifyUser` check the
//     RESULT and repair the drift.
//   - AN ARGV WORD IS SPLIT BEFORE ITS PLACEHOLDER IS RESOLVED, so a resolved path holding a space
//     ('/Users/Jane Doe', a project root under one) stays ONE argument, and a bare `*` in a spec is
//     never glob-expanded.
//   - A SERVER THE PROJECT ADDED BY HAND is not a stack name: never read, never compared, never
//     written. Drift repair is for entries this stack owns.
const fs = require('node:fs');
const path = require('node:path');
const { parseJson } = require('./json-file.js');
const { isDeepStrictEqual } = require('node:util');
const { entryHash } = require('./stamp.js');
const { offeredOn, skipNote } = require('../../stack/mcp/desktop-launch.js');
const { excludeNewerOf, cutoffFor } = require('../../stack/mcp/uv-python.js');

// The three that can never be dropped - see R7 above.
const LOCKED = ['navigation', 'documentation', 'memory'];
const { ENGINES: PW_ENGINES } = require('../../stack/mcp/data-root.js');
// Every name the browser server was registered under: the 1.x single `playwright`, the
// `playwright-<engine>` servers 2.0.0 renamed, and one `browser-<engine>` per engine.
const PW_SERVERS = ['playwright', ...PW_ENGINES.map((e) => `playwright-${e}`), ...PW_ENGINES.map((e) => `browser-${e}`)];

// THE 2.0.0 RENAME (meta/stack-manifest.json `renamed.mcps`, old -> new): an MCP name an older release
// used reads as the name it goes by now - the plugin and its server alike, a browser engine by its
// prefix (`playwright-chrome` -> `browser-chrome`). Any other name comes back as it is.
function currentMcp(name, renamed = {})
{
    const text = String(name);
    if (Object.hasOwn(renamed, text)) return renamed[text];
    const m = /^(.+)-(chrome|msedge|firefox|webkit)$/.exec(text);
    return m && Object.hasOwn(renamed, m[1]) ? `${renamed[m[1]]}-${m[2]}` : text;
}

// Every plugin and server name the rename left behind: each old name, and for the one that expands
// per engine (the browser) each old engine name instead - the bare 1.x `playwright` is its own legacy
// registration (PW_SERVERS), never a plugin. What an older install can still hold.
function renamedFrom(renamed = {})
{
    const out = [];
    for (const [from, to] of Object.entries(renamed || {}))
        if (to === 'browser') out.push(...PW_ENGINES.map((e) => `${from}-${e}`));
        else out.push(from);
    return out;
}

const isLocked = (name) => LOCKED.includes(name);

// A plugin route being on at all means the CORE entry is enabled, and the locked three are installed
// as plugins beside it.
const corePluginOn = (routes) => Boolean(routes.hooks || routes.skills || routes.mcps);

// The names this run must UNREGISTER. On the plugin route that is every server the stack ever
// registered here - the whole catalog, not this run's selection, because an earlier install may
// have written a server this project no longer picks - plus the four engine spellings. On a copy
// route with the core still on it is just the locked three. On the full copy route, only what the
// release authored as retired.
function retiredMcps({ routes, catalog = [], authored = [], legacy = [] })
{
    // The names the 2.0.0 rename left behind go on EVERY route: this release registers none of them,
    // so one still here is the older install's own (a registration the user made under an old name is
    // kept by the callers' shape and ledger checks).
    const out = [...authored, ...legacy];
    if (!routes.mcps)
    {
        if (corePluginOn(routes)) out.push(...LOCKED);
        return out;
    }
    for (const entry of catalog) out.push(typeof entry === 'string' ? entry.split('|')[0] : entry.name);
    out.push(...PW_ENGINES.map((e) => `browser-${e}`));
    return out;
}

// Of the names a release RETIRED, the ones this run still prunes. A name with a retirement row
// (meta/retired-plugins.json) goes only while the last install's stamp predates it - that install is
// what registered it. The first update past it prunes the registration and prints the row's add-back
// line, so from then on a registration under the name is the user's own and stays; with no stamp at
// all the stack never registered it either, and a server added by hand is never touched. A name with
// no row is pruned every run, as before.
function dueRetired({ names = [], rows = [], lastVersion = '', compare })
{
    return names.filter((name) =>
    {
        const row = rows.find((r) => r && r.name === name);
        if (!row || !row.retiredIn) return true;
        return Boolean(lastVersion) && compare(lastVersion, row.retiredIn) < 0;
    });
}

// The servers this run registers under their BARE names - the only ones whose tool names may be
// spelled `mcp__<server>__`. Empty on the plugin route.
function bareNamedMcps({ routes, mcps = [] })
{
    if (routes.mcps) return [];
    return mcps
        .map((e) => (typeof e === 'string' ? e.split('|')[0] : e.name))
        .filter((name) => !(isLocked(name) && corePluginOn(routes)));
}

// Split into argv words FIRST, then resolve the placeholders inside each word - so a resolved path
// with a space stays one argument. No globbing, ever.
function mcpArgv(args, tokens = {})
{
    return String(args).split(/\s+/).filter(Boolean)
        .map((word) => [word, Object.entries(tokens)
            .reduce((w, [key, value]) => w.split(`@${key}@`).join(value ?? ''), word)])
        // A word that is ONE placeholder and resolves to nothing is no argument (an optional flag pair);
        // a placeholder inside a word (`-e KEY=@VALUE@`) keeps its word, empty value and all.
        .filter(([word, out]) => out !== '' || !/^@[A-Z0-9_]+@$/.test(word))
        .map(([, out]) => out);
}

// The argv for ONE `claude mcp add`. One site for install, update and the user-scope repair retry:
// three copies of this used to drift apart.
function registerSpec({ name, args, scope, remotes = {}, tokens = {} })
{
    if (args === '@HTTP@')
    {
        const remote = remotes[name] || {};
        const argv = ['mcp', 'add', '--transport', 'http', '--scope', scope, name, remote.url || ''];
        // A remote with no header registers without --header at all, so its OAuth consent flow stays on.
        if (remote.header) argv.push('--header', remote.header);
        return argv;
    }
    return ['mcp', 'add', '--scope', scope, name, ...mcpArgv(args, tokens)];
}

// What the registration SHOULD look like once written, computed from the same manifest words
// `claude mcp add` is given - so a pin bumped this run is itself a mismatch and the entry is
// rewritten. The refresh becomes verified rather than assumed.
function expectShape({ name, args, remotes = {}, tokens = {} })
{
    if (args === '@HTTP@')
    {
        const remote = remotes[name] || {};
        return { name, kind: 'http', url: remote.url || '', header: remote.header || '' };
    }
    return { name, kind: 'stdio', words: mcpArgv(args, tokens) };
}

function wantFor(expect)
{
    if (expect.kind === 'http')
    {
        const want = { type: 'http', url: expect.url };
        if (expect.header)
        {
            const at = expect.header.indexOf(':');
            want.headers = { [expect.header.slice(0, at).trim()]: expect.header.slice(at + 1).trim() };
        }
        return want;
    }
    const words = expect.words || [];
    const env = {};
    let i = 0;
    while (i + 1 < words.length && words[i] === '-e')
    {
        const kv = words[i + 1];
        const at = kv.indexOf('=');
        env[at < 0 ? kv : kv.slice(0, at)] = at < 0 ? '' : kv.slice(at + 1);
        i += 2;
    }
    if (i < words.length && words[i] === '--') i += 1;
    return { type: 'stdio', command: words[i] ?? '', args: words.slice(i + 1), env };
}

const describe = (entry) =>
{
    if (!entry || typeof entry !== 'object') return 'absent';
    if (entry.type === 'http' || entry.url) return `was http ${entry.url || '?'}`;
    const words = [String(entry.command ?? '?'), ...(entry.args || []).slice(0, 3).map(String)];
    return `was stdio ${words.join(' ')}`;
};

// PROJECT SCOPE: `.mcp.json` is the stack-owned file, so it is parsed directly and rewritten entry
// by entry where the shape differs. Unreadable or not-JSON is REPORTED and changes nothing: a file
// this pass cannot understand is never overwritten.
function verifyProject({ mcpFile, expects = [], log = () => {} })
{
    let raw;
    try { raw = fs.readFileSync(mcpFile, 'utf8'); }
    catch (err)
    {
        if (err.code === 'ENOENT') raw = '';
        else { log(`  !! .mcp.json unreadable (${err.message}) - MCP registrations were not verified`); return { repaired: [], read: false }; }
    }
    let data;
    try { data = raw.replace(/^\uFEFF/, '').trim() ? parseJson(raw) : {}; }
    catch { log('  !! .mcp.json is not valid JSON - MCP registrations were not verified; fix it and re-run'); return { repaired: [], read: false }; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
    const servers = (data.mcpServers && typeof data.mcpServers === 'object' && !Array.isArray(data.mcpServers))
        ? data.mcpServers : {};

    const repaired = [];
    for (const expect of expects)
    {
        const want = wantFor(expect);
        const have = servers[expect.name];
        if (isDeepStrictEqual(have, want)) continue;
        servers[expect.name] = want;
        repaired.push({ name: expect.name, was: describe(have) });
    }
    if (repaired.length)
    {
        data.mcpServers = servers;
        fs.writeFileSync(mcpFile, `${JSON.stringify(data, null, 2)}\n`);
        for (const row of repaired) log(`  mcp repaired: ${row.name} (${row.was})`);
    }
    return { repaired: repaired.map((r) => r.name), read: true };
}

// The project's .mcp.json is a tracked file. `claude mcp add` appends the name it writes, and an update re-registers every
// server (remove, then add), so without this the first update after an install rewrote the file in a new key order with the
// same content (re-verify 3 follow-up). snapshotMcp keeps the file as the run found it; keepMcpOrder, once the run's writes
// are done, puts every object's keys back in that order (a new key last) in the file's own indent, line ends and BOM, puts
// back the top-level keys other than mcpServers that the CLI's `mcp add` / `mcp remove` drop (a team's note, say) in their
// old place - and when the content is what it was, the exact bytes it had (re-verify 4 T4). The file is read as bytes, so no
// read another module reshaped (a CRLF-to-LF replacement of fs.readFileSync) can reach the snapshot.
function snapshotMcp(mcpFile)
{
    let raw;
    try { raw = fs.readFileSync(mcpFile).toString('utf8'); } catch { return null; }
    try { return { raw, data: parseJson(raw) }; } catch { return null; }
}
const plainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
function inOrderOf(now, was)
{
    if (Array.isArray(now)) return now.map((v, i) => inOrderOf(v, Array.isArray(was) ? was[i] : undefined));
    if (!plainObject(now)) return now;
    const prior = plainObject(was) ? Object.keys(was).filter((k) => Object.hasOwn(now, k)) : [];
    const keys = [...prior, ...Object.keys(now).filter((k) => !prior.includes(k))];
    return Object.fromEntries(keys.map((k) => [k, inOrderOf(now[k], plainObject(was) ? was[k] : undefined)]));
}
// 'restored' | 'reordered' | 'kept' (already in order) | 'none' (no file before, or none readable now).
function keepMcpOrder({ mcpFile, before })
{
    if (!before || !plainObject(before.data)) return 'none';
    const now = snapshotMcp(mcpFile);
    if (!now || !plainObject(now.data)) return 'none';
    const data = { ...now.data };
    for (const key of Object.keys(before.data)) if (key !== 'mcpServers' && !Object.hasOwn(data, key)) data[key] = before.data[key];
    if (isDeepStrictEqual(data, before.data))
    {
        if (now.raw === before.raw) return 'kept';
        fs.writeFileSync(mcpFile, before.raw);
        return 'restored';
    }
    const bom = before.raw.startsWith('\uFEFF') ? '\uFEFF' : '';
    const indent = (/^\uFEFF?\{\r?\n([ \t]+)"/.exec(before.raw) || [])[1] || 2;
    const eol = before.raw.includes('\r\n') ? '\r\n' : '\n';
    let text = bom + JSON.stringify(inOrderOf(data, before.data), null, indent).replace(/\n/g, eol);
    if (/\r?\n$/.test(before.raw)) text += eol;
    if (text === now.raw) return 'kept';
    fs.writeFileSync(mcpFile, text);
    return 'reordered';
}

// `claude mcp get` PRINTS a stored `${VAR:-default}` as `${VAR}`, so both sides compare with the
// default dropped - as printed, every playwright server read as drifted on every global run.
const shapeNorm = (s) => String(s).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*):-[^}]*\}/g, '${$1}');

// 'http|<url>' / 'stdio|<command> <args>' as `claude mcp get` reports it; '' when unreadable.
function parseGetShape(text)
{
    let type = ''; let url = ''; let command = ''; let args = '';
    for (const line of String(text || '').split('\n'))
    {
        let m;
        if ((m = /^\s*Type:\s*(\S+)/.exec(line))) type = m[1];
        else if ((m = /^\s*URL:\s*(\S+)/.exec(line))) url = m[1];
        else if ((m = /^\s*Command:\s*(\S+)/.exec(line))) command = m[1];
        else if ((m = /^\s*Args:\s*(.*)$/.exec(line))) args = m[1];
    }
    if (type === 'http') return `http|${url}`;
    return type ? `stdio|${command} ${args}` : '';
}

// The same shape from the manifest side: the leading env pairs and the `--` separator are not in `mcp get`'s
// Command / Args lines, so they are dropped before the compare - only those (wantFor's split): a `-e` or `--` inside the
// command's own args stays, as it does in the anchored rows' `node -e <ROOT_BOOT> -- <anchor> ...` (re-verify 3 S2), which
// otherwise read as drifted on every run.
function wantShape(expect)
{
    if (expect.kind === 'http') return shapeNorm(`http|${expect.url}`);
    const want = wantFor(expect);
    return shapeNorm(`stdio|${[want.command, ...want.args].join(' ')}`);
}

// USER AND LOCAL SCOPE (S8: every line names the run's scope): the registration lives in the account config, which this seed never hand-edits. The
// check runs through `claude mcp get`, a mismatch is retried once through the CLI, and anything
// still wrong is REPORTED - never silently accepted. N4: the retry removes first, so a name `owned`
// cannot vouch for (the caller's read of the account file did not show the stack's own registration
// there) is named once and left alone - it may be the user's own server under a stack name.
function verifyUser({ expects = [], scope, getShape, reregister, owned = () => true, log = () => {}, note = () => {} })
{
    const repaired = [];
    for (const expect of expects)
    {
        const want = wantShape(expect);
        let have = shapeNorm(parseGetShape(getShape(expect.name)));
        if (!have) continue;                       // an older CLI, or a server the config does not expose
        if (have === want) continue;
        if (!owned(expect.name))
        {
            log(`  !! mcp ${expect.name}: the ${scope}-scope registration differs from the stack's shape and is not known to be the stack's own - not re-registered, so nothing of yours is removed; if it should go: claude mcp remove ${expect.name} -s ${scope}, then re-run`);
            continue;
        }
        log(`  mcp shape drifted at ${scope} scope: ${expect.name} - re-registering`);
        reregister(expect.name, scope);
        have = shapeNorm(parseGetShape(getShape(expect.name)));
        if (have && have !== want)
            note(`mcp ${expect.name} could not be brought to the current shape at ${scope} scope (claude mcp remove ${expect.name} -s ${scope}) - remove it by hand and re-run`);
        else { repaired.push(expect.name); log(`  mcp repaired: ${expect.name} (${scope} scope)`); }
    }
    return { repaired };
}

// The runtime versions this run pins to: the RELEASE's, from the snapshot's meta/mcp-pins.json (R35) -
// the versions the generated plugin entries launch, so the copy route, the plugin route and the
// browser download all run one server version. The seed asks NO registry: a lookup at install time
// had two installs a week apart run different server code from one release, and it left the
// download at the registry's latest while the plugin launched the pin. A package with no usable row
// installs unpinned, the generator's own fallback.
//
// The memory pin is spelled `==<ver>` INSIDE the extras brackets, not `@<ver>` like the others,
// which have no extras suffix to sit next to - each row names its own spelling. The desktop servers
// take `==<ver>` too (`--from windows-mcp==<ver>`).
const PIN_ROWS = {
    browser: ['PW_PIN', '@<v>'], navigation: ['SERENA_PIN', '@<v>'], memory: ['MEMORY_PIN', '==<v>'],
    'windows-desktop': ['WINDOWS_DESKTOP_PIN', '==<v>'], 'macos-desktop': ['MACOS_DESKTOP_PIN', '==<v>'],
};

function resolvePins({ pins, refreshed, own = '', log = () => {} })
{
    const rows = pins && typeof pins === 'object' && !Array.isArray(pins) ? pins : {};
    // M24: the release's dependency cut-off for every uvx row (uv-python.js excludeNewerOf) - two words,
    // each '' when the pins file names no day, so the row then carries no cut-off at all (mcpArgv).
    // `own` is the user's UV_EXCLUDE_NEWER (uv-python.js userExcludeNewer): their value replaces it, `false` none -
    // a baked flag would beat their variable, and a mirror with no upload times serves nothing under a cut-off.
    const release = excludeNewerOf(refreshed);
    const cutoff = cutoffFor(release, own);
    if (own) log(`  UV_EXCLUDE_NEWER=${own} is set - every uvx server starts with ${cutoff ? `the cut-off ${cutoff}` : 'no dependency cut-off'} (the release's: ${release || 'none'})`);
    const out = { MEMORY_BACKEND: 'sqlite_vec', versions: {}, UV_EXCLUDE_FLAG: cutoff ? '--exclude-newer' : '', UV_EXCLUDE_NEWER: cutoff };
    for (const [name, [token, spelling]] of Object.entries(PIN_ROWS))
    {
        const row = rows[name] && typeof rows[name] === 'object' ? rows[name] : {};
        const version = typeof row.version === 'string' && /^[0-9][0-9A-Za-z.+-]*$/.test(row.version) ? row.version : '';
        out.versions[name] = version;
        out[token] = version ? String(row.spelling || spelling).replace('<v>', version) : '';
        if (version) log(`  pinned ${name}@${version} (the release pin)`);
        else log(`  !! no release pin for ${name} in this source - installing unpinned`);
    }
    return out;
}

// ONE server drives ONE browser, fixed at launch (`--browser`; the server has no tool to switch it
// - measured), so the manifest's single `playwright` row expands into one entry per kept engine,
// each with its own profile folder, because a persistent profile belongs to one engine. The manifest
// spells the folder `@BROWSER_DIR@`, which becomes that engine's own token `@BROWSER_DIR_<ENGINE>@` - the
// run resolves each to where the engine's profile lives (the data root, or a 2.0.0 .playwright/<engine>
// not moved yet); a folder spelled any other way gets `/<engine>` appended, as before the data root.
function pwArgsFor(args, engine)
{
    const words = String(args).split(/\s+/).filter(Boolean);
    const own = `@BROWSER_DIR_${engine.toUpperCase()}@`;
    const out = [];
    for (let i = 0; i < words.length; i += 1)
    {
        let word = words[i];
        if (word.includes('@BROWSER_DIR@')) word = word.split('@BROWSER_DIR@').join(own);
        else if (words[i - 1] === '--user-data-dir') word = `${word}/${engine}`;
        out.push(word);
        if (/^@playwright\/mcp/.test(word)) out.push('--browser', engine);
    }
    return out.join(' ');
}

// The kept set: the flag, else what is already there (registered, listed, or picked in the stamp),
// else chrome. A legacy `playwright` server counts as its own --browser engine.
function playwrightKept({ browsers = [], registered = [] })
{
    if (browsers.length) return [...browsers];
    const have = new Set(registered);
    const kept = PW_ENGINES.filter((e) => have.has(e));
    return kept.length ? kept : ['chrome'];
}

function expandPlaywright({ mcps = [], browsers = [], registered = [] })
{
    const has = mcps.some((e) => String(e).split('|')[0] === 'browser');
    if (!has) return { mcps: [...mcps], browsers: [] };
    const kept = playwrightKept({ browsers, registered });
    const out = [];
    for (const entry of mcps)
    {
        const [name, args] = [String(entry).split('|')[0], String(entry).slice(String(entry).indexOf('|') + 1)];
        if (name !== 'browser') { out.push(entry); continue; }
        for (const engine of kept) out.push(`browser-${engine}|${pwArgsFor(args, engine)}`);
    }
    return { mcps: out, browsers: kept };
}

// Which of the kept engines are ENABLED (R67). `flag` is the user's answer - `all`, a set, or [] for
// none - and is APPLIED to engines already installed. With no answer (null) nothing is applied: an
// engine `live` has a word on keeps it (R116: one registered in .mcp.json is on unless
// disabledMcpjsonServers names it - the user's own switch on the copy route), else the one the stamp
// recorded keeps its last choice, and one recorded nowhere is enabled. `off` is what an engine this run
// installs is switched to right after; `outside` names what the flag asks to enable but this run does
// not install, which the caller refuses.
function playwrightEnabled({ kept = [], flag = null, prior = {}, live = () => undefined })
{
    const recorded = (e) => Array.isArray(prior.browsers) && Array.isArray(prior.enabled) && prior.browsers.includes(e);
    let enabled;
    if (flag === 'all') enabled = [...kept];
    else if (Array.isArray(flag)) enabled = kept.filter((e) => flag.includes(e));
    else enabled = kept.filter((e) => { const on = live(e); return on === undefined ? !recorded(e) || prior.enabled.includes(e) : on; });
    return {
        enabled,
        off: kept.filter((e) => !enabled.includes(e)),
        apply: flag !== null,
        outside: Array.isArray(flag) ? flag.filter((e) => !kept.includes(e)) : [],
    };
}

// The two sets configure's walk pre-selects (the --plan-out `browser` field): the kept engines,
// and of them the ones ON NOW. `live(engine)` is the install scope's settings file - the file a /plugin
// toggle writes, so an unchanged answer equals the live state and switches nothing. Only an engine that
// file does not name falls back to the stamp's last answer, and one with no record to on.
function playwrightLive({ kept = [], prior = {}, live = () => undefined })
{
    const recorded = playwrightEnabled({ kept, flag: null, prior }).enabled;
    return {
        installed: [...kept],
        enabled: kept.filter((e) => { const on = live(e); return on === undefined ? recorded.includes(e) : on; }),
    };
}

// R116 (j): what disabledMcpjsonServers gains and loses this run. On the copy route at project scope an
// engine left off is registered AND listed, and the list moves only when the enable choice does: an
// answer (`apply`) sets every kept engine, and with none only an engine registered NOW that is off is
// listed - so one the user took out by hand stays out. A name with no registration here any more (a
// dropped engine, or every engine on the plugin route, where .mcp.json holds none) leaves the list. At
// local and user scope the registration is not in .mcp.json and no settings key reaches it (measured on
// 2.1.282: this list rejects only .mcp.json servers, and disabledMcpServers is read from the account
// config alone, which the installer never edits) - so there the registration IS the enable (R124 l):
// `unregistered` names the engines left off, which the run does not register and removes if an earlier
// run did. The stamp still records each as installed-off, so a later enable answer registers it.
function mcpjsonSwitch({ routes = {}, scope = 'project', kept = [], enabled = [], apply = false, registered = [] })
{
    const name = (e) => `browser-${e}`;
    const gone = PW_SERVERS.filter((n) => routes.mcps || !kept.map(name).includes(n));
    const off = routes.mcps ? [] : kept.filter((e) => !enabled.includes(e));
    if (routes.mcps) return { disable: [], enable: gone, off, unregistered: [] };
    if (scope !== 'project') return { disable: [], enable: [], off, unregistered: off.map(name) };
    return {
        disable: off.filter((e) => apply || !registered.includes(e)).map(name),
        enable: [...gone, ...(apply ? kept.filter((e) => enabled.includes(e)).map(name) : [])],
        off, unregistered: [],
    };
}

// R124 (m): the names enabledMcpjsonServers pre-approves - the .mcp.json servers THIS run registers and
// does not name in disabledMcpjsonServers. Only a project-scope copy-route run writes .mcp.json, and a
// locked server rides its plugin while the core is on, so neither a plugin-carried name nor an engine
// left off is ever trusted here.
function mcpjsonTrusted({ routes = {}, scope = 'project', mcps = [], off = [] })
{
    if (routes.mcps || scope !== 'project') return [];
    const offNames = off.map((e) => `browser-${e}`);
    return bareNamedMcps({ routes, mcps }).filter((n) => !offNames.includes(n));
}

// The playwright servers this run no longer keeps - a legacy `playwright` and every dropped engine.
// Nothing on the plugin route: the engines are one plugin each, and one the run no longer keeps is
// uninstalled by the plugin layer - there is no per-engine registration to drop.
function playwrightDrop({ routes, browsers = [] })
{
    if (routes.mcps) return [];
    if (!browsers.length) return [];
    const keep = new Set(browsers.map((b) => `browser-${b}`));
    return PW_SERVERS.filter((name) => !keep.has(name));
}

// COPY ROUTE ONLY: a registered server answers `mcp__<server>__<tool>`, never the plugin spelling
// the shipped files carry. Only the names THIS run registered bare are re-spelled - on a hooks-only
// copy route the locked three are still plugins beside the core, and re-spelling them was the bug this
// list exists to prevent.
const TOOL_NAME_RE = /mcp__plugin_[A-Za-z0-9][A-Za-z0-9.-]*_([A-Za-z0-9][A-Za-z0-9.-]*)__/g;
const DOWNCONVERT_EXT = ['.md', '.mdc', '.js', '.json', '.txt'];

// One text re-spelled: each plugin tool name whose server is in `bare` takes the registered spelling.
// The rules copy renders through this too, so a rule is compared with the text it will hold (R111).
function respellToolNames(body, bare = [])
{
    const names = new Set(bare);
    if (!names.size) return body;
    return String(body).replace(TOOL_NAME_RE, (full, server) => (names.has(server) ? `mcp__${server}__` : full));
}

// The servers a copied text already names by the registered spelling - the evidence library-check reads
// to compare the shipped source with the text the installer wrote (it never sees the run's routes).
function bareServersIn(text)
{
    return [...new Set([...String(text).matchAll(/mcp__(?!plugin_)([A-Za-z0-9][A-Za-z0-9.-]*)__/g)].map((m) => m[1]))];
}

function downconvertToolNames({ roots = [], bare = [], log = () => {} })
{
    const names = new Set(bare);
    if (!names.size) return 0;
    let changed = 0;
    const walk = (dir) =>
    {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const entry of entries)
        {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!DOWNCONVERT_EXT.includes(path.extname(entry.name))) continue;
            let body;
            try { body = fs.readFileSync(full, 'utf8'); }
            catch { continue; }
            const fixed = respellToolNames(body, bare);
            if (fixed === body) continue;
            try { fs.writeFileSync(full, fixed); changed += 1; }
            catch { /* a read-only tree says so elsewhere */ }
        }
    };
    for (const root of roots) walk(root);
    if (changed) log(`  copy route: MCP tool names re-spelled to the registered server names in ${changed} file(s)`);
    return changed;
}

// C10 (R136 q): the scope the copy route registers at. The run's own, except at user scope on the FULL
// copy route: there the locked three went to `mcp add --scope user`, which reaches every project on the
// account - another project's navigation and memory servers ran twice beside its plugins and its documentation tools
// turned bare. Every server that route registers goes to THIS project's .mcp.json instead.
const registrationScope = (routes, scope) => (scope === 'user' && !corePluginOn(routes) ? 'project' : scope);

// A-M2 / A-M3: WHICH server a registration runs - the url it calls, or the package it launches - the
// part of its shape that does not move with a pin, a flag, a path or the Windows `cmd /c` wrapper. A
// registration of the stack's own shape is the stack's to remove; another under the same name is the
// user's. '' when the entry names neither.
const VALUED_FLAGS = ['--python', '--with', '--from', '--package', '-p', '--index-url', '--extra-index-url', '--exclude-newer'];
function packageName(word)
{
    let w = String(word || '').replace(/@[A-Z][A-Z0-9_]*@/g, '').replace(/\[[^\]]*\]/, '');
    w = w.split(/==|>=|<=|~=/)[0];
    const at = w.lastIndexOf('@');
    return at > 0 ? w.slice(0, at) : w;
}
// Re-verify 3 S2: the copy route's project-anchored rows start `node -e <ROOT_BOOT> -- <checkout|project> <command> ...`
// (stack/hooks/memory.js runAtRoot) - the launcher, never the server, which is the command after the anchor. The Windows
// `cmd /c` wrapper an older release wrote goes the same way.
const ANCHORS = ['checkout', 'project'];
// The server's words and, for an anchored row, the anchor code it runs (null for an unanchored one). Any code naming
// runAtRoot is an anchor for identity; vouching reads the code itself (exactStack, re-verify 4 T5).
function anchorOf(entry)
{
    let words = [String(entry.command ?? ''), ...(Array.isArray(entry.args) ? entry.args.map(String) : [])];
    if (/^cmd(\.exe)?$/i.test(words[0]) && /^\/c$/i.test(words[1] || '')) words = words.slice(2);
    const anchored = /^node(\.exe)?$/i.test(path.basename(words[0] || '')) && words[1] === '-e' && /^@ROOT_BOOT@$|runAtRoot/.test(words[2] || '')
        && words[3] === '--' && ANCHORS.includes(words[4]);
    return anchored ? { words: words.slice(5), code: words[2] } : { words, code: null };
}
const serverWords = (entry) => anchorOf(entry).words;
function identityOf(entry)
{
    if (!entry || typeof entry !== 'object') return '';
    if (entry.url || entry.type === 'http' || entry.type === 'sse') return `http:${String(entry.url || '').replace(/\/+$/, '')}`;
    const words = serverWords(entry);
    const rest = words.slice(1);
    const from = rest.findIndex((w) => w === '--from' || w === '--package' || w === '-p');
    let pkg = from > -1 ? rest[from + 1] : '';
    for (let i = 0; !pkg && i < rest.length; i += 1)
    {
        if (VALUED_FLAGS.includes(rest[i])) { i += 1; continue; }
        if (!rest[i].startsWith('-')) pkg = rest[i];
    }
    return pkg ? `stdio:${packageName(pkg)}` : '';
}

// Every identity the stack has registered under each name: the catalog's own (a pin never counts), each
// playwright engine and the 1.x single `playwright`, the 1.x local context7 (`--context7 local` put the
// npx transport under the context7 name itself), and each retired server's `registration`
// (meta/retired-plugins.json) - what the stack wrote, never the add-back line the user may have run.
function stackIdentities({ catalog = [], remotes = {}, tokens = {}, retiredRows = [], renamed = {} })
{
    const out = {};
    const add = (name, id) => { if (id) (out[name] ||= new Set()).add(id); };
    for (const entry of catalog)
    {
        const text = String(entry);
        const name = text.split('|')[0];
        const id = identityOf(wantFor(expectShape({ name, args: text.slice(text.indexOf('|') + 1), remotes, tokens })));
        add(name, id);
        if (name === 'browser') for (const n of PW_SERVERS) add(n, id);
    }
    add('context7', 'stdio:@upstash/context7-mcp');
    // An old name (the 2.0.0 rename) was registered with its successor's shape.
    for (const old of renamedFrom(renamed))
        for (const id of out[currentMcp(old, renamed)] || []) add(old, id);
    for (const row of retiredRows)
    {
        const reg = row && row.registration;
        if (reg && reg.url) add(row.name, `http:${String(reg.url).replace(/\/+$/, '')}`);
        else if (reg && reg.package) add(row.name, `stdio:${packageName(reg.package)}`);
    }
    return out;
}

// R10 THE LEDGER: the .mcp.json entries this run MANAGES (`managed-mcp`, name -> hash of the entry) -
// registered by it now, recorded by the last run and unchanged since, or, with no ledger to read (a
// stamp from before R10), of a stack name and the stack's own shape (`adopt`). An entry changed since
// the stack wrote it is the user's, like one it never wrote.
function managedMcp({ servers = {}, prior = null, written = [], adopt = () => false })
{
    const out = {};
    for (const [name, entry] of Object.entries(servers || {}))
    {
        const hash = entryHash(entry);
        if (written.includes(name) || (prior ? prior[name] === hash : adopt(name, entry))) out[name] = hash;
    }
    return out;
}

// Uninstall's half: each managed entry whose hash still matches goes, and the file with them when
// nothing else is left in it. A file that cannot be read is left exactly as it is. The installer
// never hand-edits the ACCOUNT config, so this is .mcp.json alone - the ledger's local- and user-scope
// registrations go through the CLI, or are printed (uninstall.js removeScopedMcp).
function removeManagedMcp({ mcpFile, managed = {}, log = () => {}, note = () => {} })
{
    const removed = [];
    if (!Object.keys(managed).length || !fs.existsSync(mcpFile)) return { removed };
    let raw;
    try { raw = fs.readFileSync(mcpFile, 'utf8'); }
    catch (err) { note(`.mcp.json could not be read (${err.code || err.message}) - left untouched, nothing of the stack's was removed from it; fix it and re-run`); return { removed }; }
    let data;
    try { data = parseJson(raw); }
    catch { note('.mcp.json is not valid JSON - left untouched, nothing of the stack\'s was removed from it; fix it and re-run'); return { removed }; }
    const servers = data && typeof data.mcpServers === 'object' && !Array.isArray(data.mcpServers) ? data.mcpServers : null;
    if (!servers) return { removed };
    for (const [name, hash] of Object.entries(managed))
    {
        if (!Object.hasOwn(servers, name)) continue;
        if (entryHash(servers[name]) !== hash) { log(`  mcp ${name}: kept - changed since the stack registered it, so it is yours`); continue; }
        delete servers[name];
        removed.push(name);
        log(`  mcp removed: ${name} (.mcp.json)`);
    }
    if (!removed.length) return { removed };
    if (!Object.keys(servers).length && Object.keys(data).length === 1) { fs.rmSync(mcpFile, { force: true }); log('  .mcp.json removed - it held nothing but the stack\'s servers'); }
    else fs.writeFileSync(mcpFile, `${JSON.stringify(data, null, 2)}\n`);
    return { removed };
}

// The registrations one scope holds: `.mcp.json` at project scope; the account's `.claude.json` - its
// top-level `mcpServers` at user scope, `projects[<root>].mcpServers` at local scope. `absent` (no
// file) holds nothing; `unreadable` is said by the caller and removes nothing.
function registrationsAt({ scope, mcpFile, accountFile, projectRoot })
{
    const file = scope === 'project' ? mcpFile : accountFile;
    let data;
    try { const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); data = raw.trim() ? JSON.parse(raw) : scope === 'project' ? {} : null; }
    catch (err) { return err.code === 'ENOENT' ? { state: 'absent', servers: {}, file } : { state: 'unreadable', servers: {}, file }; }
    // The account file is the CLI's own and whole only as an object: it replaces a 0-byte one as corrupt and rewrites an
    // array or a scalar in place (measured on 2.1.284) - either way what it held is gone (review 2.1.6 B1).
    if (scope !== 'project' && (!data || typeof data !== 'object' || Array.isArray(data))) return { state: 'unreadable', servers: {}, file };
    let servers = data && data.mcpServers;
    // The account file also says whether it is the one the CLI wrote for this project (review 2.1.6 re-verify N3): a file
    // the CLI recovered or rewrote holds no entry for it and no firstStartTime, while the user's own removal of every
    // registration leaves both.
    let entry = true;
    if (scope === 'local')
    {
        const projects = (data && data.projects) || {};
        let real = projectRoot;
        try { real = fs.realpathSync(projectRoot); } catch { /* the path as given */ }
        const held = projects[projectRoot] || projects[real];
        entry = Boolean(held);
        servers = (held || {}).mcpServers;
    }
    const read = { state: 'read', servers: servers && typeof servers === 'object' && !Array.isArray(servers) ? servers : {}, file };
    return scope === 'project' ? read : { ...read, entry, started: typeof data.firstStartTime === 'string' ? data.firstStartTime : '' };
}

// F1 (review 2.1.6 B1): the claude CLI keeps an account file it cannot parse (a 0-byte one too) as
// `backups/.claude.json.corrupted.<ms>` in its config folder when it replaces it, beside its own last good copies,
// `.claude.json.backup.<ms>` (measured on 2.1.284). Every file of the `kind` under `dirs`, oldest first.
const ACCOUNT_BACKUP = { corrupted: /^\.claude\.json\.corrupted\.(\d+)$/, good: /^\.claude\.json\.backup\.(\d+)$/ };
function accountBackups(dirs, kind = 'corrupted')
{
    const rows = [];
    for (const dir of new Set(dirs))
    {
        let names = [];
        try { names = fs.readdirSync(dir); } catch { continue; }
        for (const name of names)
        {
            const m = ACCOUNT_BACKUP[kind].exec(name);
            if (m) rows.push({ file: path.join(dir, name), ms: Number(m[1]) });
        }
    }
    return rows.sort((a, b) => a.ms - b.ms);
}

// Whether the stack's registrations at one scope left the account file since the last run - decided from the stamp, never
// from the file's parse state at one moment, since every command makes a claude call before the installer and that call
// replaces a corrupt file (review 2.1.6 B1). The first that holds:
//  - 'unreadable': the file cannot be read now;
//  - 'replaced': a corrupted backup the CLI wrote after the stamp - to the millisecond where the stamp records it
//    (`installed-ms:`, stamp.readInstalledAt), else from the second after its whole-second `installed:` (the run's own
//    backup lands before its stamp);
//  - 'emptied': the ledger records registrations here, the file holds none of them, and the file is a rewritten one -
//    no entry for this project (`entry`: a recovered file, or a moved folder) or no firstStartTime or one after the
//    stamp (`started`: a fresh file) - so the user's own removal of every registration is never overridden (N3).
// `backup` names the newest corrupted backup from the stamp on.
function accountLoss({ unreadable = false, backups = [], stamped = { ms: NaN, precise: false }, recorded = {}, held = {}, entry = true, started = null })
{
    const at = stamped.ms;
    const floor = Number.isFinite(at) ? (stamped.precise ? at : Math.floor(at / 1000) * 1000) : NaN;
    const later = (b) => (stamped.precise ? b.ms > at : b.ms >= floor + 1000);
    const since = backups.filter((b) => (stamped.precise ? b.ms > at : b.ms >= floor));
    const backup = since.length ? since[since.length - 1].file : '';
    if (unreadable) return { lost: true, why: 'unreadable', backup };
    if (backups.some(later)) return { lost: true, why: 'replaced', backup };
    const names = Object.keys(recorded);
    const fresh = started === '' || (typeof started === 'string' && Date.parse(started) > at);
    if (names.length && !names.some((n) => Object.hasOwn(held, n)) && (!entry || fresh)) return { lost: true, why: 'emptied', backup };
    return { lost: false, why: '', backup };
}

// Review 2.1.6 (the user's ruling): marks only the stack's own registration carries - never the package name alone
// (identityOf), which a server the user added with the same upstream shares. A uvx server: the release's dependency
// cut-off (`--exclude-newer <date>`) with a pinned `--from <pkg>==<ver>`, and for a desktop server its telemetry off
// (`ANONYMIZED_TELEMETRY=false`); a browser engine: its profile under the data root (`--user-data-dir .../browser/<engine>`)
// with `--no-webmcp`, and only an engine the stamp's `browser-engines:` lists (`engines`).
function stackAuthored(name, entry, { engines = [] } = {})
{
    if (!entry || typeof entry !== 'object') return false;
    const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
    const after = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] || '' : ''; };
    const engine = /^browser-(\w+)$/.exec(name);
    if (engine)
        return engines.includes(engine[1]) && args.includes('--no-webmcp')
            && new RegExp(`(^|[\\\\/])browser[\\\\/]${engine[1]}$`).test(after('--user-data-dir').replace(/[\\/]+$/, ''));
    if (!/^\d{4}-\d{2}-\d{2}/.test(after('--exclude-newer')) || !/^[^=\s]+==[^=\s]+$/.test(after('--from'))) return false;
    const env = entry.env && typeof entry.env === 'object' ? entry.env : {};
    return !/-desktop$/.test(name) || env.ANONYMIZED_TELEMETRY === 'false';
}

// Re-verify 3 S1 / S4 / S7: a registration no ledger row vouches for is the stack's only in the release template's EXACT
// shape - the template's words one for one and its env keys exactly, free only where a token sits (a pin, the cut-off date,
// the python, a path). The package and marks alone are shared by a server the user registers under a stack name, which
// usually adds a flag or an env key. A whole-word token matches one word that is no flag, unless TOKEN_WORDS gives it its
// own shape (the cut-off pair and serena's project word may be absent); an engine's profile is its own folder. The Windows
// wrapper is no difference (serverWords), and an older release's unanchored row matches too. Re-verify 4 T5: an anchored
// row runs this release's ROOT_BOOT or one an earlier release registered (`boots`) - code of the user's own that merely
// names runAtRoot is not the stack's - and an engine's profile is the project's own: relative (inside it), or absolute under
// `projectRoot`. Another project's profile, or the user's own folder that happens to end browser/<engine>, is not.
const TOKEN_WORDS = {
    UV_EXCLUDE_FLAG: { optional: true, re: /^--exclude-newer$/ },
    UV_EXCLUDE_NEWER: { optional: true, re: /^\d{4}-\d{2}-\d{2}\S*$/ },
    SERENA_PROJECT_FLAG: { optional: false, re: /^--project(-from-cwd)?$/ },
    SERENA_PROJECT_DIR: { optional: true, re: /^\.$/ },
};
const TOKEN_RE = /@[A-Z][A-Z0-9_]*@/g;
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function wordMatcher(word)
{
    const whole = /^@([A-Z][A-Z0-9_]*)@$/.exec(word);
    if (whole) return { optional: false, re: /^(?!-)\S/, ...(TOKEN_WORDS[whole[1]] || {}) };
    if (!word.match(TOKEN_RE)) return { optional: false, re: new RegExp(`^${escapeRe(word)}$`) };
    return { optional: false, re: new RegExp(`^${word.split(TOKEN_RE).map(escapeRe).join('\\S*')}$`) };
}
function wordsMatch(template, words, i = 0, j = 0)
{
    if (i === template.length) return j === words.length;
    const m = template[i];
    if (m.optional && wordsMatch(template, words, i + 1, j)) return true;
    return j < words.length && m.re.test(words[j]) && wordsMatch(template, words, i + 1, j + 1);
}
const STACK_BOOTS = (() => { const e = require('../../stack/hooks/memory.js'); return [e.ROOT_BOOT, ...(e.FORMER_ROOT_BOOTS || [])]; })();
function ownProfile(dir, projectRoot)
{
    const d = String(dir).replace(/^\$\{CLAUDE_PROJECT_DIR(?::-[^}]*)?\}[\\/]/, '');
    if (!path.win32.isAbsolute(d) && !path.posix.isAbsolute(d)) return !d.split(/[\\/]/).includes('..');
    if (!projectRoot) return false;
    const roots = [path.resolve(projectRoot)];
    try { roots.push(fs.realpathSync(projectRoot)); } catch { /* not on disk */ }
    return roots.some((root) => { const rel = path.relative(root, path.resolve(d)); return Boolean(rel) && !rel.split(/[\\/]/).includes('..') && !path.isAbsolute(rel); });
}
function exactStack(name, entry, { catalog = [], remotes = {}, projectRoot = '', boots = STACK_BOOTS } = {})
{
    if (!entry || typeof entry !== 'object') return false;
    const engine = /^browser-(\w+)$/.exec(name);
    const row = catalog.map(String).find((e) => e.split('|')[0] === (engine ? 'browser' : name));
    if (!row) return false;
    let args = row.slice(row.indexOf('|') + 1);
    if (args === '@HTTP@')
    {
        const want = wantFor(expectShape({ name, args, remotes }));
        const headers = entry.headers && typeof entry.headers === 'object' ? entry.headers : {};
        const wantHeaders = want.headers || {};
        return String(entry.url || '').replace(/\/+$/, '') === want.url.replace(/\/+$/, '')
            && isDeepStrictEqual(Object.keys(headers).sort(), Object.keys(wantHeaders).sort())
            && Object.keys(wantHeaders).every((k) => shapeNorm(headers[k]) === shapeNorm(wantHeaders[k]));
    }
    if (entry.url || entry.type === 'http' || entry.type === 'sse') return false;
    if (engine) args = pwArgsFor(args, engine[1]);
    // The template split as wantFor splits a registration: its env pairs, then the command words.
    const want = wantFor({ kind: 'stdio', words: String(args).split(/\s+/).filter(Boolean) });
    const env = entry.env && typeof entry.env === 'object' ? entry.env : {};
    if (!isDeepStrictEqual(Object.keys(env).sort(), Object.keys(want.env).sort())) return false;
    // An env value is free wherever a token sits in it (any text, empty included); the rest of it is literal.
    const envRe = (v) => new RegExp(`^${String(v).split(TOKEN_RE).map(escapeRe).join('[^]*')}$`);
    if (!Object.entries(want.env).every(([k, v]) => envRe(v).test(String(env[k])))) return false;
    const { words, code } = anchorOf(entry);
    if (code !== null && !boots.includes(code)) return false;
    if (!wordsMatch(serverWords(want).map(wordMatcher), words)) return false;
    if (!engine) return true;
    const dir = words[words.indexOf('--user-data-dir') + 1] || '';
    return ownProfile(dir, projectRoot) && new RegExp(`(^|[\\\\/])(browser|\\.playwright)[\\\\/]${engine[1]}$`).test(dir.replace(/[\\/]+$/, ''));
}

// What takes a plugin-carried server's place. Claude Code connects to a server ONCE, from the highest
// source - local, project, user, then plugins - and matches a PLUGIN server against those three by
// ENDPOINT, not by name (code.claude.com/docs/en/mcp, scope precedence). Measured on 2.1.282 through the
// session's init row: a user- or project-scope registration of the Context7 url, under `context7` or
// any other name, left the documentation plugin out of the session, so every `mcp__plugin_documentation_documentation__`
// spelling the stack ships (its tool grants, alfred-quality-gates' ToolSearch line) resolved nothing.
// A stdio server matches on command AND args, which a launcher-started plugin entry never shares, so a
// same-NAMED stdio registration runs BESIDE the plugin's own server - a second one. One row per
// registration, in precedence order: `{ scope, name, plugin, kind: 'replaces' | 'beside' }`.
const PLUGIN_ENDPOINTS = { documentation: () => `http:${CONTEXT7_REMOTE.url}` };
function shadowingRegistrations({ plugins = [], scopes = {} })
{
    const rows = [];
    for (const scope of ['local', 'project', 'user'])
    {
        for (const [name, entry] of Object.entries(scopes[scope] || {}))
        {
            const id = identityOf(entry);
            const replaced = plugins.find((plugin) => PLUGIN_ENDPOINTS[plugin] && PLUGIN_ENDPOINTS[plugin]() === id);
            if (replaced) rows.push({ scope, name, plugin: replaced, kind: 'replaces' });
            else if (plugins.includes(name)) rows.push({ scope, name, plugin: name, kind: 'beside' });
        }
    }
    return rows;
}

// Every playwright engine runs with a PERSISTENT profile under <project>/.playwright/<engine> - the
// cookies and storage of whatever site a check logged into - on the plugin and the copy route alike.
// The folder only appears once a browser has run, after setup's git-hygiene step has looked for it, so
// a kept engine gets the folder's own `.gitignore` (`*`), the way a project-level memory database does
// (memory.ensureProjectIgnore). An existing one is the user's, left alone.
function ensurePlaywrightIgnore({ projectRoot, engines = [], log = () => {} })
{
    if (!engines.length) return false;
    const ignore = path.join(projectRoot, '.playwright', '.gitignore');
    if (fs.existsSync(ignore)) return false;
    fs.mkdirSync(path.dirname(ignore), { recursive: true });
    fs.writeFileSync(ignore, '*\n');
    log('  browser: .playwright/.gitignore written - the browser profiles hold session cookies and are never committed');
    return true;
}

// The hosted Context7 - the one transport since 2.0.0 cut the local npx one (R32) - as the documentation
// plugin entry registers it: `:-` sends an EMPTY header when the key is unset - the keyless free tier -
// where a literal `${CONTEXT7_API_KEY}` is rejected as an invalid key. The header is Context7's documented
// `Context7-API-Key` (M25): a proxy may drop a name with an underscore, and the key with it.
const CONTEXT7_REMOTE = { url: 'https://mcp.context7.com/mcp', header: 'Context7-API-Key: ${CONTEXT7_API_KEY:-}' };

// R83 a: every LOCKED server's catalog entry, added where `mcps` lacks it. On the FULL copy route the
// registrations come from this list alone, and a selection or read-back with no `mcp` line (the
// always-on adoption fills only a layer that has one) left it empty - a plugin-route install switched
// to the copies registered none of the three. Logged by name.
function withLocked({ mcps = [], catalog = [], log = () => {} })
{
    const have = new Set(mcps.map((e) => String(e).split('|')[0]));
    const out = [...mcps];
    for (const entry of catalog)
    {
        const name = String(entry).split('|')[0];
        if (!isLocked(name) || have.has(name)) continue;
        out.push(entry);
        have.add(name);
        log(`  mcp ${name}: locked - registered on the full copy route whatever the selection names`);
    }
    return out;
}

// THE DESKTOP GATE (stack/mcp/desktop-launch.js owns which OS each desktop server drives). One this
// machine cannot run is left out of the run with one line naming why - whatever put it in the list: a
// walk's wpf / winforms seed, an --add, or a read-back of a row another machine enabled at project scope,
// which nothing here removes (it is simply not in the set this run installs, updates or switches) - its
// line names the local-scope disable that keeps it off on this machine only, under `market`.
function desktopGate({ mcps = [], platform, market })
{
    const kept = [];
    const lines = [];
    for (const entry of mcps)
    {
        const name = String(entry).split('|')[0];
        if (offeredOn(name, platform)) kept.push(entry);
        else lines.push(skipNote(name, platform, market));
    }
    return { kept, lines };
}

module.exports = {
    CONTEXT7_REMOTE, LOCKED, desktopGate, PW_ENGINES, PW_SERVERS, isLocked, corePluginOn, withLocked, currentMcp, renamedFrom,
    retiredMcps, dueRetired, bareNamedMcps, mcpArgv, registerSpec, expectShape, wantFor,
    verifyProject, verifyUser, shapeNorm, parseGetShape, wantShape, snapshotMcp, keepMcpOrder,
    playwrightDrop, downconvertToolNames, respellToolNames, bareServersIn, resolvePins, pwArgsFor, playwrightKept, expandPlaywright, playwrightEnabled, playwrightLive, mcpjsonSwitch, mcpjsonTrusted,
    registrationScope, identityOf, exactStack, packageName, stackIdentities, registrationsAt, accountBackups, accountLoss, stackAuthored, shadowingRegistrations, ensurePlaywrightIgnore,
    managedMcp, removeManagedMcp,
};
