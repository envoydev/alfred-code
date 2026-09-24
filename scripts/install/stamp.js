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
// `picked-skills` / `picked-agents` are the skills and seats this run installed. The next
// `--installed-only` reads the plugin state back through THAT release's placement, so an item a
// release moved into an entry this project has not enabled would drop out; these two lines carry it
// across (derive-state's `stampCarried`, which honours a parked entry and a denied seat).
//
// `installed-always-rules` / `installed-always-mcps` record what the locked baseline actually
// CARRIES as the run ends, never what shipped. A server counts either way - registered in the file,
// or riding the plugin named for it - because on the plugin route there is no `.mcp.json` at all,
// and a stamp that only read the file would record an install with none of the locked three.
const fs = require('node:fs');
const path = require('node:path');
const { stampFile } = require('./brand.js');

// A playwright engine server belongs to its FAMILY: the always-list names `playwright`, and an
// install carrying `playwright-firefox` is carrying it.
const family = (name) => String(name).replace(/^playwright-.*/, 'playwright');

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };

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

function renderStamp(fields)
{
    const { repoUrl, ref, sha, version, installed, action, scope, hooks, hooksRoute, alwaysRules, alwaysMcps, picked = {}, library = {} } = fields;
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
        `shipped-hooks: ${hooks.join(',')}`,
        ...(hooksRoute ? [`hooks-route: ${hooksRoute}`] : []),
        `installed-always-rules: ${alwaysRules.join(',')}`,
        `installed-always-mcps: ${alwaysMcps.join(',')}`,
        `picked-skills: ${(picked.skills || []).join(',')}`,
        `picked-agents: ${(picked.agents || []).join(',')}`,
        `library-skills: ${hashes(library.skills)}`,
        `library-agents: ${hashes(library.agents)}`,
        `library-rules: ${hashes(library.rules)}`,
        '',
    ].join('\n');
}

// At user scope the stamp belongs in the account dir; otherwise beside whatever this run installed,
// which is the repo root when there is one.
const stampDir = ({ scope, configDir, projectRoot }) => (scope === 'global' || scope === 'user' ? configDir : path.join(projectRoot, '.claude'));

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
        source, action, scope, configDir, projectRoot, mcpFile, hooksCatalog, hooksRoute, picked, library,
        version = '', now = new Date(), log = () => {}, note = () => {},
    } = opts;

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
            action, scope,
            hooks: shippedHooks(hooksCatalog), hooksRoute,
            alwaysRules: always.rules, alwaysMcps: always.mcps, picked, library,
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
    const map = (key) => Object.fromEntries(((new RegExp(`^${key}: (.*)$`, 'm').exec(text) || [])[1] || '')
        .split(',').map((s) => s.trim()).filter((s) => s.includes('=')).map((s) => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]));
    return {
        version: ((/^version: (.*)$/m.exec(text) || [])[1] || '').trim(),
        skills: map('library-skills'), agents: map('library-agents'), rules: map('library-rules'),
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

module.exports = { writeStamp, stampPath, stampFiles, renderStamp, shippedHooks, installedAlways, family, readPicked, readLibrary, readHooksRoute, readVersion };
