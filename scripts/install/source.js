'use strict';
// THE SOURCE SNAPSHOT - one per run, so an install is a single revision.
//
// Four routes, in this order, and the order is the whole design:
//
//   1. a handed `--source`  - a local checkout, the route every plugin command and the temp-project
//      matrix take, because the command has already resolved the snapshot and passes it down;
//   2. the PLUGIN CACHE     - `<config>/plugins/cache/<marketplace>/alfred-code/<version>/`, which
//      is the whole repo, because every marketplace entry is sourced from the repo root. This is
//      the common run and it downloads NOTHING. It is also, by construction, the revision the
//      enabled plugins are running from, so the seed and the plugins can never be two releases;
//   3. the release archive  - one asset is one revision, and it needs no git;
//   4. a shallow clone of `main` - a fork with no releases, a blocked CDN, a local test path.
//
// Pinned to `main` on the clone: the release branch is what installs deliver. Development lands on
// `develop`, and a clone of the default branch would ship unreleased work to a user who asked for
// the stack.
//
// Both OUTCOMES are memoised. Five layers call this, and without the failure latch an offline run
// would pay five download timeouts and report five failures for one root cause.
const fs = require('node:fs');
const path = require('node:path');
const { BRAND } = require('./brand.js');

// The one validity test every route shares: a directory counts as the stack only when it carries
// BOTH trees, so an interrupted cache write is passed over rather than half-installed.
function isValidSource(dir)
{
    if (!dir) return false;
    try
    {
        return fs.statSync(path.join(dir, 'stack', 'skills')).isDirectory()
            && fs.statSync(path.join(dir, 'stack', 'agents')).isDirectory();
    }
    catch { return false; }
}

// Release versions, so `0.10.0` is NEWER than `0.9.0`. A lexical sort gets that backwards and would
// pin every machine to its oldest cached entry the day a minor number reaches double digits.
function compareVersions(a, b)
{
    const pa = String(a).split(/[.-]/);
    const pb = String(b).split(/[.-]/);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++)
    {
        const na = Number(pa[i]);
        const nb = Number(pb[i]);
        if (Number.isNaN(na) || Number.isNaN(nb))
        {
            const sa = pa[i] ?? '';
            const sb = pb[i] ?? '';
            if (sa !== sb) return sa < sb ? -1 : 1;
            continue;
        }
        if (na !== nb) return na < nb ? -1 : 1;
    }
    return 0;
}

// `sha:` / `ref:` out of the RELEASE-SOURCE file an extracted release archive carries.
// A missing or unreadable file is not an error: readRevision falls back to the version tag.
function readReleaseSource(dir)
{
    try
    {
        const text = fs.readFileSync(path.join(dir, 'RELEASE-SOURCE'), 'utf8');
        const field = (k) => (text.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1]?.trim() || '';
        return { sha: field('sha'), ref: field('ref') };
    }
    catch { return { sha: '', ref: '' }; }
}

// The release a snapshot IS, as the tag the release workflow cuts for it: `v<version>` from its own
// plugin.json. A GitHub marketplace writes its cache entry from the repo tree, which carries no
// RELEASE-SOURCE and no .git (measured on real installs), so this is the one revision such an entry
// can name - without it the run writes no stamp. '' when the snapshot names no version.
function versionTag(dir)
{
    try
    {
        const version = JSON.parse(fs.readFileSync(path.join(dir, 'setup-plugin', '.claude-plugin', 'plugin.json'), 'utf8')).version;
        return version ? `v${version}` : '';
    }
    catch { return ''; }
}

// RELEASE-SOURCE's exact commit when the snapshot carries one, else its version tag.
function readRevision(dir)
{
    const release = readReleaseSource(dir);
    if (release.sha) return release;
    const tag = versionTag(dir);
    return { sha: tag, ref: tag };
}

// The newest valid entry across EVERY marketplace. A machine can have the stack cached under more
// than one marketplace name, and the newest of them is the one the enabled plugins run from.
//
// An orphaned dir (the CLI marks one `.orphaned_at` but keeps its files) is never the snapshot - a
// stale copy would install the release this run is replacing.
function pluginCache(configDir)
{
    const base = path.join(configDir, 'plugins', 'cache');
    let best = null;
    let bestVersion = null;
    let marketplaces;
    try { marketplaces = fs.readdirSync(base, { withFileTypes: true }); }
    catch { return null; }
    for (const mkt of marketplaces)
    {
        if (!mkt.isDirectory()) continue;
        const entryDir = path.join(base, mkt.name, BRAND.core);
        let versions;
        try { versions = fs.readdirSync(entryDir, { withFileTypes: true }); }
        catch { continue; }
        for (const v of versions)
        {
            if (!v.isDirectory()) continue;
            const dir = path.join(entryDir, v.name);
            if (!isValidSource(dir) || fs.existsSync(path.join(dir, '.orphaned_at'))) continue;
            if (!best || compareVersions(v.name, bestVersion) > 0) { best = dir; bestVersion = v.name; }
        }
    }
    return best;
}

// An SSH remote is no browsable URL for the stamp's compare line - spell it as https.
function httpsRemote(url)
{
    return String(url || '')
        .replace(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/, 'https://$1/$2')
        .replace(/\.git$/, '');
}

function createSource(opts)
{
    const {
        configDir, sourceDir, repoUrl,
        log = () => {}, note = () => {},
        // The two outward routes are injected so a test can prove 'nothing was downloaded' by a
        // counter rather than by being fast, and so the resolution ORDER is testable offline.
        fetchArchive, clone, gitRevision,
    } = opts;

    let resolved = null;
    let tried = false;

    function fromProvided()
    {
        if (!isValidSource(sourceDir))
        {
            // A wrong --source would otherwise 'install' nothing and report one failure per file,
            // which reads as 117 problems instead of the one that is actually there.
            note(`--source '${sourceDir}' is not an alfred-code checkout (no stack/skills + stack/agents) - stack source unavailable`);
            return null;
        }
        const git = gitRevision ? gitRevision(sourceDir) : null;
        const release = readRevision(sourceDir);
        const sha = git?.sha || release.sha;
        const ref = git?.ref || release.ref;
        if (!sha) log(`source: ${sourceDir} (provided; no git checkout, RELEASE-SOURCE or plugin version - no revision, so no stamp)`);
        else log(`source: ${sourceDir} (provided) @ ${ref || '?'} ${sha.slice(0, 12)}`);
        // Stamp the URL the caller actually cloned from, not our default - they may have used a fork.
        return { dir: sourceDir, owned: false, route: 'provided', sha, ref, repoUrl: httpsRemote(git?.remote || repoUrl) };
    }

    function fromCache()
    {
        const dir = pluginCache(configDir);
        if (!dir) return null;
        const { sha, ref } = readRevision(dir);
        log(`source: plugin cache ${dir} @ ${ref || '?'} ${(sha || 'unknown').slice(0, 12)} (no download)`);
        // The cache is the CLI's own plugin install, not a copy of it - never ours to delete.
        return { dir, owned: false, route: 'plugin-cache', sha, ref, repoUrl };
    }

    function fromArchive()
    {
        const dir = fetchArchive ? fetchArchive() : null;
        if (!dir || !isValidSource(dir)) return null;
        const { sha, ref } = readRevision(dir);
        log(`source: ${repoUrl}/releases/latest/download @ ${ref || '?'} ${(sha || 'unknown').slice(0, 12)}`);
        return { dir, owned: true, route: 'release-archive', sha, ref, repoUrl };
    }

    function fromClone()
    {
        const got = clone ? clone() : null;
        if (!got || !isValidSource(got.dir)) return null;
        log(`source: ${repoUrl} (clone fallback) @ ${got.ref || '?'} ${(got.sha || 'unknown').slice(0, 12)}`);
        return { dir: got.dir, owned: true, route: 'clone', sha: got.sha || '', ref: got.ref || '', repoUrl };
    }

    function resolve()
    {
        if (resolved) return resolved;
        if (tried) return null;
        tried = true;

        if (sourceDir) { resolved = fromProvided(); return resolved; }

        resolved = fromCache() || fromArchive() || fromClone();
        if (!resolved)
        {
            // Name the CACHE: it is the only offline route, and the one an ordinary machine has.
            note(`release archive and clone of ${repoUrl} both failed, and no plugin cache is present - stack source unavailable (nothing refreshed; existing copies kept)`);
        }
        return resolved;
    }

    function cleanup()
    {
        if (resolved && resolved.owned) fs.rmSync(resolved.dir, { recursive: true, force: true });
    }

    return { resolve, cleanup, get current() { return resolved; } };
}

module.exports = { createSource, isValidSource, pluginCache, compareVersions, readReleaseSource, readRevision, versionTag, httpsRemote };
