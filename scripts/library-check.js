#!/usr/bin/env node
'use strict';
// What the project's LIBRARY copies look like against the stamp that wrote them and the stack
// that is running now. Read-only; validate and status paste its rows, the stale line is theirs too.
//
//   node scripts/library-check.js --project <root> [--source <dir>] [--config-dir <dir>] [--json]
//
//   drift   - the copy differs from the hash the stamp recorded: edited in the project
//   missing - the stamp lists it, the project has no copy
//   behind  - the running stack ships a different version of it: /alfred-code:update takes it
//   stale   - the stamp's release is older than the running stack's (plugins update themselves,
//             library copies only move on /alfred-code:update); a stamp from before 2.1.0 (no
//             `seats-route:`) under a stack at or past it also names the move - every skill into the
//             project, every seat into the core - since until the update the house skills are not here
//
// T16 (R29): every scope's stamp and library copies live in the PROJECT now - `--config-dir` is a
// LEGACY fallback only, for a 1.x global install this project has not yet run an `update` over (the
// installer's own migrateLegacyGlobal moves it on that first update; until then this is how
// validate/status still find it). `--scope` is gone - a 2.x install never puts either in the
// account dir again, whatever scope it was made at.
//
// Exit 1 on any finding, 0 when clean - and 0 with 'no library stamp' when the stamp has no library
// lines (an older release, the shell twin, a project the stack never installed): nothing to check.
const fs = require('node:fs');
const path = require('node:path');
const { readLibrary, validItemName, readSeatsRoute } = require('./install/stamp.js');
const { stampFile, LEGACY } = require('./install/brand.js');
const { hashItem, hashBuffer } = require('./install/library.js');
const { resolveDocsRoot } = require('./install/copy.js');

// baseline-docs-root.md is never byte-identical between the pristine SOURCE (which ships the
// `__DOCS_ROOT__` placeholder) and the PROJECT copy (which the installer substitutes the resolved
// path into, then hashes) - so a raw source-vs-stamp hash compare would read it as permanently
// 'behind'. Restore the placeholder's CURRENT resolved value into the source content before
// hashing, so the normalised comparison matches what an up-to-date copy actually holds.
const DOCS_ROOT_RULE = 'baseline-docs-root';

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; } };
const newer = (a, b) =>
{
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    return false;
};

function check({ project, source, configDir })
{
    const claudeDir = path.join(project, '.claude');
    let base = claudeDir;
    // A 1.x project's own stamp keeps its old name until the next update rewrites it.
    const own = stampFile(claudeDir).read;
    let stamp = readLibrary(own);
    if (!own && configDir)
    {
        // A 1.x GLOBAL install left its stamp (and its skills) in the account dir, not yet migrated
        // by an update - read it there too, once, so validate/status still report it. Only when the
        // project has NO stamp file (R54 M3): one whose own stamp carries no library lines is its own
        // install, and the account stamp describes some other.
        const legacy = path.join(configDir, LEGACY.stamp);
        if (fs.existsSync(legacy)) { stamp = readLibrary(legacy); base = configDir; }
    }
    if (!stamp) return null;
    const overrides = (file) => { const o = readJson(file).skillOverrides; return o && typeof o === 'object' ? o : {}; };
    const settings = overrides(path.join(project, '.claude', 'settings.json'));
    const local = overrides(path.join(project, '.claude', 'settings.local.json'));
    const sourceVersion = source ? (readJson(path.join(source, 'setup-plugin', '.claude-plugin', 'plugin.json')).version || '') : '';
    const rows = [];
    // `base` is the project at every scope now - only a not-yet-migrated 1.x global install's
    // legacy read still points `skills` at the account dir. Agents and rules were always project-
    // only - no plugin ever carries a rule, so a rule is always a project copy.
    const dirs = { skills: path.join(base, 'skills'), agents: path.join(project, '.claude', 'agents'), rules: path.join(project, '.claude', 'rules') };
    const docsRoot = resolveDocsRoot(project);
    // The pristine SOURCE hash for one item - normalised for baseline-docs-root.md, whose source
    // content never matches an up-to-date project copy byte for byte (see the constant's comment).
    const upHash = (kind, name) =>
    {
        const srcFile = kind === 'skills' ? path.join(source, 'stack', 'skills', name) : path.join(source, 'stack', kind, `${name}.md`);
        if (kind === 'rules' && name === DOCS_ROOT_RULE)
        {
            let body;
            try { body = fs.readFileSync(srcFile, 'utf8'); } catch { return null; }
            return hashBuffer(`${name}.md`, Buffer.from(body.split('__DOCS_ROOT__').join(docsRoot)));
        }
        return hashItem(srcFile);
    };
    // A stamp is a project file a clone can fill with any text: a name is validated BEFORE it is joined,
    // hashed or printed (the N1 rule, stamp.js validItemName) - an invalid one is only counted, readLibrary's
    // own drop count included.
    let invalid = stamp.invalid || 0;
    for (const kind of ['skills', 'agents', 'rules'])
        for (const [name, hash] of Object.entries(stamp[kind] || {}).sort())
        {
            if (!validItemName(name, dirs[kind])) { invalid += 1; continue; }
            const file = kind === 'skills' ? path.join(dirs.skills, name) : path.join(dirs[kind], `${name}.md`);
            const have = hashItem(file);
            let state = 'ok';
            if (!have) state = 'missing';
            else if (have !== hash) state = 'drift';
            else if (source)
            {
                const up = upHash(kind, name);
                if (up && up !== hash) state = 'behind';
            }
            const row = { kind: kind.slice(0, -1), name, state };
            if (kind === 'skills')
            {
                row.mode = local[name] || settings[name] || 'on';
                // I6 (R47, fix round 1): Claude Code runs a PERSONAL skill over a project one of the
                // same name - an account copy of this same skill (left by migrateLegacyGlobal, or
                // hand-added separately) silently overrides this project's own library copy however
                // clean everything else above reads. configDir is checked whether or not it was this
                // run's STAMP source, because the shadow can exist beside an install that was always
                // project-native too - EXCEPT when dirs.skills already IS configDir/skills (a 1.x
                // global install not yet migrated): that is the project's own copy, not a shadow.
                // N1: a name the PROJECT stamp records is validated before it is ever joined against
                // the account skills/ dir - a corrupted or hand-edited stamp can never make this
                // check (or the printed rm -rf below) point outside it. configDir is checked for
                // truthiness FIRST - path.join throws on a null/undefined first argument, and most
                // callers pass no --config-dir at all.
                if (configDir)
                {
                    const acctSkillsDir = path.join(configDir, 'skills');
                    if (dirs.skills !== acctSkillsDir && validItemName(name, acctSkillsDir))
                    {
                        let isDir = false;
                        try { isDir = fs.statSync(path.join(acctSkillsDir, name)).isDirectory(); } catch { isDir = false; }
                        if (isDir) row.shadowedByAccount = true;
                    }
                }
            }
            rows.push(row);
        }
    const stale = Boolean(sourceVersion && stamp.version && newer(sourceVersion, stamp.version));
    // The 2.1.0 move: a stamp from before it names no `seats-route:`.
    const moved = stale && !newer('2.1.0', sourceVersion) && newer('2.1.0', stamp.version) && !readSeatsRoute(base === claudeDir ? own : path.join(base, LEGACY.stamp));
    return { version: stamp.version, sourceVersion, rows, invalid, stale, moved };
}

function main(argv)
{
    const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
    const project = path.resolve(arg('--project') || '.');
    const source = arg('--source');
    const configDir = arg('--config-dir');
    const res = check({ project, source: source ? path.resolve(source) : null, configDir });
    if (!res) { console.log('library: no library stamp - nothing to check'); return 0; }
    const bad = res.rows.filter((r) => r.state !== 'ok');
    const shadowed = res.rows.filter((r) => r.shadowedByAccount);
    const findings = bad.length + (res.stale ? 1 : 0) + shadowed.length + res.invalid;
    if (argv.includes('--json')) { console.log(JSON.stringify(res)); return findings ? 1 : 0; }
    if (res.stale) console.log(`stale stamp: the project copies are from ${res.version}, the stack is ${res.sourceVersion} - run /alfred-code:update${res.moved
        ? ' (2.1.0 moved every skill into the project and every seat into the core - until the update runs here, the house skills are not copied and every seat is listed undenied)' : ''}`);
    const say = { drift: 'edited in the project since update wrote it', missing: 'listed in the stamp, absent from the project', behind: 'the running stack ships a newer version' };
    for (const r of bad) console.log(`${r.state}: ${r.kind} ${r.name} - ${say[r.state]}`);
    if (res.invalid) console.log(`invalid: ${res.invalid} stamp name(s) are not valid item names - skipped, never read`);
    for (const r of res.rows.filter((row) => row.mode && row.mode !== 'on')) console.log(`switched: skill ${r.name} is '${r.mode}' in skillOverrides`);
    for (const r of shadowed)
        console.log(`shadowed: skill ${r.name} - an account copy at ${path.join(configDir, 'skills', r.name)} overrides this project's own `
            + `(Claude Code runs a personal skill over a project one of the same name) - once every project has updated, `
            + `remove it: rm -rf '${path.join(configDir, 'skills', r.name)}'`);
    console.log(findings ? `library: ${findings} finding(s) over ${res.rows.length} copies` : `library: clean (${res.rows.length} copies)`);
    return findings ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { check };
