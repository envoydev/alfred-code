'use strict';
// Workspace stage 3: a library skill - on the copy route a library agent too - lives once in `.alfred/stack/<kind>` of the
// workspace root (or a project in no workspace), linked from each project's `.claude/<kind>` where git cannot commit a
// link. On Windows a skill is a junction and an agent a copy with its hash: every save breaks a hard link (P11).
const fs = require('node:fs');
const path = require('node:path');
const { hashItem } = require('./library.js');
const { validItemName } = require('./stamp.js');
const KINDS = ['skills', 'agents'];
const fileOf = (kind, name) => (kind === 'agents' ? `${name}.md` : name);
const lstat = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
const isItem = (kind, st) => Boolean(st) && !st.isSymbolicLink() && (kind === 'skills' ? st.isDirectory() : st.isFile());
const storeOf = (root, kind) => path.join(root, '.alfred', 'stack', kind);
const kept = (p) => `  agent kept: .claude/${p} - edited since it was copied from the store, so it is yours`;
// `none` outside a repository, else git's own word; a tracked file inside makes the folder `visible` (a link would replace
// a committed path); `unknown` when git cannot be run.
function gitState(dir, { rt = require('./runtime.js') } = {})
{
    let at = path.resolve(dir);
    while (!fs.existsSync(at) && path.dirname(at) !== at) at = path.dirname(at);
    const run = (args) => rt.spawnCommand('git', args, { cwd: at, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const inside = run(['rev-parse', '--is-inside-work-tree']);
    if (inside.error) return 'unknown';
    if (inside.status !== 0 || String(inside.stdout).trim() !== 'true') return 'none';
    const ignored = run(['check-ignore', '-q', '--', dir]);
    if (ignored.status !== 0) return ignored.status === 1 ? 'visible' : 'unknown';
    return String(run(['ls-files', '--', dir]).stdout || '').trim() ? 'visible' : 'ignored';
}
// Where a project's items of a kind live; a plan run (`write` false) reads the store only once it exists (ruling 5).
function homeOf(projectRoot, kind, { rt, write = true } = {})
{
    const state = gitState(path.join(projectRoot, '.claude', kind), { rt });
    const store = (state === 'none' || state === 'ignored') && (write || Boolean(fs.statSync(storeOf(projectRoot, kind), { throwIfNoEntry: false })?.isDirectory()));
    return { dir: store ? storeOf(projectRoot, kind) : path.join(projectRoot, '.claude', kind), store, state };
}
// The nearest real item: the project's own store, then each member's home. A link is never a holder; a name of another
// shape than the installer's own never reaches a path join.
const dirsOf = (root, members, kind, rt) => [storeOf(root, kind), ...members.map((m) => homeOf(m.root, kind, { rt, write: false }).dir)];
const findHolder = (dirs, kind, name) => (validItemName(name) ? dirs.map((d) => path.join(d, fileOf(kind, name))).find((p) => isItem(kind, lstat(p))) || null : null);
const holderOf = ({ projectRoot, members = [], kind, name, rt }) => findHolder(dirsOf(projectRoot, members, kind, rt), kind, name);
// Each named real item of `.claude/<kind>` the store lacks is renamed into it; the first rename that throws puts back
// what this call moved, and the kind runs from `.claude` as copies this run.
function moveIn({ projectRoot, kind, names = [], home, log = () => {} })
{
    const moved = [];
    const src = (n) => path.join(projectRoot, '.claude', kind, fileOf(kind, n));
    for (const name of home && home.store ? names.filter((n) => validItemName(n)) : [])
    {
        if (!isItem(kind, lstat(src(name))) || lstat(path.join(home.dir, fileOf(kind, name)))) continue;
        try { fs.mkdirSync(home.dir, { recursive: true }); fs.renameSync(src(name), path.join(home.dir, fileOf(kind, name))); moved.push(name); }
        catch (err)
        {
            for (const m of moved) fs.renameSync(path.join(home.dir, fileOf(kind, m)), src(m));
            log(`  !! ${kind} stay in .claude this run: ${name} could not be moved (${err.code || err.message})`);
            return { moved: [], failed: [name] };
        }
    }
    for (const m of moved) log(`${kind.slice(0, -1)} moved to the store: ${m}`);
    return { moved, failed: [] };
}
// Removes what the record made - a link, or a copy still at its recorded hash; true when it went.
function drop(at, e)
{
    const st = lstat(at);
    const ours = Boolean(st) && (e.kind === 'copy' ? st.isFile() && hashItem(at) === e.hash : st.isSymbolicLink());
    if (ours) fs.unlinkSync(at);
    return ours;
}
function make({ projectRoot, kind, p, at, holder, platform, symlink, log })
{
    fs.mkdirSync(path.dirname(at), { recursive: true });
    const copy = () => { fs.copyFileSync(holder, at); log(`agent copy: .claude/${p} - a link cannot be made here`); return { path: p, kind: 'copy', hash: hashItem(at) }; };
    if (kind === 'agents' && platform === 'win32') return copy();
    const junction = kind === 'skills' && platform === 'win32';
    try { symlink(junction ? holder : path.relative(real(path.dirname(at)), real(holder)), at, junction ? 'junction' : kind === 'skills' ? 'dir' : 'file'); }
    catch (err) { if (kind === 'agents') return copy(); log(`  !! link not made: .claude/${p} - ${err.code || err.message}`); return null; }
    log(`link: .claude/${p} -> ${path.relative(projectRoot, holder).split(path.sep).join('/')}`);
    return { path: p, kind: junction ? 'junction' : 'symlink', hash: '' };
}
// Makes, keeps, re-points and removes the links of `want` ([{ kind, name }]) against the record `prior`; returns the new
// record. A real item or an unlisted link at a path is the user's; a kind git sees is named and left (ruling 11).
function syncLinks({ projectRoot, members = [], want = [], prior = [], keep = false, rt, platform = process.platform, symlink = fs.symlinkSync, log = () => {} })
{
    const out = [];
    const listed = new Map(prior.map((e) => [e.path, e]));
    for (const kind of KINDS)
    {
        const mine = prior.filter((e) => e.path.startsWith(`${kind}/`));
        const home = homeOf(projectRoot, kind, { rt });
        if (!home.store)
        {
            if (want.some((w) => w.kind === kind)) log(`  ${kind} stay as copies in .claude/${kind}: ${home.state === 'unknown' ? 'git could not be run' : lstat(path.join(projectRoot, '.claude'))?.isSymbolicLink() ? `.claude is a link into a folder whose git sees ${kind} - an ignore line for it there lets the store be used` : `git does not ignore that folder here - the store needs the local scope, or an ignore line for it and 'git rm -r --cached .claude/${kind}'`}`);
            // visible (a scope move): each listed link becomes a real copy of its target - moved out of this project's store, else copied - and no entry stays; git not run keeps them
            for (const e of mine) { const at = path.join(projectRoot, '.claude', e.path), t = real(at); if (home.state !== 'visible') out.push(e); else if (e.kind !== 'copy' && drop(at, e) && t) { try { if (!t.startsWith(`${real(storeOf(projectRoot, kind))}${path.sep}`)) throw new Error('not ours'); fs.renameSync(t, at); } catch { fs.cpSync(t, at, { recursive: true }); } log(`link replaced by a copy: .claude/${e.path}`); } }
            continue;
        }
        const dirs = dirsOf(projectRoot, members, kind, rt);
        const seen = new Set();
        for (const { name } of want.filter((w) => w.kind === kind && validItemName(w.name)))
        {
            const p = `${kind}/${fileOf(kind, name)}`;
            const at = path.join(projectRoot, '.claude', p);
            const [was, st] = [listed.get(p), lstat(at)];
            // keep (the workspace switched off): a listed link that still resolves, or copy at its hash, stays - its chain unread this run
            const holder = findHolder(dirs, kind, name) || (keep && was && real(at)) || null;
            const link = Boolean(st) && st.isSymbolicLink() && Boolean(was) && was.kind !== 'copy';
            const copy = Boolean(st) && st.isFile() && Boolean(was) && was.kind === 'copy';
            seen.add(p);
            if (!holder) { const live = link && fs.existsSync(at); if (was && drop(at, was)) log(`${was.kind === 'copy' ? 'copy' : 'link'} removed: .claude/${p} - ${live ? 'nothing this project links from holds it now' : 'its target is gone'}`); }
            else if (!st || (link && real(at) !== real(holder)))
            {
                if (st) fs.unlinkSync(at);
                const made = make({ projectRoot, kind, p, at, holder, platform, symlink, log });
                if (made) out.push(made);
                if (made && st) log(`link re-pointed: .claude/${p}`);
            }
            else if (link) out.push(was);
            else if (copy && hashItem(at) !== was.hash) log(kept(p));
            else if (copy) { const h = hashItem(holder); if (h !== was.hash) fs.copyFileSync(holder, at); out.push({ path: p, kind: 'copy', hash: h }); }
            else log(`  !! link skipped: .claude/${p} - ${st.isSymbolicLink() ? 'a link the stamp does not list, so it is yours' : 'a real folder or file of that name is yours'}`);
        }
        for (const e of mine.filter((x) => !seen.has(x.path)))
        {
            const at = path.join(projectRoot, '.claude', e.path);
            const gone = !fs.existsSync(at);
            if (drop(at, e) && gone) log(`link removed: .claude/${e.path} - its target is gone`);
        }
    }
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
// What a project links from a chain: each listed link pointing (dangling or not) outside its own store, and a copy its store lacks.
const inherited = (projectRoot, record) => record.filter((e) => { const own = real(storeOf(projectRoot, e.path.split('/')[0])) || storeOf(real(projectRoot) || projectRoot, e.path.split('/')[0]), at = path.join(projectRoot, '.claude', e.path); if (e.kind === 'copy') return !fs.existsSync(path.join(own, e.path.split('/')[1])); return !(real(at) || path.resolve(real(path.dirname(at)) || '', (() => { try { return fs.readlinkSync(at); } catch { return ''; } })())).startsWith(own + path.sep); });
const removeLinks = ({ projectRoot, record = [], log = () => {} }) => record.forEach((e) => { const at = path.join(projectRoot, '.claude', e.path); if (!drop(at, e) && e.kind === 'copy' && lstat(at)) log(kept(e.path)); });
// Each entry's state: ok, dangling, missing, edited (a copy changed here) or stale (a copy at its recorded text while the
// store's file moved on).
function checkLinks({ projectRoot, record = [], members = [], rt })
{
    return record.map((e) =>
    {
        const [kind, file] = e.path.split('/');
        const at = path.join(projectRoot, '.claude', e.path);
        const st = lstat(at);
        if (!st || (e.kind !== 'copy' && !st.isSymbolicLink())) return { path: e.path, state: 'missing' };
        if (e.kind !== 'copy') return { path: e.path, state: fs.existsSync(at) ? 'ok' : 'dangling' };
        if (hashItem(at) !== e.hash) return { path: e.path, state: 'edited' };
        const holder = findHolder(dirsOf(projectRoot, members, kind, rt), kind, file.replace(/\.md$/, ''));
        return { path: e.path, state: holder && hashItem(holder) !== e.hash ? 'stale' : 'ok' };
    });
}
module.exports = { KINDS, fileOf, gitState, homeOf, holderOf, moveIn, syncLinks, inherited, removeLinks, checkLinks };
