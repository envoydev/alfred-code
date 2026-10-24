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
//   blocked - a skill set to 'off' or 'user-invocable-only' in skillOverrides that a rule copy still sends
//             the model to (a backticked name): that Skill call fails
//   unrecorded - (with --source) a skill folder the stamp does not record whose heading the stack has shipped
//             under that name: a copy made before the stamp recorded skills; /alfred-code:update takes it over
//
// T16 (R29): every scope's stamp and library copies live in the PROJECT - `--config-dir` names the
// account dir only for the shadow check below. `--scope` is gone - an install never puts either in
// the account dir, whatever scope it was made at.
//
// Exit 1 on any finding, 0 when clean - and 0 with 'no library stamp' when the stamp has no library
// lines (an older release, the shell twin, a project the stack never installed): nothing to check.
const fs = require('node:fs');
const path = require('node:path');
const { readLibrary, readPicked, validItemName, readSeatsRoute } = require('./install/stamp.js');
const { headingOf, headingHash, pastHeadings } = require('./install/skill-headings.js');
const { stampFile } = require('./install/brand.js');
const { hashItem, hashBuffer } = require('./install/library.js');
const { parseJson } = require('./install/json-file.js');
const { resolveDocsRoot } = require('./install/copy.js');

// alfred-docs-root.md is never byte-identical between the pristine SOURCE (which ships the
// `__DOCS_ROOT__` placeholder) and the PROJECT copy (which the installer substitutes the resolved
// path into, then hashes) - so a raw source-vs-stamp hash compare would read it as permanently
// 'behind'. Restore the placeholder's CURRENT resolved value into the source content before
// hashing, so the normalised comparison matches what an up-to-date copy actually holds.
// alfred-preferences.md names its docs by the same substituted root (2026-10-21).
const ROOTED_RULES = new Set(['alfred-docs-root', 'alfred-preferences']);

const readJson = (file) => { try { return parseJson(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; } };
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
    const own = stampFile(claudeDir).read;
    const stamp = readLibrary(own);
    if (!stamp) return null;
    const overrides = (file) => { const o = readJson(file).skillOverrides; return o && typeof o === 'object' ? o : {}; };
    const settings = overrides(path.join(project, '.claude', 'settings.json'));
    const local = overrides(path.join(project, '.claude', 'settings.local.json'));
    const sourceVersion = source ? (readJson(path.join(source, 'setup-plugin', '.claude-plugin', 'plugin.json')).version || '') : '';
    const rows = [];
    // Every kind is a project copy - no plugin ever carries a rule.
    const dirs = { skills: path.join(claudeDir, 'skills'), agents: path.join(project, '.claude', 'agents'), rules: path.join(project, '.claude', 'rules') };
    const docsRoot = resolveDocsRoot(project);
    // The pristine SOURCE hash for one item - normalised for alfred-docs-root.md, whose source
    // content never matches an up-to-date project copy byte for byte (see the constant's comment).
    // A single-file item is compared as the installer wrote it: the docs root substituted.
    const upHash = (kind, name) =>
    {
        const srcFile = kind === 'skills' ? path.join(source, 'stack', 'skills', name) : path.join(source, 'stack', kind, `${name}.md`);
        if (kind === 'skills') return hashItem(srcFile);
        if (!(kind === 'rules' && ROOTED_RULES.has(name))) return hashItem(srcFile);
        let body;
        try { body = fs.readFileSync(srcFile, 'utf8'); } catch { return hashItem(srcFile); }
        return hashBuffer(`${name}.md`, Buffer.from(body.split('__DOCS_ROOT__').join(docsRoot)));
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
                // same name - an account copy of this same skill silently overrides this project's own
                // library copy however clean everything else above reads. N1: a name the PROJECT stamp records is validated before it is ever joined against
                // the account skills/ dir - a corrupted or hand-edited stamp can never make this
                // check (or the printed rm -rf below) point outside it. configDir is checked for
                // truthiness FIRST - path.join throws on a null/undefined first argument, and most
                // callers pass no --config-dir at all.
                if (configDir)
                {
                    const acctSkillsDir = path.join(configDir, 'skills');
                    if (validItemName(name, acctSkillsDir))
                    {
                        let isDir = false;
                        try { isDir = fs.statSync(path.join(acctSkillsDir, name)).isDirectory(); } catch { isDir = false; }
                        if (isDir) row.shadowedByAccount = true;
                    }
                }
            }
            rows.push(row);
        }
    // M75 (2.1.5 audit): `skillOverrides` is the per-project lever for a locked skill, but a shipped rule
    // that still sends the model to that skill makes the call fail - 'off' and 'user-invocable-only' both
    // refuse a model Skill call ('name-only' only hides the description). A rule names a skill as a
    // backticked name; only the stamp's own rule copies are read, each name validated before it is joined.
    const REFUSED = new Set(['off', 'user-invocable-only']);
    const refused = Object.entries({ ...settings, ...local })
        .filter(([name, mode]) => REFUSED.has(mode) && validItemName(name, dirs.skills))
        .sort(([a], [b]) => a.localeCompare(b));
    const blocked = [];
    for (const [skill, mode] of refused)
    {
        const cite = new RegExp('`' + skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`');
        const rules = Object.keys(stamp.rules || {}).sort().filter((name) =>
        {
            if (!validItemName(name, dirs.rules)) return false;
            try { return cite.test(fs.readFileSync(path.join(dirs.rules, `${name}.md`), 'utf8')); } catch { return false; }
        });
        if (rules.length) blocked.push({ skill, mode, rules });
    }
    // A skill folder the stamp does not record whose heading the stack has shipped under that name (meta/skill-headings.json):
    // a copy made before the stamp recorded skills. Update takes it over (M3) - until then it is an older stack text the
    // model reads (2026-10-16: 14 and 28 such copies in two installs, ~700-char descriptions on every call).
    const unrecorded = [];
    if (source)
    {
        const past = pastHeadings(source);
        const held = new Set([...Object.keys(stamp.skills || {}), ...((readPicked(own) || {}).skills || []).map((e) => e.split('@')[0])]);
        let names = [];
        try { names = fs.readdirSync(dirs.skills).sort(); } catch { names = []; }
        for (const name of names)
        {
            // Only a name the stack still ships: a retired one's old copy is update's prune to report, not a take-over.
            if (held.has(name) || !past.has(name) || !validItemName(name, dirs.skills)
                || !fs.existsSync(path.join(source, 'stack', 'skills', name, 'SKILL.md'))) continue;
            let heading = null;
            try { heading = headingOf(fs.readFileSync(path.join(dirs.skills, name, 'SKILL.md'), 'utf8')); } catch { heading = null; }
            if (heading && past.get(name).has(headingHash(heading))) unrecorded.push(name);
        }
    }
    const stale = Boolean(sourceVersion && stamp.version && newer(sourceVersion, stamp.version));
    // The 2.1.0 move: a stamp from before it names no `seats-route:`.
    const moved = stale && !newer('2.1.0', sourceVersion) && newer('2.1.0', stamp.version) && !readSeatsRoute(own);
    return { version: stamp.version, sourceVersion, rows, invalid, stale, moved, blocked, unrecorded };
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
    const findings = bad.length + (res.stale ? 1 : 0) + shadowed.length + res.invalid + res.blocked.length + res.unrecorded.length;
    if (argv.includes('--json')) { console.log(JSON.stringify(res)); return findings ? 1 : 0; }
    if (res.stale) console.log(`stale stamp: the project copies are from ${res.version}, the stack is ${res.sourceVersion} - run /alfred-code:update${res.moved
        ? ' (2.1.0 moved every skill into the project and every seat into the core - until the update runs here, the house skills are not copied and every seat is listed undenied)' : ''}`);
    const say = { drift: 'edited in the project since update wrote it', missing: 'listed in the stamp, absent from the project', behind: 'the running stack ships a newer version' };
    for (const r of bad) console.log(`${r.state}: ${r.kind} ${r.name} - ${say[r.state]}`);
    for (const name of res.unrecorded) console.log(`unrecorded: skill ${name} - an older stack copy the stamp does not record; /alfred-code:update takes it over`);
    if (res.invalid) console.log(`invalid: ${res.invalid} stamp name(s) are not valid item names - skipped, never read`);
    for (const r of res.rows.filter((row) => row.mode && row.mode !== 'on')) console.log(`switched: skill ${r.name} is '${r.mode}' in skillOverrides`);
    for (const b of res.blocked)
        console.log(`blocked: skill ${b.skill} is '${b.mode}' in skillOverrides, but ${b.rules.map((r) => `${r}.md`).join(', ')} sends the model to it - `
            + `that Skill call fails; set it to 'name-only' (hides the description, keeps the call) or 'on', or drop the rule`);
    for (const r of shadowed)
        console.log(`shadowed: skill ${r.name} - an account copy at ${path.join(configDir, 'skills', r.name)} overrides this project's own `
            + `(Claude Code runs a personal skill over a project one of the same name) - once every project has updated, `
            + `remove it: rm -rf '${path.join(configDir, 'skills', r.name)}'`);
    console.log(findings ? `library: ${findings} finding(s) over ${res.rows.length} copies` : `library: clean (${res.rows.length} copies)`);
    return findings ? 1 : 0;
}

if (require.main === module)
{
    require('../stack/hooks/hook-prelude.js').blockingStdio();
    process.exit(main(process.argv.slice(2)));
}
module.exports = { check };
