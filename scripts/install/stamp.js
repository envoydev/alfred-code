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
// `playwright-browsers` is the playwright engines this run INSTALLED, and `playwright-enabled` the ones
// the user chose to enable (R67). An engine left disabled is still installed, and the listing's
// project-scope flag can read a stale false anyway (S22), so these lines, never the flag, are what the
// next run reads: the installed set to keep (and to uninstall from, when a run keeps fewer), and the
// last choice an engine installed again is switched back to.
//
// `installed-always-rules` / `installed-always-mcps` record what the locked baseline actually
// CARRIES as the run ends, never what shipped. A server counts either way - registered in the file,
// or riding the plugin named for it - because on the plugin route there is no `.mcp.json` at all,
// and a stamp that only read the file would record an install with none of the locked three.
const fs = require('node:fs');
const path = require('node:path');
const { stampFile, LEGACY } = require('./brand.js');
// Fix round 1: inlined rather than `require('../derive-state.js')` - that module pulls in
// selection-plugins.js, plugin-placement.js, install/manifest.js, hook-prelude.js and install/
// plugins.js, a heavy graph for a one-line splitter, and every consumer of stamp.js (library-
// stamp.js's SessionStart hook included) would have had to ship the whole chain just to get this.
// Kept identical to derive-state.js's own copy (scripts/derive-state.js:200) - a drift there is a
// drift here.
const splitPick = (entry) => { const [name, home = ''] = String(entry).split('@'); return { name, home: home || null }; };

// A playwright engine server belongs to its FAMILY: the always-list names `playwright`, and an
// install carrying `playwright-firefox` is carrying it.
const family = (name) => String(name).replace(/^playwright-.*/, 'playwright');

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };

// N1 (R58 fix round 2, security): a stamp is a project file a clone can fill with ANY text, so a
// name it records is validated before it ever reaches a path join, a copy, or a printed 'rm -rf' -
// at all three sites that build one from stamp-recorded names (migrateLegacyGlobal below,
// library-check.js's shadow row, library-stamp.js's session echo). One path segment, the shape the
// installer itself gives a skill name (lowercase letters, digits, dot, underscore, hyphen, starting
// with a letter or digit); never empty, never '.' or '..', no '/' or '\'. The regex alone already
// excludes a traversal segment, but the containment check is what actually gates behaviour - a name
// that passes the shape check is checked AGAIN after joining, so a resolved path landing anywhere
// but directly inside the skills dir it was joined into is rejected too.
const SKILL_NAME = /^[a-z0-9][a-z0-9._-]*$/;
function validSkillName(name, skillsDir)
{
    if (typeof name !== 'string' || name === '.' || name === '..' || !SKILL_NAME.test(name)) return false;
    const base = path.resolve(skillsDir);
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

function renderStamp(fields)
{
    const { repoUrl, ref, sha, version, installed, action, scope, hooks, hooksRoute, alwaysRules, alwaysMcps, picked = {}, playwright = [], playwrightEnabled, library = {} } = fields;
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
        `playwright-browsers: ${(playwright || []).join(',')}`,
        ...(Array.isArray(playwrightEnabled) ? [`playwright-enabled: ${playwrightEnabled.join(',')}`] : []),
        `library-skills: ${hashes(library.skills)}`,
        `library-agents: ${hashes(library.agents)}`,
        `library-rules: ${hashes(library.rules)}`,
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
        source, action, scope, configDir, projectRoot, mcpFile, hooksCatalog, hooksRoute, picked, playwright, playwrightEnabled, library,
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
            alwaysRules: always.rules, alwaysMcps: always.mcps, picked, playwright, playwrightEnabled, library,
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

// The playwright engines the last install installed (or, with `playwright-enabled`, enabled), in the
// one canonical order - [] when it recorded none, null when the stamp has no such line (no stamp, or
// one from before the line): nothing recorded.
const PW_ORDER = ['chrome', 'msedge', 'firefox', 'webkit'];
function readPlaywright(file, line = 'playwright-browsers')
{
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
    const m = new RegExp(`^${line}:(.*)$`, 'm').exec(text);
    if (!m) return null;
    const named = m[1].split(',').map((s) => s.trim().toLowerCase());
    return PW_ORDER.filter((e) => named.includes(e));
}
const readPlaywrightEnabled = (file) => readPlaywright(file, 'playwright-enabled');
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
function migrateLegacyGlobal({ configDir, projectRoot, log = () => {}, note = () => {} })
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
            if (!validSkillName(name, acctSkills)) { log(`  skill name skipped (${String(name).length} chars) - not a valid skill name`); continue; }
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
    const rmCmd = shadow.length ? `rm -rf ${shadow.map((n) => `'${path.join(acctSkills, n)}'`).join(' ')}` : '';
    log(`  a 1.x global install's stamp and ${moved} skill(s) were moved from ${configDir} into the project - `
        + 'the account copies stay in place and OVERRIDE the migrated ones (Claude Code runs a personal skill '
        + 'over a project one of the same name) - once every project has updated, remove them:'
        + (rmCmd ? ` ${rmCmd}` : ' (nothing was actually copied - no removal needed)'));
    return true;
}

module.exports = {
    writeStamp, stampPath, stampFiles, renderStamp, shippedHooks, installedAlways, family,
    readPicked, readLibrary, readStampScope, readHooksRoute, markHooksRoute, readPlaywright, readPlaywrightEnabled, readVersion, migrateLegacyGlobal, validSkillName,
};
