#!/usr/bin/env node
'use strict';
// What the project's LIBRARY copies look like against the stamp that wrote them and the stack
// that is running now. Read-only; validate and status paste its rows, the stale line is theirs too.
//
//   node scripts/library-check.js --project <root> [--source <dir>] [--scope project|global] [--config-dir <dir>] [--json]
//
//   drift   - the copy differs from the hash the stamp recorded: edited in the project
//   missing - the stamp lists it, the project has no copy
//   behind  - the running stack ships a different version of it: /alfred-code:update takes it
//   stale   - the stamp's release is older than the running stack's (plugins update themselves,
//             library copies only move on /alfred-code:update)
//
// Exit 1 on any finding, 0 when clean - and 0 with 'no library stamp' when the stamp has no library
// lines (an older release, the shell twin, a project the stack never installed): nothing to check.
const fs = require('node:fs');
const path = require('node:path');
const { readLibrary } = require('./install/stamp.js');
const { stampFile } = require('./install/brand.js');
const { hashItem } = require('./install/library.js');

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; } };
const newer = (a, b) =>
{
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    return false;
};

function check({ project, source, scope = 'project', configDir })
{
    const base = (scope === 'global' || scope === 'user') && configDir ? configDir : path.join(project, '.claude');
    // A 1.x project's stamp keeps its old name until the next update rewrites it.
    const stamp = readLibrary(stampFile(base).read);
    if (!stamp) return null;
    const overrides = (file) => { const o = readJson(file).skillOverrides; return o && typeof o === 'object' ? o : {}; };
    const settings = overrides(path.join(project, '.claude', 'settings.json'));
    const local = overrides(path.join(project, '.claude', 'settings.local.json'));
    const sourceVersion = source ? (readJson(path.join(source, 'setup-plugin', '.claude-plugin', 'plugin.json')).version || '') : '';
    const rows = [];
    // A global install keeps its skills in the account dir and its agents in the project.
    const dirs = { skills: path.join(base, 'skills'), agents: path.join(project, '.claude', 'agents') };
    for (const kind of ['skills', 'agents'])
        for (const [name, hash] of Object.entries(stamp[kind]).sort())
        {
            const file = kind === 'skills' ? path.join(dirs.skills, name) : path.join(dirs.agents, `${name}.md`);
            const have = hashItem(file);
            let state = 'ok';
            if (!have) state = 'missing';
            else if (have !== hash) state = 'drift';
            else if (source)
            {
                const up = hashItem(kind === 'skills' ? path.join(source, 'stack', 'skills', name) : path.join(source, 'stack', 'agents', `${name}.md`));
                if (up && up !== hash) state = 'behind';
            }
            const row = { kind: kind.slice(0, -1), name, state };
            if (kind === 'skills') row.mode = local[name] || settings[name] || 'on';
            rows.push(row);
        }
    return { version: stamp.version, sourceVersion, rows, stale: Boolean(sourceVersion && stamp.version && newer(sourceVersion, stamp.version)) };
}

function main(argv)
{
    const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
    const project = path.resolve(arg('--project') || '.');
    const source = arg('--source');
    const res = check({ project, source: source ? path.resolve(source) : null, scope: arg('--scope') || 'project', configDir: arg('--config-dir') });
    if (!res) { console.log('library: no library stamp - nothing to check'); return 0; }
    const bad = res.rows.filter((r) => r.state !== 'ok');
    const findings = bad.length + (res.stale ? 1 : 0);
    if (argv.includes('--json')) { console.log(JSON.stringify(res)); return findings ? 1 : 0; }
    if (res.stale) console.log(`stale stamp: the project copies are from ${res.version}, the stack is ${res.sourceVersion} - run /alfred-code:update`);
    const say = { drift: 'edited in the project since update wrote it', missing: 'listed in the stamp, absent from the project', behind: 'the running stack ships a newer version' };
    for (const r of bad) console.log(`${r.state}: ${r.kind} ${r.name} - ${say[r.state]}`);
    for (const r of res.rows.filter((row) => row.mode && row.mode !== 'on')) console.log(`switched: skill ${r.name} is '${r.mode}' in skillOverrides`);
    console.log(findings ? `library: ${findings} finding(s) over ${res.rows.length} copies` : `library: clean (${res.rows.length} copies)`);
    return findings ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { check };
