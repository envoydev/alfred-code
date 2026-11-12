'use strict';
// Workspace stage 3, Task 1: scripts/install/links.js - the store, the links, their record - and the two stamp lines.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const runtime = require('./install/runtime.js');
const links = require('./install/links.js');
const stamp = require('./install/stamp.js');
const { hashItem } = require('./install/library.js');
const { samePath } = require('./test-paths.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'links-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let n = 0;
const fresh = (name = `p${n += 1}`) => { const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true }); return d; };
const gitEnv = { PATH: process.env.PATH, HOME: TMP, GIT_CONFIG_GLOBAL: path.join(TMP, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: TMP };
fs.writeFileSync(path.join(TMP, 'gitconfig'), '');
const rt = { spawnCommand: (bin, argv, opts) => runtime.spawnCommand(bin, argv, { ...opts, env: gitEnv }) };
const noGit = { spawnCommand: () => ({ status: null, stdout: '', error: new Error('git not found') }) };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env: gitEnv, stdio: 'pipe' });
function repo(ignore = '.claude/\n')
{
    const d = fresh();
    git(d, 'init', '-q', '-b', 'main');
    if (ignore !== null) fs.writeFileSync(path.join(d, '.gitignore'), ignore);
    return d;
}
// A project's store holding a skill folder and an agent file; its own items in the store are the holders.
function store(root, { skills = [], agents = [] } = {})
{
    for (const s of skills) { fs.mkdirSync(path.join(root, '.alfred', 'stack', 'skills', s), { recursive: true }); fs.writeFileSync(path.join(root, '.alfred', 'stack', 'skills', s, 'SKILL.md'), `# ${s}\n`); }
    for (const a of agents) { fs.mkdirSync(path.join(root, '.alfred', 'stack', 'agents'), { recursive: true }); fs.writeFileSync(path.join(root, '.alfred', 'stack', 'agents', `${a}.md`), `# ${a}\n`); }
    return root;
}
const lines = () => { const out = []; return Object.assign((l) => out.push(l), { out }); };
const sync = (root, o = {}) => { const log = o.log || lines(); const record = links.syncLinks({ projectRoot: root, rt, ...o, log }); return { record, log: log.out }; };
const want = (skills = [], agents = []) => [...skills.map((name) => ({ kind: 'skills', name })), ...agents.map((name) => ({ kind: 'agents', name }))];
const at = (root, p) => path.join(root, '.claude', p);

test('links: the four git states of a folder', () =>
{
    const ignored = repo();
    const visible = repo('');
    const outside = fresh();
    assert.strictEqual(links.gitState(path.join(outside, '.claude', 'skills'), { rt }), 'none');
    assert.strictEqual(links.gitState(path.join(ignored, '.claude', 'skills'), { rt }), 'ignored');
    assert.strictEqual(links.gitState(path.join(visible, '.claude', 'skills'), { rt }), 'visible');
    assert.strictEqual(links.gitState(path.join(ignored, '.claude', 'skills'), { rt: noGit }), 'unknown');
    // A file tracked inside an ignored folder makes the folder visible: a link there would replace a committed path.
    fs.mkdirSync(path.join(ignored, '.claude', 'skills', 'own'), { recursive: true });
    fs.writeFileSync(path.join(ignored, '.claude', 'skills', 'own', 'SKILL.md'), 'x');
    git(ignored, 'add', '-f', '.claude/skills/own/SKILL.md');
    assert.strictEqual(links.gitState(path.join(ignored, '.claude', 'skills'), { rt }), 'visible');
});

test('links: homeOf - the store where the kind is linkable, .claude where git sees it; write false needs the folder', () =>
{
    const p = repo();
    assert.deepStrictEqual(links.homeOf(p, 'skills', { rt }), { dir: path.join(p, '.alfred', 'stack', 'skills'), store: true, state: 'ignored' });
    assert.deepStrictEqual(links.homeOf(p, 'skills', { rt, write: false }), { dir: path.join(p, '.claude', 'skills'), store: false, state: 'ignored' });
    store(p, { skills: ['a'] });
    assert.strictEqual(links.homeOf(p, 'skills', { rt, write: false }).store, true);
    const v = repo('');
    assert.deepStrictEqual(links.homeOf(v, 'agents', { rt }), { dir: path.join(v, '.claude', 'agents'), store: false, state: 'visible' });
    assert.strictEqual(links.fileOf('agents', 'x'), 'x.md');
    assert.strictEqual(links.fileOf('skills', 'x'), 'x');
});

test('links: a skill is a directory link and an agent a file link, each resolving to the store; a second run changes nothing', { skip: process.platform === 'win32' && 'the win32 shape (a junction and a copy) is the next test' }, () =>
{
    const p = store(fresh(), { skills: ['a'], agents: ['x'] });
    const { record, log } = sync(p, { want: want(['a'], ['x']) });
    assert.deepStrictEqual(record, [{ path: 'agents/x.md', kind: 'symlink', hash: '' }, { path: 'skills/a', kind: 'symlink', hash: '' }]);
    assert.ok(fs.lstatSync(at(p, 'skills/a')).isSymbolicLink());
    assert.ok(samePath(fs.realpathSync.native(at(p, 'skills/a')), path.join(p, '.alfred', 'stack', 'skills', 'a')));
    assert.strictEqual(fs.readFileSync(at(p, 'agents/x.md'), 'utf8'), '# x\n');
    assert.ok(!path.isAbsolute(fs.readlinkSync(at(p, 'skills/a'))), 'a relative target off Windows');
    assert.ok(log.includes('link: .claude/skills/a -> .alfred/stack/skills/a'), log.join('\n'));
    const again = sync(p, { want: want(['a'], ['x']), prior: record });
    assert.deepStrictEqual(again.record, record);
    assert.deepStrictEqual(again.log.filter((l) => /link/.test(l)), []);
});

test('links: inherited - a copy its store holds and a dangling link into its store are its own; a link elsewhere, dangling or not, is not', () =>
{
    const p = store(fresh(), { skills: ['own', 'gone'], agents: ['x'] });
    const away = store(fresh(), { skills: ['up', 'lost'] });
    fs.mkdirSync(at(p, 'skills'), { recursive: true });
    const link = (name, dir) => fs.symlinkSync(path.relative(at(p, 'skills'), path.join(dir, '.alfred', 'stack', 'skills', name)), at(p, `skills/${name}`), 'dir');
    for (const [n, d] of [['own', p], ['gone', p], ['up', away], ['lost', away]]) link(n, d);
    fs.rmSync(path.join(p, '.alfred', 'stack', 'skills', 'gone'), { recursive: true });
    fs.rmSync(path.join(away, '.alfred', 'stack', 'skills', 'lost'), { recursive: true });
    fs.mkdirSync(at(p, 'agents'), { recursive: true });
    fs.writeFileSync(at(p, 'agents/x.md'), '# x\n');
    fs.writeFileSync(at(p, 'agents/y.md'), '# y\n');
    const record = ['skills/own', 'skills/gone', 'skills/up', 'skills/lost'].map((q) => ({ path: q, kind: 'symlink', hash: '' }))
        .concat(['agents/x.md', 'agents/y.md'].map((q) => ({ path: q, kind: 'copy', hash: hashItem(at(p, q)) })));
    assert.deepStrictEqual(links.inherited(p, record).map((e) => e.path), ['skills/up', 'skills/lost', 'agents/y.md']);
});

test('links: a link whose target is no holder any more is removed and says so', () =>
{
    const c = fresh();
    const elsewhere = path.join(fresh(), 'a');
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.mkdirSync(at(c, 'skills'), { recursive: true });
    fs.symlinkSync(elsewhere, at(c, 'skills/a'), process.platform === 'win32' ? 'junction' : 'dir');
    const { record, log } = sync(c, { want: want(['a']), prior: [{ path: 'skills/a', kind: process.platform === 'win32' ? 'junction' : 'symlink', hash: '' }] });
    assert.deepStrictEqual(record, []);
    assert.ok(log.includes('link removed: .claude/skills/a - nothing this project links from holds it now'), log.join('\n'));
    assert.ok(fs.existsSync(elsewhere));
});

test('links: switched off (keep), a listed agent copy at its hash stays though no holder is found', () =>
{
    const kid = fresh();
    fs.mkdirSync(at(kid, 'agents'), { recursive: true });
    fs.writeFileSync(at(kid, 'agents/x.md'), '# x\n');
    const prior = [{ path: 'agents/x.md', kind: 'copy', hash: hashItem(at(kid, 'agents/x.md')) }];
    const { record } = sync(kid, { want: want([], ['x']), prior, keep: true, platform: 'win32' });
    assert.deepStrictEqual(record, prior);
    assert.ok(fs.existsSync(at(kid, 'agents/x.md')));
    const gone = sync(kid, { want: want([], ['x']), prior, platform: 'win32' });
    assert.ok(gone.log.includes('copy removed: .claude/agents/x.md - its target is gone'), gone.log.join('\n'));
});

test('links: a visible kind with no .claude folder yet says why without throwing', () =>
{
    const { log } = sync(repo(''), { want: want(['a']) });
    assert.ok(log.some((l) => /skills stay as copies/.test(l)), log.join('\n'));
});

test('links: inherited reads a dangling link into a store removed whole as its own, from a root path not yet resolved', () =>
{
    const p = store(fresh(), { skills: ['a'] });
    fs.mkdirSync(at(p, 'skills'), { recursive: true });
    fs.symlinkSync(path.join('..', '..', '.alfred', 'stack', 'skills', 'a'), at(p, 'skills/a'), 'dir');
    fs.rmSync(path.join(p, '.alfred', 'stack'), { recursive: true });
    assert.deepStrictEqual(links.inherited(p, [{ path: 'skills/a', kind: 'symlink', hash: '' }]), []);
});

test('links: a released child keeps an agent the stamp lists as a copy (Windows, or a link refused), now held in its own store', () =>
{
    const kid = fresh();
    fs.mkdirSync(at(kid, 'agents'), { recursive: true });
    fs.writeFileSync(at(kid, 'agents/x.md'), '# x\n');
    fs.writeFileSync(at(kid, 'alfred-code.stamp'), `links: agents/x.md=copy@${hashItem(at(kid, 'agents/x.md'))}\n`);
    require('./install/workspace.js').copyIn(kid);
    assert.strictEqual(fs.readFileSync(at(kid, 'agents/x.md'), 'utf8'), '# x\n');
    assert.strictEqual(fs.readFileSync(path.join(kid, '.alfred', 'stack', 'agents', 'x.md'), 'utf8'), '# x\n');
    assert.strictEqual(stamp.readLinks(at(kid, 'alfred-code.stamp')).length, 1);
});

test('links: a .claude linked into a repository whose git sees the kind keeps copies and says where the ignore line goes', () =>
{
    const p = store(fresh(), { skills: ['a'] });
    const dot = repo('');
    fs.symlinkSync(dot, path.join(p, '.claude'), process.platform === 'win32' ? 'junction' : 'dir');
    const { log } = sync(p, { want: want(['a']) });
    assert.ok(log.some((l) => /skills stay as copies in \.claude\/skills: \.claude is a link into a folder whose git sees skills - an ignore line for it there lets the store be used/.test(l)), log.join('\n'));
});

test('links: a .claude that is itself a link (a dotfiles folder) gets links that resolve, and a second run changes nothing', () =>
{
    const p = store(fresh(), { skills: ['a'], agents: ['x'] });
    const dot = fresh();
    fs.symlinkSync(dot, path.join(p, '.claude'), process.platform === 'win32' ? 'junction' : 'dir');
    const { record } = sync(p, { want: want(['a'], ['x']) });
    assert.strictEqual(fs.readFileSync(at(p, 'skills/a/SKILL.md'), 'utf8'), '# a\n');
    assert.strictEqual(fs.readFileSync(at(p, 'agents/x.md'), 'utf8'), '# x\n');
    const again = sync(p, { want: want(['a'], ['x']), prior: record });
    assert.deepStrictEqual(again.record, record);
    assert.deepStrictEqual(again.log, []);
    assert.deepStrictEqual(links.checkLinks({ projectRoot: p, record }).map((c) => c.state), ['ok', 'ok']);
});

test('links: on win32 a skill is a junction and an agent a copy with its hash, written again when the store moves on, kept once edited', () =>
{
    const p = store(fresh(), { skills: ['a'], agents: ['x'] });
    const { record, log } = sync(p, { want: want(['a'], ['x']), platform: 'win32' });
    const agent = record.find((e) => e.path === 'agents/x.md');
    assert.strictEqual(record.find((e) => e.path === 'skills/a').kind, 'junction');
    if (process.platform === 'win32') assert.ok(path.isAbsolute(fs.readlinkSync(at(p, 'skills/a'))));
    assert.deepStrictEqual(agent, { path: 'agents/x.md', kind: 'copy', hash: hashItem(path.join(p, '.alfred', 'stack', 'agents', 'x.md')) });
    assert.ok(!fs.lstatSync(at(p, 'agents/x.md')).isSymbolicLink());
    assert.ok(log.includes('agent copy: .claude/agents/x.md - a link cannot be made here'), log.join('\n'));
    // Whole: kept. The store moved on: written again, the new hash recorded.
    assert.deepStrictEqual(sync(p, { want: want(['a'], ['x']), prior: record, platform: 'win32' }).record, record);
    fs.writeFileSync(path.join(p, '.alfred', 'stack', 'agents', 'x.md'), '# x v2\n');
    const moved = sync(p, { want: want(['a'], ['x']), prior: record, platform: 'win32' }).record;
    assert.strictEqual(fs.readFileSync(at(p, 'agents/x.md'), 'utf8'), '# x v2\n');
    assert.strictEqual(moved.find((e) => e.path === 'agents/x.md').hash, hashItem(path.join(p, '.alfred', 'stack', 'agents', 'x.md')));
    // Edited: kept, named, off the record.
    fs.writeFileSync(at(p, 'agents/x.md'), '# mine\n');
    const edited = sync(p, { want: want(['a'], ['x']), prior: moved, platform: 'win32' });
    assert.ok(!edited.record.some((e) => e.path === 'agents/x.md'));
    assert.strictEqual(fs.readFileSync(at(p, 'agents/x.md'), 'utf8'), '# mine\n');
    assert.ok(edited.log.includes('  agent kept: .claude/agents/x.md - edited since it was copied from the store, so it is yours'), edited.log.join('\n'));
});

test('links: a link that cannot be made - the agent a copy with its hash, the skill named and left out', () =>
{
    const p = store(fresh(), { skills: ['a'], agents: ['x'] });
    const symlink = () => { throw Object.assign(new Error('no links here'), { code: 'EPERM' }); };
    const { record, log } = sync(p, { want: want(['a'], ['x']), symlink });
    assert.deepStrictEqual(record, [{ path: 'agents/x.md', kind: 'copy', hash: hashItem(path.join(p, '.alfred', 'stack', 'agents', 'x.md')) }]);
    assert.ok(log.includes('  !! link not made: .claude/skills/a - EPERM'), log.join('\n'));
    assert.ok(!fs.existsSync(at(p, 'skills/a')));
});

test('links: a real folder, a real file and an unlisted link at the path are the user\'s - skipped and named', () =>
{
    const p = store(fresh(), { skills: ['a', 'b'], agents: ['x'] });
    fs.mkdirSync(at(p, 'skills/a'), { recursive: true });
    fs.writeFileSync(at(p, 'skills/a/SKILL.md'), 'mine');
    fs.mkdirSync(at(p, 'agents'), { recursive: true });
    fs.writeFileSync(at(p, 'agents/x.md'), 'mine');
    fs.symlinkSync(path.join(p, '.alfred', 'stack', 'skills', 'b'), at(p, 'skills/b'), 'dir');
    const { record, log } = sync(p, { want: want(['a', 'b'], ['x']) });
    assert.deepStrictEqual(record, []);
    assert.ok(log.includes('  !! link skipped: .claude/skills/a - a real folder or file of that name is yours'), log.join('\n'));
    assert.ok(log.includes('  !! link skipped: .claude/agents/x.md - a real folder or file of that name is yours'), log.join('\n'));
    assert.ok(log.includes('  !! link skipped: .claude/skills/b - a link the stamp does not list, so it is yours'), log.join('\n'));
    assert.strictEqual(fs.readFileSync(at(p, 'skills/a/SKILL.md'), 'utf8'), 'mine');
});

test('links: a moved target is re-pointed; a missing target is removed and named; the target\'s files stay after every removal', () =>
{
    const root = store(fresh(), { skills: ['a', 'b'] });
    const child = fresh();
    const members = [{ root, rel: '..' }];
    const first = sync(child, { members, want: want(['a', 'b']) }).record;
    assert.strictEqual(first.length, 2);
    // The workspace moved: the holder is now elsewhere, so the listed link is re-pointed.
    const moved = path.join(TMP, `moved-${n += 1}`);
    fs.renameSync(root, moved);
    const second = sync(child, { members: [{ root: moved, rel: '..' }], want: want(['a', 'b']), prior: first });
    assert.ok(second.log.includes('link re-pointed: .claude/skills/a'), second.log.join('\n'));
    assert.ok(samePath(fs.realpathSync.native(at(child, 'skills/a')), path.join(moved, '.alfred', 'stack', 'skills', 'a')));
    // The target of b is gone: the link goes, named.
    fs.rmSync(path.join(moved, '.alfred', 'stack', 'skills', 'b'), { recursive: true });
    const third = sync(child, { members: [{ root: moved, rel: '..' }], want: want(['a', 'b']), prior: second.record });
    assert.ok(third.log.includes('link removed: .claude/skills/b - its target is gone'), third.log.join('\n'));
    assert.ok(!fs.existsSync(at(child, 'skills/b')) && !third.record.some((e) => e.path === 'skills/b'));
    // Not wanted any more: unlinked, the target whole. removeLinks: the same.
    const fourth = sync(child, { members: [{ root: moved, rel: '..' }], want: [], prior: third.record });
    assert.deepStrictEqual(fourth.record, []);
    assert.ok(!fs.existsSync(at(child, 'skills/a')));
    assert.strictEqual(fs.readFileSync(path.join(moved, '.alfred', 'stack', 'skills', 'a', 'SKILL.md'), 'utf8'), '# a\n');
    const again = sync(child, { members: [{ root: moved, rel: '..' }], want: want(['a']) }).record;
    links.removeLinks({ projectRoot: child, record: again, log: () => {} });
    assert.ok(!fs.existsSync(at(child, 'skills/a')));
    assert.strictEqual(fs.readFileSync(path.join(moved, '.alfred', 'stack', 'skills', 'a', 'SKILL.md'), 'utf8'), '# a\n');
});

test('links: removeLinks takes a copy only at its hash', () =>
{
    const p = store(fresh(), { agents: ['x', 'y'] });
    const record = sync(p, { want: want([], ['x', 'y']), platform: 'win32' }).record;
    fs.writeFileSync(at(p, 'agents/y.md'), 'mine');
    const log = lines();
    links.removeLinks({ projectRoot: p, record, log });
    assert.ok(!fs.existsSync(at(p, 'agents/x.md')));
    assert.strictEqual(fs.readFileSync(at(p, 'agents/y.md'), 'utf8'), 'mine');
    assert.ok(log.out.includes('  agent kept: .claude/agents/y.md - edited since it was copied from the store, so it is yours'), log.out.join('\n'));
});

test('links: three levels - the nearest holder wins, a member\'s link is never a target, a visible member holds from .claude', () =>
{
    const root = store(repo(), { skills: ['a', 'b'] });
    const mid = store(fresh(), { skills: ['b'] });
    fs.mkdirSync(at(mid, 'skills'), { recursive: true });
    fs.symlinkSync(path.join(root, '.alfred', 'stack', 'skills', 'a'), at(mid, 'skills/a'), 'dir');
    const visible = repo('');
    fs.mkdirSync(at(visible, 'skills/c'), { recursive: true });
    fs.writeFileSync(at(visible, 'skills/c/SKILL.md'), '# c\n');
    const leaf = fresh();
    const members = [{ root: mid, rel: '..' }, { root: visible, rel: '../..' }, { root, rel: '../../..' }];
    sync(leaf, { members, want: want(['a', 'b', 'c']) });
    assert.ok(samePath(fs.realpathSync.native(at(leaf, 'skills/a')), path.join(root, '.alfred', 'stack', 'skills', 'a')));
    assert.ok(samePath(fs.realpathSync.native(at(leaf, 'skills/b')), path.join(mid, '.alfred', 'stack', 'skills', 'b')));
    assert.ok(samePath(fs.realpathSync.native(at(leaf, 'skills/c')), at(visible, 'skills/c')));
    assert.ok(samePath(links.holderOf({ projectRoot: leaf, members, kind: 'skills', name: 'a', rt }), path.join(root, '.alfred', 'stack', 'skills', 'a')));
    assert.strictEqual(links.holderOf({ projectRoot: leaf, members, kind: 'skills', name: '../a', rt }), null);
});

test('links: a project whose kind git sees gets no link, one line, and no entry; git that could not run keeps them', () =>
{
    const v = repo('');
    fs.mkdirSync(at(v, 'agents'), { recursive: true });
    fs.writeFileSync(at(v, 'agents/x.md'), '# x\n');
    const prior = [{ path: 'agents/x.md', kind: 'copy', hash: hashItem(at(v, 'agents/x.md')) }, { path: 'skills/old', kind: 'symlink', hash: '' }];
    const { record, log } = sync(v, { want: want(['a'], ['x']), prior });
    assert.deepStrictEqual(record, []);
    assert.strictEqual(fs.readFileSync(at(v, 'agents/x.md'), 'utf8'), '# x\n', 'the copy stays, a plain library copy now');
    assert.deepStrictEqual(sync(fresh(), { want: want(['a']), prior, rt: noGit }).record, prior);
    assert.ok(log.includes("  skills stay as copies in .claude/skills: git does not ignore that folder here - the store needs the local scope, or an ignore line for it and 'git rm -r --cached .claude/skills'"), log.join('\n'));
    const u = sync(fresh(), { want: want(['a']), rt: noGit });
    assert.ok(u.log.includes('  skills stay as copies in .claude/skills: git could not be run'), u.log.join('\n'));
});

test('links: a path with a space and a non-ASCII letter', () =>
{
    const name = `a b${String.fromCodePoint(0xe9)}(1)`;
    const root = store(fresh(name), { skills: ['a'] });
    const child = fresh(path.join(name, `c${String.fromCodePoint(0x0436)} d`));
    sync(child, { members: [{ root, rel: '..' }], want: want(['a']) });
    assert.strictEqual(fs.readFileSync(at(child, 'skills/a/SKILL.md'), 'utf8'), '# a\n');
    assert.deepStrictEqual(links.checkLinks({ projectRoot: child, record: [{ path: 'skills/a', kind: 'symlink', hash: '' }], members: [{ root, rel: '..' }], rt }), [{ path: 'skills/a', state: 'ok' }]);
});

test('links: checkLinks names every state', () =>
{
    const p = store(fresh(), { skills: ['a', 'b'], agents: ['x', 'y', 'z'] });
    const record = [...sync(p, { want: want(['a', 'b']) }).record, ...sync(p, { want: want([], ['x', 'y', 'z']), platform: 'win32' }).record];
    fs.rmSync(path.join(p, '.alfred', 'stack', 'skills', 'b'), { recursive: true });
    fs.writeFileSync(at(p, 'agents/y.md'), 'mine');
    fs.writeFileSync(path.join(p, '.alfred', 'stack', 'agents', 'z.md'), '# z v2\n');
    const gone = [...record, { path: 'skills/c', kind: 'symlink', hash: '' }];
    assert.deepStrictEqual(links.checkLinks({ projectRoot: p, record: gone, rt }), [
        { path: 'skills/a', state: 'ok' }, { path: 'skills/b', state: 'dangling' },
        { path: 'agents/x.md', state: 'ok' }, { path: 'agents/y.md', state: 'edited' }, { path: 'agents/z.md', state: 'stale' },
        { path: 'skills/c', state: 'missing' },
    ]);
});

test('links: moveIn moves real items, passes over a link and a name the store holds, and puts back what it moved on a failed rename', () =>
{
    const p = repo();
    for (const s of ['a', 'b', 'c']) { fs.mkdirSync(at(p, `skills/${s}`), { recursive: true }); fs.writeFileSync(at(p, `skills/${s}/SKILL.md`), s); }
    store(p, { skills: ['b'] });
    fs.symlinkSync(path.join(p, '.alfred', 'stack', 'skills', 'b'), at(p, 'skills/l'), 'dir');
    const log = lines();
    const home = links.homeOf(p, 'skills', { rt });
    assert.deepStrictEqual(links.moveIn({ projectRoot: p, kind: 'skills', names: ['a', 'b', 'l', 'missing'], home, log }), { moved: ['a'], failed: [] });
    assert.strictEqual(fs.readFileSync(path.join(p, '.alfred', 'stack', 'skills', 'a', 'SKILL.md'), 'utf8'), 'a');
    assert.ok(!fs.existsSync(at(p, 'skills/a')) && fs.existsSync(at(p, 'skills/b')));
    assert.ok(log.out.includes('skill moved to the store: a'), log.out.join('\n'));
    // The store folder is a file: nothing moves, the first name is named, every copy stays in .claude.
    const s = repo();
    for (const x of ['a', 'b']) { fs.mkdirSync(at(s, `skills/${x}`), { recursive: true }); fs.writeFileSync(at(s, `skills/${x}/SKILL.md`), x); }
    fs.mkdirSync(path.join(s, '.alfred', 'stack'), { recursive: true });
    fs.writeFileSync(path.join(s, '.alfred', 'stack', 'skills'), 'a file where the store goes');
    const slog = lines();
    const failed = links.moveIn({ projectRoot: s, kind: 'skills', names: ['a', 'b'], home: links.homeOf(s, 'skills', { rt }), log: slog });
    assert.deepStrictEqual(failed.moved, []);
    assert.deepStrictEqual(failed.failed, ['a']);
    assert.ok(fs.existsSync(at(s, 'skills/a/SKILL.md')) && fs.existsSync(at(s, 'skills/b/SKILL.md')));
    assert.ok(slog.out.some((l) => /^ {2}!! skills stay in \.claude this run: a could not be moved \(E[A-Z]+\)$/.test(l)), slog.out.join('\n'));
    // A rename that throws after one moved: the moved one is put back.
    const t = repo();
    for (const x of ['a', 'b']) { fs.mkdirSync(at(t, `skills/${x}`), { recursive: true }); fs.writeFileSync(at(t, `skills/${x}/SKILL.md`), x); }
    const realRename = fs.renameSync;
    let calls = 0;
    fs.renameSync = (from, to) => { calls += 1; if (calls === 2) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); return realRename(from, to); };
    let back;
    try { back = links.moveIn({ projectRoot: t, kind: 'skills', names: ['a', 'b'], home: links.homeOf(t, 'skills', { rt }), log: () => {} }); }
    finally { fs.renameSync = realRename; }
    assert.deepStrictEqual(back, { moved: [], failed: ['b'] });
    assert.ok(fs.existsSync(at(t, 'skills/a/SKILL.md')) && !fs.existsSync(path.join(t, '.alfred', 'stack', 'skills', 'a')));
});

test('links: moveIn moves a stamped rule file into the store and leaves an unlisted one', () =>
{
    const p = fresh();
    fs.mkdirSync(at(p, 'rules'), { recursive: true });
    for (const x of ['a', 'mine']) fs.writeFileSync(at(p, `rules/${x}.md`), x);
    const dir = links.storeOf(p, 'rules');
    const log = lines();
    const r = links.moveIn({ projectRoot: p, kind: 'rules', names: ['a'], home: { store: true, dir }, log });
    assert.deepStrictEqual(r, { moved: ['a'], failed: [] });
    assert.strictEqual(fs.readFileSync(path.join(dir, 'a.md'), 'utf8'), 'a');
    assert.ok(!fs.existsSync(at(p, 'rules/a.md')) && fs.existsSync(at(p, 'rules/mine.md')));
    assert.ok(log.out.includes('rule moved to the store: a'), log.out.join('\n'));
});

test('links: a rule that cannot be moved puts back what this call moved', () =>
{
    const p = fresh();
    fs.mkdirSync(at(p, 'rules'), { recursive: true });
    for (const x of ['a', 'b']) fs.writeFileSync(at(p, `rules/${x}.md`), x);
    const realRename = fs.renameSync;
    let calls = 0;
    fs.renameSync = (from, to) => { calls += 1; if (calls === 2) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); return realRename(from, to); };
    let r;
    try { r = links.moveIn({ projectRoot: p, kind: 'rules', names: ['a', 'b'], home: { store: true, dir: links.storeOf(p, 'rules') }, log: () => {} }); }
    finally { fs.renameSync = realRename; }
    assert.deepStrictEqual(r, { moved: [], failed: ['b'] });
    assert.ok(fs.existsSync(at(p, 'rules/a.md')) && fs.existsSync(at(p, 'rules/b.md')));
    assert.ok(!fs.existsSync(path.join(links.storeOf(p, 'rules'), 'a.md')));
});

test('stamp: links and member-picks round trip; a bad path, kind or name is dropped', () =>
{
    const p = fresh();
    const file = path.join(p, 'alfred-code.stamp');
    const h = 'a'.repeat(64);
    fs.writeFileSync(file, stamp.renderStamp({ repoUrl: 'u', ref: 'r', sha: 's', version: '1', installed: 'i', action: 'install', scope: 'local', hooks: [], alwaysRules: [],
        links: [{ path: 'skills/a', kind: 'symlink', hash: '' }, { path: 'agents/x.md', kind: 'copy', hash: h }], memberPicks: ['skill b', 'agent y', 'skill b'] }));
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, new RegExp(`^links: skills/a=symlink,agents/x\\.md=copy@${h}\\nmember-picks: agent/y,skill/b\\nlibrary-skills:`, 'm'));
    assert.deepStrictEqual(stamp.readLinks(file), [{ path: 'skills/a', kind: 'symlink', hash: '' }, { path: 'agents/x.md', kind: 'copy', hash: h }]);
    assert.deepStrictEqual(stamp.readMemberPicks(file), ['agent y', 'skill b']);
    stamp.markLine(file, 'links', `skills/a=symlink,skills/../x=symlink,agents/y=symlink,skills/b=hard,agents/z.md=copy,skills/C=junction,skills/d=junction@${h}`);
    stamp.markLine(file, 'member-picks', 'skill/ok,rule/r,hook/h,skill/../x,agent/Bad,skill');
    assert.deepStrictEqual(stamp.readLinks(file), [{ path: 'skills/a', kind: 'symlink', hash: '' }]);
    assert.deepStrictEqual(stamp.readMemberPicks(file), ['skill ok', 'rule r'], 'a rule a member picked is held at the root too (4c); a hook is no store item');
    stamp.markLine(file, 'member-picks', null);
    stamp.markLine(file, 'links', null);
    assert.strictEqual(stamp.readMemberPicks(file), null);
    assert.deepStrictEqual(stamp.readLinks(file), []);
    assert.strictEqual(stamp.linksValue([{ path: 'skills/a', kind: 'junction', hash: '' }, { path: 'agents/x.md', kind: 'copy', hash: h }]), `skills/a=junction,agents/x.md=copy@${h}`);
});
