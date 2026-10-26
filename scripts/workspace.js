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
//   plan        update's cascade, before it runs: each project's row, projected add and drop, and its own asks
//   answer      one project's answers to those asks, merged into the answers file the cascade reads
//   cascade     the update itself, every child top-down from its parent's read-back - a failed parent skips its subtree
//   check-loads the exclude check: one logged-out `claude -p` here, naming every ancestor file that loaded twice
//
// Exit 0 on success, 2 with a `!!` line on bad input, 3 when the parent's file is locked, 1 when a write failed.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ws = require('./install/workspace.js');
const stamp = require('./install/stamp.js');
const rt = require('./install/runtime.js');
const { parseArgs } = require('./install/args.js');
const { BRAND } = require('./install/brand.js');
const { checkDataPath } = require('../stack/mcp/data-root.js');

// This CLI's own flags stop at `--`; what follows is `answer`'s installer arguments.
const own = process.argv.indexOf('--') < 0 ? process.argv : process.argv.slice(0, process.argv.indexOf('--'));
function arg(name, fallback)
{
    const i = own.indexOf(name);
    return i >= 0 ? own[i + 1] : fallback;
}
const args = (name) => own.flatMap((a, i) => (a === name && i + 1 < own.length ? [own[i + 1]] : []));
const has = (name) => own.includes(name);

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
    const r = ws.leaveParent({ projectRoot: rootArg(), env, log: out });
    if (r.why) throw new Exit(r.why === 'locked' ? 3 : 1, `!! ${r.line}`);
    if (!r.left) out('workspace: no parent line - nothing to remove');
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
            else if (value !== null && (!s.file || !fs.existsSync(s.file))) out(`!! workspace: no stamp in ${s.root} - not recorded there`);
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
    // --hash: the key's hash where no stamp records it any more (a finished uninstall prints it).
    const given = arg('--hash');
    if (given !== undefined && !/^[0-9a-f]{64}$/.test(given)) throw bad('--hash takes the 64-character sha256 the uninstall printed');
    const held = given || stamps.map((s) => ((((s.file && stamp.readLedger(s.file)) || {}).account || {})['settings.json'] || {})[ws.INSTRUCTION_KEY]).find(Boolean);
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

// ------------------------------------------------------------------ the cascade

function sourceArg()
{
    const source = arg('--source');
    if (!source) throw bad('--source <repo> is required');
    if (!fs.existsSync(path.join(source, 'scripts', 'install', 'alfred-code.js'))) throw bad(`--source ${source} holds no scripts/install/alfred-code.js`);
    return path.resolve(source);
}

const csv = (lines) => (lines.length ? lines.join(',') : '-');
const installer = (source) => path.join(source, 'scripts', 'install', 'alfred-code.js');

// A project's read-back through the installer's own --print-plan, from `parentPlan` when it is a child: { file, plan }
// or { why } - Task 9's checks (failures, an unreadable settings file, a blind listing) included.
function readBack(root, source, file, parentPlan)
{
    const r = rt.spawnCommand(process.execPath, [installer(source), 'update', '--source', source, '--scope', stamp.installScope(root), '--installed-only',
        '--print-plan', '--plan-out', file, ...(parentPlan ? ['--parent-plan', parentPlan] : [])], { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 120000 });
    if (r.error || r.status !== 0) return { why: r.error ? r.error.message : `the read-back exited ${r.status}` };
    const read = ws.readPlan(file);
    return read.plan ? { file, plan: read.plan } : { why: read.why };
}

const ASK = [/^data-move: offer /, /^docs-move: offer /, /^instructions-file: .*\bupdate=ask/, /^instructions-both: ask$/, /^workspace: join /];

// The project's own asks, as update-preflight prints them for it.
function asksOf(root)
{
    const r = rt.spawnCommand(process.execPath, [path.join(__dirname, 'update-preflight.js'), '--asks', '--root', root], { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 60000 });
    return String(r.stdout || '').split('\n').filter((l) => ASK.some((re) => re.test(l)));
}

function planVerb(out)
{
    const top = rootArg();
    const source = sourceArg();
    let snapshot = '?';
    try { snapshot = JSON.parse(fs.readFileSync(path.join(source, 'setup-plugin', '.claude-plugin', 'plugin.json'), 'utf8')).version || '?'; }
    catch { /* a snapshot with no plugin.json names no version */ }
    const rows = ws.subtree(top, { env });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-plan-'));
    try
    {
        out(`workspace-plan: ${rows.filter((r) => r.state === 'ok').length} projects`);
        const plans = new Map();
        for (const [i, row] of rows.entries())
        {
            if (row.state !== 'ok') continue;
            const version = stamp.readVersion(stamp.stampFiles({ projectRoot: row.root }).read) || '?';
            const parentPlan = row.parentRel === null ? null : plans.get(row.parentRel);
            let add = '?';
            let drop = '?';
            let why = row.parentRel !== null && !parentPlan ? `no projection - ${row.parentRel} could not be read` : null;
            if (!why)
            {
                const got = readBack(row.root, source, path.join(tmp, `${i}.json`), parentPlan);
                if (got.plan)
                {
                    plans.set(row.rel, got.file);
                    const after = ws.planLines(got.plan);
                    const before = Array.isArray(got.plan.before) ? got.plan.before : after;
                    add = csv(after.filter((l) => !before.includes(l)));
                    drop = csv(before.filter((l) => !after.includes(l)));
                }
                else why = `no projection - ${got.why}`;
            }
            out(`project: ${row.rel}\tscope=${stamp.installScope(row.root)}\tversion=${version}->${snapshot}\tadd=${add}\tdrop=${drop}`);
            if (why) out(`  !! ${why}`);
            for (const l of asksOf(row.root)) out(`  ${l}`);
        }
        for (const row of rows.filter((r) => r.state === 'gone')) out(`gone: ${row.rel}`);
        if (has('--rescan')) for (const rel of ws.rescan(top, { env })) out(`rescan: ${rel}`);
    }
    finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// Each ask line plan prints, and the installer flag that answers it.
const ANSWER_FLAGS = ['--data-move', '--docs-root-move', '--docs-root-leave', '--instructions-file', '--instructions-at', '--add'];
const projectRel = (rel) => rel === '.' || (/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(rel) && rel.split('/').every((p) => p !== '.' && p !== '..'));

// [flag, value, ...] checked as the installer checks it; the line that refuses it, or null.
function answersRefused(list)
{
    if (!Array.isArray(list) || list.length % 2 || list.some((v) => typeof v !== 'string')) return 'is not <flag> <value> pairs';
    for (let i = 0; i < list.length; i += 2) if (!ANSWER_FLAGS.includes(list[i])) return `hold ${list[i]} - not an answer the cascade passes`;
    // As the cascade passes them: after --installed-only, which an --add needs.
    try { parseArgs(['update', '--installed-only', ...list]); }
    catch (e) { if (e.usage) return e.message; throw e; }
    return null;
}

function readAnswers(file, { absentOk })
{
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (e) { if (absentOk && e.code === 'ENOENT') return {}; throw bad(`the answers file ${file} could not be read`); }
    let data;
    try { data = JSON.parse(text); }
    catch { throw bad(`the answers file ${file} does not parse - left as it is`); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw bad(`the answers file ${file} is not a { "<project>": [...] } map - left as it is`);
    return data;
}

function answer(out)
{
    const file = arg('--file');
    const rel = arg('--project');
    if (!file || !rel) throw bad('answer takes --file <json> --project <rel> -- <flag> <value>...');
    if (!projectRel(rel)) throw bad(`--project ${rel} is not a path inside the top project`);
    const at = process.argv.indexOf('--');
    const given = at < 0 ? [] : process.argv.slice(at + 1);
    if (!given.length) throw bad('answer takes at least one <flag> <value> after --');
    const refusedGiven = answersRefused(given);
    if (refusedGiven) throw bad(`the answer ${refusedGiven}`);
    const data = readAnswers(file, { absentOk: true });
    const merged = Array.isArray(data[rel]) ? [...data[rel]] : [];
    for (let i = 0; i < given.length; i += 2)
    {
        const [flag, value] = [given[i], given[i + 1]];
        // Each --add is its own item; any other flag holds one value, the newest.
        const held = flag === '--add' ? merged.findIndex((v, j) => j % 2 === 0 && v === flag && merged[j + 1] === value) : merged.findIndex((v, j) => j % 2 === 0 && v === flag);
        if (held < 0) merged.push(flag, value);
        else merged[held + 1] = value;
    }
    const refused = answersRefused(merged);
    if (refused) throw bad(`the answers for ${rel} would ${refused} - the file is left as it was`);
    data[rel] = merged;
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(tmp, file);
    out(`answer: ${rel} ${merged.join(' ')}`);
}

// What a run changed: every file under .claude/ and the workspace file, by path, size and sha256 - the stamp read
// without its two run times, which every run rewrites.
function treeHash(root)
{
    const rows = [];
    const add = (file, label) =>
    {
        let body;
        try { body = fs.readFileSync(file); }
        catch { return; }
        if (path.basename(file) === BRAND.stamp) body = Buffer.from(String(body).replace(/^installed(?:-ms)?:.*$/gm, ''));
        rows.push(`${label} ${body.length} ${crypto.createHash('sha256').update(body).digest('hex')}`);
    };
    const walk = (dir, rel) =>
    {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries.sort((a, b) => a.name.localeCompare(b.name)))
        {
            const p = path.join(dir, e.name);
            if (e.isDirectory() && !e.isSymbolicLink()) walk(p, `${rel}/${e.name}`);
            else add(p, `${rel}/${e.name}`);
        }
    };
    walk(path.join(root, '.claude'), '.claude');
    const own = ws.readWorkspace(root, { env }).file;
    if (own) add(own, 'workspace');
    return rows.join('\n');
}

const FAILED_LINE = /^(?:==>)?\s*\d+ step\(s\) reported a failure above/m;

function cascade(out)
{
    const top = rootArg();
    const source = sourceArg();
    const file = arg('--answers');
    const answers = file ? readAnswers(file, { absentOk: false }) : {};
    if (!ws.workspaceOn({ env, projectRoot: top }))
    {
        out('cascade: off - ALFRED_CODE_WORKSPACE is 0');
        return;
    }
    const rows = ws.subtree(top, { env });
    const byRel = new Map(rows.map((r) => [r.rel, r]));
    const hasChildren = new Set(rows.map((r) => r.parentRel).filter((r) => r !== null));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-cascade-'));
    const plans = new Map();
    const blocked = new Set();
    const count = { updated: 0, failed: 0, skipped: 0 };
    const row = (rel, state) => { out(`cascade: ${rel}\t${state}`); if (state in count) count[state] += 1; };
    try
    {
        // The top project ran before the cascade (update's own run): its read-back is taken once, here.
        const topBack = readBack(top, source, path.join(tmp, '0.json'), null);
        if (topBack.plan) plans.set('.', topBack.file);
        else
        {
            out(`!! cascade: the read-back of . failed (${topBack.why}) - every child is skipped`);
            blocked.add('.');
        }
        for (const [i, r] of rows.entries())
        {
            if (r.depth === 0) continue;
            if (blocked.has(r.parentRel)) { blocked.add(r.rel); row(r.rel, 'skipped'); continue; }
            const parent = byRel.get(r.parentRel);
            if (r.state === 'gone')
            {
                const line = r.parentRel === '.' ? r.rel : r.rel.slice(r.parentRel.length + 1);
                ws.writeWorkspace(parent.root, (m) => ws.removeChild(m, line), { env: r.parentRel === '.' ? env : ws.ancestorEnv(env) });
                row(r.rel, 'gone');
                continue;
            }
            const first = ws.chain(r.root, { env: ws.ancestorEnv(env), maxDepth: 1 }).members[0];
            if (!first || ws.realKey(first.root) !== ws.realKey(parent.root))
            {
                out(`!! cascade: ${r.rel} does not name ${r.parentRel} as its parent - skipped; join it again or run workspace.js unregister there`);
                blocked.add(r.rel);
                row(r.rel, 'skipped');
                continue;
            }
            const given = answers[r.rel] === undefined ? [] : answers[r.rel];
            const refused = answersRefused(given);
            if (refused)
            {
                out(`!! cascade: the answers for ${r.rel} ${refused}; skipped`);
                blocked.add(r.rel);
                row(r.rel, 'skipped');
                continue;
            }
            const before = treeHash(r.root);
            const run = rt.spawnCommand(process.execPath, [installer(source), 'update', '--source', source, '--scope', stamp.installScope(r.root), '--installed-only', '--keep-pins',
                '--parent-plan', plans.get(r.parentRel), ...given], { cwd: r.root, encoding: 'utf8', stdio: 'pipe', timeout: 600000 });
            const said = String(run.stdout || '');
            let failed = Boolean(run.error) || run.status !== 0 || FAILED_LINE.test(said);
            let why = [];
            if (failed) why = said.split('\n').filter((l) => /^==>\s+!! /.test(l)).map((l) => `  ${l.replace(/^==>\s+/, '')}`);
            if (run.error) why.push(`  !! ${run.error.message}`);
            else if (run.status !== 0) why.push(`  !! the run exited ${run.status}`);
            if (!failed && hasChildren.has(r.rel))
            {
                const back = readBack(r.root, source, path.join(tmp, `${i}.json`), plans.get(r.parentRel));
                if (back.plan) plans.set(r.rel, back.file);
                else { failed = true; why = [`  !! the read-back after the run failed (${back.why})`]; }
            }
            if (failed)
            {
                blocked.add(r.rel);
                row(r.rel, 'failed');
                for (const l of why.slice(0, 5)) out(l);
                continue;
            }
            row(r.rel, treeHash(r.root) === before ? 'unchanged' : 'updated');
        }
    }
    finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    out(`cascade: done ${count.updated} updated, ${count.failed} failed, ${count.skipped} skipped`);
}

// --claude and --managed-file are the tests' seams; a real run takes `claude` from PATH and the OS's managed file.
function checkLoadsVerb(out)
{
    const root = rootArg();
    const r = ws.checkLoads({ projectRoot: root, env, claudeBin: arg('--claude', 'claude'), managedFile: arg('--managed-file', ws.managedSettingsFile()) });
    if (r.state === 'skipped') { out(`check-loads: skipped - ${r.why}`); return; }
    out("check-loads: probe run - this project's own hooks ran, as in any session here");
    if (r.state === 'clean') out('check-loads: clean');
    else if (r.state === 'authenticated') out('!! check-loads: the probe authenticated');
    else if (r.state === 'misses') for (const m of r.misses) out(`!! check-loads: ${m} loaded twice - run /alfred-code:update`);
    else out(`!! check-loads: the probe failed - ${r.why}`);
}

const VERBS = { parent: parentVerb, register: (out) => register(out), unregister, join, ignore, children, status, 'account-instructions': accountInstructions, plan: planVerb, answer, cascade, 'check-loads': checkLoadsVerb };

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
