// THE DRIFT TEST (the usage-collector design of 2026-11-04, its store table): every store the hooks write
// about a session has a STORES row in scripts/collect-stores.js, so a new store reaches the audit bundle or turns this
// red. Four layers: the state kinds, the names passed to the path helpers, the prefixes built away from them (pinned),
// and the prefixes the hooks sweep. The scan reads source as tokens - comments, regex literals and template
// substitutions skipped - so prose naming a helper is never a store.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { STORES } = require('./collect-stores.js');

const REPO = path.resolve(__dirname, '..');
const REAL_ROOTS = ['stack', 'setup-plugin', path.join('scripts', 'install')];

// ---- the tokenizer -----------------------------------------------------------------------------------------------

const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);
// A template literal from its opening backtick: { end, head } - head is its text before the first `${`.
function readTemplate(src, i)
{
    let j = i + 1;
    let head = '';
    let inHead = true;
    while (j < src.length)
    {
        const c = src[j];
        if (c === '\\') { if (inHead) head += src[j + 1]; j += 2; continue; }
        if (c === '`') return { end: j + 1, head };
        if (c === '$' && src[j + 1] === '{') { inHead = false; j = skipCode(src, j + 2); continue; }
        if (inHead) head += c;
        j += 1;
    }
    return { end: j, head };
}
// Code inside `${ ... }` up to its closing brace; strings and nested templates are skipped whole.
function skipCode(src, j)
{
    let depth = 1;
    while (j < src.length)
    {
        const c = src[j];
        if (c === '\'' || c === '"') { j = skipString(src, j).end; continue; }
        if (c === '`') { j = readTemplate(src, j).end; continue; }
        if (c === '{') depth += 1;
        else if (c === '}' && (depth -= 1) === 0) return j + 1;
        j += 1;
    }
    return j;
}
function skipString(src, i)
{
    const q = src[i];
    let j = i + 1;
    let value = '';
    while (j < src.length && src[j] !== q && src[j] !== '\n')
    {
        if (src[j] === '\\') { value += src[j + 1]; j += 2; continue; }
        value += src[j];
        j += 1;
    }
    return { end: j + 1, value };
}
// The tokens of one source file: { type: 'str'|'tpl'|'regex'|'word'|'num'|'punct', value, at }.
function tokenize(src)
{
    const out = [];
    let i = 0;
    const prev = () => out[out.length - 1];
    const regexAllowed = () =>
    {
        const p = prev();
        if (!p) return true;
        if (p.type === 'word') return REGEX_AFTER_WORD.has(p.value);
        if (p.type === 'punct') return !')]}'.includes(p.value);
        return false;
    };
    while (i < src.length)
    {
        const c = src[i];
        if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
        if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
        if (/\s/.test(c)) { i += 1; continue; }
        if (c === '\'' || c === '"') { const s = skipString(src, i); out.push({ type: 'str', value: s.value, at: i }); i = s.end; continue; }
        if (c === '`') { const t = readTemplate(src, i); out.push({ type: 'tpl', value: t.head, at: i }); i = t.end; continue; }
        if (c === '/' && regexAllowed())
        {
            let j = i + 1;
            let inClass = false;
            while (j < src.length && src[j] !== '\n')
            {
                if (src[j] === '\\') { j += 2; continue; }
                if (src[j] === '[') inClass = true;
                else if (src[j] === ']') inClass = false;
                else if (src[j] === '/' && !inClass) break;
                j += 1;
            }
            j += 1;
            while (j < src.length && /[a-z]/i.test(src[j])) j += 1;
            out.push({ type: 'regex', value: '', at: i });
            i = j;
            continue;
        }
        if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < src.length && /[\w$]/.test(src[j])) j += 1; out.push({ type: 'word', value: src.slice(i, j), at: i }); i = j; continue; }
        if (/\d/.test(c)) { let j = i; while (j < src.length && /[\w.]/.test(src[j])) j += 1; out.push({ type: 'num', value: src.slice(i, j), at: i }); i = j; continue; }
        out.push({ type: 'punct', value: c, at: i });
        i += 1;
    }
    return out;
}

// The arguments of the call whose '(' is tokens[open]: an array of token lists, split at top-level commas.
function callArgs(tokens, open)
{
    const args = [[]];
    let depth = 0;
    for (let k = open + 1; k < tokens.length; k++)
    {
        const t = tokens[k];
        if (t.type === 'punct' && '([{'.includes(t.value)) depth += 1;
        if (t.type === 'punct' && ')]}'.includes(t.value))
        {
            if (depth === 0) return args;
            depth -= 1;
        }
        if (t.type === 'punct' && t.value === ',' && depth === 0) { args.push([]); continue; }
        args[args.length - 1].push(t);
    }
    return args;
}
// A literal argument's value - a string whole, a template by its head - else null.
const literal = (arg) => (arg && arg.length === 1 && (arg[0].type === 'str' || arg[0].type === 'tpl') ? arg[0].value : null);
// The first element of an array literal argument.
function firstElement(arg)
{
    if (!arg || !arg.length || arg[0].type !== 'punct' || arg[0].value !== '[') return null;
    const inner = callArgs(arg, 0)[0];
    return literal(inner);
}
// True when the call at tokens[k] is the argument of a `<x>.dirname(` - a folder probe, not a store.
function inDirname(tokens, k)
{
    let b = k - 1;
    if (tokens[b] && tokens[b].value === '.' && tokens[b - 1] && tokens[b - 1].type === 'word') b -= 2;
    return !!(tokens[b] && tokens[b].value === '(' && tokens[b - 1] && tokens[b - 1].value === 'dirname');
}

// ---- the scan ----------------------------------------------------------------------------------------------------

function sourceFiles(roots)
{
    const files = [];
    const walk = (dir) =>
    {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries)
        {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full); }
            else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) files.push(full);
        }
    };
    for (const r of roots) walk(r);
    return files.sort();
}

const STATE_KINDS = (() =>
{
    const src = fs.readFileSync(path.join(REPO, 'stack', 'hooks', 'layout.js'), 'utf8');
    const m = /const STATE_KINDS = new Set\(\[([^\]]*)\]\)/.exec(src);
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
})();

// The helpers whose arguments name a store: [kind arg index or a fixed kind, name arg index, name is an array's first].
const HELPERS = {
    statePath: { kindAt: 1, nameAt: 2 },
    findState: { kindAt: 1, nameAt: 2 },
    statsPath: { kind: 'statistics', nameAt: 1, array: true },
    findStats: { kind: 'statistics', nameAt: 1, array: true },
    stateFile: { kind: 'forge', nameAt: 1 },
    scorerPath: { kind: 'sessions', nameAt: 1 },
};
// Names that hold no session, each with its reason.
const DRIFT_EXEMPT = {
    'REFS-LAST.json': 'forge - one per repository, no session',
    'SSH-NOTICE.json': 'forge - one per repository, no session',
    'status-folders.json': 'no per-session data',
    'tool-preferences': 'capture-preferences\' marker (tools.js)',
    'workspace-mcp.json': 'retired, removed by the installer (workspace.js)',
    'usage-report': 'the bundle home (spec 4.3, Not collected)',
    migrations: 'installer state, no session (scripts/install/docs.js)',
    statistics: 'a folder list under state (docs-session.js)',
};

// A name of a kind matches a row of that kind: by prefix (either way), one of its prefixes, or its name; a row taking a
// whole kind (approvals, history, handoff) matches every name of it.
const WHOLE_KINDS = new Set(['approvals', 'history', 'handoff']);
function matches(kind, name, rows = STORES)
{
    return rows.some((r) =>
    {
        if (r.kind !== kind) return false;
        if (WHOLE_KINDS.has(kind)) return true;
        if (r.prefix && (name.startsWith(r.prefix) || r.prefix.startsWith(name))) return true;
        if ((r.prefixes || []).some((p) => name.startsWith(p))) return true;
        return r.name === name;
    });
}

// Every (kind, name) the sources hand to the path helpers or spell as a 'state' / 'statistics' literal pair.
function names(roots)
{
    const found = [];
    for (const file of sourceFiles(roots))
    {
        const tokens = tokenize(fs.readFileSync(file, 'utf8'));
        for (let k = 0; k < tokens.length - 1; k++)
        {
            const t = tokens[k];
            const h = t.type === 'word' && Object.hasOwn(HELPERS, t.value) ? HELPERS[t.value] : null;
            if (h && tokens[k + 1].value === '(' && !(tokens[k - 1] && tokens[k - 1].value === 'function'))
            {
                if (inDirname(tokens, k)) continue;
                const args = callArgs(tokens, k + 1);
                const kind = h.kind || literal(args[h.kindAt]);
                const name = h.array ? firstElement(args[h.nameAt]) : literal(args[h.nameAt]);
                if (kind && name) found.push({ kind, name, file });
                continue;
            }
            if (t.type === 'str' && (t.value === 'state' || t.value === 'statistics') && tokens[k + 1].value === ','
                && tokens[k + 2] && (tokens[k + 2].type === 'str' || tokens[k + 2].type === 'tpl'))
            {
                const name = tokens[k + 2].value;
                if (!name || (t.value === 'state' && STATE_KINDS.includes(name))) continue;
                found.push({ kind: t.value, name, file });
            }
        }
    }
    return found;
}
// The (kind:name) pairs that match no row and no exemption.
function scan(roots)
{
    const out = new Set();
    for (const { kind, name } of names(roots))
    {
        if (Object.hasOwn(DRIFT_EXEMPT, name) || matches(kind, name)) continue;
        out.add(`${kind}:${name}`);
    }
    return [...out].sort();
}

// Prefixes built away from the helpers: each must still appear in its writer and have a row.
const PINNED = {
    'COMPACT-STATE-': 'guard-fresh-session-start.js',
    'AUTO-TAKEN-': 'guard-fresh-session-start.js',
    'turn-check-': 'check-turn-build.js',
    'AGENT-CAP-': 'agent-cap.js',
    'review-snapshot-': 'hook-prelude.js',
    'untracked-': 'docs-session.js',
    'untracked-at-start-': 'docs-session.js',
    'preferences-': 'preferences-session.js',
};
function pinned(prefix, hooksDir = path.join(REPO, 'stack', 'hooks'))
{
    const problems = [];
    let text = '';
    try { text = fs.readFileSync(path.join(hooksDir, PINNED[prefix]), 'utf8'); }
    catch { problems.push(`${PINNED[prefix]} not found`); }
    if (!text.includes(prefix)) problems.push(`${prefix} missing from ${PINNED[prefix]}`);
    if (!matches('sessions', prefix)) problems.push(`${prefix} has no row`);
    return problems;
}

// The prefixes the hooks sweep (sweepStale's prefix argument: a string, both arms of a ternary, or the literal array a
// loop walks) and the history prunes - each must map to a row that carries `sweeps` / `prunes`.
function swept(roots)
{
    const problems = [];
    const sweeps = STORES.filter((r) => r.sweeps);
    const sweepMatch = (p) => sweeps.some((r) => (r.prefix && (p.startsWith(r.prefix) || r.prefix.startsWith(p)))
        || (r.prefixes || []).some((x) => p.startsWith(x)));
    for (const file of sourceFiles(roots))
    {
        const tokens = tokenize(fs.readFileSync(file, 'utf8'));
        for (let k = 0; k < tokens.length - 1; k++)
        {
            const t = tokens[k];
            if (t.type !== 'word' || tokens[k + 1].value !== '(' || (tokens[k - 1] && tokens[k - 1].value === 'function')) continue;
            const args = callArgs(tokens, k + 1);
            if (t.value === 'sweepStale')
            {
                const arg = args[1] || [];
                let values = arg.filter((x) => x.type === 'str' || x.type === 'tpl').map((x) => x.value);
                if (!values.length && arg.length === 1 && arg[0].type === 'word') values = loopValues(tokens, k, arg[0].value);
                for (const v of values) if (!sweepMatch(v)) problems.push(`sweepStale '${v}' (${path.basename(file)}) maps to no row with sweeps`);
            }
            else if (t.value === 'sweepScorerFolders' && !STORES.some((r) => r.name === 'scorer' && r.sweeps))
                problems.push(`sweepScorerFolders (${path.basename(file)}) maps to no scorer row with sweeps`);
            else if (t.value === 'prune' && (args[0] || []).some((x) => x.value === 'historyDir') && !STORES.some((r) => r.kind === 'history' && r.prunes))
                problems.push(`prune of the history dir (${path.basename(file)}) maps to no history row with prunes`);
        }
    }
    return problems;
}
// The strings of `for (const <name> of [ ... ])` within the 60 tokens before tokens[k].
function loopValues(tokens, k, name)
{
    for (let b = k - 1; b >= Math.max(0, k - 60); b--)
    {
        if (tokens[b].value === name && tokens[b + 1] && tokens[b + 1].value === 'of' && tokens[b + 2] && tokens[b + 2].value === '[')
        {
            const values = [];
            for (let j = b + 3; j < tokens.length && tokens[j].value !== ']'; j++) if (tokens[j].type === 'str') values.push(tokens[j].value);
            return values;
        }
    }
    return [];
}

// A copy of the scanned trees under a temp root, for the planted cases.
function copyRoots(t)
{
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'collect-drift-'));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    for (const file of sourceFiles(REAL_ROOTS.map((r) => path.join(REPO, r))))
    {
        const to = path.join(tmp, path.relative(REPO, file));
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(file, to);
    }
    return tmp;
}
const rootsUnder = (base) => REAL_ROOTS.map((r) => path.join(base, r));

// ---- the tests ---------------------------------------------------------------------------------------------------

test('the tokenizer skips comments, regex literals and template substitutions', () =>
{
    const src = [
        '// statePath(root, \'sessions\', \'IN-A-COMMENT\')',
        'const re = /statePath\\(x, \'y\'/g; /* findState(r, \'sessions\', \'BLOCK\') */',
        'const s = `${statePath(root, \'sessions\', \'IN-A-SUB\')}`;',
        'const p = statePath(root, \'sessions\', `AUTO-RUN-${sid}`, env);',
        'const d = path.dirname(layout.statePath(root, \'history\', \'x.json\'));',
    ].join('\n');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collect-drift-tok-'));
    try
    {
        fs.writeFileSync(path.join(dir, 'a.js'), src);
        assert.deepStrictEqual(names([dir]).map((n) => `${n.kind}:${n.name}`), ['sessions:AUTO-RUN-']);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('every state kind has a STORES row', () =>
{
    assert.ok(STATE_KINDS.length >= 5, `read ${STATE_KINDS.length} kinds from layout.js`);
    for (const kind of STATE_KINDS) assert.ok(STORES.some((r) => r.kind === kind), `no row of kind ${kind}`);
});

test('every name passed to the path helpers is a row or an exemption', () =>
{
    const roots = rootsUnder(REPO);
    const seen = new Set(names(roots).map((n) => `${n.kind}:${n.name}`));
    for (const known of ['sessions:AUTO-RUN-', 'sessions:twins-', 'sessions:trivial-', 'sessions:scorer', 'sessions:models.json',
        'forge:REFS-', 'forge:PAUSE-', 'statistics:hook-blocks', 'statistics:docs-log.jsonl', 'approvals:APPROVAL'])
        assert.ok(seen.has(known), `the scan reads ${known}`);
    assert.deepStrictEqual(scan(roots), []);
});

test('a planted statePath(root, \'sessions\', \'NEW-STORE\') turns the scan red', (t) =>
{
    const tmp = copyRoots(t);
    fs.appendFileSync(path.join(tmp, 'stack', 'hooks', 'agent-cap.js'), '\nfunction planted(root) { return layout.statePath(root, \'sessions\', \'NEW-STORE\'); }\n');
    assert.deepStrictEqual(scan(rootsUnder(tmp)), ['sessions:NEW-STORE']);
});

test('a renamed pinned prefix turns the test red', (t) =>
{
    for (const prefix of Object.keys(PINNED)) assert.deepStrictEqual(pinned(prefix), [], prefix);
    const tmp = copyRoots(t);
    const file = path.join(tmp, 'stack', 'hooks', 'agent-cap.js');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('AGENT-CAP-').join('AGENT-LIMIT-'));
    assert.deepStrictEqual(pinned('AGENT-CAP-', path.join(tmp, 'stack', 'hooks')), ['AGENT-CAP- missing from agent-cap.js']);
});

test('every prefix the hooks sweep maps to a row that carries sweeps', (t) =>
{
    assert.deepStrictEqual(swept(rootsUnder(REPO)), []);
    // The temp-dir prefixes map to the tmp row through its prefixes.
    const tmpRow = STORES.find((r) => r.id === 'tmp');
    for (const p of ['guard-read-', 'guard-stop-', 'alfred-stop-held-', 'guard-fresh-', 'guard-fresh-verdict-', 'alfred-bg-note-', 'alfred-docs-unattended-', 'alfred-code-preferences-'])
        assert.ok(tmpRow.prefixes.some((x) => p.startsWith(x)), p);
    assert.ok(STORES.find((r) => r.id === 'sessions:untracked-').sweeps, 'docs-session sweeps its own untracked records');
    const tmp = copyRoots(t);
    fs.appendFileSync(path.join(tmp, 'stack', 'hooks', 'agent-cap.js'), '\nfunction planted(dir) { sweepStale(dir, \'NEWSWEEP-\'); }\n');
    assert.deepStrictEqual(swept(rootsUnder(tmp)), ['sweepStale \'NEWSWEEP-\' (agent-cap.js) maps to no row with sweeps']);
});
