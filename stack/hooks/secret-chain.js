'use strict';
// secret-chain.js - the workspace chain's secret stores, read, merged and masked in ONE place (workspace layering,
// release 2). A joined child sees each linked ancestor's store after its own: the nearest value of a key wins, and a key
// an `ignore secret <KEY>` line at or below a member names is dropped from that member up (the project's own store is
// never filtered). The secret guard's --with-sensitive and secrets-run.js read the values through here; the guard's
// denies list every store through storesOf(..., { forDeny: true }), which walks the chain whatever the kill switch says.
// An engine (HOOK_ENGINES): only Node's own modules and ./layout.js beside it.
const fs = require('fs');
const path = require('path');
const layout = require('./layout.js');

// The two names of a project's store, `.secrets` first (secret-file-names in meta/shared-rules.json).
const SECRET_FILES = Object.freeze(['.secrets', '.sensitive-data']);

// The guard's dotenv reader, copied: guard-sensitive-data.test.js holds the guard, data-root.js and this to one fixture.
const DOTENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const unquote = (v) => v.trim().replace(/^(["'])(.*)\1$/, '$2');
const LINES = /\r?\n/;
const COMMENT_LINE = /^\s*(?:[#;]|$)/;
const swap16 = (buf) => Buffer.from(buf.subarray(0, buf.length - (buf.length % 2))).swap16();
// A store is text in the encoding its writer chose: a BOM decides it; without one, NUL bytes on every other position of
// the first 64 bytes and none on the rest decide UTF-16.
function readText(file)
{
    const buf = fs.readFileSync(file);
    if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
    if (buf[0] === 0xfe && buf[1] === 0xff) return swap16(buf.subarray(2)).toString('utf16le');
    const head = buf.subarray(0, 64);
    if (head.length >= 4)
    {
        let even = 0;
        let odd = 0;
        for (let i = 0; i < head.length; i++) if (head[i] === 0) { if (i % 2) odd++; else even++; }
        const half = head.length >> 1;
        if (even === 0 && odd >= half * 0.9) return buf.toString('utf16le');
        if (odd === 0 && even >= half * 0.9) return swap16(buf).toString('utf16le');
    }
    return buf.toString('utf8').replace(/^\uFEFF/, '');
}
// { KEY: value } of one store; {} when it cannot be read.
function readStore(file)
{
    const out = {};
    let text = '';
    try { text = readText(file); } catch { return out; }
    for (const line of text.split(LINES))
    {
        const m = line.match(DOTENV_LINE);
        if (m && !COMMENT_LINE.test(line)) out[m[1]] = unquote(m[2]);
    }
    return out;
}

const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
// The native realpath first, as layout.js's workspace chain takes it: the JS one keeps a Windows 8.3 short name
// (`RUNNER~1`) the chain's members never carry, and a store compared in two spellings matched nothing.
const realOf = (f) => { try { return fs.realpathSync.native(f); } catch { try { return fs.realpathSync(f); } catch { return path.resolve(f); } } };
// The store files at one place: the first that exists, or with `all` every one of both names.
function filesAt(place, dataRoot, all)
{
    const found = SECRET_FILES.map((name) => path.join(place, ...dataRoot.split('/'), name)).filter(isFile);
    return all ? found : found.slice(0, 1);
}

// Every store the chain holds, nearest first: [{ file, root, rel, real, skip }]. The project's own first - its checkout,
// then the main worktree (a gitignored store a new worktree lacks), as the guard's sensitiveFile - then each linked
// member's at its own data root. `skip` is the set of keys an `ignore secret` line held by the project or by a member
// nearer than this one drops. Under the kill switch the chain is the project alone, unless `forDeny`.
function storesOf(start, { env = process.env, forDeny = false } = {})
{
    const at = path.resolve(start || process.cwd());
    let places = [at];
    try
    {
        const r = layout.projectRootOf(at);
        places = [...new Set([r.checkout, r.project])];
    }
    catch { /* the start directory alone */ }
    const project = places[places.length - 1];
    const stores = [];
    for (const place of places) for (const file of filesAt(place, layout.dataRootOf(place, { env }), forDeny))
    {
        stores.push({ file, root: place, rel: '.', real: realOf(file), skip: new Set() });
        if (!forDeny) break;
    }
    if (!forDeny && stores.length > 1) stores.length = 1;
    if (!forDeny && !layout.workspaceOn({ env, projectRoot: project })) return stores;
    const own = layout.ownWorkspace(project, { env });
    const secretsOf = (ignores) => ignores.filter((i) => i.category === 'secret').map((i) => i.name);
    const skip = new Set(secretsOf(own.ignores));
    for (const member of layout.workspaceChain(project, { env }).members)
    {
        for (const file of filesAt(member.root, member.dataRoot, forDeny)) stores.push({ file, root: member.root, rel: member.rel, real: realOf(file), skip: new Set(skip) });
        for (const name of secretsOf(member.ignores)) skip.add(name);
    }
    return stores;
}

// The merged values, { values: { KEY: value }, from: { KEY: rel } }: the nearest store's value of a key wins, a key in a
// store's `skip` is passed over there, and an unreadable store adds nothing.
function valuesOf(stores)
{
    const values = {};
    const from = {};
    for (const store of stores)
    {
        for (const [key, value] of Object.entries(readStore(store.file)))
        {
            if (Object.hasOwn(values, key) || (store.skip && store.skip.has(key))) continue;
            values[key] = value;
            from[key] = store.rel;
        }
    }
    return { values, from };
}

// A text with every value of `min` or more characters shown as <KEY>, longest first so a value inside another is not
// half-replaced.
function masker(values, min = 4)
{
    const pairs = Object.entries(values || {}).filter(([, v]) => typeof v === 'string' && v.length >= min).sort((a, b) => b[1].length - a[1].length);
    return (text) => pairs.reduce((out, [key, value]) => out.split(value).join(`<${key}>`), String(text));
}

// The chain's stores, values and sources in one call, with the chain's own notes (a refused hop).
function chainOf(start, { env = process.env } = {})
{
    const stores = storesOf(start, { env });
    const { values, from } = valuesOf(stores);
    let notes = [];
    try
    {
        const project = layout.projectRootOf(path.resolve(start || process.cwd())).project;
        if (layout.workspaceOn({ env, projectRoot: project })) notes = layout.workspaceChain(project, { env }).notes;
    }
    catch { /* no chain: no note */ }
    return { stores, values, from, notes };
}

module.exports = { SECRET_FILES, readStore, storesOf, valuesOf, masker, chainOf };
