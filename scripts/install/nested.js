'use strict';
// REMOVE-NESTED - the stack's own files out of an install that sits in a plain subfolder of the same git repository
// (workspace.js `remove-nested`; update offers it on a `nested:` row).
//
// The installer's `uninstall` is never run for this: the installer resolves the project root to the git TOP, so it would
// take out the repository's own install. Every step below takes the nested folder as the project root and `<folder>/.claude`
// as the claude dir, and touches only what that folder's OWN stamp records, at the hash it recorded:
//   a. its links             b. its stack copies (skills, seats, rules, ledgered files)   c. its generated rules
//   d. the stack's keys in its own settings.json and settings.local.json                 e. its mode block, only where
//   the mode file is its own (inside a repository Claude Code keeps that file at the top)  f. its stamp
//   g. the emptied folders .claude/{skills,agents,hooks,rules} and .claude
// Never touched: any `claude plugin` / `claude mcp` call, the account, git's info/exclude, a workspace record, the data
// root (`.alfred`, but for the store copies the stamp records), the instruction file, a copy edited since it was written,
// and any file the stamp does not record. A step that fails is a `!!` line, the others run, and the stamp stays then.
const fs = require('node:fs');
const path = require('node:path');
const stampLayer = require('./stamp.js');
const links = require('./links.js');
const uninstall = require('./uninstall.js');
const settings = require('./settings.js');
const modes = require('./modes.js');
const copy = require('./copy.js');
const workspace = require('./workspace.js');
const { ENUMS } = require('./args.js');

const PREFIX = 'remove-nested';
const STACK_FOLDERS = Object.freeze(['skills', 'agents', 'hooks', 'rules']);
const KEEP_INSTRUCTION_FILE = 'keep';
const LINE = Object.freeze({
    copyKept: /^\s+(\S+) (.+?): kept - (.+)$/,
    pathKept: /^\s+(\S+): kept(?: on your answer)? - (.+)$/,
    generatedKept: /^\s+kept: (\S+) - (.+)$/,
    linkKept: /^\s+\S+ kept: (\S+) - (.+)$/,
    markerKept: /^\s+hooks marker kept: (\S+) - (.+)$/,
    settingsKept: /^\s+(settings(?:\.local)?\.json)(?: env)?: (\S+) kept - (.+)$/,
    removed: /^\s+(?:skill|agent|rule|file|hook) removed: /,
    problem: /^\s+!! /,
});

const LEFTOVER_CAP = 20;
const LEFTOVER_WHY = 'not in the stamp, or edited since - yours';
const DATA_ROOT_WHY = 'the data root stays: its docs, state and your own files';

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
const realOf = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };
const toPosix = (p) => p.split(path.sep).join('/');

// The refusal for a `--path` before any file is looked at, or the segments it names.
function segmentsOf(rel)
{
    if (typeof rel !== 'string' || !rel || rel.includes('\0')) return { why: '--path <rel> is required' };
    if (path.isAbsolute(rel) || path.win32.isAbsolute(rel) || rel.startsWith('/')) return { why: `--path ${rel} is absolute - name a folder below --root` };
    const parts = rel.split(/[\\/]/).filter((s) => s && s !== '.');
    if (parts.includes('..')) return { why: `--path ${rel} climbs out of --root` };
    return { parts };
}

// What stands in the way of removing `rel` below `root`: { why } or { nested, file, rel } - the real folder, its stamp and
// the rel as written. The checks, in order: the spelling, the folder is the root, no stamp, not the same git repository.
function check({ root, rel, exec })
{
    const named = segmentsOf(rel);
    if (named.why) return { why: named.why };
    const rootReal = realOf(root);
    const shown = named.parts.join('/') || '.';
    if (!named.parts.length) return { why: `${rel} is the root itself - its install is removed by /alfred-code:uninstall, never here` };
    const spelled = path.join(rootReal, ...named.parts);
    const nested = realOf(spelled);
    if (!nested || !isDir(nested)) return { why: `${shown} holds no Alfred install - no stamp there` };
    if (nested === rootReal) return { why: `${shown} is the root itself - its install is removed by /alfred-code:uninstall, never here` };
    if (nested !== spelled) return { why: `${shown} is ${toPosix(path.relative(rootReal, nested))} on disk, or outside --root - name the real folder below it` };
    const claudeDir = path.join(nested, '.claude');
    if (isLink(claudeDir)) return { why: `${shown}/.claude is a link - nothing is removed through one` };
    const file = stampLayer.stampFiles({ projectRoot: nested }).read;
    if (!file) return { why: `${shown} holds no Alfred install - no stamp there` };
    if (!workspace.sameRepo(nested, rootReal, { exec })) return { why: `${shown} is a project with its own git repository, or outside this one - run /alfred-code:update there` };
    if (!stampLayer.readLedger(file)) return { why: `${shown}'s stamp predates the install ledger, so what the stack wrote there cannot be told apart from your files - run /alfred-code:update there once` };
    return { nested, file, rel: shown };
}

// One log collector per step: the kept lines it reports, the removals it counts, the problems it names.
function collector({ nested, rel }) {
    const state = { kept: [], removed: 0, problems: [] };
    const at = (p) => `${rel}/${p.replace(/^\.\//, '')}`;
    const keep = (p, why) => state.kept.push(`${PREFIX}: ${rel} kept ${at(p)} - ${why}`);
    const claude = (p) => `.claude/${p}`;
    const log = (raw) =>
    {
        const line = String(raw);
        let m;
        if (LINE.problem.test(line)) state.problems.push(line.replace(/^\s+!! /, ''));
        else if (LINE.removed.test(line)) state.removed += 1;
        else if ((m = LINE.settingsKept.exec(line))) keep(claude(m[1]), `${m[2]}: ${m[3]}`);
        else if ((m = LINE.markerKept.exec(line))) keep(claude(`hooks/${m[1]}`), m[2]);
        else if ((m = LINE.linkKept.exec(line))) keep(m[1], m[2]);
        else if ((m = LINE.generatedKept.exec(line))) keep(m[1], m[2]);
        else if ((m = LINE.copyKept.exec(line))) keep(keptPath(nested, m[1], m[2]), m[3]);
        else if ((m = LINE.pathKept.exec(line))) keep(m[1], m[2]);
    };
    return { state, log };
}

// Where an item `uninstall.js` named as `<kind> <name>` sits in the nested folder, for the kept line.
function keptPath(nested, kind, name)
{
    const candidates = {
        skill: [`.claude/skills/${name}`, `.alfred/stack/skills/${name}`],
        agent: [`.claude/agents/${name}.md`, `.claude/agents/${name}`, `.alfred/stack/agents/${name}.md`],
        rule: [`.alfred/stack/rules/${name}.md`, `.claude/rules/${name}.md`],
        hook: [`.claude/hooks/${name}`],
        file: [`.claude/${name}`],
    }[kind] || [`.claude/${name}`];
    return candidates.find((p) => fs.existsSync(path.join(nested, ...p.split('/')))) || candidates[0];
}

// Every file still under `dir`, as paths below `base`; a link counts as one.
function filesUnder(dir, base)
{
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return []; }
    return entries.flatMap((d) => (d.isDirectory() && !d.isSymbolicLink() ? filesUnder(path.join(dir, d.name), base) : [toPosix(path.relative(base, path.join(dir, d.name)))]));
}

// The kept lines no step named: what is left in the nested `.claude`, and the data root.
function leftoverLines({ nested, rel, known })
{
    const left = filesUnder(path.join(nested, '.claude'), nested).map((p) => `${PREFIX}: ${rel} kept ${rel}/${p} - ${LEFTOVER_WHY}`)
        .filter((line) => !known.some((k) => k.startsWith(`${line.slice(0, line.indexOf(' - '))} - `)));
    const shown = left.slice(0, LEFTOVER_CAP);
    if (left.length > shown.length) shown.push(`${PREFIX}: ${rel} kept ${left.length - shown.length} more file(s) under ${rel}/.claude - ${LEFTOVER_WHY}`);
    if (isDir(path.join(nested, '.alfred'))) shown.push(`${PREFIX}: ${rel} kept ${rel}/.alfred - ${DATA_ROOT_WHY}`);
    return shown;
}

function removeFile(file, log)
{
    try { fs.rmSync(file, { force: true }); return true; }
    catch (e) { log(`  !! ${path.basename(file)} could not be removed (${e.code || e.message})`); return false; }
}

// Steps a-g over `nested`; `out(line)` prints. Returns the exit code: 0, or 1 when a step reported a problem.
function removeNested({ nested, file, rel, sourceDir, shippedDeny, out })
{
    const claudeDir = path.join(nested, '.claude');
    const ledger = stampLayer.readLedger(file);
    const library = stampLayer.readLibrary(file) || {};
    const record = stampLayer.readLinks(file);
    const instructionsKind = stampLayer.readInstructionsFile(file);
    const rawScope = stampLayer.readStampScope(file).toLowerCase();
    const scope = rawScope === 'global' ? 'user' : ENUMS.scope.values.includes(rawScope) ? rawScope : 'project';
    const home = (kind) => links.homeOf(nested, kind, { write: false }).dir;
    const { state, log } = collector({ nested, rel });
    const failures = [];
    const step = (name, run) =>
    {
        try { run(); }
        catch (e) { failures.push(`${PREFIX}: ${rel} - ${name} failed: ${e.message}`); }
    };
    const note = (m) => failures.push(`${PREFIX}: ${rel} - ${m}`);

    let linksRemoved = 0;
    step('links', () =>
    {
        const before = record.filter((e) => fs.lstatSync(path.join(claudeDir, e.path), { throwIfNoEntry: false }));
        links.removeLinks({ projectRoot: nested, record, log });
        linksRemoved = before.filter((e) => !fs.lstatSync(path.join(claudeDir, e.path), { throwIfNoEntry: false })).length;
    });
    step('stack copies', () => uninstall.removeManagedFiles({
        claudeDir, skillsDir: home('skills'), agentsDir: home('agents'), library, files: ledger.files || {}, instructionsKind, seed: KEEP_INSTRUCTION_FILE, log,
    }));
    step('generated rules', () => uninstall.removeGeneratedRules({
        claudeDir, projectRoot: nested, sourceDir, docsPath: copy.stampedDocsRoot(nested) || '.alfred/docs', log,
    }));
    step('settings', () => settings.removeManagedSettings({ claudeDir, ledger, shippedDeny, scope, log, note }));
    step('mode block', () =>
    {
        // Inside a repository Claude Code keeps the mode file at the top: not this folder's, so it is never touched here.
        if (modes.ownsModeFile(nested)) modes.remove({ projectRoot: nested, log });
    });
    failures.push(...state.problems.map((p) => `${PREFIX}: ${rel} - ${p}`));
    // The stamp goes only when every step before it finished, so a re-run finishes what this one could not.
    if (!failures.length) removeFile(file, (l) => failures.push(`${PREFIX}: ${rel} -${l.replace(/^\s+!!/, '')}`));
    for (const failure of failures) out(`!! ${failure}`);
    if (failures.length && fs.existsSync(file)) out(`${PREFIX}: ${rel} kept ${rel}/.claude/${path.basename(file)} - a step above did not finish; run the removal again`);
    for (const folder of [...STACK_FOLDERS.map((f) => path.join(claudeDir, f)), claudeDir])
    {
        try { if (fs.readdirSync(folder).length === 0) fs.rmdirSync(folder); } catch { /* absent, or not empty: not ours to remove */ }
    }
    out(`${PREFIX}: ${rel} - ${state.removed + linksRemoved} stack file(s) removed`);
    state.kept.forEach((l) => out(l));
    leftoverLines({ nested, rel, known: state.kept }).forEach((l) => out(l));
    out(`${PREFIX}: done ${rel}`);
    return failures.length ? 1 : 0;
}

module.exports = { check, removeNested, segmentsOf };
