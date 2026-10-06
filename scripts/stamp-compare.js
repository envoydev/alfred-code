#!/usr/bin/env node
'use strict';
// stamp-compare.js - the stamp-vs-snapshot delta the guided commands report.
//
// Reads the install's alfred-code.stamp (the commit + version the install was
// copied from) and the snapshot's RELEASE-SOURCE (or the clone's git HEAD),
// asks the GitHub compare API what changed between them, and prints a compact
// line contract the update/configure commands consume verbatim - so the model
// never parses raw API JSON and the compare logic has ONE home:
//
//   version: 0.2.17 -> 0.2.19        (or 'version: unknown' when either side lacks one)
//   base: <sha> head: <sha>
//   TRUNCATED - ...                  (only when the API capped at 300 files)
//   <status>\t<path>[\t<- <old-path>]   filtered to stack-owned paths
//
// Exit codes the caller branches on: 0 = compare done; 2 = no stamp (prints
// 'no-stamp'); 3 = compare unreachable (prints 'compare-unreachable'). Both
// non-zero paths are refresh-only signals, never errors that stop an update;
// a usage error exits 1 so it can never read as the no-stamp signal.
// GITHUB_TOKEN (optional) authenticates the compare: a private fork's repo
// 404s without it, and the anonymous limit is 60 requests an hour.
const fs = require('node:fs');
const path = require('node:path');
const { versionTag } = require('./install/source.js');
const { BRAND, stampFile: stampIn } = require('./install/brand.js');

const STACK_PATHS = /^(stack|skills|agents|rules|hooks|templates)\//;

function arg(name)
{
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

function readStampFile(file)
{
    try
    {
        const text = fs.readFileSync(file, 'utf8');
        const pick = key => (text.match(new RegExp(`^${key}: (.+)$`, 'm')) || [])[1];
        return { sha: pick('sha'), version: pick('version') };
    }
    catch { return { sha: undefined, version: undefined }; }
}

function snapshotHead(dir)
{
    const rs = readStampFile(path.join(dir, 'RELEASE-SOURCE'));
    if (rs.sha) return rs;
    // A clone fallback has no RELEASE-SOURCE - its git HEAD is the same truth.
    // The one Windows-safe spawn (R105), required only on this fallback. Its stderr is dropped: a plugin-cache
    // snapshot is no repository, and git's 'fatal: not a git repository' reached the update's preflight output.
    try { return { sha: require('./install/runtime.js').execCommand('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), version: undefined }; }
    catch
    {
        // A plugin-cache snapshot has neither: its version tag, the revision the installer stamps from it.
        const tag = versionTag(dir);
        return { sha: tag || undefined, version: tag ? tag.slice(1) : undefined };
    }
}

async function compareFiles(repo, base, head)
{
    const fixture = arg('--fixture');   // test injection - the saved compare API JSON
    if (fixture) return JSON.parse(fs.readFileSync(fixture, 'utf8'));
    const res = await fetch(`https://api.github.com/repos/${repo}/compare/${base}...${head}`,
        { headers: { accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`compare API ${res.status}`);
    return res.json();
}

async function main()
{
    // A 1.x project's stamp keeps its old name until the next update rewrites it: a missing
    // alfred-code.stamp - named, or the default - is read as the 1.x one beside it.
    const named = arg('--stamp');
    const stampFile = named && (path.basename(named) !== BRAND.stamp || fs.existsSync(named))
        ? named
        : stampIn(named ? path.dirname(named) : '.claude').read || named || path.join('.claude', BRAND.stamp);
    const snapshot = arg('--snapshot');
    if (!snapshot) { console.error('usage: stamp-compare.js --snapshot <extracted-repo-dir> [--stamp <stamp-file>] [--repo <owner/name>] [--fixture <compare.json>]'); process.exit(1); }
    const repo = arg('--repo') || 'envoydev/alfred-code';

    const stamp = readStampFile(stampFile);
    const head = snapshotHead(snapshot);
    console.log(`version: ${stamp.version && head.version ? `${stamp.version} -> ${head.version}` : 'unknown'}`);
    console.log(`base: ${stamp.sha || 'unknown'} head: ${head.sha || 'unknown'}`);
    if (!stamp.sha) { console.log('no-stamp'); process.exit(2); }
    if (stamp.sha === head.sha) return;   // same revision - an empty diff, not a failure

    let files;
    try { files = (await compareFiles(repo, stamp.sha, head.sha)).files || []; }
    catch (e) { console.log('compare-unreachable'); console.error(`stamp-compare: ${e.message}`); process.exit(3); }

    if (files.length >= 300) console.log('TRUNCATED - the compare API caps at 300 files; this list may be incomplete');
    for (const f of files)
        if (STACK_PATHS.test(f.filename) || (f.previous_filename && STACK_PATHS.test(f.previous_filename)))
            console.log(f.status + '\t' + f.filename + (f.previous_filename ? '\t<- ' + f.previous_filename : ''));
}

main().catch(e => { console.log('compare-unreachable'); console.error(`stamp-compare: ${e.message}`); process.exit(3); });
