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
const rt = require('./runtime.js'); // every external command through the one Windows-safe spawn (M6)
const layout = require('../../stack/hooks/layout.js');
const { parseJson, formatOf, stringifyLike } = require('./json-file.js');

const LOCAL = 'settings.local.json';
const KEY = 'autoMemoryDirectory';

// The env every memoryDirsOf call here reads: the run's account, plus its own CLAUDE_CODE_PROJECT_DIR_NAME, so a renamed
// project folder names no default place (D10) rather than the default-named one.
function memoryEnv(ctx)
{
    const name = String(process.env.CLAUDE_CODE_PROJECT_DIR_NAME || '').trim();
    return { CLAUDE_CONFIG_DIR: ctx.configDir, ...(name ? { CLAUDE_CODE_PROJECT_DIR_NAME: process.env.CLAUDE_CODE_PROJECT_DIR_NAME } : {}) };
}
// The row names the folder by its place under the main checkout, so a stamp committed with .claude/ vouches for the same
// row on every teammate's machine (layout.js memoryRowHash, P3 review finding 1).
const rowHash = (value, root) => layout.memoryRowHash(value, layout.mainCounterpart(path.resolve(root)) || root);
const priorRow = (ctx) => ((((ctx.ledger || {}).settings || {})[LOCAL]) || {})[KEY];
// The value the stack wrote: the prior stamp's row, at its hash.
const oursIn = (ctx) => (value) => priorRow(ctx) !== undefined && layout.memoryRowMatches(value, priorRow(ctx));
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

// The local file: { state: 'absent' | 'ok' | 'garbage', data }. An empty one is {} (settings.js readSettings, the
// 2026-10-20 ruling); one that cannot be read keeps the last run's row, as garbage does.
function readLocal(file)
{
    if (!fs.existsSync(file)) return { state: 'absent', data: null };
    let text;
    try { text = layout.readText(file); }
    catch { return { state: 'garbage', data: null }; }
    // layout.readText drops a UTF-8 BOM; the text handed on keeps it, so writeLocal keeps the file's shape (bug 4).
    try { if (fs.readFileSync(file).subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF]))) text = String.fromCharCode(0xFEFF) + text; }
    catch { /* read once already; the shape falls back to the defaults */ }
    if (!text.trim()) return { state: 'ok', data: {}, text };
    try
    {
        const data = parseJson(text);
        return data && typeof data === 'object' && !Array.isArray(data) ? { state: 'ok', data, text } : { state: 'garbage', data: null };
    }
    catch { return { state: 'garbage', data: null }; }
}
function writeLocal(file, data, text = null)
{
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, stringifyLike(data, formatOf(text)));
}
// Takes the row out; a file left with nothing goes, as writeSettings says it.
function removeRow(ctx, file, data, text = null)
{
    delete data[KEY];
    if (Object.keys(data).length) { writeLocal(file, data, text); return; }
    // R163 (burn-down 2026-11-04): a tracked file stays, as {} - its deletion would reach every teammate with the next commit.
    if (variables.tracked(file))
    {
        writeLocal(file, data, text);
        ctx.log(`  ${LOCAL} kept as {} - git tracks it, so deleting it would reach every teammate with the next commit`);
        return;
    }
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

// The row for the mode the run left, by the plan's table. Sets ctx.memoryDirRow - the hash to record, or null - on every
// path; a pending hand-set docs root and a file that cannot be read keep the last run's row.
// Returns what it decided: { skip } before anything was read, else { mode, share, refusal }.
function rowStep(ctx, { warnUnignoredLocal = () => {} } = {})
{
    const prior = priorRow(ctx);
    ctx.memoryDirRow = prior === undefined ? null : prior;
    if (ctx.docsRootPending) return { skip: true };
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
        if (isOurs) removeRow(ctx, file, read.data, read.text);
        ctx.memoryDirRow = null;
        if (ctx.memoryAsked || isOurs) say(`memory: docs - shares ${share.member}'s docs memory (${shown(share.dir, root)}/), so nothing is written here`);
        return { mode, share };
    }
    if (mode !== 'docs')
    {
        if (read.state === 'garbage') return { mode };
        if (isOurs)
        {
            say(`${LOCAL}: autoMemoryDirectory removed - ALFRED_CODE_MEMORY is no longer docs, so Claude's own memory is back at its default place`);
            removeRow(ctx, file, read.data, read.text);
        }
        else if (has && prior !== undefined) say(`${LOCAL}: autoMemoryDirectory kept - changed since the stack wrote it, so it is yours`);
        ctx.memoryDirRow = null;
        return { mode };
    }

    const wanted = layout.docsMemoryDir(root, { env });
    const refusal = layout.docsMemoryRefusal(root, { wanted, tracked: variables.tracked, ours });
    if (refusal)
    {
        if (isOurs)
        {
            say(`${LOCAL}: autoMemoryDirectory removed - ${refusal.text}`);
            removeRow(ctx, file, read.data, read.text);
            ctx.memoryDirRow = null;
            return { mode, refusal };
        }
        if (read.state !== 'garbage') ctx.memoryDirRow = null;
        if (!ctx.memoryRefused) say(`!! memory: ALFRED_CODE_MEMORY is docs, but ${refusal.text} - nothing written; Claude's own memory stays at its default place`);
        return { mode, refusal };
    }
    const want = `${shown(wanted, root)}/`;
    if (!has)
    {
        const data = read.state === 'ok' ? read.data : {};
        data[KEY] = wanted;
        writeLocal(file, data, read.state === 'ok' ? read.text : null);
        ctx.memoryDirRow = rowHash(wanted, root);
        say(`${LOCAL}: autoMemoryDirectory written - ${want} (ALFRED_CODE_MEMORY is docs; Claude's own memory lives with the docs from the next session)`);
        for (const line of outrankLines(root, { wanted, env })) say(line);
        if (read.state === 'absent') warnUnignoredLocal(ctx, file);
        return { mode };
    }
    const dir = valueDir(read.data[KEY]);
    if (isOurs)
    {
        if (dir && layout.dirKey(dir) === layout.dirKey(wanted)) return { mode };
        const old = showValue(read.data[KEY], root);
        read.data[KEY] = wanted;
        writeLocal(file, read.data, read.text);
        ctx.memoryDirRow = rowHash(wanted, root);
        say(`${LOCAL}: autoMemoryDirectory re-pointed - ${old} -> ${want} (the folder moved)`);
        for (const line of outrankLines(root, { wanted, env })) say(line);
        return { mode };
    }
    // The user's own value naming the wanted folder (D3): docs mode is on, and the value stays theirs.
    ctx.memoryDirRow = null;
    if (ctx.memoryAsked) say(`${LOCAL}: autoMemoryDirectory already names ${want} - yours, kept and not recorded`);
    return { mode };
}

// R5: copies every top-level `.md` of `from` into `to`, never over a file already there; sub-folders stay behind.
// `show` spells a folder for the line. Returns { copied, skipped }.
function copyMemory({ from, to, log = () => {}, show = (dir) => dir })
{
    fs.mkdirSync(to, { recursive: true });
    let copied = 0;
    let skipped = 0;
    for (const name of layout.memoryFiles(from))
    {
        try { fs.copyFileSync(path.join(from, name), path.join(to, name), fs.constants.COPYFILE_EXCL); copied++; }
        catch (err) { if (err.code === 'EEXIST') skipped++; else throw err; }
    }
    let subs = 0;
    try { subs = fs.readdirSync(from, { withFileTypes: true }).filter((e) => e.isDirectory()).length; }
    catch { /* the count is a courtesy */ }
    log(`memory: copied ${copied} files from ${show(from)}/ to ${show(to)}/ - the old ones stay where they are${skipped ? `; ${skipped} already there, skipped` : ''}${subs ? `; ${subs} sub-folders left at ${show(from)}/` : ''}`);
    return { copied, skipped };
}

// `--memory-copy`: the place before this run (gate's ctx.memoryFrom) into the place after it, when the old one is one
// folder holding a MEMORY.md and the new one is one folder without. Custom has no place of Claude's own to copy into.
function copyStep(ctx, mode)
{
    if (!ctx.memoryFrom) return;
    const root = ctx.projectRoot;
    const say = (line) => ctx.log(`  ${line}`);
    const show = (dir) => shown(dir, root);
    if (mode === 'custom') { say('memory: copy skipped - custom memory has no place of Claude\'s own to copy into'); return; }
    if (ctx.memoryFrom.length !== 1) { say('memory: copy skipped - the old place is not one folder here'); return; }
    const platform = ctx.platform || process.platform;
    const to = layout.memoryDirsOf(root, { env: memoryEnv(ctx), platform });
    if (to.length !== 1) { say('memory: copy skipped - the new place is not one folder here'); return; }
    const [from] = ctx.memoryFrom;
    if (!fs.existsSync(path.join(from, 'MEMORY.md'))) { say(`memory: copy skipped - nothing at ${show(from)}/`); return; }
    // G3: on Windows past 200 characters Claude Code names the folder from the path as typed, so the computed name may never
    // be the one it makes - nothing is copied until a folder is there.
    if (platform === 'win32' && path.basename(path.dirname(to[0])).length > layout.MEMORY_NAME_MAX && !fs.existsSync(path.dirname(to[0])))
    {
        say(`memory: copy skipped - on Windows Claude Code names a folder past 200 characters from the path as typed, and it has not made one here yet; copy the .md files from ${show(from)}/ by hand once it has`);
        return;
    }
    if (fs.existsSync(path.join(to[0], 'MEMORY.md'))) { say(`memory: copy skipped - ${show(to[0])}/ already has a MEMORY.md`); return; }
    copyMemory({ from, to: to[0], log: say, show });
}

// R10: under git docs versioning the docs memory gets a union merge for its index, so lessons added on two branches
// merge clean. The stack's file is known by its text (OD4, the data root's .gitignore precedent; CRLF read as LF, D8).
const ATTRIBUTES_TEXT = '# alfred-code: lessons added to the memory index on two branches merge by union (docs memory, R10)\nMEMORY.md merge=union\n';
// `want`: write it, else remove the stack's. `why` ends the removal line; `rel` spells the folder; `named` false keeps a
// file of the user's unnamed where nothing would be written.
function attributesStep({ dir, want, log = () => {}, why = 'ALFRED_CODE_MEMORY is no longer docs', rel = dir, named = true })
{
    const file = path.join(dir, '.gitattributes');
    let text = null;
    try { text = fs.readFileSync(file, 'utf8'); } catch { text = null; }
    const ours = text !== null && text.replace(/\r\n/g, '\n') === ATTRIBUTES_TEXT;
    // R161 (burn-down 2026-11-04): named only on a run that asked - a flag-less update said it every time.
    const yours = () => { if (named) log(`memory: ${rel}/.gitattributes kept - not the stack's text, so it is yours`); return 'yours'; };
    if (want)
    {
        if (text === null)
        {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(file, ATTRIBUTES_TEXT);
            log(`memory: ${rel}/.gitattributes written - MEMORY.md merges by union, so lessons added on two branches merge clean`);
            return 'written';
        }
        return ours ? 'kept' : yours();
    }
    if (text === null) return 'none';
    if (!ours) return yours();
    fs.rmSync(file, { force: true });
    log(`memory: ${rel}/.gitattributes removed - ${why}`);
    return 'removed';
}

// After ignoreStep: the row, then the copy and the attributes file, each failing alone.
function step(ctx, docsPath, { warnUnignoredLocal = () => {} } = {})
{
    const done = rowStep(ctx, { warnUnignoredLocal });
    const say = (line) => ctx.log(`  ${line}`);
    // R162 (burn-down 2026-11-04): a copy asked for on a skipped run was dropped without a word.
    if (done.skip)
    {
        if (ctx.memoryFrom) say(ctx.docsRootPending
            ? 'memory: copy not made - the docs root waits on /alfred-code:update\'s ask; an update with --memory-copy after it makes the copy'
            : 'memory: copy not made - the data root is not valid; once it is fixed, an update with --memory-copy makes the copy');
        return;
    }
    try { copyStep(ctx, done.mode); }
    catch (err) { say(`!! memory: copy stopped - ${err.message}; the old files stay where they are`); }
    // A sharing child's folder is its member's, and a refused one is left as it is until the cause is fixed.
    if (done.share || done.refusal) return;
    const dir = layout.docsMemoryDir(ctx.projectRoot, { env: memoryEnv(ctx) });
    const docs = done.mode === 'docs';
    try
    {
        attributesStep({
            dir, want: docs && ctx.docsVersioningMode !== 'local', log: say, rel: shown(dir, ctx.projectRoot),
            why: docs ? 'the docs are kept out of git' : 'ALFRED_CODE_MEMORY is no longer docs',
            named: Boolean(ctx.memoryAsked || ctx.args.docsVersioning),
        });
    }
    catch (err) { say(`!! memory: the docs memory's .gitattributes could not be checked (${err.message}) - re-run /alfred-code:update`); }
}

// R171's review: whether git tracks an old settings.local.json - only a plain 'no match' (exit 1) counts as untracked, so
// no git, a timeout or a nested repository never offers a repository's file as a move. No inherited GIT_* steers it.
function staleTracked(file)
{
    const env = { GIT_OPTIONAL_LOCKS: '0' };
    for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k)) env[k] = v;
    try
    {
        return rt.spawnCommand('git', ['-c', 'core.fsmonitor=false', 'ls-files', '--error-unmatch', '--', path.basename(file)],
            { cwd: path.dirname(file), stdio: 'ignore', timeout: 5000, env }).status !== 1;
    }
    catch { return true; }
}
// The line for one old file: a move into the root file, or its removal where the root file sets its own key.
const staleLocalLine = (x, rel) => (x.rootSets
    ? `${rel(x.file)} sets autoMemoryDirectory, which Claude Code 2.1.211+ ignores while ${rel(x.rootFile)} sets its own - remove the key from ${rel(x.file)}`
    : `${rel(x.file)} sets autoMemoryDirectory; Claude Code 2.1.211+ reads it only while ${rel(x.rootFile)} sets none, and the write guard never trusts it - move the key into ${rel(x.rootFile)}`);

// R171: every settings.local.json below the repository top that sets autoMemoryDirectory where Claude Code 2.1.211+ no
// longer keeps the file - named on each run until the key is moved (the write guard never trusts it). Writes nothing.
function staleLocalStep(ctx)
{
    try
    {
        const top = layout.gitTopOf(ctx.projectRoot) || ctx.projectRoot;
        const { found, cut } = layout.staleLocalMemoryFiles(top, { tracked: staleTracked });
        const rel = (p) => path.relative(ctx.projectRoot, p).split(path.sep).join('/');
        for (const x of found) ctx.log(`  !! memory: ${staleLocalLine(x, rel)}`);
        if (cut) ctx.log('  !! memory: the search for old settings.local.json files stopped at 20,000 entries');
    }
    catch (err) { ctx.note(`old settings.local.json files could not be checked for autoMemoryDirectory (${err.message})`); }
}

module.exports = { gate, step, staleLocalStep, staleTracked, memoryEnv, rowHash, outrankLines, shown, copyMemory, copyStep, attributesStep, ATTRIBUTES_TEXT };
