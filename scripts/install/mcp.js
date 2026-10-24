'use strict';
// THE RETIRED MCP SERVERS - what an older release registered, and reading it back so an update can take it out.
//
// The stack ships, registers and launches no MCP server since 2.10.1 (the user's ruling of 2026-10-24): every server it
// shipped is in meta/stack-manifest.json `retired.mcps`, its plugin row in meta/retired-plugins.json with the add-back line,
// and how each one shipped in stack/mcp/shipped-mcps.json. What is left here is the retire path's reading:
//
//   - A SERVER THE PROJECT ADDED BY HAND is not the stack's: kept, named with its remove command. Only a registration the
//     ledger recorded at its hash, or with no row the release template's EXACT shape (exactStack), is the stack's to remove.
//   - THE ACCOUNT FILE is the CLI's own and never hand-edited; the stack's local- and user-scope rows go through
//     `claude mcp remove`, and a file the CLI replaced since the last run is read through its backups (accountLoss).
//   - THE PROJECT'S .mcp.json is a tracked file: a run that touches it gives it back its bytes, BOM, line ends, indent and
//     key order (keepMcpOrder).
const fs = require('node:fs');
const path = require('node:path');
const { parseJson } = require('./json-file.js');
const { isDeepStrictEqual } = require('node:util');
const { entryHash } = require('./stamp.js');
// How each server shipped: the copy route's argument templates, the anchor code and the hosted documentation remote.
const SHIPPED = require('../../stack/mcp/shipped-mcps.json');

const { ENGINES: PW_ENGINES, engineServer, engineOfServer } = require('../../stack/mcp/data-root.js');
// Every name the browser server was registered under: the 1.x single `playwright`, the `playwright-<engine>`
// servers 2.0.0 renamed, the `browser-<engine>` ones 2026-10-13 renamed, and one `<engine>-control` per engine.
const PW_SERVERS = ['playwright', ...PW_ENGINES.map((e) => `playwright-${e}`), ...PW_ENGINES.map((e) => `browser-${e}`), ...PW_ENGINES.map(engineServer)];
// An engine's server under its name or its 2.0.0 one (`<engine>-control`, `browser-<engine>`) as its engine - the two a
// stack registration's shape is read for; undefined for any other name.
const anyEngineOf = (name) => engineOfServer(name) || (/^browser-(chrome|msedge|firefox|webkit)$/.exec(String(name)) || [])[1];

// THE MCP RENAMES (meta/stack-manifest.json `renamed.mcps`, old -> new; 2.0.0 gave the servers role names,
// 2.2.0 the `alfred-` prefix, 2026-10-13 the `-control` names - each old name maps straight to today's, an
// engine's per engine): an MCP name an older release used reads as the name it goes by now - the plugin and its
// server alike (`browser-chrome` and `playwright-chrome` -> `chrome-control`). Any other name comes back as it is.
function currentMcp(name, renamed = {})
{
    const text = String(name);
    return Object.hasOwn(renamed || {}, text) ? renamed[text] : text;
}

// Every plugin and server name the renames left behind - what an older install can still hold. The bare 1.x
// `playwright` (renamed to the catalog's `browser` row, which expands per engine) is its own legacy registration
// (PW_SERVERS), never a plugin.
function renamedFrom(renamed = {})
{
    return Object.entries(renamed || {}).filter(([, to]) => to !== 'browser').map(([from]) => from);
}

// The CORE entry is enabled whenever the hooks or the skills ride a plugin route.
const corePluginOn = (routes) => Boolean(routes.hooks || routes.skills);

// The names this run must UNREGISTER: what the release authored as retired and is due here (dueRetired), and every name the
// renames left behind - this release registers none of them, so one still here is an older install's own (a registration
// the user made under an old name is kept by the callers' shape and ledger checks).
function retiredMcps({ authored = [], legacy = [] })
{
    return [...new Set([...authored, ...legacy])];
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

// The shipped templates' words, split FIRST and then resolved inside each word - so a resolved path with a space stays one
// argument. No globbing, ever.
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

// What a registration of a shipped template looks like once written, from the same words `claude mcp add` was given.
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

// `claude mcp get` PRINTS a stored `${VAR:-default}` as `${VAR}`, so both sides compare with the default dropped.
const shapeNorm = (s) => String(s).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*):-[^}]*\}/g, '${$1}');

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
// (runAtRoot, the anchor the retired memory engine shipped) - the launcher, never the server, which is the command after the anchor. The Windows
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

// Every identity the stack has registered under each name: each retired server's `registration` (meta/retired-plugins.json) -
// what the stack wrote, never the add-back line the user may have run - each playwright engine and the 1.x single
// `playwright` under the browser's, the 1.x local context7 (`--context7 local` put the npx transport under the context7 name
// itself), and an old name (the renames) under its successor's.
function stackIdentities({ retiredRows = [], renamed = {} })
{
    const out = {};
    const add = (name, id) => { if (id) (out[name] ||= new Set()).add(id); };
    for (const row of retiredRows)
    {
        const reg = row && row.registration;
        if (reg && reg.url) add(row.name, `http:${String(reg.url).replace(/\/+$/, '')}`);
        else if (reg && reg.package) add(row.name, `stdio:${packageName(reg.package)}`);
    }
    for (const id of out['chrome-control'] || []) for (const n of PW_SERVERS) add(n, id);
    add('context7', 'stdio:@upstash/context7-mcp');
    for (const old of renamedFrom(renamed))
        for (const id of out[currentMcp(old, renamed)] || []) add(old, id);
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
// An env key a later release ADDED to a template: a registration an earlier release wrote lacks it and is still the
// stack's, while one that carries it must carry the template's value. Audit 2026-10-14: serena's usage ping off (PL1),
// mobile-control's npm cut-off (PL4).
const ADDED_ENV_KEYS = new Set(['SERENA_USAGE_REPORTING', 'npm_config_before']);
// The same for the argument words a later release ADDED: absent from an earlier release's registration, still the stack's.
// Audit 2026-10-14 PL10: serena 2.0.0's interface pinned to tools.
const ADDED_ARG_WORDS = [['--agent-interface', 'tools']];
function withAddedArgs(matchers, words)
{
    const out = matchers.slice();
    for (const run of ADDED_ARG_WORDS)
        for (let i = 0; i + run.length <= words.length; i += 1)
            if (run.every((w, k) => words[i + k] === w)) for (let k = 0; k < run.length; k += 1) out[i + k] = { ...out[i + k], optional: true };
    return out;
}
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
// The anchor code the copy-route rows ran (the record's rootBoot - the only one any release registered).
const STACK_BOOTS = [SHIPPED.rootBoot];
function ownProfile(dir, projectRoot)
{
    const d = String(dir).replace(/^\$\{CLAUDE_PROJECT_DIR(?::-[^}]*)?\}[\\/]/, '');
    if (!path.win32.isAbsolute(d) && !path.posix.isAbsolute(d)) return !d.split(/[\\/]/).includes('..');
    if (!projectRoot) return false;
    const roots = [path.resolve(projectRoot)];
    try { roots.push(fs.realpathSync(projectRoot)); } catch { /* not on disk */ }
    return roots.some((root) => { const rel = path.relative(root, path.resolve(d)); return Boolean(rel) && !rel.split(/[\\/]/).includes('..') && !path.isAbsolute(rel); });
}
// The copy route's templates as it shipped them, `name|args` (the record's copy rows).
const SHIPPED_CATALOG = Object.entries(SHIPPED.copy).map(([name, row]) => `${name}|${row.args}`);
function exactStack(name, entry, { catalog = SHIPPED_CATALOG, remotes = SHIPPED.remotes, projectRoot = '', boots = STACK_BOOTS } = {})
{
    if (!entry || typeof entry !== 'object') return false;
    const engine = anyEngineOf(name);
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
    if (engine) args = pwArgsFor(args, engine);
    // The template split as wantFor splits a registration: its env pairs, then the command words.
    const want = wantFor({ kind: 'stdio', words: String(args).split(/\s+/).filter(Boolean) });
    const env = entry.env && typeof entry.env === 'object' ? entry.env : {};
    const wantKeys = Object.keys(want.env).filter((k) => Object.hasOwn(env, k) || !ADDED_ENV_KEYS.has(k));
    if (!isDeepStrictEqual(Object.keys(env).sort(), wantKeys.sort())) return false;
    // An env value is free wherever a token sits in it (any text, empty included); the rest of it is literal.
    const envRe = (v) => new RegExp(`^${String(v).split(TOKEN_RE).map(escapeRe).join('[^]*')}$`);
    if (!wantKeys.every((k) => envRe(want.env[k]).test(String(env[k])))) return false;
    const { words, code } = anchorOf(entry);
    if (code !== null && !boots.includes(code)) return false;
    const template = serverWords(want);
    if (!wordsMatch(withAddedArgs(template.map(wordMatcher), template), words)) return false;
    if (!engine) return true;
    const dir = words[words.indexOf('--user-data-dir') + 1] || '';
    return ownProfile(dir, projectRoot) && new RegExp(`(^|[\\\\/])(?:${engine}-control|(?:browser|\\.playwright)[\\\\/]${engine})$`).test(dir.replace(/[\\/]+$/, ''));
}

module.exports = {
    PW_ENGINES, PW_SERVERS, corePluginOn, currentMcp, renamedFrom, retiredMcps, dueRetired, mcpArgv, expectShape, wantFor, shapeNorm, pwArgsFor,
    snapshotMcp, keepMcpOrder, identityOf, exactStack, packageName, stackIdentities, registrationsAt, accountBackups, accountLoss,
    managedMcp, removeManagedMcp,
};
