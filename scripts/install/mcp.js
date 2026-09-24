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
//   - R7, THE LOCKED THREE. serena, context7 and memory are plugins the installer puts beside the
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
const { isDeepStrictEqual } = require('node:util');

// The three that can never be dropped - see R7 above.
const LOCKED = ['serena', 'context7', 'memory'];
const PW_ENGINES = ['chrome', 'msedge', 'firefox', 'webkit'];
const PW_SERVERS = ['playwright', ...PW_ENGINES.map((e) => `playwright-${e}`)];

const isLocked = (name) => LOCKED.includes(name);

// A plugin route being on at all means the CORE entry is enabled, and the locked three are installed
// as plugins beside it.
const corePluginOn = (routes) => Boolean(routes.hooks || routes.skills || routes.mcps);

// The names this run must UNREGISTER. On the plugin route that is every server the stack ever
// registered here - the whole catalog, not this run's selection, because an earlier install may
// have written a server this project no longer picks - plus the four engine spellings. On a copy
// route with the core still on it is just the locked three. On the full copy route, only what the
// release authored as retired.
function retiredMcps({ routes, catalog = [], authored = [] })
{
    const out = [...authored];
    if (!routes.mcps)
    {
        if (corePluginOn(routes)) out.push(...LOCKED);
        return out;
    }
    for (const entry of catalog) out.push(typeof entry === 'string' ? entry.split('|')[0] : entry.name);
    out.push(...PW_ENGINES.map((e) => `playwright-${e}`));
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
        .map((word) => Object.entries(tokens)
            .reduce((w, [key, value]) => w.split(`@${key}@`).join(value ?? ''), word));
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
    try { data = raw.replace(/^\uFEFF/, '').trim() ? JSON.parse(raw.replace(/^\uFEFF/, '')) : {}; }
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

// The same shape from the manifest side: the env pairs and the `--` separator are not in `mcp get`'s
// Command / Args lines, so they are dropped before the compare.
function wantShape(expect)
{
    if (expect.kind === 'http') return shapeNorm(`http|${expect.url}`);
    const words = [];
    const src = expect.words || [];
    for (let i = 0; i < src.length; i += 1)
    {
        if (src[i] === '-e') { i += 1; continue; }
        if (src[i] === '--') continue;
        words.push(src[i]);
    }
    return shapeNorm(`stdio|${words.join(' ')}`);
}

// USER SCOPE: the registration lives in the account config, which this seed never hand-edits. The
// check runs through `claude mcp get`, a mismatch is retried once through the CLI, and anything
// still wrong is REPORTED - never silently accepted.
function verifyUser({ expects = [], scope, getShape, reregister, log = () => {}, note = () => {} })
{
    const repaired = [];
    for (const expect of expects)
    {
        const want = wantShape(expect);
        let have = shapeNorm(parseGetShape(getShape(expect.name)));
        if (!have) continue;                       // an older CLI, or a server the config does not expose
        if (have === want) continue;
        log(`  mcp shape drifted at user scope: ${expect.name} - re-registering`);
        reregister(expect.name, scope);
        have = shapeNorm(parseGetShape(getShape(expect.name)));
        if (have && have !== want)
            note(`mcp ${expect.name} could not be brought to the current shape at user scope - remove it by hand (claude mcp remove ${expect.name} -s ${scope}) and re-run`);
        else { repaired.push(expect.name); log(`  mcp repaired: ${expect.name} (user scope)`); }
    }
    return { repaired };
}

// The runtime versions this run pins to. Every lookup is BOUNDED and every failure falls through
// to UNPINNED rather than aborting: offline, or without npm / curl / python3, an install must still
// happen - it just installs the latest at launch instead of a frozen version.
//
// The memory pin is spelled `==<ver>` INSIDE the extras brackets, not `@<ver>` like the others,
// which have no extras suffix to sit next to.
function resolvePins({ npmLatest, pypiLatest, log = () => {} })
{
    const ask = (fn, pkg) => { try { return String(fn(pkg) || '').trim(); } catch { return ''; } };
    const found = {
        playwright: ask(npmLatest, '@playwright/mcp'),
        serena: ask(pypiLatest, 'serena-agent'),
        memory: ask(pypiLatest, 'mcp-memory-service'),
    };
    for (const [name, version] of Object.entries(found))
    {
        if (version) log(`  pinned ${name}@${version}`);
        else log(`  !! could not resolve ${name} latest - installing unpinned (re-run when online to pin it)`);
    }
    return {
        PW_PIN: found.playwright ? `@${found.playwright}` : '',
        SERENA_PIN: found.serena ? `@${found.serena}` : '',
        MEMORY_PIN: found.memory ? `==${found.memory}` : '',
        MEMORY_BACKEND: 'sqlite_vec',
        versions: found,
    };
}

// ONE server drives ONE browser, fixed at launch (`--browser`; the server has no tool to switch it
// - measured), so the manifest's single `playwright` row expands into one entry per kept engine,
// each with its own profile folder, because a persistent profile belongs to one engine.
function pwArgsFor(args, engine)
{
    const words = String(args).split(/\s+/).filter(Boolean);
    const out = [];
    for (let i = 0; i < words.length; i += 1)
    {
        const word = words[i - 1] === '--user-data-dir' ? `${words[i]}/${engine}` : words[i];
        out.push(word);
        if (/^@playwright\/mcp/.test(word)) out.push('--browser', engine);
    }
    return out.join(' ');
}

// The kept set: the flag, else what is already registered (plus an explicitly enabled engine),
// else chrome. A legacy `playwright` server counts as its own --browser engine.
function playwrightKept({ browsers = [], registered = [], enabled = '' })
{
    if (browsers.length) return [...browsers];
    const have = new Set([...registered, ...(enabled ? [enabled] : [])]);
    const kept = PW_ENGINES.filter((e) => have.has(e));
    return kept.length ? kept : ['chrome'];
}

function expandPlaywright({ mcps = [], browsers = [], registered = [], enabled = '' })
{
    const has = mcps.some((e) => String(e).split('|')[0] === 'playwright');
    if (!has) return { mcps: [...mcps], browsers: [] };
    const kept = playwrightKept({ browsers, registered, enabled });
    const out = [];
    for (const entry of mcps)
    {
        const [name, args] = [String(entry).split('|')[0], String(entry).slice(String(entry).indexOf('|') + 1)];
        if (name !== 'playwright') { out.push(entry); continue; }
        for (const engine of kept) out.push(`playwright-${engine}|${pwArgsFor(args, engine)}`);
    }
    return { mcps: out, browsers: kept };
}

// The playwright servers this run no longer keeps - a legacy `playwright` and every dropped engine.
// Nothing on the plugin route: the engines are one plugin each and the user keeps one enabled, so
// there is no per-engine registration to drop.
function playwrightDrop({ routes, browsers = [] })
{
    if (routes.mcps) return [];
    if (!browsers.length) return [];
    const keep = new Set(browsers.map((b) => `playwright-${b}`));
    return PW_SERVERS.filter((name) => !keep.has(name));
}

// COPY ROUTE ONLY: a registered server answers `mcp__<server>__<tool>`, never the plugin spelling
// the shipped files carry. Only the names THIS run registered bare are re-spelled - on a hooks-only
// copy route the locked three are still plugins beside the core, and re-spelling them was the bug this
// list exists to prevent.
const TOOL_NAME_RE = /mcp__plugin_[A-Za-z0-9][A-Za-z0-9.-]*_([A-Za-z0-9][A-Za-z0-9.-]*)__/g;
const DOWNCONVERT_EXT = ['.md', '.mdc', '.js', '.json', '.txt'];

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
            const fixed = body.replace(TOOL_NAME_RE, (full_, server) => (names.has(server) ? `mcp__${server}__` : full_));
            if (fixed === body) continue;
            try { fs.writeFileSync(full, fixed); changed += 1; }
            catch { /* a read-only tree says so elsewhere */ }
        }
    };
    for (const root of roots) walk(root);
    if (changed) log(`  copy route: MCP tool names re-spelled to the registered server names in ${changed} file(s)`);
    return changed;
}

// The hosted context7 - the one transport since 2.0.0 cut the local npx one (R32) - as the context7
// plugin entry registers it: `:-` sends an EMPTY header when the key is unset - the keyless free tier -
// where a literal `${CONTEXT7_API_KEY}` is rejected as an invalid key.
const CONTEXT7_REMOTE = { url: 'https://mcp.context7.com/mcp', header: 'CONTEXT7_API_KEY: ${CONTEXT7_API_KEY:-}' };

module.exports = {
    CONTEXT7_REMOTE, LOCKED, PW_ENGINES, PW_SERVERS, isLocked, corePluginOn,
    retiredMcps, dueRetired, bareNamedMcps, mcpArgv, registerSpec, expectShape, wantFor,
    verifyProject, verifyUser, shapeNorm, parseGetShape, wantShape,
    playwrightDrop, downconvertToolNames, resolvePins, pwArgsFor, playwrightKept, expandPlaywright,
};
