'use strict';
// DOCS MEMORY - the installer half of `ALFRED_CODE_MEMORY=docs` (memory P3). Claude Code's own memory moves into
// `<docs-path>/memory/`, versioned with the docs: this module writes a ledgered `autoMemoryDirectory` - this machine's
// absolute path to the MAIN checkout's folder - into the project's .claude/settings.local.json (never the committed
// settings.json), re-points it after a move, and takes it back on a switch, a refusal or a commit of that file (D11).
//
// The rule, the place and the file list live once in stack/hooks/layout.js (docsMemoryDir, docsMemoryRefusal,
// docsMemoryShare, memoryFiles), so the installer, tools.js and the session start never disagree. Two calls from
// runLayers: `gate` before the settings pass (a refused `--memory docs` is unset there, so ALFRED_CODE_MEMORY keeps its
// value), and `step` once the docs root and its versioning are final. The row reaches the stamp through
// `ctx.memoryDirRow` (ledgerOf): the generic carry drops a local-scope row whenever writeSettings returns rows for that
// file, so the carry alone would lose it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const stampLayer = require('./stamp.js');
const variables = require('./variables.js');
const layout = require('../../stack/hooks/layout.js');

const LOCAL = 'settings.local.json';
const KEY = 'autoMemoryDirectory';

// The env every memoryDirsOf call here reads: the run's account, plus its own CLAUDE_CODE_PROJECT_DIR_NAME, so a renamed
// project folder names no default place (D10) rather than the default-named one.
function memoryEnv(ctx)
{
    const name = String(process.env.CLAUDE_CODE_PROJECT_DIR_NAME || '').trim();
    return { CLAUDE_CONFIG_DIR: ctx.configDir, ...(name ? { CLAUDE_CODE_PROJECT_DIR_NAME: process.env.CLAUDE_CODE_PROJECT_DIR_NAME } : {}) };
}
const rowHash = (value) => stampLayer.valueHash(JSON.stringify(value));
const priorRow = (ctx) => ((((ctx.ledger || {}).settings || {})[LOCAL]) || {})[KEY];
// The value the stack wrote: the prior stamp's row, at its hash.
const oursIn = (ctx) => (value) => priorRow(ctx) !== undefined && rowHash(value) === priorRow(ctx);
const modeOf = (ctx) => layout.variablesOf(ctx.projectRoot, { env: { CLAUDE_CONFIG_DIR: ctx.configDir } }).values.ALFRED_CODE_MEMORY || 'default';

// A path as the lines show it: project-relative, `~/`-relative, else in full.
function shown(abs, root, home = os.homedir())
{
    const at = layout.realpathOrSelf(abs);
    const under = (base) =>
    {
        const rel = path.relative(layout.realpathOrSelf(base), at);
        return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : null;
    };
    const inProject = under(root);
    if (inProject !== null) return inProject;
    const inHome = under(home);
    return inHome !== null ? `~/${inHome}` : at;
}
// An `autoMemoryDirectory` value as Claude Code reads it: absolute, or `~/` under home; anything else is no folder.
function valueDir(value, home = os.homedir())
{
    if (typeof value !== 'string' || !value.trim()) return null;
    const v = value.trim();
    return /^~[\\/]/.test(v) ? path.join(home, v.slice(2)) : path.isAbsolute(v) ? path.resolve(v) : null;
}
const showValue = (value, root) => { const dir = valueDir(value); return dir ? shown(dir, root) : String(value); };

// The local file: { state: 'absent' | 'ok' | 'garbage', data }.
function readLocal(file)
{
    if (!fs.existsSync(file)) return { state: 'absent', data: null };
    try
    {
        const data = JSON.parse(layout.readText(file));
        return data && typeof data === 'object' && !Array.isArray(data) ? { state: 'ok', data } : { state: 'garbage', data: null };
    }
    catch { return { state: 'garbage', data: null }; }
}
function writeLocal(file, data)
{
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}
// Takes the row out; a file left with nothing goes, as writeSettings says it.
function removeRow(ctx, file, data)
{
    delete data[KEY];
    if (Object.keys(data).length) { writeLocal(file, data); return; }
    fs.rmSync(file, { force: true });
    ctx.log(`  ${LOCAL} removed - it held nothing but the stack's entries`);
}

// The managed value, read where Claude Code reads it first: the drop-ins (the last in name order wins), then the file.
function managedValue(managed)
{
    const dropDir = path.join(path.dirname(managed), 'managed-settings.d');
    let drops = [];
    try { drops = fs.readdirSync(dropDir).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort().reverse().map((n) => path.join(dropDir, n)); }
    catch { /* no drop-in folder */ }
    for (const file of [...drops, managed])
    {
        let data = null;
        try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
        if (data && typeof data[KEY] === 'string' && data[KEY].trim()) return data[KEY];
    }
    return null;
}
// The other files a written row meets (spec, 'The user's own values'): a value in .claude/settings.json or the account's
// settings.json is outranked by the local row, said once; a managed one outranks the row, said with `!!`.
function outrankLines(root, { wanted, env = process.env, managed = layout.managedSettingsFile(process.platform, env), home = os.homedir() } = {})
{
    const want = `${shown(wanted, root, home)}/`;
    const held = managedValue(managed);
    const heldDir = held && valueDir(held, home);
    if (heldDir && layout.dirKey(heldDir) !== layout.dirKey(wanted))
        return [`!! memory: a managed autoMemoryDirectory outranks .claude/settings.local.json here - Claude's own memory stays at ${shown(heldDir, root, home)}, not ${want}`];
    const lines = [];
    const account = path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'settings.json');
    for (const file of [path.join(root, '.claude', 'settings.json'), account])
    {
        let data = null;
        try { data = JSON.parse(layout.readText(file)); } catch { continue; }
        if (!data || typeof data !== 'object' || data[KEY] === undefined) continue;
        lines.push(`${LOCAL}: autoMemoryDirectory outranks yours in ${shown(file, root, home)} - Claude's own memory goes to ${want}; yours stays`);
    }
    return lines;
}

// Before the settings pass. A `--memory docs` that cannot be written is unset, so the mode keeps its value and the
// run writes nothing of docs mode; a same-repo child already sharing its member's docs memory (OD5) keeps reading the
// mode from the member, since a value of its own would cut the share. `--memory-copy` notes the place before this run.
function gate(ctx)
{
    ctx.memoryFrom = null;
    ctx.memoryAsked = ctx.args.memory || null;
    ctx.memoryRefused = false;
    const env = memoryEnv(ctx);
    if (ctx.args.memory === 'docs')
    {
        const current = modeOf(ctx);
        if (layout.docsMemoryShare(ctx.projectRoot, { env }))
        {
            ctx.args.memory = undefined;
            ctx.args.memoryCopy = false;
        }
        else
        {
            const wanted = layout.docsMemoryDir(ctx.projectRoot, { env });
            const refusal = layout.docsMemoryRefusal(ctx.projectRoot, { wanted, tracked: variables.tracked, ours: oursIn(ctx) });
            if (refusal)
            {
                ctx.log(`  !! memory: docs not written - ${refusal.text}; ALFRED_CODE_MEMORY stays '${current}'`);
                ctx.args.memory = undefined;
                ctx.args.memoryCopy = false;
                ctx.memoryRefused = true;
            }
        }
    }
    if (ctx.args.memoryCopy) ctx.memoryFrom = layout.memoryDirsOf(ctx.projectRoot, { env });
}

// After ignoreStep: the row for the mode the run left, by the plan's table. Sets ctx.memoryDirRow - the hash to record,
// or null - on every path; a pending hand-set docs root, an invalid data root and a file that cannot be read keep the
// last run's row.
function step(ctx, docsPath, { warnUnignoredLocal = () => {} } = {})
{
    const prior = priorRow(ctx);
    ctx.memoryDirRow = prior === undefined ? null : prior;
    if (ctx.docsRootPending || (ctx.dataInfo && ctx.dataInfo.invalid)) return;
    const root = ctx.projectRoot;
    const env = memoryEnv(ctx);
    const file = path.join(ctx.claudeDir, LOCAL);
    const read = readLocal(file);
    const ours = oursIn(ctx);
    const has = read.state === 'ok' && Object.hasOwn(read.data, KEY);
    const isOurs = has && ours(read.data[KEY]);
    const mode = modeOf(ctx);
    const say = (line) => ctx.log(`  ${line}`);

    const share = mode === 'docs' ? layout.docsMemoryShare(root, { env }) : null;
    if (share)
    {
        if (isOurs) removeRow(ctx, file, read.data);
        ctx.memoryDirRow = null;
        if (ctx.memoryAsked || isOurs) say(`memory: docs - shares ${share.member}'s docs memory (${shown(share.dir, root)}/), so nothing is written here`);
        return;
    }
    if (mode !== 'docs')
    {
        if (read.state === 'garbage') return;
        if (isOurs)
        {
            say(`${LOCAL}: autoMemoryDirectory removed - ALFRED_CODE_MEMORY is no longer docs, so Claude's own memory is back at its default place`);
            removeRow(ctx, file, read.data);
        }
        else if (has && prior !== undefined) say(`${LOCAL}: autoMemoryDirectory kept - changed since the stack wrote it, so it is yours`);
        ctx.memoryDirRow = null;
        return;
    }

    const wanted = layout.docsMemoryDir(root, { env });
    const refusal = layout.docsMemoryRefusal(root, { wanted, tracked: variables.tracked, ours });
    if (refusal)
    {
        if (isOurs)
        {
            say(`${LOCAL}: autoMemoryDirectory removed - ${refusal.text}`);
            removeRow(ctx, file, read.data);
            ctx.memoryDirRow = null;
            return;
        }
        if (read.state !== 'garbage') ctx.memoryDirRow = null;
        if (!ctx.memoryRefused) say(`!! memory: ALFRED_CODE_MEMORY is docs, but ${refusal.text} - nothing written; Claude's own memory stays at its default place`);
        return;
    }
    const want = `${shown(wanted, root)}/`;
    if (!has)
    {
        const data = read.state === 'ok' ? read.data : {};
        data[KEY] = wanted;
        writeLocal(file, data);
        ctx.memoryDirRow = rowHash(wanted);
        say(`${LOCAL}: autoMemoryDirectory written - ${want} (ALFRED_CODE_MEMORY is docs; Claude's own memory lives with the docs from the next session)`);
        for (const line of outrankLines(root, { wanted, env })) say(line);
        if (read.state === 'absent') warnUnignoredLocal(ctx, file);
        return;
    }
    const dir = valueDir(read.data[KEY]);
    if (isOurs)
    {
        if (dir && layout.dirKey(dir) === layout.dirKey(wanted)) return;
        const old = showValue(read.data[KEY], root);
        read.data[KEY] = wanted;
        writeLocal(file, read.data);
        ctx.memoryDirRow = rowHash(wanted);
        say(`${LOCAL}: autoMemoryDirectory re-pointed - ${old} -> ${want} (the folder moved)`);
        for (const line of outrankLines(root, { wanted, env })) say(line);
        return;
    }
    // The user's own value naming the wanted folder (D3): docs mode is on, and the value stays theirs.
    ctx.memoryDirRow = null;
    if (ctx.memoryAsked) say(`${LOCAL}: autoMemoryDirectory already names ${want} - yours, kept and not recorded`);
}

module.exports = { gate, step, memoryEnv, rowHash, outrankLines, shown };
