// THE STORE TABLE of scripts/collect-session.js - one row per store the stack keeps about a session (the
// usage-collector design of 2026-11-04). Each row's `find(ctx)` is PURE:
// it reads the sources and returns what to write (`items`), never writing; the collector gates and writes them.
//
//   StoreRow = { id, cls: 'meta'|'text', match, kind?, prefix?, prefixes?, name?, sweeps?, prunes?, find, held }
//   Found    = { items: Item[], why?, status?, torn?, matched?, overlap?, root?, legacy? }
//   Item     = { to: <posix path under the bundle>, from?: <abs file or dir>, body?: <text>, root?, rows?, cls? }
//
// `root` is the source root an item's real path must stay in (spec 4.4), else the folder it was listed from. A row
// with `content` has each file checked for a credential, one with `caps` held to the docs caps, and a `ledger` row's
// <sid>.jsonl is merged into the bundle's copy, never written over it (collect-session.js).
//
// `held(ctx)` names the bundle paths that are the store's, so a store gone from the source but kept in the bundle reads
// `kept` (spec 4.6). scripts/collect-stores-drift.test.js holds the rows to the hooks that write the stores.
'use strict';
const path = require('node:path');

const layout = require('../stack/hooks/layout.js');

const CHUNK = 1048576;

// Every line of a file, read in 1 MB chunks with the partial line carried over, so a line of any length arrives whole
// and a store of any size is never held in memory. `onLine(text, last)` - `last` is true for a final line with no
// newline after it (a torn write, for the stores that count one).
function eachLine(file, fsx, onLine)
{
    const fd = fsx.openSync(file, 'r');
    try
    {
        const buf = Buffer.alloc(CHUNK);
        let carry = [];
        for (;;)
        {
            const n = fsx.readSync(fd, buf, 0, CHUNK, null);
            if (n <= 0) break;
            const view = buf.subarray(0, n);
            let start = 0;
            let nl;
            while ((nl = view.indexOf(10, start)) !== -1)
            {
                const piece = view.subarray(start, nl);
                onLine((carry.length ? Buffer.concat([...carry, piece]) : piece).toString('utf8'), false);
                carry = [];
                start = nl + 1;
            }
            if (start < n) carry.push(Buffer.from(view.subarray(start)));
        }
        if (carry.length) onLine(Buffer.concat(carry).toString('utf8'), true);
    }
    finally { fsx.closeSync(fd); }
}

const toPosix = (p) => p.split(path.sep).join('/');
const sidDir = (ctx) => path.join(path.dirname(ctx.transcript), ctx.sid);
function isDir(fsx, dir)
{
    try { return fsx.statSync(dir).isDirectory(); }
    catch { return false; }
}
function listDir(fsx, dir)
{
    try { return fsx.readdirSync(dir).sort(); }
    catch { return []; }
}

const exists = (fsx, p) =>
{
    try { fsx.statSync(p); return true; }
    catch { return false; }
};
// A file or folder the hooks keep under the data root, copied to the same path under the bundle's data/.
const dataItem = (ctx, file) => ({ to: `data/${toPosix(path.relative(ctx.dataRoot, file))}`, from: file, root: ctx.dataRoot });

// One listing of a state folder per run and root.
function stateEntries(ctx, kind, root = ctx.project)
{
    const key = `state:${kind}:${root}`;
    if (!ctx.cache[key])
    {
        const dir = layout.statePath(root, kind, '', ctx.env);
        ctx.cache[key] = { dir, names: listDir(ctx.fs, dir) };
    }
    return ctx.cache[key];
}

const realOrSelf = (fsx, p) =>
{
    try { return (fsx.realpathSync.native || fsx.realpathSync)(p); }
    catch { return path.resolve(p); }
};
// A hook module loaded for one function, with the process env put back after: hook-prelude.js applies a project's
// variables to process.env on load (hook-prelude.js:65), and the collector reads no ALFRED_CODE_* value of its own.
function requireQuiet(file)
{
    const before = { ...process.env };
    try { return require(file); }
    finally
    {
        for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
        for (const [key, value] of Object.entries(before)) if (process.env[key] !== value) process.env[key] = value;
    }
}
// The roots a store's writer may have used, the project's own first, deduped by real path. handoff: layout.projectRootOf;
// preferences: every checkout hook-prelude.js checkoutsOf names (preferences-session.js contextOf).
function rootsFor(ctx, kind)
{
    const key = `roots:${kind}`;
    if (ctx.cache[key]) return ctx.cache[key];
    const roots = [ctx.project];
    try
    {
        if (kind === 'handoff') roots.push(layout.projectRootOf(ctx.project).project);
        else if (kind === 'preferences') roots.push(...requireQuiet('../stack/hooks/hook-prelude.js').checkoutsOf(realOrSelf(ctx.fs, ctx.project)));
    }
    catch { /* the project alone */ }
    const seen = new Set();
    ctx.cache[key] = roots.filter(Boolean).filter((r) =>
    {
        const real = realOrSelf(ctx.fs, r);
        if (seen.has(real)) return false;
        seen.add(real);
        return true;
    });
    return ctx.cache[key];
}
// The `root` a receipt row names: the real path of the root that held the store, when it is not the project.
const otherRoot = (ctx, root) => (realOrSelf(ctx.fs, root) === realOrSelf(ctx.fs, ctx.project) ? undefined : realOrSelf(ctx.fs, root));
const holdsSid = (ctx, name) => name.includes(ctx.sid);

// The ledgers: the session's file in statistics/<dir>/, else its pre-2.8.0 home under the docs root (layout.findStats).
function ledger(ctx, dir, name)
{
    const fresh = layout.statsPath(ctx.project, [dir, name], ctx.env);
    const file = layout.findStats(ctx.project, [dir, name], ctx.env);
    if (!exists(ctx.fs, file)) return null;
    return { item: { to: `data/statistics/${dir}/${name}`, from: file }, legacy: file !== fresh };
}

// A redirected tools-usage ledger (ALFRED_CODE_INSTRUMENT_LOG in the project's files): one file for every session, so
// only this session's rows are kept (instrument-tool-usage.js writes `session` on each row).
function redirectOf(ctx)
{
    const value = layout.settingFrom({ env: ctx.stripped, projectDir: ctx.project, suffix: 'INSTRUMENT_LOG' });
    return value ? path.resolve(ctx.project, value) : null;
}
// The lines of a JSONL store `keep` takes, streamed; a line that does not parse is counted torn.
function rowsOf(ctx, file, keep)
{
    const kept = [];
    const objs = [];
    let torn = 0;
    eachLine(file, ctx.fs, (text) =>
    {
        if (!text.trim()) return;
        let o;
        try { o = JSON.parse(text); }
        catch { torn += 1; return; }
        if (keep(o)) { kept.push(text); objs.push(o); }
    });
    return { kept, objs, torn };
}
// A shared JSON document the hooks rewrite whole (compact-points, models.json): parsed whole, at most 40 entries.
function readJson(ctx, file)
{
    try { return { value: JSON.parse(ctx.fs.readFileSync(file, 'utf8')) }; }
    catch (e) { return { error: e.message }; }
}
const DAYS_30_MS = 2592000000;
const TRIM_AT = 40;
// A store read whole at collect time: the install's state, never the session's own.
// `name` is the file under <data root>/state/ a whole row reads, for the drift test's name scan.
const wholeRow = (id, source, to, inData = true, name = undefined) => ({
    id, cls: 'meta', match: 'whole', inData, ...(name ? { kind: 'state', name } : {}),
    find: (ctx) =>
    {
        const file = source(ctx);
        return exists(ctx.fs, file) ? { items: [{ to, from: file }], why: 'read at collect time' } : { items: [] };
    },
    held: () => [to],
});
const realProject = (ctx) => realOrSelf(ctx.fs, ctx.project);
// context.json: the catalog variables the project's own files set and where each came from (layout.variablesOf, files
// only), the instrumentation switch they resolve, and the plugins installed for this session - user scope or naming
// this project - from the session's own account. No other key of any settings file is read.
function contextBody(ctx)
{
    const v = variables(ctx);
    const vars = {};
    for (const key of Object.keys(v.values).sort()) vars[key] = { value: v.values[key], from: v.from[key] || '' };
    const plugins = [];
    try
    {
        const doc = JSON.parse(ctx.fs.readFileSync(path.join(ctx.configDir, 'plugins', 'installed_plugins.json'), 'utf8'));
        const project = realProject(ctx);
        for (const id of Object.keys((doc && doc.plugins) || {}).sort())
        {
            for (const e of [].concat(doc.plugins[id] || []))
            {
                if (!e || typeof e !== 'object') continue;
                const mine = e.projectPath && realOrSelf(ctx.fs, String(e.projectPath)) === project;
                if (e.scope !== 'user' && !mine) continue;
                plugins.push({ id, version: e.version || null, scope: e.scope || null, ...(e.projectPath ? { projectPath: String(e.projectPath) } : {}) });
            }
        }
    }
    catch { /* no registry, or not JSON: no plugins named */ }
    const instrument = v.values.ALFRED_CODE_INSTRUMENT ?? null;
    return JSON.stringify({ variables: vars, instrument, plugins }, null, 2) + '\n';
}
const variables = (ctx) =>
{
    if (!ctx.cache.variables) ctx.cache.variables = layout.variablesOf(ctx.project, { env: ctx.stripped, layers: 'files', dataRoot: ctx.dataRootRel });
    return ctx.cache.variables;
};

const APPROVAL_MAX_BYTES = 65536;
const EDGE_STEP = 65536;
const EDGE_MAX = 8388608;

// The first top-level timestamp read forward from a transcript's head, in 64 KB steps up to 8 MB, a line read whole;
// null when none is found inside the budget.
function headTs(fsx, file)
{
    let fd;
    try { fd = fsx.openSync(file, 'r'); }
    catch { return null; }
    try
    {
        const buf = Buffer.alloc(EDGE_STEP);
        let carry = Buffer.alloc(0);
        for (let read = 0; read < EDGE_MAX;)
        {
            const n = fsx.readSync(fd, buf, 0, EDGE_STEP, read);
            if (n <= 0) break;
            read += n;
            let data = Buffer.concat([carry, buf.subarray(0, n)]);
            let nl;
            while ((nl = data.indexOf(10)) !== -1)
            {
                const ms = tsOf(data.subarray(0, nl).toString('utf8'));
                if (ms !== null) return ms;
                data = data.subarray(nl + 1);
            }
            carry = Buffer.from(data);
        }
        return carry.length ? tsOf(carry.toString('utf8')) : null;
    }
    finally { fsx.closeSync(fd); }
}
// The last top-level timestamp read backward from the tail, the same budget.
function tailTs(fsx, file)
{
    let fd;
    let size;
    try { fd = fsx.openSync(file, 'r'); size = fsx.fstatSync(fd).size; }
    catch { if (fd !== undefined) fsx.closeSync(fd); return null; }
    try
    {
        let pos = size;
        let carry = Buffer.alloc(0);
        while (pos > 0 && size - pos < EDGE_MAX)
        {
            const len = Math.min(EDGE_STEP, pos);
            pos -= len;
            const buf = Buffer.alloc(len);
            fsx.readSync(fd, buf, 0, len, pos);
            let data = Buffer.concat([buf, carry]);
            let nl;
            // a lone newline left in `data` closes the line before it: searching from offset -1 would find it again
            while (data.length > 1 && (nl = data.lastIndexOf(10, data.length - 2)) !== -1)
            {
                const ms = tsOf(data.subarray(nl + 1).toString('utf8'));
                if (ms !== null) return ms;
                data = data.subarray(0, nl + 1);
            }
            carry = Buffer.from(data);
            if (pos === 0) return tsOf(carry.toString('utf8'));
        }
        return null;
    }
    finally { fsx.closeSync(fd); }
}
function tsOf(text)
{
    if (!text.trim()) return null;
    try
    {
        const o = JSON.parse(text);
        const ms = o && typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
        return Number.isNaN(ms) ? null : ms;
    }
    catch { return null; }
}
// The other transcripts, in every <config>/projects/* folder, whose span meets the window: only one modified at or after
// the window's start is opened, and only its edges are read; one whose edge finds no timestamp is unread, never 'none'.
function overlapOf(ctx)
{
    let overlap = 0;
    let overlapUnread = 0;
    const projects = path.join(ctx.configDir, 'projects');
    for (const folder of listDir(ctx.fs, projects))
    {
        for (const name of listDir(ctx.fs, path.join(projects, folder)))
        {
            const file = path.join(projects, folder, name);
            if (!name.endsWith('.jsonl') || file === ctx.transcript) continue;
            try { if (ctx.fs.statSync(file).mtimeMs < ctx.window.fromMs) continue; }
            catch { continue; }
            const first = headTs(ctx.fs, file);
            const last = first === null ? null : tailTs(ctx.fs, file);
            if (first === null || last === null) overlapUnread += 1;
            else if (first <= ctx.window.toMs && last >= ctx.window.fromMs) overlap += 1;
        }
    }
    return { overlap, overlapUnread };
}

const HISTORY_KEEP = 200;
const HISTORY_DAYS_MS = 15552000000;

// One row per name prefix under state/sessions/, in the spec's order (4.3). The forge store (ACTS-, REFS-, NOTE-, PAUSE-)
// left with the ref watch (complexity stage 1 B9).
const SESSION_PREFIXES = [
    ['AUTO-RUN-', 'meta'], ['AUTO-TAKEN-', 'meta'], ['AUTO-SAID-', 'meta'], ['AUTO-COMPACT-', 'meta'], ['COMPACT-STATE-', 'meta'], ['twins-', 'meta'],
    ['review-snapshot-', 'meta'], ['trivial-', 'meta'], ['untracked-', 'meta'], ['turn-check-', 'text'],
    ['AGENT-CAP-', 'meta'], ['SCORER-', 'text'], ['preferences-', 'text'], ['rules-', 'meta'],
];
// `dir` is <data root>/state/<kind> of the root that held it, so that data root is the item's source root.
const stateItem = (kind, dir, name) => ({ to: `data/state/${kind}/${name}`, from: path.join(dir, name), root: path.dirname(path.dirname(dir)) });
// The roots a name row searches: the preferences records under the first checkout that holds one (each root's data root,
// in checkoutsOf's order).
function nameRoots(ctx, kind, prefix)
{
    if (kind === 'sessions' && prefix === 'preferences-')
    {
        const roots = rootsFor(ctx, 'preferences');
        const first = roots.find((r) => stateEntries(ctx, 'sessions', r).names.some((n) => n.startsWith(`preferences-${ctx.sid}-`)));
        return [first || ctx.project];
    }
    return [ctx.project];
}
const prefixRow = (kind, prefix, cls) => ({
    id: `${kind}:${prefix}`, cls, match: 'name', kind, prefix, sweeps: true, inData: true,
    find: (ctx) =>
    {
        const items = [];
        const taken = new Set();
        let root;
        for (const at of nameRoots(ctx, kind, prefix))
        {
            const { dir: atDir, names: atNames } = stateEntries(ctx, kind, at);
            for (const n of atNames.filter((x) => x.startsWith(prefix) && holdsSid(ctx, x) && !taken.has(x)))
            {
                taken.add(n);
                items.push(stateItem(kind, atDir, n));
                if (root === undefined) root = otherRoot(ctx, at);
            }
        }
        const { dir, names } = stateEntries(ctx, kind);
        if (!names.length && root === undefined && !items.length) return { items };
        // The untracked pointer names its untracked-at-start record, which is keyed by HEAD and holds no sid
        // (docs-session.js:542-551): the record comes with it, its basename only, from the same folder.
        if (prefix === 'untracked-')
        {
            const pointer = path.join(dir, `untracked-session-${ctx.sid}`);
            let named = '';
            try { named = ctx.fs.readFileSync(pointer, 'utf8').trim(); }
            catch { /* no pointer */ }
            if (named && named === path.basename(named) && named.startsWith('untracked-at-start-') && exists(ctx.fs, path.join(dir, named)))
                items.push(stateItem(kind, dir, named));
        }
        return { items, root };
    },
    held: () => [`data/state/${kind}/${prefix}`],
});
const unlistedRow = (kind, prefixes, skip = []) => ({
    id: `${kind}:unlisted`, cls: 'text', match: 'name', kind, sweeps: true, inData: true,
    find: (ctx) =>
    {
        const { dir, names } = stateEntries(ctx, kind, ctx.project);
        const items = names.filter((x) => holdsSid(ctx, x) && !skip.includes(x) && !prefixes.some((p) => x.startsWith(p))).map((n) => stateItem(kind, dir, n));
        return { items, why: items.length ? 'unlisted prefix' : undefined };
    },
    // What the bundle holds under the same rule, so a file the hook swept since an earlier collect reads kept (R165).
    held: (ctx) => listDir(ctx.fs, path.join(ctx.out, 'data', 'state', kind))
        .filter((x) => holdsSid(ctx, x) && !skip.includes(x) && !prefixes.some((p) => x.startsWith(p)))
        .map((x) => `data/state/${kind}/${x}`),
});

// The hook temp files (spec 4.3): the prefixes every one starts with - the one list the tmp row and the drift test's sweep
// check read - and the names never collected: the V8 compile cache and the machine-wide stop-contract log.
const TMP_PREFIXES = ['alfred-', 'guard-', 'docs-session-'];
const TMP_NEVER = [/^alfred-v8-.*\.bin$/, /^guard-stop-contract\.log$/];
// A path's place under the docs root, posix: lexically under it, else under its real path (a transcript naming
// /private/var for a /var root); null when outside.
function docsRel(ctx, abs)
{
    const under = (file, root) =>
    {
        const rel = path.relative(root, file);
        return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? toPosix(rel) : null;
    };
    const lexical = under(abs, ctx.docsRoot);
    if (lexical !== null) return lexical;
    const real = under(realOrSelf(ctx.fs, abs), realOrSelf(ctx.fs, ctx.docsRoot));
    return real;
}

const STORES = [
    {
        id: 'transcript', cls: 'text', match: 'folder',
        find: (ctx) => ({ items: [{ to: `${ctx.sid}.jsonl`, from: ctx.transcript }] }),
        held: (ctx) => [`${ctx.sid}.jsonl`],
    },
    {
        id: 'subagents', cls: 'text', match: 'folder',
        find: (ctx) =>
        {
            const dir = path.join(sidDir(ctx), 'subagents');
            return { items: isDir(ctx.fs, dir) ? [{ to: 'subagents', from: dir }] : [] };
        },
        held: () => ['subagents'],
    },
    {
        // The rest of the transcript's <sid>/ folder (tool-results/, custom-title.json, and whatever Claude Code adds
        // there next), entry for entry, so a new entry is collected without a row (spec 4.3, layer 4).
        id: 'session-folder', cls: 'text', match: 'folder',
        find: (ctx) => ({
            items: listDir(ctx.fs, sidDir(ctx)).filter((name) => name !== 'subagents')
                .map((name) => ({ to: name, from: path.join(sidDir(ctx), name) })),
        }),
        held: (ctx) => listDir(ctx.fs, sidDir(ctx)).filter((name) => name !== 'subagents'),
    },
    {
        id: 'hook-blocks', cls: 'meta', match: 'name', kind: 'statistics', name: 'hook-blocks', inData: true, ledger: true,
        find: (ctx) =>
        {
            const got = ledger(ctx, 'hook-blocks', `${ctx.sid}.jsonl`);
            return got ? { items: [got.item], why: got.legacy ? 'legacy home' : undefined, legacy: got.legacy } : { items: [] };
        },
        held: (ctx) => [`data/statistics/hook-blocks/${ctx.sid}.jsonl`, `hook-blocks-${ctx.sid}.jsonl`],
    },
    {
        id: 'tools-usage', cls: 'meta', match: 'name', kind: 'statistics', name: 'tools-usage', inData: true, ledger: true,
        find: (ctx) =>
        {
            const to = `data/statistics/tools-usage/${ctx.sid}.jsonl`;
            const redirect = redirectOf(ctx);
            if (redirect)
            {
                if (!exists(ctx.fs, redirect)) return { items: [], matched: 'redirect', why: `not written (redirected to ${redirect})` };
                const { kept, torn } = rowsOf(ctx, redirect, (o) => o && o.session === ctx.sid);
                if (!kept.length) return { items: [], matched: 'redirect', why: 'not written' };
                return { items: [{ to, body: kept.join('\n') + '\n', rows: kept.length }], filtered: true, matched: 'redirect', torn: torn || undefined, redirect };
            }
            const items = [];
            let legacy = false;
            const main = ledger(ctx, 'tools-usage', `${ctx.sid}.jsonl`);
            if (main) { items.push(main.item); legacy = main.legacy; }
            // An older writer keyed a seat's rows by its agent id; read when there, never relied on.
            for (const name of listDir(ctx.fs, path.join(sidDir(ctx), 'subagents')))
            {
                const m = /^agent-(.+)\.jsonl$/.exec(name);
                const got = m ? ledger(ctx, 'tools-usage', `${m[1]}.jsonl`) : null;
                if (got) items.push(got.item);
            }
            if (items.length) return { items, why: legacy ? 'legacy home' : undefined, legacy };
            const on = String(variables(ctx).values.ALFRED_CODE_INSTRUMENT || '').trim() === '1';
            return { items, why: on ? 'not written' : 'instrumentation off' };
        },
        held: (ctx) => [`data/statistics/tools-usage/${ctx.sid}.jsonl`, `tool-usage-${ctx.sid}.jsonl`],
    },
    {
        id: 'history', cls: 'text', match: 'name', kind: 'history', inData: true, prunes: true,
        find: (ctx) =>
        {
            const file = layout.findState(ctx.project, 'history', `${ctx.sid}.json`, ctx.env);
            if (exists(ctx.fs, file)) return { items: [{ to: `data/state/history/${ctx.sid}.json`, from: file }] };
            // history-session.js:89 keeps the 200 newest records and 180 days (history.js:322-325, by mtime).
            if (ctx.now - ctx.lastMs > HISTORY_DAYS_MS) return { items: [], why: 'pruned' };
            const dir = path.dirname(file);
            let newer = 0;
            for (const name of listDir(ctx.fs, dir))
            {
                if (!name.endsWith('.json')) continue;
                try { if (ctx.fs.statSync(path.join(dir, name)).mtimeMs > ctx.lastMs) newer += 1; }
                catch { /* gone meanwhile */ }
            }
            return { items: [], why: newer >= HISTORY_KEEP ? 'pruned' : 'not written' };
        },
        held: (ctx) => [`data/state/history/${ctx.sid}.json`],
    },
    {
        id: 'scorer', cls: 'text', match: 'name', kind: 'sessions', name: 'scorer', sweeps: true, inData: true,
        find: (ctx) =>
        {
            const dir = path.join(layout.statePath(ctx.project, 'sessions', 'scorer', ctx.env), ctx.sid);
            return { items: isDir(ctx.fs, dir) ? [dataItem(ctx, dir)] : [] };
        },
        held: (ctx) => [`data/state/sessions/scorer/${ctx.sid}`],
    },
    ...SESSION_PREFIXES.map(([prefix, cls]) => prefixRow('sessions', prefix, cls)),
    unlistedRow('sessions', SESSION_PREFIXES.map(([p]) => p), ['scorer']),
    {
        // session-status.js writes <cwd>/.claude/session-inspector/status/<sid>.json for session-inspector.
        id: 'session-inspector', cls: 'meta', match: 'name',
        find: (ctx) =>
        {
            const file = path.join(ctx.project, '.claude', 'session-inspector', 'status', `${ctx.sid}.json`);
            const to = 'context/session-inspector-status.json';
            if (!exists(ctx.fs, file)) return { items: [] };
            if ((ctx.opts || {}).text !== 'withhold') return { items: [{ to, from: file }] };
            // A meta store kept under withhold, but its handoffPrompt quotes the open plan's Resume: line - conversation
            // text, so the withheld copy carries it as null (R168).
            const { value, error } = readJson(ctx, file);
            if (error || !value || typeof value !== 'object' || Array.isArray(value)) return { items: [], status: 'unreadable', why: error || 'not a JSON object' };
            const kept = Object.hasOwn(value, 'handoffPrompt') ? { ...value, handoffPrompt: null } : value;
            return { items: [{ to, body: JSON.stringify(kept, null, 1) + '\n' }] };
        },
        held: () => ['context/session-inspector-status.json'],
    },
    {
        // A receipt the user's yes wrote names its session on a `session: <id>` line (readReceiptFile's rule).
        id: 'approvals', cls: 'text', match: 'content', kind: 'approvals', inData: true,
        find: (ctx) =>
        {
            const dir = layout.statePath(ctx.project, 'approvals', '', ctx.env);
            const line = new RegExp(`^session:\\s*${ctx.sid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
            const items = [];
            const walk = (at) =>
            {
                for (const name of listDir(ctx.fs, at))
                {
                    const full = path.join(at, name);
                    let st;
                    try { st = ctx.fs.lstatSync(full); }
                    catch { continue; }
                    if (st.isDirectory()) walk(full);
                    else if (st.isFile() && st.size <= APPROVAL_MAX_BYTES)
                    {
                        let text = '';
                        try { text = ctx.fs.readFileSync(full, 'utf8'); }
                        catch { continue; }
                        if (line.test(text)) items.push({ to: `data/state/approvals/${toPosix(path.relative(dir, full))}`, from: full, root: ctx.dataRoot });
                    }
                }
            };
            walk(dir);
            return { items, matched: 'content' };
        },
        held: () => ['data/state/approvals/'],
    },
    {
        // The one store that carries no session id: rows whose `at` falls in the session's window, from the project's
        // data root and the main checkout's (handoff.js storeDir), with the count of other transcripts whose span meets
        // the window - a linked worktree's session shares the store from another projects/ folder.
        id: 'handoff', cls: 'text', match: 'window', kind: 'handoff', inData: true,
        find: (ctx) =>
        {
            const items = [];
            const taken = new Set();
            let root;
            let files = 0;
            for (const at of rootsFor(ctx, 'handoff'))
            {
                const dir = layout.statePath(at, 'handoff', '', ctx.env);
                for (const name of listDir(ctx.fs, dir).filter((n) => n.endsWith('.jsonl') && !taken.has(n)))
                {
                    taken.add(name);
                    files += 1;
                    const { kept } = rowsOf(ctx, path.join(dir, name), (o) =>
                    {
                        const ms = o && typeof o.at === 'string' ? Date.parse(o.at) : NaN;
                        return ms >= ctx.window.fromMs && ms <= ctx.window.toMs;
                    });
                    if (!kept.length) continue;
                    items.push({ to: `data/state/handoff/${name}`, body: kept.join('\n') + '\n', rows: kept.length });
                    if (root === undefined) root = otherRoot(ctx, at);
                }
            }
            if (!files) return { items };
            const { overlap, overlapUnread } = overlapOf(ctx);
            return { items, filtered: true, matched: 'window', overlap, overlapUnread: overlapUnread || undefined, root };
        },
        held: () => ['data/state/handoff/'],
    },
    {
        // statistics/docs-log.jsonl - one file for every session, unbounded: streamed, this session's rows kept.
        id: 'docs-log', cls: 'meta', match: 'row', kind: 'statistics', name: 'docs-log.jsonl', inData: true,
        find: (ctx) =>
        {
            const file = layout.findStats(ctx.project, ['docs-log.jsonl'], ctx.env);
            if (!exists(ctx.fs, file)) return { items: [] };
            const { kept, objs, torn } = rowsOf(ctx, file, (o) => o && o.session === ctx.sid);
            ctx.cache.docsLog = objs;
            if (!kept.length) return { items: [], torn };
            return { items: [{ to: 'data/statistics/docs-log.jsonl', body: kept.join('\n') + '\n', rows: kept.length }], filtered: true, matched: 'row', torn };
        },
        held: () => ['data/statistics/docs-log.jsonl'],
    },
    {
        // fresh-session.js:304-318 - the newest 40 compactions, 30 days, none under 50,000 tokens.
        id: 'compact-points', cls: 'meta', match: 'row', kind: 'sessions', name: 'compact-points.json', inData: true,
        find: (ctx) =>
        {
            const file = layout.statePath(ctx.project, 'sessions', 'compact-points.json', ctx.env);
            if (!exists(ctx.fs, file)) return { items: [] };
            const { value, error } = readJson(ctx, file);
            if (error || !Array.isArray(value)) return { items: [], status: 'unreadable', why: error || 'not a JSON array' };
            const kept = value.filter((r) => r && r.session === ctx.sid);
            if (kept.length) return { items: [{ to: 'data/state/sessions/compact-points.json', body: JSON.stringify(kept, null, 1) + '\n', rows: kept.length }], filtered: true, matched: 'row' };
            if (ctx.now - ctx.lastMs > DAYS_30_MS) return { items: [], why: 'aged out' };
            return { items: [], why: value.length >= TRIM_AT ? 'trimmed' : undefined };
        },
        held: () => ['data/state/sessions/compact-points.json'],
    },
    {
        // fresh-session.js:160-174 - { [sid]: { model, at } }, the newest 40 sessions.
        id: 'models', cls: 'meta', match: 'row', kind: 'sessions', name: 'models.json', inData: true,
        find: (ctx) =>
        {
            const file = layout.statePath(ctx.project, 'sessions', 'models.json', ctx.env);
            if (!exists(ctx.fs, file)) return { items: [] };
            const { value, error } = readJson(ctx, file);
            if (error || !value || typeof value !== 'object' || Array.isArray(value)) return { items: [], status: 'unreadable', why: error || 'not a JSON object' };
            if (Object.hasOwn(value, ctx.sid))
                return { items: [{ to: 'data/state/sessions/models.json', body: JSON.stringify({ [ctx.sid]: value[ctx.sid] }, null, 1) + '\n', rows: 1 }], filtered: true, matched: 'row' };
            return { items: [], why: Object.keys(value).length >= TRIM_AT ? 'trimmed' : undefined };
        },
        held: () => ['data/state/sessions/models.json'],
    },
    wholeRow('stamp', (ctx) => path.join(ctx.project, '.claude', 'alfred-code.stamp'), 'context/alfred-code.stamp', false),
    {
        // workspace.json under its own name, else the old line file a release before 3.10 wrote (spec: the workspace.json design)
        id: 'workspace', cls: 'meta', match: 'whole', inData: true,
        find: (ctx) =>
        {
            const name = ['workspace.json', 'workspace'].find((n) => exists(ctx.fs, path.join(ctx.dataRoot, n)));
            return name ? { items: [{ to: `context/${name}`, from: path.join(ctx.dataRoot, name) }], why: 'read at collect time' } : { items: [] };
        },
        held: () => ['context/workspace.json', 'context/workspace'],
    },
    wholeRow('tools-inventory', (ctx) => path.join(ctx.dataRoot, 'state', 'tools-inventory.json'), 'data/state/tools-inventory.json', true, 'tools-inventory.json'),
    wholeRow('lsp-coverage', (ctx) => path.join(ctx.dataRoot, 'state', 'lsp-coverage.json'), 'data/state/lsp-coverage.json', true, 'lsp-coverage.json'),
    wholeRow('workspace-check', (ctx) => path.join(ctx.dataRoot, 'state', 'workspace-check.json'), 'data/state/workspace-check.json', true, 'workspace-check.json'),
    {
        id: 'context', cls: 'meta', match: 'whole',
        find: (ctx) => ({ items: [{ to: 'context.json', body: contextBody(ctx) }] }),
        held: () => ['context.json'],
    },
    {
        // Every docs-root path the session's Write / Edit / MultiEdit / NotebookEdit calls name, and every one its
        // docs-log rows name (`target`, `files`, `refs`, and the docs engine's `wrote` and `file`, project-relative), as
        // they are NOW.
        id: 'docs', cls: 'text', match: 'docs', content: true, caps: true,
        find: (ctx) =>
        {
            const found = new Map();
            const add = (p) =>
            {
                if (typeof p !== 'string' || !p) return;
                const abs = path.resolve(ctx.project, p);
                const rel = docsRel(ctx, abs);
                if (rel === null || found.has(rel)) return;
                try { if (ctx.fs.lstatSync(abs).isDirectory()) return; }
                catch { return; }
                found.set(rel, abs);
            };
            for (const w of ctx.written) add(w);
            for (const o of ctx.cache.docsLog || [])
            {
                if (!o || typeof o !== 'object') continue;
                add(o.target);
                for (const f of [].concat(o.files || [], o.refs || [], o.wrote || [], o.file || [])) add(f);
            }
            const items = [...found.keys()].sort().map((rel) => ({ to: `docs/${rel}`, from: found.get(rel), root: ctx.docsRoot }));
            return { items, matched: 'docs', why: items.length ? 'read at collect time' : undefined };
        },
        held: () => ['docs/'],
    },
    {
        // A hook temp file directly in a searched dir, named by one of the prefixes and holding the sid, or the sid
        // with every non-alphanumeric as '_' (guard-fresh-session-start.js:171 keys its files by the transcript path).
        id: 'tmp', cls: 'text', match: 'tmp', sweeps: true, content: true, prefixes: TMP_PREFIXES,
        find: (ctx) =>
        {
            const keyed = ctx.sid.replace(/[^A-Za-z0-9]/g, '_');
            const items = [];
            const taken = new Set();
            for (const dir of ctx.tmpDirs)
            {
                for (const name of listDir(ctx.fs, dir))
                {
                    if (taken.has(name) || !TMP_PREFIXES.some((p) => name.startsWith(p))) continue;
                    if (!name.includes(ctx.sid) && !name.includes(keyed)) continue;
                    if (TMP_NEVER.some((re) => re.test(name))) continue;
                    try { if (ctx.fs.lstatSync(path.join(dir, name)).isDirectory()) continue; }
                    catch { continue; }
                    taken.add(name);
                    items.push({ to: `tmp/${name}`, from: path.join(dir, name), root: dir });
                }
            }
            if (items.length) return { items, matched: 'tmp' };
            return { items, matched: 'tmp', why: `no temp file in ${ctx.tmpDirs.join(', ')} - hooks write to their own process's temp dir; pass --tmp <dir>` };
        },
        held: () => ['tmp/'],
    },
];

module.exports = { STORES, TMP_PREFIXES, CHUNK, eachLine, toPosix, isDir, listDir, sidDir, exists, rowsOf, dataItem, stateEntries, requireQuiet, headTs, tailTs, SESSION_PREFIXES };
