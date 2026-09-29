'use strict';
// THE INSTALL STAMP - the revision every artifact of this install was copied from.
//
// `/alfred-code:configure` diffs it against `main` to say what an update would bring, and
// `--installed-only` reads two of its lines to tell a DROPPED item from one that did not exist yet.
// That second job is why the stamp records more than a SHA.
//
// The rule that matters most: NO SHA MEANS NO STAMP. When no source resolved this run - the archive
// download and the clone both failed, and every step fail-softly kept its existing copy - stamping
// would claim an install that did not happen. A wrong stamp is worse than none, because the next
// configure reads it as truth and reports the wrong diff, so a previous stamp is left untouched.
//
// `shipped-hooks` is the hook FILE names this RELEASE ships - the catalog, one entry per file and
// not per matcher, never this run's subset. On disk a hook the user dropped through configure and a
// hook that did not exist when this install was made look identical; only the second may be
// adopted, and this line is the only thing that can tell them apart.
//
// `hooks-route` is `copy` or `plugin`: how THIS run delivered the hooks. On the copy route no stack
// hook on disk means the user kept none only if the copy route made that disk - a plugin-route stint
// leaves the same empty folder - so the None is read back from this line alone. A stamp without it (1.x,
// or 2.0.0 before it) is an unknown route, never a None.
//
// `seats-route` is `plugin` or `copy`: how THIS run delivered the seats (2.1.0: every seat rides the
// core on the plugin route, each unpicked one denied; the copy route copies the picked ones). The next
// `--installed-only` reads the seats back by it - off the core minus the denied on `plugin`, off the
// disk on `copy` - and a stamp WITHOUT the line is from before 2.1.0, when the core carried only the
// always closure and every other seat was a library copy (derive-state readInstalled's `core`).
//
// `picked-skills` / `picked-agents` are the skills and seats this run installed. The next
// `--installed-only` reads the plugin state back through THAT release's placement, so an item a
// release moved into an entry this project has not enabled would drop out; these two lines carry it
// across (derive-state's `stampCarried`, which honours a parked entry and a denied seat).
//
// `browser-engines` is the browser engines this run INSTALLED, and `browser-enabled` the ones the user
// chose to enable (R67) - `playwright-browsers` / `playwright-enabled` before the 2.0.0 rename, read as
// the fallback. An engine left disabled is still installed, and the listing's
// project-scope flag can read a stale false anyway (S22), so these lines, never the flag, are what the
// next run reads: the installed set to keep (and to uninstall from, when a run keeps fewer), and the
// last choice an engine installed again is switched back to.
//
// `stood-down` is what the full copy route switched off in THIS project (M9, R132) - `<scope>:<spec>`
// each, the scope the disable was written at (a user-scope row is switched off at project scope, I2).
// The settings file cannot tell that off from the user's own /plugin disable, so this line is the only
// reason a switch back enables the core: it lists what is still owed and is gone once it is enabled.
//
// `data-root` is the project's data root this run left in effect (ALFRED_CODE_DATA_PATH, stack/mcp/data-root.js):
// the next run's baseline for a root change, even one made by hand in settings. `data-pending` is each move of
// a server's own data the run recorded for that server's launcher to make at its next start
// (`<class> <from> -> <to>`), kept until the data has left `from`. `data-move: kept` is the user's answer to
// keep the old layout - no later update offers the move again (configure still can).
//
// `initialised` is the one line only /alfred-code:init writes (its memory step, `memory.js init`, once
// the notes are in and Claude's own memory is off): a date. A fresh install writes `pending`, every
// later run carries the value forward, and nothing but init turns `pending` into a date - so an update
// between setup and init can neither import the notes nor flip the router past init (Task 18a I1). A
// stamp from before the line counts as initialised only when Claude's own memory is already off, which
// the pre-2.0 installer did only after importing; the first run over it records that, dated.
//
// The `managed-*` lines are THE LEDGER (R10): what the run MANAGES beyond the library copies, so an
// update removes exactly what the last run wrote and this release no longer writes, and uninstall
// removes exactly what the stack put here - never the user's own key, hook or server. `managed-env` is
// `<file>:<KEY>=<sha256 of the value written>` per settings file; `managed-deny` the permissions.deny
// entries, `<file>:<entry>`; `managed-hooks` the copy route's hook wirings, `<file>:<hook file>:<sha256
// of event, matcher and command>`; `managed-mcp` the .mcp.json entries, `<name>=<sha256 of the entry>`,
// and the copy route's local- and user-scope registrations as `<scope>:<name>=<sha256 of the entry the
// account file holds>` (`mcpAt` - uninstall removes the local ones and prints the user-scope ones);
// `managed-files` every copy outside the library (the engines, the copy route's hooks, skills and seats,
// and a seeded `.claude/CLAUDE.md` until it is filled in), `<kind>/<name>=<sha256>`; `managed-settings`
// the other settings keys it seeded, `<file>:attribution.<key>=<sha256 of the JSON value>`. A value whose
// hash no longer matches was changed by hand since: it is the user's from then on, kept and logged. A
// stamp with none of the lines (an older release) is the one case the old heuristics still answer; a
// project with no stamp at all has managed nothing yet (emptyLedger), so nothing already there is adopted.
//
// `installed-always-rules` / `installed-always-mcps` record what the locked baseline actually
// CARRIES as the run ends, never what shipped. A server counts either way - registered in the file,
// or riding the plugin named for it - because on the plugin route there is no `.mcp.json` at all,
// and a stamp that only read the file would record an install with none of the locked three.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { stampFile, LEGACY } = require('./brand.js');
// Fix round 1: inlined rather than `require('../derive-state.js')` - that module pulls in
// selection-plugins.js, plugin-placement.js, install/manifest.js, hook-prelude.js and install/
// plugins.js, a heavy graph for a one-line splitter, and every consumer of stamp.js (library-
// stamp.js's SessionStart hook included) would have had to ship the whole chain just to get this.
// Kept identical to derive-state.js's own copy (scripts/derive-state.js:200) - a drift there is a
// drift here.
const splitPick = (entry) => { const [name, home = ''] = String(entry).split('@'); return { name, home: home || null }; };

// A browser engine server belongs to its FAMILY: the always-list names `browser`, and an
// install carrying `browser-firefox` is carrying it.
const family = (name) => String(name).replace(/^browser-.*/, 'browser');

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };

// N1 (R58 fix round 2, security): a stamp is a project file a clone can fill with ANY text, so a
// name it records - a skill, a seat or a rule - is validated before it ever reaches a path join, a
// copy, a printed 'rm -rf' or a selection line: migrateLegacyGlobal below, library-check.js's rows,
// library-stamp.js's session echo, derive-state.js's stampCarried. One path segment, the shape the
// installer itself gives an item name (lowercase letters, digits, dot, underscore, hyphen, starting
// with a letter or digit); never empty, never '.' or '..', no '/' or '\'. The regex alone already
// excludes a traversal segment, but the containment check is what actually gates behaviour - a name
// that passes the shape check is checked AGAIN after joining, so a resolved path landing anywhere
// but directly inside the dir it was joined into is rejected too. With no dir (a name that becomes
// a selection line, not a path) the shape check is the whole test.
const ITEM_NAME = /^[a-z0-9][a-z0-9._-]*$/;
function validItemName(name, dir)
{
    if (typeof name !== 'string' || name === '.' || name === '..' || !ITEM_NAME.test(name)) return false;
    if (dir === undefined) return true;
    const base = path.resolve(dir);
    return path.dirname(path.resolve(base, name)) === base;
}

// One entry per hook FILE, in first-seen order, `.js` dropped - the spelling the stamp has always
// used and the one `--installed-only` matches against.
function shippedHooks(hooksCatalog)
{
    const seen = [];
    for (const row of hooksCatalog || [])
    {
        const name = String(row.file ?? row).split('::')[0].replace(/\.js$/, '');
        if (name && !seen.includes(name)) seen.push(name);
    }
    return seen;
}

function installedAlways({ recommendations, mcpFile, settingsFile, rulesDir })
{
    const always = (readJson(recommendations).always) || {};
    const servers = readJson(mcpFile).mcpServers || {};
    const plugins = new Set(Object.keys(readJson(settingsFile).enabledPlugins || {})
        .map((k) => family(k.split('@')[0])));
    const list = (x) => (Array.isArray(x) ? x : []);
    return {
        rules: list(always.rules).filter((r) => rulesDir && fs.existsSync(path.join(rulesDir, `${r}.md`))),
        mcps: list(always.mcps).filter((m) => Object.hasOwn(servers, m) || plugins.has(m)),
    };
}

// --- the ledger (R10) ----------------------------------------------------------------------------
const valueHash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
// An object with its keys sorted at every level, so one entry hashes the same whatever order a writer
// (the CLI, the verify pass) put its keys in.
const stable = (v) => (Array.isArray(v) ? v.map(stable)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v);
const entryHash = (entry) => valueHash(JSON.stringify(stable(entry)));
const LEDGER_FILES = ['settings.json', 'settings.local.json'];
const HEX = /^[0-9a-f]{64}$/;
const ENV_KEY = /^[A-Z][A-Z0-9_]*$/;
const FILE_KINDS = ['hooks', 'skills', 'agents'];
const SETTINGS_PATH = /^(?:attribution\.(?:commit|pr|sessionUrl)|worktree\.baseRef)$/;
const MCP_SCOPES = ['local', 'user'];
const emptyLedger = () => ({ env: {}, deny: [], hooks: [], mcp: {}, mcpAt: {}, files: {}, settings: {} });

function renderLedger(ledger)
{
    const { env = {}, deny = [], hooks = [], mcp = {}, mcpAt = {}, files = {}, settings = {} } = ledger;
    const pairs = (map) => Object.entries(map || {}).map(([n, h]) => `${n}=${h}`);
    return [
        `managed-env: ${Object.entries(env).flatMap(([file, keys]) => pairs(keys).map((kv) => `${file}:${kv}`)).join(',')}`,
        `managed-deny: ${deny.map((d) => `${d.file}:${d.entry}`).join(',')}`,
        `managed-hooks: ${hooks.map((h) => `${h.file}:${h.hook}:${h.id}`).join(',')}`,
        `managed-mcp: ${[...pairs(mcp), ...Object.entries(mcpAt || {}).flatMap(([scope, map]) => pairs(map).map((kv) => `${scope}:${kv}`))].join(',')}`,
        `managed-files: ${pairs(files).join(',')}`,
        `managed-settings: ${Object.entries(settings || {}).flatMap(([file, keys]) => pairs(keys).map((kv) => `${file}:${kv}`)).join(',')}`,
    ];
}

// The ledger a stamp recorded, each kind null when its line is absent; null as a whole when the stamp
// has no ledger line at all (no stamp, or one from before R10). Every entry is checked against the
// shape the installer writes and dropped otherwise (the N1 rule: a clone can fill a stamp with any
// text, and these names reach path joins and settings writes).
function readLedger(file)
{
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
    if (!/^managed-(env|deny|hooks|mcp|files|settings):/m.test(text)) return null;
    const items = (key) =>
    {
        const m = new RegExp(`^managed-${key}: ?(.*)$`, 'm').exec(text);
        return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : null;
    };
    const cut = (s, sep) => { const i = s.indexOf(sep); return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)]; };
    const out = { env: null, deny: null, hooks: null, mcp: null, mcpAt: null, files: null, settings: null };
    const perFile = (kind, valid) =>
    {
        const list = items(kind);
        if (!list) return null;
        const map = {};
        for (const item of list)
        {
            const [f, rest] = cut(item, ':');
            const [key, hash] = cut(rest, '=');
            if (LEDGER_FILES.includes(f) && valid.test(key) && HEX.test(hash)) (map[f] ||= {})[key] = hash;
        }
        return map;
    };
    out.env = perFile('env', ENV_KEY);
    out.settings = perFile('settings', SETTINGS_PATH);
    const deny = items('deny');
    if (deny) out.deny = deny.map((item) => { const [f, entry] = cut(item, ':'); return { file: f, entry }; })
        .filter((d) => LEDGER_FILES.includes(d.file) && d.entry);
    const hooks = items('hooks');
    if (hooks) out.hooks = hooks.map((item) => { const [f, rest] = cut(item, ':'); const [hook, id] = cut(rest, ':'); return { file: f, hook, id }; })
        .filter((h) => LEDGER_FILES.includes(h.file) && validItemName(h.hook) && HEX.test(h.id));
    const mcp = items('mcp');
    if (mcp) out.mcp = Object.fromEntries(mcp.map((item) => cut(item, '=')).filter(([n, h]) => validItemName(n) && HEX.test(h)));
    if (mcp)
    {
        out.mcpAt = {};
        for (const item of mcp)
        {
            const [scope, rest] = cut(item, ':');
            const [n, h] = cut(rest, '=');
            if (rest && MCP_SCOPES.includes(scope) && validItemName(n) && HEX.test(h)) (out.mcpAt[scope] ||= {})[n] = h;
        }
    }
    const files = items('files');
    if (files) out.files = Object.fromEntries(files.map((item) => cut(item, '=')).filter(([rel, h]) =>
    {
        const parts = rel.split('/');
        return HEX.test(h) && (rel === 'CLAUDE.md' || (parts.length === 2 && FILE_KINDS.includes(parts[0]) && validItemName(parts[1])));
    }));
    return out;
}

function renderStamp(fields)
{
    const { repoUrl, ref, sha, version, installed, action, scope, initialised, hooks, hooksRoute, seatsRoute, alwaysRules, alwaysMcps, picked = {}, playwright = [], playwrightEnabled, stoodDown = [], library = {}, ledger = null, data = null } = fields;
    const hashes = (map) => Object.entries(map || {}).map(([n, h]) => `${n}=${h}`).join(',');
    return [
        '# alfred-code install stamp - machine-local, written by the alfred-code installer.',
        '# The revision every artifact of this install was copied from. To see what changed since:',
        `#   open ${repoUrl}/compare/${sha}...main`,
        '# /alfred-code:configure reports exactly this diff. Then re-run the installer\'s',
        `# '${action}' action (or that skill) to take the changes.`,
        `source: ${repoUrl}`,
        `ref: ${ref}`,
        `sha: ${sha}`,
        `version: ${version}`,
        `installed: ${installed}`,
        `action: ${action}`,
        `scope: ${scope}`,
        ...(initialised ? [`initialised: ${initialised}`] : []),
        `shipped-hooks: ${hooks.join(',')}`,
        ...(hooksRoute ? [`hooks-route: ${hooksRoute}`] : []),
        ...(seatsRoute ? [`seats-route: ${seatsRoute}`] : []),
        `installed-always-rules: ${alwaysRules.join(',')}`,
        `installed-always-mcps: ${alwaysMcps.join(',')}`,
        `picked-skills: ${(picked.skills || []).join(',')}`,
        `picked-agents: ${(picked.agents || []).join(',')}`,
        `browser-engines: ${(playwright || []).join(',')}`,
        ...(Array.isArray(playwrightEnabled) ? [`browser-enabled: ${playwrightEnabled.join(',')}`] : []),
        ...(stoodDown.length ? [`stood-down: ${stoodDown.map((e) => `${e.scope}:${e.spec}`).join(',')}`] : []),
        ...(data && data.root ? [`data-root: ${data.root}`] : []),
        ...(data ? require('../../stack/mcp/data-root.js').renderPending(data.pending || []) : []),
        ...(data && data.kept ? ['data-move: kept'] : []),
        `library-skills: ${hashes(library.skills)}`,
        `library-agents: ${hashes(library.agents)}`,
        `library-rules: ${hashes(library.rules)}`,
        ...(ledger ? renderLedger(ledger) : []),
        '',
    ].join('\n');
}

// T16 (R29): every scope's stamp lives in the PROJECT now - a 1.x GLOBAL install's account-dir
// stamp is a LEGACY read only (migrateLegacyGlobal below moves it into the project on the first
// 2.x update; the account copy is left in place for other projects that still read it).
const stampDir = ({ projectRoot }) => path.join(projectRoot, '.claude');

function stampPath(at) { return stampFile(stampDir(at)).write; }

// What a run READS: the new stamp, else a 1.x install's under its old name (null when neither is
// there). Every reader of the last install goes through this; only writeStamp writes.
function stampFiles(at)
{
    const { read, write } = stampFile(stampDir(at));
    return { read, write };
}

function writeStamp(opts)
{
    const {
        source, action, scope, configDir, projectRoot, mcpFile, hooksCatalog, hooksRoute, seatsRoute, picked, playwright, playwrightEnabled, stoodDown, library, ledger, data,
        version = '', now = new Date(), log = () => {}, note = () => {},
    } = opts;
    const initialised = opts.initialised || initialisedValue({ claudeDir: stampDir({ projectRoot }), now });

    if (!source || !source.sha)
    {
        log('  stamp: skipped - no source revision resolved this run');
        return null;
    }

    const dest = stampPath({ scope, configDir, projectRoot });
    const dir = path.dirname(dest);

    const always = installedAlways({
        recommendations: path.join(source.dir, 'meta', 'recommendations.json'),
        mcpFile,
        settingsFile: path.join(projectRoot, '.claude', 'settings.json'),
        rulesDir: path.join(projectRoot, '.claude', 'rules'),
    });

    try
    {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(dest, renderStamp({
            repoUrl: source.repoUrl, ref: source.ref, sha: source.sha, version,
            installed: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
            action, scope, initialised,
            hooks: shippedHooks(hooksCatalog), hooksRoute, seatsRoute,
            alwaysRules: always.rules, alwaysMcps: always.mcps, picked, playwright, playwrightEnabled, stoodDown, library, ledger, data,
        }));
    }
    catch (err) { note(`stamp could not be written to ${dest} (${err.message})`); return null; }

    // The 1.x stamp goes only once the new one is on disk - until then it is the only record.
    const { legacy } = stampFile(dir);
    try { if (fs.existsSync(legacy)) { fs.rmSync(legacy, { force: true }); log(`  stamp: ${path.basename(legacy)} removed - ${path.basename(dest)} replaces it`); } }
    catch (err) { note(`the old stamp ${legacy} could not be removed (${err.message}) - the new one is read first either way`); }

    log(`  stamp: ${dest} @ ${source.sha.slice(0, 12)}`);
    return dest;
}

// The two picked lines of a stamp. A stamp that carries neither (an older stamp, the shell twin's, no
// stamp) reads as null - it never recorded picks, which is not the same answer as recording none.
function readPicked(file)
{
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { text = ''; }
    if (!/^picked-(skills|agents):/m.test(text)) return null;
    const list = (key) => ((new RegExp(`^${key}: (.*)$`, 'm').exec(text) || [])[1] || '').split(',').map((s) => s.trim()).filter(Boolean);
    return { skills: list('picked-skills'), agents: list('picked-agents') };
}

// I3 (R47): the `scope:` line alone - what `update` with no `--scope` resolves against, since the
// stamp is the only record of what the LAST install actually used (args.js leaves the flag '' rather
// than default it, exactly like docsVersioning/memoryLevel already do).
function readStampScope(file)
{
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return ''; }
    return ((/^scope: (.*)$/m.exec(text) || [])[1] || '').trim();
}

// The library hashes of a stamp - what each copy held when this install wrote it. Null when the
// stamp has no library lines at all (an older release, the shell twin, no stamp): nothing to
// compare. A stamp with skills/agents but no `library-rules:` line (a pre-R29 release) still reads
// as a stamp - rules just come back empty, so the first update after this release records fresh
// hashes instead of every rule reading as missing or drift.
function readLibrary(file)
{
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
    if (!/^library-(skills|agents|rules):/m.test(text)) return null;
    // Review finding 4: the N1 rule - a stamp is project text, and these names reach path joins and the
    // uninstall's removal, so a name of any other shape than the installer's own is dropped here, and
    // counted (`invalid`: library-check reports a corrupted stamp as a finding).
    let invalid = 0;
    const map = (key) => Object.fromEntries(((new RegExp(`^${key}: (.*)$`, 'm').exec(text) || [])[1] || '')
        .split(',').map((s) => s.trim()).filter((s) => s.includes('=')).map((s) => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)])
        .filter(([name]) => { if (validItemName(name)) return true; invalid += 1; return false; }));
    return {
        version: ((/^version: (.*)$/m.exec(text) || [])[1] || '').trim(),
        skills: map('library-skills'), agents: map('library-agents'), rules: map('library-rules'), invalid,
    };
}

// The release the last install recorded (`version:`), or '' - no stamp, or none on it. Read from any
// stamp, a 1.x one included: the retirements key on it.
function readVersion(file)
{
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return ''; }
    return ((/^version: (.*)$/m.exec(text) || [])[1] || '').trim();
}

// The route the last run delivered the hooks by - `copy` or `plugin`, else null (no stamp, no line, or
// a value this release does not write).
function readHooksRoute(file)
{
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
    const route = ((/^hooks-route: (.*)$/m.exec(text) || [])[1] || '').trim();
    return route === 'copy' || route === 'plugin' ? route : null;
}

// The route the last run delivered the SEATS by - `plugin` or `copy` - else null: no stamp, or one from
// before 2.1.0 (its core carried the always closure).
function readSeatsRoute(file)
{
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
    const route = ((/^seats-route: (.*)$/m.exec(text) || [])[1] || '').trim();
    return route === 'copy' || route === 'plugin' ? route : null;
}

// The browser engines the last install installed (or, with `browser-enabled`, enabled), in the
// one canonical order - [] when it recorded none, null when the stamp has no such line (no stamp, or
// one from before the line): nothing recorded. A stamp written before the 2.0.0 rename spells the lines
// `playwright-browsers` / `playwright-enabled`: read as the fallback, the new line winning where both are.
const PW_ORDER = ['chrome', 'msedge', 'firefox', 'webkit'];
const BROWSER_LINES = { engines: ['browser-engines', 'playwright-browsers'], enabled: ['browser-enabled', 'playwright-enabled'] };
function readEngineLine(text, line)
{
    const m = new RegExp(`^${line}:(.*)$`, 'm').exec(text);
    if (!m) return null;
    const named = m[1].split(',').map((s) => s.trim().toLowerCase());
    return PW_ORDER.filter((e) => named.includes(e));
}
// Both lines at once, and whether they came from the OLD spelling - a run that cannot read the plugin
// listing takes an engine the stamp names as installed, which only holds under the name it was installed as.
function readBrowserLines(file)
{
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return { browsers: null, enabled: null, legacy: false }; }
    const read = ([now, old]) => { const v = readEngineLine(text, now); return v !== null ? { v, old: false } : { v: readEngineLine(text, old), old: true }; };
    const engines = read(BROWSER_LINES.engines);
    const enabled = read(BROWSER_LINES.enabled);
    return { browsers: engines.v, enabled: enabled.v, legacy: engines.v !== null && engines.old };
}
const readPlaywright = (file) => readBrowserLines(file).browsers;
const readPlaywrightEnabled = (file) => readBrowserLines(file).enabled;

// The `stood-down` record - [] with no stamp or no line. An entry of any other shape is not ours and is
// dropped, so a hand-edited line can never make a run enable something at a scope it did not name.
const STOOD_DOWN = /^(project|local):([\w.-]+@[\w.-]+)$/;
function readStoodDown(file)
{
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
    const m = /^stood-down:(.*)$/m.exec(text);
    if (!m) return [];
    return m[1].split(',').map((s) => STOOD_DOWN.exec(s.trim())).filter(Boolean).map(([, scope, spec]) => ({ scope, spec }));
}
// The data lines - { root: '' when none, pending: [], kept } with no stamp or none of them.
function readDataLines(file)
{
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return { root: '', pending: [], kept: false }; }
    const dr = require('../../stack/mcp/data-root.js');
    const root = (/^data-root: *(\S+) *$/m.exec(text) || [])[1] || '';
    return { root: dr.checkDataPath(root).ok ? root : '', pending: dr.readPending(text), kept: /^data-move: *kept *$/m.test(text) };
}

// NM1 (fix round 3): the full stamp - including this same `hooks-route:` line - is only written once,
// at the very END of a run, after installHooksAndRules has already pruned the OTHER route's copies.
// A run that dies in between (the process killed, a later fail-soft step's uncaught error) leaves the
// route line at whatever the PREVIOUS run wrote, while the files on disk already reflect the NEW
// route - so a copy-route None afterward is read from a folder the interrupted plugin-route run just
// emptied, and every hook goes off. This targeted, best-effort patch of the line ALONE - never the
// whole stamp, whose other fields (picks, library hashes) are not known yet this early - runs BEFORE
// that prune, so an interruption anywhere after it still leaves the route line in sync with the
// prune that is about to happen (or has already happened): a later full writeStamp overwrites it the
// normal way when the run completes cleanly. A run with no stamp yet (a fresh install) has nothing to
// patch - and nothing a prune could make stale either, since there is no PREVIOUS route recorded.
function markHooksRoute(file, route)
{
    if (!file) return false;
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return false; }
    const line = `hooks-route: ${route}`;
    const next = /^hooks-route: .*$/m.test(text) ? text.replace(/^hooks-route: .*$/m, line)
        : /^shipped-hooks: .*$/m.test(text) ? text.replace(/^(shipped-hooks: .*)$/m, `$1\n${line}`)
            : `${text.replace(/\n+$/, '')}\n${line}\n`;
    if (next === text) return true;
    try { fs.writeFileSync(file, next); return true; } catch { return false; }
}

// --- initialised (Task 18a I1) -------------------------------------------------------------------
const INIT_LINE = /^initialised: *(.*)$/m;
const isoSeconds = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

// The raw value of the stamp's `initialised:` line, or null (no stamp, or one from before the line).
function readInitialised(file)
{
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
    const m = INIT_LINE.exec(text);
    return m ? m[1].trim() || null : null;
}

// Claude's own memory switched off in either project settings file.
function memoryOff(claudeDir)
{
    return ['settings.local.json', 'settings.json'].some((name) => readJson(path.join(claudeDir, name)).autoMemoryEnabled === false);
}

const isInitialised = (value) => Boolean(value) && value !== 'pending';

// What this run's stamp records: the line carried; a stamp from before it dated when memory is off.
function initialisedValue({ claudeDir, now = new Date() })
{
    const { read } = stampFile(claudeDir);
    if (!read) return 'pending';
    const prev = readInitialised(read);
    if (prev) return prev;
    return memoryOff(claudeDir) ? `${isoSeconds(now)} (memory already off before this release)` : 'pending';
}

// The account dir - the installer's own rule (alfred-code.js): CLAUDE_CONFIG_DIR, else the --space
// profile's ~/.claude-<space>, else ~/.claude. A 1.x global install kept its stamp there.
const accountDir = (env = process.env, space = '') => env.CLAUDE_CONFIG_DIR
    || path.join(env.HOME || env.USERPROFILE || require('node:os').homedir(), space ? `.claude-${space}` : '.claude');

// R51 / R90 N1: a 1.x GLOBAL install's stamp, still in the account dir because no update has migrated
// it - read only while the project holds no stamp of its own (the migrateLegacyGlobal guard). The path,
// or null. update-preflight.js and the router read it; the installer's own read is the same fallback.
function legacyAccountStamp({ claudeDir, env = process.env })
{
    if (stampFile(claudeDir).read) return null;
    const file = path.join(accountDir(env), LEGACY.stamp);
    return fs.existsSync(file) ? file : null;
}

// The checkout that holds this directory's install record - the prelude's own record list over the
// prelude's own checkouts (the dir, its git top level, a worktree's main checkout), so the router and
// the hooks' GATE 4 can never disagree about WHETHER a tree is set up (R90 N2) - or null.
function recordCheckout(projectRoot)
{
    const { INSTALL_RECORDS, checkoutsOf } = require(path.join(__dirname, '..', '..', 'stack', 'hooks', 'hook-prelude.js'));
    const holds = (at) => INSTALL_RECORDS.some((record) => fs.existsSync(path.join(at, '.claude', ...record)));
    const roots = checkoutsOf(path.resolve(projectRoot));
    return { roots, at: roots.find(holds) || null };
}

// The dir and its git top level - the trees a run started here reads and writes. A worktree's main
// checkout is not among them: every installer layer, the preflight and library-check read the tree
// the run is in.
function ownCheckouts(projectRoot)
{
    const dir = path.resolve(projectRoot);
    for (let at = dir; ; )
    {
        if (fs.existsSync(path.join(at, '.git'))) return at === dir ? [dir] : [dir, at];
        const up = path.dirname(at);
        if (up === at) return [dir];
        at = up;
    }
}

// R95 (Task 18b fix round 1): the main checkout of a git worktree whose OWN tree holds no install
// record while the main checkout does - or null. The hooks count such a worktree set up (the main
// checkout's record), but no command can act on it from here: every reader after a command's gate
// reads the worktree's own `.claude`, which is empty, so update named setup and setup named update
// (measured). The commands stop on it instead, naming the checkout to run them from.
function worktreeMain(projectRoot)
{
    const { at } = recordCheckout(projectRoot);
    return at && !ownCheckouts(projectRoot).includes(at) ? at : null;
}

// Task 3 (2.1.0): a legacy COPY-route install that never wrote a stamp and copied no `hooks/docs.js` holds
// no install record, so the router read it `not-installed` - setup took the fresh ladder and update sent
// it back to setup. Its signatures, each an independent hit: (a) the stack's hook files in `.claude/hooks`,
// (b) a stack env key (either prefix) in settings.json or settings.local.json, (c) three or more skill,
// seat or rule names the stack ever shipped - the catalog, a renamed item's old name, a retired one. TWO
// hits claim the tree; one never does - skills alone are the project's own as often as the stack's. The
// hooks' record list is NOT extended, so they stay down until the update writes the stamp. `manifest`
// defaults to this tree's own; an unreadable one claims nothing. M3: a name counts only when a project could
// not plausibly have it of its own (manifest.js stackOwnName) - `typescript`, `npm`, `markdown-docs` are a
// project's as often as the stack's, and a tree an uninstall left (a changed env key kept) beside them is no
// install to take over.
const STACK_ENV_KEY = /^(ALFRED_CODE_|CLAUDE_STACK_)/; // legacy-name
function legacySignature(root, { manifest } = {})
{
    let names;
    let own;
    try
    {
        const layer = require('./manifest.js');
        names = layer.stackNames(manifest || layer.loadManifest(path.join(__dirname, '..', '..')));
        own = (kind) => (n) => layer.stackOwnName(names, kind, n);
    }
    catch { return false; }
    const claudeDir = path.join(root, '.claude');
    const list = (dir, test) => { try { return fs.readdirSync(path.join(claudeDir, dir), { withFileTypes: true }).filter(test).map((d) => d.name); } catch { return []; } };
    const hooks = list('hooks', (d) => d.isFile() && d.name.endsWith('.js')).some((f) => names.hooks.has(f.replace(/\.js$/, '')));
    const envKeys = ['settings.json', 'settings.local.json'].some((file) =>
    {
        try
        {
            const env = (JSON.parse(fs.readFileSync(path.join(claudeDir, file), 'utf8')) || {}).env;
            return Boolean(env) && typeof env === 'object' && !Array.isArray(env) && Object.keys(env).some((k) => STACK_ENV_KEY.test(k));
        }
        catch { return false; }
    });
    const items = list('skills', (d) => d.isDirectory()).filter(own('skills')).length
        + list('agents', (d) => d.isFile() && d.name.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).filter(own('agents')).length
        + list('rules', (d) => d.isFile() && d.name.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).filter(own('rules')).length;
    return [hooks, envKeys, items >= 3].filter(Boolean).length >= 2;
}

// No install record in this directory's checkouts, and the legacy signature in the dir or its git top level
// - the trees a run started here installs into. The router, the preflight and the installer all ask this.
function legacyUnstamped(projectRoot, { manifest } = {})
{
    if (recordCheckout(projectRoot).at) return false;
    return ownCheckouts(projectRoot).some((at) => legacySignature(at, { manifest }));
}

// The router's one read: not-installed | legacy-global | legacy-unstamped | worktree-of-installed |
// installed (never initialised) | initialised. The stamp is read in the checkout that holds the record.
// worktree-of-installed is R95 above - the CLI prints the main checkout's path after it. legacy-global
// is a 1.x global install whose stamp the first update has not moved into the project yet: update's to
// take, never init's (N1). legacy-unstamped is the record-less copy-route install above, update's too.
function installState(projectRoot, env = process.env)
{
    const { at } = recordCheckout(projectRoot);
    if (!at) return legacyUnstamped(projectRoot) ? 'legacy-unstamped' : 'not-installed';
    if (worktreeMain(projectRoot)) return 'worktree-of-installed';
    const claudeDir = path.join(at, '.claude');
    if (legacyGlobalStamp(projectRoot, env)) return 'legacy-global';
    return isInitialised(initialisedValue({ claudeDir })) ? 'initialised' : 'installed';
}

// THE ONE TEST for `legacy-global` (A-I1): an install record in the project's checkouts, no stamp of its
// own there, and the 1.x stamp in the account dir - the account stamp's path, or null. The router's state,
// the scope a command passes back and the installer's own scope decision all read it, so they never
// disagree; a repo that was never set up is none of it, whatever the account holds.
function legacyGlobalStamp(projectRoot, env = process.env)
{
    const { at } = recordCheckout(projectRoot);
    return at ? legacyAccountStamp({ claudeDir: path.join(at, '.claude'), env }) : null;
}

// M5 (Task 18b fix round 1): the scope the last install used, for a command to pass back to the
// installer - the stamp under either name (a 1.x install keeps `claude-stack.stamp` until its first // legacy-name
// 2.0.0 update), a 1.x `global` as `user` (args.js reads the flag the same way), and anything else -
// no stamp, no line, a hand-edited value - as `project`, the floor every scope always had. Read in the
// tree the command runs in, never a worktree's main checkout (R95 stops those before this read). A-I1: an
// unmigrated 1.x GLOBAL install (legacyGlobalStamp) reads the account stamp's scope - its `global` is
// `user` - so the first update moves the install at the scope it lives at.
const SCOPES = ['project', 'user', 'local'];
function installScope(projectRoot, env = process.env)
{
    const own = ownCheckouts(projectRoot);
    const read = stampFile(path.join(own[own.length - 1], '.claude')).read || legacyGlobalStamp(projectRoot, env);
    const raw = read ? readStampScope(read).toLowerCase() : '';
    const scope = raw === 'global' ? 'user' : raw;
    return SCOPES.includes(scope) ? scope : 'project';
}

// init's mark, in place: the line replaced, or added. No stamp, nothing written (false).
function markInitialised(claudeDir, now = new Date())
{
    const { read } = stampFile(claudeDir);
    if (!read) return false;
    let text;
    try { text = fs.readFileSync(read, 'utf8'); } catch { return false; }
    const line = `initialised: ${isoSeconds(now)}`;
    const next = INIT_LINE.test(text) ? text.replace(INIT_LINE, line) : `${text.replace(/\n+$/, '')}\n${line}\n`;
    try { fs.writeFileSync(read, next); return true; } catch { return false; }
}

// T16 (R29): a 1.x GLOBAL install put its stamp AND its skills in the account dir. A project that
// still shows no stamp of its own (a native project/user/local install already writes one - this
// never runs twice) is READ from there ONCE, on the first 'update' after 2.0.0, and copied into the
// project: the stamp under its OWN (1.x) name, so the existing read-new-else-legacy logic above
// picks it up unchanged, and the skills tree beside it. The ACCOUNT copies are never touched - other
// projects on the same machine may still be reading them.
//
// C1 (R47): copy only the names THIS STAMP RECORDS - the `library-skills` keys plus the
// `picked-skills` names (with `@home` stripped) - directories only, never the whole account
// `skills/` tree. The account dir also holds the user's PERSONAL skills and the claude.ai-synced
// `synced/` folder (a reserved name), neither of which this project's stamp ever named; a blind
// `fs.cpSync` of every entry copied those into the repo too, and force-overwrote a project skill of
// the same name in place. A name the stamp records but the project already has is left alone and
// logged - the account copy is never allowed to clobber a project file.
function migrateLegacyGlobal({ configDir, projectRoot, renamed = null, log = () => {}, note = () => {} })
{
    if (!configDir || !projectRoot) return false;
    const acctLegacy = path.join(configDir, LEGACY.stamp);
    if (!fs.existsSync(acctLegacy)) return false;
    const claudeDir = path.join(projectRoot, '.claude');
    if (stampFile(claudeDir).read) return false;   // this project already has its own stamp - nothing to migrate

    fs.mkdirSync(claudeDir, { recursive: true });
    fs.copyFileSync(acctLegacy, path.join(claudeDir, LEGACY.stamp));

    const legacy = readLibrary(acctLegacy) || {};
    const picked = readPicked(acctLegacy) || { skills: [] };
    const names = new Set([
        ...Object.keys(legacy.skills || {}),
        ...(picked.skills || []).map((e) => splitPick(e).name),
    ]);

    let moved = 0;
    const shadow = [];
    const acctSkills = path.join(configDir, 'skills');
    if (names.size && fs.existsSync(acctSkills))
    {
        const dstSkills = path.join(claudeDir, 'skills');
        fs.mkdirSync(dstSkills, { recursive: true });
        for (const name of names)
        {
            // N1: a name the account 1.x stamp records is not trusted shape-blind - skipped and
            // logged by its LENGTH only, never echoed, so a corrupted or hand-edited stamp can never
            // widen the copy (or the removal command below) past the account's own skills/ dir.
            if (!validItemName(name, acctSkills)) { log(`  skill name skipped (${String(name).length} chars) - not a valid skill name`); continue; }
            const src = path.join(acctSkills, name);
            let isDir = false;
            try { isDir = fs.statSync(src).isDirectory(); } catch { isDir = false; }
            if (!isDir) continue;   // the stamp named it, the account no longer has a folder for it
            const dst = path.join(dstSkills, name);
            // Either way - copied now, or already there - the account still holds a same-named
            // folder, so it still SHADOWS the project's once Claude Code loads this session
            // (personal over project); both branches record it for the disclosure below.
            if (fs.existsSync(dst)) { log(`  skill ${name}: already in the project - the account copy was not used`); shadow.push(name); continue; }
            try { fs.cpSync(src, dst, { recursive: true }); moved += 1; shadow.push(name); }
            catch (err) { note(`the account skill ${name} could not be copied (${err.message})`); }
        }
    }
    // I6 (R47): the account copies are LEFT IN PLACE, and Claude Code runs a personal skill over a
    // project one of the same name ('Resolve skills that share a name', code.claude.com/docs/en/skills)
    // - so every name just migrated is still what actually loads, from the account, until it is
    // removed by hand. Name the exact command rather than a wholesale `rm -rf` of the account
    // skills dir, which may hold other, unrelated personal skills.
    // M5 (Task 22 fix round 1): a RENAMED name overrides nothing - the project now loads the new name, so
    // the account copy loads BESIDE it under the old one, in every project. Named apart, own command.
    const renames = (renamed && renamed.skills) || {};
    const beside = shadow.filter((n) => Object.hasOwn(renames, n));
    const over = shadow.filter((n) => !Object.hasOwn(renames, n));
    const rmOf = (list) => `rm -rf ${list.map((n) => `'${path.join(acctSkills, n)}'`).join(' ')}`;
    const rmCmd = over.length ? rmOf(over) : '';
    log(`  a 1.x global install's stamp and ${moved} skill(s) were moved from ${configDir} into the project - `
        + (over.length || !beside.length
            ? 'the account copies stay in place and OVERRIDE the migrated ones (Claude Code runs a personal skill '
                + 'over a project one of the same name) - once every project has updated, remove them:'
                + (rmCmd ? ` ${rmCmd}` : ' (nothing was actually copied - no removal needed)')
                + (beside.length ? '; ' : '')
            : '')
        + (beside.length
            ? `the account copies of the renamed ${beside.map((n) => `${n} (now ${renames[n]})`).join(', ')} override `
                + 'nothing - they load BESIDE the new names, under the old ones, in every project - once every '
                + `project has updated, remove them: ${rmOf(beside)}`
            : ''));
    return true;
}

module.exports = {
    writeStamp, stampPath, stampFiles, renderStamp, shippedHooks, installedAlways, family,
    readPicked, readLibrary, readLedger, emptyLedger, valueHash, entryHash, LEDGER_FILES, readStampScope, readHooksRoute, readSeatsRoute, markHooksRoute, readPlaywright, readPlaywrightEnabled, readBrowserLines, readStoodDown, readVersion, migrateLegacyGlobal, validItemName,
    readInitialised, initialisedValue, isInitialised, installState, markInitialised, legacyAccountStamp, legacyGlobalStamp, legacySignature, legacyUnstamped, worktreeMain, installScope, readDataLines,
    accountDir,
};

// `node scripts/install/stamp.js state [projectRoot]` - the router's read: one word on stdout, and for
// `worktree-of-installed` the main checkout's path after it. `scope [projectRoot]` - the scope the last
// install used, one word.
if (require.main === module)
{
    const [cmd, root] = process.argv.slice(2);
    const at = path.resolve(root || '.');
    if (cmd === 'scope') { console.log(installScope(at)); process.exit(0); }
    if (cmd !== 'state') { console.error('usage: stamp.js state|scope [projectRoot]'); process.exit(2); }
    const state = installState(at);
    console.log(state === 'worktree-of-installed' ? `${state} ${worktreeMain(at)}` : state);
}
