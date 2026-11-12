#!/usr/bin/env node
// THE USAGE COLLECTOR - one session's every stack store into one audit bundle, with a receipt (`collected.json`) that
// says what was copied and why each missing store is missing, so an audit never reads a store it never collected as
// zero. Both usage audits call it: the stack's capture-usage-report and this repo's repo-audit-usage.
//
//   node scripts/collect-session.js <transcript.jsonl> --out <session folder>
//        [--project <root>] [--data-root <dir>] [--tmp <dir>]... [--text copy|withhold]
//        [--allow-tracked] [--move-tool-usage]
//
// The stores are the rows of scripts/collect-stores.js. Every path is resolved from the transcript and the project's
// own files, never from this process's ALFRED_CODE_* env (the session running the collector carries ITS settings).
// Exit 0 on a written bundle, whatever stores were absent; exit 2 on a usage error or a refusal, with nothing written.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const layout = require('../stack/hooks/layout.js');
const { STORES, eachLine, toPosix, isDir, listDir, sidDir } = require('./collect-stores.js');
const privacy = require('./collect-privacy.js');
const { realOf } = privacy;

const USAGE = 'usage: node scripts/collect-session.js <transcript.jsonl> --out <session folder> [--project <root>] '
    + '[--data-root <dir>] [--tmp <dir>]... [--text copy|withhold] [--allow-tracked] [--move-tool-usage]';
const TAIL_MS = 120000;
// The docs caps (spec 4.3): a file past 1 MB, or one that would take the docs past 20 MB, is capped - named, not copied.
const DOC_CAP = 1048576;
const DOCS_TOTAL = 20971520;
// hook-prelude.js sweepStale removes a per-session file untouched for 7 days.
const SWEEP_MS = 604800000;
// The bundle's top-level second copies of the two ledgers (spec 4.2), under the names audit.md and the analyzer read.
const SECOND_COPIES = [['hook-blocks', 'hook-blocks'], ['tools-usage', 'tool-usage']];
const SECOND_COPY = /^(?:hook-blocks|tool-usage)-[^/]*\.jsonl$/;
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

class UsageError extends Error {}
class Refusal extends Error {}

function parseArgs(argv)
{
    const o = { transcript: null, out: null, project: null, dataRoot: null, tmp: null, text: 'copy', allowTracked: false, moveToolUsage: false };
    const value = (i, flag) =>
    {
        const v = argv[i + 1];
        if (v === undefined || String(v).startsWith('--')) throw new UsageError(`${flag} needs a value`);
        return String(v);
    };
    for (let i = 0; i < argv.length; i++)
    {
        const a = String(argv[i]);
        if (a === '--out') o.out = value(i++, a);
        else if (a === '--project') o.project = value(i++, a);
        else if (a === '--data-root') o.dataRoot = value(i++, a);
        else if (a === '--tmp') (o.tmp = o.tmp || []).push(value(i++, a));
        else if (a === '--text')
        {
            o.text = value(i++, a);
            if (o.text !== 'copy' && o.text !== 'withhold') throw new UsageError(`--text takes copy or withhold, not '${o.text}'`);
        }
        else if (a === '--allow-tracked') o.allowTracked = true;
        else if (a === '--move-tool-usage') o.moveToolUsage = true;
        else if (a.startsWith('--')) throw new UsageError(`unknown flag ${a}`);
        else if (o.transcript) throw new UsageError(`one transcript only, got a second: ${a}`);
        else o.transcript = a;
    }
    if (!o.transcript) throw new UsageError('no transcript given');
    if (!o.out) throw new UsageError('no --out given');
    return o;
}

// One streamed pass over a transcript. `rows` counts the lines whose TOP-LEVEL object carries a timestamp (Claude
// Code's head lines - last-prompt, mode, permission-mode, a file-history-snapshot with its timestamp nested - and a
// closing bridge-session line carry none), and the span comes from those alone.
function scanTranscript(file, { fs: fsx = fs } = {})
{
    let rows = 0;
    let firstMs = Infinity;
    let lastMs = -Infinity;
    let cwd = null;
    const written = new Set();
    eachLine(file, fsx, (text) =>
    {
        if (!text.trim()) return;
        let o;
        try { o = JSON.parse(text); }
        catch { return; }
        if (!o || typeof o !== 'object') return;
        const ms = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
        if (!Number.isNaN(ms))
        {
            rows += 1;
            if (ms < firstMs) firstMs = ms;
            if (ms > lastMs) lastMs = ms;
        }
        if (!cwd && typeof o.cwd === 'string' && o.cwd) cwd = o.cwd;
        const content = o.message && Array.isArray(o.message.content) ? o.message.content : [];
        for (const c of content)
        {
            if (!c || c.type !== 'tool_use' || !WRITE_TOOLS.has(c.name) || !c.input) continue;
            const p = c.input.file_path || c.input.notebook_path;
            if (typeof p === 'string' && p) written.add(p);
        }
    });
    const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
    return { rows, firstTs: iso(firstMs), lastTs: iso(lastMs), cwd, written };
}

const inside = (child, parent) =>
{
    const rel = path.relative(parent, child);
    return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
};

function walkFiles(fsx, dir, test, out = [])
{
    let entries = [];
    try { entries = fsx.readdirSync(dir, { withFileTypes: true }); }
    catch { return out; }
    for (const e of entries)
    {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walkFiles(fsx, full, test, out);
        else if (e.isFile() && test(e.name)) out.push(full);
    }
    return out;
}

function resolveContext(opts, deps = {})
{
    const env = deps.env || process.env;
    const fsx = deps.fs || fs;
    const now = deps.now ?? Date.now();
    const platform = deps.platform || process.platform;
    const transcript = path.resolve(opts.transcript);
    try { fsx.accessSync(transcript, fs.constants.R_OK); }
    catch { throw new Refusal(`cannot read the transcript ${transcript}`); }
    if (!transcript.endsWith('.jsonl')) throw new Refusal(`not a .jsonl transcript: ${transcript}`);
    const sid = path.basename(transcript, '.jsonl');
    const scan = scanTranscript(transcript, { fs: fsx });
    if (!scan.rows) throw new Refusal(`no session rows in ${transcript} (no line carries a timestamp)`);
    // A seat's writes are the session's: its docs are collected beside the main thread's.
    for (const f of walkFiles(fsx, path.join(path.dirname(transcript), sid, 'subagents'), (n) => /^agent-.*\.jsonl$/.test(n)))
        for (const w of scanTranscript(f, { fs: fsx }).written) scan.written.add(w);
    const project = opts.project ? path.resolve(opts.project) : scan.cwd ? path.resolve(scan.cwd) : null;
    if (!project) throw new Refusal('no project: the transcript names no cwd - pass --project <root>');

    // <config>/projects/<encoded project>/<sid>.jsonl - the session's own account, never the auditing one's.
    const folder = path.dirname(transcript);
    const configDir = path.basename(path.dirname(folder)) === 'projects'
        ? path.dirname(path.dirname(folder))
        : env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), '.claude');
    const stripped = {};
    if (env.HOME) stripped.HOME = env.HOME;
    if (env.USERPROFILE) stripped.USERPROFILE = env.USERPROFILE;
    stripped.CLAUDE_CONFIG_DIR = configDir;

    // The data root is always .alfred; --data-root names another folder (an older install's, a harness's scratch).
    const dataRootValue = toPosix(String(opts.dataRoot || '.alfred')).replace(/\/+$/, '') || '.alfred';
    const dataRoot = path.resolve(project, dataRootValue);
    // docsRootOf splits its dataRoot on '/', so an absolute root is handed over relative to the project.
    const dataRootRel = path.isAbsolute(dataRootValue) ? toPosix(path.relative(project, dataRoot)) : dataRootValue;
    const docsRoot = layout.docsRootOf(project, { env: stripped, dataRoot: dataRootRel });
    // The hooks' path helpers take a folder other than .alfred only as an absolute value.
    const ctxEnv = { ...stripped, ...(opts.dataRoot ? { ALFRED_CODE_DATA_PATH: toPosix(dataRoot) } : {}), ALFRED_CODE_DOCS_PATH: docsRoot };

    let tmpDirs;
    if (opts.tmp) tmpDirs = opts.tmp.map((d) => path.resolve(d));
    else
    {
        const hookLog = layout.settingFrom({ env: stripped, projectDir: project, suffix: 'HOOK_LOG_DIR' });
        tmpDirs = [hookLog ? path.resolve(project, hookLog) : null, deps.tmpdir || os.tmpdir(), platform === 'win32' ? null : '/tmp']
            .filter(Boolean);
    }
    const seen = new Set();
    tmpDirs = tmpDirs.filter((d) =>
    {
        const key = realOf(fsx, d);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    const fromMs = Date.parse(scan.firstTs);
    const lastMs = Date.parse(scan.lastTs);
    const toMs = lastMs + TAIL_MS;
    return {
        sid, transcript, out: path.resolve(opts.out), project, configDir, env: ctxEnv, stripped, dataRootValue, dataRootRel, dataRoot,
        docsRoot, tmpDirs, window: { from: scan.firstTs, to: new Date(toMs).toISOString(), fromMs, toMs }, lastMs,
        written: scan.written, opts, fs: fsx, now, platform, cache: {},
    };
}

// The refusals that need the context: a bundle inside the session's own folder, one inside a folder the stores read by
// name (the data root's state/, the docs root - a re-run took the bundle as an item and copied it into itself, R166), and
// one holding another session. The data root's statistics/ stays open: the capture skill's own bundles live in
// statistics/usage-report/, and no store there is read by name.
function refuseOut(ctx)
{
    const fsx = ctx.fs;
    const out = realOf(fsx, ctx.out);
    const folder = realOf(fsx, path.dirname(ctx.transcript));
    if (out === folder || inside(out, realOf(fsx, sidDir(ctx))))
        throw new Refusal(`--out ${ctx.out} lies in the transcript's own folder - pick a folder outside ${folder}`);
    for (const [root, what] of [[path.join(ctx.dataRoot, 'state'), 'the data root\'s state/'], [ctx.docsRoot, 'the docs root']])
    {
        if (inside(out, realOf(fsx, root))) throw new Refusal(`--out ${ctx.out} lies inside ${what} (${root}), which the stores read by name - pick a folder outside it`);
    }
    if (fsx.existsSync(ctx.out) && !isDir(fsx, ctx.out)) throw new Refusal(`--out ${ctx.out} is a file`);
    const receipt = path.join(ctx.out, 'collected.json');
    if (fsx.existsSync(receipt))
    {
        let session = null;
        try { session = JSON.parse(fsx.readFileSync(receipt, 'utf8')).session; }
        catch { /* unreadable: not this session's */ }
        if (session !== ctx.sid) throw new Refusal(`--out ${ctx.out} holds the bundle of another session (${session || 'unreadable collected.json'})`);
    }
}

// A file or folder the privacy rules (spec 4.4) skip: a receipt row of its own after the store's, naming the bundle path
// it would have had and the rule - never the value.
const skip = (acc, to, status, why) => { acc.skipped.push({ status, file: to, why }); return acc; };
// A live session's files churn (a seat's 60 s pending file, a lock): one gone between the listing and the copy is an
// absent row of its own, never the end of the run. Any other error still ends it.
const VANISHED = 'vanished during the collect';
const vanished = (e, acc, to) => { if (e.code !== 'ENOENT') throw e; return skip(acc, to, 'absent', VANISHED); };
const deniedName = (to) =>
{
    for (const segment of to.split('/'))
    {
        const rule = privacy.neverCopied(segment);
        if (rule) return `never copied: ${rule}`;
    }
    return null;
};

// PLANNING - every file a store would write, through the rules, before anything is written: the gate (4.4) judges the
// whole list, and withhold counts the text it keeps back. An op is { dest, to, from | buf | body } or { dir }.
function planTree(fsx, from, dest, to, acc)
{
    let st;
    let names;
    try
    {
        st = fsx.lstatSync(from);
        if (st.isDirectory()) names = fsx.readdirSync(from).sort();
    }
    catch (e) { return vanished(e, acc, to); }
    if (st.isSymbolicLink()) return skip(acc, to, 'denied', 'symlink');
    if (st.isDirectory())
    {
        const before = acc.files;
        for (const name of names)
        {
            const sub = `${to}/${name}`;
            const rule = privacy.neverCopied(name);
            if (rule) { skip(acc, sub, 'denied', `never copied: ${rule}`); continue; }
            planTree(fsx, path.join(from, name), path.join(dest, name), sub, acc);
        }
        if (acc.files === before) acc.ops.push({ dir: dest });
        return acc;
    }
    if (!st.isFile()) return acc;
    acc.ops.push({ dest, to, from, size: st.size });
    acc.files += 1;
    acc.bytes += st.size;
    return acc;
}

// One item through the rules: a name on the never-copied list in any segment, a link, a path whose real location
// leaves its source root (`item.root`, else the folder it was listed from); for a `content` row (docs, tmp) the
// credential check, and for a `caps` row (docs) the 1 MB and 20 MB caps.
function planItem(ctx, row, item, acc)
{
    const dest = path.join(ctx.out, ...item.to.split('/'));
    const before = acc.files;
    if (item.body !== undefined)
    {
        acc.ops.push({ dest, to: item.to, body: item.body });
        acc.files += 1;
        acc.bytes += Buffer.byteLength(item.body);
    }
    else
    {
        const named = deniedName(item.to);
        if (named) return skip(acc, item.to, 'denied', named);
        let st;
        try { st = ctx.fs.lstatSync(item.from); }
        catch (e) { return e.code === 'ENOENT' ? skip(acc, item.to, 'absent', VANISHED) : acc; }
        if (st.isSymbolicLink()) return skip(acc, item.to, 'denied', 'symlink');
        if (!privacy.realInside(ctx.fs, item.from, item.root || path.dirname(item.from))) return skip(acc, item.to, 'denied', 'outside its root');
        if (st.isFile() && row.ledger && item.to === `data/statistics/${row.id}/${ctx.sid}.jsonl`)
        {
            const top = SECOND_COPIES.find(([dir]) => dir === row.id)[1];
            acc.ops.push({ dest, to: item.to, from: item.from, ledger: true, seed: path.join(ctx.out, `${top}-${ctx.sid}.jsonl`),
                move: !!(ctx.opts.moveToolUsage && row.id === 'tools-usage'), size: st.size });
            acc.files += 1;
            acc.bytes += st.size;
        }
        else if (st.isFile() && (row.content || row.caps))
        {
            if (row.caps && st.size > DOC_CAP) return skip(acc, item.to, 'capped', `over 1 MB a file (${st.size} bytes, cap ${DOC_CAP})`);
            if (row.caps && acc.bytes + st.size > DOCS_TOTAL) return skip(acc, item.to, 'capped', `over 20 MB in all (cap ${DOCS_TOTAL} bytes)`);
            let buf;
            try { buf = ctx.fs.readFileSync(item.from); }
            catch (e) { return vanished(e, acc, item.to); }
            const why = row.content ? privacy.contentDenial(buf.toString('utf8')) : null;
            if (why) return skip(acc, item.to, 'denied', why);
            acc.ops.push({ dest, to: item.to, buf });
            acc.files += 1;
            acc.bytes += buf.length;
        }
        else planTree(ctx.fs, item.from, dest, item.to, acc);
    }
    if (acc.files > before) acc.tos.push(item.to);
    return acc;
}

// THE LEDGERS (spec 4.1, 4.6): the bundle's ledger is never written over - the source's lines not already in it are
// added (a row carries its `ts` and `tool_use_id`, so a repeated line is the same row), through `.tmp` and a rename.
function ledgerLines(fsx, file)
{
    if (!fsx.existsSync(file)) return null;
    const lines = [];
    eachLine(file, fsx, (text) => { if (text.trim()) lines.push(text); });
    return lines;
}
function writeLines(fsx, dest, lines)
{
    fsx.mkdirSync(path.dirname(dest), { recursive: true });
    fsx.writeFileSync(`${dest}.tmp`, lines.length ? lines.join('\n') + '\n' : '');
    fsx.renameSync(`${dest}.tmp`, dest);
    return lines.length;
}
function mergeInto(fsx, dest, from, base)
{
    const all = base || ledgerLines(fsx, dest) || [];
    const seen = new Set(all);
    for (const text of ledgerLines(fsx, from) || []) if (!seen.has(text)) { seen.add(text); all.push(text); }
    return writeLines(fsx, dest, all);
}
// A copied ledger: the bundle's lines - or, for an older bundle with no data/ copy, its top-level `seed` - plus the
// source's new ones.
function mergeLedger(fsx, from, dest, seed)
{
    const base = ledgerLines(fsx, dest) || (seed ? ledgerLines(fsx, seed) : null) || [];
    return { status: 'copied', rows: mergeInto(fsx, dest, from, base), why: '' };
}
// `src` renamed to `target` - on EXDEV (a data root spanning a mount) copied, compared and unlinked; a size that
// changed in between keeps the source.
function relocate(fsx, src, target)
{
    try
    {
        fsx.renameSync(src, target);
        return { status: 'moved', why: '' };
    }
    catch (e)
    {
        if (e.code !== 'EXDEV') throw e;
        fsx.copyFileSync(src, target);
        if (fsx.statSync(src).size !== fsx.statSync(target).size)
            return { status: 'copied', why: 'copied - size changed during the move, the project keeps its ledger' };
        fsx.unlinkSync(src);
        return { status: 'moved', why: '' };
    }
}
// --move-tool-usage: with no ledger in the bundle, one rename (a row the hook appends after it opens a new source file);
// with one, the source goes to `<dest>.incoming` first and is merged in, so a run that dies leaves `.incoming` beside an
// unchanged ledger or a merged ledger beside a stale `.incoming` - either merges cleanly next time.
function moveLedger(src, dest, { fs: fsx = fs, seed } = {})
{
    fsx.mkdirSync(path.dirname(dest), { recursive: true });
    const incoming = `${dest}.incoming`;
    if (fsx.existsSync(incoming)) { mergeInto(fsx, dest, incoming); fsx.unlinkSync(incoming); }
    if (!fsx.existsSync(dest) && seed && fsx.existsSync(seed)) writeLines(fsx, dest, ledgerLines(fsx, seed));
    if (!fsx.existsSync(dest))
    {
        const r = relocate(fsx, src, dest);
        return { ...r, rows: (ledgerLines(fsx, dest) || []).length };
    }
    const r = relocate(fsx, src, incoming);
    const rows = mergeInto(fsx, dest, incoming);
    fsx.unlinkSync(incoming);
    return { ...r, rows };
}

function writeOps(fsx, ops, acc)
{
    for (const op of ops)
    {
        if (op.dir) { fsx.mkdirSync(op.dir, { recursive: true }); continue; }
        fsx.mkdirSync(path.dirname(op.dest), { recursive: true });
        if (op.ledger)
        {
            acc.ledger = op.move ? moveLedger(op.from, op.dest, { fs: fsx, seed: op.seed }) : mergeLedger(fsx, op.from, op.dest, op.seed);
            acc.bytes += fsx.statSync(op.dest).size - op.size;
        }
        else if (op.from)
        {
            try { fsx.copyFileSync(op.from, op.dest); }
            catch (e)
            {
                vanished(e, acc, op.to);
                acc.files -= 1;
                acc.bytes -= op.size;
            }
        }
        else fsx.writeFileSync(op.dest, op.buf !== undefined ? op.buf : op.body);
    }
}

function commonDir(tos)
{
    if (tos.length === 1) return tos[0];
    const parts = tos.map((t) => t.split('/'));
    const head = [];
    for (let i = 0; parts.every((p) => i < p.length - 1 && p[i] === parts[0][i]); i++) head.push(parts[0][i]);
    return head.length ? head.join('/') + '/' : undefined;
}

// The rows a file holds: a JSONL line each, a JSON array's entries, models.json's sessions.
function rowCount(fsx, file)
{
    try
    {
        if (file.endsWith('.jsonl'))
        {
            let n = 0;
            eachLine(file, fsx, (text) => { if (text.trim()) n += 1; });
            return n;
        }
        if (!file.endsWith('.json')) return undefined;
        const value = JSON.parse(fsx.readFileSync(file, 'utf8'));
        if (Array.isArray(value)) return value.length;
        return path.basename(file) === 'models.json' && value && typeof value === 'object' ? Object.keys(value).length : undefined;
    }
    catch { return undefined; }
}

// The files <out> holds for a store (its `held` paths: a folder, a file, or a name prefix in its folder) - an older
// capture's top-level ledger copy counts only where the bundle holds no data/ copy.
function heldFiles(ctx, row)
{
    const files = [];
    let primary = false;
    for (const h of row.held(ctx))
    {
        const abs = path.join(ctx.out, ...h.split('/').filter(Boolean));
        let hits = [];
        if (isDir(ctx.fs, abs)) hits = walkFiles(ctx.fs, abs, () => true);
        else if (ctx.fs.existsSync(abs)) hits = [abs];
        else if (!h.endsWith('/'))
        {
            const dir = path.dirname(abs);
            for (const name of listDir(ctx.fs, dir).filter((n) => n.startsWith(path.basename(abs))))
            {
                const full = path.join(dir, name);
                if (isDir(ctx.fs, full)) walkFiles(ctx.fs, full, () => true, hits);
                else hits.push(full);
            }
        }
        if (SECOND_COPY.test(h)) { if (!primary) files.push(...hits); }
        else
        {
            if (hits.length) primary = true;
            files.push(...hits);
        }
    }
    return [...new Set(files)].sort();
}

// A store absent from the source whose files <out> still holds (spec 4.6): kept, never deleted; the tools-usage
// ledger in that state was moved by an earlier capture.
function keptRow(ctx, row)
{
    const files = heldFiles(ctx, row);
    if (!files.length) return null;
    const r = { id: row.id, status: row.id === 'tools-usage' ? 'moved' : 'kept', files: files.length, bytes: 0 };
    let rows = 0;
    let counted = false;
    for (const f of files)
    {
        try { r.bytes += ctx.fs.statSync(f).size; }
        catch { /* gone meanwhile */ }
        const n = rowCount(ctx.fs, f);
        if (n !== undefined) { rows += n; counted = true; }
    }
    if (counted) r.rows = rows;
    const to = commonDir(files.map((f) => toPosix(path.relative(ctx.out, f))));
    if (to) r.to = to;
    r.why = r.status === 'moved' ? 'in the bundle; the project\'s copy was moved' : 'from an earlier capture';
    return r;
}

function storeRow(ctx, row, found, acc, withheld)
{
    const items = found.items || [];
    const r = { id: row.id };
    // A store whose every file the rules skipped reads that rule's status itself (denied, then capped, then absent).
    const skippedAll = !acc.files && acc.skipped.length;
    if (found.status) r.status = found.status;
    else if (skippedAll) r.status = ['denied', 'capped', 'absent'].find((st) => acc.skipped.some((s) => s.status === st));
    else if (items.length && withheld) r.status = 'withheld';
    else if (acc.ledger) r.status = acc.ledger.status;
    else if (items.length) r.status = found.filtered ? 'filtered' : 'copied';
    else
    {
        const kept = keptRow(ctx, row);
        if (kept) return kept;
        r.status = 'absent';
    }
    if (r.status === 'absent')
    {
        if (row.inData && !isDir(ctx.fs, ctx.dataRoot)) found = { ...found, why: `no data root: ${ctx.dataRoot}` };
        else if (row.sweeps && ctx.now - ctx.lastMs > SWEEP_MS) found = { ...found, why: 'swept' };
    }
    if (acc.files)
    {
        r.files = acc.files;
        r.bytes = acc.bytes;
        const rows = acc.ledger ? acc.ledger.rows : items.reduce((n, i) => n + (i.rows || 0), 0);
        if (rows || found.filtered) r.rows = rows;
        const to = withheld ? undefined : commonDir(acc.tos);
        if (to) r.to = to;
    }
    for (const k of ['torn', 'matched', 'overlap', 'overlapUnread', 'root']) if (found[k] !== undefined) r[k] = found[k];
    r.why = skippedAll ? acc.skipped.find((s) => s.status === r.status).why
        : (acc.ledger && acc.ledger.why) || found.why || (r.status === 'absent' ? 'not written' : '');
    return r;
}

const relOrAbs = (project, p) =>
{
    const rel = path.relative(project, p);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? toPosix(rel) : p;
};

// The env git runs the gate in: this process's, no GIT_* variable (a hook's GIT_DIR would point it elsewhere), the
// session's HOME, the PATH the caller passed.
function gitEnv(ctx, deps)
{
    const env = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
    for (const k of ['HOME', 'USERPROFILE']) if (ctx.stripped[k]) env[k] = ctx.stripped[k];
    if (deps.env && deps.env.PATH) env.PATH = deps.env.PATH;
    return env;
}

function collect(opts, deps = {})
{
    let ctx;
    let receiptTmp = null;
    try
    {
        ctx = resolveContext(opts, deps);
        refuseOut(ctx);
        if (opts.moveToolUsage && !inside(realOf(ctx.fs, ctx.out), realOf(ctx.fs, ctx.dataRoot)))
            throw new Refusal(`--move-tool-usage needs --out inside the project's data root (${ctx.dataRoot}), the one place a moved ledger stays the project's record - drop the flag to copy it`);
        const withhold = opts.text === 'withhold';
        const planned = STORES.map((row) =>
        {
            const found = row.find(ctx) || { items: [] };
            const acc = { files: 0, bytes: 0, tos: [], skipped: [], ops: [] };
            for (const item of found.items || []) planItem(ctx, row, item, acc);
            return { row, found, acc, withheld: withhold && row.cls !== 'meta' };
        });
        const ops = planned.filter((p) => !p.withheld).flatMap((p) => p.acc.ops);
        // The second copies follow a ledger this run writes or the bundle already holds.
        const writes = new Set(ops.filter((op) => op.to).flatMap((op) => (op.ledger ? [op.to, `${op.to}.tmp`, `${op.to}.incoming`] : [op.to])));
        const seconds = SECOND_COPIES.map(([dir, name]) => ({ data: `data/statistics/${dir}/${ctx.sid}.jsonl`, top: `${name}-${ctx.sid}.jsonl` }))
            .filter((c) => writes.has(c.data) || ctx.fs.existsSync(path.join(ctx.out, ...c.data.split('/'))));

        let gateWhy = 'withhold';
        if (!withhold)
        {
            const g = privacy.gate(ctx.out, [...writes, ...seconds.map((c) => c.top), 'collected.json', 'collected.json.tmp'],
                { fs: ctx.fs, env: gitEnv(ctx, deps), allowTracked: opts.allowTracked });
            if (!g.ok) throw new Refusal(g.why);
            gateWhy = g.why;
        }

        // A `.incoming` a moving run left behind is the bundle's own rows: merged before anything else.
        const incoming = path.join(ctx.out, 'data', 'statistics', 'tools-usage', `${ctx.sid}.jsonl.incoming`);
        if (ctx.fs.existsSync(incoming)) { mergeInto(ctx.fs, incoming.slice(0, -'.incoming'.length), incoming); ctx.fs.unlinkSync(incoming); }
        for (const p of planned) if (!p.withheld) writeOps(ctx.fs, p.acc.ops, p.acc);
        for (const c of seconds)
        {
            const from = path.join(ctx.out, ...c.data.split('/'));
            if (ctx.fs.existsSync(from)) ctx.fs.writeFileSync(path.join(ctx.out, c.top), ctx.fs.readFileSync(from));
        }

        const rows = [];
        for (const p of planned) rows.push(storeRow(ctx, p.row, p.found, p.acc, p.withheld), ...p.acc.skipped.map((s) => ({ id: p.row.id, ...s })));
        const receipt = {
            collector: 1, session: ctx.sid, collectedAt: new Date(ctx.now).toISOString(), transcript: ctx.transcript,
            project: ctx.project, configDir: ctx.configDir, dataRoot: ctx.dataRootValue,
            docsRoot: relOrAbs(ctx.project, ctx.docsRoot), tmp: ctx.tmpDirs, text: opts.text, gate: gateWhy,
            window: { from: ctx.window.from, to: ctx.window.to }, stores: rows,
        };
        ctx.fs.mkdirSync(ctx.out, { recursive: true });
        const final = path.join(ctx.out, 'collected.json');
        receiptTmp = `${final}.tmp`;
        ctx.fs.writeFileSync(receiptTmp, JSON.stringify(receipt, null, 2) + '\n');
        ctx.fs.renameSync(receiptTmp, final);
        receiptTmp = null;
        const primary = rows.filter((r, i) => rows.findIndex((x) => x.id === r.id) === i);
        const absent = primary.filter((r) => r.status === 'absent').length;
        return { code: 0, message: `collected ${ctx.sid}: ${primary.length - absent} stores written, ${absent} absent - ${final}`, receipt };
    }
    catch (e)
    {
        if (receiptTmp) try { (ctx ? ctx.fs : fs).rmSync(receiptTmp, { force: true }); } catch { /* best effort */ }
        const why = e instanceof UsageError ? `${e.message}\n${USAGE}` : e.message;
        return { code: 2, message: `collect-session: ${why}` };
    }
}

function main(argv)
{
    let r;
    try { r = collect(parseArgs(argv)); }
    catch (e) { r = { code: 2, message: `collect-session: ${e.message}\n${USAGE}` }; }
    (r.code ? process.stderr : process.stdout).write(r.message + '\n');
    process.exitCode = r.code;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { parseArgs, scanTranscript, resolveContext, collect, main, moveLedger, realOf, inside, UsageError, Refusal, USAGE, TAIL_MS };
