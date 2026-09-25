#!/usr/bin/env node
'use strict';
// Copies a repository's TRACKED files, at their WORKING-TREE content, into a clean directory.
//
// Why it exists: the temp-project matrix installs from this working tree, and a marketplace added
// from a LOCAL PATH auto-discovers whatever sits at the source root - measured in spike S9, assert
// (c). This repo is itself a consuming project, so its root carries a machine-local `.mcp.json`
// that a GitHub clone would never have. Installing from the raw working directory would register
// this repo's own MCP servers into the throwaway project and let a matrix case pass or fail for a
// reason that has nothing to do with the change under test. Exporting first removes the whole class.
//
//   node scripts/clean-export.js [<repo>] <dest>
const fs = require('node:fs');
const path = require('node:path');
const rt = require('./install/runtime.js');  // R105: every external command through the one Windows-safe spawn

function cleanExport(repo, dest)
{
    const src = path.resolve(repo);
    const out = path.resolve(dest);
    let listing;
    try
    {
        listing = rt.execCommand('git', ['-C', src, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    }
    catch (err)
    {
        throw new Error(`clean-export: ${src} is not a git repository (${String(err.stderr || err.message).trim()})`);
    }
    const files = listing.split('\0').filter(Boolean);
    fs.rmSync(out, { recursive: true, force: true });
    let written = 0;
    for (const rel of files)
    {
        const from = path.join(src, rel);
        if (!fs.existsSync(from)) continue;          // tracked but deleted in the tree
        const to = path.join(out, rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        fs.chmodSync(to, fs.statSync(from).mode & 0o777);
        written++;
    }
    // The export has no .git, and the installer reads a source's revision from HEAD or, failing
    // that, from a RELEASE-SOURCE file - the same file a real release archive carries. Without it
    // the run resolves no revision and deliberately writes NO alfred-code.stamp, which would make
    // every stamp assertion in the matrix fail for a reason the change under test did not cause.
    // Synthesizing it here is what makes the export behave like the archive a user installs from.
    const sha = git(src, ['rev-parse', 'HEAD']) || '';
    const ref = git(src, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
    const dirty = git(src, ['status', '--porcelain']) ? 'working-tree' : 'clean';
    let version = '0.0.0';
    try { version = JSON.parse(fs.readFileSync(path.join(out, 'setup-plugin/.claude-plugin/plugin.json'), 'utf8')).version || version; }
    catch { /* a tree without the plugin manifest still exports */ }
    fs.writeFileSync(path.join(out, 'RELEASE-SOURCE'),
        `sha: ${sha}\nref: ${ref}\nversion: ${version}\nsource: clean-export\ntree: ${dirty}\n`);

    return { files: written, dest: out, sha, ref, version };
}

function git(cwd, args)
{
    try { return rt.execCommand('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return ''; }
}

if (require.main === module)
{
    const args = process.argv.slice(2);
    const [repo, dest] = args.length >= 2 ? args : [process.cwd(), args[0]];
    if (!dest) { console.error('usage: clean-export.js [<repo>] <dest>'); process.exit(1); }
    try
    {
        const result = cleanExport(repo, dest);
        console.log(`clean-export: ${result.files} tracked file(s) @ ${result.ref} ${result.sha.slice(0, 12)} -> ${result.dest}`);
    }
    catch (err) { console.error(String(err.message || err)); process.exit(1); }
}

module.exports = { cleanExport };
