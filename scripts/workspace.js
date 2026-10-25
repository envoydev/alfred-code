#!/usr/bin/env node
'use strict';
// workspace.js - the workspace layering verbs init, update, configure, status and uninstall call, one per job:
//
//   parent      the stamped folder above, and whether this project may join it
//   register    the join itself: the parent's `child` line first, then this project's `parent` line
//   unregister  both lines out again
//   join        init's answer - `join` registers, `none` writes `parent none` so the ask is not put again
//   ignore      one `ignore <category> <name>` line in or out
//   children    the direct children, `ok` or `gone`, for uninstall
//   status      the parent, the own, ignored and inherited lines, and the last load check
//   account-instructions  D5's account key: check, apply, decline or remove
//
// Exit 0 on success, 2 with a `!!` line on bad input, 3 when the parent's file is locked, 1 when a write failed.

const fs = require('node:fs');
const path = require('node:path');
const ws = require('./install/workspace.js');
const stamp = require('./install/stamp.js');
const rt = require('./install/runtime.js');
const { checkDataPath } = require('../stack/mcp/data-root.js');

function arg(name, fallback)
{
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
}
const args = (name) => process.argv.flatMap((a, i) => (a === name && i + 1 < process.argv.length ? [process.argv[i + 1]] : []));
const has = (name) => process.argv.includes(name);

class Exit extends Error
{
    constructor(code, line) { super(line); this.code = code; }
}
const bad = (line) => new Exit(2, `!! workspace: ${line}`);

const env = process.env;
const exec = rt.execCommand;
const realOf = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const relPosix = (from, to) => path.relative(from, to).split(path.sep).join('/');

function rootArg()
{
    const root = arg('--root');
    if (!root) throw bad('--root <dir> is required');
    if (!fs.existsSync(root)) throw bad(`--root ${root} does not exist`);
    return realOf(root);
}

// The folder this project's own file lives in before any setting names it; checked before anything is written.
function dataPathArg()
{
    const raw = arg('--data-path');
    if (raw === undefined) return undefined;
    const checked = checkDataPath(raw);
    if (!checked.ok) throw bad(`--data-path ${raw} refused - ${checked.why}`);
    return checked.value;
}

function parentVerb(out)
{
    const v = ws.joinVerdict(rootArg(), { env, exec });
    if (!v.parent) out('parent: none');
    else if (v.ok) out(`parent: ${v.parent.rel}\tchild=yes`);
    else out(`parent: ${v.parent.rel}\tchild=no\twhy=${v.why}`);
}

function register(out, root = rootArg(), dataRoot = dataPathArg())
{
    const v = ws.joinVerdict(root, { env, exec });
    if (!v.parent) throw bad(`no installed folder above ${root} - nothing to join`);
    if (!v.ok) throw bad(`${v.parent.rel} cannot take this folder as a child (${v.why})`);
    const childRel = relPosix(v.parent.root, root);
    const upEnv = ws.ancestorEnv(env);
    const up = ws.writeWorkspace(v.parent.root, (m) => ws.addChild(m, childRel), { env: upEnv });
    if (!up.ok && up.why === 'locked') throw new Exit(3, `!! workspace: the workspace file in ${v.parent.rel} is locked by another run - nothing was written; the join is offered again at the next update`);
    if (!up.ok) throw new Exit(1, `!! workspace: the workspace file in ${v.parent.rel} could not be written - nothing was joined`);
    const here = ws.writeWorkspace(root, (m) => ws.setParent(m, v.parent.rel), { env, dataRoot });
    if (!here.ok)
    {
        // The parent's line alone is a child the chain never reaches: take it back, unless it was there before.
        if (up.wrote) ws.writeWorkspace(v.parent.root, (m) => ws.removeChild(m, childRel), { env: upEnv });
        throw new Exit(here.why === 'locked' ? 3 : 1, `!! workspace: this project's workspace file is ${here.why === 'locked' ? 'locked by another run' : 'not writable'} - nothing was joined; the join is offered again at the next update`);
    }
    out(`workspace: parent ${v.parent.rel} ${here.wrote ? 'written' : 'kept'}`);
    out(`workspace: child ${childRel} ${up.wrote ? 'written' : 'kept'} in ${v.parent.rel}`);
}

function unregister(out)
{
    const root = rootArg();
    const own = ws.readWorkspace(root, { env });
    if (!own.view.parent)
    {
        out('workspace: no parent line - nothing to remove');
        return;
    }
    const parent = path.resolve(root, ...own.view.parent.split('/'));
    if (fs.existsSync(parent))
    {
        const childRel = relPosix(realOf(parent), root);
        const up = ws.writeWorkspace(parent, (m) => ws.removeChild(m, childRel), { env: ws.ancestorEnv(env) });
        if (!up.ok) throw new Exit(up.why === 'locked' ? 3 : 1, `!! workspace: the workspace file in ${own.view.parent} could not be changed (${up.why}) - nothing was removed`);
        if (up.wrote) out(`workspace: child ${childRel} removed from ${own.view.parent}`);
    }
    const here = ws.writeWorkspace(root, (m) => ws.setParent(m, null), { env });
    if (!here.ok) throw new Exit(here.why === 'locked' ? 3 : 1, `!! workspace: this project's workspace file could not be changed (${here.why})`);
    out(`workspace: parent ${own.view.parent} removed`);
}

function join(out)
{
    const answer = arg('--answer');
    if (answer !== 'join' && answer !== 'none') throw bad('--answer takes join or none');
    const root = rootArg();
    const dataRoot = dataPathArg();
    if (answer === 'join') register(out, root, dataRoot);
    else
    {
        const r = ws.writeWorkspace(root, (m) => ws.setParent(m, 'none'), { env, dataRoot });
        if (!r.ok) throw new Exit(r.why === 'locked' ? 3 : 1, `!! workspace: this project's workspace file could not be written (${r.why})`);
    }
    out(`join: ${answer}`);
}

function ignore(out)
{
    const root = rootArg();
    const dataRoot = dataPathArg();
    const add = arg('--add');
    const remove = arg('--remove');
    if ((add === undefined) === (remove === undefined)) throw bad("ignore takes one of --add or --remove '<category> <name>'");
    const [category, name, ...rest] = String(add ?? remove).trim().split(/\s+/);
    if (!name || rest.length) throw bad(`'${add ?? remove}' is not '<category> <name>'`);
    // The mutators throw on a bad line; writeWorkspace would read that as an unwritable file.
    try { ws.addIgnore({ entries: [] }, category, name); }
    catch (e) { throw bad(e.message.replace(/^workspace: /, '')); }
    const r = ws.writeWorkspace(root, (m) => (add !== undefined ? ws.addIgnore(m, category, name) : ws.removeIgnore(m, category, name)), { env, dataRoot });
    if (!r.ok) throw new Exit(r.why === 'locked' ? 3 : 1, `!! workspace: this project's workspace file could not be written (${r.why})`);
    out(`workspace: ignore ${category} ${name} ${add !== undefined ? (r.wrote ? 'added' : 'kept') : (r.wrote ? 'removed' : 'not there')}`);
}

function children(out)
{
    for (const row of ws.subtree(rootArg(), { env }).filter((r) => r.depth === 1)) out(`child: ${row.rel}\t${row.state}`);
}

const list = (lines) => (lines.length ? lines.join(', ') : '-');

function status(out)
{
    const root = rootArg();
    const own = ws.readWorkspace(root, { env });
    const linked = ws.chain(root, { env });
    for (const n of linked.notes) out(n);
    const parent = linked.members[0];
    out(`workspace: parent ${parent ? parent.rel : 'none'}`);
    const stampFile = stamp.stampFiles({ projectRoot: root }).read;
    const ownPicks = (stampFile && stamp.readOwnPicks(stampFile)) || [];
    out(`own: ${list(ownPicks)}`);
    out(`ignored: ${list(own.view.ignores.map((i) => `${i.category} ${i.name}`))}`);
    const installed = arg('--installed');
    if (installed === undefined) out('from-root: unknown - pass --installed <plan json>');
    else
    {
        const read = ws.readPlan(installed);
        if (!read.plan) out(`from-root: unknown - ${read.why}`);
        else if (!parent) out('from-root: -');
        else
        {
            const mine = new Set(ownPicks);
            out(`from-root: ${list(ws.planLines(read.plan).filter((l) => !mine.has(l)))}`);
        }
    }
    let check = null;
    try { check = JSON.parse(fs.readFileSync(path.join(path.dirname(own.file || ''), 'state', 'workspace-check.json'), 'utf8')); }
    catch { /* no load check has run here */ }
    out(check && check.state && check.at ? `check: ${check.state} ${check.at}` : 'check: never');
}

function accountInstructions(out)
{
    const roots = args('--root');
    if (!roots.length) throw bad('--root <dir> is required');
    for (const r of roots) if (!fs.existsSync(r)) throw bad(`--root ${r} does not exist`);
    const real = roots.map(realOf);
    const modes = ['--check', '--apply', '--decline', '--remove'].filter(has);
    if (modes.length !== 1) throw bad('account-instructions takes one of --check, --apply, --decline or --remove');
    const { configDir, accountFile } = ws.accountPaths(env);
    const stamps = real.map((root) => ({ root, file: stamp.stampFiles({ projectRoot: root }).read }));
    // markLine over each named stamp; a stamp it cannot change is named, the rest still written.
    const markAll = (key, value) =>
    {
        let marked = 0;
        for (const s of stamps)
        {
            if (s.file && stamp.markLine(s.file, key, value)) marked += 1;
            else if (!s.file || !fs.existsSync(s.file)) out(`!! workspace: no stamp in ${s.root} - not recorded there`);
        }
        return marked;
    };
    const row = (hash) => `settings.json:${ws.INSTRUCTION_KEY}=${hash}`;
    if (modes[0] === '--check')
    {
        out(`instructions-both: ${ws.instructionsBothState({ projectRoot: real[0], env, configDir, accountFile })}`);
        return;
    }
    if (modes[0] === '--decline')
    {
        out(`instructions-both: declined - recorded in ${markAll('instructions-both', 'declined')} stamp(s)`);
        return;
    }
    if (modes[0] === '--apply')
    {
        const r = ws.applyAccountInstructions({ configDir });
        if (!r.written)
        {
            // Already set is the user's value or an earlier run's - recorded by whichever stamp wrote it, never claimed here.
            if (r.why === 'already set') { out('instructions-both: set - already in the account, not recorded as the stack\'s'); return; }
            throw new Exit(1, `!! workspace: the account key was not written - ${r.why}`);
        }
        out(`instructions-both: set - recorded in ${markAll('managed-account', row(r.hash))} stamp(s)`);
        return;
    }
    const held = stamps.map((s) => ((((s.file && stamp.readLedger(s.file)) || {}).account || {})['settings.json'] || {})[ws.INSTRUCTION_KEY]).find(Boolean);
    if (!held)
    {
        out('instructions-both: no named stamp records the account key - nothing removed');
        return;
    }
    const r = ws.removeAccountInstructions({ configDir, hash: held });
    if (!r.removed && /not valid JSON|could not be written/.test(r.why)) throw new Exit(1, `!! workspace: the account key was not removed - ${r.why}`);
    // Removed, already gone or changed since (the user's now): either way no stamp records it any more.
    markAll('managed-account', null);
    out(r.removed ? 'instructions-both: removed' : `instructions-both: not removed - ${r.why}`);
}

const VERBS = { parent: parentVerb, register: (out) => register(out), unregister, join, ignore, children, status, 'account-instructions': accountInstructions };

function main()
{
    const lines = [];
    const out = (line) => lines.push(line);
    let code = 0;
    try
    {
        const verb = VERBS[process.argv[2]];
        if (!verb) throw bad(`unknown verb '${process.argv[2] ?? ''}' - one of ${Object.keys(VERBS).join(', ')}`);
        verb(out);
    }
    catch (e)
    {
        if (!(e instanceof Exit)) throw e;
        lines.push(e.message);
        code = e.code;
    }
    if (lines.length) process.stdout.write(lines.join('\n') + '\n');
    return code;
}

if (require.main === module) process.exitCode = main();

module.exports = { main };
