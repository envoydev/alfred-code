'use strict';
// UNINSTALL (R10) - the stack out of THIS project, and nothing of the user's with it.
//
// The ledger in the stamp (stamp.js `managed-*`, `library-*`) is the whole list: what the installer
// wrote here, each at the hash it wrote it with. Whatever the ledger does not name - a key, a hook, a
// server, a skill the user added - is theirs, and so is anything changed since the stack wrote it: kept,
// and said. A stamp from before the ledger names nothing exactly, so it is refused with the route to
// take (one update writes the ledger), rather than guessed at.
//
// The plugin rows follow the install's scope. At project and local scope the rows are this project's
// own, so they are uninstalled. A USER-scope row serves every project on the account - uninstalling it
// from here would take the stack out of all of them - so its commands are printed and never run
// (ruling). A third-party pick may be in use on its own, and the marketplace registration is the
// account's: both are printed the same way.
//
// The order is plugins first (the hooks stop loading), then the settings entries, .mcp.json, the copies,
// and the stamp LAST - only when nothing failed, so a re-run finishes what this one could not.
const fs = require('node:fs');
const path = require('node:path');
const { hashItem } = require('./library.js');
const { commonJsScope } = require('./copy.js');

// Every library copy (library-*) and every other copy (managed-files) whose hash still matches.
function removeManagedFiles({ claudeDir, skillsDir, library = {}, files = {}, log = () => {} })
{
    const items = [
        ...Object.entries(library.skills || {}).map(([n, h]) => ['skill', n, path.join(skillsDir, n), h]),
        ...Object.entries(library.agents || {}).map(([n, h]) => ['agent', n, path.join(claudeDir, 'agents', `${n}.md`), h]),
        ...Object.entries(library.rules || {}).map(([n, h]) => ['rule', n, path.join(claudeDir, 'rules', `${n}.md`), h]),
        ...Object.entries(files).map(([rel, h]) =>
        {
            const [kind, name] = rel.includes('/') ? rel.split('/') : ['file', rel];
            return [kind.replace(/s$/, ''), name, kind === 'skills' ? path.join(skillsDir, name) : path.join(claudeDir, ...rel.split('/')), h];
        }),
    ];
    for (const [label, name, at, hash] of items)
    {
        const have = hashItem(at);
        if (!have) continue;
        if (have !== hash) { log(`  ${label} ${name}: kept - changed since the stack wrote it, so it is yours`); continue; }
        fs.rmSync(at, { recursive: true, force: true });
        log(`  ${label} removed: ${name}`);
    }
    // The CommonJS marker the installer wrote beside its hook copies goes once no stack copy is left.
    commonJsScope({ dir: path.join(claudeDir, 'hooks'), stackFiles: [], log });
    for (const dir of [skillsDir, ...['agents', 'rules', 'hooks'].map((d) => path.join(claudeDir, d))])
    {
        try { if (!fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch { /* absent, or not ours to empty */ }
    }
}

// The stack's plugin rows (`rows`: every scope's, parsePluginList everyScope) at this install's scope. A
// dependency is refused while its dependent is installed, so a refusal is retried once the pass has
// taken everything else - as many passes as there are rows at most.
function removePlugins({ rows = [], market, scope, thirdParty = [], cli, log = () => {}, note = () => {} })
{
    const ours = rows.filter((r) => r.marketplace === market && r.version);
    let left = [];
    for (const r of ours)
    {
        const spec = `${r.name}@${r.marketplace}`;
        const at = r.scope || scope;
        if (at === scope && scope !== 'user') { if (!left.includes(spec)) left.push(spec); continue; }
        if (at === 'user') log(`  ${spec} is installed at user scope - every project on this account loads it, so it is not removed here: claude plugin uninstall ${spec} --scope user (or, for this project only: claude plugin disable ${spec} --scope project)`);
        else log(`  ${spec} is installed at ${at} scope, not this install's - not removed here: claude plugin uninstall ${spec} --scope ${at}`);
    }
    for (let pass = 0; pass < ours.length && left.length; pass++)
    {
        const next = left.filter((spec) =>
        {
            if (!cli(['plugin', 'uninstall', spec, '--scope', scope, '-y'], { quiet: true, expect: 'reported' })) return true;
            log(`  plugin uninstalled [${scope}]: ${spec}`);
            return false;
        });
        if (next.length === left.length) break;
        left = next;
    }
    for (const spec of left) note(`plugin uninstall failed: ${spec} - remove it by hand: claude plugin uninstall ${spec} --scope ${scope}`);
    for (const r of rows.filter((x) => thirdParty.includes(`${x.name}@${x.marketplace}`) && x.version))
        log(`  ${r.name}@${r.marketplace} (a third-party pick) is not removed - it may be in use on its own; if not: claude plugin uninstall ${r.name}@${r.marketplace} --scope ${r.scope || scope}`);
    return { left };
}

module.exports = { removeManagedFiles, removePlugins };
